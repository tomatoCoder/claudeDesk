use crate::{commands::AppState, error::AppError, permission::PermissionDecision};
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub fn resolve_permission(
    task_id: String,
    request_id: String,
    decision: String,
    updated_input: serde_json::Value,
    rule: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    super::validate_id(&request_id)?;
    let decision = match decision.as_str() {
        "allow_once" => PermissionDecision::AllowOnce { updated_input },
        "allow_task" => {
            let rule = rule
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "missing_permission_rule",
                        "Claude 未提供可安全记忆的权限规则",
                        true,
                    )
                })?;
            PermissionDecision::AllowTask {
                updated_input,
                rule,
            }
        }
        "deny" => PermissionDecision::Deny {
            message: "用户拒绝了此操作".into(),
        },
        _ => {
            return Err(AppError::new(
                "invalid_permission_decision",
                "未知的权限决定",
                false,
            ))
        }
    };
    state.permissions.resolve(&task_id, &request_id, decision)
}
