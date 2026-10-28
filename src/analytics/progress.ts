/**
 * Progress Tracker calculations (M6.1).
 *
 * All values are DERIVED LIVE from the canonical trade engine (computeStats) and
 * recorded journal/annotation data. There is no second P&L path and nothing is
 * stored cumulatively. Documented decisions:
 *
 * - Timezone: trading days and week/month boundaries use the caller-supplied IANA
 *   timezone (the browser's local zone), falling back to UTC. Keys come from the
 *   shared reports.periodKey (ISO weeks, Monday start) so reports and goals agree.
 * - Metric source: net_pnl is realized net P&L of CLOSED trades (engine netPnl).
 *   Open trades are excluded everywhere (not realized). Breakeven trades count as
 *   netPnl 0 and are included in trade_count and win-rate denominators.
 * - Missing data: ratio/average metrics (win_rate, avg_r_multiple, green_day_rate,
 *   journaled_day_rate, avg_day_rating) return current=null ("no data") when no
 *   qualifying observations exist, rather than a misleading 0. net_pnl, trade_count
 *   and mistake_count report 0 with no activity (0 is a valid value for them).
 * - Journal buckets: a journal entry's own civil date (YYYY-MM-DD) is bucketed with
 *   the same period keying, interpreted at 12:00 UTC for stability.
 * - Date range / reset: evaluation and history only count activity on or after the
 *   goal's startAt (reset moves startAt to now). The page's global date-range filter
 *   affects the surrounding trend/activity views, not a goal's own period evaluation.
 * - No trades: current-period value is 0 (count/pnl/mistakes) or null (ratios/averages).
 * - Targets are minimums (at_least) or maximums/budgets (at_most) per metric. Ranges
 *   are not modelled in v1.
 * - Percentage completion: when the target is <= 0 (e.g. "at most 0 mistakes", or a
 *   non-positive P&L target) a percentage is not meaningful, so fraction is null and
 *   the UI shows the met/not-met status with raw values instead.
 */
import type { Goal, GoalMetric, GoalPeriod, GoalDirection, Trade, JournalEntry } from '../domain/types.js';
import { computeStats } from '../metrics/stats.js';
import { periodKey, type ProgressPeriod } from './reports.js';

export type MetricCategory = 'performance' | 'behavioral';
export type MetricUnit = 'currency' | 'count' | 'percent' | 'r' | 'rating';

export interface MetricDef {
  label: string;
  category: MetricCategory;
  unit: MetricUnit;
  defaultDirection: GoalDirection;
  allowedDirections: GoalDirection[];
  /** Inclusive target bounds for validation (undefined = unbounded on that side). */
  min?: number;
  max?: number;
  integer?: boolean;
  help: string;
}

export const METRIC_DEFS: Record<GoalMetric, MetricDef> = {
  net_pnl: {
    label: 'Net P&L', category: 'performance', unit: 'currency', defaultDirection: 'at_least',
    allowedDirections: ['at_least'],
    help: 'Realized net profit and loss from closed trades in the period. A past profit target does not predict future results.',
  },
  trade_count: {
    label: 'Trades', category: 'performance', unit: 'count', defaultDirection: 'at_least',
    allowedDirections: ['at_least', 'at_most'], min: 0, integer: true,
    help: 'Number of closed trades in the period. Use at_most to guard against overtrading.',
  },
  win_rate: {
    label: 'Win rate', category: 'performance', unit: 'percent', defaultDirection: 'at_least',
    allowedDirections: ['at_least'], min: 0, max: 100,
    help: 'Share of closed trades that were profitable. No data until at least one trade closes.',
  },
  avg_r_multiple: {
    label: 'Average R-multiple', category: 'performance', unit: 'r', defaultDirection: 'at_least',
    allowedDirections: ['at_least'],
    help: 'Mean R-multiple across trades that have a planned stop. Trades without a stop are excluded.',
  },
  green_day_rate: {
    label: 'Green-day rate', category: 'performance', unit: 'percent', defaultDirection: 'at_least',
    allowedDirections: ['at_least'], min: 0, max: 100,
    help: 'Share of trading days in the period that ended net positive.',
  },
  avg_day_rating: {
    label: 'Average day rating', category: 'behavioral', unit: 'rating', defaultDirection: 'at_least',
    allowedDirections: ['at_least'], min: 1, max: 5,
    help: 'Mean of your journal day ratings (1-5). Days without a rating are not counted.',
  },
  journaled_day_rate: {
    label: 'Journaling rate', category: 'behavioral', unit: 'percent', defaultDirection: 'at_least',
    allowedDirections: ['at_least'], min: 0, max: 100,
    help: 'Share of trading days that have a journal entry. Measures journaling discipline, not outcomes.',
  },
  mistake_count: {
    label: 'Recorded mistakes', category: 'behavioral', unit: 'count', defaultDirection: 'at_most',
    allowedDirections: ['at_most'], min: 0, integer: true,
    help: 'Count of mistakes tagged on trades in the period. Fewer is better.',
  },
};

