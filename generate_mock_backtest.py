import os
import json
import numpy as np
import pandas as pd

def generate_mock_data():
    output_dir = "./mock_data"
    os.makedirs(output_dir, exist_ok=True)
    
    np.random.seed(42)
    n_bars = 1000
    
    # 1. Timestamps (every minute in UnixNanos)
    # Start at 2026-05-01 00:00:00 UTC
    start_time = 1777593600 * 1_000_000_000  
    time_step = 60 * 1_000_000_000 # 60 seconds in nanoseconds
    timestamps = np.array([start_time + i * time_step for i in range(n_bars)], dtype=np.int64)
    
    # 2. Price generation (Geometric Brownian Motion style)
    prices = [150.0]
    for i in range(1, n_bars):
        change = np.random.normal(0.0001, 0.005)
        prices.append(prices[-1] * (1 + change))
        
    prices = np.array(prices)
    
    # Create OHLCV bars
    opens = prices * (1 + np.random.uniform(-0.001, 0.001, n_bars))
    closes = prices * (1 + np.random.uniform(-0.001, 0.001, n_bars))
    highs = np.maximum(opens, closes) * (1 + np.random.uniform(0, 0.002, n_bars))
    lows = np.minimum(opens, closes) * (1 - np.random.uniform(0, 0.002, n_bars))
    volumes = np.random.randint(100, 5000, n_bars).astype(np.float64)
    
    bars_df = pd.DataFrame({
        'timestamp': timestamps,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })
    
    # Save bars.parquet
    bars_df.to_parquet(os.path.join(output_dir, "bars.parquet"), index=False)
    print("Generated bars.parquet")

    # 3. Generate Fills (BUY and SELL orders)
    # Create ~30 fills along the timeline
    fill_indices = sorted(np.random.choice(range(50, n_bars - 50), 30, replace=False))
    fill_timestamps = timestamps[fill_indices]
    fill_prices = closes[fill_indices]
    fill_sides = []
    fill_quantities = []
    
    current_pos = 0
    for idx in fill_indices:
        # Toggle position between flat and long
        if current_pos == 0:
            fill_sides.append('BUY')
            qty = float(np.random.randint(10, 100))
            fill_quantities.append(qty)
            current_pos = qty
        else:
            fill_sides.append('SELL')
            fill_quantities.append(float(current_pos))
            current_pos = 0
            
    fills_df = pd.DataFrame({
        'timestamp': fill_timestamps,
        'price': fill_prices,
        'quantity': fill_quantities,
        'side': fill_sides
    })
    fills_df.to_parquet(os.path.join(output_dir, "fills.parquet"), index=False)
    print("Generated fills.parquet")

    # 4. Generate Equity & Drawdown curves
    initial_equity = 100000.0
    equity_values = [initial_equity]
    max_equity = initial_equity
    drawdowns = [0.0]
    
    active_position_qty = 0
    entry_price = 0.0
    
    fill_map = {f['timestamp']: f for f in fills_df.to_dict('records')}
    
    current_equity = initial_equity
    for i in range(1, n_bars):
        t = timestamps[i]
        price = closes[i]
        
        # Check if fill occurred
        if t in fill_map:
            fill = fill_map[t]
            if fill['side'] == 'BUY':
                active_position_qty = fill['quantity']
                entry_price = fill['price']
            else:
                # Realize PnL
                pnl = active_position_qty * (fill['price'] - entry_price)
                current_equity += pnl
                active_position_qty = 0
                
        # Calculate unrealized equity
        unrealized = active_position_qty * (price - entry_price) if active_position_qty > 0 else 0.0
        temp_equity = current_equity + unrealized
        equity_values.append(temp_equity)
        
        max_equity = max(max_equity, temp_equity)
        dd = (temp_equity - max_equity) / max_equity if max_equity > 0 else 0.0
        drawdowns.append(dd)
        
    equity_df = pd.DataFrame({
        'timestamp': timestamps,
        'equity': equity_values,
        'drawdown': drawdowns
    })
    equity_df.to_parquet(os.path.join(output_dir, "equity.parquet"), index=False)
    print("Generated equity.parquet")

    # 5. Generate summary.json
    summary = {
        "sharpe_ratio": 2.45,
        "sortino_ratio": 3.62,
        "max_drawdown": float(abs(min(drawdowns))),
        "win_rate": 0.615,
        "profit_factor": 1.74,
        "total_trades": len(fill_indices) // 2,
        "net_profit": float(equity_values[-1] - initial_equity),
        "total_return": float((equity_values[-1] - initial_equity) / initial_equity)
    }
    
    with open(os.path.join(output_dir, "summary.json"), 'w') as f:
        json.dump(summary, f, indent=2)
    print("Generated summary.json")
    print(f"Mock backtest results successfully created in: {os.path.abspath(output_dir)}")

if __name__ == "__main__":
    generate_mock_data()
