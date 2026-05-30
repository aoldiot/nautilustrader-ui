import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_mvp_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import duckdb_mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_eh_wasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdb_eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

// Configuration for local DuckDB-Wasm assets via Vite's asset bundling
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdb_mvp_wasm,
    mainWorker: duckdb_mvp_worker
  },
  eh: {
    mainModule: duckdb_eh_wasm,
    mainWorker: duckdb_eh_worker
  }
}

let db: duckdb.AsyncDuckDB | null = null
let conn: duckdb.AsyncDuckDBConnection | null = null
let isInitializing = false
let initPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> | null = null
let hasSymbolColumn = false
let hasFillsSymbolColumn = false
/** true = bars 数据已预聚合，queryBars() 直接 SELECT，无需 GROUP BY */
let isPreAggregated = false

let sidecarPort: number | null = null

export async function setSidecarPort(port: number | null): Promise<void> {
  sidecarPort = port
  if (port !== null) {
    try {
      const meta = await fetchSidecar('/meta')
      hasSymbolColumn = meta.has_symbol
    } catch (e) {
      console.error('Failed to load sidecar metadata:', e)
    }
  }
}

async function fetchSidecar(route: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`http://127.0.0.1:${sidecarPort}${route}`)
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, String(params[key]))
    }
  })
  const response = await fetch(url.toString())
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

/**
 * Resets the DuckDB singleton so the next call to getDuckDB() creates a fresh instance.
 * Call this before loading a new backtest to avoid stale schema issues.
 */
export async function resetDB(): Promise<void> {
  if (conn) {
    try { await conn.close() } catch { /* ignore */ }
    conn = null
  }
  if (db) {
    try { await db.terminate() } catch { /* ignore */ }
    db = null
  }
  isInitializing = false
  initPromise = null
  hasSymbolColumn = false
  hasFillsSymbolColumn = false
  isPreAggregated = false
  sidecarPort = null
}

export function getDuckDB(): Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> {
  if (db && conn) {
    return Promise.resolve({ db, conn })
  }

  if (isInitializing && initPromise) {
    return initPromise
  }

  isInitializing = true
  initPromise = (async () => {
    try {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
      
      // Instantiate worker directly using the asset URL resolved by Vite
      const worker = new Worker(bundle.mainWorker!)
      
      const logger = new duckdb.ConsoleLogger()
      const asyncDb = new duckdb.AsyncDuckDB(logger, worker)
      
      await asyncDb.instantiate(bundle.mainModule, bundle.pthreadWorker)
      const connection = await asyncDb.connect()
      
      db = asyncDb
      conn = connection
      isInitializing = false
      return { db, conn }
    } catch (error) {
      isInitializing = false
      initPromise = null
      console.error('Failed to initialize DuckDB-Wasm:', error)
      throw error
    }
  })()

  return initPromise
}

// Helper to convert Arrow rows to standard JS objects, converting BigInts to Numbers
function sanitizeRows(rows: any[]): any[] {
  return rows.map((row) => {
    const obj = {}
    // Arrow row fields can be iterated directly or via destructuring
    for (const key of Object.keys(row)) {
      const val = row[key]
      if (typeof val === 'bigint') {
        obj[key] = Number(val)
      } else if (val instanceof Uint8Array || val instanceof Uint32Array) {
        // Handle potential binary or large integer types
        obj[key] = Array.from(val)
      } else {
        obj[key] = val
      }
    }
    return obj
  })
}

/**
 * Loads backtest data into DuckDB-Wasm memory.
 */
