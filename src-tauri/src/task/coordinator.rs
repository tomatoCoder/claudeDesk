use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use tokio_util::sync::CancellationToken;

use crate::{
    claude::{diagnose, ClaudeInvocation, ParsedClaudeEvent, StreamParser},
    diagnostics::LogStore,
    domain::{CliDiagnosticStatus, RunAccepted, TaskEvent, TaskEventPayload, TaskStatus},
    error::AppError,
    permission::{start_bridge, PermissionHub, TemporaryMcpConfig},
    process::{configure_process_group, terminate_process_tree},
    storage::Storage,
};

use super::event_sink::publish;

#[derive(Clone)]
pub struct TaskCoordinator {
    storage: Storage,
    logs: LogStore,
    permissions: PermissionHub,
    running: Arc<Mutex<HashMap<String, RunningTask>>>,
}

#[derive(Clone)]
struct RunningTask {
    project_id: String,
    cancellation: CancellationToken,
}

impl TaskCoordinator {
    pub fn new(storage: Storage, logs: LogStore, permissions: PermissionHub) -> Self {
        Self {
            storage,
            logs,
            permissions,
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
            return Err(AppError::new(
                "prompt_too_large",
                "消息长度超过 200,000 个字符",
                true,
            ));
        }
        let task = self.storage.get_task(&task_id)?;
        let project = self.storage.get_project(&task.project_id)?;
        if self.running.lock().contains_key(&task_id) {
            return Err(AppError::new(
                "task_already_running",
                "该任务正在运行",
                true,
            ));
        }

        let settings = self.storage.load_settings()?;
        let cli = diagnose(settings.claude_path.as_deref())?;
        if cli.status != CliDiagnosticStatus::Ready {
            return Err(AppError::new("cli_not_ready", cli.message, true));
        }
        let executable = PathBuf::from(
            cli.path
                .ok_or_else(|| AppError::new("cli_not_found", "未找到 Claude Code CLI", true))?,
        );
        let run_id = uuid::Uuid::new_v4().to_string();
        let sequence = Arc::new(AtomicU64::new(0));
        let cancellation = CancellationToken::new();

        let conflicts: Vec<String> = self
            .running
            .lock()
            .iter()
            .filter(|(_, running)| running.project_id == task.project_id)
            .map(|(id, _)| id.clone())
            .collect();
        self.running.lock().insert(
            task_id.clone(),
            RunningTask {
                project_id: task.project_id.clone(),
                cancellation: cancellation.clone(),
            },
        );
        self.storage
            .transition_task(&task_id, TaskStatus::Starting)?;
        publish(
            &self.storage,
            &app,
            TaskEvent::new(
                &task_id,
                &run_id,
                next(&sequence),
                TaskEventPayload::UserMessage {
                    text: prompt.clone(),
                },
            ),
        )?;
        publish(
            &self.storage,
            &app,
            TaskEvent::new(
                &task_id,
                &run_id,
                next(&sequence),
                TaskEventPayload::StatusChanged {
                    status: TaskStatus::Starting,
                },
            ),
        )?;
        if !conflicts.is_empty() {
            let mut active_task_ids = conflicts;
            active_task_ids.push(task_id.clone());
            publish(
                &self.storage,
                &app,
                TaskEvent::new(
                    &task_id,
                    &run_id,
                    next(&sequence),
                    TaskEventPayload::WorkspaceConflict {
                        project_id: task.project_id.clone(),
                        active_task_ids,
                    },
                ),
            )?;
        }

        let coordinator = self.clone();
        let error_sequence = sequence.clone();
        let accepted = RunAccepted {
            run_id: run_id.clone(),
        };
        tokio::spawn(async move {
            if let Err(error) = coordinator
                .run(
                    app.clone(),
                    task_id.clone(),
                    run_id.clone(),
                    project.path.into(),
                    executable,
                    task.claude_session_id,
                    prompt,
                    sequence,
                    cancellation.clone(),
                )
                .await
            {
                let status = if cancellation.is_cancelled() {
                    TaskStatus::Interrupted
                } else {
                    TaskStatus::Failed
                };
                let _ = coordinator
                    .storage
                    .transition_task(&task_id, status.clone());
                let _ = publish(
                    &coordinator.storage,
                    &app,
                    TaskEvent::new(
                        &task_id,
                        &run_id,
                        next(&error_sequence),
                        TaskEventPayload::Error {
                            code: error.code,
                            message: error.message,
                            recoverable: error.recoverable,
                        },
                    ),
                );
                let _ = publish(
                    &coordinator.storage,
                    &app,
                    TaskEvent::new(
                        &task_id,
                        &run_id,
                        next(&error_sequence),
                        TaskEventPayload::StatusChanged { status },
                    ),
                );
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
        let (addr, token) = start_bridge(
            task_id.clone(),
            run_id.clone(),
            self.permissions.clone(),
            self.storage.clone(),
            app.clone(),
            sequence.clone(),
        )
        .await?;
        let mcp_config = TemporaryMcpConfig::create(addr, &token, &run_id)?;
        let invocation =
            ClaudeInvocation::new(prompt, session_id, Some(mcp_config.path().to_path_buf()));

        let mut command = Command::new(executable);
        command
            .args(invocation.args())
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);
        let mut child = command.spawn().map_err(|error| {
            AppError::new(
                "cli_spawn_failed",
                format!("无法启动 Claude Code：{error}"),
                true,
            )
        })?;
        let pid = child.id().ok_or_else(|| {
            AppError::new("cli_spawn_failed", "无法读取 Claude Code 进程 ID", true)
        })?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&invocation.stdin_message()).await?;
            stdin.shutdown().await?;
        }
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::new("cli_pipe_failed", "无法读取 Claude 标准输出", true))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::new("cli_pipe_failed", "无法读取 Claude 错误输出", true))?;

        self.storage
            .transition_task(&task_id, TaskStatus::Running)?;
        publish(
            &self.storage,
            &app,
            TaskEvent::new(
                &task_id,
                &run_id,
                next(&sequence),
                TaskEventPayload::StatusChanged {
                    status: TaskStatus::Running,
                },
            ),
        )?;

        let stdout_task = {
            let storage = self.storage.clone();
            let logs = self.logs.clone();
            let app = app.clone();
            let task_id = task_id.clone();
            let run_id = run_id.clone();
            let sequence = sequence.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut parser = StreamParser::default();
                let mut buffer = Vec::with_capacity(8192);
                loop {
                    buffer.clear();
                    let count = reader.read_until(b'\n', &mut buffer).await?;
                    if count == 0 {
                        break;
                    }
                    logs.append(&task_id, "stdout", &buffer)?;
                    for parsed in parser.push(&buffer)? {
                        handle_parsed(&storage, &app, &task_id, &run_id, &sequence, parsed)?;
                    }
                }
                parser.finish()?;
                Ok::<(), AppError>(())
            })
        };
        let stderr_task = {
            let logs = self.logs.clone();
            let task_id = task_id.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut buffer = Vec::with_capacity(4096);
                loop {
                    buffer.clear();
                    let count = reader.read_until(b'\n', &mut buffer).await?;
                    if count == 0 {
                        break;
                    }
                    logs.append(&task_id, "stderr", &buffer)?;
                }
                Ok::<(), AppError>(())
            })
        };

        let (cancelled, succeeded) = tokio::select! {
            _ = cancellation.cancelled() => {
                self.storage.transition_task(&task_id, TaskStatus::Stopping)?;
                let _ = publish(&self.storage, &app, TaskEvent::new(&task_id, &run_id, next(&sequence), TaskEventPayload::StatusChanged { status: TaskStatus::Stopping }));
                terminate_process_tree(pid).await?;
                (true, false)
            }
            status = child.wait() => {
                let status = status?;
                if !status.success() {
                    let code = status.code().map(|code| code.to_string()).unwrap_or_else(|| "signal".into());
                    let _ = publish(&self.storage, &app, TaskEvent::new(&task_id, &run_id, next(&sequence), TaskEventPayload::Error { code: "cli_exit_error".into(), message: format!("Claude Code 已退出（{code}）"), recoverable: true }));
                }
                (false, status.success())
            }
        };
        if cancelled {
            let _ = child.wait().await;
        }
        stdout_task
            .await
            .map_err(|error| AppError::new("stdout_reader_failed", error.to_string(), true))??;
        stderr_task
            .await
            .map_err(|error| AppError::new("stderr_reader_failed", error.to_string(), true))??;
        let final_status = if cancelled {
            TaskStatus::Interrupted
        } else if succeeded {
            TaskStatus::Completed
        } else {
            TaskStatus::Failed
        };
        self.storage
            .transition_task(&task_id, final_status.clone())?;
        publish(
            &self.storage,
            &app,
            TaskEvent::new(
                &task_id,
                &run_id,
                next(&sequence),
                TaskEventPayload::StatusChanged {
                    status: final_status,
                },
            ),
        )?;
        Ok(())
    }

    pub fn cancel(&self, task_id: &str) -> Result<(), AppError> {
        let Some(running) = self.running.lock().get(task_id).cloned() else {
            return Err(AppError::new("task_not_running", "该任务当前未运行", true));
        };
        running.cancellation.cancel();
        Ok(())
    }

    pub fn active_task_ids(&self) -> Vec<String> {
        self.running.lock().keys().cloned().collect()
    }
}

