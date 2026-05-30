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


function parseRunName(name: string) {
  const parts = name.split('_')
  
  if (parts.length >= 5) {
    const strategy = parts[0]
    const startDate = formatRawDate(parts[1])
    const endDate = formatRawDate(parts[2])
    const runDate = parts[3]
    const runTime = parts[4]
    
    let formattedRunTime = ''
    if (runDate && runTime && runDate.length === 8 && runTime.length === 6) {
      formattedRunTime = `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)} ${runTime.slice(0, 2)}:${runTime.slice(2, 4)}:${runTime.slice(4, 6)}`
    }
    
    return {
      strategy,
      period: `${startDate} 至 ${endDate}`,
      runTime: formattedRunTime || name
    }
  }
  
  const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.*)$/)
  if (dateMatch) {
    const runTime = `${dateMatch[1]} ${dateMatch[2].replace(/-/g, ':')}`
    return {
      strategy: dateMatch[3],
      period: '内置模拟回测',
      runTime
    }
  }

  return {
    strategy: name,
    period: '未知回测区间',
    runTime: '未知执行时间'
  }
}

function formatRawDate(raw: string) {
  if (raw && raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return raw
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

    <!-- Records List Table -->
    <div v-else class="bg-slate-900/10 border border-slate-900 rounded-xl overflow-hidden shadow-lg max-w-5xl">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse font-mono text-xs text-left">
          <thead>
            <tr class="bg-slate-950/40 border-b border-slate-900 text-slate-500 font-bold select-none">
              <th class="py-3.5 px-5">策略名称</th>
              <th class="py-3.5 px-4">执行时间</th>
              <th class="py-3.5 px-4">回测区间</th>
              <th class="py-3.5 px-4 text-center">夏普比率</th>
              <th class="py-3.5 px-4 text-center">最大回撤</th>
              <th class="py-3.5 px-4 text-center">胜率</th>
              <th class="py-3.5 px-5 text-right">净利润</th>
              <th class="py-3.5 px-5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-900/50">
            <tr
              v-for="run in runs"
              :key="run.id"
              class="hover:bg-slate-900/40 transition duration-150 group"
            >
              <!-- Strategy Name -->
              <td class="py-4 px-5 font-bold">
                <span class="text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20 text-[10px]">
                  {{ parseRunName(run.id).strategy }}
                </span>
              </td>
              <!-- Executed Time -->
              <td class="py-4 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                {{ parseRunName(run.id).runTime }}
              </td>
              <!-- Backtest Period -->
              <td class="py-4 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                {{ parseRunName(run.id).period }}
              </td>
              <!-- Sharpe Ratio -->
              <td class="py-4 px-4 text-center font-bold text-slate-300">
                {{ run.summary?.sharpe_ratio != null ? run.summary.sharpe_ratio.toFixed(2) : 'N/A' }}
              </td>
              <!-- Max Drawdown -->
              <td class="py-4 px-4 text-center font-bold text-rose-400">
                {{ run.summary?.max_drawdown != null ? (run.summary.max_drawdown * 100).toFixed(1) + '%' : 'N/A' }}
              </td>
              <!-- Win Rate -->
              <td class="py-4 px-4 text-center font-bold text-emerald-400">
                {{ run.summary?.win_rate != null ? (run.summary.win_rate * 100).toFixed(1) + '%' : 'N/A' }}
              </td>
              <!-- Net Profit -->
              <td class="py-4 px-5 text-right font-bold font-mono">
                <span :class="(run.summary?.net_profit || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
                  {{ (run.summary?.net_profit || 0) >= 0 ? '+' : '' }}${{ run.summary?.net_profit?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00' }}
                </span>
              </td>
              <!-- Actions -->
              <td class="py-4 px-5 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-2">
                  <button
                    @click="handleAnalyze(run.path)"
                    class="px-2.5 py-1 bg-orange-600/15 hover:bg-orange-600/25 border border-orange-500/35 hover:border-orange-500/60 text-orange-400 hover:text-orange-350 font-bold rounded text-[10px] transition duration-150 cursor-pointer"
                  >
                    分析结果
                  </button>
                  <button
                    @click="handleDelete(run.id, $event)"
                    class="p-1 border border-transparent hover:border-rose-500/35 hover:bg-rose-500/5 text-slate-500 hover:text-rose-400 rounded transition duration-150 cursor-pointer"
                    title="删除此记录"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>
