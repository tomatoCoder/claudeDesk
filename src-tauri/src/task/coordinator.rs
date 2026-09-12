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
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use crate::{
    bridge,
    claude::diagnose,
    diagnostics::LogStore,
    domain::{AppPermissionMode, CliDiagnosticStatus, PermissionDecisionKind, QueuedTurnDto, QueuedTurnsChanged, RunAccepted, TaskEvent, TaskEventPayload, TaskStatus, TurnSubmission, UserQuestion},
    error::AppError,
    permission::{PermissionDecision, PermissionHub, PermissionRequest},
    settings::SettingsRepository,
    storage::Storage,
};

use super::{event_sink::publish, turn_queue::{should_auto_start, TurnQueue}};

#[derive(Clone)]
pub struct TaskCoordinator {
    storage: Storage,
    #[allow(dead_code)]
    logs: LogStore,
    permissions: PermissionHub,
    settings: SettingsRepository,
    state: Arc<Mutex<CoordinatorState>>,
}

#[derive(Default)]
struct CoordinatorState {
    running: HashMap<String, RunningTask>,
    queued_turns: TurnQueue,
}

#[derive(Clone)]
struct RunningTask {
    project_id: String,
    run_id: String,
    cancellation: CancellationToken,
    controls: mpsc::UnboundedSender<RunControl>,
    sequence: Arc<AtomicU64>,
}

