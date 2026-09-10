use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio_util::sync::CancellationToken;

use crate::{
    bridge,
    claude::diagnose,
    diagnostics::LogStore,
    domain::{CliDiagnosticStatus, PermissionDecisionKind, RunAccepted, TaskEvent, TaskEventPayload, TaskStatus, UserQuestion},
    error::AppError,
    permission::{PermissionDecision, PermissionHub, PermissionRequest},
    settings::SettingsRepository,
    storage::Storage,
};

use super::event_sink::publish;

#[derive(Clone)]
pub struct TaskCoordinator {
    storage: Storage,
    #[allow(dead_code)]
    logs: LogStore,
    permissions: PermissionHub,
    settings: SettingsRepository,
    running: Arc<Mutex<HashMap<String, RunningTask>>>,
}

#[derive(Clone)]
struct RunningTask {
    project_id: String,
    cancellation: CancellationToken,
}

impl TaskCoordinator {
    pub fn new(
        storage: Storage,
        logs: LogStore,
        permissions: PermissionHub,
        settings: SettingsRepository,
    ) -> Self {
        Self {
            storage,
            logs,
            permissions,
            settings,
            running: Default::default(),
        }
    }

    pub fn send_turn(
        &self,
        app: AppHandle,
        task_id: String,
        prompt: String,
    ) -> Result<RunAccepted, AppError> {
        let prompt = prompt.trim().to_string();
        if prompt.is_empty() {
            return Err(AppError::new("empty_prompt", "消息不能为空", true));
        }
        if prompt.len() > 200_000 {
            return Err(AppError::new("prompt_too_large", "消息长度超过 200,000 个字符", true));
        }
        let task = self.storage.get_task(&task_id)?;
        let project = self.storage.get_project(&task.project_id)?;
        if self.running.lock().contains_key(&task_id) {
            return Err(AppError::new("task_already_running", "该会话正在运行", true));
        }
        let app_settings = self.storage.load_settings()?;
        let cli = diagnose(app_settings.claude_path.as_deref())?;
        if cli.status != CliDiagnosticStatus::Ready {
            return Err(AppError::new("cli_not_ready", cli.message, true));
        }
        let executable = PathBuf::from(cli.path.ok_or_else(|| {
            AppError::new("cli_not_found", "未找到 Claude Code CLI", true)
        })?);
        let run_id = uuid::Uuid::new_v4().to_string();
        let sequence = Arc::new(AtomicU64::new(0));
        let cancellation = CancellationToken::new();
        let conflicts = self
            .running
            .lock()
            .iter()
            .filter(|(_, running)| running.project_id == task.project_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        self.running.lock().insert(
            task_id.clone(),
            RunningTask { project_id: task.project_id.clone(), cancellation: cancellation.clone() },
        );
        self.storage.transition_task(&task_id, TaskStatus::Starting)?;
        publish(&self.storage, &app, TaskEvent::new(&task_id, &run_id, next(&sequence), TaskEventPayload::UserMessage { text: prompt.clone() }))?;
        publish_status(&self.storage, &app, &task_id, &run_id, &sequence, TaskStatus::Starting)?;
        if !conflicts.is_empty() {
            let mut active_task_ids = conflicts;
            active_task_ids.push(task_id.clone());
            publish(&self.storage, &app, TaskEvent::new(&task_id, &run_id, next(&sequence), TaskEventPayload::WorkspaceConflict { project_id: task.project_id.clone(), active_task_ids }))?;
        }

        let coordinator = self.clone();
        let error_sequence = sequence.clone();
        let accepted = RunAccepted { run_id: run_id.clone() };
        spawn_background(async move {
            if let Err(error) = coordinator.run(
                app.clone(),
                task_id.clone(),
                run_id.clone(),
                project.path.into(),
                executable,
                task.claude_session_id,
                prompt,
                sequence,
                cancellation.clone(),
            ).await {
                let status = if cancellation.is_cancelled() { TaskStatus::Interrupted } else { TaskStatus::Failed };
                let _ = coordinator.storage.transition_task(&task_id, status.clone());
                let _ = publish(&coordinator.storage, &app, TaskEvent::new(&task_id, &run_id, next(&error_sequence), TaskEventPayload::Error { code: error.code, message: error.message, recoverable: error.recoverable }));
                let _ = publish_status(&coordinator.storage, &app, &task_id, &run_id, &error_sequence, status);
            }
            coordinator.running.lock().remove(&task_id);
            coordinator.permissions.clear_task(&task_id);
        });
        Ok(accepted)
    }

    #[allow(clippy::too_many_arguments)]
    async fn run(
        &self,
        app: AppHandle,
        task_id: String,
        run_id: String,
        cwd: PathBuf,
        executable: PathBuf,
        session_id: Option<String>,
        prompt: String,
        sequence: Arc<AtomicU64>,
        cancellation: CancellationToken,
    ) -> Result<(), AppError> {
        let (mut receiver, mut child) = bridge::spawn_worker(&app)?;
        let managed = self.settings.load()?.values;
        let mut start = json!({
            "v": 1,
            "type": "run.start",
            "requestId": uuid::Uuid::new_v4().to_string(),
            "runId": run_id,
            "claudePath": executable,
            "cwd": cwd,
            "prompt": prompt,
        });
        if let Some(session_id) = session_id.as_deref() {
            start["sessionId"] = Value::String(session_id.into());
        } else if !managed.model.trim().is_empty() {
            start["model"] = Value::String(managed.model);
        }
        write_control(&mut child, &start)?;

        let mut buffer = Vec::new();
        let mut stderr = Vec::new();
        let mut last_bridge_sequence = 0_u64;
        let mut stopping = false;
        loop {
            let event = if stopping {
                match tokio::time::timeout(Duration::from_secs(2), receiver.recv()).await {
                    Ok(event) => event,
                    Err(_) => {
                        let _ = child.kill();
                        self.finish(&app, &task_id, &run_id, &sequence, TaskStatus::Interrupted)?;
                        return Ok(());
                    }
                }
            } else {
                tokio::select! {
                    _ = cancellation.cancelled() => {
                        stopping = true;
                        self.storage.transition_task(&task_id, TaskStatus::Stopping)?;
                        publish_status(&self.storage, &app, &task_id, &run_id, &sequence, TaskStatus::Stopping)?;
                        write_control(&mut child, &json!({ "v": 1, "type": "run.stop", "runId": run_id }))?;
                        continue;
                    }
                    event = receiver.recv() => event,
                }
            };
            let Some(event) = event else {
                if stopping {
                    self.finish(&app, &task_id, &run_id, &sequence, TaskStatus::Interrupted)?;
                    return Ok(());
                }
                return Err(bridge::bridge_exit_error(None, &stderr));
            };
            match event {
                CommandEvent::Stdout(bytes) => {
                    buffer.extend(bytes);
                    if buffer.len() > 4 * 1024 * 1024 {
                        return Err(AppError::new("bridge_line_too_large", "Bridge 单条事件超过 4 MiB", false));
                    }
                    while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
                        let line = buffer.drain(..=index).collect::<Vec<_>>();
                        let line = &line[..line.len().saturating_sub(1)];
                        if line.iter().all(u8::is_ascii_whitespace) { continue }
                        let value: Value = serde_json::from_slice(line).map_err(|error| AppError::new("bridge_invalid_json", error.to_string(), true))?;
                        if value.get("v").and_then(Value::as_u64) != Some(1) { continue }
                        if value.get("runId").and_then(Value::as_str).is_some_and(|id| id != run_id) { continue }
                        if let Some(received) = value.get("sequence").and_then(Value::as_u64) {
                            if received <= last_bridge_sequence { continue }
                            last_bridge_sequence = received;
                        }
                        if let Some(status) = self.handle_worker_event(&app, &task_id, &run_id, &sequence, &mut child, value).await? {
                            self.finish(&app, &task_id, &run_id, &sequence, status)?;
                            return Ok(());
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    const MAX_STDERR_BYTES: usize = 64 * 1024;
                    let remaining = MAX_STDERR_BYTES.saturating_sub(stderr.len());
                    stderr.extend(bytes.into_iter().take(remaining));
                }
                CommandEvent::Error(message) => return Err(AppError::new("bridge_process_error", message, true)),
                CommandEvent::Terminated(status) => {
                    if stopping {
                        self.finish(&app, &task_id, &run_id, &sequence, TaskStatus::Interrupted)?;
                        return Ok(());
                    }
                    if status.code != Some(0) {
                        return Err(bridge::bridge_exit_error(status.code, &stderr));
                    }
                    self.finish(&app, &task_id, &run_id, &sequence, TaskStatus::Completed)?;
                    return Ok(());
                }
                _ => {}
            }
        }
    }

    async fn handle_worker_event(
        &self,
        app: &AppHandle,
        task_id: &str,
        run_id: &str,
        sequence: &AtomicU64,
        child: &mut CommandChild,
        value: Value,
    ) -> Result<Option<TaskStatus>, AppError> {
        match value.get("type").and_then(Value::as_str).unwrap_or_default() {
            "session.started" => {
                if let Some(session_id) = value.get("sessionId").and_then(Value::as_str) {
                    self.storage.update_task_session(task_id, session_id)?;
                }
            }
            "permission.requested" | "question.requested" => {
                self.resolve_worker_permission(app, task_id, run_id, sequence, child, &value).await?;
            }
            "run.status" => {
                let status = TaskStatus::parse(value.get("status").and_then(Value::as_str).unwrap_or("idle"));
                if matches!(status, TaskStatus::Completed | TaskStatus::Interrupted | TaskStatus::Failed) {
                    return Ok(Some(status));
                }
                self.storage.transition_task(task_id, status.clone())?;
                publish_status(&self.storage, app, task_id, run_id, sequence, status)?;
            }
            "run.error" => {
                if let Some(payload) = bridge::event_to_payload(&value)? {
                    publish(&self.storage, app, TaskEvent::new(task_id, run_id, next(sequence), payload))?;
                }
                return Ok(Some(TaskStatus::Failed));
            }
            _ => {
                if let Some(payload) = bridge::event_to_payload(&value)? {
                    if let TaskEventPayload::Result { session_id, .. } = &payload {
                        if !session_id.is_empty() { self.storage.update_task_session(task_id, session_id)?; }
                    }
                    publish(&self.storage, app, TaskEvent::new(task_id, run_id, next(sequence), payload))?;
                }
            }
        }
        Ok(None)
    }

    async fn resolve_worker_permission(
        &self,
        app: &AppHandle,
        task_id: &str,
        run_id: &str,
        sequence: &AtomicU64,
        child: &mut CommandChild,
        value: &Value,
    ) -> Result<(), AppError> {
        let request_id = value.get("permissionId").and_then(Value::as_str).ok_or_else(|| AppError::new("bridge_permission_invalid", "权限事件缺少 permissionId", true))?.to_string();
        let tool_name = value.get("toolName").and_then(Value::as_str).unwrap_or("Unknown").to_string();
        let input = value.get("input").cloned().unwrap_or_else(|| json!({}));
        let suggestions = value.get("suggestions").and_then(Value::as_array).cloned().unwrap_or_default();
        self.storage.transition_task(task_id, TaskStatus::AwaitingPermission)?;
        let payload = if value.get("type").and_then(Value::as_str) == Some("question.requested") {
            let questions = input.get("questions").cloned().and_then(|questions| serde_json::from_value::<Vec<UserQuestion>>(questions).ok()).unwrap_or_default();
            TaskEventPayload::QuestionRequested { request_id: request_id.clone(), questions }
        } else {
            TaskEventPayload::PermissionRequested { request_id: request_id.clone(), tool_name: tool_name.clone(), input: input.clone(), suggestions: suggestions.clone() }
        };
        publish(&self.storage, app, TaskEvent::new(task_id, run_id, next(sequence), payload))?;
        let decision = self.permissions.request(PermissionRequest {
            task_id: task_id.into(), request_id: request_id.clone(), tool_name, input, suggestions,
        }).await.unwrap_or_else(|error| PermissionDecision::Deny { message: error.message });
        let (kind, control) = match decision {
            PermissionDecision::AllowOnce { updated_input } => (PermissionDecisionKind::AllowOnce, json!({ "v": 1, "type": "permission.resolve", "runId": run_id, "permissionId": request_id, "behavior": "allow", "updatedInput": updated_input })),
            PermissionDecision::AllowTask { updated_input, permission_update } => (PermissionDecisionKind::AllowTask, json!({ "v": 1, "type": "permission.resolve", "runId": run_id, "permissionId": request_id, "behavior": "allow", "updatedInput": updated_input, "updatedPermissions": [permission_update] })),
            PermissionDecision::Deny { message } => (PermissionDecisionKind::Deny, json!({ "v": 1, "type": "permission.resolve", "runId": run_id, "permissionId": request_id, "behavior": "deny", "message": message })),
        };
        write_control(child, &control)?;
        publish(&self.storage, app, TaskEvent::new(task_id, run_id, next(sequence), TaskEventPayload::PermissionResolved { request_id, decision: kind }))?;
        self.storage.transition_task(task_id, TaskStatus::Running)?;
        publish_status(&self.storage, app, task_id, run_id, sequence, TaskStatus::Running)
    }

    fn finish(&self, app: &AppHandle, task_id: &str, run_id: &str, sequence: &AtomicU64, status: TaskStatus) -> Result<(), AppError> {
        self.storage.transition_task(task_id, status.clone())?;
        publish_status(&self.storage, app, task_id, run_id, sequence, status)
    }

    pub fn cancel(&self, task_id: &str) -> Result<(), AppError> {
        let Some(running) = self.running.lock().get(task_id).cloned() else {
            return Err(AppError::new("task_not_running", "该会话当前未运行", true));
        };
        running.cancellation.cancel();
        self.permissions.clear_task(task_id);
        Ok(())
    }

    pub fn cancel_all(&self) {
        let task_ids = self.active_task_ids();
        for task_id in task_ids {
            let _ = self.cancel(&task_id);
        }
    }

    pub fn active_task_ids(&self) -> Vec<String> {
        self.running.lock().keys().cloned().collect()
    }
}

fn write_control(child: &mut CommandChild, value: &Value) -> Result<(), AppError> {
    child.write(format!("{}\n", serde_json::to_string(value)?).as_bytes())
        .map_err(|error| AppError::new("bridge_write_failed", error.to_string(), true))
}

fn publish_status(storage: &Storage, app: &AppHandle, task_id: &str, run_id: &str, sequence: &AtomicU64, status: TaskStatus) -> Result<(), AppError> {
    publish(storage, app, TaskEvent::new(task_id, run_id, next(sequence), TaskEventPayload::StatusChanged { status }))
}

fn next(sequence: &AtomicU64) -> u64 {
    sequence.fetch_add(1, Ordering::SeqCst) + 1
}

fn spawn_background<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    let _ = tauri::async_runtime::spawn(future);
}

#[cfg(test)]
mod tests {
    use super::spawn_background;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn background_run_can_start_from_a_synchronous_ipc_thread() {
        let (sender, receiver) = mpsc::channel();

        spawn_background(async move {
            sender.send(()).unwrap();
        });

        receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("background future should run without a Tokio enter guard");
    }
}
