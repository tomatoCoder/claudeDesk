use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

use super::types::{BridgeFrame, PermissionDecision};

pub fn run_permission_helper(args: &[String]) {
    if let Err(error) = run(args) {
        eprintln!("Claude Desk permission helper: {error}");
    }
}

fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let bridge = arg_value(args, "--bridge").ok_or("missing --bridge")?;
    let token = arg_value(args, "--token").ok_or("missing --token")?;
    let run_id = arg_value(args, "--run-id").ok_or("missing --run-id")?;
    let mut bridge_writer = TcpStream::connect(bridge)?;
    let mut bridge_reader = BufReader::new(bridge_writer.try_clone()?);
    writeln!(
        bridge_writer,
        "{}",
        serde_json::to_string(&BridgeFrame::Hello {
            token: token.into(),
            run_id: run_id.into()
        })?
    )?;
    bridge_writer.flush()?;

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request: serde_json::Value = serde_json::from_str(&line)?;
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request
            .get("method")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let result = match method {
            "initialize" => serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "claude-desk-permissions", "version": env!("CARGO_PKG_VERSION") }
            }),
            "tools/list" => serde_json::json!({ "tools": [{
                "name": "approve",
                "description": "Ask the Claude Desk user to approve or deny a Claude Code tool call.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_name": { "type": "string" },
                        "input": { "type": "object" },
                        "tool_use_id": { "type": ["string", "null"] },
                        "permission_suggestions": { "type": "array", "items": { "type": "string" }, "default": [] }
                    },
                    "required": ["tool_name", "input"]
                }
            }] }),
            "tools/call" => {
                let arguments = request
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let request_id = uuid::Uuid::new_v4().to_string();
                let tool_name = arguments
                    .get("tool_name")
                    .or_else(|| arguments.get("toolName"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let input = arguments
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let suggestions = arguments
                    .get("permission_suggestions")
                    .or_else(|| arguments.get("permissionSuggestions"))
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                writeln!(
                    bridge_writer,
                    "{}",
                    serde_json::to_string(&BridgeFrame::Request {
                        request_id: request_id.clone(),
                        tool_name,
                        input,
                        suggestions
                    })?
                )?;
                bridge_writer.flush()?;
                let mut response = String::new();
                bridge_reader.read_line(&mut response)?;
                let decision = match serde_json::from_str::<BridgeFrame>(&response)? {
                    BridgeFrame::Decision {
                        request_id: response_id,
                        decision,
                    } if response_id == request_id => decision,
                    _ => PermissionDecision::Deny {
                        message: "Invalid permission bridge response".into(),
                    },
                };
                let decision_json = match decision {
                    PermissionDecision::AllowOnce { updated_input }
                    | PermissionDecision::AllowTask { updated_input, .. } => {
                        serde_json::json!({ "behavior": "allow", "updatedInput": updated_input })
                    }
                    PermissionDecision::Deny { message } => {
                        serde_json::json!({ "behavior": "deny", "message": message })
                    }
                };
                serde_json::json!({ "content": [{ "type": "text", "text": decision_json.to_string() }], "isError": false })
            }
            _ => {
                let response = serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } });
                writeln!(stdout, "{response}")?;
                stdout.flush()?;
                continue;
            }
        };
        writeln!(
            stdout,
            "{}",
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result })
        )?;
        stdout.flush()?;
    }
    Ok(())
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|argument| argument == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}
