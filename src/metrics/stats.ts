/**
 * Aggregate performance statistics over a set of closed trades.
 * Definitions are standard and implemented independently (spec A8).
 */
import type { Trade } from '../domain/types.js';

export interface EquityPoint {
  closeTime: number;
  cumulativePnl: number;
  equity: number; // startingBalance + cumulativePnl
}

export interface DrawdownResult {
  /** Absolute peak-to-trough drop in currency. */
  maxDrawdown: number;
  /** As a % of the peak cumulative P&L before the drop (per documented formula). */
  maxDrawdownPct: number;
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / trades (0..1). */
  winRate: number;
  grossProfit: number;
  grossLoss: number; // positive magnitude
  netPnl: number;
  profitFactor: number; // grossProfit / grossLoss (Infinity if no losses)
  avgWin: number;
  avgLoss: number; // positive magnitude
  /** avgWin / avgLoss. */
  payoffRatio: number;
  /** (winRate-avgWin) - (lossRate-avgLoss), per trade. */
  expectancy: number;
  /** Mean of per-trade rMultiple over closed trades that have one; null if none qualify. */
  avgRMultiple: number | null;
  /** Count of closed trades that have a defined rMultiple (a planned stop). */
  tradesWithR: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
  avgDurationMs: number;
  drawdown: DrawdownResult;
  /** totalNet / maxDrawdown; Infinity if no drawdown. */
  recoveryFactor: number;
}

const closed = (t: Trade): boolean => !t.open;

export function equityCurve(trades: Trade[], startingBalance = 0): EquityPoint[] {
  const pts: EquityPoint[] = [];
  let cum = 0;
  for (const t of trades.filter(closed).sort(byClose)) {
    cum += t.netPnl;
    pts.push({
      closeTime: t.closeTime ?? t.openTime,
      cumulativePnl: round(cum),
      equity: round(startingBalance + cum),
    });
  }
  return pts;
}

export function maxDrawdown(trades: Trade[]): DrawdownResult {
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let peakAtMaxDd = 0;
  for (const t of trades.filter(closed).sort(byClose)) {
    cum += t.netPnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) {
      maxDd = dd;
      peakAtMaxDd = peak;
    }
  }
  const pct = peakAtMaxDd > 0 ? (maxDd / peakAtMaxDd) * 100 : 0;
  return { maxDrawdown: round(maxDd), maxDrawdownPct: round(pct) };
}

export function computeStats(trades: Trade[]): TradeStats {
  const ts = trades.filter(closed);
  const wins = ts.filter((t) => t.netPnl > 0);
  const losses = ts.filter((t) => t.netPnl < 0);
  const breakeven = ts.filter((t) => t.netPnl === 0);

  const grossProfit = sum(wins.map((t) => t.netPnl));
  const grossLoss = Math.abs(sum(losses.map((t) => t.netPnl)));
  const netPnl = sum(ts.map((t) => t.netPnl));

  const winRate = ts.length ? wins.length / ts.length : 0;
  const lossRate = ts.length ? losses.length / ts.length : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  const dd = maxDrawdown(ts);

  const durations = ts.map((t) => t.durationMs ?? 0).filter((d) => d > 0);
  const withR = ts.filter((t) => typeof t.rMultiple === 'number');
  const avgRMultiple = withR.length ? round(sum(withR.map((t) => t.rMultiple as number)) / withR.length) : null;

  return {
    trades: ts.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: round(winRate),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    netPnl: round(netPnl),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : round(grossProfit / grossLoss),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    payoffRatio: avgLoss === 0 ? (avgWin > 0 ? Infinity : 0) : round(avgWin / avgLoss),
    expectancy: round(winRate * avgWin - lossRate * avgLoss),
    avgRMultiple,
    tradesWithR: withR.length,
    ...streaks(ts),
    largestWin: round(wins.length ? Math.max(...wins.map((t) => t.netPnl)) : 0),
    largestLoss: round(losses.length ? Math.min(...losses.map((t) => t.netPnl)) : 0),
    avgDurationMs: durations.length ? Math.round(sum(durations) / durations.length) : 0,
    drawdown: dd,
    recoveryFactor:
      dd.maxDrawdown === 0 ? (netPnl > 0 ? Infinity : 0) : round(netPnl / dd.maxDrawdown),
  };
}

function streaks(ts: Trade[]): { maxConsecutiveWins: number; maxConsecutiveLosses: number } {
  let w = 0;
  let l = 0;
  let maxW = 0;
  let maxL = 0;
  for (const t of [...ts].sort(byClose)) {
    if (t.netPnl > 0) {
      w += 1;
      l = 0;
      maxW = Math.max(maxW, w);
    } else if (t.netPnl < 0) {
      l += 1;
      w = 0;
      maxL = Math.max(maxL, l);
    } else {
      w = 0;
      l = 0;
    }
  }
  return { maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL };
}

const byClose = (a: Trade, b: Trade): number =>
  (a.closeTime ?? a.openTime) - (b.closeTime ?? b.openTime);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const round = (n: number): number => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
