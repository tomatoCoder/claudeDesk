use std::{path::PathBuf, time::Duration};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_shell::{process::{Command, CommandChild, CommandEvent}, ShellExt};

use crate::error::AppError;
use crate::domain::{TaskEventPayload, TaskStatus};

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const BRIDGE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn request(app: &AppHandle, payload: &Value) -> Result<Value, AppError> {
    let command = command(app)?.set_raw_out(true);

    let (mut receiver, mut child) = command
        .spawn()
        .map_err(|error| AppError::new("bridge_spawn_failed", error.to_string(), true))?;
    let line = format!("{}\n", serde_json::to_string(payload)?);
    child
        .write(line.as_bytes())
        .map_err(|error| AppError::new("bridge_write_failed", error.to_string(), true))?;

    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut stderr = Vec::new();
    loop {
        let event = tokio::time::timeout(BRIDGE_REQUEST_TIMEOUT, receiver.recv())
            .await
            .map_err(|_| AppError::new("bridge_timeout", "Agent Bridge 请求超时", true))?;
        let Some(event) = event else { break };
        match event {
            CommandEvent::Stdout(bytes) => {
                let size = chunks.iter().map(Vec::len).sum::<usize>() + bytes.len();
                if size > MAX_RESPONSE_BYTES {
                    let _ = child.kill();
                    return Err(AppError::new("bridge_response_too_large", "Bridge 响应超过 4 MiB", false));
                }
                let has_complete_event = bytes.contains(&b'\n');
                chunks.push(bytes);
                if has_complete_event {
                    let response = decode_single_event(chunks);
                    let _ = child.kill();
                    return response;
                }
            }
            CommandEvent::Stderr(bytes) => stderr.extend(bytes),
            CommandEvent::Error(message) => {
                return Err(AppError::new("bridge_process_error", redact(&message), true));
            }
            CommandEvent::Terminated(status) => {
                if status.code != Some(0) && chunks.is_empty() {
                    return Err(AppError::new(
                        "bridge_exit_error",
                        format!("Agent Bridge 异常退出：{}", redact(&String::from_utf8_lossy(&stderr))),
                        true,
                    ));
                }
                break;
            }
            _ => {}
        }
    }
    decode_single_event(chunks)
}

pub fn spawn_worker(
    app: &AppHandle,
) -> Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild), AppError> {
    command(app)?
        .set_raw_out(true)
        .spawn()
        .map_err(|error| AppError::new("bridge_spawn_failed", error.to_string(), true))
}

fn command(app: &AppHandle) -> Result<Command, AppError> {
    let command = if cfg!(debug_assertions) {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("bridge")
            .join("dist")
            .join("main.js");
        if !script.is_file() {
            return Err(AppError::new(
                "bridge_dev_build_missing",
                "缺少 Bridge 开发构建，请先运行 pnpm bridge:build:dev",
                true,
            ));
        }
        app.shell().command("node").arg(script)
    } else {
        app.shell()
            .sidecar("claude-agent-bridge")
            .map_err(|error| AppError::new("bridge_not_found", error.to_string(), true))?
    };
    Ok(command)
}

pub fn decode_single_event(chunks: Vec<Vec<u8>>) -> Result<Value, AppError> {
    let bytes = chunks.concat();
    let line = bytes
        .split(|byte| *byte == b'\n')
        .find(|line| line.iter().any(|byte| !byte.is_ascii_whitespace()))
        .ok_or_else(|| AppError::new("bridge_empty_response", "Bridge 没有返回事件", true))?;
    let value: Value = serde_json::from_slice(line).map_err(|error| {
        AppError::new("bridge_invalid_json", format!("Bridge 返回无效 JSON：{error}"), true)
    })?;
    if value.get("v").and_then(Value::as_u64) != Some(1) {
        return Err(AppError::new(
            "bridge_protocol_version",
            "Bridge 协议版本不兼容",
            false,
        ));
    }
    if value.get("type") == Some(&Value::String("bridge.error".into())) {
        return Err(AppError::new(
            value.get("code").and_then(Value::as_str).unwrap_or("bridge_error"),
            redact(value.get("message").and_then(Value::as_str).unwrap_or("Agent Bridge 执行失败")),
            value.get("recoverable").and_then(Value::as_bool).unwrap_or(true),
        ));
    }
    Ok(value)
}

