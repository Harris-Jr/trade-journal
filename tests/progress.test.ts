import { describe, it, expect } from 'vitest';
import { evaluateGoal, validateGoalTarget } from '../src/analytics/progress.js';
import type { Goal, GoalMetric, GoalPeriod, GoalDirection, Trade, JournalEntry } from '../src/domain/types.js';

const T = (iso: string): number => Date.parse(iso);
const NOW = T('2024-03-15T18:00:00Z'); // a Friday

const mk = (o: Partial<Trade> & Pick<Trade, 'netPnl' | 'closeTime'>): Trade => ({
  id: `x${o.closeTime}-${Math.random()}`, accountId: 'A', symbol: 'AAPL', instrumentType: 'stock',
  direction: o.netPnl >= 0 ? 'long' : 'short', quantity: 1, avgEntryPrice: 1, avgExitPrice: 1,
  openTime: (o.closeTime ?? 0) - 1, grossPnl: o.netPnl, commission: 0, fees: 0, swap: 0,
  durationMs: 1, open: false, executions: [], ...o,
});

const goal = (metric: GoalMetric, period: GoalPeriod, direction: GoalDirection, target: number, startAt = 0): Goal => ({
  id: 'g1', userId: 'u', accountId: 'A', metric, period, direction, target, status: 'active',
  startAt, createdAt: 0, updatedAt: 0,
});

// Current day (UTC 2024-03-15): A (+300, R 3), B (-100, R -1, 1 mistake). Prior day: C (+200, R 2).
const trades: Trade[] = [
  mk({ netPnl: 300, closeTime: T('2024-03-15T15:00:00Z'), rMultiple: 3 }),
  mk({ netPnl: -100, closeTime: T('2024-03-15T16:00:00Z'), rMultiple: -1, annotations: { mistakes: ['chased'] } }),
  mk({ netPnl: 200, closeTime: T('2024-03-14T15:00:00Z'), rMultiple: 2 }),
];
const journal: JournalEntry[] = [
  { id: 'j1', accountId: 'A', date: '2024-03-15', rating: 4 },
  { id: 'j2', accountId: 'A', date: '2024-03-14', rating: 2 },
];

