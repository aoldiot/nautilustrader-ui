<script setup lang="ts">
import { computed } from 'vue'
import {
  TrendingUp,
  Activity,
  TrendingDown,
  Percent,
  Coins,
  ReceiptCent
} from 'lucide-vue-next'

const props = defineProps<{
  summary: Record<string, any> | null
}>()

// Helper to format values dynamically based on key names
const formatValue = (key: string, val: any): string => {
  if (val === undefined || val === null) return '--'
  if (typeof val === 'number') {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('rate') || lowerKey.includes('drawdown') || lowerKey.includes('ratio_pct')) {
      // If percentage is between 0 and 1, convert to %
      const displayVal = Math.abs(val) < 1.01 && val !== 0 ? val * 100 : val
      return `${displayVal.toFixed(2)}%`
    }
    if (lowerKey.includes('profit') || lowerKey.includes('return') || lowerKey.includes('pnl')) {
      const prefix = val >= 0 ? '+' : ''
      return `${prefix}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    return val.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return String(val)
}

// Compute structured KPIs from the raw summary object
const kpis = computed(() => {
  if (!props.summary) return []

  const s = props.summary
  
  // Find fields case-insensitively
  const getVal = (keys: string[]) => {
    for (const k of keys) {
      if (s[k] !== undefined) return { key: k, value: s[k] }
      // Try lowercase matching
      const foundKey = Object.keys(s).find(x => x.toLowerCase() === k.toLowerCase())
      if (foundKey) return { key: foundKey, value: s[foundKey] }
    }
    return null
  }

  const rawSharpe = getVal(['sharpe_ratio', 'sharpe', 'Sharpe Ratio'])
  const rawSortino = getVal(['sortino_ratio', 'sortino', 'Sortino Ratio'])
  const rawDrawdown = getVal(['max_drawdown', 'max_drawdown_pct', 'Max Drawdown'])
  const rawWinRate = getVal(['win_rate', 'win_rate_pct', 'win_percent', 'Win Rate'])
  const rawProfitFactor = getVal(['profit_factor', 'profit_loss_ratio', 'Profit Factor'])
  const rawTotalTrades = getVal(['total_trades', 'total_fills', 'trades_count', 'Total Fills'])

  const list = [
    {
      label: '夏普比率',
      value: rawSharpe ? formatValue(rawSharpe.key, rawSharpe.value) : '--',
      icon: TrendingUp,
      color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
      glow: 'shadow-emerald-500/5'
    },
    {
      label: '索提诺比率',
      value: rawSortino ? formatValue(rawSortino.key, rawSortino.value) : '--',
      icon: Activity,
      color: 'text-teal-400 border-teal-500/20 bg-teal-500/5',
      glow: 'shadow-teal-500/5'
    },
    {
      label: '最大回撤',
      value: rawDrawdown ? formatValue(rawDrawdown.key, rawDrawdown.value) : '--',
      icon: TrendingDown,
      color: 'text-rose-400 border-rose-500/20 bg-rose-500/5',
      glow: 'shadow-rose-500/5'
    },
    {
      label: '胜率',
      value: rawWinRate ? formatValue(rawWinRate.key, rawWinRate.value) : '--',
      icon: Percent,
      color: 'text-indigo-400 border-indigo-500/20 bg-indigo-500/5',
      glow: 'shadow-indigo-500/5'
    },
    {
      label: '盈亏比',
      value: rawProfitFactor ? formatValue(rawProfitFactor.key, rawProfitFactor.value) : '--',
      icon: Coins,
      color: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
      glow: 'shadow-amber-500/5'
    },
    {
      label: '成交笔数',
      value: rawTotalTrades ? formatValue(rawTotalTrades.key, rawTotalTrades.value) : '--',
      icon: ReceiptCent,
      color: 'text-slate-400 border-slate-500/20 bg-slate-500/5',
      glow: 'shadow-slate-500/5'
    }
  ]

  // Add any extra custom fields that were not captured above
  const capturedKeys = new Set(
    [rawSharpe, rawSortino, rawDrawdown, rawWinRate, rawProfitFactor, rawTotalTrades]
      .filter(Boolean)
      .map(x => x!.key)
  )

  const extraKpis: typeof list = []
  Object.entries(s).forEach(([key, val]) => {
    if (!capturedKeys.has(key) && typeof val !== 'object') {
      // Map common extra keys to Chinese if possible
      let label = key
      if (key === 'net_profit') label = '净利润'
      else if (key === 'total_return') label = '总收益率'
      else {
        label = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
      }
      
      extraKpis.push({
        label,
        value: formatValue(key, val),
        icon: Activity,
        color: 'text-slate-400 border-slate-500/20 bg-slate-500/5',
        glow: 'shadow-slate-500/5'
      })
    }
  })

  return [...list, ...extraKpis.slice(0, 4)] // Limit to 4 extra KPIs to avoid clutter
})
</script>

<template>
  <div v-if="summary" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 w-full">
    <div
      v-for="kpi in kpis"
      :key="kpi.label"
      class="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-md px-5 py-4 flex flex-col justify-between transition-all duration-300 hover:translate-y-[-2px] hover:border-slate-700 hover:bg-slate-900/80 shadow-lg hover:shadow-xl"
      :class="kpi.glow"
    >
      <!-- Subtle top decorative line -->
      <div class="absolute top-0 left-0 right-0 h-[2px]" :class="kpi.color.split(' ')[2]"></div>

      <div class="flex items-center justify-between gap-2 mb-2">
        <span class="text-xs font-medium text-slate-400 uppercase tracking-wider">{{ kpi.label }}</span>
        <component :is="kpi.icon" class="w-4 h-4" :class="kpi.color.split(' ')[0]" />
      </div>
      
      <div class="text-2xl font-bold tracking-tight text-slate-100 mt-1">
        {{ kpi.value }}
      </div>
    </div>
  </div>
  <div v-else class="text-center py-8 text-slate-500 text-sm">
    未加载 KPI 业绩数据。请选择回测结果文件夹。
  </div>
</template>
