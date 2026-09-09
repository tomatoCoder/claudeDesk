use std::{ffi::OsString, path::Path};

pub struct ClaudeInvocation {
    prompt: String,
    session_id: Option<String>,
    mcp_config: Option<std::path::PathBuf>,
}

impl ClaudeInvocation {
    pub fn new(
        prompt: impl Into<String>,
        session_id: Option<String>,
        mcp_config: Option<std::path::PathBuf>,
    ) -> Self {
        Self {
            prompt: prompt.into(),
            session_id,
            mcp_config,
        }
    }

    pub fn args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        .into_iter()
        .map(Into::into)
        .collect();
        if let Some(session_id) = &self.session_id {
            args.extend(["--resume".into(), session_id.into()]);
        }
        if let Some(config) = &self.mcp_config {
            args.extend([
                "--permission-mode".into(),
                "default".into(),
                "--strict-mcp-config".into(),
                "--mcp-config".into(),
                config.as_os_str().into(),
                "--permission-prompt-tool".into(),
                "mcp__claude_desk_permissions__approve".into(),
            ]);
        } else {
            args.extend(["--permission-mode".into(), "dontAsk".into()]);
        }
        args
    }

    pub fn stdin_message(&self) -> Vec<u8> {
        let message = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": self.prompt },
            "parent_tool_use_id": null
        });
        format!("{message}\n").into_bytes()
    }

    pub fn mcp_config(&self) -> Option<&Path> {
        self.mcp_config.as_deref()
    }
}