export interface GoalProgress {
  goalId: string;
  metric: GoalMetric;
  period: GoalPeriod;
  direction: GoalDirection;
  target: number;
  status: Goal['status'];
  category: MetricCategory;
  unit: MetricUnit;
  periodKey: string;
  current: number | null;
  remaining: number | null;
  fraction: number | null;
  met: boolean | null;
  sampleSize: number;
  history: { key: string; value: number | null; met: boolean | null }[];
}

const HISTORY_LIMIT = 8;
const round = (n: number): number => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const journalMs = (date: string): number => Date.parse(`${date}T12:00:00Z`);

interface Slice { trades: Trade[]; journal: JournalEntry[] }

/** Value of a metric over one period slice, with the number of qualifying observations. */
function metricValue(metric: GoalMetric, slice: Slice, tz: string): { value: number | null; sampleSize: number } {
  const closed = slice.trades.filter((t) => !t.open);
  switch (metric) {
    case 'net_pnl':
      return { value: round(computeStats(closed).netPnl), sampleSize: closed.length };
    case 'trade_count':
      return { value: closed.length, sampleSize: closed.length };
    case 'win_rate': {
      if (closed.length === 0) return { value: null, sampleSize: 0 };
      return { value: round(computeStats(closed).winRate * 100), sampleSize: closed.length };
    }
    case 'avg_r_multiple': {
      const s = computeStats(closed);
      return { value: s.avgRMultiple, sampleSize: s.tradesWithR };
    }
    case 'green_day_rate': {
      const byDay = new Map<string, number>();
      for (const t of closed) {
        const k = periodKey(t.closeTime ?? t.openTime, 'daily', tz);
        byDay.set(k, (byDay.get(k) ?? 0) + t.netPnl);
      }
      if (byDay.size === 0) return { value: null, sampleSize: 0 };
      const green = [...byDay.values()].filter((v) => v > 0).length;
      return { value: round((green / byDay.size) * 100), sampleSize: byDay.size };
    }
    case 'journaled_day_rate': {
      const tradingDays = new Set(closed.map((t) => periodKey(t.closeTime ?? t.openTime, 'daily', tz)));
      if (tradingDays.size === 0) return { value: null, sampleSize: 0 };
      const journaled = new Set(slice.journal.map((j) => j.date));
      const covered = [...tradingDays].filter((d) => journaled.has(d)).length;
      return { value: round((covered / tradingDays.size) * 100), sampleSize: tradingDays.size };
    }
    case 'avg_day_rating': {
      const ratings = slice.journal.map((j) => j.rating).filter((r): r is number => typeof r === 'number');
      if (ratings.length === 0) return { value: null, sampleSize: 0 };
      return { value: round(ratings.reduce((a, b) => a + b, 0) / ratings.length), sampleSize: ratings.length };
    }
    case 'mistake_count': {
      const count = closed.reduce((a, t) => a + (t.annotations?.mistakes?.length ?? 0), 0);
      return { value: count, sampleSize: closed.length };
    }
    default:
      return { value: null, sampleSize: 0 };
  }
}