export async function loadBacktestParquet(
  barsBuffer: ArrayBuffer | null,
  fillsBuffer: ArrayBuffer | null,
  equityBuffer: ArrayBuffer | null
): Promise<void> {
  const { db: asyncDb, conn: connection } = await getDuckDB()

  if (barsBuffer && barsBuffer.byteLength > 0) {
    try {
      await asyncDb.registerFileBuffer('bars.parquet', new Uint8Array(barsBuffer))
      // Drop both VIEW and TABLE variants to handle legacy schemas from previous sessions
      await connection.query(`DROP VIEW IF EXISTS v_bars`)
      await connection.query(`DROP TABLE IF EXISTS v_bars`)
      await connection.query(`CREATE TABLE v_bars AS SELECT * FROM read_parquet('bars.parquet')`)

      try {
        await connection.query(`SELECT symbol FROM v_bars LIMIT 1`)
        hasSymbolColumn = true
      } catch {
        hasSymbolColumn = false
      }

      // 检测是否为预聚合数据（预聚合文件的时间戳已是目标时间框架的整数倍，
      // 用相邻行间距是否均匀来判断：取前100行差值，若最小差值 >= 15分钟则认为已预聚合）
      try {
        const partitionClause = hasSymbolColumn ? 'PARTITION BY symbol' : ''
        const sampleResult = await connection.query(`
          WITH s AS (
            SELECT timestamp, LAG(timestamp) OVER (${partitionClause} ORDER BY timestamp) AS prev_ts
            FROM v_bars LIMIT 200
          )
          SELECT MIN(timestamp - prev_ts) AS min_diff FROM s WHERE prev_ts IS NOT NULL
        `)
        const sampleRows = sanitizeRows(sampleResult.toArray())
        const minDiffNs = sampleRows.length > 0 ? Number(sampleRows[0].min_diff) : 0
        // 最小间距 >= 15分钟(纳秒) 视为预聚合数据
        isPreAggregated = minDiffNs >= 15 * 60 * 1_000_000_000
      } catch {
        isPreAggregated = false
      }
    } catch (err: any) {
      throw new Error(`载入K线数据表 (bars.parquet) 失败，请确认文件无损且为 Parquet 格式: ${err.message}`)
    }
  } else {
    throw new Error('K线数据为空，无法载入 v_bars 表。')
  }

  if (fillsBuffer && fillsBuffer.byteLength > 0) {
    try {
      await asyncDb.registerFileBuffer('fills.parquet', new Uint8Array(fillsBuffer))
      // Drop both VIEW and TABLE variants to handle legacy schemas from previous sessions
      await connection.query(`DROP VIEW IF EXISTS v_fills`)
      await connection.query(`DROP TABLE IF EXISTS v_fills`)
      await connection.query(`CREATE TABLE v_fills AS SELECT * FROM read_parquet('fills.parquet')`)

      try {
        await connection.query(`SELECT symbol FROM v_fills LIMIT 1`)
        hasFillsSymbolColumn = true
      } catch {
        hasFillsSymbolColumn = false
      }
    } catch (err: any) {
      throw new Error(`载入成交数据表 (fills.parquet) 失败: ${err.message}`)
    }
  }

  if (equityBuffer && equityBuffer.byteLength > 0) {
    try {
      await asyncDb.registerFileBuffer('equity.parquet', new Uint8Array(equityBuffer))
      // Drop both VIEW and TABLE variants to handle legacy schemas from previous sessions
      await connection.query(`DROP VIEW IF EXISTS v_equity`)
      await connection.query(`DROP TABLE IF EXISTS v_equity`)
      await connection.query(`CREATE TABLE v_equity AS SELECT * FROM read_parquet('equity.parquet')`)
    } catch (err: any) {
      throw new Error(`载入资金资产数据表 (equity.parquet) 失败，请确认文件无损且为 Parquet 格式: ${err.message}`)
    }
  } else {
    throw new Error('账户资产数据为空，无法载入 v_equity 表。')
  }
}

/**
 * Queries K-line data (OHLCV) with timestamp scaled to seconds (UnixNanos / 1e9).
 */
