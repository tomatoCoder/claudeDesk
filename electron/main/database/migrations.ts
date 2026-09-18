import type Database from 'better-sqlite3'

export const CURRENT_SCHEMA_VERSION = 2

export function schemaVersion(database: Database.Database) {
  return Number(database.pragma('user_version', { simple: true }))
}

export function migrate(database: Database.Database) {
  const previousVersion = schemaVersion(database)
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    BEGIN IMMEDIATE;
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
  `)
  try {
    if (previousVersion < 2) {
      const columns = new Set((database.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(({ name }) => name))
      if (!columns.has('model_override')) database.exec('ALTER TABLE tasks ADD COLUMN model_override TEXT;')
      if (!columns.has('permission_mode_override')) database.exec('ALTER TABLE tasks ADD COLUMN permission_mode_override TEXT;')
    }
    database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}; COMMIT;`)
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}
