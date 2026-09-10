use std::collections::HashMap;

#[derive(Default)]
pub struct GrantCache {
    task_rules: HashMap<String, Vec<serde_json::Value>>,
}

impl GrantCache {
    pub fn allow(&mut self, task_id: &str, permission_update: &serde_json::Value) {
        if !permission_update.is_null() {
            let rules = self.task_rules.entry(task_id.into()).or_default();
            if !rules.contains(permission_update) {
                rules.push(permission_update.clone());
            }
        }
    }

    pub fn matches_any(
        &self,
        task_id: &str,
        suggestions: &[serde_json::Value],
    ) -> Option<serde_json::Value> {
        let rules = self.task_rules.get(task_id)?;
        suggestions
            .iter()
            .find(|suggestion| rules.contains(suggestion))
            .cloned()
    }

    pub fn clear_task(&mut self, task_id: &str) {
        self.task_rules.remove(task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::GrantCache;

    #[test]
    fn remembers_structured_sdk_permission_updates_per_task() {
        let update = serde_json::json!({
            "type": "addRules",
            "rules": [{ "toolName": "Bash", "ruleContent": "npm test" }],
            "behavior": "allow",
            "destination": "session"
        });
        let mut cache = GrantCache::default();
        cache.allow("task-1", &update);

        assert_eq!(cache.matches_any("task-1", &[update.clone()]), Some(update));
        assert_eq!(cache.matches_any("task-2", &[]), None);
    }
}