export async function queryBars(
  symbol: string | null = null,
  timeframeSeconds = 60,
  start: number | null = null,
  end: number | null = null,
  limit = 2000
): Promise<any[]> {
  if (sidecarPort !== null) {
    return fetchSidecar('/bars', { symbol, timeframe: timeframeSeconds, start, end, limit })
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_bars'`)
    if (checkTable.numRows === 0) {
      throw new Error('虚拟表 v_bars 未被成功创建。')
    }

    let activeSymbol = symbol
    if (hasSymbolColumn && !activeSymbol) {
      const firstSymResult = await connection.query(`SELECT symbol FROM v_bars LIMIT 1`)
      const firstSymRows = sanitizeRows(firstSymResult.toArray())
      if (firstSymRows.length > 0) {
        activeSymbol = firstSymRows[0].symbol
      }
    }
    const whereClause = hasSymbolColumn && activeSymbol ? `WHERE symbol = '${activeSymbol}'` : ''

    // Detect extra indicator columns
    const colsResult = await connection.query(`PRAGMA table_info('v_bars')`)
    const colsRows = sanitizeRows(colsResult.toArray())
    const allCols = colsRows.map(r => String(r.name))
    const standardCols = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'symbol']
    const indicatorCols = allCols.filter(c => !standardCols.includes(c.toLowerCase()))

    let result
    if (isPreAggregated) {
      // ✅ 预聚合数据：直接 SELECT，无需 GROUP BY，速度提升 10-15 倍
      const extraSelect = indicatorCols.length > 0
        ? ', ' + indicatorCols.map(c => `"${c}"`).join(', ')
        : ''
      result = await connection.query(`
        SELECT
          CAST(timestamp / 1000000000 AS BIGINT) AS time,
          open, high, low, close, volume
          ${extraSelect}
        FROM v_bars
        ${whereClause}
        ORDER BY time ASC
      `)
    } else {
      // 原始1分钟数据：GROUP BY 聚合到目标时间框架
      const extraSelect = indicatorCols.length > 0
        ? indicatorCols.map(c => `, LAST("${c}" ORDER BY timestamp ASC) AS "${c}"`).join('')
        : ''
      result = await connection.query(`
        SELECT
          (CAST(timestamp / 1000000000 AS BIGINT) / ${timeframeSeconds}) * ${timeframeSeconds} AS time,
          FIRST(open ORDER BY timestamp ASC) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          LAST(close ORDER BY timestamp ASC) AS close,
          SUM(volume) AS volume
          ${extraSelect}
        FROM v_bars
        ${whereClause}
        GROUP BY time
        ORDER BY time ASC
      `)
    }

    const rows = sanitizeRows(result.toArray())
    if (rows.length === 0) {
      throw new Error('K线数据表 v_bars 内记录行为空，无法绘制图表。')
    }
    return rows
  } catch (err: any) {
    console.error('Error querying bars:', err)
    throw new Error(`K线SQL查询失败: ${err.message}`)
  }
}

/**
 * Queries Fills (Trades) data with timestamp scaled to seconds.
 */
export async function queryFills(symbol: string | null = null): Promise<any[]> {
  if (sidecarPort !== null) {
    return fetchSidecar('/fills', { symbol })
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_fills'`)
    if (checkTable.numRows === 0) return []

    let sql = ''
    if (symbol) {
      if (hasFillsSymbolColumn) {
        sql = `
          SELECT 
            CAST(timestamp / 1000000000 AS BIGINT) AS time,
            FIRST(price) AS price,
            SUM(quantity) AS quantity,
            side
          FROM v_fills
          WHERE symbol = '${symbol}'
          GROUP BY CAST(timestamp / 1000000000 AS BIGINT), side
          ORDER BY time ASC
        `
      } else if (hasSymbolColumn) {
        // 两步查询优化：先查出该币种价格区间，规避秒级时间戳的大表 JOIN
        const priceRangeResult = await connection.query(`
          SELECT MIN(low) AS min_low, MAX(high) AS max_high 
          FROM v_bars 
          WHERE symbol = '${symbol}'
        `)
        const rangeRows = sanitizeRows(priceRangeResult.toArray())
        if (rangeRows.length > 0 && rangeRows[0].min_low !== null) {
          const minLow = rangeRows[0].min_low
          const maxHigh = rangeRows[0].max_high
          sql = `
            SELECT 
              CAST(timestamp / 1000000000 AS BIGINT) AS time,
              FIRST(price) AS price,
              SUM(quantity) AS quantity,
              side
            FROM v_fills
            WHERE price >= ${minLow * 0.8} AND price <= ${maxHigh * 1.2}
            GROUP BY CAST(timestamp / 1000000000 AS BIGINT), side
            ORDER BY time ASC
          `
        } else {
          sql = `
            SELECT 
              CAST(timestamp / 1000000000 AS BIGINT) AS time,
              FIRST(price) AS price,
              SUM(quantity) AS quantity,
              side
            FROM v_fills
            GROUP BY CAST(timestamp / 1000000000 AS BIGINT), side
            ORDER BY time ASC
          `
        }
      } else {
        sql = `
          SELECT 
            CAST(timestamp / 1000000000 AS BIGINT) AS time,
            FIRST(price) AS price,
            SUM(quantity) AS quantity,
            side
          FROM v_fills
          GROUP BY CAST(timestamp / 1000000000 AS BIGINT), side
          ORDER BY time ASC
        `
      }
    } else {
      sql = `
        SELECT 
          CAST(timestamp / 1000000000 AS BIGINT) AS time,
          FIRST(price) AS price,
          SUM(quantity) AS quantity,
          side
        FROM v_fills
        GROUP BY CAST(timestamp / 1000000000 AS BIGINT), side
        ORDER BY time ASC
      `
    }

    const result = await connection.query(sql)
    return sanitizeRows(result.toArray())
  } catch (err: any) {
    console.error('Error querying fills:', err)
    throw new Error(`成交历史SQL查询失败，请检查 fills.parquet 的列名(需包含 timestamp, price, quantity, side): ${err.message}`)
  }
}

