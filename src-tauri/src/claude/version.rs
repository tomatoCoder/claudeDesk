use crate::error::AppError;

pub const MINIMUM_CLAUDE_VERSION: semver::Version = semver::Version::new(2, 1, 112);

pub fn parse_version(output: &str) -> Result<semver::Version, AppError> {
    let token = output
        .split_whitespace()
        .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .ok_or_else(|| AppError::new("cli_probe_failed", "无法解析 Claude Code 版本", true))?;
    Ok(semver::Version::parse(token.trim_start_matches('v'))?)
}
