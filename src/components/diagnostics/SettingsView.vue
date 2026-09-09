<script setup lang="ts">
import { reactive, watch } from 'vue'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-vue-next'
import type { AppSettingsDto, CliDiagnosticDto } from '../../domain/models'

const props = defineProps<{ settings: AppSettingsDto; cli: CliDiagnosticDto; saving?: boolean }>()
const emit = defineEmits<{ save: [settings: AppSettingsDto]; refresh: []; close: [] }>()
const form = reactive<AppSettingsDto>({ ...props.settings })
watch(() => props.settings, (value) => Object.assign(form, value), { deep: true })
</script>

<template>
  <section class="settings-view"><header><div><h2>设置</h2><p>Claude Desk 使用你电脑上已登录的 Claude Code CLI。</p></div><button class="icon-button" type="button" aria-label="关闭设置" @click="emit('close')">×</button></header><div class="settings-body"><label><span>Claude 可执行文件</span><input v-model="form.claudePath" placeholder="自动查找（推荐）" /><small>留空时从 PATH、Homebrew 和常见 Windows 安装目录查找。</small></label><label><span>左侧栏宽度</span><input v-model.number="form.sidebarWidth" type="number" min="220" max="440" /><small>范围 220–440 像素。</small></label><div class="diagnostic" :class="cli.status"><CheckCircle2 v-if="cli.status === 'ready'" :size="19" /><XCircle v-else :size="19" /><div><strong>{{ cli.status === 'ready' ? 'Claude Code 已就绪' : 'Claude Code 需要处理' }}</strong><p>{{ cli.message }}</p><code v-if="cli.path">{{ cli.path }}<template v-if="cli.version"> · {{ cli.version }}</template></code></div><button class="icon-button" type="button" title="重新检查" @click="emit('refresh')"><RefreshCw :size="15" /></button></div></div><footer><button class="secondary-button" type="button" @click="emit('close')">取消</button><button class="primary-button" type="button" :disabled="saving" @click="emit('save', { ...form })">保存</button></footer></section>
</template>

<style scoped>
.settings-view { display: flex; height: 100%; flex-direction: column; background: var(--surface-root); }.settings-view > header { display: flex; justify-content: space-between; padding: 24px 28px; border-bottom: 1px solid var(--border-subtle); }.settings-view h2 { margin: 0 0 5px; }.settings-view header p { margin: 0; color: var(--text-secondary); }.settings-body { width: min(680px, calc(100% - 56px)); margin: 0 auto; padding: 32px 0; }.settings-body label { display: block; margin-bottom: 24px; }.settings-body label > span { display: block; margin-bottom: 7px; font-weight: 600; }.settings-body input { width: 100%; padding: 10px 11px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-input); color: var(--text-primary); }.settings-body small { display: block; margin-top: 6px; color: var(--text-muted); }.diagnostic { display: flex; gap: 11px; padding: 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-raised); color: var(--warning); }.diagnostic.ready { color: var(--success); }.diagnostic div { min-width: 0; flex: 1; }.diagnostic strong { color: var(--text-primary); }.diagnostic p { margin: 4px 0; color: var(--text-secondary); }.diagnostic code { color: var(--text-muted); font: 10px var(--font-mono); }.settings-view > footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: auto; padding: 16px 28px; border-top: 1px solid var(--border-subtle); }
</style>
