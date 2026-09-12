use std::collections::{HashMap, VecDeque};

use crate::domain::QueuedTurnDto;

use crate::domain::TaskStatus;

#[derive(Default)]
pub struct TurnQueue {
    by_task: HashMap<String, VecDeque<QueuedTurnDto>>,
}

impl TurnQueue {
    pub fn push(&mut self, task_id: &str, text: &str) -> QueuedTurnDto {
        let turn = QueuedTurnDto {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            text: text.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.by_task
            .entry(task_id.to_string())
            .or_default()
            .push_back(turn.clone());
        turn
    }

    pub fn list(&self, task_id: &str) -> Vec<QueuedTurnDto> {
        self.by_task
            .get(task_id)
            .map(|turns| turns.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn update(&mut self, task_id: &str, id: &str, text: &str) -> Option<QueuedTurnDto> {
        let turn = self
            .by_task
            .get_mut(task_id)?
            .iter_mut()
            .find(|turn| turn.id == id)?;
        turn.text = text.to_string();
        Some(turn.clone())
    }

    pub fn take(&mut self, task_id: &str, id: &str) -> Option<(QueuedTurnDto, usize)> {
        let turns = self.by_task.get_mut(task_id)?;
        let index = turns.iter().position(|turn| turn.id == id)?;
        turns.remove(index).map(|turn| (turn, index))
    }

    pub fn take_front(&mut self, task_id: &str) -> Option<(QueuedTurnDto, usize)> {
        self.by_task
            .get_mut(task_id)?
            .pop_front()
            .map(|turn| (turn, 0))
    }

    pub fn remove(&mut self, task_id: &str, id: &str) -> Option<QueuedTurnDto> {
        let turns = self.by_task.get_mut(task_id)?;
        let index = turns.iter().position(|turn| turn.id == id)?;
        turns.remove(index)
    }

    pub fn restore(&mut self, task_id: &str, index: usize, turn: QueuedTurnDto) {
        let turns = self.by_task.entry(task_id.to_string()).or_default();
        turns.insert(index.min(turns.len()), turn);
    }
}

pub fn should_auto_start(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Completed)
}
