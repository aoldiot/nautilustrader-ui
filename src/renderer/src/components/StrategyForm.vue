<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Rocket, FolderOpen } from 'lucide-vue-next'

interface ScannedParameter {
  name: string
  type: 'int' | 'float' | 'bool' | 'str' | 'any'
  defaultValue: any
}

interface ScannedStrategy {
  fileName: string
  filePath: string
  className: string
  configClassName?: string
  parameters: ScannedParameter[]
}

const emit = defineEmits<{
  (e: 'submit', params: {
    symbol: string
    startDate: string
    endDate: string
    initialCapital: number
    fastPeriod: number
    slowPeriod: number
    strategyClass?: string
    strategyPath?: string
    strategyParams?: Record<string, any>
  }): void
}>()

const strategy = ref('')
const symbol = ref('ADAUSDT')
const venue = ref('binance_futures')
const initialCapital = ref(100000)
const startDate = ref('2026-04-01')
const endDate = ref('2026-04-22')

// Strategy project directory scanner refs
const projectPath = ref<string | null>(null)
const strategiesList = ref<ScannedStrategy[]>([])

const formError = ref<string | null>(null)

// Current custom strategy definition
const selectedCustomStrategy = computed(() => {
  return strategiesList.value.find(s => s.className === strategy.value)
})

// Custom strategy parameter values input dictionary
const strategyParamsValues = ref<Record<string, any>>({})

// Initialize strategy parameter values whenever selection changes
watch(strategy, (newVal) => {
  if (newVal) {
    const strat = strategiesList.value.find(s => s.className === newVal)
    if (strat) {
      const vals: Record<string, any> = {}
      for (const p of strat.parameters) {
        if (p.type === 'any' && Array.isArray(p.defaultValue)) {
          vals[p.name] = JSON.stringify(p.defaultValue)
        } else if (p.type === 'any' && typeof p.defaultValue === 'object' && p.defaultValue !== null) {
          vals[p.name] = JSON.stringify(p.defaultValue)
        } else {
          vals[p.name] = p.defaultValue !== undefined ? p.defaultValue : ''
        }
      }
      strategyParamsValues.value = vals
    }
  } else {
    strategyParamsValues.value = {}
  }
})

async function selectProjectPath() {
  try {
    formError.value = null
    const path = await window.nautilusAPI.selectProjectDir()
    if (path) {
      projectPath.value = path
      const list = await window.nautilusAPI.scanStrategies(path)
      strategiesList.value = list
      if (list.length > 0) {
        strategy.value = list[0].className
        
        // Initialize parameters immediately
        const firstStrat = list[0]
        const vals: Record<string, any> = {}
        for (const p of firstStrat.parameters) {
          if (p.type === 'any' && Array.isArray(p.defaultValue)) {
            vals[p.name] = JSON.stringify(p.defaultValue)
          } else if (p.type === 'any' && typeof p.defaultValue === 'object' && p.defaultValue !== null) {
            vals[p.name] = JSON.stringify(p.defaultValue)
          } else {
            vals[p.name] = p.defaultValue !== undefined ? p.defaultValue : ''
          }
        }
        strategyParamsValues.value = vals
      } else {
        strategy.value = ''
      }
    }
  } catch (err: any) {
    formError.value = err.message || '选择项目目录失败'
    console.error(err)
  }
}

onMounted(async () => {
  try {
    const savedPath = await window.nautilusAPI.getStoredProjectDir()
    if (savedPath) {
      projectPath.value = savedPath
      const list = await window.nautilusAPI.scanStrategies(savedPath)
      strategiesList.value = list
      if (list.length > 0) {
        strategy.value = list[0].className
        
        // Initialize parameters immediately
        const firstStrat = list[0]
        const vals: Record<string, any> = {}
        for (const p of firstStrat.parameters) {
          if (p.type === 'any' && Array.isArray(p.defaultValue)) {
            vals[p.name] = JSON.stringify(p.defaultValue)
          } else if (p.type === 'any' && typeof p.defaultValue === 'object' && p.defaultValue !== null) {
            vals[p.name] = JSON.stringify(p.defaultValue)
          } else {
            vals[p.name] = p.defaultValue !== undefined ? p.defaultValue : ''
          }
        }
        strategyParamsValues.value = vals
      } else {
        strategy.value = ''
      }
    }
  } catch (err) {
    console.error('Failed to load stored project path:', err)
  }
})

