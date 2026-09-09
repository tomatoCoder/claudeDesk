use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Idle,
    Starting,
    Running,
    AwaitingPermission,
    Stopping,
    Completed,
    Interrupted,
    Failed,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::AwaitingPermission => "awaiting_permission",
            Self::Stopping => "stopping",
            Self::Completed => "completed",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "starting" => Self::Starting,
            "running" => Self::Running,
            "awaiting_permission" => Self::AwaitingPermission,
            "stopping" => Self::Stopping,
            "completed" => Self::Completed,
            "interrupted" => Self::Interrupted,
            "failed" => Self::Failed,
            _ => Self::Idle,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Running | Self::AwaitingPermission | Self::Stopping
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecisionKind {
    AllowOnce,
    AllowTask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestionOption {
    pub label: String,
    pub description: String,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestion {
    pub question: String,
    pub header: String,
    pub options: Vec<UserQuestionOption>,
    pub multi_select: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TaskEventPayload {
    UserMessage {
        text: String,
    },
    AssistantDelta {
        message_id: String,
        text: String,
    },
    AssistantMessage {
        message_id: String,
        markdown: String,
    },
    ToolStarted {
        tool_use_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
    ToolFinished {
        tool_use_id: String,
        output: serde_json::Value,
        is_error: bool,
    },
    PermissionRequested {
        request_id: String,
        tool_name: String,
        input: serde_json::Value,
        suggestions: Vec<String>,
    },
    PermissionResolved {
        request_id: String,
        decision: PermissionDecisionKind,
    },
    QuestionRequested {
        request_id: String,
        questions: Vec<UserQuestion>,
    },
    WorkspaceConflict {
        project_id: String,
        active_task_ids: Vec<String>,
    },
    StatusChanged {
        status: TaskStatus,
    },
    Result {
        session_id: String,
        cost_usd: Option<f64>,
        turns: Option<u64>,
    },
    Error {
        code: String,
        message: String,
        recoverable: bool,
    },
    Unknown {
        raw: serde_json::Value,
    },
}

impl TaskEventPayload {
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::UserMessage { .. } => "user_message",
            Self::AssistantDelta { .. } => "assistant_delta",
            Self::AssistantMessage { .. } => "assistant_message",
            Self::ToolStarted { .. } => "tool_started",
            Self::ToolFinished { .. } => "tool_finished",
            Self::PermissionRequested { .. } => "permission_requested",
            Self::PermissionResolved { .. } => "permission_resolved",
            Self::QuestionRequested { .. } => "question_requested",
            Self::WorkspaceConflict { .. } => "workspace_conflict",
            Self::StatusChanged { .. } => "status_changed",
            Self::Result { .. } => "result",
            Self::Error { .. } => "error",
            Self::Unknown { .. } => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub version: u8,
    pub task_id: String,
    pub run_id: String,
    pub sequence: u64,
    pub created_at: String,
    #[serde(flatten)]
    pub payload: TaskEventPayload,
}

impl TaskEvent {
    pub fn new(
        task_id: impl Into<String>,
        run_id: impl Into<String>,
        sequence: u64,
        payload: TaskEventPayload,
    ) -> Self {
        Self {
            version: 1,
            task_id: task_id.into(),
            run_id: run_id.into(),
            sequence,
            created_at: chrono::Utc::now().to_rfc3339(),
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub claude_session_id: Option<String>,
    pub status: TaskStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub claude_path: Option<String>,
    pub sidebar_width: u16,
}

impl Default for AppSettingsDto {
    fn default() -> Self {
        Self {
            claude_path: None,
            sidebar_width: 280,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CliDiagnosticStatus {
    Ready,
    NotFound,
    TooOld,
    ProbeFailed,
    NotAuthenticated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliDiagnosticDto {
    pub status: CliDiagnosticStatus,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub projects: Vec<ProjectDto>,
    pub tasks: Vec<TaskDto>,
    pub settings: AppSettingsDto,
    pub cli: CliDiagnosticDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAccepted {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiff {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
    pub patch: String,
    pub truncated: bool,
}
