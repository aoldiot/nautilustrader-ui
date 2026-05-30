<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  Database,
  Download,
  FolderOpen,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Play,
  Terminal
} from 'lucide-vue-next'

const projectPath = ref<string | null>(null)
const coverageData = ref<any[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Filtering state
const activeTab = ref('All')
const tabsList = computed(() => {
  const tfs = new Set<string>()
  tfs.add('All')
  coverageData.value.forEach(item => {
    if (item.timeframe) {
      tfs.add(item.timeframe)
    }
  })
  const sorted = Array.from(tfs).filter(t => t !== 'All').sort((a, b) => {
    const getWeight = (tf: string) => {
      const num = parseInt(tf, 10) || 1
      if (tf.endsWith('m')) return num
      if (tf.endsWith('h')) return num * 60
      if (tf.endsWith('d')) return num * 1440
      if (tf.endsWith('w')) return num * 10080
      return 999999
    }
    return getWeight(a) - getWeight(b)
  })
  return ['All', ...sorted]
})

const filteredCoverageData = computed(() => {
  if (activeTab.value === 'All') {
    return coverageData.value
  }
  return coverageData.value.filter(item => item.timeframe === activeTab.value)
})

// Download form state
const startDate = ref('2024-01-01')
const endDate = ref('2026-01-01')
const pairs = ref('') // e.g. "BTC/USDT:USDT,ETH/USDT:USDT"
const syncMode = ref('recommended') // 'recommended' or 'custom'
const selectedTimeframes = ref<string[]>(['1m', '15m', '1h', '4h'])
const availableTimeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w']
const downloadLoading = ref(false)
const downloadLogs = ref<string[]>([])
const terminalContainer = ref<HTMLDivElement | null>(null)

onMounted(async () => {
  await loadProjectPath()
})

async function loadProjectPath() {
  try {
    const path = await window.nautilusAPI.getStoredProjectDir()
    if (path) {
      projectPath.value = path
      await refreshCoverage()
    }
  } catch (err: any) {
    error.value = err.message || '加载项目路径失败'
  }
}

async function selectProject() {
  try {
    error.value = null
    const path = await window.nautilusAPI.selectProjectDir()
    if (path) {
      projectPath.value = path
      await refreshCoverage()
    }
  } catch (err: any) {
    error.value = err.message || '选择项目路径失败'
  }
}

async function refreshCoverage() {
  if (!projectPath.value) return
  loading.value = true
  error.value = null
  try {
    coverageData.value = await window.nautilusAPI.getDataCoverage(projectPath.value)
  } catch (err: any) {
    error.value = err.message || '读取本地数据覆盖情况失败'
  } finally {
    loading.value = false
  }
}

async function startDownload() {
  if (!projectPath.value) {
    error.value = '请先选择策略项目目录'
    return
  }

  if (syncMode.value === 'custom' && selectedTimeframes.value.length === 0) {
    error.value = '请至少选择一个K线周期进行下载'
    return
  }
  
  downloadLoading.value = true
  downloadLogs.value = []
  error.value = null
  
  const unsubscribe = window.nautilusAPI.onDownloadLog((log) => {
    downloadLogs.value.push(log)
    if (terminalContainer.value) {
      setTimeout(() => {
        if (terminalContainer.value) {
          terminalContainer.value.scrollTop = terminalContainer.value.scrollHeight
        }
      }, 50)
    }
  })
  
  let tfParam: string | undefined = undefined
  if (syncMode.value === 'custom') {
    tfParam = selectedTimeframes.value.join(',')
  }

  try {
    await window.nautilusAPI.downloadData({
      projectPath: projectPath.value,
      startDate: startDate.value,
      endDate: endDate.value,
      pairs: pairs.value.trim() || undefined,
      timeframes: tfParam
    })
    downloadLogs.value.push('\n[系统] 数据同步补全成功结束！\n')
    await refreshCoverage()
  } catch (err: any) {
    downloadLogs.value.push(`\n[错误] 数据下载失败: ${err.message}\n`)
    error.value = err.message || '数据下载过程中发生错误'
  } finally {
    downloadLoading.value = false
    unsubscribe()
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 overflow-y-auto">
    <div class="max-w-6xl w-full mx-auto flex flex-col gap-6">
      
      <!-- Top Header & Dir Selector -->
      <div class="bg-slate-900/40 border border-slate-900 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex-1">
          <h2 class="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Database class="w-4 h-4 text-orange-500" />
            本地回测数据源管理
          </h2>
          <div class="text-xs text-slate-400 mt-2 font-mono break-all flex items-center gap-1.5">
            <span>策略项目目录:</span>
            <span v-if="projectPath" class="text-indigo-400 font-semibold">{{ projectPath }}</span>
            <span v-else class="text-slate-600">（未设置项目路径，请选择包含 download_data.py 的项目根目录）</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="selectProject"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition cursor-pointer"
          >
            <FolderOpen class="w-3.5 h-3.5 text-orange-500" />
            选择项目目录
          </button>
          <button
            v-if="projectPath"
            @click="refreshCoverage"
            :disabled="loading"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw class="w-3.5 h-3.5 text-orange-500" :class="{ 'animate-spin': loading }" />
            刷新覆盖状态
          </button>
        </div>
      </div>

      <!-- Main Columns -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        <!-- Left: Local Data Coverage Table (7 cols) -->
        <div class="lg:col-span-7 flex flex-col gap-4">
          <div class="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-5">
            <h3 class="text-xs font-bold text-slate-300 mb-4 flex items-center justify-between">
              <span>本地 Parquet 数据文件列表</span>
              <span v-if="coverageData.length" class="text-[10px] text-slate-500 font-mono">
                当前筛选/共检测到: {{ filteredCoverageData.length }}/{{ coverageData.length }} 个数据流
              </span>
            </h3>

            <!-- Errors on scanning -->
            <div v-if="error" class="mb-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-[11px] rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
              <span class="font-mono">{{ error }}</span>
            </div>

            <!-- Tabs filters -->
            <div v-if="projectPath && coverageData.length > 0" class="flex gap-2 mb-4 border-b border-slate-900 pb-2.5 shrink-0">
              <button
                v-for="tab in tabsList"
                :key="tab"
                @click="activeTab = tab"
                class="px-2.5 py-1 rounded text-[10px] font-mono transition cursor-pointer font-bold animate-fade-in"
                :class="activeTab === tab ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'bg-slate-950/40 text-slate-500 hover:text-slate-300 border border-slate-900'"
              >
                {{ tab === 'All' ? '全部' : tab }}
              </button>
            </div>

            <!-- Empty status -->
            <div v-if="!projectPath" class="py-12 text-center text-slate-500 text-xs font-mono">
              请先在上方关联你的策略项目目录以扫描本地数据。
            </div>
            <div v-else-if="loading" class="py-12 flex flex-col items-center justify-center gap-3">
              <div class="w-6 h-6 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin"></div>
              <span class="text-xs text-slate-500 font-mono">正在读取本地 Parquet 文件的元数据...</span>
            </div>
            <div v-else-if="coverageData.length === 0" class="py-12 text-center text-slate-500 text-xs font-mono">
              项目 `data/binance/futures` 目录下暂无任何 .parquet 数据文件。
            </div>

            <!-- Table -->
            <div v-else class="overflow-x-auto">
              <table class="w-full text-left font-mono text-[11px] border-collapse">
                <thead>
                  <tr class="border-b border-slate-900/80 text-slate-500">
                    <th class="pb-2 font-semibold">交易标的</th>
                    <th class="pb-2 font-semibold">时间周期</th>
                    <th class="pb-2 font-semibold">覆盖起止时间</th>
                    <th class="pb-2 font-semibold text-right">K线数量</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-900/40">
                  <tr v-for="item in filteredCoverageData" :key="item.file" class="text-slate-300 hover:bg-slate-900/20">
                    <td class="py-2.5 font-bold flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {{ item.symbol }}
                    </td>
                    <td class="py-2.5">
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-bold"
                            :class="item.timeframe === '1m' ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400' : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'">
                        {{ item.timeframe }}
                      </span>
                    </td>
                    <td class="py-2.5 text-slate-400 text-[10px]">
                      <div class="flex items-center gap-1">
                        <Calendar class="w-3 h-3 text-slate-600" />
                        <span>{{ item.start }}</span>
                        <span class="text-slate-600">→</span>
                        <span>{{ item.end }}</span>
                      </div>
                    </td>
                    <td class="py-2.5 text-right text-slate-400">
                      {{ item.count?.toLocaleString() || 'N/A' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>

        <!-- Right: Download Form & Logs (5 cols) -->
        <div class="lg:col-span-5 flex flex-col gap-6">
          <!-- Form -->
          <div class="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-5">
            <h3 class="text-xs font-bold text-slate-300 mb-4 flex items-center gap-1.5">
              <Download class="w-4 h-4 text-orange-500" />
              直接下载/补全数据
            </h3>
            
            <div class="flex flex-col gap-4 text-xs">
              <!-- Start Date -->
              <div class="flex flex-col gap-1.5">
                <label class="text-slate-400 font-mono">起始时间 (START_DATE):</label>
                <input
                  v-model="startDate"
                  type="date"
                  class="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <!-- End Date -->
              <div class="flex flex-col gap-1.5">
                <label class="text-slate-400 font-mono">结束时间 (END_DATE):</label>
                <input
                  v-model="endDate"
                  type="date"
                  class="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <!-- Pairs -->
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between items-center">
                  <label class="text-slate-400 font-mono">指定币种（可选）:</label>
                  <span class="text-[9px] text-slate-600 font-mono">留空则同步配置中的全部标的</span>
                </div>
                <input
                  v-model="pairs"
                  type="text"
                  placeholder="如: BTC/USDT:USDT,ETH/USDT:USDT"
                  class="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 font-mono animate-fade-in"
                />
              </div>

              <!-- Sync Mode Selection -->
              <div class="flex flex-col gap-1.5 border border-slate-900/40 bg-slate-900/10 rounded-xl p-3.5">
                <label class="text-slate-400 font-mono">同步模式:</label>
                <div class="flex gap-4">
                  <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 font-mono text-[11px]">
                    <input type="radio" value="recommended" v-model="syncMode" class="text-indigo-600 focus:ring-indigo-500 bg-slate-950 border-slate-800 cursor-pointer" />
                    推荐周期 (1m/1h/4h)
                  </label>
                  <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 font-mono text-[11px]">
                    <input type="radio" value="custom" v-model="syncMode" class="text-indigo-600 focus:ring-indigo-500 bg-slate-950 border-slate-800 cursor-pointer" />
                    自定义多选周期
                  </label>
                </div>
              </div>

              <!-- Checkboxes for Custom Timeframes -->
              <div v-if="syncMode === 'custom'" class="flex flex-col gap-2 border border-slate-900 bg-slate-950/40 rounded-xl p-3.5 animate-fade-in">
                <div class="flex justify-between items-center">
                  <label class="text-slate-300 font-mono text-[11px] font-bold">选择K线周期 (多选):</label>
                  <button 
                    type="button"
                    @click="selectedTimeframes = [...availableTimeframes]"
                    class="text-[9px] text-indigo-400 hover:text-indigo-300 cursor-pointer underline font-mono"
                  >
                    全选
                  </button>
                </div>
                <div class="grid grid-cols-4 gap-2 mt-1">
                  <label v-for="tf in availableTimeframes" :key="tf" class="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 cursor-pointer hover:text-white">
                    <input type="checkbox" :value="tf" v-model="selectedTimeframes" class="rounded text-indigo-600 focus:ring-indigo-500 bg-slate-950 border-slate-800 cursor-pointer" />
                    {{ tf }}
                  </label>
                </div>
              </div>

              <!-- Trigger Button -->
              <button
                @click="startDownload"
                :disabled="downloadLoading || !projectPath"
                class="flex items-center justify-center gap-2 w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl transition duration-200 cursor-pointer disabled:opacity-50 border border-orange-500/30"
              >
                <Play v-if="!downloadLoading" class="w-3.5 h-3.5 fill-current" />
                <div v-else class="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
                {{ downloadLoading ? '正在同步下载数据...' : '启动数据补全任务' }}
              </button>
            </div>
          </div>

          <!-- Logs Console -->
          <div class="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-5 flex flex-col h-80 min-h-0">
            <h3 class="text-xs font-bold text-slate-300 mb-3 flex items-center gap-1.5 shrink-0">
              <Terminal class="w-4 h-4 text-orange-500" />
              下载终端输出
            </h3>
            
            <div
              ref="terminalContainer"
              class="flex-1 bg-slate-950 border border-slate-900 rounded-lg p-3 font-mono text-[10px] text-slate-400 overflow-y-auto whitespace-pre-wrap selection:bg-indigo-500/30"
            >
              <div v-if="downloadLogs.length === 0" class="text-slate-700 text-center py-20">
                等待下载任务启动...
              </div>
              <div v-else v-for="(log, idx) in downloadLogs" :key="idx" class="leading-relaxed">
                {{ log }}
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  </div>
</template>
