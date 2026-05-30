<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Download,
  CandlestickChart,
  CheckCircle2,
  AlertTriangle,
  Sun,
  MoreVertical,
  Globe,
  Workflow,
  FolderOpen,
  RefreshCw
} from 'lucide-vue-next'
import MultiChart from './components/MultiChart.vue'
import DataManagement from './components/DataManagement.vue'
import {
  loadBacktestParquet,
  queryFills,
  queryEquity,
  resetDB,
  setSidecarPort
} from './services/duckdb'

// Active tab selection
const activeTab = ref<'list' | 'report' | 'kline'>('list')
const viewMode = ref<'backtest' | 'data'>('backtest')

const backtestResultsPath = ref<string | null>(null)
const scannedRuns = ref<any[]>([])
const selectedRunId = ref<string | null>(null)
const currentRunPath = ref<string | null>(null)        // 当前加载的回测目录路径
const projectRootPath = ref<string | null>(null)
const availableTimeframes = ref<string[]>([])           // 可用的预聚合时间框架列表
const loadedTimeframe = ref<string>('15m')              // 当前已加载的时间框架
const sidecarPortVal = ref<number | null>(null)         // 当前运行的 sidecar 端口

const folderName = ref<string | null>(null)
const loading = ref(false)
const loadingMessage = ref('')
const error = ref<string | null>(null)

// Performance metrics and chart data state
const summaryData = ref<Record<string, any> | null>(null)
const chartData = ref<{
  bars: any[]
  fills: any[]
  equity: any[]
  indicators: any[]
} | null>(null)

onMounted(async () => {
  try {
    const stored = await window.nautilusAPI.getStoredResultsPath()
    if (stored.backtestResultsPath) {
      backtestResultsPath.value = stored.backtestResultsPath
      const projectPath = await window.nautilusAPI.getStoredProjectDir()
      projectRootPath.value = projectPath
      await scanSubdirs()
    }
  } catch (err) {
    console.error('Failed to load initial results path:', err)
  }

  // Auto refresh listener
  window.nautilusAPI.onResultsChanged(async () => {
    console.log('[App] Detected changes in results, refreshing backtest list...')
    if (backtestResultsPath.value) {
      await scanSubdirs()
    }
  })
})

async function scanSubdirs() {
  if (!backtestResultsPath.value) return
  loading.value = true
  loadingMessage.value = '正在扫描回测目录...'
  try {
    scannedRuns.value = await window.nautilusAPI.scanResultsSubdirs(backtestResultsPath.value)
  } catch (err: any) {
    error.value = err.message || '扫描回测记录失败。'
  } finally {
    loading.value = false
  }
}

async function selectParentFolder() {
  try {
    error.value = null
    const path = await window.nautilusAPI.selectFolder()
    if (path) {
      backtestResultsPath.value = path + '/backtest_results'
      projectRootPath.value = path
      await window.nautilusAPI.storeResultsPath(path)
      
      // Reset loaded states
      chartData.value = null
      summaryData.value = null
      folderName.value = null
      selectedRunId.value = null
      
      await scanSubdirs()
    }
  } catch (err: any) {
    error.value = err.message || '选择文件夹失败。'
    console.error(err)
  }
}

async function selectRun(run: any) {
  try {
    selectedRunId.value = run.id
    await window.nautilusAPI.storeSelectedSubdir(run.id)
    await loadData(run.path)
  } catch (err: any) {
    error.value = err.message || '加载回测数据失败。'
    console.error(err)
  }
}

