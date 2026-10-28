/**
 * Health Score - an INDEPENDENT equivalent of TradeZella's "Zella Score".
 *
 * Structure, weights and tier tables are reproduced from the public help center
 * (article 10305642; see docs/01 section 7). The exact per-metric sub-formulas for
 * Profit Factor / Avg-Win-Loss / Trade-Win / Recovery are published only as
 * images, so those are our own faithful interpolations of the documented tiers.
 * The Consistency metric below is our own transparent definition (the official
 * one is ambiguous in the public text). This is NOT TradeZella's code.
 */
import type { Trade } from '../domain/types.js';
import { computeStats } from './stats.js';

export interface HealthScoreWeights {
  profitFactor: number;
  avgWinLoss: number;
  maxDrawdown: number;
  tradeWin: number;
  recoveryFactor: number;
  consistency: number;
}

/** Documented default weights (sum = 1.0). */
export const DEFAULT_WEIGHTS: HealthScoreWeights = {
  profitFactor: 0.25,
  avgWinLoss: 0.2,
  maxDrawdown: 0.2,
  tradeWin: 0.15,
  recoveryFactor: 0.1,
  consistency: 0.1,
};

export interface HealthScoreComponent {
  value: number; // the underlying metric value
  score: number; // 0..100
  weight: number;
}

export interface HealthScore {
  total: number; // 0..100
  components: Record<keyof HealthScoreWeights, HealthScoreComponent>;
}

interface Band {
  lo: number;
  hi: number;
  loS: number;
  hiS: number;
}

function tier(value: number, bands: Band[], aboveTopScore: number, belowBottomScore: number): number {
  const top = bands[0]!;
  if (value >= top.hi) return aboveTopScore;
  const bottom = bands[bands.length - 1]!;
  if (value < bottom.lo) return belowBottomScore;
  for (const b of bands) {
    if (value >= b.lo && value < b.hi) {
      return b.loS + ((value - b.lo) / (b.hi - b.lo)) * (b.hiS - b.loS);
    }
  }
  return belowBottomScore;
}

// Profit Factor & Average Win/Loss share the same documented tier table.
const PF_BANDS: Band[] = [
  { lo: 2.4, hi: 2.6, loS: 90, hiS: 100 },
  { lo: 2.2, hi: 2.4, loS: 80, hiS: 90 },
  { lo: 2.0, hi: 2.2, loS: 70, hiS: 80 },
  { lo: 1.9, hi: 2.0, loS: 60, hiS: 70 },
  { lo: 1.8, hi: 1.9, loS: 50, hiS: 60 },
];
export const scoreProfitFactor = (v: number): number =>
  clamp(tier(v, PF_BANDS, 100, 20));
export const scoreAvgWinLoss = scoreProfitFactor;

const RF_BANDS: Band[] = [
  { lo: 3.0, hi: 3.5, loS: 70, hiS: 89 },
  { lo: 2.5, hi: 3.0, loS: 60, hiS: 69 },
  { lo: 2.0, hi: 2.5, loS: 50, hiS: 59 },
  { lo: 1.5, hi: 2.0, loS: 30, hiS: 49 },
  { lo: 1.0, hi: 1.5, loS: 1, hiS: 29 },
];
export const scoreRecoveryFactor = (v: number): number =>
  clamp(tier(v, RF_BANDS, 100, 0));

/** 100 - drawdown%, floored at 0. */
export const scoreMaxDrawdown = (ddPct: number): number => clamp(100 - ddPct);

/** min(100, (win% / topThreshold) x 100). Default top threshold 60. */
export const scoreTradeWin = (winPct: number, topThreshold = 60): number =>
  clamp(Math.min(100, (winPct / topThreshold) * 100));

/**
 * Consistency (our independent definition): if average trade P&L <= 0 -> 0;
 * otherwise 100 - coefficientOfVariationx100, floored at 0. Lower dispersion of
 * per-trade results relative to the mean => higher consistency.
 */
export function scoreConsistency(perTradeNet: number[]): number {
  if (perTradeNet.length === 0) return 0;
  const mean = perTradeNet.reduce((a, b) => a + b, 0) / perTradeNet.length;
  if (mean <= 0) return 0;
  const variance =
    perTradeNet.reduce((a, b) => a + (b - mean) ** 2, 0) / perTradeNet.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp(100 - cv * 100);
}

export function healthScore(
  trades: Trade[],
  weights: HealthScoreWeights = DEFAULT_WEIGHTS,
  topThreshold = 60,
): HealthScore {
  const s = computeStats(trades);
  const perTradeNet = trades.filter((t) => !t.open).map((t) => t.netPnl);

  const pf = isFinite(s.profitFactor) ? s.profitFactor : 3; // cap "no losses" generously
  const awl = isFinite(s.payoffRatio) ? s.payoffRatio : 3;
  const rf = isFinite(s.recoveryFactor) ? s.recoveryFactor : 4;

  const components: HealthScore['components'] = {
    profitFactor: { value: pf, score: scoreProfitFactor(pf), weight: weights.profitFactor },
    avgWinLoss: { value: awl, score: scoreAvgWinLoss(awl), weight: weights.avgWinLoss },
    maxDrawdown: {
      value: s.drawdown.maxDrawdownPct,
      score: scoreMaxDrawdown(s.drawdown.maxDrawdownPct),
      weight: weights.maxDrawdown,
    },
    tradeWin: {
      value: s.winRate * 100,
      score: scoreTradeWin(s.winRate * 100, topThreshold),
      weight: weights.tradeWin,
    },
    recoveryFactor: { value: rf, score: scoreRecoveryFactor(rf), weight: weights.recoveryFactor },
    consistency: {
      value: perTradeNet.length ? perTradeNet.reduce((a, b) => a + b, 0) / perTradeNet.length : 0,
      score: scoreConsistency(perTradeNet),
      weight: weights.consistency,
    },
  };

  const total = (Object.values(components) as HealthScoreComponent[]).reduce(
    (acc, c) => acc + c.score * c.weight,
    0,
  );
  return { total: round(total), components };
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
