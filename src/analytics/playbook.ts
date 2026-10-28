/**
 * Playbook performance analytics (M6.2).
 *
 * Built entirely from the canonical engine (computeStats) and the existing report
 * helpers over the trades linked to a playbook. There is no second P&L path.
 *
 * Decisions / denominators:
 * - Only CLOSED linked trades contribute to performance stats. Open linked trades
 *   are counted separately (linkedOpen) and never mixed into realized metrics.
 * - winRate, profitFactor, expectancy, avgWin/avgLoss, drawdown, recoveryFactor,
 *   avgRMultiple all come straight from computeStats (same definitions as everywhere).
 * - breakevenRate = breakeven closed trades / closed trades; null when no closed trades.
 * - checklistAdherence: only defined when the playbook has a checklist. It is the mean,
 *   over closed linked trades, of (checked items / total checklist items); a trade with
 *   no recorded checklist counts as 0 checked (not adhered), which is distinct from the
 *   playbook having no checklist at all (null).
 * - reviewCompletionRate: share of closed linked trades with a completed post-trade
 *   review; null when there are no closed linked trades. Missing review = not completed.
 * - Correlation, not causation: these summaries describe trades tagged to a setup; they
 *   do not prove the setup caused the results.
 */
import type { Trade, Playbook } from '../domain/types.js';
import { computeStats, type TradeStats } from '../metrics/stats.js';
import { report, groupBy, type BreakdownRow } from './reports.js';

export interface PlaybookAnalytics {
  linkedClosed: number;
  linkedOpen: number;
  stats: TradeStats;
  breakevenRate: number | null;
  bySymbol: BreakdownRow[];
  byDirection: BreakdownRow[];
  byMonth: BreakdownRow[];
  checklistAdherence: number | null;
  reviewCompletionRate: number | null;
}

const round = (n: number): number => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export function playbookAnalytics(linked: Trade[], playbook: Playbook, timeZone = 'UTC'): PlaybookAnalytics {
  const closed = linked.filter((t) => !t.open);
  const open = linked.filter((t) => t.open);
  const stats = computeStats(closed);

  const breakevenRate = closed.length ? round(closed.filter((t) => t.netPnl === 0).length / closed.length) : null;

  const checklistItems = playbook.checklist?.length ?? 0;
  let checklistAdherence: number | null = null;
  if (checklistItems > 0 && closed.length > 0) {
    const fractions = closed.map((t) => {
      const rec = t.annotations?.playbookChecklist ?? {};
      const checked = (playbook.checklist ?? []).filter((it) => rec[it.id] === true).length;
      return checked / checklistItems;
    });
    checklistAdherence = round(fractions.reduce((a, b) => a + b, 0) / fractions.length);
  }

  const reviewCompletionRate = closed.length
    ? round(closed.filter((t) => t.annotations?.playbookReviewDone === true).length / closed.length)
    : null;

  return {
    linkedClosed: closed.length,
    linkedOpen: open.length,
    stats,
    breakevenRate,
    bySymbol: report(closed, 'symbol', { sortBy: 'netPnl' }),
    byDirection: groupBy(closed, (t) => [{ key: t.direction, label: t.direction }], 'netPnl'),
    byMonth: report(closed, 'month', { timeZone, sortBy: 'key' }),
    checklistAdherence,
    reviewCompletionRate,
  };
}
