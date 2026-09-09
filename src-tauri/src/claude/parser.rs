use crate::error::AppError;

const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub enum ParsedClaudeEvent {
    SessionStarted {
        session_id: String,
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
    Result {
        session_id: String,
        cost_usd: Option<f64>,
        turns: Option<u64>,
    },
    ApiRetry {
        attempt: u64,
        message: String,
    },
    Unknown(serde_json::Value),
}

#[derive(Default)]
pub struct StreamParser {
    buffer: Vec<u8>,
}

impl StreamParser {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<ParsedClaudeEvent>, AppError> {
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > MAX_LINE_BYTES && !self.buffer.contains(&b'\n') {
            return Err(AppError::new(
                "stream_line_too_large",
                "Claude 输出单行超过 2 MiB",
                false,
            ));
        }
        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=index).collect();
            let line = &line[..line.len().saturating_sub(1)];
            if line.len() > MAX_LINE_BYTES {
                return Err(AppError::new(
                    "stream_line_too_large",
                    "Claude 输出单行超过 2 MiB",
                    false,
                ));
            }
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            let value: serde_json::Value = serde_json::from_slice(line).map_err(|error| {
                AppError::new(
                    "invalid_stream_json",
                    format!("Claude 输出不是有效 JSON：{error}"),
                    true,
                )
            })?;
            events.extend(normalize(value));
        }
        Ok(events)
    }

    pub fn finish(&mut self) -> Result<Vec<ParsedClaudeEvent>, AppError> {
        if self.buffer.iter().any(|byte| !byte.is_ascii_whitespace()) {
            return Err(AppError::new(
                "stream_truncated",
                "Claude 输出在一条 JSON 消息中间结束",
                true,
            ));
        }
        self.buffer.clear();
        Ok(Vec::new())
    }
}

fn normalize(value: serde_json::Value) -> Vec<ParsedClaudeEvent> {
    let event_type = value
        .get("type")
        .and_then(|item| item.as_str())
        .unwrap_or_default();
    match event_type {
        "system" if value.get("subtype").and_then(|item| item.as_str()) == Some("init") => value
            .get("session_id")
            .and_then(|item| item.as_str())
            .map(|session_id| {
                vec![ParsedClaudeEvent::SessionStarted {
                    session_id: session_id.into(),
                }]
            })
            .unwrap_or_else(|| vec![ParsedClaudeEvent::Unknown(value)]),
        "stream_event" => {
            let message_id = value
                .get("uuid")
                .and_then(|item| item.as_str())
                .unwrap_or("assistant")
                .to_string();
            let event = value.get("event").cloned().unwrap_or_default();
            if event.get("type").and_then(|item| item.as_str()) == Some("content_block_delta") {
                if let Some(text) = event.pointer("/delta/text").and_then(|item| item.as_str()) {
                    return vec![ParsedClaudeEvent::AssistantDelta {
                        message_id,
                        text: text.into(),
                    }];
                }
            }
            vec![ParsedClaudeEvent::Unknown(value)]
        }
        "assistant" => {
            let message_id = value
                .get("uuid")
                .and_then(|item| item.as_str())
                .unwrap_or("assistant")
                .to_string();
            let mut result = Vec::new();
            if let Some(content) = value
                .pointer("/message/content")
                .and_then(|item| item.as_array())
            {
                let mut markdown = String::new();
                for block in content {
                    match block.get("type").and_then(|item| item.as_str()) {
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(|item| item.as_str()) {
                                markdown.push_str(text);
                            }
                        }
                        Some("tool_use") => result.push(ParsedClaudeEvent::ToolStarted {
                            tool_use_id: block
                                .get("id")
                                .and_then(|item| item.as_str())
                                .unwrap_or_default()
                                .into(),
                            tool_name: block
                                .get("name")
                                .and_then(|item| item.as_str())
                                .unwrap_or("Tool")
                                .into(),
                            input: block
                                .get("input")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null),
                        }),
                        _ => {}
                    }
                }
                if !markdown.is_empty() {
                    result.push(ParsedClaudeEvent::AssistantMessage {
                        message_id,
                        markdown,
                    });
                }
            }
            if result.is_empty() {
                result.push(ParsedClaudeEvent::Unknown(value));
            }
            result
        }
        "user" => {
            let mut result = Vec::new();
            if let Some(content) = value
                .pointer("/message/content")
                .and_then(|item| item.as_array())
            {
                for block in content.iter().filter(|block| {
                    block.get("type").and_then(|item| item.as_str()) == Some("tool_result")
                }) {
                    result.push(ParsedClaudeEvent::ToolFinished {
                        tool_use_id: block
                            .get("tool_use_id")
                            .and_then(|item| item.as_str())
                            .unwrap_or_default()
                            .into(),
                        output: block
                            .get("content")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null),
                        is_error: block
                            .get("is_error")
                            .and_then(|item| item.as_bool())
                            .unwrap_or(false),
                    });
                }
            }
            if result.is_empty() {
                result.push(ParsedClaudeEvent::Unknown(value));
            }
            result
        }
        "result" => vec![ParsedClaudeEvent::Result {
            session_id: value
                .get("session_id")
                .and_then(|item| item.as_str())
                .unwrap_or_default()
                .into(),
            cost_usd: value.get("total_cost_usd").and_then(|item| item.as_f64()),
            turns: value.get("num_turns").and_then(|item| item.as_u64()),
        }],
        "system" if value.get("subtype").and_then(|item| item.as_str()) == Some("api_retry") => {
            vec![ParsedClaudeEvent::ApiRetry {
                attempt: value
                    .get("attempt")
                    .and_then(|item| item.as_u64())
                    .unwrap_or_default(),
                message: value
                    .get("message")
                    .and_then(|item| item.as_str())
                    .unwrap_or("Claude API 正在重试")
                    .into(),
            }]
        }
        _ => vec![ParsedClaudeEvent::Unknown(value)],
    }
}
