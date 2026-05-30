import { ElectronAPI } from '@electron-toolkit/preload'

interface NautilusAPI {
  selectFolder(): Promise<string | null>
  loadBacktestData(folderPath: string): Promise<{
    port?: number
    summary: any
    bars: ArrayBuffer | null
    fills: ArrayBuffer | null
    equity: ArrayBuffer | null
    folderName: string
    availableTimeframes: string[]
    loadedTimeframe: string
  }>
  loadTimeframeBars(folderPath: string, timeframe: string): Promise<{ bars: ArrayBuffer; timeframe: string }>
  runBacktest(params: {
    symbol: string
    startDate: string
    endDate: string
    initialCapital: number
    fastPeriod: number
    slowPeriod: number
    strategyClass?: string
    strategyPath?: string
    strategyParams?: Record<string, any>
  }): Promise<{ success: boolean; outputPath: string }>
  onBacktestLog(callback: (log: string) => void): () => void
  listBacktests(): Promise<any[]>
  deleteBacktest(runId: string): Promise<{ success: boolean }>
  selectProjectDir(): Promise<string | null>
  getStoredProjectDir(): Promise<string | null>
  scanStrategies(projectPath: string): Promise<any[]>
  getStoredResultsPath(): Promise<{ backtestResultsPath: string | null; selectedResultsSubdir: string | null }>
  storeResultsPath(path: string | null): Promise<boolean>
  storeSelectedSubdir(subdir: string | null): Promise<boolean>
  scanResultsSubdirs(resultsPath: string): Promise< ScannedResultsRun[] >
  getDataCoverage(projectPath: string): Promise<any[]>
  downloadData(params: {
    projectPath: string
    startDate: string
    endDate: string
    pairs?: string
    timeframes?: string
  }): Promise<{ success: boolean }>
  onDownloadLog(callback: (log: string) => void): () => void
}

export interface ScannedResultsRun {
  id: string
  name: string
  path: string
  createdAt: number
  summary: any
}

declare global {
  interface Window {
    electron: ElectronAPI
    nautilusAPI: NautilusAPI
  }
}
