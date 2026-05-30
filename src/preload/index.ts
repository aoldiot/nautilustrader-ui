import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const nautilusAPI = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('nautilus:select-folder'),
  loadBacktestData: (folderPath: string): Promise<{
    summary: any
    bars: ArrayBuffer | null
    fills: ArrayBuffer | null
    equity: ArrayBuffer | null
    folderName: string
    availableTimeframes: string[]
    loadedTimeframe: string
  }> => ipcRenderer.invoke('nautilus:load-backtest-data', folderPath),
  loadTimeframeBars: (folderPath: string, timeframe: string): Promise<{ bars: ArrayBuffer; timeframe: string }> =>
    ipcRenderer.invoke('nautilus:load-timeframe-bars', folderPath, timeframe),
  runBacktest: (params: {
    symbol: string
    startDate: string
    endDate: string
    initialCapital: number
    fastPeriod: number
    slowPeriod: number
    strategyClass?: string
    strategyPath?: string
    strategyParams?: Record<string, any>
  }): Promise<{ success: boolean; outputPath: string }> => ipcRenderer.invoke('nautilus:run-backtest', params),
  onBacktestLog: (callback: (log: string) => void): (() => void) => {
    const listener = (_event: any, log: string) => callback(log)
    ipcRenderer.on('backtest:log', listener)
    return () => {
      ipcRenderer.removeListener('backtest:log', listener)
    }
  },
  listBacktests: (): Promise<any[]> => ipcRenderer.invoke('nautilus:list-backtests'),
  deleteBacktest: (runId: string): Promise<{ success: boolean }> => ipcRenderer.invoke('nautilus:delete-backtest', runId),
  selectProjectDir: (): Promise<string | null> => ipcRenderer.invoke('nautilus:select-project-dir'),
  getStoredProjectDir: (): Promise<string | null> => ipcRenderer.invoke('nautilus:get-stored-project-dir'),
  scanStrategies: (projectPath: string): Promise<any[]> => ipcRenderer.invoke('nautilus:scan-strategies', projectPath),
  getStoredResultsPath: (): Promise<{ backtestResultsPath: string | null; selectedResultsSubdir: string | null }> => 
    ipcRenderer.invoke('nautilus:get-stored-results-path'),
  storeResultsPath: (path: string | null): Promise<boolean> => 
    ipcRenderer.invoke('nautilus:store-results-path', path),
  storeSelectedSubdir: (subdir: string | null): Promise<boolean> => 
    ipcRenderer.invoke('nautilus:store-selected-subdir', subdir),
  scanResultsSubdirs: (resultsPath: string): Promise<any[]> => 
    ipcRenderer.invoke('nautilus:scan-results-subdirs', resultsPath),
  getDataCoverage: (projectPath: string): Promise<any[]> => 
    ipcRenderer.invoke('nautilus:get-data-coverage', projectPath),
  downloadData: (params: { projectPath: string; startDate: string; endDate: string; pairs?: string; timeframes?: string }): Promise<{ success: boolean }> => 
    ipcRenderer.invoke('nautilus:download-data', params),
  onDownloadLog: (callback: (log: string) => void): (() => void) => {
    const listener = (_event: any, log: string) => callback(log)
    ipcRenderer.on('data:download-log', listener)
    return () => {
      ipcRenderer.removeListener('data:download-log', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('nautilusAPI', nautilusAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.nautilusAPI = nautilusAPI
}
