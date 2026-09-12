<script setup lang="ts">
import { useI18n } from '../../services/i18n'
import type { RankedSlashCommand } from '../../services/slashCommands'

defineProps<{
  items: RankedSlashCommand[]
  activeIndex: number
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ select: [index: number]; retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="slash-menu" role="listbox" :aria-label="t('slashCommandMenu')">
    <div v-if="loading" class="slash-menu-state">{{ t('slashCommandsLoading') }}</div>
    <div v-else-if="error" class="slash-menu-state slash-menu-error">
      <span>{{ error }}</span>
      <button type="button" @click="emit('retry')">{{ t('slashCommandsRetry') }}</button>
    </div>
    <template v-else>
      <button v-for="(item, index) in items" :key="item.command.name" type="button" role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }" @click="emit('select', index)">
        <span class="slash-menu-name">/{{ item.command.name }}</span>
        <span v-if="item.matchedAlias" class="slash-menu-alias">{{ item.matchedAlias }}</span>
        <span v-if="item.command.argumentHint" class="slash-menu-hint">{{ item.command.argumentHint }}</span>
        <span class="slash-menu-desc">{{ item.command.description }}</span>
      </button>
      <div v-if="!items.length" class="slash-menu-state">{{ t('slashCommandsEmpty') }}</div>
    </template>
  </div>
</template>

<style scoped>
.slash-menu { position: absolute; z-index: 5; right: 0; bottom: calc(100% + 6px); left: 0; max-height: 264px; overflow: auto; padding: 6px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-composer); box-shadow: var(--shadow-lg); }
.slash-menu [role="option"] { display: flex; width: 100%; gap: 8px; align-items: baseline; padding: 7px 9px; border: 0; border-radius: 8px; background: none; cursor: pointer; text-align: left; }
.slash-menu [role="option"].active { background: var(--accent-soft); }
.slash-menu-name { flex: none; color: var(--text-primary); font: 600 12px var(--font-mono); }
.slash-menu-alias { flex: none; padding: 1px 5px; border: 1px solid var(--border-subtle); border-radius: 5px; color: var(--text-muted); font-size: 10px; }
.slash-menu-hint { flex: none; color: var(--text-muted); font: 10px var(--font-mono); }
.slash-menu-desc { min-width: 0; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.slash-menu-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; color: var(--text-muted); font-size: 12px; }
.slash-menu-error button { border: 0; background: none; color: var(--accent); cursor: pointer; font-size: 12px; text-decoration: underline; }
</style>
