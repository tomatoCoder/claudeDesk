use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

use super::{
    types::{BridgeFrame, PermissionDecision},
    PermissionHub, PermissionRequest,
};
use crate::{
    domain::{PermissionDecisionKind, TaskEvent, TaskEventPayload, TaskStatus, UserQuestion},
    error::AppError,
    storage::Storage,
    task::event_sink::publish,
};

pub async fn start_bridge(
    task_id: String,
    run_id: String,
    hub: PermissionHub,
    storage: Storage,
    app: AppHandle,
    sequence: Arc<AtomicU64>,
) -> Result<(SocketAddr, String), AppError> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let token = uuid::Uuid::new_v4().to_string();
    let expected_token = token.clone();
    let expected_run = run_id.clone();
    tokio::spawn(async move {
        if let Err(error) = serve(
            listener,
            task_id,
            expected_run,
            expected_token,
            hub,
            storage,
            app,
            sequence,
        )
        .await
        {
            eprintln!("Claude Desk permission bridge closed: {error}");
        }
    });
    Ok((addr, token))
}

async fn serve(
    listener: TcpListener,
    task_id: String,
    run_id: String,
    token: String,
    hub: PermissionHub,
    storage: Storage,
    app: AppHandle,
    sequence: Arc<AtomicU64>,
) -> Result<(), AppError> {
    let (stream, peer) = listener.accept().await?;
    if !peer.ip().is_loopback() {
        return Err(AppError::new(
            "bridge_peer_rejected",
            "权限桥只接受本机连接",
            false,
        ));
    }
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let Some(hello) = lines.next_line().await? else {
        return Err(AppError::new(
            "bridge_missing_hello",
            "权限桥未收到握手",
            false,
        ));
    };
    if hello.len() > 1024 * 1024 {
        return Err(AppError::new(
            "bridge_frame_too_large",
            "权限桥消息过大",
            false,
        ));
    }
    match serde_json::from_str::<BridgeFrame>(&hello)? {
        BridgeFrame::Hello {
            token: supplied,
            run_id: supplied_run,
        } if supplied == token && supplied_run == run_id => {}
        _ => {
            return Err(AppError::new(
                "bridge_auth_failed",
                "权限桥握手验证失败",
                false,
            ))
        }
    }

    while let Some(line) = lines.next_line().await? {
        if line.len() > 1024 * 1024 {
            return Err(AppError::new(
                "bridge_frame_too_large",
                "权限桥消息过大",
                false,
            ));
        }
        let BridgeFrame::Request {
            request_id,
            tool_name,
            input,
            suggestions,
        } = serde_json::from_str(&line)?
        else {
            continue;
        };
        storage.transition_task(&task_id, TaskStatus::AwaitingPermission)?;
        let payload = if tool_name == "AskUserQuestion" {
            let questions = input
                .get("questions")
                .cloned()
                .and_then(|value| serde_json::from_value::<Vec<UserQuestion>>(value).ok())
                .unwrap_or_default();
            TaskEventPayload::QuestionRequested {
                request_id: request_id.clone(),
                questions,
            }
        } else {
            TaskEventPayload::PermissionRequested {
                request_id: request_id.clone(),
                tool_name: tool_name.clone(),
                input: input.clone(),
                suggestions: suggestions.clone(),
            }
        };
        publish(
            &storage,
            &app,
            TaskEvent::new(&task_id, &run_id, next(&sequence), payload),
        )?;
        let decision = hub
            .request(PermissionRequest {
                task_id: task_id.clone(),
                request_id: request_id.clone(),
                tool_name,
                input,
                suggestions,
            })
            .await
            .unwrap_or_else(|error| PermissionDecision::Deny {
                message: error.message,
            });
        storage.transition_task(&task_id, TaskStatus::Running)?;
        let kind = match &decision {
            PermissionDecision::AllowOnce { .. } => PermissionDecisionKind::AllowOnce,
            PermissionDecision::AllowTask { .. } => PermissionDecisionKind::AllowTask,
            PermissionDecision::Deny { .. } => PermissionDecisionKind::Deny,
        };
        publish(
            &storage,
            &app,
            TaskEvent::new(
                &task_id,
                &run_id,
                next(&sequence),
                TaskEventPayload::PermissionResolved {
                    request_id: request_id.clone(),
                    decision: kind,
                },
            ),
        )?;
        let response = BridgeFrame::Decision {
            request_id,
            decision,
        };
        write
            .write_all(format!("{}\n", serde_json::to_string(&response)?).as_bytes())
            .await?;
        write.flush().await?;
    }
    Ok(())
}

fn next(sequence: &AtomicU64) -> u64 {
    sequence.fetch_add(1, Ordering::SeqCst) + 1
}
