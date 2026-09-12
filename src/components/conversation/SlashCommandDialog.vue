<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../services/i18n'
import { errorMessage, ipc } from '../../services/ipc'
import type { ModelInfoDto, TaskDto, TaskPermissionMode } from '../../domain/models'

export type SlashDialogKind = 'model' | 'permissions'

const props = defineProps<{ kind: SlashDialogKind; task: TaskDto; models: ModelInfoDto[] }>()
const emit = defineEmits<{ close: []; updated: [task: TaskDto] }>()
const { t } = useI18n()
const saving = ref(false)
const error = ref('')
const optionsEl = ref<HTMLElement | null>(null)

// 模态打开后把焦点移入对话框，保证 Escape 可达且按键不再漏到背后的输入框。
onMounted(() => { optionsEl.value?.querySelector<HTMLButtonElement>('button[data-option]')?.focus() })

const permissionModes = [
  { value: 'default', labelKey: 'permDefault', descriptionKey: 'permDefaultDesc' },
  { value: 'acceptEdits', labelKey: 'permAcceptEdits', descriptionKey: 'permAcceptEditsDesc' },
  { value: 'plan', labelKey: 'permPlan', descriptionKey: 'permPlanDesc' },
  { value: 'dontAsk', labelKey: 'permDontAsk', descriptionKey: 'permDontAskDesc' },
] as const satisfies ReadonlyArray<{ value: TaskPermissionMode; labelKey: string; descriptionKey: string }>

async function emitUpdated(updated: TaskDto) {
  emit('updated', updated)
  emit('close')
}

async function chooseModel(value: string) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await emitUpdated(await ipc.setTaskModel(props.task.id, value))
  } catch (cause) { error.value = errorMessage(cause) }
  finally { saving.value = false }
}

async function choosePermissionMode(value: string) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await emitUpdated(await ipc.setTaskPermissionMode(props.task.id, value))
  } catch (cause) { error.value = errorMessage(cause) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="dialog-backdrop" @keydown.escape="emit('close')">
    <div class="slash-dialog" role="dialog" aria-modal="true" :aria-label="kind === 'model' ? t('selectModel') : t('selectPermissionMode')">
      <h2>{{ kind === 'model' ? t('selectModel') : t('selectPermissionMode') }}</h2>
      <div ref="optionsEl" class="dialog-options">
        <button type="button" data-option :class="{ selected: kind === 'model' ? !task.modelOverride : !task.permissionModeOverride }" :disabled="saving" @click="kind === 'model' ? chooseModel('') : choosePermissionMode('')">
          <span class="option-label">{{ t('followAppSettings') }}</span>
        </button>
        <template v-if="kind === 'model'">
          <button v-for="model in models" :key="model.value" type="button" data-option :class="{ selected: task.modelOverride === model.value }" :disabled="saving" @click="chooseModel(model.value)">
            <span class="option-label">{{ model.displayName }}</span>
            <span class="option-desc">{{ model.description }}</span>
          </button>
        </template>
        <template v-else>
          <button v-for="mode in permissionModes" :key="mode.value" type="button" data-option :class="{ selected: task.permissionModeOverride === mode.value }" :disabled="saving" @click="choosePermissionMode(mode.value)">
            <span class="option-label">{{ t(mode.labelKey) }}</span>
            <span class="option-desc">{{ t(mode.descriptionKey) }}</span>
          </button>
        </template>
      </div>
      <p v-if="error" class="dialog-error">{{ error }}</p>
      <div class="dialog-footer"><button type="button" class="cancel" :disabled="saving" @click="emit('close')">{{ t('dialogCancel') }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; z-index: 40; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 45%); }.slash-dialog { display: flex; width: min(420px, calc(100vw - 48px)); flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--border-strong); border-radius: 16px; background: var(--surface-composer); box-shadow: var(--shadow-lg); }.slash-dialog h2 { margin: 0; font-size: 14px; }.dialog-options { display: flex; max-height: 320px; flex-direction: column; gap: 6px; overflow: auto; }.dialog-options button { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 1px solid var(--border-subtle); border-radius: 10px; background: none; cursor: pointer; text-align: left; }.dialog-options button.selected { border-color: var(--accent-border); background: var(--accent-soft); }.option-label { color: var(--text-primary); font-size: 12px; font-weight: 600; }.option-desc { color: var(--text-muted); font-size: 11px; }.dialog-error { margin: 0; color: var(--text-danger); font-size: 12px; }.dialog-footer { display: flex; justify-content: flex-end; }.dialog-footer .cancel { padding: 6px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; }
</style>
