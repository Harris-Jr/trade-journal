/**
 * Prop-firm cash-flow aggregation (M6.4).
 *
 * Pure sums over a user's manual prop-firm ledger. This is the user's own record
 * of fees and payouts; it is not trade P&L and never touches the canonical engine.
 *
 * Definitions:
 * - cost    = sum of the magnitudes of negative amounts (fees: evaluation, reset, activation).
 * - payout  = sum of positive amounts (payouts and refunds).
 * - net     = payout - cost (what the prop activity has returned net of what it cost).
 * Missing data is not invented: an account with no transactions has cost 0, payout 0, net 0.
 */
import type { PropAccount, PropTransaction, PropAccountStatus } from '../domain/types.js';

export interface PropAccountTotals { propAccountId: string; cost: number; payout: number; net: number; transactions: number }
export interface PropSummary {
  accounts: number;
  cost: number;
  payout: number;
  net: number;
  byStatus: { status: PropAccountStatus; count: number }[];
  perAccount: PropAccountTotals[];
}

const round = (n: number): number => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export function accountTotals(propAccountId: string, txns: PropTransaction[]): PropAccountTotals {
  const mine = txns.filter((t) => t.propAccountId === propAccountId);
  const cost = mine.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);
  const payout = mine.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  return { propAccountId, cost: round(cost), payout: round(payout), net: round(payout - cost), transactions: mine.length };
}

export function propSummary(accounts: PropAccount[], txns: PropTransaction[]): PropSummary {
  const perAccount = accounts.map((a) => accountTotals(a.id, txns));
  const cost = round(perAccount.reduce((a, t) => a + t.cost, 0));
  const payout = round(perAccount.reduce((a, t) => a + t.payout, 0));
  const statusCounts = new Map<PropAccountStatus, number>();
  for (const a of accounts) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
  return {
    accounts: accounts.length,
    cost,
    payout,
    net: round(payout - cost),
    byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    perAccount,
  };
}
