/**
 * Display value projections (Stage 4).
 *
 * These are presentation-only transforms of values ALREADY produced by the trade
 * engine (netPnl, rMultiple, average prices). They never recompute realized or
 * unrealized P&L and never mutate trades.
 *
 * Units and formulas (per trade):
 *   - currency : netPnl, as stored (account currency).
 *   - percent  : netPnl / startingBalance x 100.
 *                Denominator choice: the ACCOUNT STARTING BALANCE (a stable base),
 *                not a moving equity value, so percentages are comparable across
 *                trades. Unavailable when startingBalance <= 0 or unknown.
 *   - R        : the engine's rMultiple (netPnl / initial planned risk).
 *                Unavailable when the trade has no planned stop (rMultiple undefined).
 *   - points   : signed price move captured = (avgExit - avgEntry) x dir,
 *                dir = +1 for long, -1 for short (a favorable move is positive).
 *                Unavailable for open trades (no avgExit).
 *   - ticks    : points / tickSize. Requires instrument tickSize metadata.
 *   - pips     : points / pipSize. Requires instrument pipSize metadata.
 *
 * Timezone: projections are timezone-independent (pure numeric transforms).
 *
 * Unavailable-data behavior: when a projection cannot be computed (missing stop,
 * open trade, missing/zero denominator, or missing instrument metadata), the
 * result is { available:false, value:null, reason } - callers must render a
 * placeholder (e.g. "-") and MUST NOT substitute a different unit or a guess.
 * Instrument metadata is never invented; it must be supplied by the caller.
 */

export type ValueUnit = 'currency' | 'percent' | 'R' | 'points' | 'ticks' | 'pips';

export interface InstrumentSpec {
  /** Minimum price increment, e.g. 0.25 for ES futures. */
  tickSize?: number;
  /** Currency value of one full point (for reference; not required for points/ticks math). */
  pointValue?: number;
  /** Price size of one pip, e.g. 0.0001 for most FX pairs. */
  pipSize?: number;
}

export interface ProjectionContext {
  startingBalance?: number;
  spec?: InstrumentSpec;
}

export interface ProjectableTrade {
  netPnl: number;
  rMultiple?: number;
  avgEntryPrice: number;
  avgExitPrice?: number;
  direction: 'long' | 'short';
  open: boolean;
}

export interface Projected {
  unit: ValueUnit;
  value: number | null;
  available: boolean;
  reason?: string;
}

const round = (n: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

function pricePoints(t: ProjectableTrade): { points: number } | { reason: string } {
  if (t.avgExitPrice === undefined) return { reason: 'open trade has no exit price' };
  const dir = t.direction === 'long' ? 1 : -1;
  return { points: (t.avgExitPrice - t.avgEntryPrice) * dir };
}

export function projectTrade(t: ProjectableTrade, unit: ValueUnit, ctx: ProjectionContext = {}): Projected {
  const avail = (value: number): Projected => ({ unit, value: round(value, unit === 'currency' ? 2 : 4), available: true });
  const miss = (reason: string): Projected => ({ unit, value: null, available: false, reason });

  switch (unit) {
    case 'currency':
      return avail(t.netPnl);
    case 'percent':
      if (ctx.startingBalance === undefined || ctx.startingBalance <= 0) return miss('account starting balance is unknown or <= 0');
      return avail((t.netPnl / ctx.startingBalance) * 100);
    case 'R':
      return t.rMultiple === undefined ? miss('no planned stop on this trade (R undefined)') : avail(t.rMultiple);
    case 'points': {
      const p = pricePoints(t);
      return 'reason' in p ? miss(p.reason) : avail(p.points);
    }
    case 'ticks': {
      const p = pricePoints(t);
      if ('reason' in p) return miss(p.reason);
      if (!ctx.spec?.tickSize || ctx.spec.tickSize <= 0) return miss('instrument tick size is not configured');
      return avail(p.points / ctx.spec.tickSize);
    }
    case 'pips': {
      const p = pricePoints(t);
      if ('reason' in p) return miss(p.reason);
      if (!ctx.spec?.pipSize || ctx.spec.pipSize <= 0) return miss('instrument pip size is not configured');
      return avail(p.points / ctx.spec.pipSize);
    }
    default:
      return miss(`unknown unit: ${String(unit)}`);
  }
}

/** Short unit suffix for display. */
export function unitSuffix(unit: ValueUnit): string {
  switch (unit) {
    case 'percent': return '%';
    case 'R': return 'R';
    case 'points': return 'pts';
    case 'ticks': return 'ticks';
    case 'pips': return 'pips';
    default: return '';
  }
}