fn handle_parsed(
    storage: &Storage,
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
    sequence: &AtomicU64,
    parsed: ParsedClaudeEvent,
) -> Result<(), AppError> {
    let payload = match parsed {
        ParsedClaudeEvent::SessionStarted { session_id } => {
            storage.update_task_session(task_id, &session_id)?;
            return Ok(());
        }
        ParsedClaudeEvent::AssistantDelta { message_id, text } => {
            TaskEventPayload::AssistantDelta { message_id, text }
        }
        ParsedClaudeEvent::AssistantMessage {
            message_id,
            markdown,
        } => TaskEventPayload::AssistantMessage {
            message_id,
            markdown,
        },
        ParsedClaudeEvent::ToolStarted {
            tool_use_id,
            tool_name,
            input,
        } => TaskEventPayload::ToolStarted {
            tool_use_id,
            tool_name,
            input,
        },
        ParsedClaudeEvent::ToolFinished {
            tool_use_id,
            output,
            is_error,
        } => TaskEventPayload::ToolFinished {
            tool_use_id,
            output,
            is_error,
        },
        ParsedClaudeEvent::Result {
            session_id,
            cost_usd,
            turns,
        } => {
            if !session_id.is_empty() {
                storage.update_task_session(task_id, &session_id)?;
            }
            TaskEventPayload::Result {
                session_id,
                cost_usd,
                turns,
            }
        }
        ParsedClaudeEvent::ApiRetry { attempt, message } => TaskEventPayload::Error {
            code: "api_retry".into(),
            message: format!("{message}（第 {attempt} 次）"),
            recoverable: true,
        },
        ParsedClaudeEvent::Unknown(raw) => TaskEventPayload::Unknown { raw },
    };
    publish(
        storage,
        app,
        TaskEvent::new(task_id, run_id, next(sequence), payload),
    )
}

fn next(sequence: &AtomicU64) -> u64 {
    sequence.fetch_add(1, Ordering::SeqCst) + 1
}
