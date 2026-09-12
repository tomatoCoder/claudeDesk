use crate::error::AppError;
use rusqlite::Connection;

pub fn migrate(connection: &Connection) -> Result<(), AppError> {
    let previous_version: i64 =
        connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          canonical_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          claude_session_id TEXT,
          status TEXT NOT NULL,
          model_override TEXT,
          permission_mode_override TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(task_id, run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS events_task_order ON events(task_id, id);
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )?;
    if previous_version < 2 {
        if !tasks_has_column(connection, "model_override")? {
            connection.execute("ALTER TABLE tasks ADD COLUMN model_override TEXT", [])?;
        }
        if !tasks_has_column(connection, "permission_mode_override")? {
            connection.execute(
                "ALTER TABLE tasks ADD COLUMN permission_mode_override TEXT",
                [],
            )?;
        }
    }
    connection.execute_batch("PRAGMA user_version = 2;")?;
    Ok(())
}

fn tasks_has_column(connection: &Connection, column: &str) -> Result<bool, AppError> {
    let mut statement = connection.prepare("PRAGMA table_info(tasks)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|name| name == column))
}

#[cfg(test)]
mod tests {
    use super::migrate;
    use rusqlite::Connection;

    #[test]
    fn migration_repairs_a_partially_applied_version_one_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                r#"
                CREATE TABLE tasks (
                  id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  title TEXT NOT NULL,
                  claude_session_id TEXT,
                  status TEXT NOT NULL,
                  model_override TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                PRAGMA user_version = 1;
                "#,
            )
            .expect("version-one fixture should be created");

        migrate(&connection).expect("migration should tolerate an existing model_override column");

        let columns = connection
            .prepare("PRAGMA table_info(tasks)")
            .expect("table metadata query should prepare")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table metadata query should execute")
            .collect::<Result<Vec<_>, _>>()
            .expect("table metadata should be readable");

        assert!(columns.contains(&"model_override".to_owned()));
        assert!(columns.contains(&"permission_mode_override".to_owned()));
    }
}
