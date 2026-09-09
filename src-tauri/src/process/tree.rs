use crate::error::AppError;

pub fn configure_process_group(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}

pub async fn terminate_process_tree(pid: u32) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        tokio::time::sleep(std::time::Duration::from_millis(650)).await;
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        return Ok(());
    }
    #[cfg(windows)]
    {
        let status = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await?;
        if !status.success() {
            return Err(AppError::new(
                "process_tree_kill_failed",
                "无法终止 Claude 子进程树",
                true,
            ));
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}
