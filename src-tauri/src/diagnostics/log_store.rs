use crate::error::AppError;
use parking_lot::Mutex;
use std::{
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone)]
pub struct LogStore {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl LogStore {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, AppError> {
        std::fs::create_dir_all(root.as_ref())?;
        Ok(Self {
            root: Arc::new(root.as_ref().to_path_buf()),
            lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn append(&self, task_id: &str, stream: &str, bytes: &[u8]) -> Result<(), AppError> {
        validate_id(task_id)?;
        let _guard = self.lock.lock();
        let path = self.root.join(format!("{task_id}.log"));
        let mut existing = Vec::new();
        if let Ok(mut file) = std::fs::File::open(&path) {
            file.read_to_end(&mut existing)?;
        }
        existing.extend_from_slice(format!("[{stream}] ").as_bytes());
        existing.extend_from_slice(bytes);
        if !bytes.ends_with(b"\n") {
            existing.push(b'\n');
        }
        if existing.len() as u64 > MAX_LOG_BYTES {
            let keep = MAX_LOG_BYTES as usize;
            existing = existing[existing.len() - keep..].to_vec();
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        file.write_all(&existing)?;
        Ok(())
    }

    pub fn read(&self, task_id: &str) -> Result<String, AppError> {
        validate_id(task_id)?;
        let _guard = self.lock.lock();
        let path = self.root.join(format!("{task_id}.log"));
        if !path.exists() {
            return Ok(String::new());
        }
        let mut file = std::fs::File::open(path)?;
        let len = file.metadata()?.len();
        if len > MAX_LOG_BYTES {
            file.seek(SeekFrom::End(-(MAX_LOG_BYTES as i64)))?;
        }
        let mut text = String::new();
        file.read_to_string(&mut text)?;
        Ok(text)
    }
}

fn validate_id(value: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::new("invalid_identifier", "无效的任务标识", false))
}
