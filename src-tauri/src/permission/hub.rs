use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::oneshot;

use super::{
    grants::GrantCache,
    types::{PermissionDecision, PermissionRequest},
};
use crate::error::AppError;

#[derive(Clone)]
pub struct PermissionHub {
    pending: Arc<Mutex<HashMap<String, (String, oneshot::Sender<PermissionDecision>)>>>,
    grants: Arc<Mutex<GrantCache>>,
    timeout: Duration,
}

impl Default for PermissionHub {
    fn default() -> Self {
        Self::new(Duration::from_secs(300))
    }
}

impl PermissionHub {
    pub fn new(timeout: Duration) -> Self {
        Self {
            pending: Default::default(),
            grants: Default::default(),
            timeout,
        }
    }

    pub async fn request(
        &self,
        request: PermissionRequest,
    ) -> Result<PermissionDecision, AppError> {
        if let Some(permission_update) = self
            .grants
            .lock()
            .matches_any(&request.task_id, &request.suggestions)
        {
            return Ok(PermissionDecision::AllowTask {
                updated_input: request.input,
                permission_update,
            });
        }
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().insert(
            request.request_id.clone(),
            (request.task_id.clone(), sender),
        );
        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(decision)) => {
                if let PermissionDecision::AllowTask {
                    permission_update,
                    ..
                } = &decision
                {
                    if request.suggestions.contains(permission_update) {
                        self.grants
                            .lock()
                            .allow(&request.task_id, permission_update);
                    }
                }
                Ok(decision)
            }
            _ => {
                self.pending.lock().remove(&request.request_id);
                Ok(PermissionDecision::Deny {
                    message: "权限请求已超时".into(),
                })
            }
        }
    }

    pub fn resolve(
        &self,
        task_id: &str,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<(), AppError> {
        let mut pending = self.pending.lock();
        let Some((pending_task, _)) = pending.get(request_id) else {
            return Err(AppError::new(
                "permission_not_pending",
                "该权限请求已处理或已超时",
                true,
            ));
        };
        if pending_task != task_id {
            return Err(AppError::new(
                "permission_task_mismatch",
                "权限请求不属于当前任务",
                false,
            ));
        }
        let (_, sender) = pending
            .remove(request_id)
            .expect("pending request was checked above");
        drop(pending);
        sender.send(decision).map_err(|_| {
            AppError::new(
                "permission_channel_closed",
                "Claude 已不再等待这个决定",
                true,
            )
        })
    }

    pub fn clear_task(&self, task_id: &str) {
        self.pending
            .lock()
            .retain(|_, (pending_task, _)| pending_task != task_id);
        self.grants.lock().clear_task(task_id);
    }
}
