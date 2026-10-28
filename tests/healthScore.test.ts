import { describe, it, expect } from 'vitest';
import {
  scoreProfitFactor,
  scoreTradeWin,
  scoreMaxDrawdown,
  scoreRecoveryFactor,
  scoreConsistency,
  healthScore,
  DEFAULT_WEIGHTS,
} from '../src/metrics/healthScore.js';
import type { Trade } from '../src/domain/types.js';

describe('Health Score components (documented tiers/anchors)', () => {
  it('profit factor anchors', () => {
    expect(scoreProfitFactor(2.6)).toBe(100);
    expect(scoreProfitFactor(3.0)).toBe(100);
    expect(scoreProfitFactor(1.7)).toBe(20); // below bottom band
    expect(scoreProfitFactor(1.8)).toBe(50); // bottom band start
    // mid-band interpolation stays within documented 90-100 for 2.4-2.6
    expect(scoreProfitFactor(2.5)).toBeGreaterThanOrEqual(90);
    expect(scoreProfitFactor(2.5)).toBeLessThanOrEqual(100);
  });

  it('trade win % uses (win% / topThreshold) x 100, capped at 100', () => {
    expect(scoreTradeWin(25, 60)).toBeCloseTo(41.666667, 4); // documented worked example
    expect(scoreTradeWin(60, 60)).toBe(100);
    expect(scoreTradeWin(80, 60)).toBe(100); // capped
  });

  it('max drawdown score = 100 - DD%', () => {
    expect(scoreMaxDrawdown(0)).toBe(100);
    expect(scoreMaxDrawdown(30)).toBe(70);
    expect(scoreMaxDrawdown(120)).toBe(0); // floored
  });

  it('recovery factor anchors', () => {
    expect(scoreRecoveryFactor(3.5)).toBe(100);
    expect(scoreRecoveryFactor(0.9)).toBe(0);
  });

  it('consistency is 0 when average trade P&L <= 0', () => {
    expect(scoreConsistency([-10, -20, 5])).toBe(0);
    expect(scoreConsistency([100, 100, 100])).toBe(100); // zero dispersion
  });
});

describe('healthScore composite', () => {
  const t = (netPnl: number, i: number): Trade => ({
    id: `h${i}`, accountId: 'A', symbol: 'AAPL', instrumentType: 'stock',
    direction: 'long', quantity: 1, avgEntryPrice: 1, avgExitPrice: 1,
    openTime: i, closeTime: i + 1, grossPnl: netPnl, commission: 0, fees: 0, swap: 0,
    netPnl, durationMs: 1, open: false, executions: [],
  });

  it('produces a weighted 0..100 total with all six components', () => {
    const hs = healthScore([t(200, 1), t(-50, 2), t(300, 3), t(-40, 4), t(150, 5)]);
    expect(hs.total).toBeGreaterThanOrEqual(0);
    expect(hs.total).toBeLessThanOrEqual(100);
    expect(Object.keys(hs.components).sort()).toEqual(
      Object.keys(DEFAULT_WEIGHTS).sort(),
    );
    const weightSum = Object.values(hs.components).reduce((a, c) => a + c.weight, 0);
    expect(weightSum).toBeCloseTo(1, 6);
  });
});