/**
 * Queries Equity Curve & Drawdown data with timestamp scaled to seconds.
 */
export async function queryEquity(): Promise<any[]> {
  if (sidecarPort !== null) {
    return fetchSidecar('/equity')
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_equity'`)
    if (checkTable.numRows === 0) {
      throw new Error('虚拟表 v_equity 未被成功创建。')
    }

    // Group by time to get unique timestamps
    const result = await connection.query(`
      SELECT 
        CAST(timestamp / 1000000000 AS BIGINT) AS time,
        LAST(equity) AS equity,
        LAST(drawdown) AS drawdown
      FROM v_equity
      GROUP BY time
      ORDER BY time ASC
    `)
    const rows = sanitizeRows(result.toArray())
    if (rows.length === 0) {
      throw new Error('资金账户曲线 v_equity 内记录行为空，无法绘制资产曲线。')
    }
    return rows
  } catch (err: any) {
    console.error('Error querying equity:', err)
    throw new Error(`资金资产历史SQL查询失败，请检查 equity.parquet 的列名(需包含 timestamp, equity, drawdown): ${err.message}`)
  }
}

/**
 * Dynamic indicator calculation using DuckDB SQL Window functions (SMA 20 & SMA 50).
 */
export async function queryIndicators(
  symbol: string | null = null,
  timeframeSeconds = 60,
  start: number | null = null,
  end: number | null = null,
  limit = 2000
): Promise<any[]> {
  if (sidecarPort !== null) {
    return fetchSidecar('/indicators', { symbol, timeframe: timeframeSeconds, start, end, limit })
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_bars'`)
    if (checkTable.numRows === 0) {
      throw new Error('虚拟表 v_bars 未创建，无法计算技术指标。')
    }

    let activeSymbol = symbol
    if (hasSymbolColumn && !activeSymbol) {
      const firstSymResult = await connection.query(`SELECT symbol FROM v_bars LIMIT 1`)
      const firstSymRows = sanitizeRows(firstSymResult.toArray())
      if (firstSymRows.length > 0) {
        activeSymbol = firstSymRows[0].symbol
      }
    }
    const whereClause = hasSymbolColumn && activeSymbol ? `WHERE symbol = '${activeSymbol}'` : ''

    // 预聚合数据直接用，无需二次 GROUP BY；原始1分钟数据需先聚合
    const baseCTE = isPreAggregated
      ? `WITH base AS (
           SELECT CAST(timestamp / 1000000000 AS BIGINT) AS time, close
           FROM v_bars ${whereClause} ORDER BY time ASC
         )`
      : `WITH base AS (
           SELECT
             (CAST(timestamp / 1000000000 AS BIGINT) / ${timeframeSeconds}) * ${timeframeSeconds} AS time,
             LAST(close ORDER BY timestamp ASC) AS close
           FROM v_bars ${whereClause}
           GROUP BY time
           ORDER BY time ASC
         )`

    const result = await connection.query(`
      ${baseCTE}
      SELECT
        time, close,
        AVG(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sma_20,
        AVG(close) OVER (ORDER BY time ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma_50,
        AVG(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS bb_middle,
        AVG(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) + 2 * COALESCE(STDDEV_SAMP(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW), 0) AS bb_upper,
        AVG(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) - 2 * COALESCE(STDDEV_SAMP(close) OVER (ORDER BY time ROWS BETWEEN 19 PRECEDING AND CURRENT ROW), 0) AS bb_lower
      FROM base
      ORDER BY time ASC
    `)
    const rows = sanitizeRows(result.toArray())

    // Calculate EMA 12 and EMA 26 in JavaScript
    if (rows.length > 0) {
      let ema12 = rows[0].close || 0
      let ema26 = rows[0].close || 0
      const k12 = 2 / (12 + 1)
      const k26 = 2 / (26 + 1)

      rows[0].ema_12 = ema12
      rows[0].ema_26 = ema26

      for (let i = 1; i < rows.length; i++) {
        const closeVal = rows[i].close || 0
        ema12 = closeVal * k12 + ema12 * (1 - k12)
        ema26 = closeVal * k26 + ema26 * (1 - k26)
        rows[i].ema_12 = ema12
        rows[i].ema_26 = ema26
      }
    }

    return rows
  } catch (err: any) {
    console.error('Error querying indicators:', err)
    throw new Error(`技术指标动态SQL计算失败: ${err.message}`)
  }
}

