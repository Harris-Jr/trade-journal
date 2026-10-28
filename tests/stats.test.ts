import { describe, it, expect } from 'vitest';
import { computeStats, maxDrawdown, equityCurve } from '../src/metrics/stats.js';
import type { Trade } from '../src/domain/types.js';

/** Minimal closed-trade factory (only fields the stats layer reads). */
const trade = (netPnl: number, closeTime: number): Trade => ({
  id: `x${closeTime}`,
  accountId: 'A',
  symbol: 'AAPL',
  instrumentType: 'stock',
  direction: netPnl >= 0 ? 'long' : 'short',
  quantity: 1,
  avgEntryPrice: 1,
  avgExitPrice: 1,
  openTime: closeTime - 1,
  closeTime,
  grossPnl: netPnl,
  commission: 0,
  fees: 0,
  swap: 0,
  netPnl,
  durationMs: 1,
  open: false,
  executions: [],
});

describe('computeStats', () => {
  const trades = [trade(100, 1), trade(-50, 2), trade(200, 3), trade(-50, 4), trade(0, 5)];
  const s = computeStats(trades);

  it('counts wins/losses/breakeven', () => {
    expect(s.trades).toBe(5);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
  });
  it('win rate = wins / trades', () => {
    expect(s.winRate).toBeCloseTo(0.4, 6);
  });
  it('profit factor = grossProfit / grossLoss', () => {
    expect(s.grossProfit).toBe(300);
    expect(s.grossLoss).toBe(100);
    expect(s.profitFactor).toBe(3);
  });
  it('avg win/loss and payoff ratio', () => {
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBe(50);
    expect(s.payoffRatio).toBe(3);
  });
  it('expectancy = winRate*avgWin - lossRate*avgLoss', () => {
    // 0.4*150 - 0.4*50 = 60 - 20 = 40
    expect(s.expectancy).toBeCloseTo(40, 6);
  });
  it('net P&L', () => {
    expect(s.netPnl).toBe(200);
  });
  it('profit factor is Infinity with no losses', () => {
    expect(computeStats([trade(10, 1), trade(20, 2)]).profitFactor).toBe(Infinity);
  });
});

describe('maxDrawdown', () => {
  it('peak-to-trough drop and % of prior peak', () => {
    // cumulative: 100, 300, 100, 250 -> peak 300, trough 100 -> DD 200, 200/300 = 66.67%
    const trades = [trade(100, 1), trade(200, 2), trade(-200, 3), trade(150, 4)];
    const dd = maxDrawdown(trades);
    expect(dd.maxDrawdown).toBe(200);
    expect(dd.maxDrawdownPct).toBeCloseTo(66.666667, 4);
  });
});

describe('equityCurve', () => {
  it('runs from starting balance', () => {
    const pts = equityCurve([trade(100, 1), trade(-30, 2)], 1000);
    expect(pts.map((p) => p.equity)).toEqual([1100, 1070]);
  });
});

describe('streaks', () => {
  it('tracks max consecutive wins and losses', () => {
    const s = computeStats([trade(1, 1), trade(1, 2), trade(1, 3), trade(-1, 4), trade(-1, 5)]);
    expect(s.maxConsecutiveWins).toBe(3);
    expect(s.maxConsecutiveLosses).toBe(2);
  });
});
