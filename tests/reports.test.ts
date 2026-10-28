import { describe, it, expect } from 'vitest';
import {
  report,
  reportBySymbol,
  reportByMonth,
  reportByDayOfWeek,
  reportByDuration,
  reportByTag,
  groupBy,
} from '../src/analytics/reports.js';
import type { Trade } from '../src/domain/types.js';

const mk = (o: Partial<Trade> & Pick<Trade, 'symbol' | 'netPnl' | 'closeTime'>): Trade => ({
  id: `${o.symbol}:${o.closeTime}`,
  accountId: 'A',
  instrumentType: 'stock',
  direction: 'long',
  quantity: 1,
  avgEntryPrice: 1,
  avgExitPrice: 1,
  openTime: (o.closeTime ?? 0) - 1,
  grossPnl: o.netPnl,
  commission: 0, fees: 0, swap: 0,
  durationMs: 1,
  open: false,
  executions: [],
  ...o,
});

// 2024-01-01 is a Monday (UTC).
const T = (iso: string) => Date.parse(iso);

describe('reportBySymbol', () => {
  const trades = [
    mk({ symbol: 'AAPL', netPnl: 100, closeTime: T('2024-01-01T15:00:00Z') }),
    mk({ symbol: 'AAPL', netPnl: -40, closeTime: T('2024-01-02T15:00:00Z') }),
    mk({ symbol: 'TSLA', netPnl: 200, closeTime: T('2024-01-03T15:00:00Z') }),
  ];
  it('groups and ranks by net P&L', () => {
    const rows = reportBySymbol(trades);
    expect(rows.map((r) => r.key)).toEqual(['TSLA', 'AAPL']);
    const aapl = rows.find((r) => r.key === 'AAPL')!;
    expect(aapl.trades).toBe(2);
    expect(aapl.netPnl).toBe(60);
    expect(aapl.stats.winRate).toBeCloseTo(0.5, 6);
  });
});

describe('calendar breakdowns', () => {
  const trades = [
    mk({ symbol: 'A', netPnl: 10, closeTime: T('2024-01-15T15:00:00Z') }),
    mk({ symbol: 'A', netPnl: 20, closeTime: T('2024-01-20T15:00:00Z') }),
    mk({ symbol: 'A', netPnl: -5, closeTime: T('2024-02-01T15:00:00Z') }),
  ];
  it('by month', () => {
    const rows = reportByMonth(trades, 'UTC', 'key');
    expect(rows.map((r) => r.key)).toEqual(['2024-01', '2024-02']);
    expect(rows[0]!.netPnl).toBe(30);
  });
  it('day-of-week respects timezone', () => {
    // 2024-01-15T15:00Z is Monday in UTC.
    const rows = reportByDayOfWeek([mk({ symbol: 'A', netPnl: 1, closeTime: T('2024-01-15T15:00:00Z') })], 'UTC');
    expect(rows[0]!.label).toBe('Monday');
  });
});

describe('reportByTag explodes multi-tag trades', () => {
  const trades = [
    mk({ symbol: 'A', netPnl: 10, closeTime: 1, annotations: { tags: ['breakout', 'morning'] } }),
    mk({ symbol: 'A', netPnl: -3, closeTime: 2, annotations: { tags: ['breakout'] } }),
  ];
  it('counts a trade under each of its tags', () => {
    const rows = reportByTag(trades);
    const breakout = rows.find((r) => r.key === 'breakout')!;
    expect(breakout.trades).toBe(2);
    expect(rows.find((r) => r.key === 'morning')!.trades).toBe(1);
  });
});

describe('reportByDuration', () => {
  it('buckets by holding time', () => {
    const rows = reportByDuration([
      mk({ symbol: 'A', netPnl: 1, closeTime: 10, durationMs: 30_000 }), // <1m
      mk({ symbol: 'A', netPnl: 1, closeTime: 20, durationMs: 10 * 60_000 }), // 5-30m
    ]);
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('< 1 min');
    expect(labels).toContain('5-30 min');
  });
});

describe('report() dispatch + excludes open trades', () => {
  it('open trades are ignored', () => {
    const rows = report(
      [mk({ symbol: 'A', netPnl: 0, closeTime: 1, open: true }), mk({ symbol: 'A', netPnl: 5, closeTime: 2 })],
      'symbol',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trades).toBe(1);
  });
});
