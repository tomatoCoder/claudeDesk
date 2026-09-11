<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { Braces, CheckCircle2, Eye, EyeOff, RefreshCw, SlidersHorizontal, XCircle } from 'lucide-vue-next'
import type {
  AppLanguage,
  ClaudeSettingsDto,
  CliDiagnosticDto,
  ManagedClaudeSettings,
  ProjectOpenWith,
  SaveClaudeSettingsInput,
  SaveClaudeSettingsJsonInput,
  ThemePreference,
} from '../../domain/models'
import { useI18n } from '../../services/i18n'

type EditorMode = 'visual' | 'json'
type JsonObject = Record<string, unknown>

const props = withDefaults(defineProps<{
  settings: ClaudeSettingsDto
  theme?: ThemePreference
  language?: AppLanguage
  openWith?: ProjectOpenWith
  cli: CliDiagnosticDto
  saving?: boolean
  externalConflict?: boolean
  error?: string
}>(), { theme: 'system', language: 'zh-CN', openWith: 'default' })
const emit = defineEmits<{
  save: [input: SaveClaudeSettingsInput]
  saveJson: [input: SaveClaudeSettingsJsonInput]
  themeChange: [theme: ThemePreference]
  languageChange: [language: AppLanguage]
  openWithChange: [openWith: ProjectOpenWith]
  refresh: []
  reload: []
  close: []
  dirty: []
}>()

const editorMode = ref<EditorMode>('visual')
const { t } = useI18n()
const form = reactive<ManagedClaudeSettings>({ ...props.settings.values })
const jsonDraft = ref(props.settings.raw)
const jsonError = ref('')
const tokenVisible = ref(false)

watch(() => props.settings, (value) => {
  Object.assign(form, value.values)
  jsonDraft.value = value.raw
  jsonError.value = ''
}, { deep: true })

function parseRoot(raw: string): JsonObject {
  const parsed: unknown = JSON.parse(raw || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('jsonRootObject'))
  }
  return parsed as JsonObject
}

function getEnv(root: JsonObject): JsonObject {
  if (root.env === undefined) root.env = {}
  if (!root.env || typeof root.env !== 'object' || Array.isArray(root.env)) {
    throw new Error(t('jsonEnvObject'))
  }
  return root.env as JsonObject
}

function setString(env: JsonObject, key: string, value: string) {
  if (value.trim()) env[key] = value.trim()
  else delete env[key]
}

