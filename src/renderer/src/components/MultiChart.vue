<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  createSeriesMarkers,
  Time
} from 'lightweight-charts'
import {
  queryBars,
  queryIndicators,
  queryFills,
  querySymbols,
  getHasSymbolColumn,
  detectBaseTimeframe,
  queryIndicatorColumns
} from '../services/duckdb'
import {
  CandlestickChart
} from 'lucide-vue-next'

interface ChartData {
  bars: any[]
  fills: any[]
  equity: any[]
  indicators: any[]
}

const props = defineProps<{
  data: ChartData | null
  folderName: string | null
  runPath?: string | null
  availableTimeframes?: string[]
  initialTimeframe?: string
}>()  

const emit = defineEmits<{
  (e: 'load', path: string): void
}>()

const chartsContainer = ref<HTMLDivElement | null>(null)
const chart1Container = ref<HTMLDivElement | null>(null)
const chart2Container = ref<HTMLDivElement | null>(null)
const chart3Container = ref<HTMLDivElement | null>(null)

let chart1: IChartApi | null = null
let chart2: IChartApi | null = null
let chart3: IChartApi | null = null

let candleSeries: ISeriesApi<any> | null = null
let volumeSeries: ISeriesApi<any> | null = null
let sma20Series: ISeriesApi<any> | null = null
let sma50Series: ISeriesApi<any> | null = null
let ema12Series: ISeriesApi<any> | null = null
let ema26Series: ISeriesApi<any> | null = null
let bbUpperSeries: ISeriesApi<any> | null = null
let bbMiddleSeries: ISeriesApi<any> | null = null
let bbLowerSeries: ISeriesApi<any> | null = null
let markersPlugin: any = null

let equitySeries: ISeriesApi<any> | null = null
let drawdownSeries: ISeriesApi<any> | null = null

// Visibility states
const showSMA20 = ref(true)
const showSMA50 = ref(true)
const showEMA12 = ref(false)
const showEMA26 = ref(false)
const showBB = ref(false)
const showMarkers = ref(true)
const showVolume = ref(true)
const showEquityChart = ref(false)
const showDrawdownChart = ref(false)

const detectedIndicators = ref<string[]>([])
const showIndicators = ref<Record<string, boolean>>({})
const activeIndicators = computed(() => detectedIndicators.value.filter(name => showIndicators.value[name]))

const indicatorChartContainers = ref<Record<string, HTMLDivElement>>({})
const setIndicatorChartContainer = (el: any, name: string) => {
  if (el) {
    indicatorChartContainers.value[name] = el as HTMLDivElement
  } else {
    delete indicatorChartContainers.value[name]
  }
}

let indicatorCharts: Record<string, IChartApi> = {}
let indicatorSeries: Record<string, ISeriesApi<any>> = {}

function getRandomColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 85%, 60%)`
}

let lastFetchedSymbol: string | null = null
let initTimeoutId: any = null

// Multi-symbol support states
const symbols = ref<Array<{ symbol: string; changePct: number }>>([])
const selectedSymbol = ref<string | null>(null)
const selectedTimeframe = ref(60)
const baseTimeframe = ref(60)

const timeframeOptions = computed(() => {
  // 如果有预聚合文件，直接从可用文件列表生成选项
  if (props.availableTimeframes && props.availableTimeframes.length > 0) {
    const labelMap: Record<string, string> = {
      '1m': '1分钟', '5m': '5分钟', '15m': '15分钟',
      '30m': '30分钟', '1h': '1小时', '4h': '4小时', '1d': '1天'
    }
    const tfToSecs: Record<string, number> = {
      '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '4h': 14400, '1d': 86400
    }
    return props.availableTimeframes.map(tf => ({
      label: labelMap[tf] || tf,
      value: tfToSecs[tf] || 900,
      tf
    }))
  }
  // 备用：没有预聚合文件时用原查询逻辑
  const standard = [
    { label: '1分钟', value: 60, tf: '1m' },
    { label: '5分钟', value: 300, tf: '5m' },
    { label: '15分钟', value: 900, tf: '15m' },
    { label: '30分钟', value: 1800, tf: '30m' },
    { label: '1小时', value: 3600, tf: '1h' },
    { label: '4小时', value: 14400, tf: '4h' },
    { label: '1天', value: 86400, tf: '1d' }
  ]
  const filtered = standard.filter(opt => opt.value >= baseTimeframe.value)
  const hasBase = filtered.some(opt => opt.value === baseTimeframe.value)
  if (!hasBase && baseTimeframe.value > 0) {
    let label = `${baseTimeframe.value}秒`
    if (baseTimeframe.value % 86400 === 0) label = `${baseTimeframe.value / 86400}天`
    else if (baseTimeframe.value % 3600 === 0) label = `${baseTimeframe.value / 3600}小时`
    else if (baseTimeframe.value % 60 === 0) label = `${baseTimeframe.value / 60}分钟`
    filtered.unshift({ label, value: baseTimeframe.value, tf: `${baseTimeframe.value}s` })
  }
  return filtered
})

const activeChartData = ref<ChartData | null>(null)
const loadingChartData = ref(false)
const selectedTradeId = ref<string | null>(null)
let flashIntervalId: any = null
const isFlashOn = ref(true)

// Reactive HUD state for hover values
const hudActive = ref(false)
const hudData = ref({
  timeStr: '',
  open: null as number | null,
  high: null as number | null,
  low: null as number | null,
  close: null as number | null,
  volume: null as number | null,
  sma20: null as number | null,
  sma50: null as number | null,
  ema12: null as number | null,
  ema26: null as number | null,
  bbUpper: null as number | null,
  bbMiddle: null as number | null,
  bbLower: null as number | null,
  equity: null as number | null,
  drawdown: null as number | null,
  fill: null as { side: string; price: number; quantity: number } | null,
  indicators: {} as Record<string, number | null>
})

// Helpers for loading symbols and filtering chart data
async function loadSymbolsAndDefault() {
  const baseTf = await detectBaseTimeframe()
  baseTimeframe.value = baseTf
  if (selectedTimeframe.value < baseTf) {
    selectedTimeframe.value = baseTf
  }

  if (getHasSymbolColumn()) {
    const list = await querySymbols()
    // Sort A-Z alphabetically by symbol name
    list.sort((a, b) => a.symbol.localeCompare(b.symbol))
    symbols.value = list
    if (list.length > 0) {
      selectedSymbol.value = list[0].symbol
    } else {
      selectedSymbol.value = null
    }
  } else {
    let changePct = 0
    if (props.data && props.data.fills.length > 0) {
      const fl = props.data.fills
      const buyFills = fl.filter(f => String(f.side).toUpperCase().includes('BUY') || f.side === 'buy' || f.side === 1)
      const sellFills = fl.filter(f => String(f.side).toUpperCase().includes('SELL') || f.side === 'sell' || f.side === 2)
      const tradeCount = Math.min(buyFills.length, sellFills.length)

      let sumPnlPct = 0
      for (let i = 0; i < tradeCount; i++) {
        const buy = buyFills[i]
        const sell = sellFills[i]
        if (buy.price > 0) {
          sumPnlPct += (sell.price - buy.price) / buy.price
        }
      }
      changePct = sumPnlPct
    }
    const name = parsedRunInfo.value?.symbol || 'ADAUSDT'
    symbols.value = [{ symbol: name, changePct }]
    selectedSymbol.value = name
  }
}

// 当前选中的时间框架 key（如 '15m', '1h'）
const currentTf = ref<string>('15m')

async function updateActiveChartData() {
  if (!props.data) {
    activeChartData.value = null
    return
  }

  const symbolToFetch = selectedSymbol.value
  lastFetchedSymbol = symbolToFetch
  loadingChartData.value = true
  try {
    const [bars, fills, indicators, cols] = await Promise.all([
      queryBars(symbolToFetch, selectedTimeframe.value),
      queryFills(symbolToFetch),
      queryIndicators(symbolToFetch, selectedTimeframe.value),
      queryIndicatorColumns()
    ])
    if (lastFetchedSymbol === symbolToFetch) {
      detectedIndicators.value = cols
      cols.forEach(c => {
        if (showIndicators.value[c] === undefined) {
          showIndicators.value[c] = false
        }
      })
      activeChartData.value = {
        bars,
        fills,
        equity: props.data.equity,
        indicators
      }
    }
  } catch (err) {
    console.error('Failed to query filtered chart data:', err)
    if (lastFetchedSymbol === symbolToFetch) {
      activeChartData.value = props.data
    }
  } finally {
    if (lastFetchedSymbol === symbolToFetch) {
      loadingChartData.value = false
    }
  }
}

/**
 * 切换时间框架：有预聚合文件时通过 IPC 加载对应文件，
 * 无预聚合文件时回退到 SQL GROUP BY 聚合。
 */
async function switchTimeframe(_tf: string, tfSecs: number) {
  if (!props.data) return
  const symbolToFetch = selectedSymbol.value
  lastFetchedSymbol = symbolToFetch
  loadingChartData.value = true
  try {
    const [bars, fills, indicators, cols] = await Promise.all([
      queryBars(symbolToFetch, tfSecs),
      queryFills(symbolToFetch),
      queryIndicators(symbolToFetch, tfSecs),
      queryIndicatorColumns()
    ])
    if (lastFetchedSymbol === symbolToFetch) {
      detectedIndicators.value = cols
      cols.forEach(c => {
        if (showIndicators.value[c] === undefined) showIndicators.value[c] = false
      })
      activeChartData.value = {
        bars,
        fills,
        equity: props.data.equity,
        indicators
      }
    }
  } catch (err) {
    console.error('Failed to switch timeframe:', err)
    if (lastFetchedSymbol === symbolToFetch) {
      activeChartData.value = props.data
    }
  } finally {
    if (lastFetchedSymbol === symbolToFetch) {
      loadingChartData.value = false
    }
  }
}

// Watchers to update series visibility reactively
watch(
  [showSMA20, showSMA50, showEMA12, showEMA26, showBB, showVolume, showMarkers],
  () => {
    scheduleInitCharts()
  }
)

function applyMarkers() {
  if (!candleSeries || !activeChartData.value) return
  if (!showMarkers.value || activeChartData.value.fills.length === 0) {
    if (markersPlugin) {
      markersPlugin.setMarkers([])
    }
    return
  }

  const bars = activeChartData.value.bars
  if (bars.length === 0) return
  const minTime = bars[0].time
  const maxTime = bars[bars.length - 1].time

  // Only show markers that fall within the loaded bars timestamp range (after rounding)
  const visibleFills = activeChartData.value.fills.filter(f => {
    const barTime = Math.floor(f.time / selectedTimeframe.value) * selectedTimeframe.value
    return barTime >= minTime && barTime <= maxTime
  })

  const fillContextMap = new Map<number, { type: 'L' | 'S'; isEntry: boolean; pnlPct?: number }>()
  pairedTrades.value.forEach(t => {
    fillContextMap.set(t.entryTime, { type: t.type, isEntry: true })
    fillContextMap.set(t.exitTime, { type: t.type, isEntry: false, pnlPct: t.pnlPct })
  })

  const markers = visibleFills.map(f => {
    const isBuy = String(f.side).toUpperCase().includes('BUY') || f.side === 'buy' || f.side === 1
    const ctx = fillContextMap.get(f.time)

    let prefix = ''
    if (ctx) {
      if (ctx.type === 'L') {
        prefix = ctx.isEntry ? 'Long-开仓' : 'Long-平仓'
      } else {
        prefix = ctx.isEntry ? 'Short-开仓' : 'Short-平仓'
      }
    } else {
      prefix = isBuy ? '开仓' : '平仓'
    }

    let text = `${prefix} ${f.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })}`

    if (ctx && !ctx.isEntry && ctx.pnlPct !== undefined) {
      const pnlText = ` (${ctx.pnlPct >= 0 ? '+' : ''}${(ctx.pnlPct * 100).toFixed(2)}%)`
      text += pnlText
    }

    let color = isBuy ? '#10b981' : '#f43f5e'
    if (ctx) {
      color = ctx.type === 'L' ? '#1d4ed8' : '#7c3aed'
    }

    const isSelectedTradeFill = selectedTrade.value && 
      (f.time === selectedTrade.value.entryTime || f.time === selectedTrade.value.exitTime)

    let size = 1.1
    if (isSelectedTradeFill) {
      size = isFlashOn.value ? 2.0 : 1.1
      if (ctx) {
        if (ctx.type === 'L') {
          color = isFlashOn.value ? '#3b82f6' : '#1d4ed8'
        } else {
          color = isFlashOn.value ? '#a855f7' : '#7c3aed'
        }
      }
    }

    const barTime = Math.floor(f.time / selectedTimeframe.value) * selectedTimeframe.value

    return {
      time: barTime as Time,
      position: (isBuy ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
      color: color,
      shape: (isBuy ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
      text: text,
      size: size
    }
  })

  if (!markersPlugin) {
    markersPlugin = createSeriesMarkers(candleSeries)
  }
  markersPlugin.setMarkers(markers)
}

// Data lookup maps for quick crosshair synchronization
const barsMap = new Map<number, any>()
const indicatorsMap = new Map<number, any>()
const equityMap = new Map<number, any>()
const fillsMap = new Map<number, any>()

const searchQuery = ref('')

const filteredSymbols = computed(() => {
  if (!searchQuery.value.trim()) return symbols.value
  const query = searchQuery.value.toLowerCase()
  return symbols.value.filter(s => s.symbol.toLowerCase().includes(query))
})

const parsedRunInfo = computed(() => {
  if (!props.data || !props.folderName) return null
  const parts = props.folderName.split('_')
  let symbol = 'BTC-USD'
  let strategy = '双均线策略'
  if (parts.length >= 3) {
    symbol = parts.slice(2).join('_')
    strategy = '双均线交叉'
  }
  return { symbol, strategy }
})

// Fills / Paired Trades Navigation list
const pairedTrades = computed(() => {
  const fl = activeChartData.value?.fills || []
  // Sort fills by time ascending to process chronologically
  const sortedFills = [...fl].sort((a, b) => a.time - b.time)

  const trades: any[] = []
  let openTrade: { entry: any; type: 'L' | 'S' } | null = null

  for (let i = 0; i < sortedFills.length; i++) {
    const fill = sortedFills[i]
    const side = String(fill.side).toUpperCase()
    const isBuy = side.includes('BUY') || fill.side === 'buy' || fill.side === 1
    const isSell = side.includes('SELL') || fill.side === 'sell' || fill.side === 2

    if (!openTrade) {
      if (isBuy) {
        openTrade = { entry: fill, type: 'L' }
      } else if (isSell) {
        openTrade = { entry: fill, type: 'S' }
      }
    } else {
      const entry = openTrade.entry
      let pnlPct = 0
      let pnlAmt = 0

      if (openTrade.type === 'L') {
        pnlPct = (fill.price - entry.price) / entry.price
        pnlAmt = fill.quantity * (fill.price - entry.price)
      } else {
        pnlPct = (entry.price - fill.price) / entry.price
        pnlAmt = fill.quantity * (entry.price - fill.price)
      }

      trades.push({
        id: `trade-${trades.length}`,
        type: openTrade.type,
        entryTime: entry.time,
        exitTime: fill.time,
        entryPrice: entry.price,
        exitPrice: fill.price,
        quantity: entry.quantity,
        pnlPct,
        pnlAmt
      })
      openTrade = null
    }
  }

  // Sort trades descending to show latest first
  return trades.sort((a, b) => b.entryTime - a.entryTime)
})

const selectedTrade = computed(() => {
  return pairedTrades.value.find(t => t.id === selectedTradeId.value)
})

const longEntriesCount = computed(() => (activeChartData.value?.fills || []).filter(f => f.side === 'BUY' || f.side === 'buy' || f.side === 1).length)
const longExitsCount = computed(() => (activeChartData.value?.fills || []).filter(f => f.side === 'SELL' || f.side === 'sell' || f.side === 2).length)

// Initialize lookup maps
function buildLookupMaps() {
  barsMap.clear()
  indicatorsMap.clear()
  equityMap.clear()
  fillsMap.clear()

  if (!activeChartData.value) return

  activeChartData.value.bars.forEach(d => barsMap.set(d.time, d))
  activeChartData.value.indicators.forEach(d => indicatorsMap.set(d.time, d))
  activeChartData.value.equity.forEach(d => equityMap.set(d.time, d))
  activeChartData.value.fills.forEach(d => {
    const barTime = Math.floor(d.time / selectedTimeframe.value) * selectedTimeframe.value
    fillsMap.set(barTime, d)
  })
}

const commonOptions = {
  layout: {
    background: { color: 'transparent' },
    textColor: '#94a3b8',
    fontSize: 10,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  grid: {
    vertLines: { color: '#0f172a', style: 1 as any },
    horzLines: { color: '#0f172a', style: 1 as any },
  },
  crosshair: {
    mode: 0,
    vertLine: {
      color: '#475569',
      width: 1 as any,
      style: 3 as any,
      labelBackgroundColor: '#020617',
    },
    horzLine: {
      color: '#475569',
      width: 1 as any,
      style: 3 as any,
      labelBackgroundColor: '#020617',
    },
  },
  localization: {
    timeFormatter: (time: number) => {
      const date = new Date(time * 1000)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }
  },
  timeScale: {
    borderColor: '#1e293b',
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: (time: any) => {
      if (typeof time === 'number') {
        const date = new Date(time * 1000)
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
      }
      return String(time)
    }
  },
}

let lastVisibleRange: { from: Time; to: Time } | null = null
let targetVisibleRange: { from: Time; to: Time } | null = null

function initCharts() {
  if (chart1) {
    cleanupCharts()
  }
  if (!chart1Container.value) return
  if (!activeChartData.value || activeChartData.value.bars.length === 0) return

  buildLookupMaps()

  // -------------------------------------------------------------
  // 1. Chart 1: Main Chart (Candlesticks + Indicators + Volume Overlay)
  // -------------------------------------------------------------
  const height1 = chart1Container.value.clientHeight || 550
  chart1 = createChart(chart1Container.value, {
    ...commonOptions,
    height: height1,
    leftPriceScale: { visible: false },
    rightPriceScale: { borderColor: '#1e293b', autoScale: true },
  })

  // Candlesticks Series
  candleSeries = chart1.addSeries(CandlestickSeries, {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
    priceLineVisible: false,
  })

  const barData = activeChartData.value.bars.map(d => ({
    time: d.time as Time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }))
  candleSeries.setData(barData)

  // Technical Indicators overlays on Main Chart
  sma20Series = chart1.addSeries(LineSeries, {
    color: '#3b82f6',
    lineWidth: 1.5 as any,
    title: 'SMA 20',
    visible: showSMA20.value,
    priceLineVisible: false,
  })
  sma50Series = chart1.addSeries(LineSeries, {
    color: '#eab308',
    lineWidth: 1.5 as any,
    title: 'SMA 50',
    visible: showSMA50.value,
    priceLineVisible: false,
  })
  ema12Series = chart1.addSeries(LineSeries, {
    color: '#a855f7',
    lineWidth: 1.5 as any,
    title: 'EMA 12',
    visible: showEMA12.value,
    priceLineVisible: false,
  })
  ema26Series = chart1.addSeries(LineSeries, {
    color: '#ec4899',
    lineWidth: 1.5 as any,
    title: 'EMA 26',
    visible: showEMA26.value,
    priceLineVisible: false,
  })
  bbUpperSeries = chart1.addSeries(LineSeries, {
    color: 'rgba(6, 182, 212, 0.4)',
    lineWidth: 1 as any,
    title: 'BB Upper',
    visible: showBB.value,
    priceLineVisible: false,
  })
  bbMiddleSeries = chart1.addSeries(LineSeries, {
    color: 'rgba(6, 182, 212, 0.3)',
    lineWidth: 1 as any,
    lineStyle: 1 as any,
    title: 'BB Middle',
    visible: showBB.value,
    priceLineVisible: false,
  })
  bbLowerSeries = chart1.addSeries(LineSeries, {
    color: 'rgba(6, 182, 212, 0.4)',
    lineWidth: 1 as any,
    title: 'BB Lower',
    visible: showBB.value,
    priceLineVisible: false,
  })

  const sma20Data = activeChartData.value.indicators
    .filter(d => d.sma_20 !== null)
    .map(d => ({ time: d.time as Time, value: d.sma_20 }))
  const sma50Data = activeChartData.value.indicators
    .filter(d => d.sma_50 !== null)
    .map(d => ({ time: d.time as Time, value: d.sma_50 }))
  const ema12Data = activeChartData.value.indicators
    .filter(d => d.ema_12 !== null)
    .map(d => ({ time: d.time as Time, value: d.ema_12 }))
  const ema26Data = activeChartData.value.indicators
    .filter(d => d.ema_26 !== null)
    .map(d => ({ time: d.time as Time, value: d.ema_26 }))
  const bbUpperData = activeChartData.value.indicators
    .filter(d => d.bb_upper !== null)
    .map(d => ({ time: d.time as Time, value: d.bb_upper }))
  const bbMiddleData = activeChartData.value.indicators
    .filter(d => d.bb_middle !== null)
    .map(d => ({ time: d.time as Time, value: d.bb_middle }))
  const bbLowerData = activeChartData.value.indicators
    .filter(d => d.bb_lower !== null)
    .map(d => ({ time: d.time as Time, value: d.bb_lower }))

  sma20Series.setData(sma20Data)
  sma50Series.setData(sma50Data)
  ema12Series.setData(ema12Data)
  ema26Series.setData(ema26Data)
  bbUpperSeries.setData(bbUpperData)
  bbMiddleSeries.setData(bbMiddleData)
  bbLowerSeries.setData(bbLowerData)

  // Volume Histogram Overlay on Main Chart bottom
  volumeSeries = chart1.addSeries(HistogramSeries, {
    color: '#26a69a',
    priceFormat: { type: 'volume' },
    priceScaleId: 'volumeScale',
    visible: showVolume.value,
  })
  
  chart1.priceScale('volumeScale').applyOptions({
    scaleMargins: {
      top: 0.8, // sit at the bottom 20%
      bottom: 0,
    },
    visible: false,
  })

  const volumeData = activeChartData.value.bars.map(d => ({
    time: d.time as Time,
    value: d.volume,
    color: d.close >= d.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
  }))
  volumeSeries.setData(volumeData)

  // Fills buy/sell markers on candlesticks
  applyMarkers()

  // -------------------------------------------------------------
  // 2. Chart 2: Equity Chart (Line)
  // -------------------------------------------------------------
  if (showEquityChart.value && chart2Container.value) {
    const height2 = chart2Container.value.clientHeight || 160
    chart2 = createChart(chart2Container.value, {
      ...commonOptions,
      height: height2,
      leftPriceScale: { visible: false },
      rightPriceScale: { borderColor: '#1e293b', autoScale: true },
    })

    equitySeries = chart2.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2 as any,
      title: 'Equity',
      priceLineVisible: false,
    })

    const equityData = activeChartData.value.equity.map(d => ({
      time: d.time as Time,
      value: d.equity,
    }))
    equitySeries.setData(equityData)
  }

  // -------------------------------------------------------------
  // 3. Chart 3: Drawdown Chart (Area)
  // -------------------------------------------------------------
  if (showDrawdownChart.value && chart3Container.value) {
    const height3 = chart3Container.value.clientHeight || 140
    chart3 = createChart(chart3Container.value, {
      ...commonOptions,
      height: height3,
      leftPriceScale: { visible: false },
      rightPriceScale: { borderColor: '#1e293b', autoScale: true },
    })

    drawdownSeries = chart3.addSeries(AreaSeries, {
      topColor: 'rgba(239, 68, 68, 0.3)',
      bottomColor: 'rgba(239, 68, 68, 0.0)',
      lineColor: '#ef4444',
      lineWidth: 1.5 as any,
      title: 'Drawdown',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${(price * 100).toFixed(2)}%`,
      },
      priceLineVisible: false,
    })

    const drawdownData = activeChartData.value.equity.map(d => ({
      time: d.time as Time,
      value: d.drawdown,
    }))
    drawdownSeries.setData(drawdownData)
  }

  // -------------------------------------------------------------
  // 4. Dynamic Indicator Charts
  // -------------------------------------------------------------
  activeIndicators.value.forEach(name => {
    const container = indicatorChartContainers.value[name]
    if (!container) return

    const height = container.clientHeight || 150
    const chart = createChart(container, {
      ...commonOptions,
      height: height,
      leftPriceScale: { visible: false },
      rightPriceScale: { borderColor: '#1e293b', autoScale: true },
    })

    const series = chart.addSeries(LineSeries, {
      color: getRandomColor(name),
      lineWidth: 2 as any,
      title: name,
      priceLineVisible: false,
    })

    const seriesData = activeChartData.value!.bars
      .filter(d => d[name] !== undefined && d[name] !== null)
      .map(d => ({
        time: d.time as Time,
        value: d[name],
      }))
    series.setData(seriesData)

    indicatorCharts[name] = chart
    indicatorSeries[name] = series
  })

  // -------------------------------------------------------------
  // Synchronization (Logical Range & Crosshairs)
  // -------------------------------------------------------------
  let isSyncing = false

  const activeChartsList: { chart: IChartApi; series: ISeriesApi<any> }[] = []
  if (candleSeries) {
    activeChartsList.push({ chart: chart1, series: candleSeries })
  }
  if (chart2 && equitySeries) {
    activeChartsList.push({ chart: chart2, series: equitySeries })
  }
  if (chart3 && drawdownSeries) {
    activeChartsList.push({ chart: chart3, series: drawdownSeries })
  }
  activeIndicators.value.forEach(name => {
    const c = indicatorCharts[name]
    const s = indicatorSeries[name]
    if (c && s) {
      activeChartsList.push({ chart: c, series: s })
    }
  })

  // Synchronize visible logical ranges
  activeChartsList.forEach((itemA) => {
    itemA.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncing) return
      isSyncing = true
      if (range) {
        activeChartsList.forEach((itemB) => {
          if (itemA.chart !== itemB.chart) {
            itemB.chart.timeScale().setVisibleLogicalRange(range)
          }
        })
      }
      isSyncing = false
    })
  })

  // Synchronize crosshair movements using lookup maps for O(1) performance
  activeChartsList.forEach((itemA) => {
    itemA.chart.subscribeCrosshairMove((param) => {
      if (isSyncing) return
      isSyncing = true
      const time = param.time as number | undefined
      if (time) {
        activeChartsList.forEach((itemB) => {
          if (itemA.chart !== itemB.chart) {
            let price = 0
            if (itemB.chart === chart1) {
              const bar = barsMap.get(time)
              price = bar ? bar.close : 0
            } else if (itemB.chart === chart2) {
              const eq = equityMap.get(time)
              price = eq ? eq.equity : 0
            } else if (itemB.chart === chart3) {
              const eq = equityMap.get(time)
              price = eq ? eq.drawdown : 0
            } else {
              const name = Object.keys(indicatorCharts).find(k => indicatorCharts[k] === itemB.chart)
              if (name) {
                const bar = barsMap.get(time)
                price = bar ? (bar[name] ?? 0) : 0
              }
            }
            try {
              itemB.chart.setCrosshairPosition(price, time as Time, itemB.series)
            } catch (e) {
              // Ignore
            }
          }
        })
      } else {
        activeChartsList.forEach((itemB) => {
          if (itemA.chart !== itemB.chart) {
            try {
              itemB.chart.clearCrosshairPosition()
            } catch (e) {
              // Ignore
            }
          }
        })
      }
      isSyncing = false
    })
  })

  // Set crosshair move for HUD details
  chart1.subscribeCrosshairMove((param) => {
    const time = param.time as number | undefined

    if (!time || param.point === undefined) {
      hudActive.value = false
    } else {
      // Update the unified HUD
      const bar = barsMap.get(time)
      const ind = indicatorsMap.get(time)
      const eq = equityMap.get(time)
      const fill = fillsMap.get(time)

      const date = new Date(time * 1000)
      const pad = (n: number) => String(n).padStart(2, '0')
      hudData.value.timeStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

      if (bar) {
        hudData.value.open = bar.open
        hudData.value.high = bar.high
        hudData.value.low = bar.low
        hudData.value.close = bar.close
        hudData.value.volume = bar.volume
        
        detectedIndicators.value.forEach(name => {
          hudData.value.indicators[name] = bar[name] !== undefined ? bar[name] : null
        })
      } else {
        hudData.value.open = hudData.value.high = hudData.value.low = hudData.value.close = hudData.value.volume = null
        detectedIndicators.value.forEach(name => {
          hudData.value.indicators[name] = null
        })
      }

      if (ind) {
        hudData.value.sma20 = ind.sma_20
        hudData.value.sma50 = ind.sma_50
        hudData.value.ema12 = ind.ema_12
        hudData.value.ema26 = ind.ema_26
        hudData.value.bbUpper = ind.bb_upper
        hudData.value.bbMiddle = ind.bb_middle
        hudData.value.bbLower = ind.bb_lower
      } else {
        hudData.value.sma20 = hudData.value.sma50 = hudData.value.ema12 = hudData.value.ema26 = hudData.value.bbUpper = hudData.value.bbMiddle = hudData.value.bbLower = null
      }

      if (eq) {
        hudData.value.equity = eq.equity
        hudData.value.drawdown = eq.drawdown
      } else {
        hudData.value.equity = hudData.value.drawdown = null
      }

      if (fill) {
        hudData.value.fill = {
          side: fill.side,
          price: fill.price,
          quantity: fill.quantity
        }
      } else {
        hudData.value.fill = null
      }

      hudActive.value = true
    }
  })

  // Set default visible range or restore previous one
  let appliedRange = false
  if (targetVisibleRange) {
    try {
      chart1.timeScale().setVisibleRange(targetVisibleRange)
      appliedRange = true
      targetVisibleRange = null // Clear it after applying
    } catch (e) {
      console.warn('Failed to set target visible range:', e)
    }
  } else if (lastVisibleRange) {
    try {
      chart1.timeScale().setVisibleRange(lastVisibleRange)
      appliedRange = true
    } catch (e) {
      console.warn('Failed to restore visible range:', e)
    }
  }

  if (!appliedRange) {
    if (barData && barData.length > 0) {
      const lastBarCount = Math.min(barData.length, 300)
      const fromTime = barData[barData.length - lastBarCount].time
      const toTime = barData[barData.length - 1].time
      chart1.timeScale().setVisibleRange({ from: fromTime as Time, to: toTime as Time })
    } else {
      chart1.timeScale().fitContent()
    }
  }
}

