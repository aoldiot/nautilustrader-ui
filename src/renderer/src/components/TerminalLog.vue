<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Terminal, ShieldAlert, CheckCircle2, Loader2, X } from 'lucide-vue-next'

const props = defineProps<{
  logs: string[]
  running: boolean
  success: boolean | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const logContainer = ref<HTMLDivElement | null>(null)

// Auto-scroll terminal logs to bottom on update
watch(() => props.logs, async () => {
  await nextTick()
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
}, { deep: true })

// Parse log lines to add colored styles based on tags
function getLineClass(line: string): string {
  if (line.includes('[系统]') || line.includes('[SYS]')) return 'text-indigo-400 font-semibold'
  if (line.includes('✓') || line.includes('成功') || line.includes('SUCCESS')) return 'text-emerald-400'
  if (line.includes('Error') || line.includes('Exception') || line.includes('失败') || line.includes('FAILED')) return 'text-rose-400 font-bold'
  if (line.includes('warning') || line.includes('警告')) return 'text-amber-400'
  return 'text-slate-300'
}
</script>

<template>
  <div class="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-2xl h-[500px] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      
      <!-- Top Title Bar -->
      <div class="px-6 py-4 border-b border-slate-900 bg-slate-950 flex items-center justify-between select-none">
        <div class="flex items-center gap-2.5">
          <Terminal class="w-4 h-4 text-indigo-400" />
          <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">策略回测终端控制台</span>
          
          <!-- Running status indicators -->
          <span v-if="running" class="flex items-center gap-1.5 text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded font-mono">
            <Loader2 class="w-3 h-3 animate-spin" />
            运行中
          </span>
          <span v-else-if="success === true" class="flex items-center gap-1 text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono">
            <CheckCircle2 class="w-3 h-3" />
            回测成功
          </span>
          <span v-else-if="success === false" class="flex items-center gap-1 text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-mono">
            <ShieldAlert class="w-3 h-3" />
            回测失败
          </span>
        </div>
        
        <button
          v-if="!running"
          @click="emit('close')"
          class="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-900 rounded transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Terminal Body -->
      <div
        ref="logContainer"
        class="flex-1 overflow-y-auto p-6 font-mono text-[11px] leading-relaxed bg-black/95 select-text selection:bg-indigo-500/30 selection:text-white"
      >
        <div v-if="logs.length === 0" class="text-slate-600 italic select-none">
          等待子进程就绪，准备接收日志流...
        </div>
        <div
          v-for="(line, idx) in logs"
          :key="idx"
          :class="getLineClass(line)"
          class="whitespace-pre-wrap break-all border-l-2 border-transparent pl-2 hover:bg-slate-900/40"
        >
          {{ line }}
        </div>
      </div>

      <!-- Terminal Footer -->
      <div class="px-6 py-3 border-t border-slate-900 bg-slate-950 flex items-center justify-end select-none">
        <button
          @click="emit('close')"
          :disabled="running"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold border transition"
          :class="running 
            ? 'border-slate-900 bg-slate-950 text-slate-600 cursor-not-allowed'
            : 'border-slate-800 hover:border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100'"
        >
          {{ running ? '回测运行中...' : '关闭终端' }}
        </button>
      </div>

    </div>
  </div>
</template>