fn redact(value: &str) -> String {
    let mut value = value.to_string();
    for marker in ["ANTHROPIC_AUTH_TOKEN=", "ANTHROPIC_AUTH_TOKEN:"] {
        value = redact_after_marker(&value, marker);
    }
    let mut result = String::with_capacity(value.len());
    for token in value.split_whitespace() {
        if token.starts_with("sk-") || token.len() > 40 && token.chars().all(|ch| ch.is_ascii_alphanumeric() || "_-".contains(ch)) {
            result.push_str("[REDACTED]");
        } else {
            result.push_str(token);
        }
        result.push(' ');
    }
    result.trim_end().to_string()
}

fn redact_after_marker(value: &str, marker: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(start) = remaining.find(marker) {
        result.push_str(&remaining[..start + marker.len()]);
        let secret = &remaining[start + marker.len()..];
        let secret_len = secret.find(char::is_whitespace).unwrap_or(secret.len());
        result.push_str("[REDACTED]");
        remaining = &secret[secret_len..];
    }
    result.push_str(remaining);
    result
}

pub fn bridge_exit_error(code: Option<i32>, stderr: &[u8]) -> AppError {
    let detail = redact(&String::from_utf8_lossy(stderr));
    let status = code.map_or_else(|| "未知状态".into(), |code| code.to_string());
    let message = if detail.trim().is_empty() {
        format!("Agent Bridge 异常退出（状态码 {status}）")
    } else {
        format!("Agent Bridge 异常退出（状态码 {status}）：{detail}")
    };
    AppError::new("bridge_exit_error", message, true)
}

pub fn event_to_payload(value: &Value) -> Result<Option<TaskEventPayload>, AppError> {
    let text = |key: &str| {
        value.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| {
            AppError::new("bridge_event_invalid", format!("Bridge 事件缺少 {key}"), true)
        })
    };
    let payload = match value.get("type").and_then(Value::as_str).unwrap_or_default() {
        "assistant.delta" => Some(TaskEventPayload::AssistantDelta {
            message_id: text("messageId")?,
            text: text("text")?,
        }),
        "assistant.message" => Some(TaskEventPayload::AssistantMessage {
            message_id: text("messageId")?,
            markdown: text("markdown")?,
        }),
        "tool.started" => Some(TaskEventPayload::ToolStarted {
            tool_use_id: text("toolUseId")?,
            tool_name: text("toolName")?,
            input: value.get("input").cloned().unwrap_or(Value::Null),
        }),
        "tool.finished" => Some(TaskEventPayload::ToolFinished {
            tool_use_id: text("toolUseId")?,
            output: value.get("output").cloned().unwrap_or(Value::Null),
            is_error: value.get("isError").and_then(Value::as_bool).unwrap_or(false),
        }),
        "run.result" => Some(TaskEventPayload::Result {
            session_id: value.get("sessionId").and_then(Value::as_str).unwrap_or_default().into(),
            cost_usd: value.get("costUsd").and_then(Value::as_f64),
            turns: value.get("turns").and_then(Value::as_u64),
        }),
        "run.retry" => Some(TaskEventPayload::Error {
            code: "api_retry".into(),
            message: value.get("message").and_then(Value::as_str).unwrap_or("Claude API 正在重试").into(),
            recoverable: true,
        }),
        "run.error" => Some(TaskEventPayload::Error {
            code: value.get("code").and_then(Value::as_str).unwrap_or("sdk_query_failed").into(),
            message: redact(value.get("message").and_then(Value::as_str).unwrap_or("Agent Bridge 执行失败")),
            recoverable: value.get("recoverable").and_then(Value::as_bool).unwrap_or(true),
        }),
        "run.status" => Some(TaskEventPayload::StatusChanged {
            status: TaskStatus::parse(value.get("status").and_then(Value::as_str).unwrap_or("idle")),
        }),
        _ => None,
    };
    Ok(payload)
}