function evaluate(value: number | null, target: number, direction: GoalDirection): {
  met: boolean | null; remaining: number | null; fraction: number | null;
} {
  if (value === null) return { met: null, remaining: null, fraction: null };
  if (direction === 'at_least') {
    const met = value >= target;
    const remaining = round(Math.max(target - value, 0));
    const fraction = target > 0 ? Math.max(0, Math.min(1, value / target)) : null;
    return { met, remaining, fraction };
  }
  // at_most (budget): met while within budget; fraction is budget used.
  const met = value <= target;
  const remaining = round(target - value);
  const fraction = target > 0 ? Math.max(0, Math.min(1, value / target)) : null;
  return { met, remaining, fraction };
}

/** Evaluate one goal against all of an account's closed trades and journal entries. */
export function evaluateGoal(goal: Goal, trades: Trade[], journal: JournalEntry[], tz = 'UTC', now = Date.now()): GoalProgress {
  const def = METRIC_DEFS[goal.metric];
  const period = goal.period === 'daily' ? 'daily' : goal.period === 'weekly' ? 'weekly' : 'monthly';
  const sinceTrades = trades.filter((t) => !t.open && (t.closeTime ?? t.openTime) >= goal.startAt);
  const sinceJournal = journal.filter((j) => journalMs(j.date) >= goal.startAt);

  const tradesByKey = new Map<string, Trade[]>();
  for (const t of sinceTrades) {
    const k = periodKey(t.closeTime ?? t.openTime, period as ProgressPeriod, tz);
    (tradesByKey.get(k) ?? tradesByKey.set(k, []).get(k)!).push(t);
  }
  const journalByKey = new Map<string, JournalEntry[]>();
  for (const j of sinceJournal) {
    const k = periodKey(journalMs(j.date), period as ProgressPeriod, tz);
    (journalByKey.get(k) ?? journalByKey.set(k, []).get(k)!).push(j);
  }

  const currentKey = periodKey(now, period as ProgressPeriod, tz);
  const curSlice: Slice = { trades: tradesByKey.get(currentKey) ?? [], journal: journalByKey.get(currentKey) ?? [] };
  const cur = metricValue(goal.metric, curSlice, tz);
  const curEval = evaluate(cur.value, goal.target, goal.direction);

  const keys = new Set<string>([currentKey, ...tradesByKey.keys(), ...journalByKey.keys()]);
  const history = [...keys]
    .filter((k) => k <= currentKey)
    .sort()
    .slice(-HISTORY_LIMIT)
    .map((k) => {
      const v = metricValue(goal.metric, { trades: tradesByKey.get(k) ?? [], journal: journalByKey.get(k) ?? [] }, tz);
      return { key: k, value: v.value, met: evaluate(v.value, goal.target, goal.direction).met };
    });

  return {
    goalId: goal.id, metric: goal.metric, period: goal.period, direction: goal.direction,
    target: goal.target, status: goal.status, category: def.category, unit: def.unit,
    periodKey: currentKey, current: cur.value, remaining: curEval.remaining,
    fraction: curEval.fraction, met: curEval.met, sampleSize: cur.sampleSize, history,
  };
}

/** Validate a target for a metric/direction. Returns an error message or null. */
export function validateGoalTarget(metric: GoalMetric, direction: GoalDirection, target: unknown): string | null {
  const def = METRIC_DEFS[metric];
  if (!def) return `unknown metric: ${String(metric)}`;
  if (!def.allowedDirections.includes(direction)) return `direction ${direction} is not allowed for ${metric}`;
  if (typeof target !== 'number' || !Number.isFinite(target)) return 'target must be a finite number';
  if (def.integer && !Number.isInteger(target)) return `${def.label} target must be a whole number`;
  if (def.min !== undefined && target < def.min) return `${def.label} target must be at least ${def.min}`;
  if (def.max !== undefined && target > def.max) return `${def.label} target must be at most ${def.max}`;
  return null;
}
