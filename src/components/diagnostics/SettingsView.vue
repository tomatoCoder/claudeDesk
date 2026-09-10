<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { CheckCircle2, Eye, EyeOff, RefreshCw, XCircle } from 'lucide-vue-next'
import type { ClaudeSettingsDto, CliDiagnosticDto, ManagedClaudeSettings, SaveClaudeSettingsInput } from '../../domain/models'

const props = defineProps<{
  settings: ClaudeSettingsDto
  cli: CliDiagnosticDto
  saving?: boolean
  externalConflict?: boolean
  error?: string
}>()
const emit = defineEmits<{ save: [input: SaveClaudeSettingsInput]; refresh: []; reload: []; close: []; dirty: [] }>()
const form = reactive<ManagedClaudeSettings>({ ...props.settings.values })
const tokenVisible = ref(false)

watch(() => props.settings, (value) => Object.assign(form, value.values), { deep: true })

function submit() {
  emit('save', { version: props.settings.version, values: { ...form } })
}
</script>

<template>
  <section class="settings-view">
    <header>
      <div><h2>设置</h2><p>同步 Claude Code 用户级 settings.json。</p></div>
      <button class="icon-button" type="button" aria-label="关闭设置" @click="emit('close')">×</button>
    </header>
    <form class="settings-body" @submit.prevent="submit">
      <div v-if="externalConflict" class="conflict" role="alert">
        settings.json 已在外部修改。当前编辑不会被覆盖。
        <button type="button" @click="emit('reload')">放弃编辑并重新载入</button>
      </div>
      <div v-if="error" class="settings-error" role="alert">{{ error }}</div>
      <label>
        <span>ANTHROPIC_AUTH_TOKEN</span>
        <div class="token-input">
          <input v-model="form.authToken" name="ANTHROPIC_AUTH_TOKEN" :type="tokenVisible ? 'text' : 'password'" autocomplete="off" placeholder="留空则删除该配置" @input="emit('dirty')" />
          <button class="icon-button" type="button" :aria-label="tokenVisible ? '隐藏 Token' : '显示 Token'" @click="tokenVisible = !tokenVisible">
            <EyeOff v-if="tokenVisible" :size="16" /><Eye v-else :size="16" />
          </button>
        </div>
        <small>Token 会按 Claude Code 的方式明文写入 settings.json，但不会进入日志或前端持久化。</small>
      </label>
      <label>
        <span>ANTHROPIC_BASE_URL</span>
        <input v-model="form.baseUrl" name="ANTHROPIC_BASE_URL" type="url" placeholder="https://api.example.com" @input="emit('dirty')" />
        <small>必须使用 HTTPS；localhost 可使用 HTTP。</small>
      </label>
      <label>
        <span>ANTHROPIC_MODEL</span>
        <input v-model="form.model" name="ANTHROPIC_MODEL" type="text" placeholder="例如 claude-sonnet-5" @input="emit('dirty')" />
        <small>支持自定义网关模型标识；只影响新会话。</small>
      </label>
      <div class="settings-path">配置文件：<code>{{ settings.path }}</code></div>
      <div class="diagnostic" :class="cli.status">
        <CheckCircle2 v-if="cli.status === 'ready'" :size="19" /><XCircle v-else :size="19" />
        <div><strong>{{ cli.status === 'ready' ? 'Claude Code 已就绪' : 'Claude Code 需要处理' }}</strong><p>{{ cli.message }}</p><code v-if="cli.path">{{ cli.path }}<template v-if="cli.version"> · {{ cli.version }}</template></code></div>
        <button class="icon-button" type="button" title="重新检测 Claude CLI" @click="emit('refresh')"><RefreshCw :size="15" /></button>
      </div>
      <footer>
        <button class="secondary-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="submit" :disabled="saving || externalConflict">{{ saving ? '保存中…' : '保存' }}</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.settings-view { display: flex; height: 100%; flex-direction: column; background: var(--surface-root); }
.settings-view > header { display: flex; justify-content: space-between; padding: 24px 28px; border-bottom: 1px solid var(--border-subtle); }
.settings-view h2 { margin: 0 0 5px; }.settings-view header p { margin: 0; color: var(--text-secondary); }
.settings-body { width: min(680px, calc(100% - 56px)); margin: 0 auto; padding: 28px 0; overflow: auto; }
.settings-body label { display: block; margin-bottom: 22px; }.settings-body label > span { display: block; margin-bottom: 7px; font-weight: 650; }
.settings-body input { width: 100%; padding: 10px 11px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-input); color: var(--text-primary); }
.settings-body small { display: block; margin-top: 6px; color: var(--text-muted); line-height: 1.45; }
.token-input { position: relative; }.token-input input { padding-right: 42px; }.token-input button { position: absolute; top: 3px; right: 3px; color: var(--text-secondary); }
.settings-path { margin: -4px 0 20px; color: var(--text-muted); font-size: 11px; }.settings-path code { font-family: var(--font-mono); }
.diagnostic { display: flex; gap: 11px; padding: 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-raised); color: var(--warning); }.diagnostic.ready { color: var(--success); }.diagnostic div { min-width: 0; flex: 1; }.diagnostic strong { color: var(--text-primary); }.diagnostic p { margin: 4px 0; color: var(--text-secondary); }.diagnostic code { color: var(--text-muted); font: 10px var(--font-mono); }
.conflict,.settings-error { margin-bottom: 18px; padding: 11px 12px; border-radius: var(--radius-sm); line-height: 1.45; }.conflict { border: 1px solid rgba(214,158,46,.4); background: rgba(214,158,46,.08); color: #e5c277; }.conflict button { margin-left: 8px; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; }.settings-error { border: 1px solid rgba(207,93,93,.35); background: rgba(207,93,93,.08); color: #f3b0b0; }
.settings-body > footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
</style>
