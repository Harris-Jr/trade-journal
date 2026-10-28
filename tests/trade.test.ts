import { describe, it, expect } from 'vitest';
import { buildTrades, applyAnnotations } from '../src/metrics/trade.js';
import type { Execution } from '../src/domain/types.js';

const ex = (o: Partial<Execution> & Pick<Execution, 'side' | 'quantity' | 'price' | 'timestamp'>): Execution => ({
  id: Math.random().toString(36),
  accountId: 'A',
  symbol: 'AAPL',
  instrumentType: 'stock',
  ...o,
});

describe('buildTrades - FIFO round-trips', () => {
  it('simple long winner, net of commission', () => {
    const [t] = buildTrades([
      ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1, commission: 1 }),
      ex({ side: 'sell', quantity: 100, price: 12, timestamp: 2, commission: 1 }),
    ]);
    expect(t!.direction).toBe('long');
    expect(t!.grossPnl).toBe(200); // (12-10)*100
    expect(t!.commission).toBe(2);
    expect(t!.netPnl).toBe(198);
    expect(t!.avgEntryPrice).toBe(10);
    expect(t!.avgExitPrice).toBe(12);
    expect(t!.open).toBe(false);
    expect(t!.durationMs).toBe(1);
  });

  it('simple short winner', () => {
    const [t] = buildTrades([
      ex({ side: 'sell', quantity: 10, price: 50, timestamp: 1 }),
      ex({ side: 'buy', quantity: 10, price: 45, timestamp: 2 }),
    ]);
    expect(t!.direction).toBe('short');
    expect(t!.grossPnl).toBe(50); // sold 50, bought back 45 -> +5*10
    expect(t!.netPnl).toBe(50);
  });

  it('scaling in then out, volume-weighted averages', () => {
    const [t] = buildTrades([
      ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1 }),
      ex({ side: 'buy', quantity: 100, price: 20, timestamp: 2 }),
      ex({ side: 'sell', quantity: 200, price: 30, timestamp: 3 }),
    ]);
    expect(t!.quantity).toBe(200);
    expect(t!.avgEntryPrice).toBe(15); // (10*100+20*100)/200
    expect(t!.grossPnl).toBe(200 * 30 - (100 * 10 + 100 * 20)); // 6000-3000=3000
    expect(t!.netPnl).toBe(3000);
  });

  it('futures multiplier applies', () => {
    const [t] = buildTrades([
      ex({ symbol: 'ES', instrumentType: 'future', side: 'buy', quantity: 2, price: 5000, timestamp: 1, multiplier: 50 }),
      ex({ symbol: 'ES', instrumentType: 'future', side: 'sell', quantity: 2, price: 5010, timestamp: 2, multiplier: 50 }),
    ]);
    expect(t!.grossPnl).toBe(10 * 2 * 50); // 1000
  });

  it('position flip closes one trade and opens another', () => {
    const trades = buildTrades([
      ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1 }),
      ex({ side: 'sell', quantity: 150, price: 12, timestamp: 2 }), // close 100 long (+200), open 50 short
      ex({ side: 'buy', quantity: 50, price: 11, timestamp: 3 }), // cover short at 11 (+50)
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0]!.direction).toBe('long');
    expect(trades[0]!.grossPnl).toBe(200);
    expect(trades[1]!.direction).toBe('short');
    expect(trades[1]!.grossPnl).toBe((12 - 11) * 50); // 50
  });

  it('partial exits aggregate into one trade with weighted exit', () => {
    const [t] = buildTrades([
      ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1 }),
      ex({ side: 'sell', quantity: 40, price: 12, timestamp: 2 }), // partial out
      ex({ side: 'sell', quantity: 60, price: 15, timestamp: 3 }), // close remainder
    ]);
    expect(t!.open).toBe(false);
    expect(t!.quantity).toBe(100);
    expect(t!.avgExitPrice).toBeCloseTo((40 * 12 + 60 * 15) / 100, 6); // 13.8
    expect(t!.grossPnl).toBe(40 * (12 - 10) + 60 * (15 - 10)); // 80 + 300 = 380
  });

  it('leaves an open trade for an unclosed position', () => {
    const [t] = buildTrades([ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1 })]);
    expect(t!.open).toBe(true);
    expect(t!.avgExitPrice).toBeUndefined();
  });

  it('separates by account and symbol', () => {
    const trades = buildTrades([
      ex({ accountId: 'A', symbol: 'AAPL', side: 'buy', quantity: 1, price: 10, timestamp: 1 }),
      ex({ accountId: 'A', symbol: 'AAPL', side: 'sell', quantity: 1, price: 11, timestamp: 2 }),
      ex({ accountId: 'B', symbol: 'TSLA', side: 'buy', quantity: 1, price: 100, timestamp: 1 }),
      ex({ accountId: 'B', symbol: 'TSLA', side: 'sell', quantity: 1, price: 90, timestamp: 2 }),
    ]);
    expect(trades).toHaveLength(2);
  });
});

describe('applyAnnotations - R-multiple', () => {
  it('computes R-multiple and realized R:R from a stop', () => {
    const [t] = buildTrades([
      ex({ side: 'buy', quantity: 100, price: 10, timestamp: 1 }),
      ex({ side: 'sell', quantity: 100, price: 13, timestamp: 2 }),
    ]);
    const a = applyAnnotations(t!, { stopLoss: 9 }); // risk/unit = 1, risk = 100
    expect(a.rMultiple).toBe(3); // netPnl 300 / 100
    expect(a.realizedRr).toBe(3); // |13-10| / |10-9|
  });
});
