<script setup lang="ts">
import { ref } from 'vue'
import { CornerDownRight, Ellipsis, Send, Trash2 } from 'lucide-vue-next'
import type { QueuedTurnDto } from '../../domain/models'
import type { TaskStatus } from '../../domain/events'

const props = defineProps<{ turns: QueuedTurnDto[]; status: TaskStatus; busyIds?: string[] }>()
const emit = defineEmits<{
  adjust: [id: string]
  sendNow: [id: string]
  remove: [id: string]
  update: [id: string, text: string]
}>()

const editingId = ref<string | null>(null)
const editingText = ref('')
const menuId = ref<string | null>(null)

function busy(id: string) { return props.busyIds?.includes(id) ?? false }
function edit(turn: QueuedTurnDto) { editingId.value = turn.id; editingText.value = turn.text; menuId.value = null }
function save(id: string) {
  const text = editingText.value.trim()
  if (!text) return
  emit('update', id, text)
  editingId.value = null
}
</script>

<template>
  <div v-if="turns.length" class="queued-turns" aria-label="等待消息">
    <div v-for="turn in turns" :key="turn.id" class="queued-turn">
      <template v-if="editingId === turn.id">
        <textarea v-model="editingText" rows="2" :disabled="busy(turn.id)" />
        <div class="edit-actions"><button type="button" @click="editingId = null">取消</button><button type="button" :disabled="busy(turn.id) || !editingText.trim()" @click="save(turn.id)">保存</button></div>
      </template>
      <template v-else>
        <CornerDownRight :size="15" class="queued-icon" />
        <span data-testid="queued-turn-text" class="queued-text" :title="turn.text">{{ turn.text }}</span>
        <div class="queued-actions">
          <button v-if="status === 'starting' || status === 'running' || status === 'awaiting_permission'" data-testid="adjust-turn" type="button" :disabled="status === 'awaiting_permission' || busy(turn.id)" @click="emit('adjust', turn.id)">调整方向</button>
          <button v-else-if="status === 'failed' || status === 'interrupted'" type="button" :disabled="busy(turn.id)" @click="emit('sendNow', turn.id)"><Send :size="13" />立即发送</button>
          <button type="button" class="icon-button" :disabled="busy(turn.id)" title="删除" @click="emit('remove', turn.id)"><Trash2 :size="14" /></button>
          <button type="button" class="icon-button" :disabled="busy(turn.id)" title="更多" @click="menuId = menuId === turn.id ? null : turn.id"><Ellipsis :size="16" /></button>
          <button v-if="menuId === turn.id" type="button" class="edit-menu" @click="edit(turn)">编辑消息</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.queued-turns { max-height: 168px; overflow: auto; border-bottom: 1px solid #3a352f; background: #151411; }.queued-turn { position: relative; display: flex; min-height: 42px; align-items: center; gap: 8px; padding: 8px 12px; color: #e8e1d9; font-size: 12px; }.queued-turn + .queued-turn { border-top: 1px solid #2c2925; }.queued-icon { flex: none; color: #d9773d; }.queued-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.queued-actions,.edit-actions { display: flex; align-items: center; gap: 5px; }.queued-actions button,.edit-actions button { display: inline-flex; align-items: center; gap: 3px; border: 0; border-radius: 6px; background: transparent; color: #d9773d; font-size: 11px; cursor: pointer; }.queued-actions button:disabled,.edit-actions button:disabled { cursor: default; opacity: .45; }.icon-button { padding: 4px; color: #a79c90 !important; }.edit-menu { position: absolute; z-index: 2; right: 10px; top: 35px; padding: 7px 9px; border: 1px solid #4a443c !important; background: #211f1b !important; color: #eee6dd !important; box-shadow: 0 5px 14px #0008; }.queued-turn textarea { width: 100%; resize: vertical; border: 1px solid #5b5147; border-radius: 7px; padding: 6px; background: #211f1b; color: #f4eee7; font: inherit; }.edit-actions { margin-left: auto; }
</style>
