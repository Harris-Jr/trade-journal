/**
 * Behavioral insights (M6.3).
 *
 * Transparent, heuristic observations derived ONLY from the user's own closed
 * trades, executions and journal via the canonical engine. There is no second
 * P&L path, nothing is fabricated, and an insight is a description of what the
 * data shows, not advice and not proof of causation.
 *
 * Every rule and threshold is documented below and overridable. Patterns that
 * would need intratrade excursion data we do not reliably capture (for example
 * "premature exit" / "missed scaling", which need MFE/MAE per trade) are
 * intentionally omitted rather than guessed.
 */
import type { Trade, JournalEntry } from '../domain/types.js';
import { computeStats } from '../metrics/stats.js';
import { periodKey } from './reports.js';

export type InsightType =
  | 'overtrading' | 'loss_streak' | 'revenge_trade' | 'oversized_loss' | 'no_stop_loss' | 'unjournaled_day';
export type InsightLevel = 'trade' | 'day';
export type InsightSeverity = 'low' | 'medium' | 'high';

export interface Insight {
  id: string;
  type: InsightType;
  level: InsightLevel;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Present for trade-level insights. */
  tradeId?: string;
  symbol?: string;
  /** Present for day-level insights (YYYY-MM-DD in the request timezone). */
  date?: string;
  /** A representative numeric value behind the insight (count, ratio, amount). */
  value?: number;
}

export interface InsightThresholds {
  overtradingPerDay: number;
  lossStreak: number;
  revengeWindowMin: number;
  revengeSizeMultiple: number;
  oversizedLossMultiple: number;
}
export const DEFAULT_THRESHOLDS: InsightThresholds = {
  overtradingPerDay: 6,
  lossStreak: 3,
  revengeWindowMin: 60,
  revengeSizeMultiple: 1.5,
  oversizedLossMultiple: 2.5,
};

export interface InsightsResult {
  insights: Insight[];
  summary: { type: InsightType; count: number }[];
  thresholds: InsightThresholds;
  closedTrades: number;
}

const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const notional = (t: Trade): number => t.quantity * t.avgEntryPrice * (t.executions[0]?.multiplier ?? 1);
const closeOf = (t: Trade): number => t.closeTime ?? t.openTime;

export function computeInsights(
  trades: Trade[],
  journal: JournalEntry[],
  timeZone = 'UTC',
  thresholds: Partial<InsightThresholds> = {},
): InsightsResult {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const closed = trades.filter((t) => !t.open).sort((a, b) => closeOf(a) - closeOf(b));
  const insights: Insight[] = [];
  const avgLoss = computeStats(closed).avgLoss; // positive magnitude, canonical

  // ---- sequence-level: revenge trades (opened soon after a loss, upsized) ----
  for (let i = 1; i < closed.length; i++) {
    const prev = closed[i - 1]!;
    const cur = closed[i]!;
    if (prev.netPnl >= 0) continue;
    const gapMs = cur.openTime - (prev.closeTime ?? prev.openTime);
    if (gapMs < 0 || gapMs > th.revengeWindowMin * 60_000) continue;
    const prevNotional = notional(prev);
    if (prevNotional > 0 && notional(cur) >= th.revengeSizeMultiple * prevNotional) {
      insights.push({
        id: `revenge_trade:${cur.id}`, type: 'revenge_trade', level: 'trade', severity: 'high',
        tradeId: cur.id, symbol: cur.symbol, value: round(notional(cur) / prevNotional),
        title: 'Possible revenge trade',
        detail: `Opened ${Math.round(gapMs / 60000)} min after a loss at ${round(notional(cur) / prevNotional)}x the prior position size.`,
      });
    }
  }

  // ---- trade-level: oversized loss, undefined risk ----
  for (const t of closed) {
    if (t.netPnl < 0 && avgLoss > 0 && Math.abs(t.netPnl) > th.oversizedLossMultiple * avgLoss) {
      insights.push({
        id: `oversized_loss:${t.id}`, type: 'oversized_loss', level: 'trade', severity: 'high',
        tradeId: t.id, symbol: t.symbol, value: round(Math.abs(t.netPnl) / avgLoss),
        title: 'Oversized loss',
        detail: `Loss was ${round(Math.abs(t.netPnl) / avgLoss)}x the average loss in this period.`,
      });
    }
    if (t.netPnl < 0 && t.annotations?.stopLoss === undefined) {
      insights.push({
        id: `no_stop_loss:${t.id}`, type: 'no_stop_loss', level: 'trade', severity: 'low',
        tradeId: t.id, symbol: t.symbol,
        title: 'Losing trade without a planned stop',
        detail: 'No stop was recorded, so risk was undefined and R-multiple cannot be measured.',
      });
    }
  }

  // ---- day-level: overtrading, loss streak, unjournaled trading day ----
  const byDay = new Map<string, Trade[]>();
  for (const t of closed) {
    const k = periodKey(closeOf(t), 'daily', timeZone);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(t);
  }
  const journaledDates = new Set(journal.map((j) => j.date));
  for (const [date, dayTrades] of byDay) {
    if (dayTrades.length > th.overtradingPerDay) {
      insights.push({
        id: `overtrading:${date}`, type: 'overtrading', level: 'day', severity: 'medium', date, value: dayTrades.length,
        title: 'Overtrading', detail: `${dayTrades.length} trades closed on ${date} (above ${th.overtradingPerDay}).`,
      });
    }
    let streak = 0;
    let maxStreak = 0;
    for (const t of dayTrades) { streak = t.netPnl < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
    if (maxStreak >= th.lossStreak) {
      insights.push({
        id: `loss_streak:${date}`, type: 'loss_streak', level: 'day', severity: 'medium', date, value: maxStreak,
        title: 'Losing streak', detail: `${maxStreak} consecutive losing trades on ${date}.`,
      });
    }
    if (!journaledDates.has(date)) {
      insights.push({
        id: `unjournaled_day:${date}`, type: 'unjournaled_day', level: 'day', severity: 'low', date, value: dayTrades.length,
        title: 'Trading day not journaled', detail: `${dayTrades.length} trade(s) on ${date} with no journal entry.`,
      });
    }
  }

  const order: InsightSeverity[] = ['high', 'medium', 'low'];
  insights.sort((a, b) => {
    const s = order.indexOf(a.severity) - order.indexOf(b.severity);
    if (s !== 0) return s;
    return (b.date ?? '').localeCompare(a.date ?? '') || a.type.localeCompare(b.type);
  });

  const counts = new Map<InsightType, number>();
  for (const i of insights) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const summary = [...counts.entries()].map(([type, count]) => ({ type, count }));

  return { insights, summary, thresholds: th, closedTrades: closed.length };
}
