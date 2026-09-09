use crate::error::AppError;
use rusqlite::Connection;

pub fn migrate(connection: &Connection) -> Result<(), AppError> {
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
        PRAGMA user_version = 1;
        "#,
    )?;
    Ok(())
}