export async function querySymbols(): Promise<Array<{ symbol: string; changePct: number }>> {
  if (sidecarPort !== null) {
    return fetchSidecar('/symbols')
  }
  const { conn: connection } = await getDuckDB()
  try {
    if (!hasSymbolColumn) return []

    // 1. Query the list of distinct symbols
    const symbolsResult = await connection.query(`SELECT DISTINCT symbol FROM v_bars ORDER BY symbol ASC`)
    const symbolsList = sanitizeRows(symbolsResult.toArray()).map(r => r.symbol)

    // 2. Query all fills
    const fillsCheck = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_fills'`)
    let fillsList: any[] = []
    if (fillsCheck.numRows > 0) {
      if (hasFillsSymbolColumn) {
        const fillsResult = await connection.query(`SELECT symbol, price, quantity, side, timestamp FROM v_fills ORDER BY timestamp ASC`)
        fillsList = sanitizeRows(fillsResult.toArray())
      } else {
        const fillsResult = await connection.query(`SELECT price, quantity, side, timestamp FROM v_fills ORDER BY timestamp ASC`)
        const tempFills = sanitizeRows(fillsResult.toArray())
        if (hasSymbolColumn && symbolsList.length > 0) {
          const priceRangesResult = await connection.query(`
            SELECT symbol, MIN(low) AS min_low, MAX(high) AS max_high 
            FROM v_bars 
            GROUP BY symbol
          `)
          const ranges = sanitizeRows(priceRangesResult.toArray())
          fillsList = tempFills.map(fill => {
            const matchingSymbols = ranges.filter(r => r.min_low !== null && fill.price >= r.min_low * 0.8 && fill.price <= r.max_high * 1.2)
            let bestSymbol = ''
            if (matchingSymbols.length > 0) {
              let minDiff = Infinity
              matchingSymbols.forEach(r => {
                const center = (r.min_low + r.max_high) / 2
                const diff = Math.abs(fill.price - center)
                if (diff < minDiff) {
                  minDiff = diff
                  bestSymbol = r.symbol
                }
              })
            } else if (ranges.length > 0) {
              bestSymbol = ranges[0].symbol
            }
            return { ...fill, symbol: bestSymbol }
          })
        } else {
          fillsList = tempFills.map(fill => ({ ...fill, symbol: '' }))
        }
      }
    }

    // 3. Group fills by symbol
    const fillsBySymbol = new Map<string, any[]>()
    fillsList.forEach(fill => {
      if (!fillsBySymbol.has(fill.symbol)) {
        fillsBySymbol.set(fill.symbol, [])
      }
      fillsBySymbol.get(fill.symbol)!.push(fill)
    })

    // 4. Calculate cumulative trade return % for each symbol
    const symbolPnLMap = new Map<string, number>()
    symbolsList.forEach(sym => {
      const symbolFills = fillsBySymbol.get(sym) || []
      const buyFills = symbolFills.filter(f => String(f.side).toUpperCase().includes('BUY') || f.side === 'buy' || f.side === 1)
      const sellFills = symbolFills.filter(f => String(f.side).toUpperCase().includes('SELL') || f.side === 'sell' || f.side === 2)
      const tradeCount = Math.min(buyFills.length, sellFills.length)

      let sumPnlPct = 0
      for (let i = 0; i < tradeCount; i++) {
        const buy = buyFills[i]
        const sell = sellFills[i]
        if (buy.price > 0) {
          sumPnlPct += (sell.price - buy.price) / buy.price
        }
      }
      symbolPnLMap.set(sym, sumPnlPct)
    })

    return symbolsList.map(sym => ({
      symbol: sym,
      changePct: symbolPnLMap.get(sym) || 0
    }))
  } catch (err: any) {
    console.error('Error querying symbols:', err)
    return []
  }
}