function triggerBacktest() {
  formError.value = null
  
  if (!symbol.value.trim()) {
    formError.value = '请输入或选择交易标的代码'
    return
  }
  if (!startDate.value || !endDate.value) {
    formError.value = '请选择完整的开始与结束日期'
    return
  }
  if (new Date(startDate.value) >= new Date(endDate.value)) {
    formError.value = '开始日期必须早于结束日期'
    return
  }
  if (initialCapital.value <= 0) {
    formError.value = '初始资金必须大于 0'
    return
  }
  if (!strategy.value) {
    formError.value = '请选择一个策略进行回测'
    return
  }

  // Find if custom strategy is selected
  const customStrat = strategiesList.value.find(s => s.className === strategy.value)
  if (!customStrat) {
    formError.value = '未找到所选策略，请重新选择'
    return
  }

  const submittedParams: Record<string, any> = {}

  for (const [key, val] of Object.entries(strategyParamsValues.value)) {
    const paramDef = customStrat.parameters.find(p => p.name === key)
    if (paramDef) {
      if (paramDef.type === 'int') {
        submittedParams[key] = parseInt(val as string, 10) || 0
      } else if (paramDef.type === 'float') {
        submittedParams[key] = parseFloat(val as string) || 0.0
      } else if (paramDef.type === 'bool') {
        submittedParams[key] = !!val
      } else if (paramDef.type === 'any' && typeof val === 'string') {
        const trimmed = val.trim()
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
          try {
            submittedParams[key] = JSON.parse(trimmed)
          } catch {
            submittedParams[key] = val
          }
        } else {
          submittedParams[key] = val
        }
      } else {
        submittedParams[key] = val
      }
    } else {
      submittedParams[key] = val
    }
  }

  emit('submit', {
    symbol: symbol.value.trim().toUpperCase(),
    startDate: startDate.value,
    endDate: endDate.value,
    initialCapital: initialCapital.value,
    fastPeriod: 5,
    slowPeriod: 10,
    strategyClass: customStrat.className,
    strategyPath: customStrat.filePath,
    strategyParams: submittedParams
  })
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-slate-950 px-6 py-4 overflow-y-auto text-xs select-none">
    
    <!-- Top Configuration Header & Play Button -->
    <div class="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
      <div>
        <h2 class="text-sm font-bold text-slate-100 uppercase tracking-wider">回测环境配置</h2>
        <p class="text-[10px] text-slate-500 font-mono mt-0.5">NautilusTrader Core Engine (Virtual Simulation)</p>
      </div>

      <button
        @click="triggerBacktest"
        class="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold shadow-lg hover:shadow-orange-600/15 border border-orange-500/50 hover:border-orange-400/50 transition duration-200"
      >
        <Rocket class="w-4 h-4" />
        启动回测
      </button>
    </div>

    <!-- Error Alert -->
    <div v-if="formError" class="mb-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl font-mono">
      {{ formError }}
    </div>

    <!-- Strategy Project Selector Panel -->
    <div class="flex items-center gap-4 bg-slate-900/30 border border-slate-900 rounded-xl p-4 mb-6 max-w-5xl">
      <div class="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
        <FolderOpen class="w-5 h-5" />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-slate-500 block uppercase font-bold text-[9px] tracking-wide mb-1">策略项目文件夹目录 (Project Directory)</span>
        <span class="text-xs truncate block font-mono" :class="projectPath ? 'text-slate-200 font-semibold' : 'text-slate-600 italic'" :title="projectPath || ''">
          {{ projectPath || '未关联外部项目。选择项目路径可以读取您自己编写的 NautilusTrader 策略...' }}
        </span>
      </div>
      <button
        @click="selectProjectPath"
        class="flex items-center gap-1.5 px-4 py-2 border border-slate-800 hover:border-slate-700 bg-slate-900/60 rounded-lg text-xs font-semibold text-slate-300 transition duration-150"
      >
        选择项目路径
      </button>
    </div>

    <!-- Form Section -->
    <div class="flex flex-col gap-8 max-w-5xl">
      
      <!-- 1. Basic configuration -->
      <div class="flex flex-col gap-5">
        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider border-l-2 border-orange-500 pl-2">
          基础回测配置
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <!-- Strategy Selection -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">选择策略</label>
            <div class="relative">
              <select
                v-model="strategy"
                class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none appearance-none cursor-pointer"
              >
                <!-- Default options -->
                <option v-if="strategiesList.length === 0" value="">请选择项目路径以加载策略...</option>
                <option v-else-if="!strategy" value="">-- 请选择策略 --</option>
                
                <!-- Dynamic strategies -->
                <option
                  v-for="strat in strategiesList"
                  :key="strat.className + '-' + strat.fileName"
                  :value="strat.className"
                >
                  {{ strat.className }} (来自 {{ strat.fileName }})
                </option>
              </select>
              <div class="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-500">▼</div>
            </div>
          </div>

          <!-- Symbol Selection -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">选择标的</label>
            <div class="relative">
              <select
                v-model="symbol"
                class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none appearance-none cursor-pointer font-mono"
              >
                <option value="ADAUSDT">ADAUSDT</option>
                <option value="BTC-USD">BTC-USD (比特币/美元)</option>
                <option value="ETH-USD">ETH-USD (以太坊/美元)</option>
                <option value="AAPL">AAPL (苹果公司股票)</option>
                <option value="TSLA">TSLA (特斯拉股票)</option>
              </select>
              <div class="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-500">▼</div>
            </div>
          </div>

          <!-- Venue Config -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">配置交易所</label>
            <div class="relative">
              <select
                v-model="venue"
                class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none appearance-none cursor-pointer"
              >
                <option value="binance_futures">Binance Futures (币安合约)</option>
                <option value="binance_spot">Binance Spot (币安现货)</option>
                <option value="nasdaq">NASDAQ (纳斯达克证券交易所)</option>
              </select>
              <div class="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-500">▼</div>
            </div>
          </div>

          <!-- Initial Capital -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">初始资金 (USD)</label>
            <div class="relative">
              <input
                v-model.number="initialCapital"
                type="number"
                class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none font-mono"
              />
              <div class="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-500 font-mono">$</div>
            </div>
          </div>

          <!-- Start Date -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">开始日期</label>
            <input
              v-model="startDate"
              type="date"
              class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none font-mono"
            />
          </div>

          <!-- End Date -->
          <div class="flex flex-col gap-1.5">
            <label class="text-slate-500 font-semibold uppercase tracking-wider">结束日期</label>
            <input
              v-model="endDate"
              type="date"
              class="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none font-mono"
            />
          </div>
        </div>
      </div>

      <!-- 2. Custom Parameters -->
      <div class="flex flex-col gap-5 border-t border-slate-900 pt-6">
        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider border-l-2 border-orange-500 pl-2">
          策略自定义参数
        </h3>

        <!-- Dynamic Custom Strategy Parameters -->
        <div v-if="selectedCustomStrategy" class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <div
            v-for="param in selectedCustomStrategy.parameters"
            :key="param.name"
            class="flex flex-col gap-1.5 bg-slate-900/40 border border-slate-900 rounded-xl p-3.5"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-slate-300 font-bold uppercase tracking-wider font-mono text-[10px]">{{ param.name }}</span>
              <span class="text-slate-500 text-[9px] font-mono capitalize px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-900">
                {{ param.type }}
              </span>
            </div>

            <!-- Boolean Type checkbox -->
            <div v-if="param.type === 'bool'" class="flex items-center gap-3 mt-1.5 py-1">
              <input
                v-model="strategyParamsValues[param.name]"
                type="checkbox"
                class="w-4 h-4 accent-orange-600 rounded bg-slate-950 border border-slate-850 cursor-pointer"
              />
              <span class="text-slate-400 font-medium">启用此配置项</span>
            </div>

            <!-- Number types (int, float) -->
            <input
              v-else-if="param.type === 'int' || param.type === 'float'"
              v-model.number="strategyParamsValues[param.name]"
              type="number"
              :step="param.type === 'float' ? '0.01' : '1'"
              class="bg-slate-950 border border-slate-850 focus:border-slate-755 rounded-lg px-3 py-2 text-slate-200 font-mono outline-none"
            />

            <!-- Any / List / Dict text input with instruction -->
            <div v-else-if="param.type === 'any'" class="flex flex-col gap-1">
              <input
                v-model="strategyParamsValues[param.name]"
                type="text"
                class="bg-slate-950 border border-slate-850 focus:border-slate-755 rounded-lg px-3 py-2 text-slate-200 font-mono outline-none"
                placeholder='例如: ["BTCUSDT-PERP.BINANCE"] 或 {"key": "val"}'
              />
              <span class="text-[9px] text-slate-500 font-mono">复合参数，请输入 JSON 数组、对象或逗号分隔的值。</span>
            </div>

            <!-- Standard string input -->
            <input
              v-else
              v-model="strategyParamsValues[param.name]"
              type="text"
              class="bg-slate-950 border border-slate-850 focus:border-slate-755 rounded-lg px-3 py-2 text-slate-200 font-mono outline-none"
            />
          </div>
        </div>

        <!-- No strategy selected message -->
        <div v-else class="text-slate-500 font-mono text-center py-6 bg-slate-900/10 border border-dashed border-slate-900 rounded-xl">
          请在上方选择有效的策略以加载参数配置。
        </div>
      </div>

    </div>
  </div>
</template>