enum RunControl {
    Adjust {
        adjustment_id: String,
        text: String,
        reply: oneshot::Sender<Result<(), AppError>>,
    },
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
            state: Default::default(),
        }
    }

    pub fn send_turn(
        &self,
        app: AppHandle,
        task_id: String,
        prompt: String,
    ) -> Result<RunAccepted, AppError> {
        match self.submit_turn(app, task_id, prompt)? {
            TurnSubmission::Started { run_id } => Ok(RunAccepted { run_id }),
            TurnSubmission::Queued { .. } => Err(AppError::new("task_already_running", "该会话正在运行", true)),
        }
    }

    pub fn submit_turn(
        &self,
        app: AppHandle,
        task_id: String,
        prompt: String,
    ) -> Result<TurnSubmission, AppError> {
        let prompt = prompt.trim().to_string();
        validate_prompt(&prompt)?;
        let task = self.storage.get_task(&task_id)?;
        {
            let mut state = self.state.lock();
            if state.running.contains_key(&task_id) {
                let queued_turn = state.queued_turns.push(&task_id, &prompt);
                drop(state);
                self.publish_queued_turns(&app, &task_id)?;
                return Ok(TurnSubmission::Queued { queued_turn });
            }
        }
        self.start_turn(app, task, prompt)
    }

    fn start_turn(
        &self,
        app: AppHandle,
        task: crate::domain::TaskDto,
        prompt: String,
    ) -> Result<TurnSubmission, AppError> {
        let task_id = task.id.clone();
        let project = self.storage.get_project(&task.project_id)?;
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
        let (controls, control_receiver) = mpsc::unbounded_channel();
        let mut state = self.state.lock();
        if state.running.contains_key(&task_id) {
            let queued_turn = state.queued_turns.push(&task_id, &prompt);
            drop(state);
            self.publish_queued_turns(&app, &task_id)?;
            return Ok(TurnSubmission::Queued { queued_turn });
        }
        let conflicts = state
            .running
            .iter()
            .filter(|(_, running)| running.project_id == task.project_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        state.running.insert(
            task_id.clone(),
            RunningTask { project_id: task.project_id.clone(), run_id: run_id.clone(), cancellation: cancellation.clone(), controls, sequence: sequence.clone() },
        );
        drop(state);
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
        let returned_run_id = run_id.clone();
        spawn_background(async move {
            let status = match coordinator.run(
                app.clone(),
                task_id.clone(),
                run_id.clone(),
                project.path.into(),
                executable,
                task.claude_session_id,
                prompt,
                sequence,
                cancellation.clone(),
                control_receiver,
            ).await {
                Ok(status) => status,
                Err(error) => {
                    let status = if cancellation.is_cancelled() { TaskStatus::Interrupted } else { TaskStatus::Failed };
                    let _ = publish(&coordinator.storage, &app, TaskEvent::new(&task_id, &run_id, next(&error_sequence), TaskEventPayload::Error { code: error.code, message: error.message, recoverable: error.recoverable }));
                    status
                }
            };
            let _ = coordinator.storage.transition_task(&task_id, status.clone());
            let _ = publish_status(&coordinator.storage, &app, &task_id, &run_id, &error_sequence, status.clone());
            let should_start_next = should_auto_start(&status);
            {
                let mut state = coordinator.state.lock();
                if state.running.get(&task_id).is_some_and(|running| running.run_id == run_id) {
                    state.running.remove(&task_id);
                }
            }
            coordinator.permissions.clear_task(&task_id);
            if should_start_next {
                let _ = coordinator.start_next_if_idle(app.clone(), &task_id);
            }
        });
        Ok(TurnSubmission::Started { run_id: returned_run_id })
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
        mut controls: mpsc::UnboundedReceiver<RunControl>,
    ) -> Result<TaskStatus, AppError> {
        let (mut receiver, mut child) = bridge::spawn_worker(&app)?;
        let managed = self.settings.load()?.values;
        let permission_mode = self.storage.load_settings()?.permission_mode;
        let start = build_run_start(&run_id, &executable, &cwd, &prompt, session_id.as_deref(), &managed.model, permission_mode);
        write_control(&mut child, &start)?;

        let mut buffer = Vec::new();
        let mut stderr = Vec::new();
        let mut last_bridge_sequence = 0_u64;
        let mut stopping = false;
        let mut pending_adjustments: HashMap<String, oneshot::Sender<Result<(), AppError>>> = HashMap::new();
        loop {
            let event = if stopping {
                match tokio::time::timeout(Duration::from_secs(2), receiver.recv()).await {
                    Ok(event) => event,
                    Err(_) => {
                        let _ = child.kill();
                        return Ok(TaskStatus::Interrupted);
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
                    Some(control) = controls.recv() => {
                        let RunControl::Adjust { adjustment_id, text, reply } = control;
                        write_control(&mut child, &json!({
                            "v": 1,
                            "type": "run.adjust",
                            "runId": run_id,
                            "adjustmentId": adjustment_id,
                            "text": text,
                        }))?;
                        pending_adjustments.insert(adjustment_id, reply);
                        continue;
                    }
                    event = receiver.recv() => event,
                }
            };
            let Some(event) = event else {
                if stopping {
                    return Ok(TaskStatus::Interrupted);
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
                        if let Some(reply) = take_adjustment_reply(&mut pending_adjustments, &value) {
                            let _ = reply.send(adjustment_result(&value));
                            continue;
                        }
                        if let Some(status) = self.handle_worker_event(&app, &task_id, &run_id, &sequence, &mut child, value).await? {
                            return Ok(status);
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
                        return Ok(TaskStatus::Interrupted);
                    }
                    if status.code != Some(0) {
                        return Err(bridge::bridge_exit_error(status.code, &stderr));
                    }
                    return Ok(TaskStatus::Completed);
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

    fn publish_queued_turns(&self, app: &AppHandle, task_id: &str) -> Result<(), AppError> {
        let queued_turns = self.state.lock().queued_turns.list(task_id);
        app.emit("queued-turns-changed", QueuedTurnsChanged { task_id: task_id.into(), queued_turns })
            .map_err(|error| AppError::new("event_emit_failed", error.to_string(), true))
    }

    pub fn list_queued_turns(&self, task_id: &str) -> Result<Vec<QueuedTurnDto>, AppError> {
        Ok(self.state.lock().queued_turns.list(task_id))
    }

    pub fn update_queued_turn(&self, app: &AppHandle, task_id: &str, id: &str, prompt: String) -> Result<QueuedTurnDto, AppError> {
        let prompt = prompt.trim().to_string();
        validate_prompt(&prompt)?;
        let turn = self.state.lock().queued_turns.update(task_id, id, &prompt)
            .ok_or_else(|| AppError::new("queued_turn_not_found", "等待消息不存在", true))?;
        self.publish_queued_turns(app, task_id)?;
        Ok(turn)
    }

    pub fn delete_queued_turn(&self, app: &AppHandle, task_id: &str, id: &str) -> Result<(), AppError> {
        self.state.lock().queued_turns.remove(task_id, id)
            .ok_or_else(|| AppError::new("queued_turn_not_found", "等待消息不存在", true))?;
        self.publish_queued_turns(app, task_id)
    }

    pub async fn adjust_queued_turn(&self, app: &AppHandle, task_id: &str, id: &str) -> Result<(), AppError> {
        let (turn, index, running) = {
            let mut state = self.state.lock();
            let running = state.running.get(task_id).cloned()
                .ok_or_else(|| AppError::new("task_not_running", "该会话当前未运行", true))?;
            let status = self.storage.get_task(task_id)?.status;
            if !matches!(status, TaskStatus::Starting | TaskStatus::Running) {
                return Err(AppError::new("adjustment_unavailable", "当前状态不能调整方向", true));
            }
            let (turn, index) = state.queued_turns.take(task_id, id)
                .ok_or_else(|| AppError::new("queued_turn_not_found", "等待消息不存在", true))?;
            (turn, index, running)
        };
        let (reply, response) = oneshot::channel();
        let control = RunControl::Adjust { adjustment_id: uuid::Uuid::new_v4().to_string(), text: turn.text.clone(), reply };
        let result = match running.controls.send(control) {
            Ok(()) => response.await.unwrap_or_else(|_| Err(AppError::new("run_finished", "当前任务已经结束", true))),
            Err(_) => Err(AppError::new("run_finished", "当前任务已经结束", true)),
        };
        match result {
            Ok(()) => {
                publish(&self.storage, app, TaskEvent::new(task_id, &running.run_id, next(&running.sequence), TaskEventPayload::UserMessage { text: turn.text }))?;
                self.publish_queued_turns(app, task_id)
            }
            Err(error) => {
                self.state.lock().queued_turns.restore(task_id, index, turn);
                self.publish_queued_turns(app, task_id)?;
                Err(error)
            }
        }
    }

    pub async fn send_queued_turn(&self, app: AppHandle, task_id: String, id: String) -> Result<RunAccepted, AppError> {
        let (turn, index) = {
            let mut state = self.state.lock();
            if state.running.contains_key(&task_id) {
                return Err(AppError::new("task_already_running", "该会话正在运行", true));
            }
            state.queued_turns.take(&task_id, &id)
                .ok_or_else(|| AppError::new("queued_turn_not_found", "等待消息不存在", true))?
        };
        let task = self.storage.get_task(&task_id)?;
        match self.start_turn(app.clone(), task, turn.text.clone()) {
            Ok(TurnSubmission::Started { run_id }) => {
                self.publish_queued_turns(&app, &task_id)?;
                Ok(RunAccepted { run_id })
            }
            Ok(TurnSubmission::Queued { .. }) | Err(_) => {
                self.state.lock().queued_turns.restore(&task_id, index, turn);
                self.publish_queued_turns(&app, &task_id)?;
                Err(AppError::new("queued_turn_start_failed", "等待消息未能启动", true))
            }
        }
    }

    fn start_next_if_idle(&self, app: AppHandle, task_id: &str) -> Result<(), AppError> {
        let claimed = {
            let mut state = self.state.lock();
            if state.running.contains_key(task_id) { return Ok(()); }
            state.queued_turns.take_front(task_id)
        };
        let Some((turn, index)) = claimed else { return Ok(()); };
        let task = self.storage.get_task(task_id)?;
        if self.start_turn(app.clone(), task, turn.text.clone()).is_err() {
            self.state.lock().queued_turns.restore(task_id, index, turn);
        }
        self.publish_queued_turns(&app, task_id)
    }

    pub fn cancel(&self, task_id: &str) -> Result<(), AppError> {
        let Some(running) = self.state.lock().running.get(task_id).cloned() else {
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
        self.state.lock().running.keys().cloned().collect()
    }
}

fn build_run_start(
    run_id: &str,
    executable: &std::path::Path,
    cwd: &std::path::Path,
    prompt: &str,
    session_id: Option<&str>,
    model: &str,
    permission_mode: AppPermissionMode,
) -> Value {
    let mut start = json!({
        "v": 1,
        "type": "run.start",
        "requestId": uuid::Uuid::new_v4().to_string(),
        "runId": run_id,
        "claudePath": executable,
        "cwd": cwd,
        "prompt": prompt,
    });
    if let Some(session_id) = session_id {
        start["sessionId"] = Value::String(session_id.into());
    } else if !model.trim().is_empty() {
        start["model"] = Value::String(model.into());
    }
    if let Some(mode) = bridge_permission_mode(permission_mode) {
        start["permissionMode"] = Value::String(mode.into());
    }
    start
}

fn bridge_permission_mode(mode: AppPermissionMode) -> Option<&'static str> {
    match mode {
        AppPermissionMode::Default => None,
        AppPermissionMode::Auto => Some("auto"),
        AppPermissionMode::Bypass => Some("bypassPermissions"),
    }
}

fn validate_prompt(prompt: &str) -> Result<(), AppError> {
    if prompt.trim().is_empty() {
        return Err(AppError::new("empty_prompt", "消息不能为空", true));
    }
    if prompt.len() > 200_000 {
        return Err(AppError::new("prompt_too_large", "消息长度超过 200,000 个字符", true));
    }
    Ok(())
}

fn take_adjustment_reply(
    pending: &mut HashMap<String, oneshot::Sender<Result<(), AppError>>>,
    value: &Value,
) -> Option<oneshot::Sender<Result<(), AppError>>> {
    match value.get("type").and_then(Value::as_str) {
        Some("run.adjust.accepted") | Some("run.adjust.rejected") => value
            .get("adjustmentId")
            .and_then(Value::as_str)
            .and_then(|id| pending.remove(id)),
        _ => None,
    }
}

fn adjustment_result(value: &Value) -> Result<(), AppError> {
    if value.get("type").and_then(Value::as_str) == Some("run.adjust.accepted") {
        Ok(())
    } else {
        Err(AppError::new(
            "adjustment_rejected",
            value.get("reason").and_then(Value::as_str).unwrap_or("调整方向被拒绝"),
            true,
        ))
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
