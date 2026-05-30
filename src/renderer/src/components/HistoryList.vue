<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Package, Trash2, RefreshCw, AlertTriangle } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'load', path: string): void
}>()

interface BacktestRun {
  id: string
  name: string
  path: string
  createdAt: number
  summary: {
    sharpe_ratio?: number
    sortino_ratio?: number
    max_drawdown?: number
    win_rate?: number
    profit_factor?: number
    total_trades?: number
    net_profit?: number
    total_return?: number
  }
}

const runs = ref<BacktestRun[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function fetchHistory() {
  loading.value = true
  error.value = null
  try {
    const list = await window.nautilusAPI.listBacktests()
    runs.value = list
  } catch (err: any) {
    error.value = err.message || '获取回测历史记录失败'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function handleDelete(runId: string, event: Event) {
  event.stopPropagation()
  if (!confirm('确定要删除这条回测历史记录吗？此操作无法撤销。')) {
    return
  }

  try {
    error.value = null
    const result = await window.nautilusAPI.deleteBacktest(runId)
    if (result.success) {
      await fetchHistory()
    }
  } catch (err: any) {
    error.value = err.message || '删除回测历史记录失败'
    console.error(err)
  }
}

function handleAnalyze(path: string) {
  emit('load', path)
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '--'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatPercentage(val?: number): string {
  if (val === undefined || val === null) return '--'
  const displayVal = Math.abs(val) < 1.01 && val !== 0 ? val * 100 : val
  return `${displayVal.toFixed(2)}%`
}

onMounted(() => {
  fetchHistory()
})
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-slate-950 px-6 py-4 overflow-y-auto select-none text-xs">
    
    <!-- Header Line -->
    <div class="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-bold text-slate-100 uppercase tracking-wider">历史回测记录</h2>
        <span class="bg-slate-900 border border-slate-800 text-slate-400 font-semibold px-2 py-0.5 rounded-full text-[10px]">
          {{ runs.length }}
        </span>
      </div>

      <button
        @click="fetchHistory"
        :disabled="loading"
        class="p-2 border border-slate-800 hover:border-slate-700 rounded-lg bg-slate-900/50 text-slate-400 hover:text-slate-200 transition disabled:opacity-50"
        title="刷新记录"
      >
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <!-- Error Alerts -->
    <div v-if="error" class="mb-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 rounded-xl px-4 py-3 flex items-center gap-3">
      <AlertTriangle class="w-4 h-4 shrink-0" />
      <div class="flex-1 font-mono">{{ error }}</div>
      <button @click="error = null" class="text-rose-500 hover:text-rose-300 font-semibold px-2">Dismiss</button>
    </div>

    <!-- Loading State -->
    <div v-if="loading && runs.length === 0" class="flex-1 flex flex-col items-center justify-center gap-3 py-12">
      <div class="w-8 h-8 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin"></div>
      <span class="text-slate-400 font-mono text-[11px]">正在扫描本地历史回测目录...</span>
    </div>

    <!-- Empty State -->
    <div v-else-if="runs.length === 0" class="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10 py-16">
      <div class="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 border border-orange-500/20 mb-4">
        <Package class="w-6 h-6" />
      </div>
      <h3 class="text-slate-200 font-bold mb-1 text-sm">暂无本地回测记录</h3>
      <p class="text-slate-500 max-w-sm leading-relaxed mb-4">
        尚未检测到任何已保存的策略模拟数据。您可以切回【启动回测】配置参数并运行一次回测，生成的数据将自动归档。
      </p>
    </div>

    <!-- Records List -->
    <div v-else class="flex flex-col gap-4 max-w-5xl">
      <div
        v-for="run in runs"
        :key="run.id"
        class="bg-slate-900/40 border border-slate-900/80 hover:border-slate-800/80 rounded-xl p-4 flex items-center justify-between gap-4 transition duration-200"
      >
        <!-- Info Column -->
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-10 h-10 rounded-lg bg-orange-600/10 border border-orange-500/20 flex items-center justify-center text-orange-500 shrink-0">
            <Package class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <h4 class="text-slate-100 font-bold text-sm tracking-wide font-mono truncate">
              {{ run.name }}
            </h4>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 mt-1 font-mono">
              <span>时间: {{ formatDate(run.createdAt) }}</span>
              <span v-if="run.summary" class="flex items-center gap-2">
                <span class="w-1 h-1 rounded-full bg-slate-700"></span>
                <span>收益率: <span :class="(run.summary.net_profit || 0) >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'">{{ formatPercentage(run.summary.total_return) }}</span></span>
                <span class="w-1 h-1 rounded-full bg-slate-700"></span>
                <span>夏普: <span class="text-slate-300 font-semibold">{{ run.summary.sharpe_ratio?.toFixed(2) || '--' }}</span></span>
                <span class="w-1 h-1 rounded-full bg-slate-700"></span>
                <span>胜率: <span class="text-slate-300 font-semibold">{{ formatPercentage(run.summary.win_rate) }}</span></span>
                <span class="w-1 h-1 rounded-full bg-slate-700"></span>
                <span>交易笔数: <span class="text-slate-300 font-semibold">{{ run.summary.total_trades || '--' }}</span></span>
              </span>
            </div>
          </div>
        </div>

        <!-- Action Column -->
        <div class="flex items-center gap-3 shrink-0">
          <button
            @click="handleAnalyze(run.path)"
            class="flex items-center gap-1.5 px-4 py-2 border border-orange-500/20 hover:border-orange-500/50 bg-orange-600/10 hover:bg-orange-600/20 text-orange-400 hover:text-orange-300 font-bold rounded-lg transition duration-200"
          >
            分析结果
          </button>
          
          <button
            @click="handleDelete(run.id, $event)"
            class="p-2 border border-slate-900 hover:border-rose-500/30 hover:bg-rose-500/5 text-slate-600 hover:text-rose-400 rounded-lg transition duration-200"
            title="删除此记录"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>

  </div>
</template>
