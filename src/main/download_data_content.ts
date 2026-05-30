export const DOWNLOAD_DATA_CONTENT = `"""
Data Sync and Gap Filler Utility for NautilusTrader Backtest
============================================================
Checks local parquet data files, detects any missing date ranges (prefix/suffix gaps)
relative to target START_DATE and END_DATE, downloads only the missing parts from Binance,
and merges them cleanly without duplicate rows.
"""

import sys
import os
# Dynamically insert the current working directory to ensure it can import run_backtest_v25.py and other workspace configurations
sys.path.insert(0, os.getcwd())

import time
import logging
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import ccxt

log = logging.getLogger("data_sync")

def ft_pair_to_symbol(ft_pair: str) -> str:
    """Freqtrade pair 'BTC/USDT:USDT' -> Binance raw symbol 'BTCUSDT'"""
    # Remove any trailing ':USDT' or ':USDC'
    pair = ft_pair.split(":")[0]
    # Replace slashes, dashes
    pair = pair.replace("/", "").replace("-", "")
    # Ensure it ends with USDT
    if not pair.endswith("USDT"):
        pair += "USDT"
    return pair


def download_range(exchange, symbol: str, timeframe: str, start_dt: datetime, end_dt: datetime) -> pd.DataFrame:
    """Download OHLCV data from start_dt to end_dt using CCXT."""
    since = int(start_dt.timestamp() * 1000)
    end_ts = int(end_dt.timestamp() * 1000)
    
    # Add buffer to ensure we cover the boundary
    all_ohlcv = []
    
    log.info(f"    Downloading {symbol} {timeframe} from {start_dt.strftime('%Y-%m-%d %H:%M')} to {end_dt.strftime('%Y-%m-%d %H:%M')}...")
    
    while since < end_ts:
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=1500)
        except ccxt.BadSymbol as e:
            log.error(f"    Invalid market symbol {symbol} on Binance USD-M: {e}. Skipping this asset.")
            break
        except Exception as e:
            log.warning(f"    Error fetching {symbol} {timeframe} since {datetime.fromtimestamp(since/1000, tz=timezone.utc)}: {e}. Retrying in 5s...")
            time.sleep(5)
            continue
            
        if not ohlcv:
            break
            
        all_ohlcv.extend(ohlcv)
        since = ohlcv[-1][0] + 1
        
        if len(ohlcv) < 10:
            break
            
        # Rate limiting sleep
        time.sleep(0.25)
        
    if not all_ohlcv:
        return pd.DataFrame()
        
    df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    return df


def sync_pair_timeframe(exchange, symbol: str, timeframe: str, start_date: str, end_date: str, data_dir: Path):
    """Sync single instrument timeframe, filling prefix and suffix gaps."""
    filepath = data_dir / f"{symbol}-{timeframe}.parquet"
    
    target_start = pd.to_datetime(start_date, utc=True)
    target_end = pd.to_datetime(end_date, utc=True)
    
    # Cap end date to current time to avoid requesting future candles
    now_utc = datetime.now(timezone.utc)
    if target_end > now_utc:
        target_end = now_utc
        
    # Case 1: File doesn't exist, download full range
    if not filepath.exists():
        log.info(f"  [NEW FILE] {symbol} {timeframe} does not exist. Initiating full download...")
        df = download_range(exchange, symbol, timeframe, target_start, target_end)
        if not df.empty:
            filepath.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(filepath, index=False)
            log.info(f"  [SUCCESS] Created {filepath} with {len(df)} bars.")
        else:
            log.warning(f"  [EMPTY] No data available for {symbol} {timeframe}")
        return
        
    # Case 2: File exists, inspect date range inside
    try:
        df_time = pd.read_parquet(filepath, columns=["timestamp"])
        df_time["timestamp"] = pd.to_datetime(df_time["timestamp"], utc=True)
        local_start = df_time["timestamp"].min()
        local_end = df_time["timestamp"].max()
    except Exception as e:
        log.warning(f"  [CORRUPT] Failed to read timestamp from {filepath}: {e}. Overwriting file.")
        local_start = None
        local_end = None
        
    if local_start is None or local_end is None:
        df = download_range(exchange, symbol, timeframe, target_start, target_end)
        if not df.empty:
            df.to_parquet(filepath, index=False)
        return
        
    dfs_to_merge = []
    
    # Check for prefix gap (target start date is earlier than local start date)
    # Allow 1 hour slack to prevent fetching tiny offsets
    if target_start < local_start - pd.Timedelta(hours=1):
        log.info(f"  [GAP] Prefix missing for {symbol} {timeframe}: target starts {target_start.strftime('%Y-%m-%d')}, local starts {local_start.strftime('%Y-%m-%d')}")
        df_prefix = download_range(exchange, symbol, timeframe, target_start, local_start)
        if not df_prefix.empty:
            dfs_to_merge.append(df_prefix)
            
    # Load and append existing local data
    df_existing = pd.read_parquet(filepath)
    df_existing["timestamp"] = pd.to_datetime(df_existing["timestamp"], utc=True)
    dfs_to_merge.append(df_existing)
    
    # Check for suffix gap (target end date is later than local end date)
    if target_end > local_end + pd.Timedelta(hours=1):
        log.info(f"  [GAP] Suffix missing for {symbol} {timeframe}: target ends {target_end.strftime('%Y-%m-%d')}, local ends {local_end.strftime('%Y-%m-%d')}")
        df_suffix = download_range(exchange, symbol, timeframe, local_end, target_end)
        if not df_suffix.empty:
            dfs_to_merge.append(df_suffix)
            
    # If gaps were filled, merge, sort, drop duplicates, and save
    if len(dfs_to_merge) > 1:
        df_merged = pd.concat(dfs_to_merge, ignore_index=True)
        df_merged = df_merged.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
        # Ensure correct column types
        for col in ["open", "high", "low", "close", "volume"]:
            df_merged[col] = df_merged[col].astype("float64")
        df_merged.to_parquet(filepath, index=False)
        log.info(f"  [SYNCED] Combined segments for {symbol} {timeframe}. Total bars: {len(df_merged)}")
    else:
        log.info(f"  [OK] {symbol} {timeframe} is already fully covered ({local_start.strftime('%Y-%m-%d')} to {local_end.strftime('%Y-%m-%d')})")


def sync_data(start_date: str, end_date: str, whitelist: list, multi_tf_pairs: list, data_dir: Path, timeframes: list = None):
    """Sync all whitelist assets across their required timeframes."""
    log.info("=" * 60)
    log.info(f"Data Sync Utility - Range: {start_date} to {end_date}")
    log.info(f"Destination: {data_dir}")
    if timeframes:
        log.info(f"Target Timeframes: {', '.join(timeframes)}")
    log.info("=" * 60)
    
    exchange = ccxt.binanceusdm({"enableRateLimit": True})
    
    for idx, pair in enumerate(whitelist, start=1):
        symbol = ft_pair_to_symbol(pair)
        log.info(f"[{idx}/{len(whitelist)}] Syncing {symbol}...")
        
        if timeframes:
            for tf in timeframes:
                sync_pair_timeframe(exchange, symbol, tf, start_date, end_date, data_dir)
        else:
            # 1m and 15m data are required for all whitelist pairs
            sync_pair_timeframe(exchange, symbol, "1m", start_date, end_date, data_dir)
            sync_pair_timeframe(exchange, symbol, "15m", start_date, end_date, data_dir)
            
            # 1h and 4h data are required for multi-TF regime assets
            if pair in multi_tf_pairs:
                sync_pair_timeframe(exchange, symbol, "1h", start_date, end_date, data_dir)
                sync_pair_timeframe(exchange, symbol, "4h", start_date, end_date, data_dir)
            
    log.info("🎉 All requested data synced successfully!")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    
    # Import Whitelist, Multi-TF Pairs, Data Directory and Dates from run_backtest_v25
    try:
        from run_backtest_v25 import PAIR_WHITELIST, MULTI_TF_PAIRS, DATA_DIR, START_DATE, END_DATE
    except ImportError:
        # Fallbacks in case execution is run outside of project scope
        PAIR_WHITELIST = ["BTC/USDT:USDT", "ETH/USDT:USDT"]
        MULTI_TF_PAIRS = ["BTC/USDT:USDT", "ETH/USDT:USDT"]
        DATA_DIR = Path("./data/binance/futures")
        START_DATE = "2024-01-01"
        END_DATE = "2026-01-01"

    # Add command-line arguments parsing
    import argparse
    parser = argparse.ArgumentParser(description="Data Sync and Gap Filler Utility")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--pairs", type=str, help="Comma-separated whitelist of pairs (e.g. BTC/USDT:USDT,ETH/USDT:USDT)")
    parser.add_argument("--timeframes", type=str, help="Comma-separated timeframes to sync (e.g. 1m,1h,4h)")
    args = parser.parse_args()

    start_dt_str = args.start if args.start else START_DATE
    end_dt_str = args.end if args.end else END_DATE
    
    timeframes_list = None
    if args.timeframes:
        timeframes_list = [t.strip() for t in args.timeframes.split(",") if t.strip()]

    if args.pairs:
        pairs_list = [p.strip() for p in args.pairs.split(",") if p.strip()]
        active_multi_tf = [p for p in MULTI_TF_PAIRS if p in pairs_list]
    else:
        pairs_list = PAIR_WHITELIST
        active_multi_tf = MULTI_TF_PAIRS

    # Run the synchronizer using parsed parameters
    sync_data(
        start_date=start_dt_str,
        end_date=end_dt_str,
        whitelist=pairs_list,
        multi_tf_pairs=active_multi_tf,
        data_dir=DATA_DIR,
        timeframes=timeframes_list
    )
`;
