use claude_desk_lib::{bridge::event_to_payload, domain::TaskEventPayload};

#[test]
fn maps_sdk_bridge_delta_without_exposing_raw_sdk_shape() {
    let value = serde_json::json!({
        "v": 1,
        "type": "assistant.delta",
        "requestId": "request-1",
        "runId": "run-1",
        "sequence": 2,
        "messageId": "m1",
        "text": "你好"
    });
    assert_eq!(
        event_to_payload(&value).unwrap(),
        Some(TaskEventPayload::AssistantDelta {
            message_id: "m1".into(),
            text: "你好".into()
        })
    );
}

#[test]
fn unknown_bridge_events_are_ignored() {
    assert_eq!(
        event_to_payload(&serde_json::json!({ "v": 1, "type": "future.event" })).unwrap(),
        None
    );
}

#[test]
fn maps_local_command_output_to_a_timeline_event() {
    let value = serde_json::json!({
        "v": 1, "type": "local_command_output", "requestId": "r", "runId": "run-1",
        "sequence": 3, "content": "Available commands"
    });
    assert!(matches!(
        event_to_payload(&value).unwrap(),
        Some(TaskEventPayload::LocalCommandOutput { content }) if content == "Available commands"
    ));
}

#[test]
fn local_command_output_without_content_is_rejected() {
    let value = serde_json::json!({
        "v": 1, "type": "local_command_output", "requestId": "r", "runId": "run-1", "sequence": 3
    });
    assert!(event_to_payload(&value).is_err());
}
