/**
 * Reporting breakdowns (spec A8 / M3).
 *
 * Group closed trades along a dimension and compute full TradeStats per group.
 * Dimensions: calendar (day/week/month), day-of-week, hour-of-day, symbol,
 * strategy, setup, tag, and trade-duration buckets. All timezone-aware.
 */
import type { Trade } from '../domain/types.js';
import { computeStats, type TradeStats } from '../metrics/stats.js';

export interface BreakdownRow {
  key: string;
  label: string;
  trades: number;
  netPnl: number;
  stats: TradeStats;
}

export type SortBy = 'key' | 'netPnl' | 'trades';

const closed = (t: Trade): boolean => !t.open;
const closeOf = (t: Trade): number => t.closeTime ?? t.openTime;

function summarize(rows: Map<string, { label: string; trades: Trade[] }>, sortBy: SortBy): BreakdownRow[] {
  const out: BreakdownRow[] = [];
  for (const [key, { label, trades }] of rows) {
    const stats = computeStats(trades);
    out.push({ key, label, trades: stats.trades, netPnl: stats.netPnl, stats });
  }
  out.sort((a, b) => {
    if (sortBy === 'netPnl') return b.netPnl - a.netPnl;
    if (sortBy === 'trades') return b.trades - a.trades;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}

/** Generic grouping. `keys` returns zero or more (key,label) pairs per trade (0 => excluded, >1 => counted in each, e.g. tags). */
export function groupBy(
  trades: Trade[],
  keys: (t: Trade) => Array<{ key: string; label: string }>,
  sortBy: SortBy = 'key',
): BreakdownRow[] {
  const rows = new Map<string, { label: string; trades: Trade[] }>();
  for (const t of trades.filter(closed)) {
    for (const { key, label } of keys(t)) {
      const bucket = rows.get(key) ?? { label, trades: [] };
      bucket.trades.push(t);
      rows.set(key, bucket);
    }
  }
  return summarize(rows, sortBy);
}

// ---- calendar helpers (timezone-aware) -------------------------------------

function parts(ms: number, timeZone: string): { y: number; m: number; d: number; weekday: number; hour: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) map[p.type] = p.value;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hour: Number(map.hour) % 24,
    weekday: weekdays.indexOf(map.weekday ?? 'Sun'),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO week number (1..53) for a Y-M-D in the given interpretation. */
function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - day + 3); // nearest Thursday
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week };
}

export type ProgressPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Canonical timezone-aware period key for a timestamp, shared by reports and the
 * progress tracker so day/week/month boundaries are computed one way only.
 * daily: YYYY-MM-DD, monthly: YYYY-MM, weekly: YYYY-Www (ISO week, Monday start).
 */
export function periodKey(ms: number, period: ProgressPeriod, timeZone = 'UTC'): string {
  const p = parts(ms, timeZone);
  if (period === 'daily') return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  if (period === 'monthly') return `${p.y}-${pad(p.m)}`;
  const { year, week } = isoWeek(p.y, p.m, p.d);
  return `${year}-W${pad(week)}`;
}

export function reportByDay(trades: Trade[], timeZone = 'UTC', sortBy: SortBy = 'key'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const p = parts(closeOf(t), timeZone);
    const key = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    return [{ key, label: key }];
  }, sortBy);
}

export function reportByWeek(trades: Trade[], timeZone = 'UTC', sortBy: SortBy = 'key'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const p = parts(closeOf(t), timeZone);
    const { year, week } = isoWeek(p.y, p.m, p.d);
    const key = `${year}-W${pad(week)}`;
    return [{ key, label: key }];
  }, sortBy);
}

export function reportByMonth(trades: Trade[], timeZone = 'UTC', sortBy: SortBy = 'key'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const p = parts(closeOf(t), timeZone);
    const key = `${p.y}-${pad(p.m)}`;
    return [{ key, label: key }];
  }, sortBy);
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function reportByDayOfWeek(trades: Trade[], timeZone = 'UTC'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const p = parts(closeOf(t), timeZone);
    return [{ key: String(p.weekday), label: DOW[p.weekday] ?? '?' }];
  }, 'key');
}

export function reportByHourOfDay(trades: Trade[], timeZone = 'UTC'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const p = parts(closeOf(t), timeZone);
    return [{ key: pad(p.hour), label: `${pad(p.hour)}:00` }];
  }, 'key');
}

export function reportBySymbol(trades: Trade[], sortBy: SortBy = 'netPnl'): BreakdownRow[] {
  return groupBy(trades, (t) => [{ key: t.symbol, label: t.symbol }], sortBy);
}

export function reportByStrategy(trades: Trade[], sortBy: SortBy = 'netPnl'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const id = t.annotations?.strategyId;
    return id ? [{ key: id, label: id }] : [{ key: '(none)', label: '(no strategy)' }];
  }, sortBy);
}

export function reportBySetup(trades: Trade[], sortBy: SortBy = 'netPnl'): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const s = t.annotations?.setup;
    return s ? [{ key: s, label: s }] : [{ key: '(none)', label: '(no setup)' }];
  }, sortBy);
}

export function reportByTag(trades: Trade[], sortBy: SortBy = 'netPnl'): BreakdownRow[] {
  return groupBy(trades, (t) =>
    (t.annotations?.tags ?? []).map((tag) => ({ key: tag, label: tag })), sortBy);
}

export interface DurationBucket { key: string; label: string; maxMs: number }
export const DURATION_BUCKETS: DurationBucket[] = [
  { key: '0', label: '< 1 min', maxMs: 60_000 },
  { key: '1', label: '1-5 min', maxMs: 5 * 60_000 },
  { key: '2', label: '5-30 min', maxMs: 30 * 60_000 },
  { key: '3', label: '30 min-4 h', maxMs: 4 * 3_600_000 },
  { key: '4', label: '4 h-1 day', maxMs: 24 * 3_600_000 },
  { key: '5', label: '1-7 days', maxMs: 7 * 86_400_000 },
  { key: '6', label: '> 7 days', maxMs: Infinity },
];

export function reportByDuration(trades: Trade[]): BreakdownRow[] {
  return groupBy(trades, (t) => {
    const d = t.durationMs ?? 0;
    const bucket = DURATION_BUCKETS.find((b) => d < b.maxMs) ?? DURATION_BUCKETS[DURATION_BUCKETS.length - 1]!;
    return [{ key: bucket.key, label: bucket.label }];
  }, 'key');
}

export type ReportDimension =
  | 'day' | 'week' | 'month' | 'dayOfWeek' | 'hourOfDay'
  | 'symbol' | 'strategy' | 'setup' | 'tag' | 'duration';

/** Dispatch helper used by the REST API. */
export function report(
  trades: Trade[],
  dimension: ReportDimension,
  opts: { timeZone?: string; sortBy?: SortBy } = {},
): BreakdownRow[] {
  const tz = opts.timeZone ?? 'UTC';
  switch (dimension) {
    case 'day': return reportByDay(trades, tz, opts.sortBy);
    case 'week': return reportByWeek(trades, tz, opts.sortBy);
    case 'month': return reportByMonth(trades, tz, opts.sortBy);
    case 'dayOfWeek': return reportByDayOfWeek(trades, tz);
    case 'hourOfDay': return reportByHourOfDay(trades, tz);
    case 'symbol': return reportBySymbol(trades, opts.sortBy);
    case 'strategy': return reportByStrategy(trades, opts.sortBy);
    case 'setup': return reportBySetup(trades, opts.sortBy);
    case 'tag': return reportByTag(trades, opts.sortBy);
    case 'duration': return reportByDuration(trades);
    default: return [];
  }
}
