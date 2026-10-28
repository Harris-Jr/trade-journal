import { describe, it, expect } from 'vitest';
import { projectTrade, type ProjectableTrade } from '../src/analytics/projection.js';

const longWin: ProjectableTrade = {
  netPnl: 350, rMultiple: 2.33, avgEntryPrice: 100, avgExitPrice: 103.5, direction: 'long', open: false,
};
const shortWin: ProjectableTrade = {
  netPnl: 50, avgEntryPrice: 50, avgExitPrice: 45, direction: 'short', open: false, // no stop => no R
};
const openTrade: ProjectableTrade = {
  netPnl: 0, avgEntryPrice: 100, direction: 'long', open: true,
};

describe('projectTrade', () => {
  it('currency returns netPnl', () => {
    expect(projectTrade(longWin, 'currency')).toMatchObject({ available: true, value: 350 });
  });
  it('percent uses account starting balance as denominator', () => {
    expect(projectTrade(longWin, 'percent', { startingBalance: 10000 })).toMatchObject({ available: true, value: 3.5 });
    expect(projectTrade(longWin, 'percent', { startingBalance: 0 }).available).toBe(false);
    expect(projectTrade(longWin, 'percent').available).toBe(false);
  });
  it('R uses the engine rMultiple and is unavailable without a stop', () => {
    expect(projectTrade(longWin, 'R')).toMatchObject({ available: true, value: 2.33 });
    const r = projectTrade(shortWin, 'R');
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/no planned stop/);
  });
  it('points is the signed price move and respects direction', () => {
    expect(projectTrade(longWin, 'points').value).toBeCloseTo(3.5, 6);
    expect(projectTrade(shortWin, 'points').value).toBeCloseTo(5, 6); // (45-50)*-1 = +5
    expect(projectTrade(openTrade, 'points').available).toBe(false);
  });
  it('ticks/pips require instrument metadata and never invent it', () => {
    expect(projectTrade(longWin, 'ticks').available).toBe(false); // no tickSize
    expect(projectTrade(longWin, 'ticks', { spec: { tickSize: 0.25 } }).value).toBeCloseTo(14, 6); // 3.5/0.25
    expect(projectTrade(shortWin, 'pips').available).toBe(false); // no pipSize
    expect(projectTrade(shortWin, 'pips', { spec: { pipSize: 0.0001 } }).value).toBeCloseTo(50000, 0);
  });
});
