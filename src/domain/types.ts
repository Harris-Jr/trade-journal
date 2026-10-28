/**
 * Domain model for an independent trading journal.
 *
 * Field names deliberately follow the vocabulary observed in TradeZella's public
 * bundle (net_pnl, r_multiple, mae/mfe, side, setup, mistakes, ...) because those
 * are the standard concepts of trade journaling - but every definition, formula
 * and relationship here is our own, written from scratch. See docs/02-feature-spec.md.
 */

export type InstrumentType = 'stock' | 'option' | 'future' | 'forex' | 'crypto';

/** Direction of a single fill. */
export type FillSide = 'buy' | 'sell';

/** Direction of an aggregated trade. */
export type TradeDirection = 'long' | 'short';

export interface Account {
  id: string;
  name: string;
  /** ISO 4217, e.g. "USD". */
  currency: string;
  /** Opening balance used as the equity-curve origin. */
  startingBalance: number;
  /** 'live' trades, or an isolated 'backtest' account. */
  kind: 'live' | 'backtest' | 'prop';
}

/**
 * One fill / execution. Trades are derived from ordered executions (A2 in spec).
 * Costs are stored as positive numbers that REDUCE P&L.
 */
export interface Execution {
  id: string;
  accountId: string;
  symbol: string;
  instrumentType: InstrumentType;
  side: FillSide;
  /** Always positive. Shares, contracts, or lots. */
  quantity: number;
  price: number;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Contract/point multiplier (futures/options/forex). Defaults to 1. */
  multiplier?: number;
  commission?: number;
  fees?: number;
  swap?: number;
}

/**
 * User annotations attached to a trade.
 *
 * How the setup-like fields relate (no duplication):
 * - `tags`: free labels for grouping/filtering (many per trade).
 * - `setup`: a short free-text name of the pattern.
 * - `strategyId`: the original lightweight named-strategy link (M5). Kept as-is for
 *   backward compatibility and the existing "by strategy" report dimension.
 * - `playbookId` (M6.2): link to a first-class Playbook (a documented plan with rules,
 *   checklists and its own analytics). A trade may be assigned to one playbook. The
 *   remaining playbook* fields record this trade's execution against that playbook.
 */
export interface TradeAnnotations {
  strategyId?: string;
  setup?: string;
  tags?: string[];
  mistakes?: string[];
  /** Simple quality rating, e.g. -1 bad / 0 neutral / +1 good. */
  rating?: number;
  notes?: string;
  /** Planned risk inputs for R-multiple; prices in instrument terms. */
  stopLoss?: number;
  takeProfit?: number;
  /** Max adverse / favorable excursion in price terms, if tracked. */
  mae?: number;
  mfe?: number;
  /** Assigned Playbook id (M6.2). */
  playbookId?: string;
  /** Pre-trade intention noted against the playbook. */
  playbookIntent?: string;
  /** Pre-trade checklist state: playbook checklist item id -> checked. */
  playbookChecklist?: Record<string, boolean>;
  /** Whether the post-trade review was completed. */
  playbookReviewDone?: boolean;
  /** Free-text post-trade review. */
  playbookReviewNotes?: string;
}

/** A documented trading setup (M6.2). Only `name` is required; everything else is optional. */
export type PlaybookDirection = 'long' | 'short' | 'both';
export type PlaybookStatus = 'active' | 'archived';
export interface PlaybookChecklistItem { id: string; label: string }
export interface PlaybookReference { type: 'trade' | 'journal' | 'url'; ref: string; label?: string }

export interface Playbook {
  id: string;
  userId: string;
  name: string;
  description?: string;
  market?: string;
  symbols?: string[];
  direction?: PlaybookDirection;
  timeframe?: string;
  category?: string;
  entryCriteria?: string;
  confirmationSignals?: string;
  invalidationConditions?: string;
  stopRules?: string;
  targetRules?: string;
  riskRules?: string;
  checklist?: PlaybookChecklistItem[];
  reviewPrompts?: PlaybookChecklistItem[];
  examples?: string;
  notes?: string;
  references?: PlaybookReference[];
  status: PlaybookStatus;
  createdAt: number;
  updatedAt: number;
}

/** A closed (or still-open) round-trip, aggregated from executions. */
export interface Trade {
  id: string;
  accountId: string;
  symbol: string;
  instrumentType: InstrumentType;
  direction: TradeDirection;
  /** Total opening volume (position size at peak exposure). */
  quantity: number;
  avgEntryPrice: number;
  /** Undefined while the trade is still open. */
  avgExitPrice?: number;
  openTime: number;
  closeTime?: number;
  /** P&L before costs. */
  grossPnl: number;
  commission: number;
  fees: number;
  swap: number;
  /** grossPnl - commission - fees - swap. */
  netPnl: number;
  /** Holding time in ms (closed trades only). */
  durationMs?: number;
  /** net P&L / initial risk (needs stopLoss). Undefined otherwise. */
  rMultiple?: number;
  /** Realized reward:risk. Undefined without stopLoss. */
  realizedRr?: number;
  open: boolean;
  executions: Execution[];
  annotations?: TradeAnnotations;
}

export interface Strategy {
  id: string;
  name: string;
  description?: string;
  /** Free-form entry/exit rules (A5). */
  rules?: string[];
}

export interface Tag {
  id: string;
  label: string;
  category: 'setup' | 'mistake' | 'emotion' | 'custom';
}

export interface JournalEntry {
  id: string;
  accountId: string;
  /** Local date key YYYY-MM-DD. */
  date: string;
  /** Rich text serialized however the UI chooses. */
  body?: string;
  /** Day rating, e.g. 1..5. */
  rating?: number;
}

/** A free-form notebook note (A7), optionally linked to a trade. */
export interface Note {
  id: string;
  accountId: string;
  title: string;
  body?: string;
  tags?: string[];
  /** Optional link to a trade (deterministic trade id). */
  tradeId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A Progress Tracker goal (M6.1). Financial-performance goals and behavioral
 * (discipline) goals are distinguished by the metric's category. A goal is
 * evaluated per period (day/week/month) against trades and journal data; progress
 * is derived live from the canonical engine and never stored cumulatively.
 */
export type GoalMetric =
  | 'net_pnl'          // performance: realized net P&L (currency)
  | 'trade_count'      // performance: number of closed trades
  | 'win_rate'         // performance: win rate (percent)
  | 'avg_r_multiple'   // performance: mean R-multiple of trades with a planned stop
  | 'green_day_rate'   // performance: share of trading days that were net positive (percent)
  | 'avg_day_rating'   // behavioral: mean journal day rating (1-5)
  | 'journaled_day_rate' // behavioral: share of trading days that have a journal entry (percent)
  | 'mistake_count';   // behavioral: count of recorded mistakes (fewer is better)

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';
export type GoalDirection = 'at_least' | 'at_most';
export type GoalStatus = 'active' | 'paused';

export interface Goal {
  id: string;
  userId: string;
  accountId: string;
  metric: GoalMetric;
  period: GoalPeriod;
  direction: GoalDirection;
  target: number;
  status: GoalStatus;
  /** Progress and history only count activity on or after this time (reset moves it to now). */
  startAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface BalanceTransaction {
  id: string;
  accountId: string;
  timestamp: number;
  /** Positive = deposit, negative = withdrawal/fee. */
  amount: number;
  kind: 'deposit' | 'withdrawal' | 'fee' | 'payout' | 'adjustment';
  note?: string;
}
