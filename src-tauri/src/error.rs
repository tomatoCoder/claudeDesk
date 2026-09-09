use serde::Serialize;

#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub correlation_id: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            correlation_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("CommandError", 4)?;
        state.serialize_field("code", &self.code)?;
        state.serialize_field("message", &self.message)?;
        state.serialize_field("recoverable", &self.recoverable)?;
        state.serialize_field("correlationId", &self.correlation_id)?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::new("io_error", value.to_string(), true)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        let code = match &value {
            rusqlite::Error::SqliteFailure(error, _)
                if error.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                "constraint_violation"
            }
            _ => "database_error",
        };
        Self::new(code, value.to_string(), true)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("invalid_json", value.to_string(), true)
    }
}

impl From<semver::Error> for AppError {
    fn from(value: semver::Error) -> Self {
        Self::new("invalid_version", value.to_string(), true)
    }
}