async function navigateToTrade(trade: any) {
  if (!chart1 || !candleSeries) return
  selectedTradeId.value = trade.id
  
  let interval = selectedTimeframe.value
  const zoomHalfRange = 60 * interval
  const from = trade.entryTime - zoomHalfRange
  const to = trade.exitTime + zoomHalfRange

  const bars = activeChartData.value?.bars || []
  const minTime = bars.length > 0 ? bars[0].time : Infinity
  const maxTime = bars.length > 0 ? bars[bars.length - 1].time : -Infinity

  // If the trade is outside the currently loaded bars range, we fetch data for this range
  if (trade.entryTime < minTime || trade.exitTime > maxTime) {
    targetVisibleRange = { from: from as Time, to: to as Time }
    loadingChartData.value = true
    try {
      const symbolToFetch = selectedSymbol.value
      const timeframeSecs = selectedTimeframe.value
      
      // Fetch 10,000 bars context on either side of the trade (total ~20,000 bars scrollable)
      const queryHalfRange = 10000 * timeframeSecs
      const queryFrom = trade.entryTime - queryHalfRange
      const queryTo = trade.exitTime + queryHalfRange

      const [newBars, newIndicators] = await Promise.all([
        queryBars(symbolToFetch, timeframeSecs, queryFrom, queryTo, 30000),
        queryIndicators(symbolToFetch, timeframeSecs, queryFrom, queryTo, 30000)
      ])
      
      if (symbolToFetch === selectedSymbol.value && timeframeSecs === selectedTimeframe.value) {
        activeChartData.value = {
          bars: newBars,
          fills: activeChartData.value?.fills || [],
          equity: activeChartData.value?.equity || [],
          indicators: newIndicators
        }
        
        buildLookupMaps()
        
        // Re-render chart series
        const barData = newBars.map(d => ({
          time: d.time as Time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
        candleSeries.setData(barData)

        if (volumeSeries) {
          const volumeData = newBars.map(d => ({
            time: d.time as Time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
          }))
          volumeSeries.setData(volumeData)
        }

        // SMA & EMA
        if (sma20Series) sma20Series.setData(newIndicators.filter(d => d.sma_20 !== null).map(d => ({ time: d.time as Time, value: d.sma_20 })))
        if (sma50Series) sma50Series.setData(newIndicators.filter(d => d.sma_50 !== null).map(d => ({ time: d.time as Time, value: d.sma_50 })))
        if (ema12Series) ema12Series.setData(newIndicators.filter(d => d.ema_12 !== null).map(d => ({ time: d.time as Time, value: d.ema_12 })))
        if (ema26Series) ema26Series.setData(newIndicators.filter(d => d.ema_26 !== null).map(d => ({ time: d.time as Time, value: d.ema_26 })))
        if (bbUpperSeries) bbUpperSeries.setData(newIndicators.filter(d => d.bb_upper !== null).map(d => ({ time: d.time as Time, value: d.bb_upper })))
        if (bbMiddleSeries) bbMiddleSeries.setData(newIndicators.filter(d => d.bb_middle !== null).map(d => ({ time: d.time as Time, value: d.bb_middle })))
        if (bbLowerSeries) bbLowerSeries.setData(newIndicators.filter(d => d.bb_lower !== null).map(d => ({ time: d.time as Time, value: d.bb_lower })))

        // Custom Indicators
        detectedIndicators.value.forEach(name => {
          const series = indicatorSeries[name]
          if (series) {
            const seriesData = newBars
              .filter(d => d[name] !== undefined && d[name] !== null)
              .map(d => ({
                time: d.time as Time,
                value: d[name],
              }))
            series.setData(seriesData)
          }
        })

        applyMarkers()
      }
    } catch (e) {
      console.error('Failed to load range for navigated trade:', e)
    } finally {
      loadingChartData.value = false
    }
  } else {
    // If it's already in the loaded range, set visible range directly without recreating chart
    chart1.timeScale().setVisibleRange({ from: from as Time, to: to as Time })
  }
}

function handleResize() {
  if (chart1 && chart1Container.value) chart1.resize(chart1Container.value.clientWidth, chart1Container.value.clientHeight)
  if (chart2 && chart2Container.value) chart2.resize(chart2Container.value.clientWidth, chart2Container.value.clientHeight)
  if (chart3 && chart3Container.value) chart3.resize(chart3Container.value.clientWidth, chart3Container.value.clientHeight)
  for (const name of Object.keys(indicatorCharts)) {
    const container = indicatorChartContainers.value[name]
    if (container) {
      indicatorCharts[name].resize(container.clientWidth, container.clientHeight)
    }
  }
}

function cleanupCharts() {
  if (initTimeoutId) {
    clearTimeout(initTimeoutId)
    initTimeoutId = null
  }
  if (chart1) {
    try {
      const range = chart1.timeScale().getVisibleRange()
      if (range) {
        lastVisibleRange = { from: range.from as Time, to: range.to as Time }
      }
    } catch (e) {
      // Ignore
    }
    try {
      chart1.remove()
    } catch (e) {
      console.error('Failed to remove chart:', e)
    }
    chart1 = null
  }
  if (chart2) {
    try {
      chart2.remove()
    } catch (e) {
      console.error('Failed to remove chart2:', e)
    }
    chart2 = null
  }
  if (chart3) {
    try {
      chart3.remove()
    } catch (e) {
      console.error('Failed to remove chart3:', e)
    }
    chart3 = null
  }
  for (const name of Object.keys(indicatorCharts)) {
    try {
      indicatorCharts[name].remove()
    } catch (e) {
      console.error(`Failed to remove indicator chart ${name}:`, e)
    }
  }
  indicatorCharts = {}
  indicatorSeries = {}

  candleSeries = null
  volumeSeries = null
  sma20Series = null
  sma50Series = null
  ema12Series = null
  ema26Series = null
  bbUpperSeries = null
  bbMiddleSeries = null
  bbLowerSeries = null
  equitySeries = null
  drawdownSeries = null
  if (markersPlugin) {
    try {
      markersPlugin.detach()
    } catch (e) {
      console.error('Failed to detach markers plugin:', e)
    }
    markersPlugin = null
  }
}

function scheduleInitCharts() {
  if (initTimeoutId) {
    clearTimeout(initTimeoutId)
    initTimeoutId = null
  }
  cleanupCharts()
  initTimeoutId = setTimeout(() => {
    initCharts()
    initTimeoutId = null
  }, 50)
}

// Helpers
function formatPercentage(val?: number): string {
  if (val === undefined || val === null) return '--'
  const displayVal = Math.abs(val) < 1.01 && val !== 0 ? val * 100 : val
  return `${(val >= 0 ? '▲' : '▼')} ${displayVal.toFixed(2)}%`
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatPrice(val: number | null | undefined): string {
  if (val === undefined || val === null) return '--'
  if (val === 0) return '0.00'
  const abs = Math.abs(val)
  if (abs < 0.001) return val.toFixed(6)
  if (abs < 1.0) return val.toFixed(4)
  if (abs < 100.0) return val.toFixed(3)
  return val.toFixed(2)
}

let resizeObserver: ResizeObserver | null = null

function setupResizeObserver() {
  if (!chartsContainer.value) return
  resizeObserver = new ResizeObserver(() => {
    handleResize()
  })
  resizeObserver.observe(chartsContainer.value)
}

onMounted(async () => {
  // 初始化时从 initialTimeframe prop 设置时间框架
  if (props.initialTimeframe && props.availableTimeframes?.length) {
    const tfToSecs: Record<string, number> = {
      '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '4h': 14400, '1d': 86400
    }
    currentTf.value = props.initialTimeframe
    selectedTimeframe.value = tfToSecs[props.initialTimeframe] || 900
  }
  await loadSymbolsAndDefault()
  await updateActiveChartData()
  window.addEventListener('resize', handleResize)
  setupResizeObserver()
})

onUnmounted(() => {
  if (initTimeoutId) {
    clearTimeout(initTimeoutId)
    initTimeoutId = null
  }
  if (flashIntervalId) {
    clearInterval(flashIntervalId)
    flashIntervalId = null
  }
  cleanupCharts()
  window.removeEventListener('resize', handleResize)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

watch(() => props.data, async () => {
  await loadSymbolsAndDefault()
  await updateActiveChartData()
}, { deep: true })

watch(selectedSymbol, async () => {
  selectedTradeId.value = null
  await updateActiveChartData()
})

watch(selectedTimeframe, async (newSecs) => {
  // 找到对应的 tf key
  const opt = timeframeOptions.value.find(o => o.value === newSecs)
  const tf = opt ? (opt as any).tf as string : currentTf.value
  currentTf.value = tf
  await switchTimeframe(tf, newSecs)
})

watch(activeChartData, () => {
  scheduleInitCharts()
}, { deep: true })

watch([showEquityChart, showDrawdownChart, activeIndicators], () => {
  scheduleInitCharts()
}, { deep: true })

watch(selectedTradeId, (newId) => {
  if (flashIntervalId) {
    clearInterval(flashIntervalId)
    flashIntervalId = null
  }
  if (newId) {
    isFlashOn.value = true
    flashIntervalId = setInterval(() => {
      isFlashOn.value = !isFlashOn.value
      applyMarkers()
    }, 400)
  } else {
    isFlashOn.value = true
    applyMarkers()
  }
})
</script>

<template>
  <div class="flex-1 flex min-h-0 bg-slate-950 overflow-hidden text-xs">
    
    <!-- Left Sidebar: Pairs List (Freqtrade-style) -->
    <aside class="w-60 border-r border-slate-900 bg-slate-950 flex flex-col shrink-0 select-none p-3 gap-3">
      <!-- Search Filter -->
      <div class="relative">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Filter"
          class="w-full bg-slate-900 border border-slate-800 focus:border-orange-500 rounded px-2.5 py-1.5 text-slate-100 placeholder-slate-500 font-mono outline-none text-[11px]"
        />
      </div>

      <!-- Pairs items -->
      <div class="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
        <div v-if="filteredSymbols.length === 0" class="text-slate-600 italic text-center py-8">
          无匹配交易对
        </div>
        <button
          v-for="sym in filteredSymbols"
          :key="sym.symbol"
          @click="selectedSymbol = sym.symbol"
          class="flex items-center justify-between px-3 py-2 rounded text-left transition font-mono border"
          :class="selectedSymbol === sym.symbol
            ? 'bg-orange-500/10 border-orange-500/40 text-orange-400 font-bold shadow shadow-orange-500/5'
            : 'bg-slate-900/10 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'"
        >
          <span class="truncate">{{ sym.symbol }}</span>
          <span
            class="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-2"
            :class="sym.changePct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'"
          >
            {{ formatPercentage(sym.changePct) }}
          </span>
        </button>
      </div>
    </aside>

    <!-- Center Area: K-line Main and Sub charts -->
    <section class="flex-1 flex flex-col min-h-0 bg-slate-950">
      
      <!-- Freqtrade style Legend & details header -->
      <div class="shrink-0 border-b border-slate-900 bg-slate-950 p-4 flex flex-col gap-2 select-none">
        <div class="flex items-center justify-between">
          <!-- Left info -->
          <div class="flex items-center gap-3 flex-wrap">
            <span class="font-mono font-bold text-slate-100 text-sm">
              {{ parsedRunInfo?.strategy || '双均线回测策略' }}
            </span>
            
            <!-- Symbol Selector dropdown if there are multiple symbols -->
            <div v-if="getHasSymbolColumn()" class="flex items-center gap-1.5">
              <span class="text-slate-500 text-[10px] font-mono">交易对:</span>
              <select
                v-model="selectedSymbol"
                class="bg-slate-900 border border-slate-805 text-slate-200 text-[11px] font-mono font-semibold rounded px-2 py-0.5 outline-none focus:border-orange-500 cursor-pointer"
              >
                <option v-for="sym in symbols" :key="sym.symbol" :value="sym.symbol">
                  {{ sym.symbol }}
                </option>
              </select>
            </div>
            <span v-else class="text-slate-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-semibold">
              {{ parsedRunInfo?.symbol || '未加载回测' }}
            </span>

            <!-- Timeframe Selector -->
            <div class="flex items-center gap-1.5 ml-2">
              <span class="text-slate-500 text-[10px] font-mono">K线级别:</span>
              <select
                v-model="selectedTimeframe"
                class="bg-slate-900 border border-slate-805 text-slate-200 text-[11px] font-mono font-semibold rounded px-2 py-0.5 outline-none focus:border-orange-500 cursor-pointer"
              >
                <option v-for="opt in timeframeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <!-- Interactive controls for overlays -->
            <div class="flex items-center gap-3 border-l border-slate-900 pl-3 flex-wrap">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showSMA20" class="rounded border-slate-800 bg-slate-900 text-blue-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-blue-400 text-[10px] font-mono font-semibold">SMA(20)</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showSMA50" class="rounded border-slate-800 bg-slate-900 text-yellow-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-yellow-400 text-[10px] font-mono font-semibold">SMA(50)</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showEMA12" class="rounded border-slate-800 bg-slate-900 text-purple-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-purple-400 text-[10px] font-mono font-semibold">EMA(12)</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showEMA26" class="rounded border-slate-800 bg-slate-900 text-pink-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-pink-400 text-[10px] font-mono font-semibold">EMA(26)</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showBB" class="rounded border-slate-800 bg-slate-900 text-cyan-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-cyan-400 text-[10px] font-mono font-semibold">BB布林带</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showMarkers" class="rounded border-slate-800 bg-slate-900 text-orange-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-orange-400 text-[10px] font-mono font-semibold">买卖点</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showVolume" class="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-emerald-400 text-[10px] font-mono font-semibold">交易量</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer border-l border-slate-900 pl-3">
                <input type="checkbox" v-model="showEquityChart" class="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-emerald-400 text-[10px] font-mono font-semibold">账户权益副图</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="showDrawdownChart" class="rounded border-slate-800 bg-slate-900 text-rose-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-rose-400 text-[10px] font-mono font-semibold">资产回撤副图</span>
              </label>
              <label v-for="name in detectedIndicators" :key="name" class="flex items-center gap-1.5 cursor-pointer border-l border-slate-900 pl-3">
                <input type="checkbox" v-model="showIndicators[name]" class="rounded border-slate-800 bg-slate-900 text-orange-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer" />
                <span class="text-orange-400 text-[10px] font-mono font-semibold">{{ name }}</span>
              </label>
            </div>
          </div>

          <!-- Shape legends -->
          <div class="flex items-center gap-4 text-[10px] font-mono text-slate-500">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Candles</span>
            </div>
            <div class="flex items-center gap-1.5" v-if="showVolume">
              <span class="w-2.5 h-2 bg-emerald-500/30 border border-emerald-500/20"></span>
              <span>Volume</span>
            </div>
            <div class="flex items-center gap-1.5" v-if="showMarkers">
              <span class="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[7px] border-b-emerald-500"></span>
              <span>Entry</span>
            </div>
            <div class="flex items-center gap-1.5" v-if="showMarkers">
              <span class="w-2 h-2 bg-rose-500 rotate-45 transform"></span>
              <span>Exit</span>
            </div>
          </div>
        </div>

        <!-- Dynamic Trades summary line -->
        <div v-if="activeChartData" class="flex items-center gap-4 text-[10px] text-slate-500 font-mono">
          <span>Long entries (做多买入): <span class="text-emerald-400 font-semibold">{{ longEntriesCount }}</span></span>
          <span>Long exit (平仓卖出): <span class="text-rose-400 font-semibold">{{ longExitsCount }}</span></span>
          <span class="bg-slate-900/60 px-2 py-0.5 rounded border border-slate-900/60 font-semibold">状态: 空仓 (Flat)</span>
        </div>
      </div>

      <!-- Price details HUD -->
      <div class="h-9 shrink-0 border-b border-slate-900 flex items-center justify-between text-xs px-4 text-slate-400 select-none overflow-x-auto whitespace-nowrap scrollbar-none">
        <div v-if="hudActive" class="flex items-center gap-x-4">
          <span class="text-slate-300 font-mono font-semibold">{{ hudData.timeStr }}</span>
          
          <span v-if="hudData.open !== null">
            开: <span class="text-slate-200 font-mono">{{ formatPrice(hudData.open) }}</span>
            高: <span class="text-slate-200 font-mono">{{ formatPrice(hudData.high) }}</span>
            低: <span class="text-slate-200 font-mono">{{ formatPrice(hudData.low) }}</span>
            收: <span class="text-slate-200 font-mono" :class="hudData.close! >= hudData.open ? 'text-emerald-400' : 'text-rose-400'">{{ formatPrice(hudData.close) }}</span>
          </span>

          <span v-if="showSMA20 && hudData.sma20 !== null" class="border-l border-slate-900 pl-4">
            SMA(20): <span class="text-blue-400 font-mono font-semibold">{{ formatPrice(hudData.sma20) }}</span>
          </span>
          <span v-if="showSMA50 && hudData.sma50 !== null" class="border-l border-slate-900 pl-4">
            SMA(50): <span class="text-yellow-400 font-mono font-semibold">{{ formatPrice(hudData.sma50) }}</span>
          </span>
          <span v-if="showEMA12 && hudData.ema12 !== null" class="border-l border-slate-900 pl-4">
            EMA(12): <span class="text-purple-400 font-mono font-semibold">{{ formatPrice(hudData.ema12) }}</span>
          </span>
          <span v-if="showEMA26 && hudData.ema26 !== null" class="border-l border-slate-900 pl-4">
            EMA(26): <span class="text-pink-400 font-mono font-semibold">{{ formatPrice(hudData.ema26) }}</span>
          </span>
          <span v-if="showBB && hudData.bbUpper !== null" class="border-l border-slate-900 pl-4 flex gap-2">
            <span>BB上轨: <span class="text-cyan-400 font-mono font-semibold">{{ formatPrice(hudData.bbUpper) }}</span></span>
            <span>BB中轨: <span class="text-cyan-500 font-mono font-semibold">{{ formatPrice(hudData.bbMiddle) }}</span></span>
            <span>BB下轨: <span class="text-cyan-400 font-mono font-semibold">{{ formatPrice(hudData.bbLower) }}</span></span>
          </span>

          <span v-if="hudData.equity !== null" class="border-l border-slate-900 pl-4 flex items-center gap-2">
            <span>账户权益: <span class="text-emerald-400 font-mono font-semibold">${{ hudData.equity.toLocaleString(undefined, { maximumFractionDigits: 1 }) }}</span></span>
            <span>回撤深度: <span class="text-rose-400 font-mono font-semibold">{{ (hudData.drawdown! * 100).toFixed(2) }}%</span></span>
          </span>

          <span v-for="name in activeIndicators" :key="name" class="border-l border-slate-900 pl-4">
            {{ name }}: <span class="text-orange-400 font-mono font-semibold">{{ formatPrice(hudData.indicators[name]) }}</span>
          </span>

          <span v-if="hudData.fill" class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
            :class="hudData.fill.side.toUpperCase().includes('BUY') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'">
            成交: {{ hudData.fill.side.toUpperCase().includes('BUY') ? '买入' : '卖出' }} {{ hudData.fill.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 }) }} @ ${{ formatPrice(hudData.fill.price) }}
          </span>
        </div>
        <div v-else class="text-slate-500 italic">
          {{ activeChartData ? '将鼠标悬浮在图表时间轴上以激活高频数据透视' : '等待回测数据载入...' }}
        </div>
      </div>

      <!-- Charts Container -->
      <div ref="chartsContainer" class="flex-1 flex flex-col min-h-0 p-4 gap-3 relative overflow-y-auto">
        <template v-if="activeChartData">
          <!-- Main Chart: Candlestick + SMA + Volume -->
          <div class="flex-[3] min-h-[300px] relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950/20">
            <div ref="chart1Container" class="absolute inset-0 w-full h-full"></div>
            <div class="absolute top-2 left-3 text-[9px] font-bold text-slate-500 bg-slate-950/80 border border-slate-900 px-2 py-0.5 rounded tracking-wide pointer-events-none select-none">
              主图 (K线 / 技术均线 / 交易点位 / 交易量叠加)
            </div>

            <!-- Beautiful Loading Overlay -->
            <div v-if="loadingChartData" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3 transition-opacity duration-300 pointer-events-none">
              <div class="relative w-10 h-10">
                <div class="absolute inset-0 rounded-full border-2 border-orange-500/10"></div>
                <div class="absolute inset-0 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
              </div>
              <div class="text-[10px] font-semibold text-slate-400 font-mono tracking-wider uppercase">Loading market data...</div>
            </div>
          </div>

          <!-- Equity Chart -->
          <div v-show="showEquityChart" class="flex-1 min-h-[160px] relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950/20">
            <div ref="chart2Container" class="absolute inset-0 w-full h-full"></div>
            <div class="absolute top-2 left-3 text-[9px] font-bold text-slate-500 bg-slate-950/80 border border-slate-900 px-2 py-0.5 rounded tracking-wide pointer-events-none select-none">
              账户权益副图 (Equity Curve)
            </div>
          </div>

          <!-- Drawdown Chart -->
          <div v-show="showDrawdownChart" class="flex-1 min-h-[140px] relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950/20">
            <div ref="chart3Container" class="absolute inset-0 w-full h-full"></div>
            <div class="absolute top-2 left-3 text-[9px] font-bold text-slate-500 bg-slate-950/80 border border-slate-900 px-2 py-0.5 rounded tracking-wide pointer-events-none select-none">
              资产回撤副图 (Drawdown Curve)
            </div>
          </div>

          <!-- Dynamic Indicator Charts -->
          <div v-for="name in activeIndicators" :key="name" class="flex-1 min-h-[150px] relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950/20">
            <div :ref="el => setIndicatorChartContainer(el, name)" class="absolute inset-0 w-full h-full"></div>
            <div class="absolute top-2 left-3 text-[9px] font-bold text-slate-500 bg-slate-950/80 border border-slate-900 px-2 py-0.5 rounded tracking-wide pointer-events-none select-none">
              {{ name.toUpperCase() }} 副图
            </div>
          </div>
        </template>

        <!-- Empty State inside charts area -->
        <div v-else class="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-900 bg-slate-900/10 rounded-2xl select-none">
          <div class="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 border border-orange-500/20 mb-4">
            <CandlestickChart class="w-6 h-6" />
          </div>
          <p class="text-slate-300 font-bold mb-1 text-sm">未加载回测数据</p>
          <p class="text-slate-500 max-w-sm leading-relaxed text-[11px]">
            请在【左侧栏】点击一条历史记录进行分析，或切回【启动回测】配置参数以运行新回测。
          </p>
        </div>
      </div>
    </section>

    <!-- Right Sidebar: Trade Navigation (Freqtrade-style) -->
    <aside class="w-80 border-l border-slate-900 bg-slate-950 flex flex-col shrink-0 select-none p-3 gap-3">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-900 pb-2">
        Trade Navigation ↓
      </div>

      <!-- Pairs paired trades list -->
      <div class="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        <div v-if="pairedTrades.length === 0" class="text-slate-600 italic text-center py-12">
          {{ activeChartData ? '没有检测到完成的多空平仓交易。' : '等待加载回测数据...' }}
        </div>
        <div
          v-for="trade in pairedTrades"
          :key="trade.id"
          @click="navigateToTrade(trade)"
          class="p-2.5 rounded-lg flex flex-col gap-1.5 cursor-pointer transition duration-150 border"
          :class="selectedTradeId === trade.id
            ? 'bg-orange-500/10 border-orange-500/40 text-orange-400 font-bold shadow shadow-orange-500/5'
            : 'bg-slate-900/20 border-slate-900 hover:border-slate-800 hover:bg-slate-900/40'"
        >
          <div class="flex items-center justify-between text-[10px] font-mono gap-1">
            <span class="text-slate-300 font-bold flex items-center gap-1.5 whitespace-nowrap shrink">
              <span 
                class="w-1.5 h-1.5 rounded-full"
                :class="trade.type === 'L' ? 'bg-orange-500' : 'bg-indigo-500'"
              ></span>
              {{ trade.type }} - {{ formatTime(trade.entryTime).slice(0, 16) }}
            </span>
            <span
              class="font-bold px-1.5 py-0.5 rounded text-[9px] shrink-0 whitespace-nowrap"
              :class="trade.pnlPct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'"
            >
              {{ trade.pnlPct >= 0 ? '▲' : '▼' }} {{ (trade.pnlPct * 100).toFixed(2) }}% ({{ (trade.pnlPct >= 0 ? '+' : '') }}{{ trade.pnlAmt.toFixed(1) }})
            </span>
          </div>
          <div class="flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span>数量: {{ trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 }) }}</span>
            <span>价: {{ formatPrice(trade.entryPrice) }} → {{ formatPrice(trade.exitPrice) }}</span>
          </div>
        </div>
      </div>
    </aside>

  </div>
</template>
