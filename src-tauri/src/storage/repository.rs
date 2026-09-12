use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    domain::{
        AppSettingsDto, ProjectDto, TaskDto, TaskEvent, TaskEventPayload, TaskPermissionMode,
        TaskStatus,
    },
    error::AppError,
};

use super::migrations::migrate;

const TASK_COLUMNS: &str = "id,project_id,title,claude_session_id,status,model_override,permission_mode_override,created_at,updated_at";

#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
}

impl Storage {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, AppError> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        migrate(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn create_or_touch_project(&self, name: &str, path: &Path) -> Result<ProjectDto, AppError> {
        let canonical = path
            .canonicalize()
            .map_err(|_| AppError::new("invalid_project_path", "项目目录不存在或不可访问", true))?;
        if !canonical.is_dir() {
            return Err(AppError::new(
                "invalid_project_path",
                "请选择一个目录",
                true,
            ));
        }
        let path_text = canonical.to_string_lossy().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        if let Some(id) = connection
            .query_row(
                "SELECT id FROM projects WHERE canonical_path = ?1",
                [&path_text],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            connection.execute(
                "UPDATE projects SET name=?1, last_opened_at=?2 WHERE id=?3",
                params![name, now, id],
            )?;
            drop(connection);
            return self.get_project(&id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO projects(id,name,canonical_path,created_at,last_opened_at) VALUES(?1,?2,?3,?4,?4)",
            params![id, name, path_text, now],
        )?;
        drop(connection);
        self.get_project(&id)
    }

    pub fn get_project(&self, id: &str) -> Result<ProjectDto, AppError> {
        self.connection
            .lock()
            .query_row(
                "SELECT id,name,canonical_path,created_at,last_opened_at FROM projects WHERE id=?1",
                [id],
                project_from_row,
            )
            .map_err(|_| AppError::new("project_not_found", "项目不存在", true))
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectDto>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT id,name,canonical_path,created_at,last_opened_at FROM projects ORDER BY last_opened_at DESC")?;
        let projects = statement
            .query_map([], project_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(projects)
    }

    pub fn remove_project(&self, id: &str) -> Result<(), AppError> {
        self.connection
            .lock()
            .execute("DELETE FROM projects WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn create_task(&self, project_id: &str, title: &str) -> Result<TaskDto, AppError> {
        self.get_project(project_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO tasks(id,project_id,title,status,created_at,updated_at) VALUES(?1,?2,?3,'idle',?4,?4)",
            params![id, project_id, title, now],
        )?;
        self.get_task(&id)
    }

    pub fn upsert_claude_session(
        &self,
        project_id: &str,
        session_id: &str,
        title: &str,
        updated_at: &str,
    ) -> Result<TaskDto, AppError> {
        self.get_project(project_id)?;
        uuid::Uuid::parse_str(session_id)
            .map_err(|_| AppError::new("invalid_session_id", "Claude 会话标识无效", false))?;
        let title = title.trim();
        let title = if title.is_empty() {
            "未命名会话"
        } else {
            title
        };
        let connection = self.connection.lock();
        if let Some(id) = connection
            .query_row(
                "SELECT id FROM tasks WHERE claude_session_id=?1 LIMIT 1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            connection.execute(
                "UPDATE tasks SET project_id=?1,title=?2,updated_at=?3 WHERE id=?4",
                params![project_id, title, updated_at, id],
            )?;
            drop(connection);
            return self.get_task(&id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO tasks(id,project_id,title,claude_session_id,status,created_at,updated_at) VALUES(?1,?2,?3,?4,'idle',?5,?5)",
            params![id, project_id, title, session_id, updated_at],
        )?;
        drop(connection);
        self.get_task(&id)
    }

    pub fn get_task(&self, id: &str) -> Result<TaskDto, AppError> {
        let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id=?1");
        self.connection
            .lock()
            .query_row(sql.as_str(), [id], task_from_row)
            .map_err(|_| AppError::new("task_not_found", "任务不存在", true))
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskDto>, AppError> {
        let connection = self.connection.lock();
        let sql = format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY updated_at DESC");
        let mut statement = connection.prepare(sql.as_str())?;
        let tasks = statement
            .query_map([], task_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn list_project_tasks(&self, project_id: &str) -> Result<Vec<TaskDto>, AppError> {
        let connection = self.connection.lock();
        let sql = format!(
            "SELECT {TASK_COLUMNS} FROM tasks WHERE project_id=?1 ORDER BY updated_at DESC"
        );
        let mut statement = connection.prepare(sql.as_str())?;
        let tasks = statement
            .query_map([project_id], task_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn rename_task(&self, id: &str, title: &str) -> Result<TaskDto, AppError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::new("invalid_title", "任务标题不能为空", true));
        }
        self.connection.lock().execute(
            "UPDATE tasks SET title=?1, updated_at=?2 WHERE id=?3",
            params![title, chrono::Utc::now().to_rfc3339(), id],
        )?;
        self.get_task(id)
    }

    pub fn set_task_model_override(
        &self,
        id: &str,
        model: Option<&str>,
    ) -> Result<TaskDto, AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET model_override=?1, updated_at=?2 WHERE id=?3",
            params![model, chrono::Utc::now().to_rfc3339(), id],
        )?;
        self.get_task(id)
    }

    pub fn set_task_permission_mode_override(
        &self,
        id: &str,
        mode: Option<TaskPermissionMode>,
    ) -> Result<TaskDto, AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET permission_mode_override=?1, updated_at=?2 WHERE id=?3",
            params![
                mode.as_ref().map(TaskPermissionMode::as_str),
                chrono::Utc::now().to_rfc3339(),
                id
            ],
        )?;
        self.get_task(id)
    }

    pub fn delete_task(&self, id: &str) -> Result<(), AppError> {
        let task = self.get_task(id)?;
        if task.status.is_active() {
            return Err(AppError::new("task_active", "请先停止正在运行的任务", true));
        }
        self.connection
            .lock()
            .execute("DELETE FROM tasks WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn transition_task(&self, id: &str, status: TaskStatus) -> Result<TaskDto, AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET status=?1, updated_at=?2 WHERE id=?3",
            params![status.as_str(), chrono::Utc::now().to_rfc3339(), id],
        )?;
        self.get_task(id)
    }

    pub fn update_task_session(&self, id: &str, session_id: &str) -> Result<(), AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET claude_session_id=?1, updated_at=?2 WHERE id=?3",
            params![session_id, chrono::Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn recover_interrupted_tasks(&self) -> Result<usize, AppError> {
        Ok(self.connection.lock().execute(
            "UPDATE tasks SET status='interrupted', updated_at=?1 WHERE status IN ('starting','running','awaiting_permission','stopping')",
            [chrono::Utc::now().to_rfc3339()],
        )?)
    }

    pub fn append_event(&self, event: &TaskEvent) -> Result<i64, AppError> {
        let payload = serde_json::to_string(&event.payload)?;
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO events(task_id,run_id,sequence,kind,payload_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![event.task_id, event.run_id, event.sequence, event.payload.kind(), payload, event.created_at],
        ).map_err(|error| {
            if matches!(&error, rusqlite::Error::SqliteFailure(inner, _) if inner.code == rusqlite::ErrorCode::ConstraintViolation) {
                AppError::new("duplicate_event_sequence", "事件序号重复", false)
            } else { error.into() }
        })?;
        Ok(connection.last_insert_rowid())
    }

    pub fn list_events(
        &self,
        task_id: &str,
        offset: u64,
        limit: u64,
    ) -> Result<Vec<TaskEvent>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT task_id,run_id,sequence,created_at,payload_json FROM events WHERE task_id=?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement.query_map(params![task_id, limit.min(5000), offset], |row| {
            let payload_json: String = row.get(4)?;
            let payload: TaskEventPayload =
                serde_json::from_str(&payload_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            Ok(TaskEvent {
                version: 1,
                task_id: row.get(0)?,
                run_id: row.get(1)?,
                sequence: row.get(2)?,
                created_at: row.get(3)?,
                payload,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn load_settings(&self) -> Result<AppSettingsDto, AppError> {
        let value: Option<String> = self
            .connection
            .lock()
            .query_row(
                "SELECT value_json FROM settings WHERE key='app'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match value {
            Some(value) => Ok(serde_json::from_str(&value)?),
            None => Ok(AppSettingsDto::default()),
        }
    }

    pub fn save_settings(&self, settings: &AppSettingsDto) -> Result<AppSettingsDto, AppError> {
        if !(220..=440).contains(&settings.sidebar_width) {
            return Err(AppError::new(
                "invalid_sidebar_width",
                "侧栏宽度必须在 220–440 像素之间",
                true,
            ));
        }
        self.connection.lock().execute(
            "INSERT INTO settings(key,value_json,updated_at) VALUES('app',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
            params![serde_json::to_string(settings)?, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(settings.clone())
    }
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectDto> {
    Ok(ProjectDto {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        created_at: row.get(3)?,
        last_opened_at: row.get(4)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskDto> {
    let status: String = row.get(4)?;
    let permission_mode_override: Option<String> = row.get(6)?;
    Ok(TaskDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        claude_session_id: row.get(3)?,
        status: TaskStatus::parse(&status),
        model_override: row.get(5)?,
        permission_mode_override: permission_mode_override
            .as_deref()
            .and_then(TaskPermissionMode::parse),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
