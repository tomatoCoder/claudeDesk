use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum PermissionDecision {
    AllowOnce {
        updated_input: serde_json::Value,
    },
    AllowTask {
        updated_input: serde_json::Value,
        rule: String,
    },
    Deny {
        message: String,
    },
}

#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub task_id: String,
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeFrame {
    Hello {
        token: String,
        run_id: String,
    },
    Request {
        request_id: String,
        tool_name: String,
        input: serde_json::Value,
        #[serde(default)]
        suggestions: Vec<String>,
    },
    Decision {
        request_id: String,
        decision: PermissionDecision,
    },
    Shutdown,
}