export async function detectBaseTimeframe(): Promise<number> {
  if (sidecarPort !== null) {
    const meta = await fetchSidecar('/meta')
    return meta.base_timeframe || 60
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_bars'`)
    if (checkTable.numRows === 0) return 60

    const partitionClause = hasSymbolColumn ? 'PARTITION BY symbol' : ''
    const selectFields = hasSymbolColumn ? 'timestamp, symbol' : 'timestamp'
    const result = await connection.query(`
      WITH sample_bars AS (
        SELECT ${selectFields} FROM v_bars ORDER BY timestamp ASC LIMIT 500
      ),
      diffs AS (
        SELECT 
          (timestamp - LAG(timestamp) OVER (${partitionClause} ORDER BY timestamp ASC)) / 1000000000 AS diff
        FROM sample_bars
      )
      SELECT MIN(diff) AS base_interval FROM diffs WHERE diff > 0
    `)
    const rows = sanitizeRows(result.toArray())
    if (rows.length > 0 && rows[0].base_interval !== null) {
      return Math.round(rows[0].base_interval)
    }
    return 60
  } catch (err) {
    console.error('Error detecting base timeframe:', err)
    return 60
  }
}

export async function queryIndicatorColumns(): Promise<string[]> {
  if (sidecarPort !== null) {
    const meta = await fetchSidecar('/meta')
    return meta.indicator_columns || []
  }
  const { conn: connection } = await getDuckDB()
  try {
    const checkTable = await connection.query(`SELECT * FROM information_schema.tables WHERE table_name = 'v_bars'`)
    if (checkTable.numRows === 0) return []

    const colsResult = await connection.query(`PRAGMA table_info('v_bars')`)
    const colsRows = sanitizeRows(colsResult.toArray())
    const allCols = colsRows.map(r => String(r.name))
    const standardCols = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'symbol']
    return allCols.filter(c => !standardCols.includes(c.toLowerCase()))
  } catch (err) {
    console.error('Error querying indicator columns:', err)
    return []
  }
}

export function getHasSymbolColumn(): boolean {
  return hasSymbolColumn
}

export function getHasFillsSymbolColumn(): boolean {
  return hasFillsSymbolColumn
}

export function getIsPreAggregated(): boolean {
  return isPreAggregated
}

/**
 * Hot-swaps the v_bars table with a new bars buffer (e.g., when the user switches timeframe).
 * Only replaces v_bars — fills and equity tables are preserved, avoiding a full DuckDB reset.
 */
export async function loadBarsBuffer(barsBuffer: ArrayBuffer): Promise<void> {
  if (sidecarPort !== null) {
    return
  }
  const { db: asyncDb, conn: connection } = await getDuckDB()
  try {
    await asyncDb.registerFileBuffer('bars_new.parquet', new Uint8Array(barsBuffer))
    await connection.query(`DROP VIEW IF EXISTS v_bars`)
    await connection.query(`DROP TABLE IF EXISTS v_bars`)
    await connection.query(`CREATE TABLE v_bars AS SELECT * FROM read_parquet('bars_new.parquet')`)

    // Re-detect symbol column
    try {
      await connection.query(`SELECT symbol FROM v_bars LIMIT 1`)
      hasSymbolColumn = true
    } catch {
      hasSymbolColumn = false
    }

    // Re-detect if new data is pre-aggregated
    try {
      const partitionClause = hasSymbolColumn ? 'PARTITION BY symbol' : ''
      const sampleResult = await connection.query(`
        WITH s AS (
          SELECT timestamp, LAG(timestamp) OVER (${partitionClause} ORDER BY timestamp) AS prev_ts
          FROM v_bars LIMIT 200
        )
        SELECT MIN(timestamp - prev_ts) AS min_diff FROM s WHERE prev_ts IS NOT NULL
      `)
      const sampleRows = sanitizeRows(sampleResult.toArray())
      const minDiffNs = sampleRows.length > 0 ? Number(sampleRows[0].min_diff) : 0
      isPreAggregated = minDiffNs >= 15 * 60 * 1_000_000_000
    } catch {
      isPreAggregated = false
    }
  } catch (err: any) {
    throw new Error(`切换时间框架失败，无法替换 v_bars 表: ${err.message}`)
  }
}
