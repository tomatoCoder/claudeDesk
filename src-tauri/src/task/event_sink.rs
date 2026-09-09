use crate::{domain::TaskEvent, error::AppError, storage::Storage};
use tauri::{AppHandle, Emitter};

pub fn publish(storage: &Storage, app: &AppHandle, event: TaskEvent) -> Result<(), AppError> {
    storage.append_event(&event)?;
    app.emit("task-event", &event)
        .map_err(|error| AppError::new("event_emit_failed", error.to_string(), true))?;
    Ok(())
}
