fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args
        .iter()
        .any(|argument| argument == "--permission-helper")
    {
        claude_desk_lib::permission::run_permission_helper(&args);
        return;
    }
    claude_desk_lib::run();
}