function visualJson(): string {
  const root = parseRoot(jsonDraft.value || props.settings.raw)
  const env = getEnv(root)
  setString(env, 'ANTHROPIC_AUTH_TOKEN', form.authToken)
  setString(env, 'ANTHROPIC_BASE_URL', form.baseUrl)
  setString(env, 'ANTHROPIC_MODEL', form.model)
  setString(env, 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', form.autoCompactThreshold)
  setString(env, 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', form.autoCompactWindow)
  if (form.autoCompact) delete env.DISABLE_AUTO_COMPACT
  else env.DISABLE_AUTO_COMPACT = '1'
  return JSON.stringify(root, null, 2)
}

function applyJsonToVisual(raw: string) {
  const env = getEnv(parseRoot(raw))
  form.authToken = typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN : ''
  form.baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : ''
  form.model = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : ''
  form.autoCompactThreshold = typeof env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === 'string' ? env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE : ''
  form.autoCompactWindow = typeof env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === 'string' ? env.CLAUDE_CODE_AUTO_COMPACT_WINDOW : ''
  const disabled = typeof env.DISABLE_AUTO_COMPACT === 'string' ? env.DISABLE_AUTO_COMPACT.toLowerCase() : ''
  form.autoCompact = !['1', 'true', 'yes', 'on'].includes(disabled)
}

function switchMode(mode: EditorMode) {
  if (mode === editorMode.value) return
  try {
    if (mode === 'json') jsonDraft.value = visualJson()
    else applyJsonToVisual(jsonDraft.value)
    jsonError.value = ''
    editorMode.value = mode
  } catch (cause) {
    jsonError.value = cause instanceof Error ? cause.message : t('invalidJson')
  }
}

function submit() {
  if (editorMode.value === 'visual') {
    emit('save', { version: props.settings.version, values: { ...form } })
    return
  }
  try {
    const root = parseRoot(jsonDraft.value)
    jsonDraft.value = JSON.stringify(root, null, 2)
    jsonError.value = ''
    emit('saveJson', { version: props.settings.version, raw: jsonDraft.value })
  } catch (cause) {
    jsonError.value = cause instanceof Error ? cause.message : t('invalidJson')
  }
}

function changeTheme(event: Event) {
  emit('themeChange', (event.target as HTMLSelectElement).value as ThemePreference)
}

function changeLanguage(event: Event) {
  emit('languageChange', (event.target as HTMLSelectElement).value as AppLanguage)
}

function changeOpenWith(event: Event) {
  emit('openWithChange', (event.target as HTMLSelectElement).value as ProjectOpenWith)
}
</script>

<template>
  <section class="settings-view">
    <header class="settings-header">
      <div><h2>{{ t('settingsTitle') }}</h2></div>
      <button class="icon-button close-button" type="button" :aria-label="t('closeSettings')" @click="emit('close')">×</button>
    </header>

    <form class="settings-form" @submit.prevent="submit">
      <div class="settings-scroll">
        <div class="settings-content">
          <div v-if="externalConflict" class="conflict" role="alert">
            {{ t('settingsChanged') }}
            <button type="button" @click="emit('reload')">{{ t('discardReload') }}</button>
          </div>
          <div v-if="error" class="settings-error" role="alert">{{ error }}</div>

          <nav class="editor-tabs" :aria-label="t('editorModeLabel')">
            <button type="button" :class="{ active: editorMode === 'visual' }" @click="switchMode('visual')"><SlidersHorizontal :size="16" />{{ t('visual') }}</button>
            <button type="button" :class="{ active: editorMode === 'json' }" @click="switchMode('json')"><Braces :size="16" />JSON</button>
          </nav>

          <template v-if="editorMode === 'visual'">
            <section class="settings-section api-section">
              <label class="field field-wide">
                <span>{{ t('apiAddress') }}</span>
                <small>{{ t('apiAddressHelp') }}</small>
                <input v-model="form.baseUrl" name="ANTHROPIC_BASE_URL" type="url" placeholder="https://api.example.com" @input="emit('dirty')" />
              </label>
              <div class="field-grid">
                <label class="field">
                  <span>{{ t('token') }}</span>
                  <small>{{ t('tokenHelp') }}</small>
                  <div class="token-input">
                    <input v-model="form.authToken" name="ANTHROPIC_AUTH_TOKEN" :type="tokenVisible ? 'text' : 'password'" autocomplete="off" :placeholder="t('tokenPlaceholder')" @input="emit('dirty')" />
                    <button class="icon-button" type="button" :aria-label="tokenVisible ? t('hideToken') : t('showToken')" @click="tokenVisible = !tokenVisible">
                      <EyeOff v-if="tokenVisible" :size="16" /><Eye v-else :size="16" />
                    </button>
                  </div>
                </label>
                <label class="field">
                  <span>{{ t('model') }}</span>
                  <small>{{ t('modelHelp') }}</small>
                  <input v-model="form.model" name="ANTHROPIC_MODEL" type="text" :placeholder="t('modelPlaceholder')" @input="emit('dirty')" />
                </label>
              </div>
            </section>

            <section class="settings-section">
              <div class="section-heading"><h3>{{ t('contextManagement') }}</h3><p>{{ t('contextManagementHelp') }}</p></div>
              <label class="toggle-card">
                <span><strong>{{ t('autoCompact') }}</strong><small>{{ t('autoCompactHelp') }}</small></span>
                <input v-model="form.autoCompact" type="checkbox" @change="emit('dirty')" />
                <i aria-hidden="true" />
              </label>
              <div class="field-grid context-grid">
                <label class="field">
                  <span>{{ t('compactThreshold') }}</span>
                  <small>{{ t('compactThresholdHelp') }}</small>
                  <select v-model="form.autoCompactThreshold" :disabled="!form.autoCompact" @change="emit('dirty')">
                    <option value="">{{ t('compactDefault') }}</option>
                    <option value="90">90%</option>
                    <option value="80">80%</option>
                    <option value="70">70%</option>
                    <option value="60">60%</option>
                    <option value="50">50%</option>
                  </select>
                </label>
                <label class="field">
                  <span>{{ t('contextWindow') }}</span>
                  <small>{{ t('contextWindowHelp') }}</small>
                  <select v-model="form.autoCompactWindow" :disabled="!form.autoCompact" @change="emit('dirty')">
                    <option value="">{{ t('automatic') }}</option>
                    <option value="200000">200K</option>
                    <option value="500000">500K</option>
                    <option value="1000000">1M</option>
                  </select>
                </label>
              </div>
            </section>
          </template>

          <section v-else class="settings-section json-section">
            <div class="section-heading"><h3>{{ t('jsonTitle') }}</h3><p>{{ t('jsonHelp') }}</p></div>
            <textarea v-model="jsonDraft" :aria-label="t('jsonContent')" spellcheck="false" @input="emit('dirty')" />
            <div v-if="jsonError" class="json-error" role="alert">{{ jsonError }}</div>
            <div class="settings-path">{{ t('configFile') }} <code>{{ settings.path }}</code></div>
          </section>

          <section class="settings-section app-section">
            <div class="field-grid app-grid">
              <label class="field">
                <span>{{ t('appearance') }}</span>
                <select :value="theme" @change="changeTheme">
                  <option value="system">{{ t('followSystem') }}</option>
                  <option value="dark">{{ t('dark') }}</option>
                  <option value="light">{{ t('light') }}</option>
                </select>
              </label>
              <label class="field">
                <span>{{ t('systemLanguage') }}</span>
                <select :value="language" @change="changeLanguage">
                  <option value="zh-CN">{{ t('chinese') }}</option>
                  <option value="en-US">{{ t('english') }}</option>
                </select>
              </label>
              <label class="field">
                <span>{{ t('openWith') }}</span>
                <small>{{ t('openWithHelp') }}</small>
                <select :value="openWith" @change="changeOpenWith">
                  <option value="default">{{ t('systemDefault') }}</option>
                  <option value="qoder">Qoder</option>
                  <option value="vscode">VS Code</option>
                  <option value="intellij_idea">IntelliJ IDEA</option>
                </select>
              </label>
            </div>
            <div class="permission-note">{{ t('permissionNote') }}</div>
          </section>

          <div class="diagnostic" :class="cli.status">
            <CheckCircle2 v-if="cli.status === 'ready'" :size="19" /><XCircle v-else :size="19" />
            <div><strong>{{ cli.status === 'ready' ? t('cliReady') : t('cliNeedsAttention') }}</strong><p>{{ cli.message }}</p><code v-if="cli.path">{{ cli.path }}<template v-if="cli.version"> · {{ cli.version }}</template></code></div>
            <button class="icon-button" type="button" :title="t('redetectCli')" @click="emit('refresh')"><RefreshCw :size="15" /></button>
          </div>
        </div>
      </div>

      <footer class="settings-footer">
        <span>{{ t('noRestart') }}</span>
        <button class="secondary-button" type="button" @click="emit('close')">{{ t('cancel') }}</button>
        <button class="primary-button" type="submit" :disabled="saving || externalConflict">{{ saving ? t('saving') : t('saveSettings') }}</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.settings-view { display: flex; height: 100%; min-height: 0; flex-direction: column; background: var(--surface-root); }
.settings-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; padding: 22px 28px 18px; border-bottom: 1px solid var(--border-subtle); }.eyebrow { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .16em; }.settings-header h2 { margin: 0; font-size: 25px; }.close-button { font-size: 25px; font-weight: 300; }
.settings-form { display: flex; min-height: 0; flex: 1; flex-direction: column; }.settings-scroll { min-height: 0; flex: 1; overflow: auto; }.settings-content { width: min(860px, calc(100% - 56px)); margin: 0 auto; padding: 22px 0 30px; }
.editor-tabs { display: flex; gap: 5px; margin-bottom: 20px; }.editor-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }.editor-tabs button:hover { background: var(--surface-hover); color: var(--text-primary); }.editor-tabs button.active { background: var(--surface-raised); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border-subtle) inset; }
.settings-section { padding: 0 0 24px; }.settings-section + .settings-section { padding-top: 24px; border-top: 1px solid var(--border-subtle); }.section-heading { margin-bottom: 15px; }.section-heading h3 { margin: 0 0 4px; font-size: 16px; }.section-heading p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; }.field { display: block; min-width: 0; }.field-wide { margin-bottom: 18px; }.field > span { display: block; margin-bottom: 5px; font-weight: 650; }.field > small { display: block; min-height: 18px; margin: -1px 0 6px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }.field input,.field select { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-input); color: var(--text-primary); }.field select:disabled { opacity: .52; }
.token-input { position: relative; }.token-input input { padding-right: 42px; }.token-input button { position: absolute; top: 4px; right: 4px; color: var(--text-secondary); }
.toggle-card { position: relative; display: flex; align-items: center; gap: 16px; margin-bottom: 18px; padding: 13px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); cursor: pointer; }.toggle-card > span { min-width: 0; flex: 1; }.toggle-card strong,.toggle-card small { display: block; }.toggle-card small { margin-top: 3px; color: var(--text-muted); font-size: 11px; }.toggle-card input { position: absolute; width: 1px; height: 1px; opacity: 0; }.toggle-card i { position: relative; width: 38px; height: 22px; flex: 0 0 38px; border-radius: 999px; background: var(--border-strong); transition: background .16s ease; }.toggle-card i::after { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-root); content: ''; transition: transform .16s ease; }.toggle-card input:checked + i { background: var(--accent); }.toggle-card input:checked + i::after { transform: translateX(16px); }.toggle-card:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.json-section textarea { display: block; width: 100%; min-height: 390px; resize: vertical; padding: 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); outline: 0; background: var(--surface-code); color: var(--text-code-muted); font: 12px/1.6 var(--font-mono); tab-size: 2; }.json-section textarea:focus { border-color: var(--accent); }.json-error { margin-top: 9px; color: var(--text-danger); font-size: 12px; }.settings-path { margin-top: 9px; color: var(--text-muted); font-size: 11px; }.settings-path code { font-family: var(--font-mono); }
.app-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.permission-note { margin-top: 17px; padding: 11px 13px; border-radius: var(--radius-sm); background: var(--surface-subtle); color: var(--text-muted); font-size: 11px; }
.diagnostic { display: flex; gap: 11px; padding: 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-raised); color: var(--warning); }.diagnostic.ready { color: var(--success); }.diagnostic div { min-width: 0; flex: 1; }.diagnostic strong { color: var(--text-primary); }.diagnostic p { margin: 4px 0; color: var(--text-secondary); }.diagnostic code { color: var(--text-muted); font: 10px var(--font-mono); }
.conflict,.settings-error { margin-bottom: 18px; padding: 11px 12px; border-radius: var(--radius-sm); line-height: 1.45; }.conflict { border: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--text-warning); }.conflict button { margin-left: 8px; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; }.settings-error { border: 1px solid var(--danger-border); background: var(--danger-soft); color: var(--text-danger); }
.settings-footer { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; padding: 14px 28px; border-top: 1px solid var(--border-subtle); background: var(--surface-header); }.settings-footer > span { flex: 1; color: var(--text-muted); font-size: 11px; }
@media (max-width: 760px) { .settings-content { width: calc(100% - 32px); }.field-grid,.app-grid { grid-template-columns: 1fr; }.settings-footer > span { display: none; } }
</style>
