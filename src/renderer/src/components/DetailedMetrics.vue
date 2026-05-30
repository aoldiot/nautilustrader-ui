<script setup lang="ts">
import { computed } from 'vue'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Percent,
  Box,
  Calendar,
  Wallet,
  ArrowUpRight,
  ShieldAlert,
  Coins
} from 'lucide-vue-next'

const props = defineProps<{
  summary: Record<string, any> | null
  equity: any[]
  fills: any[]
  folderName: string | null
}>()

// Format helpers
const formatPercentage = (val?: number): string => {
  if (val === undefined || val === null) return '0.00%'
  const displayVal = Math.abs(val) < 1.01 && val !== 0 ? val * 100 : val
  return `${(val >= 0 ? '' : '-')}${displayVal.toFixed(2)}%`
}

const formatCurrency = (val?: number): string => {
  if (val === undefined || val === null) return '$0.00'
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Compute last updated time
const lastUpdateTime = computed(() => {
  const now = new Date()
  return now.toTimeString().split(' ')[0]
})

// Advanced calculations based on equity and fills
const stats = computed(() => {
  const eq = props.equity || []
  const fl = props.fills || []
  const s = props.summary || {}

  // 1. Initial Capital and Net Profit
  let initialCapital = 100000 // Default fallback
  const netProfit = s.net_profit ?? 0
  const totalReturn = s.total_return ?? 0

  if (eq.length > 0) {
    initialCapital = eq[0].equity
  } else if (totalReturn > 0) {
    initialCapital = netProfit / totalReturn
  }

  const currentEquity = eq.length > 0 ? eq[eq.length - 1].equity : (initialCapital + netProfit)

  // 2. Annualized Return calculation
  let annualizedReturn = 0
  if (eq.length > 1) {
    const minTime = eq[0].time // in seconds
    const maxTime = eq[eq.length - 1].time // in seconds
    const diffDays = (maxTime - minTime) / (24 * 3600)
    if (diffDays > 0) {
      // Annualized = (1 + totalReturn) ^ (365 / diffDays) - 1
      annualizedReturn = Math.pow(1 + totalReturn, 365 / diffDays) - 1
    }
  }

  // 3. Trade stats calculation (from fills)
  const tradesPnl: number[] = []
  const buyFills = fl.filter(f => f.side === 'BUY' || f.side === 'buy' || f.side === 1)
  const sellFills = fl.filter(f => f.side === 'SELL' || f.side === 'sell' || f.side === 2)
  const tradeCount = Math.min(buyFills.length, sellFills.length)

  let winsCount = 0
  let lossesCount = 0
  let totalWinAmt = 0
  let totalLossAmt = 0
  let currentStreak = 0
  let maxWinsStreak = 0
  let maxLossesStreak = 0
  let streakType: 'win' | 'loss' | null = null

  for (let i = 0; i < tradeCount; i++) {
    const buy = buyFills[i]
    const sell = sellFills[i]
    const pnl = sell.quantity * (sell.price - buy.price)
    tradesPnl.push(pnl)

    if (pnl > 0) {
      winsCount++
      totalWinAmt += pnl
      if (streakType === 'win') {
        currentStreak++
      } else {
        streakType = 'win'
        currentStreak = 1
      }
      maxWinsStreak = Math.max(maxWinsStreak, currentStreak)
    } else {
      lossesCount++
      totalLossAmt += Math.abs(pnl)
      if (streakType === 'loss') {
        currentStreak++
      } else {
        streakType = 'loss'
        currentStreak = 1
      }
      maxLossesStreak = Math.max(maxLossesStreak, currentStreak)
    }
  }

  const avgWinAmt = winsCount > 0 ? totalWinAmt / winsCount : 0
  const avgLossAmt = lossesCount > 0 ? totalLossAmt / lossesCount : 0
  const profitLossRatio = avgLossAmt > 0 ? avgWinAmt / avgLossAmt : 0

  // 4. Portfolio Quality details
  // Max drawdown duration (recovery period)
  let maxDrawdownDuration = 0 // in seconds
  let peakEquity = 0
  let peakTime = 0
  for (let i = 0; i < eq.length; i++) {
    const currentEq = eq[i].equity
    const currentTime = eq[i].time
    if (currentEq >= peakEquity) {
      if (peakEquity > 0) {
        const duration = currentTime - peakTime
        maxDrawdownDuration = Math.max(maxDrawdownDuration, duration)
      }
      peakEquity = currentEq
      peakTime = currentTime
    }
  }
  const recoveryDays = Math.ceil(maxDrawdownDuration / (24 * 3600))

  // Total fees (assuming 0.04% per fill as mock transaction cost)
  const totalFees = fl.reduce((sum, f) => sum + f.price * f.quantity * 0.0004, 0)

  return {
    initialCapital,
    currentEquity,
    annualizedReturn,
    winsCount,
    lossesCount,
    avgWinAmt,
    avgLossAmt,
    profitLossRatio,
    maxWinsStreak,
    maxLossesStreak,
    recoveryDays,
    totalFees
  }
})

// Top KPI cards structure
const kpiCards = computed(() => {
  const s = props.summary || {}
  
  return [
    {
      title: '累计净收益',
      value: formatPercentage(s.total_return),
      icon: TrendingUp,
      color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
      glow: 'shadow-emerald-500/5'
    },
    {
      title: '最大资产回撤',
      value: formatPercentage(s.max_drawdown),
      icon: TrendingDown,
      color: 'text-rose-400 border-rose-500/20 bg-rose-500/5',
      glow: 'shadow-rose-500/5'
    },
    {
      title: '夏普比率 (SHARPE)',
      value: s.sharpe_ratio?.toFixed(2) ?? '0',
      icon: Activity,
      color: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
      glow: 'shadow-blue-500/5'
    },
    {
      title: '交易执行胜率',
      value: formatPercentage(s.win_rate),
      icon: Percent,
      color: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
      glow: 'shadow-amber-500/5'
    },
    {
      title: '回测交易总数',
      value: s.total_trades ?? '0',
      icon: Box,
      color: 'text-slate-400 border-slate-500/20 bg-slate-500/5',
      glow: 'shadow-slate-500/5'
    },
    {
      title: '年化收益率',
      value: formatPercentage(stats.value.annualizedReturn),
      icon: Calendar,
      color: 'text-emerald-500 border-emerald-500/10 bg-emerald-500/5',
      glow: 'shadow-emerald-500/5'
    },
    {
      title: '当前账户净值',
      value: formatCurrency(stats.value.currentEquity),
      icon: Wallet,
      color: 'text-slate-300 border-slate-500/20 bg-slate-500/5',
      glow: 'shadow-slate-500/5'
    },
    {
      title: '初始投入金额',
      value: formatCurrency(stats.value.initialCapital),
      icon: ArrowUpRight,
      color: 'text-slate-400 border-slate-500/20 bg-slate-500/5',
      glow: 'shadow-slate-500/5'
    }
  ]
})
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-slate-950 px-6 py-4 overflow-y-auto select-none text-xs">
    
    <!-- Meta Bar -->
    <div class="flex items-center justify-between mb-6">
      <div v-if="folderName" class="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-1 text-[10px] text-slate-400 font-mono">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span>数据源: {{ folderName }}</span>
      </div>
      <div v-else class="text-slate-500 font-mono text-[10px]">
        未加载数据源
      </div>

      <div class="text-slate-500 font-mono text-[10px]">
        结果更新于: {{ lastUpdateTime }}
      </div>
    </div>

    <!-- Title Section -->
    <div class="flex items-center gap-2 mb-6">
      <Activity class="w-4 h-4 text-orange-500" />
      <h2 class="text-sm font-bold text-slate-100 uppercase tracking-wider">核心业绩指标</h2>
    </div>

    <!-- KPIs Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div
        v-for="card in kpiCards"
        :key="card.title"
        class="relative overflow-hidden rounded-xl border border-slate-900 bg-slate-900/40 backdrop-blur-md px-4 py-3 flex flex-col justify-between transition-all duration-300 hover:translate-y-[-2px] hover:border-slate-800 shadow-md"
        :class="card.glow"
      >
        <div class="absolute top-0 left-0 right-0 h-[2px]" :class="card.color.split(' ')[2]"></div>
        
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{{ card.title }}</span>
          <component :is="card.icon" class="w-3.5 h-3.5" :class="card.color.split(' ')[0]" />
        </div>
        
        <div class="text-lg font-bold tracking-tight text-slate-100 font-mono mt-1">
          {{ card.value }}
        </div>
      </div>
    </div>

    <!-- Details Columns -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      
      <!-- Column 1: Trade Stats -->
      <div class="bg-slate-900/20 border border-slate-900/60 rounded-xl p-5">
        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-900 pb-3 mb-4 flex items-center gap-2">
          <Coins class="w-4 h-4 text-orange-500/70" />
          交易概况 (TRADE STATS)
        </h3>
        
        <div class="grid grid-cols-2 gap-y-5 gap-x-6">
          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">总盈利笔数</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ stats.winsCount }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">总亏损笔数</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ stats.lossesCount }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">平均盈利额</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ formatCurrency(stats.avgWinAmt) }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">平均亏损额</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ formatCurrency(stats.avgLossAmt) }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">盈亏比 (P/L RATIO)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ stats.profitLossRatio.toFixed(2) }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">盈亏平衡系数</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ summary?.profit_factor?.toFixed(2) ?? '1.00' }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">最大连胜次数</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ stats.maxWinsStreak }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">最大连败次数</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ stats.maxLossesStreak }}</span>
          </div>
        </div>
      </div>

      <!-- Column 2: Portfolio Quality -->
      <div class="bg-slate-900/20 border border-slate-900/60 rounded-xl p-5">
        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-900 pb-3 mb-4 flex items-center gap-2">
          <ShieldAlert class="w-4 h-4 text-orange-500/70" />
          投资组合质量 (PORTFOLIO QUALITY)
        </h3>

        <div class="grid grid-cols-2 gap-y-5 gap-x-6">
          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">阿尔法 (ALPHA)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">0.00</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">贝塔 (BETA)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">1.00</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">索提诺比率 (SORTINO)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ summary?.sortino_ratio?.toFixed(2) ?? '0.00' }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">信息比率 (INFO RATIO)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">0.00</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">跟踪误差 (TRACKING ERR)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">0.00</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">风险价值 (VAR 95%)</span>
            <span class="text-slate-200 text-sm font-bold font-mono">0.00</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">回测恢复周期</span>
            <span class="text-slate-200 text-sm font-bold font-mono">
              {{ isNaN(stats.recoveryDays) ? 'undefined' : stats.recoveryDays }} 天
            </span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-slate-500 text-[10px] uppercase font-semibold">账户总手续费</span>
            <span class="text-slate-200 text-sm font-bold font-mono">{{ formatCurrency(stats.totalFees) }}</span>
          </div>
        </div>
      </div>

    </div>

  </div>
</template>
