export function generateBacktestScript(params: {
  symbol: string
  startDate: string
  endDate: string
  initialCapital: number
  fastPeriod: number
  slowPeriod: number
  outputDir: string
  strategyClass?: string
  strategyPath?: string
  strategyParams?: Record<string, any>
}): string {
  const { symbol, startDate, endDate, initialCapital, fastPeriod, slowPeriod, outputDir, strategyClass, strategyPath, strategyParams } = params

  return `import os
import json
import numpy as np
import pandas as pd
from datetime import datetime

# -------------------------------------------------------------
# 1. 变量参数定义 (由 Electron UI 动态生成)
# -------------------------------------------------------------
SYMBOL = "${symbol}"
START_DATE = "${startDate}"
END_DATE = "${endDate}"
INITIAL_CAPITAL = ${initialCapital}
FAST_PERIOD = ${fastPeriod}
SLOW_PERIOD = ${slowPeriod}
OUTPUT_DIR = "${outputDir}"
STRATEGY_CLASS = "${strategyClass || ''}"
STRATEGY_PATH = r"${strategyPath || ''}"
CUSTOM_PARAMS_JSON = """${JSON.stringify(strategyParams || {})}"""

os.makedirs(OUTPUT_DIR, exist_ok=True)
print("=" * 60)
print(f"开始执行策略回测: {SYMBOL}")
print(f"周期区间: {START_DATE} 至 {END_DATE}")
print(f"初始资金: {INITIAL_CAPITAL} USD")
print(f"策略参数: 均线金叉死叉 (快线={FAST_PERIOD}, 慢线={SLOW_PERIOD})")
print("=" * 60)

# -------------------------------------------------------------
# 2. 检查与载入历史价格数据
# -------------------------------------------------------------
bars_df = None

# 尝试通过 yfinance 库下载真实数据
try:
    import yfinance as yf
    print(f"正在尝试从 Yahoo Finance 下载 {SYMBOL} 历史日线数据...")
    ticker = yf.Ticker(SYMBOL)
    df = ticker.history(start=START_DATE, end=END_DATE, interval="1d")
    if not df.empty:
        df = df.reset_index()
        # 统一列名为小写
        df.columns = [c.lower() for c in df.columns]
        # 重命名日期列并提取纳秒时间戳
        date_col = 'date' if 'date' in df.columns else df.columns[0]
        df['timestamp'] = pd.to_datetime(df[date_col]).astype(np.int64)
        bars_df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume']].copy()
        print(f"✓ 成功下载 {len(bars_df)} 条真实交易数据")
except Exception as e:
    print(f"Yahoo Finance 无法连接或未安装 yfinance: {e}")

# 若下载失败，则生成高仿真合成数据 (确保系统 100% 可运行)
if bars_df is None:
    print("正在生成仿真合成历史价格序列...")
    date_range = pd.date_range(start=START_DATE, end=END_DATE, freq='H')  # 采用小时级别生成 1000 条左右
    n_bars = len(date_range)
    if n_bars < 50:
        # 确保数据点不会太少
        date_range = pd.date_range(start=START_DATE, end=END_DATE, freq='10T')
        n_bars = len(date_range)
        
    timestamps = date_range.view(np.int64)
    
    # 随机游走生成收盘价
    np.random.seed(42)
    prices = [100.0]
    for i in range(1, n_bars):
        change = np.random.normal(0.00005, 0.008)
        prices.append(prices[-1] * (1 + change))
    prices = np.array(prices)
    
    opens = prices * (1 + np.random.uniform(-0.001, 0.001, n_bars))
    closes = prices * (1 + np.random.uniform(-0.001, 0.001, n_bars))
    highs = np.maximum(opens, closes) * (1 + np.random.uniform(0, 0.002, n_bars))
    lows = np.minimum(opens, closes) * (1 - np.random.uniform(0, 0.002, n_bars))
    volumes = np.random.randint(1000, 100000, n_bars).astype(np.float64)
    
    bars_df = pd.DataFrame({
        'timestamp': timestamps,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })
    print(f"✓ 成功合成 {len(bars_df)} 条虚拟交易历史序列")

# 导出 bars.parquet (使用独立数据导出工具)
from nautilus_exporter import NautilusDataExporter
exporter = NautilusDataExporter(OUTPUT_DIR, INITIAL_CAPITAL)
exporter.export_bars(bars_df)

# -------------------------------------------------------------
# 3. 运行真实 NautilusTrader 回测
# -------------------------------------------------------------
try:
    import nautilus_trader
    print(f"已检测到原生 NautilusTrader 库 (v{nautilus_trader.__version__})，正在载入 Native 回测组件...")
    
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.backtest.config import BacktestEngineConfig
    from nautilus_trader.config import StrategyConfig
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.model.identifiers import Venue, InstrumentId
    from nautilus_trader.model.enums import OmsType, AccountType, OrderSide
    from nautilus_trader.model.objects import Money, Price, Quantity
    from nautilus_trader.model.currencies import USDT
    from nautilus_trader.model.data import Bar, BarType
    from nautilus_trader.test_kit.providers import TestInstrumentProvider
except ImportError as e:
    print(f"❌ 导入 NautilusTrader 失败: {e}")
    print("未检测到本地 python 环境安装 nautilus_trader，无法启动真实策略回测！请在 python 环境中安装 nautilus_trader 库。")
    import sys
    sys.exit(1)

fills_df = None
equity_df = None
summary = {}

try:
    print("初始化 NautilusTrader 回测引擎...")
    config = BacktestEngineConfig(trader_id="BACKTESTER-001")
    engine = BacktestEngine(config=config)

    # 1. 注册交易场所
    engine.add_venue(
        venue=Venue("BINANCE"),
        oms_type=OmsType.NETTING,
        account_type=AccountType.MARGIN,
        starting_balances=[Money(INITIAL_CAPITAL, USDT)],
        base_currency=USDT
    )

    # 2. 匹配交易标的
    symbol_upper = SYMBOL.upper()
    if 'ETH' in symbol_upper:
        inst = TestInstrumentProvider.ethusdt_binance()
    elif 'ADA' in symbol_upper:
        inst = TestInstrumentProvider.adausdt_binance()
    else:
        inst = TestInstrumentProvider.btcusdt_binance()
        
    engine.add_instrument(inst)

    # 3. 注册策略
    trade_size = 1.0
    if 'ADA' in symbol_upper:
        trade_size = 1000.0
    elif 'ETH' in symbol_upper:
        trade_size = 5.0

    if not STRATEGY_CLASS or not STRATEGY_PATH:
        raise ValueError("未指定策略类或策略文件路径，无法运行真实策略回测。")

    print(f"正在从项目目录导入自定义策略: {STRATEGY_CLASS} ({STRATEGY_PATH})...")
    import sys
    import inspect
    import importlib.util
    from pathlib import Path
    
    strat_file_path = Path(STRATEGY_PATH)
    sys.path.insert(0, str(strat_file_path.parent))
    
    module_name = strat_file_path.stem
    module = importlib.import_module(module_name)
    StrategyClass = getattr(module, STRATEGY_CLASS)
    
    # 使用内省查找 Config 类
    config_class_name = STRATEGY_CLASS + "Config"
    if hasattr(module, config_class_name):
        ConfigClass = getattr(module, config_class_name)
        
        custom_params = json.loads(CUSTOM_PARAMS_JSON)
        annotations = getattr(ConfigClass, "__annotations__", {})
        
        config_params = {}
        for name, value in custom_params.items():
            if name in annotations or hasattr(ConfigClass, name):
                expected_type = annotations.get(name, None)
                if expected_type:
                    type_str = str(expected_type)
                    if 'InstrumentId' in type_str:
                        from nautilus_trader.model.identifiers import InstrumentId
                        if isinstance(value, list):
                            config_params[name] = [InstrumentId.from_str(v) if isinstance(v, str) else v for v in value]
                        elif isinstance(value, str):
                            config_params[name] = InstrumentId.from_str(value)
                        else:
                            config_params[name] = value
                    elif 'list' in type_str and isinstance(value, str):
                        try:
                            config_params[name] = json.loads(value)
                        except:
                            config_params[name] = [v.strip() for v in value.split(',') if v.strip()]
                    else:
                        config_params[name] = value
                else:
                    config_params[name] = value
        
        # 设置基础/默认的回退字段，如果配置类中定义了且用户未填
        if 'instrument_id' in annotations and 'instrument_id' not in config_params:
            config_params['instrument_id'] = inst.id
        if 'instrument_ids' in annotations and 'instrument_ids' not in config_params:
            if 'InstrumentId' in str(annotations['instrument_ids']):
                from nautilus_trader.model.identifiers import InstrumentId
                config_params['instrument_ids'] = [inst.id]
            else:
                config_params['instrument_ids'] = [str(inst.id)]
        if 'trade_size' in annotations and 'trade_size' not in config_params:
            config_params['trade_size'] = trade_size
        if 'fast_period' in annotations and 'fast_period' not in config_params:
            config_params['fast_period'] = FAST_PERIOD
        if 'slow_period' in annotations and 'slow_period' not in config_params:
            config_params['slow_period'] = SLOW_PERIOD
        
        print(f"实例化策略配置: {ConfigClass.__name__}，注入参数: {config_params}")
        strat_config = ConfigClass(**config_params)
        strategy = StrategyClass(strat_config)
    else:
        try:
            custom_params = json.loads(CUSTOM_PARAMS_JSON)
            strategy = StrategyClass(**custom_params)
        except Exception as c_err:
            try:
                strategy = StrategyClass()
            except Exception as c_err2:
                raise ValueError(f"策略类实例化失败，未找到 Config 类且直接实例化也失败: {c_err}, {c_err2}")
        
    engine.add_strategy(strategy)

    # 4. 将历史价格数据转换为 Bar 对象序列并注册到引擎
    bar_type = BarType.from_str(f"{inst.id}-1-DAY-LAST-EXTERNAL")
    bars_to_add = []
    for i in range(len(bars_df)):
        row = bars_df.iloc[i]
        bar = Bar(
            bar_type=bar_type,
            open=Price.from_str(f"{row['open']:.{inst.price_precision}f}"),
            high=Price.from_str(f"{row['high']:.{inst.price_precision}f}"),
            low=Price.from_str(f"{row['low']:.{inst.price_precision}f}"),
            close=Price.from_str(f"{row['close']:.{inst.price_precision}f}"),
            volume=Quantity.from_str(f"{row['volume']:.{inst.size_precision}f}"),
            ts_event=int(row['timestamp']),
            ts_init=int(row['timestamp']),
        )
        bars_to_add.append(bar)
    engine.add_data(bars_to_add)

    print("正在运行 NautilusTrader 原生回测...")
    engine.run()

    # 5. 导出回测结果 (使用独立数据导出工具)
    print("正在使用独立工具导出回测结果与指标数据...")
    exporter.export_results(engine.trader, bars_df)
    
    # 6. 生成 Tearsheet HTML 报告并保存
    try:
        from nautilus_trader.analysis.tearsheet import create_tearsheet
        create_tearsheet(
            engine=engine,
            title=f"Strategy Backtest: {SYMBOL}",
            output_path=os.path.join(OUTPUT_DIR, "backtest_report.html")
        )
        print("✓ Tearsheet successfully saved to backtest_report.html")
    except Exception as ts_err:
        print(f"Could not generate tearsheet: {ts_err}")

    print("=" * 60)
    print("🎉 NautilusTrader 真实策略回测成功结束！")
    print("=" * 60)

except Exception as err:
    print(f"❌ NautilusTrader 运行时发生异常: {err}")
    import sys
    sys.exit(1)
`
}