async function loadData(path: string) {
  loading.value = true
  loadingMessage.value = '正在读取本地 Parquet 和 JSON 数据文件...'
  error.value = null
  chartData.value = null
  summaryData.value = null

  try {
    // 1. Load files via Electron IPC (Node.js file system)
    const result = await window.nautilusAPI.loadBacktestData(path)
    folderName.value = result.folderName
    summaryData.value = result.summary
    currentRunPath.value = path
    availableTimeframes.value = result.availableTimeframes || []
    loadedTimeframe.value = result.loadedTimeframe || '15m'

    // 2. Reset DuckDB to clear any stale schema from previous loads, then load new data
    loadingMessage.value = '正在初始化数据引擎...'
    await resetDB()
    if (result.port) {
      await setSidecarPort(result.port)
      sidecarPortVal.value = result.port
    } else {
      sidecarPortVal.value = null
      await loadBacktestParquet(result.bars, result.fills, result.equity)
    }

    // 3. Query equity + fills for the metrics panel
    //    MultiChart handles bars/indicators independently per symbol & timeframe
    loadingMessage.value = '正在加载分析指标...'
    const [equity, parsedFills] = await Promise.all([
      queryEquity(),
      queryFills()
    ])

    chartData.value = {
      bars: [],
      fills: parsedFills,
      equity,
      indicators: []
    }
    activeTab.value = 'report'
  } catch (err: any) {
    error.value = err.message || '加载回测数据时发生错误，请检查文件格式。'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Utility helper to parse and format directory names
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
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
    
    <!-- Top Header -->
    <header class="h-16 shrink-0 border-b border-slate-900 bg-slate-950/60 backdrop-blur-md px-6 flex items-center justify-between z-10 select-none">
      <!-- Left Side Logo -->
      <div class="flex items-center gap-6">
        <!-- Logo -->
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-orange-600 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <Workflow class="w-4 h-4" />
          </div>
          <span class="text-sm font-bold tracking-wide bg-gradient-to-r from-orange-400 to-amber-200 bg-clip-text text-transparent font-mono">NautilusTrader Analyzer</span>
          <span v-if="folderName" class="text-slate-500 font-mono text-[10px] ml-2 px-2 py-0.5 bg-slate-900 rounded border border-slate-800">
            {{ folderName }}
          </span>
        </div>
      </div>

      <!-- Center Nav Tabs -->
      <div v-if="backtestResultsPath" class="hidden md:flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 font-mono text-[10px] select-none">
        <button
          @click="viewMode = 'backtest'"
          class="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer"
          :class="viewMode === 'backtest' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'"
        >
          回测记录
        </button>
        <button
          @click="viewMode = 'data'"
          class="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer"
          :class="viewMode === 'data' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'"
        >
          数据源管理
        </button>
      </div>

      <!-- Right Side Controls -->
      <div class="flex items-center gap-4">
        <!-- Always show Change Project Directory if path is set -->
        <button
          v-if="backtestResultsPath"
          @click="selectParentFolder"
          class="flex items-center gap-1.5 px-3 py-1.5 border border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900 rounded-lg text-[10px] font-semibold text-slate-300 transition duration-150 cursor-pointer"
        >
          <Download class="w-3.5 h-3.5 text-orange-500" />
          更换项目目录
        </button>

        <Sun class="w-4 h-4 text-slate-400 hover:text-slate-200 cursor-pointer transition" />
        <Globe class="w-4 h-4 text-slate-400 hover:text-slate-200 cursor-pointer transition" />
        <MoreVertical class="w-4 h-4 text-slate-400 hover:text-slate-200 cursor-pointer transition" />
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 flex flex-col relative overflow-hidden">
      
      <!-- Error Alerts -->
      <div v-if="error" class="mx-6 mt-4 shrink-0 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs rounded-xl px-4 py-3 flex items-center gap-3">
        <AlertTriangle class="w-4 h-4 shrink-0" />
        <div class="flex-1 font-mono">{{ error }}</div>
        <button @click="error = null" class="text-rose-500 hover:text-rose-300 font-semibold px-2">Dismiss</button>
      </div>

      <!-- Loading State Overlay -->
      <div v-if="loading" class="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4">
        <div class="relative w-16 h-16">
          <div class="absolute inset-0 rounded-full border-4 border-indigo-500/10"></div>
          <div class="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
        </div>
        <div class="text-sm font-semibold text-slate-300">{{ loadingMessage }}</div>
        <div class="text-[10px] text-indigo-400 font-mono tracking-wide">HIGH-PERFORMANCE DATA PIPELINE</div>
      </div>

      <!-- Welcome Landing View (when no parent folder loaded) -->
      <div v-if="!backtestResultsPath" class="flex-1 flex flex-col items-center justify-center bg-slate-950 p-8 select-none text-center">
        <div class="max-w-md w-full bg-slate-900/40 border border-slate-900 p-8 rounded-2xl shadow-xl flex flex-col items-center">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-orange-600 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 mb-6">
            <Workflow class="w-8 h-8" />
          </div>
          <h1 class="text-xl font-bold text-slate-100 mb-2">NautilusTrader 结果分析器</h1>
          <p class="text-xs text-slate-500 font-mono mb-8">NautilusTrader Results Analyzer v1.0.0</p>
          <p class="text-slate-400 text-xs mb-8 leading-relaxed">
            请导入并加载 NautilusTrader 项目根目录（回测结果从 <code class="bg-slate-950 px-1 py-0.5 rounded font-mono text-[10px]">backtest_results</code> 获取，数据从 <code class="bg-slate-950 px-1 py-0.5 rounded font-mono text-[10px]">data</code> 获取）。
          </p>
          <button
            @click="selectParentFolder"
            class="flex items-center justify-center gap-2 w-full py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold transition duration-200 cursor-pointer shadow-lg hover:shadow-orange-600/10 border border-orange-500/30"
          >
            <FolderOpen class="w-4 h-4" />
            选择项目根目录
          </button>
        </div>
      </div>

      <!-- Data Management View -->
      <DataManagement v-else-if="viewMode === 'data'" />

      <!-- Backtest Workspace View -->
      <div v-else class="flex-1 flex flex-col min-h-0">
        <!-- Sub-Navigation Tab Bar -->
        <div class="h-12 shrink-0 border-b border-slate-900 bg-slate-950/20 flex items-center px-6 gap-2 z-10 select-none font-mono text-xs">
          <button
            @click="activeTab = 'list'"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold transition duration-200 cursor-pointer"
            :class="activeTab === 'list'
              ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400'
              : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'"
          >
            <FolderOpen class="w-3.5 h-3.5 text-orange-500" />
            回测列表
          </button>
          <button
            @click="chartData ? activeTab = 'report' : null"
            :disabled="!chartData"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold transition duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            :class="activeTab === 'report'
              ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400'
              : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'"
          >
            <Globe class="w-3.5 h-3.5 text-orange-500" />
            回测报告
          </button>
          <button
            @click="chartData ? activeTab = 'kline' : null"
            :disabled="!chartData"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold transition duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            :class="activeTab === 'kline'
              ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400'
              : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'"
          >
            <CandlestickChart class="w-3.5 h-3.5 text-orange-500" />
            K线视图
          </button>
        </div>

        <!-- Tab Views -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          <!-- 1. Backtest List View -->
          <div v-if="activeTab === 'list'" class="flex-1 flex flex-col min-h-0 bg-slate-950 p-8 overflow-y-auto">
            <div class="max-w-6xl w-full mx-auto flex flex-col gap-6">
              <!-- Header info -->
              <div class="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-900 pb-4 gap-4">
                <div>
                  <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <FolderOpen class="w-5 h-5 text-orange-500" />
                    已加载的回测记录
                  </h2>
                  <p class="text-xs text-slate-500 font-mono mt-1 break-all">
                    项目根目录: <span class="text-slate-400">{{ projectRootPath }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="scanSubdirs"
                    :disabled="loading"
                    class="p-2 border border-slate-800 hover:border-slate-700 rounded-lg bg-slate-900/50 text-slate-400 hover:text-slate-200 transition disabled:opacity-50 cursor-pointer"
                    title="手动刷新列表"
                  >
                    <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
                  </button>
                </div>
              </div>

              <!-- Empty child records -->
              <div v-if="scannedRuns.length === 0" class="border border-dashed border-slate-900 rounded-2xl p-12 text-center select-none mt-4">
                <AlertTriangle class="w-10 h-10 text-amber-500 mx-auto mb-4" />
                <h3 class="text-sm font-bold text-slate-300">未找到有效回测记录</h3>
                <p class="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                  当前目录下未扫描到包含 <code class="bg-slate-900 px-1 py-0.5 rounded text-[10px]">summary.json</code>、<code class="bg-slate-900 px-1 py-0.5 rounded text-[10px]">bars.parquet</code> 和 <code class="bg-slate-900 px-1 py-0.5 rounded text-[10px]">equity.parquet</code> 齐全的回测记录子文件夹。请检查目录是否正确，或重新运行回测。
                </p>
              </div>

              <!-- List display of runs -->
              <div v-else class="bg-slate-900/10 border border-slate-900 rounded-xl overflow-hidden shadow-lg">
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse font-mono text-xs text-left">
                    <thead>
                      <tr class="bg-slate-950/40 border-b border-slate-900 text-slate-500 font-bold select-none">
                        <th class="py-3.5 px-5">策略名称</th>
                        <th class="py-3.5 px-4">执行时间</th>
                        <th class="py-3.5 px-4">回测区间</th>
                        <th class="py-3.5 px-4 text-center">总收益 (PnL%(total))</th>
                        <th class="py-3.5 px-4 text-center">最大回撤</th>
                        <th class="py-3.5 px-4 text-center">胜率 (Win Rate)</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-900/50">
                      <tr
                        v-for="run in scannedRuns"
                        :key="run.id"
                        @click="selectRun(run)"
                        class="hover:bg-slate-900/40 transition duration-150 cursor-pointer group"
                      >
                        <!-- Strategy Name -->
                        <td class="py-4 px-5 font-bold">
                          <span class="text-orange-400 group-hover:text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20 text-[10px]">
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
                        <!-- Total Return -->
                        <td class="py-4 px-4 text-center font-bold">
                          <span :class="(run.summary?.total_return || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
                            {{ run.summary?.total_return != null ? ((run.summary.total_return >= 0 ? '+' : '') + (run.summary.total_return * 100).toFixed(2) + '%') : 'N/A' }}
                          </span>
                        </td>
                        <!-- Max Drawdown -->
                        <td class="py-4 px-4 text-center font-bold text-rose-400">
                          {{ run.summary?.max_drawdown != null ? (run.summary.max_drawdown * 100).toFixed(1) + '%' : 'N/A' }}
                        </td>
                        <!-- Win Rate -->
                        <td class="py-4 px-4 text-center font-bold text-slate-300">
                          {{ run.summary?.win_rate != null ? (run.summary.win_rate * 100).toFixed(1) + '%' : 'N/A' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Backtest Report View -->
          <div v-else-if="activeTab === 'report'" class="flex-1 flex flex-col min-h-0 bg-slate-950 relative">
            <iframe
              v-if="sidecarPortVal"
              :src="`http://127.0.0.1:${sidecarPortVal}/report.html`"
              class="w-full h-full border-none bg-white"
            ></iframe>
            <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-400 font-mono text-xs">
              <AlertTriangle class="w-8 h-8 text-amber-500 mb-2" />
              未检测到运行中的 Python 侧边服务器，无法加载 HTML 报告。
            </div>
          </div>

          <!-- 3. KLine Chart View -->
          <div v-else-if="activeTab === 'kline'" class="flex-1 flex min-h-0 bg-slate-950">
            <MultiChart
              :data="chartData"
              :folderName="folderName"
              :runPath="currentRunPath"
              :availableTimeframes="availableTimeframes"
              :initialTimeframe="loadedTimeframe"
              @load="loadData"
            />
          </div>
        </div>
      </div>

    </main>

    <!-- Footer Status Bar -->
    <footer class="h-8 shrink-0 bg-slate-950 border-t border-slate-900 px-6 flex items-center justify-between text-[10px] font-mono text-slate-500 select-none">
      <!-- Left side status -->
      <div class="flex items-center gap-4">
        <span class="flex items-center gap-1" :class="chartData ? 'text-amber-500' : 'text-slate-500'">
          <CheckCircle2 class="w-3.5 h-3.5 text-emerald-500" />
          {{ chartData ? '数据已载入' : '系统就绪' }}
        </span>
        <span class="flex items-center gap-1 text-slate-500">
          DUCKDB ENGINE ACTIVATED
        </span>
      </div>

      <!-- Right side versions -->
      <div class="flex items-center gap-4">
        <span>DUCKDB-WASM 1.0</span>
        <span>UTF-8</span>
        <span class="text-orange-500/80 font-bold">NautilusTrader Exporter v1.0</span>
      </div>
    </footer>
  </div>
</template>
