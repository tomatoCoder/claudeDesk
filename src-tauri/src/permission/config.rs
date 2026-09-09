use std::{io::Write, net::SocketAddr, path::Path};
use tempfile::NamedTempFile;

use crate::error::AppError;

pub struct TemporaryMcpConfig {
    file: NamedTempFile,
}

impl TemporaryMcpConfig {
    pub fn create(addr: SocketAddr, token: &str, run_id: &str) -> Result<Self, AppError> {
        let executable = std::env::current_exe()?;
        let mut file = tempfile::Builder::new()
            .prefix("claude-desk-mcp-")
            .suffix(".json")
            .tempfile()?;
        let config = serde_json::json!({
            "mcpServers": {
                "claude_desk_permissions": {
                    "type": "stdio",
                    "command": executable,
                    "args": [
                        "--permission-helper",
                        "--bridge", addr.to_string(),
                        "--token", token,
                        "--run-id", run_id
                    ]
                }
            }
        });
        file.write_all(serde_json::to_string_pretty(&config)?.as_bytes())?;
        file.flush()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self { file })
    }

    pub fn path(&self) -> &Path {
        self.file.path()
    }
}
