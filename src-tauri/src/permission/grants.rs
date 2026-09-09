use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct GrantCache {
    task_rules: HashMap<String, HashSet<String>>,
}

impl GrantCache {
    pub fn allow(&mut self, task_id: &str, rule: &str) {
        if !rule.trim().is_empty() {
            self.task_rules
                .entry(task_id.into())
                .or_default()
                .insert(rule.into());
        }
    }

    pub fn matches_any(&self, task_id: &str, suggestions: &[String]) -> Option<String> {
        let rules = self.task_rules.get(task_id)?;
        suggestions
            .iter()
            .find(|suggestion| rules.contains(*suggestion))
            .cloned()
    }

    pub fn clear_task(&mut self, task_id: &str) {
        self.task_rules.remove(task_id);
    }
}
