import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import icon from '../../resources/icon.png?asset'
import { generateBacktestScript } from './backtest_template'
import { NAUTILUS_EXPORTER_CONTENT } from './nautilus_exporter_content'
import { SIDECAR_SERVER_CONTENT } from './sidecar_server_content'
import { DOWNLOAD_DATA_CONTENT } from './download_data_content'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: any = null

function getExecutionTime(name: string, stats: any): number {
  // Try Format A: TripleEMA_20241001_20260101_20260530_160852
  const parts = name.split('_')
  if (parts.length >= 5) {
    const runDate = parts[3]
    const runTime = parts[4]
    if (runDate && runTime && runDate.length === 8 && runTime.length === 6) {
      const year = parseInt(runDate.slice(0, 4), 10)
      const month = parseInt(runDate.slice(4, 6), 10) - 1
      const day = parseInt(runDate.slice(6, 8), 10)
      const hour = parseInt(runTime.slice(0, 2), 10)
      const min = parseInt(runTime.slice(2, 4), 10)
      const sec = parseInt(runTime.slice(4, 6), 10)
      const date = new Date(year, month, day, hour, min, sec)
      if (!isNaN(date.getTime())) {
        return date.getTime()
      }
    }
  }

  // Try Format B: 2026-05-28_11-45-30_BTC-USD
  const dateMatch = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_/)
  if (dateMatch) {
    const year = parseInt(dateMatch[1], 10)
    const month = parseInt(dateMatch[2], 10) - 1
    const day = parseInt(dateMatch[3], 10)
    const hour = parseInt(dateMatch[4], 10)
    const min = parseInt(dateMatch[5], 10)
    const sec = parseInt(dateMatch[6], 10)
    const date = new Date(year, month, day, hour, min, sec)
    if (!isNaN(date.getTime())) {
      return date.getTime()
    }
  }

  // Fallback to stats birthtime or mtime
  return stats.birthtimeMs || stats.mtimeMs || 0
}

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers for NautilusTrader Backtest Analyzer
  ipcMain.handle('nautilus:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select NautilusTrader Backtest Results Folder'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  async function readConfig() {
    try {
      const configPath = join(app.getPath('userData'), 'config.json')
      const content = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  async function writeConfig(updates: Record<string, any>) {
    try {
      const configPath = join(app.getPath('userData'), 'config.json')
      const current = await readConfig()
      const merged = { ...current, ...updates }
      await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('Failed to write config:', err)
      return false
    }
  }

  ipcMain.handle('nautilus:select-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Strategy Project Folder'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const projectPath = result.filePaths[0]
    await writeConfig({ projectPath })
    return projectPath
  })

  ipcMain.handle('nautilus:get-stored-project-dir', async () => {
    const config = await readConfig()
    return config.projectPath || null
  })

  ipcMain.handle('nautilus:get-stored-results-path', async () => {
    const config = await readConfig()
    return {
      backtestResultsPath: config.backtestResultsPath || null,
      selectedResultsSubdir: config.selectedResultsSubdir || null
    }
  })

  ipcMain.handle('nautilus:store-results-path', async (_, path: string | null) => {
    return await writeConfig({
      backtestResultsPath: path,
      selectedResultsSubdir: null // Reset sub-directory selection on parent path change
    })
  })

  ipcMain.handle('nautilus:store-selected-subdir', async (_, subdir: string | null) => {
    return await writeConfig({
      selectedResultsSubdir: subdir
    })
  })

  ipcMain.handle('nautilus:scan-results-subdirs', async (_, resultsPath: string) => {
    try {
      try {
        await fs.access(resultsPath)
      } catch {
        return []
      }

      const files = await fs.readdir(resultsPath)
      const runs: any[] = []

      for (const file of files) {
        const runPath = join(resultsPath, file)
        const stats = await fs.stat(runPath)
        
        if (!stats.isDirectory()) continue
        if (file === 'output' || file === 'output_old') continue

        let summary = null
        try {
          const summaryPath = join(runPath, 'summary.json')
          await fs.access(summaryPath)
          const summaryStr = await fs.readFile(summaryPath, 'utf-8')
          summary = JSON.parse(summaryStr)
        } catch {
          // Skip folders that do not have summary.json (incomplete/not backtest results)
          continue
        }

        // Validate essential files exist
        try {
          await fs.access(join(runPath, 'bars.parquet'))
          await fs.access(join(runPath, 'equity.parquet'))
        } catch {
          continue
        }

        runs.push({
          id: file,
          name: file,
          path: runPath,
          createdAt: getExecutionTime(file, stats),
          summary
        })
      }

      // Sort by createdAt descending (newest backtest runs first)
      return runs.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      console.error('Scan results subdirs error:', error)
      return []
    }
  })

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

function getClassBody(content: string, classStartIndex: number): string[] {
  const lines = content.slice(classStartIndex).split(/\r?\n/)
  if (lines.length <= 1) return []
  
  const bodyLines: string[] = []
  let classIndentation: number | null = null
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    
    const indentMatch = line.match(/^(\s+)/)
    if (!indentMatch) break
    
    const indent = indentMatch[1].length
    if (classIndentation === null) {
      classIndentation = indent
    } else if (indent < classIndentation) {
      break
    }
    bodyLines.push(line)
  }
  return bodyLines
}

function parsePythonStrategyFile(content: string, fileName: string, filePath: string): ScannedStrategy[] {
  const classRegex = /class\s+(\w+)(?:\s*\(([\s\S]*?)\))?\s*:/g
  const classes: Array<{ name: string; parents: string; startIndex: number; bodyLines: string[] }> = []
  
  let match
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1]
    const parents = match[2] ? match[2].replace(/\s+/g, '') : ''
    const startIndex = match.index
    classes.push({
      name,
      parents,
      startIndex,
      bodyLines: []
    })
  }

  // Get bodies for all classes
  for (const cls of classes) {
    cls.bodyLines = getClassBody(content, cls.startIndex)
  }

  // Config classes: inherit from StrategyConfig or name ends with Config
  const configs = classes.filter(cls => cls.parents.includes('StrategyConfig') || cls.name.endsWith('Config'))
  // Strategy classes: inherit from Strategy or name ends with Strategy (excluding config classes)
  const strategies = classes.filter(cls => 
    (cls.parents.includes('Strategy') || cls.name.endsWith('Strategy')) && 
    !cls.parents.includes('StrategyConfig') && 
    !cls.name.endsWith('Config')
  )

  const scannedStrategies: ScannedStrategy[] = []

  for (const strat of strategies) {
    // Look for matching config class
    let configClass = configs.find(c => {
      const initLine = strat.bodyLines.find(line => /def\s+__init__/.test(line))
      if (initLine) {
        const typeHintMatch = initLine.match(/config\s*:\s*(['"]?)(\w+)\1/)
        if (typeHintMatch && typeHintMatch[2] === c.name) {
          return true
        }
      }
      return false
    })

    if (!configClass) {
      configClass = configs.find(c => c.name === `${strat.name}Config`)
    }

    if (!configClass && configs.length === 1) {
      configClass = configs[0]
    }

    const params: ScannedParameter[] = []

    if (configClass) {
      for (const line of configClass.bodyLines) {
        const cleanLine = line.split('#')[0].trim()
        if (!cleanLine) continue

        let pName = ''
        let pType = ''
        let pRawDefault: string | undefined = undefined

        // Try type hint: name: type = default or name: type
        const fieldMatch = cleanLine.match(/^(\w+)\s*:\s*([^=]+?)(?:\s*=\s*(.*))?$/)
        if (fieldMatch) {
          pName = fieldMatch[1]
          pType = fieldMatch[2].trim()
          pRawDefault = fieldMatch[3] ? fieldMatch[3].trim() : undefined
        } else {
          // Try standard assignment: name = default
          const assignmentMatch = cleanLine.match(/^(\w+)\s*=\s*(.*)$/)
          if (assignmentMatch) {
            pName = assignmentMatch[1]
            pRawDefault = assignmentMatch[2].trim()
          }
        }

        if (!pName || pName.startsWith('_')) continue
        if (pName === 'class' || pName === 'def' || pName === 'pass' || pName === 'return') continue

        let typeMapped: 'int' | 'float' | 'bool' | 'str' | 'any' = 'any'
        if (pType) {
          if (/\bint\b/.test(pType)) {
            typeMapped = 'int'
          } else if (/\bfloat\b|\bDecimal\b|\bdouble\b/.test(pType)) {
            typeMapped = 'float'
          } else if (/\bbool\b/.test(pType)) {
            typeMapped = 'bool'
          } else if (/\bstr\b/.test(pType)) {
            typeMapped = 'str'
          }
        }

        let parsedDefault: any = pRawDefault

        if (pRawDefault !== undefined) {
          if ((pRawDefault.startsWith("'") && pRawDefault.endsWith("'")) ||
              (pRawDefault.startsWith('"') && pRawDefault.endsWith('"'))) {
            parsedDefault = pRawDefault.slice(1, -1)
            if (typeMapped === 'any') typeMapped = 'str'
          } else if (pRawDefault === 'True') {
            parsedDefault = true
            typeMapped = 'bool'
          } else if (pRawDefault === 'False') {
            parsedDefault = false
            typeMapped = 'bool'
          } else if (pRawDefault === 'None') {
            parsedDefault = null
          } else if (/^-?\d+$/.test(pRawDefault)) {
            parsedDefault = parseInt(pRawDefault, 10)
            if (typeMapped === 'any') typeMapped = 'int'
          } else if (/^-?\d*\.\d+$/.test(pRawDefault)) {
            parsedDefault = parseFloat(pRawDefault)
            if (typeMapped === 'any') typeMapped = 'float'
          } else {
            const decimalMatch = pRawDefault.match(/Decimal\s*\(\s*(['"]?)(.*?)\1\s*\)/)
            if (decimalMatch) {
              parsedDefault = parseFloat(decimalMatch[2])
              typeMapped = 'float'
            }
          }
        }

        params.push({
          name: pName,
          type: typeMapped,
          defaultValue: parsedDefault
        })
      }
    }

    scannedStrategies.push({
      fileName,
      filePath,
      className: strat.name,
      configClassName: configClass?.name,
      parameters: params
    })
  }

  return scannedStrategies
}

  ipcMain.handle('nautilus:scan-strategies', async (_, projectPath: string) => {
    try {
      const results: ScannedStrategy[] = []
      
      async function scan(currentDir: string) {
        const files = await fs.readdir(currentDir)
        for (const file of files) {
          // Skip node_modules, build/dist/out directories, virtualenv/env dirs and git/IDE directories
          if (
            file === 'node_modules' || 
            file === '.git' || 
            file === 'out' || 
            file === 'build' || 
            file === 'dist' || 
            file === 'mock_data' || 
            file === 'backtests' ||
            file === 'venv' ||
            file === '.venv' ||
            file === 'env' ||
            file === '.idea' ||
            file === '.vscode' ||
            file === '__pycache__'
          ) {
            continue
          }
          
          const fullPath = join(currentDir, file)
          const stat = await fs.stat(fullPath)
          
          if (stat.isDirectory()) {
            await scan(fullPath)
          } else if (file.endsWith('.py')) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8')
              const strats = parsePythonStrategyFile(content, file, fullPath)
              results.push(...strats)
            } catch (err) {
              console.warn(`Failed to parse Python file ${fullPath}:`, err)
            }
          }
        }
      }
      
      await scan(projectPath)
      return results
    } catch (error) {
      console.error('Scan strategies error:', error)
      return []
    }
  })

  ipcMain.handle('nautilus:load-backtest-data', async (_, folderPath: string) => {
    try {
      const files = await fs.readdir(folderPath)

      // 必要文件检查
      if (!files.includes('summary.json')) {
        throw new Error('未在该目录中找到 summary.json 绩效摘要文件，请确保选择的是正确的 NautilusTrader 回测输出文件夹。')
      }
      if (!files.includes('bars.parquet')) {
        throw new Error('未在该目录中找到 bars.parquet 原始数据文件。')
      }

      // Kill previous sidecar if running
      if (sidecarProcess) {
        try {
          sidecarProcess.kill('SIGINT')
        } catch (e) {
          console.error('Failed to kill previous sidecar process:', e)
        }
        sidecarProcess = null
      }

      // Write sidecar_server.py to app userData directory
      const backtestDir = join(app.getPath('userData'), 'backtests')
      await fs.mkdir(backtestDir, { recursive: true })
      const sidecarScriptPath = join(backtestDir, 'sidecar_server.py')
      await fs.writeFile(sidecarScriptPath, SIDECAR_SERVER_CONTENT, 'utf-8')

      // Start the sidecar server
      const portPromise = new Promise<number>((resolve, reject) => {
        const child = spawn('python3', [sidecarScriptPath, '--folder', folderPath, '--port', '0'], {
          cwd: backtestDir,
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        })
        sidecarProcess = child

        let portFound = false
        child.stdout.on('data', (data) => {
          const text = data.toString()
          console.log(`[Python Sidecar] stdout: ${text}`)
          const match = text.match(/PORT:(\d+)/)
          if (match) {
            portFound = true
            resolve(parseInt(match[1], 10))
          }
        })

        child.stderr.on('data', (data) => {
          console.error(`[Python Sidecar] stderr: ${data.toString()}`)
        })

        child.on('close', (code) => {
          console.log(`[Python Sidecar] exited with code ${code}`)
          if (!portFound) {
            reject(new Error(`Python Sidecar exited before printing port. Code: ${code}`))
          }
        })

        child.on('error', (err) => {
          console.error('[Python Sidecar] process error:', err)
          if (!portFound) {
            reject(err)
          }
        })
      })

      const port = await portPromise

      // Read summary.json
      let summary = null
      try {
        const summaryStr = await fs.readFile(join(folderPath, 'summary.json'), 'utf-8')
        summary = JSON.parse(summaryStr)
      } catch (err: any) {
        throw new Error(`读取或解析 summary.json 失败: ${err.message}`)
      }

      // Return port, summary and available timeframes
      return {
        success: true,
        port,
        summary,
        folderName: basename(folderPath),
        availableTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
        loadedTimeframe: '15m',
        bars: null,
        fills: null,
        equity: null
      }
    } catch (error: any) {
      console.error('Failed to load backtest data:', error)
      throw error
    }
  })

  // 按需加载指定时间框架的 K 线文件（用于 UI 切换时间框架时替换 v_bars）
  ipcMain.handle('nautilus:load-timeframe-bars', async (_, folderPath: string, timeframe: string) => {
    try {
      const fileName = timeframe === '1m' ? 'bars.parquet' : `bars_${timeframe}.parquet`
      const filePath = join(folderPath, fileName)
      try {
        await fs.access(filePath)
      } catch {
        throw new Error(`时间框架文件不存在: ${fileName}`)
      }
      const buffer = await fs.readFile(filePath)
      return { bars: buffer, timeframe }
    } catch (error: any) {
      console.error('Load timeframe bars error:', error)
      throw error
    }
  })


  ipcMain.handle('nautilus:run-backtest', async (_, params: {
    symbol: string
    startDate: string
    endDate: string
    initialCapital: number
    fastPeriod: number
    slowPeriod: number
    strategyClass?: string
    strategyPath?: string
    strategyParams?: Record<string, any>
  }) => {
    try {
      const backtestDir = join(app.getPath('userData'), 'backtests')
      await fs.mkdir(backtestDir, { recursive: true })
      
      // Ensure the independent exporter utility is present in the runtime folder
      const exporterPath = join(backtestDir, 'nautilus_exporter.py')
      await fs.writeFile(exporterPath, NAUTILUS_EXPORTER_CONTENT, 'utf-8')
      
      // 生成格式化时间戳 (e.g. 2026-05-28_11-45-30) 并附加标的代码创建专属文件夹
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
      const runName = `${timestamp}_${params.symbol}`
      
      const scriptPath = join(backtestDir, `run_backtest_${timestamp}.py`)
      const outputDir = join(backtestDir, runName)
      await fs.mkdir(outputDir, { recursive: true })
      
      const scriptContent = generateBacktestScript({
        ...params,
        outputDir
      })
      
      await fs.writeFile(scriptPath, scriptContent, 'utf-8')
      
      if (mainWindow) {
        mainWindow.webContents.send('backtest:log', `[系统] 成功生成策略回测脚本：${scriptPath}\n`)
        mainWindow.webContents.send('backtest:log', `[系统] 正在派生 Python 子进程以启动策略模拟回测...\n\n`)
      }

      return new Promise((resolve, reject) => {
        const child = spawn('python3', [scriptPath], {
          cwd: backtestDir,
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        })

        child.stdout.on('data', (data) => {
          const text = data.toString()
          if (mainWindow) {
            mainWindow.webContents.send('backtest:log', text)
          }
        })

        child.stderr.on('data', (data) => {
          const text = data.toString()
          if (mainWindow) {
            mainWindow.webContents.send('backtest:log', text)
          }
        })

        child.on('close', (code) => {
          // 删除临时产生的 python 脚本以保持环境干净
          fs.unlink(scriptPath).catch(err => console.error('Failed to delete temp script:', err))

          if (code === 0) {
            if (mainWindow) {
              mainWindow.webContents.send('backtest:log', `\n[系统] 策略回测成功结束。状态码: 0 (成功)。\n[系统] 回测数据已保存至: ${outputDir}\n[系统] 正在自动加载生成的数据集至分析大屏...\n`)
            }
            resolve({
              success: true,
              outputPath: outputDir
            })
          } else {
            if (mainWindow) {
              mainWindow.webContents.send('backtest:log', `\n[系统] 策略回测脚本执行失败，状态码: ${code}\n`)
            }
            reject(new Error(`Python 回测进程退出失败，状态码: ${code}`))
          }
        })

        child.on('error', (err) => {
          // 删除临时脚本
          fs.unlink(scriptPath).catch(tempErr => console.error('Failed to delete temp script:', tempErr))
          
          if (mainWindow) {
            mainWindow.webContents.send('backtest:log', `\n[系统] 无法启动 Python 进程: ${err.message}\n`)
          }
          reject(new Error(`启动 Python 进程失败: ${err.message}`))
        })
      })

    } catch (error: any) {
      console.error('Run backtest error:', error)
      throw error
    }
  })

  ipcMain.handle('nautilus:list-backtests', async () => {
    try {
      const backtestDir = join(app.getPath('userData'), 'backtests')
      try {
        await fs.access(backtestDir)
      } catch {
        return []
      }

      const files = await fs.readdir(backtestDir)
      const runs: any[] = []

      for (const file of files) {
        const runPath = join(backtestDir, file)
        const stats = await fs.stat(runPath)
        
        if (!stats.isDirectory()) continue
        // 排除临时配置或通用的 output 文件
        if (file === 'output' || file === 'output_old') continue

        let summary = null
        try {
          const summaryPath = join(runPath, 'summary.json')
          await fs.access(summaryPath)
          const summaryStr = await fs.readFile(summaryPath, 'utf-8')
          summary = JSON.parse(summaryStr)
        } catch {
          // 缺少 summary.json 的目录不视作合规回测记录
          continue
        }

        runs.push({
          id: file,
          name: file, // e.g. "2026-05-28_11-45-30_BTC-USD"
          path: runPath,
          createdAt: getExecutionTime(file, stats),
          summary
        })
      }

      // Sort by createdAt descending (newest backtest runs first)
      return runs.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      console.error('List backtests error:', error)
      return []
    }
  })

  ipcMain.handle('nautilus:delete-backtest', async (_, runId: string) => {
    try {
      const backtestDir = join(app.getPath('userData'), 'backtests')
      const runPath = join(backtestDir, runId)
      
      // 安全路径守护，防止目录遍历攻击
      if (!runPath.startsWith(backtestDir) || runId.includes('..')) {
        throw new Error('非法路径删除请求拦截')
      }
      
      await fs.rm(runPath, { recursive: true, force: true })
      return { success: true }
    } catch (error: any) {
      console.error('Delete backtest error:', error)
      throw new Error(`删除历史回测失败: ${error.message}`)
    }
  })

  ipcMain.handle('nautilus:get-data-coverage', async (_, projectPath: string) => {
    return new Promise((resolve, reject) => {
      const pyScript = `
import os, json, pandas as pd
from pathlib import Path

data_dir = Path(r"${projectPath.replace(/\\/g, '\\\\')}") / 'data' / 'binance' / 'futures'
results = []
if data_dir.exists():
    for f in sorted(data_dir.glob('*.parquet')):
        name = f.stem
        try:
            df = pd.read_parquet(f, columns=['timestamp'])
            if not df.empty:
                df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True)
                min_ts = df['timestamp'].min().strftime('%Y-%m-%d %H:%M')
                max_ts = df['timestamp'].max().strftime('%Y-%m-%d %H:%M')
                count = len(df)
                parts = name.split('-')
                symbol = parts[0]
                timeframe = parts[1] if len(parts) > 1 else '1m'
                results.append({
                    'file': f.name,
                    'symbol': symbol,
                    'timeframe': timeframe,
                    'start': min_ts,
                    'end': max_ts,
                    'count': count
                })
        except Exception as e:
            results.append({
                'file': f.name,
                'error': str(e)
            })
print(json.dumps(results))
`;
      const child = spawn('python3', ['-c', pyScript], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
      let output = ''
      child.stdout.on('data', (data) => {
        output += data.toString()
      })
      child.stderr.on('data', (data) => {
        console.error('[coverage py error]', data.toString())
      })
      child.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output.trim()))
          } catch (e) {
            reject(new Error(`Failed to parse coverage output: ${output}`))
          }
        } else {
          reject(new Error(`Python coverage process exited with code ${code}`))
        }
      })
    })
  })

  ipcMain.handle('nautilus:download-data', async (_, params: {
    projectPath: string
    startDate: string
    endDate: string
    pairs?: string
    timeframes?: string
  }) => {
    // Write download_data.py to app userData directory
    const backtestDir = join(app.getPath('userData'), 'backtests')
    await fs.mkdir(backtestDir, { recursive: true })
    const downloadScriptPath = join(backtestDir, 'download_data.py')
    await fs.writeFile(downloadScriptPath, DOWNLOAD_DATA_CONTENT, 'utf-8')

    const args = [downloadScriptPath, '--start', params.startDate, '--end', params.endDate]
    if (params.pairs) {
      args.push('--pairs', params.pairs)
    }
    if (params.timeframes) {
      args.push('--timeframes', params.timeframes)
    }

    if (mainWindow) {
      mainWindow.webContents.send('data:download-log', `[系统] 启动数据同步脚本，同步区间：${params.startDate} 至 ${params.endDate}\n`)
    }

    return new Promise((resolve, reject) => {
      const child = spawn('python3', args, {
        cwd: params.projectPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      child.stdout.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('data:download-log', data.toString())
        }
      })

      child.stderr.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('data:download-log', data.toString())
        }
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true })
        } else {
          reject(new Error(`Exit code ${code}`))
        }
      })
    })
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (sidecarProcess) {
    try {
      sidecarProcess.kill('SIGINT')
    } catch (e) { /* ignore */ }
    sidecarProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  if (sidecarProcess) {
    try {
      sidecarProcess.kill('SIGINT')
    } catch (e) { /* ignore */ }
    sidecarProcess = null
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
