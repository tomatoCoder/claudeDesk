use crate::{commands::AppState, error::AppError};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn confirm_app_exit(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.coordinator.cancel_all();
    tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
    app.exit(0);
    Ok(())
}
