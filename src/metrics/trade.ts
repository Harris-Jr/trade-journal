/**
 * Build aggregated Trades from raw Executions using FIFO lot matching.
 *
 * A Trade is a round-trip: it opens when position leaves flat and closes when it
 * returns to flat. An execution that flips through zero closes one trade and opens
 * the next with the remainder. All formulas here are our own (see spec A2).
 */
import type {
  Execution,
  Trade,
  TradeDirection,
  TradeAnnotations,
} from '../domain/types.js';

interface Lot {
  qty: number; // remaining open quantity (positive)
  price: number;
  direction: TradeDirection;
  multiplier: number;
}

interface Accumulator {
  executions: Execution[];
  direction: TradeDirection;
  openedQty: number; // total opening volume
  weightedEntry: number; // sum  price*qty of opening fills
  exitQty: number;
  weightedExit: number; // sum  price*qty of closing fills
  grossPnl: number;
  commission: number;
  fees: number;
  swap: number;
  openTime: number;
  multiplier: number;
  instrumentType: Execution['instrumentType'];
  symbol: string;
  accountId: string;
}

/**
 * Deterministic, stable trade id derived from account+symbol+openTime, so that
 * rebuilding trades from the same executions yields the same ids (annotations in
 * M4 persistence are keyed by this). Collisions within a build are disambiguated
 * in buildTrades().
 */
function tradeId(accountId: string, symbol: string, openTime: number): string {
  return `${accountId}:${symbol}:${openTime}`;
}

const signedQty = (e: Execution): number =>
  e.side === 'buy' ? e.quantity : -e.quantity;

function startAccumulator(e: Execution): Accumulator {
  return {
    executions: [],
    direction: e.side === 'buy' ? 'long' : 'short',
    openedQty: 0,
    weightedEntry: 0,
    exitQty: 0,
    weightedExit: 0,
    grossPnl: 0,
    commission: 0,
    fees: 0,
    swap: 0,
    openTime: e.timestamp,
    multiplier: e.multiplier ?? 1,
    instrumentType: e.instrumentType,
    symbol: e.symbol,
    accountId: e.accountId,
  };
}

function finalize(acc: Accumulator, closeTime: number | undefined, open: boolean): Trade {
  const netPnl = acc.grossPnl - acc.commission - acc.fees - acc.swap;
  const avgEntryPrice = acc.openedQty > 0 ? acc.weightedEntry / acc.openedQty : 0;
  const avgExitPrice = acc.exitQty > 0 ? acc.weightedExit / acc.exitQty : undefined;
  const trade: Trade = {
    id: tradeId(acc.accountId, acc.symbol, acc.openTime),
    accountId: acc.accountId,
    symbol: acc.symbol,
    instrumentType: acc.instrumentType,
    direction: acc.direction,
    quantity: acc.openedQty,
    avgEntryPrice,
    avgExitPrice,
    openTime: acc.openTime,
    closeTime: open ? undefined : closeTime,
    grossPnl: round2(acc.grossPnl),
    commission: round2(acc.commission),
    fees: round2(acc.fees),
    swap: round2(acc.swap),
    netPnl: round2(netPnl),
    durationMs: !open && closeTime !== undefined ? closeTime - acc.openTime : undefined,
    open,
    executions: acc.executions,
  };
  return trade;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/** Build trades for a single (account, symbol) stream of time-ordered executions. */
function buildStream(execs: Execution[]): Trade[] {
  const sorted = [...execs].sort((a, b) => a.timestamp - b.timestamp);
  const trades: Trade[] = [];
  const lots: Lot[] = [];
  let acc: Accumulator | null = null;
  let position = 0; // signed open quantity

  for (const e of sorted) {
    let remaining = e.quantity;
    const dir = signedQty(e) > 0 ? 1 : -1;
    // Each execution's costs are charged exactly once, to the first trade it touches
    // (on a flip, that is the trade being closed). Membership is deduped.
    let charged = false;
    const charge = (a: Accumulator) => {
      if (!charged) {
        a.commission += e.commission ?? 0;
        a.fees += e.fees ?? 0;
        a.swap += e.swap ?? 0;
        charged = true;
      }
      if (!a.executions.includes(e)) a.executions.push(e);
    };

    while (remaining > 0) {
      const sameOrFlat = position === 0 || Math.sign(position) === dir;

      if (sameOrFlat) {
        // Open or extend the current position.
        if (!acc) acc = startAccumulator(e);
        charge(acc);
        acc.openedQty += remaining;
        acc.weightedEntry += e.price * remaining;
        lots.push({
          qty: remaining,
          price: e.price,
          direction: acc.direction,
          multiplier: e.multiplier ?? 1,
        });
        position += dir * remaining;
        remaining = 0;
      } else {
        // Close against FIFO lots.
        const a = acc!;
        charge(a);
        const closable = Math.min(remaining, Math.abs(position));
        let toClose = closable;
        while (toClose > 0 && lots.length > 0) {
          const lot = lots[0]!;
          const matched = Math.min(toClose, lot.qty);
          const sign = lot.direction === 'long' ? 1 : -1;
          a.grossPnl += (e.price - lot.price) * matched * lot.multiplier * sign;
          a.weightedExit += e.price * matched;
          a.exitQty += matched;
          lot.qty -= matched;
          toClose -= matched;
          if (lot.qty <= 1e-9) lots.shift();
        }
        position += dir * closable;
        remaining -= closable;

        if (position === 0) {
          trades.push(finalize(a, e.timestamp, false));
          acc = null;
          // Any `remaining` continues as a fresh trade (position flip).
        }
      }
    }
  }

  if (acc) trades.push(finalize(acc, undefined, true));
  return trades;
}

/** Build all trades from a mixed list of executions across accounts/symbols. */
export function buildTrades(executions: Execution[]): Trade[] {
  const groups = new Map<string, Execution[]>();
  for (const e of executions) {
    const key = `${e.accountId}::${e.symbol}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  const out: Trade[] = [];
  for (const g of groups.values()) out.push(...buildStream(g));
  out.sort((a, b) => (a.closeTime ?? a.openTime) - (b.closeTime ?? b.openTime));
  // Disambiguate any colliding deterministic ids (same account+symbol+openTime ms).
  const seen = new Map<string, number>();
  for (const t of out) {
    const n = seen.get(t.id) ?? 0;
    if (n > 0) t.id = `${t.id}#${n}`;
    seen.set(t.id.replace(/#\d+$/, ''), n + 1);
  }
  return out;
}

/**
 * Attach planned-risk annotations and derive R-multiple / realized reward:risk.
 * initialRisk = |avgEntry - stopLoss| x quantity x multiplier.
 * rMultiple    = netPnl / initialRisk (cost- and size-aware).
 * realizedRr   = |avgExit - avgEntry| / |avgEntry - stopLoss|.
 */
export function applyAnnotations(trade: Trade, ann: TradeAnnotations): Trade {
  const next: Trade = { ...trade, annotations: { ...trade.annotations, ...ann } };
  const mult = trade.executions[0]?.multiplier ?? 1;
  const stop = ann.stopLoss;
  if (stop !== undefined && trade.quantity > 0) {
    const riskPerUnit = Math.abs(trade.avgEntryPrice - stop);
    const initialRisk = riskPerUnit * trade.quantity * mult;
    if (initialRisk > 0) {
      next.rMultiple = round2(trade.netPnl / initialRisk);
      if (trade.avgExitPrice !== undefined) {
        next.realizedRr = round2(
          Math.abs(trade.avgExitPrice - trade.avgEntryPrice) / riskPerUnit,
        );
      }
    }
  }
  return next;
}
