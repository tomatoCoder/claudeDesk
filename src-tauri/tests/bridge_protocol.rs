use claude_desk_lib::bridge::{bridge_exit_error, decode_single_event};

#[test]
fn decodes_one_versioned_bridge_event_from_chunked_output() {
    let chunks = vec![
        br#"{"v":1,"type":"catalog."#.to_vec(),
        b"result\",\"requestId\":\"r1\",\"sessions\":[]}\n".to_vec(),
    ];
    let event = decode_single_event(chunks).unwrap();
    assert_eq!(event["type"], "catalog.result");
    assert_eq!(event["requestId"], "r1");
}

#[test]
fn rejects_wrong_protocol_version() {
    let error = decode_single_event(vec![b"{\"v\":2,\"type\":\"catalog.result\",\"requestId\":\"r1\"}\n".to_vec()]).unwrap_err();
    assert_eq!(error.code, "bridge_protocol_version");
}

#[test]
fn nonzero_bridge_exit_surfaces_a_redacted_diagnostic() {
    let error = bridge_exit_error(
        Some(1),
        b"ReferenceError: SharedArrayBuffer is not defined ANTHROPIC_AUTH_TOKEN=secret-value",
    );

    assert_eq!(error.code, "bridge_exit_error");
    assert!(error.message.contains("SharedArrayBuffer is not defined"));
    assert!(!error.message.contains("secret-value"));
}
