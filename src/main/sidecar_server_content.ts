export const SIDECAR_SERVER_CONTENT = `import os
import sys
import json
import urllib.parse
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import pandas as pd
import numpy as np

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def lttb_indices(data, threshold):
    n_samples = len(data)
    if threshold >= n_samples or threshold <= 2:
        return np.arange(n_samples)

    bucket_size = (n_samples - 2) / (threshold - 2)
    indices = np.empty(threshold, dtype=np.int64)
    indices[0] = 0

    a = 0
    for i in range(threshold - 2):
        bin_start = int(np.floor((i + 1) * bucket_size)) + 1
        bin_end = int(np.floor((i + 2) * bucket_size)) + 1
        bin_end = min(bin_end, n_samples)

        avg_x = np.mean(data[bin_start:bin_end, 0])
        avg_y = np.mean(data[bin_start:bin_end, 1])

        curr_bin_start = int(np.floor(i * bucket_size)) + 1
        curr_bin_end = int(np.floor((i + 1) * bucket_size)) + 1

        a_x = data[a, 0]
        a_y = data[a, 1]

        max_area = -1
        next_a = curr_bin_start
        for j in range(curr_bin_start, curr_bin_end):
            area = abs((a_x - avg_x) * (data[j, 1] - a_y) - (a_x - data[j, 0]) * (avg_y - a_y)) * 0.5
            if area > max_area:
                max_area = area
                next_a = j

        indices[i + 1] = next_a
        a = next_a

    indices[-1] = n_samples - 1
    return indices

bars_df = None
fills_df = None
equity_df = None
dfs_by_symbol = {}
has_symbol_column = False
has_fills_symbol_column = False
indicator_cols = []
folder_path = None

class SidecarHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        url_parsed = urllib.parse.urlparse(self.path)
        path = url_parsed.path
        query = urllib.parse.parse_qs(url_parsed.query)

        try:
            if path == '/status':
                self.send_json({"status": "ok"})
            elif path == '/report.html':
                import os
                report_path = os.path.join(folder_path, "backtest_report.html")
                if os.path.exists(report_path):
                    with open(report_path, 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(content)
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(b"<h1>Report Not Found</h1><p>Ensure the backtest generated a tearsheet report (backtest_report.html).</p>")
            elif path == '/meta':
                self.send_json({
                    "has_symbol": has_symbol_column,
                    "base_timeframe": 60,
                    "indicator_columns": indicator_cols
                })
            elif path == '/symbols':
                self.handle_symbols()
            elif path == '/equity':
                self.handle_equity()
            elif path == '/fills':
                self.handle_fills(query)
            elif path == '/bars':
                self.handle_bars(query, is_indicators=False)
            elif path == '/indicators':
                self.handle_bars(query, is_indicators=True)
            else:
                self.send_error(404, "Not Found")
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json({"error": str(e)}, status=500)

    def send_json(self, data, status=200):
        try:
            def sanitize(val):
                if isinstance(val, dict):
                    return {k: sanitize(v) for k, v in val.items()}
                elif isinstance(val, list):
                    return [sanitize(v) for v in val]
                elif pd.isna(val) or val is None:
                    return None
                elif isinstance(val, (np.integer, np.int64)):
                    return int(val)
                elif isinstance(val, (np.floating, np.float64)):
                    return float(val)
                return val

            sanitized_data = sanitize(data)
            json_str = json.dumps(sanitized_data)
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json_str.encode('utf-8'))
        except Exception as e:
            print(f"Error encoding JSON: {e}", file=sys.stderr)
            self.send_response(500)
            self.end_headers()

    def handle_symbols(self):
        symbols_list = sorted(list(dfs_by_symbol.keys())) if has_symbol_column else ["ADAUSDT"]
        symbol_pnl = {}
        for sym in symbols_list:
            if fills_df is not None and not fills_df.empty:
                sym_fills = fills_df[fills_df['symbol'] == sym] if 'symbol' in fills_df.columns else fills_df
                buy_fills = sym_fills[sym_fills['side'].str.upper().str.contains('BUY') | (sym_fills['side'] == 'buy') | (sym_fills['side'] == 1)]
                sell_fills = sym_fills[sym_fills['side'].str.upper().str.contains('SELL') | (sym_fills['side'] == 'sell') | (sym_fills['side'] == 2)]
                trade_count = min(len(buy_fills), len(sell_fills))

                sum_pnl_pct = 0.0
                buy_prices = buy_fills['price'].values
                sell_prices = sell_fills['price'].values
                for i in range(trade_count):
                    bp = buy_prices[i]
                    sp = sell_prices[i]
                    if bp > 0:
                        sum_pnl_pct += (sp - bp) / bp
                symbol_pnl[sym] = sum_pnl_pct
            else:
                symbol_pnl[sym] = 0.0

        res = [{"symbol": sym, "changePct": symbol_pnl.get(sym, 0.0)} for sym in symbols_list]
        self.send_json(res)

    def handle_equity(self):
        if equity_df is not None and not equity_df.empty:
            eq = equity_df.copy()
            eq['time'] = eq['timestamp'] // 1_000_000_000
            grouped = eq.groupby('time').agg(
                equity=('equity', 'last'),
                drawdown=('drawdown', 'last')
            ).reset_index().sort_values('time')
            self.send_json(grouped.to_dict(orient='records'))
        else:
            self.send_json([])

    def handle_fills(self, query):
        symbol = query.get('symbol', [''])[0]
        if fills_df is None or fills_df.empty:
            self.send_json([])
            return

        df_sym = fills_df[fills_df['symbol'] == symbol] if 'symbol' in fills_df.columns else fills_df
        if df_sym.empty:
            self.send_json([])
            return

        grouped = df_sym.groupby(['time', 'side']).agg(
            price=('price', 'first'),
            quantity=('quantity', 'sum')
        ).reset_index().sort_values('time')
        self.send_json(grouped.to_dict(orient='records'))

    def handle_bars(self, query, is_indicators=False):
        symbol = query.get('symbol', [''])[0]
        timeframe = int(query.get('timeframe', [60])[0])
        start = query.get('start', [None])[0]
        end = query.get('end', [None])[0]
        limit = int(query.get('limit', [30000])[0])

        if has_symbol_column:
            df = dfs_by_symbol.get(symbol)
        else:
            df = bars_df

        if df is None or df.empty:
            self.send_json([])
            return

        if start is not None and start != 'null' and start != '':
            df = df[df['timestamp'] >= int(start) * 1_000_000_000]
        if end is not None and end != 'null' and end != '':
            df = df[df['timestamp'] <= int(end) * 1_000_000_000]

        if df.empty:
            self.send_json([])
            return

        ns = timeframe * 1_000_000_000
        df = df.copy()
        df['time'] = (df['timestamp'] // ns) * timeframe

        agg_dict = {
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }
        for col in indicator_cols:
            agg_dict[col] = 'last'

        agg = df.groupby('time').agg(agg_dict).reset_index().sort_values('time')

        agg['sma_20'] = agg['close'].rolling(20, min_periods=1).mean().fillna(agg['close'])
        agg['sma_50'] = agg['close'].rolling(50, min_periods=1).mean().fillna(agg['close'])
        agg['bb_middle'] = agg['sma_20']
        std = agg['close'].rolling(20, min_periods=1).std().fillna(0)
        agg['bb_upper'] = agg['bb_middle'] + 2 * std
        agg['bb_lower'] = agg['bb_middle'] - 2 * std
        agg['ema_12'] = agg['close'].ewm(span=12, adjust=False).mean()
        agg['ema_26'] = agg['close'].ewm(span=26, adjust=False).mean()

        is_initial_load = (start is None or start == 'null' or start == '') and (end is None or end == 'null' or end == '')
        if is_initial_load:
            if timeframe < 900:  # Only limit 1m and 5m to keep chart responsive
                agg = agg.tail(50000)

        if is_indicators:
            res_cols = ['time', 'close', 'sma_20', 'sma_50', 'bb_upper', 'bb_middle', 'bb_lower', 'ema_12', 'ema_26']
            res_df = agg[res_cols]
        else:
            res_cols = ['time', 'open', 'high', 'low', 'close', 'volume'] + indicator_cols
            res_df = agg[res_cols]

        self.send_json(res_df.to_dict(orient='records'))

def main():
    parser = argparse.ArgumentParser(description="Nautilus Backtest Python Sidecar Server")
    parser.add_argument("--folder", required=True, help="Path to backtest results folder")
    parser.add_argument("--port", type=int, default=0, help="Port to run server on (default 0 for random free port)")
    args = parser.parse_args()

    global folder_path, bars_df, fills_df, equity_df, dfs_by_symbol, has_symbol_column, has_fills_symbol_column, indicator_cols

    folder_path = args.folder

    bars_path = os.path.join(folder_path, "bars.parquet")
    if not os.path.exists(bars_path):
        print(f"Error: bars.parquet not found in {folder_path}", file=sys.stderr)
        sys.exit(1)
    
    bars_df = pd.read_parquet(bars_path)
    has_symbol_column = 'symbol' in bars_df.columns

    standard_cols = {'timestamp', 'open', 'high', 'low', 'close', 'volume', 'symbol', 'time'}
    indicator_cols = [c for c in bars_df.columns if c.lower() not in standard_cols]

    if has_symbol_column:
        dfs_by_symbol = {sym: group.copy() for sym, group in bars_df.groupby('symbol')}
    else:
        dfs_by_symbol = {}

    fills_path = os.path.join(folder_path, "fills.parquet")
    if os.path.exists(fills_path):
        fills_df = pd.read_parquet(fills_path)
        fills_df['time'] = fills_df['timestamp'] // 1_000_000_000
        has_fills_symbol_column = 'symbol' in fills_df.columns

        if not has_fills_symbol_column and has_symbol_column:
            ranges = bars_df.groupby('symbol').agg(
                min_low=('low', 'min'),
                max_high=('high', 'max')
            ).reset_index()
            
            mapped_symbols = []
            for idx, row in fills_df.iterrows():
                px = row['price']
                matching = ranges[(ranges['min_low'].notna()) & (px >= ranges['min_low'] * 0.8) & (px <= ranges['max_high'] * 1.2)]
                if not matching.empty:
                    centers = (matching['min_low'] + matching['max_high']) / 2
                    best_idx = np.abs(centers - px).idxmin()
                    mapped_symbols.append(ranges.loc[best_idx, 'symbol'])
                elif not ranges.empty:
                    mapped_symbols.append(ranges.iloc[0]['symbol'])
                else:
                    mapped_symbols.append('')
            fills_df['symbol'] = mapped_symbols
    else:
        fills_df = pd.DataFrame(columns=['timestamp', 'price', 'quantity', 'side', 'time', 'symbol'])

    equity_path = os.path.join(folder_path, "equity.parquet")
    if os.path.exists(equity_path):
        equity_df = pd.read_parquet(equity_path)
    else:
        equity_df = pd.DataFrame(columns=['timestamp', 'equity', 'drawdown'])

    server = ThreadingHTTPServer(('127.0.0.1', args.port), SidecarHandler)
    actual_port = server.server_address[1]
    print(f"PORT:{actual_port}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
`;