describe('evaluateGoal - performance metrics (daily, UTC)', () => {
  it('net_pnl at_least: current, remaining, fraction, met', () => {
    const p = evaluateGoal(goal('net_pnl', 'daily', 'at_least', 500), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(200); // 300 - 100
    expect(p.remaining).toBe(300);
    expect(p.fraction).toBeCloseTo(0.4, 6);
    expect(p.met).toBe(false);
    expect(p.sampleSize).toBe(2);
  });
  it('net_pnl with zero target: no percentage, status only', () => {
    const p = evaluateGoal(goal('net_pnl', 'daily', 'at_least', 0), trades, journal, 'UTC', NOW);
    expect(p.fraction).toBeNull();
    expect(p.met).toBe(true); // 200 >= 0
  });
  it('win_rate: percent of closed trades', () => {
    const p = evaluateGoal(goal('win_rate', 'daily', 'at_least', 60), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(50);
    expect(p.met).toBe(false);
  });
  it('avg_r_multiple: mean of trades with a stop', () => {
    const p = evaluateGoal(goal('avg_r_multiple', 'daily', 'at_least', 1), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(1); // mean(3, -1)
    expect(p.met).toBe(true);
    expect(p.sampleSize).toBe(2);
  });
  it('trade_count at_most: budget used fraction', () => {
    const p = evaluateGoal(goal('trade_count', 'daily', 'at_most', 3), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(2);
    expect(p.met).toBe(true);
    expect(p.fraction).toBeCloseTo(2 / 3, 6);
    expect(p.remaining).toBe(1);
  });
});

describe('evaluateGoal - behavioral metrics', () => {
  it('mistake_count at_most 0: over budget, no percentage', () => {
    const p = evaluateGoal(goal('mistake_count', 'daily', 'at_most', 0), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(1);
    expect(p.met).toBe(false);
    expect(p.fraction).toBeNull(); // target <= 0
    expect(p.remaining).toBe(-1);
    expect(p.category).toBe('behavioral');
  });
  it('avg_day_rating: mean of rated journal days in period', () => {
    const p = evaluateGoal(goal('avg_day_rating', 'daily', 'at_least', 3), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(4); // only 2024-03-15 rating in the current day
    expect(p.met).toBe(true);
  });
  it('journaled_day_rate: share of trading days with a journal entry', () => {
    const p = evaluateGoal(goal('journaled_day_rate', 'daily', 'at_least', 100), trades, journal, 'UTC', NOW);
    expect(p.current).toBe(100); // the one trading day (03-15) has an entry
    expect(p.met).toBe(true);
  });
});

describe('evaluateGoal - boundaries and no data', () => {
  it('no trades: counts are 0, ratios are null (no data)', () => {
    expect(evaluateGoal(goal('net_pnl', 'daily', 'at_least', 100), [], [], 'UTC', NOW).current).toBe(0);
    const wr = evaluateGoal(goal('win_rate', 'daily', 'at_least', 50), [], [], 'UTC', NOW);
    expect(wr.current).toBeNull();
    expect(wr.met).toBeNull();
    expect(wr.fraction).toBeNull();
  });
  it('breakeven trades count in trade_count and win-rate denominator', () => {
    const be = [mk({ netPnl: 0, closeTime: T('2024-03-15T15:00:00Z') }), mk({ netPnl: 100, closeTime: T('2024-03-15T16:00:00Z') })];
    expect(evaluateGoal(goal('trade_count', 'daily', 'at_least', 2), be, [], 'UTC', NOW).current).toBe(2);
    expect(evaluateGoal(goal('win_rate', 'daily', 'at_least', 50), be, [], 'UTC', NOW).current).toBe(50); // 1 of 2
  });
  it('startAt excludes earlier activity from history', () => {
    const p = evaluateGoal(goal('net_pnl', 'weekly', 'at_least', 100, T('2024-03-15T00:00:00Z')), trades, journal, 'UTC', NOW);
    // Only 03-15 trades count; 03-14 is before startAt (same ISO week but excluded by time).
    expect(p.current).toBe(200);
  });
  it('history is sorted ascending with per-period met flags', () => {
    const p = evaluateGoal(goal('net_pnl', 'daily', 'at_least', 250), trades, journal, 'UTC', NOW);
    expect(p.history.map((h) => h.key)).toEqual(['2024-03-14', '2024-03-15']);
    expect(p.history.map((h) => h.met)).toEqual([false, false]); // 200<250, 200<250
  });
  it('respects timezone when bucketing days', () => {
    // 2024-03-15T23:30Z is 2024-03-16 in Asia/Kolkata (+05:30).
    const late = [mk({ netPnl: 500, closeTime: T('2024-03-15T23:30:00Z') })];
    const nowIst = T('2024-03-16T06:00:00Z'); // 2024-03-16 local
    const p = evaluateGoal(goal('net_pnl', 'daily', 'at_least', 100), late, [], 'Asia/Kolkata', nowIst);
    expect(p.current).toBe(500); // falls on the local 03-16 day
    const pUtc = evaluateGoal(goal('net_pnl', 'daily', 'at_least', 100), late, [], 'UTC', T('2024-03-16T06:00:00Z'));
    expect(pUtc.current).toBe(0); // in UTC the trade was on 03-15, not the current day
  });
});

describe('validateGoalTarget', () => {
  it('accepts valid targets', () => {
    expect(validateGoalTarget('net_pnl', 'at_least', 500)).toBeNull();
    expect(validateGoalTarget('win_rate', 'at_least', 60)).toBeNull();
  });
  it('rejects out-of-range and bad types', () => {
    expect(validateGoalTarget('win_rate', 'at_least', 120)).toMatch(/at most 100/);
    expect(validateGoalTarget('avg_day_rating', 'at_least', 6)).toMatch(/at most 5/);
    expect(validateGoalTarget('mistake_count', 'at_most', 1.5)).toMatch(/whole number/);
    expect(validateGoalTarget('net_pnl', 'at_most', 100)).toMatch(/not allowed/);
    expect(validateGoalTarget('net_pnl', 'at_least', Infinity)).toMatch(/finite/);
  });
});
