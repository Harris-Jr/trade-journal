// Types mirror the backend REST responses (src/server/api.ts, src/domain/types.ts).
// Non-finite numeric stats are serialized by the API as strings ("Infinity", etc.).

export type MaybeInfinite = number | 'Infinity' | '-Infinity' | 'NaN';

export type InstrumentType = 'stock' | 'option' | 'future' | 'forex' | 'crypto';
export type FillSide = 'buy' | 'sell';
export type TradeDirection = 'long' | 'short';
export type AccountKind = 'live' | 'backtest' | 'prop';

export interface Account {
  id: string;
  name: string;
  currency: string;
  startingBalance: number;
  kind: AccountKind;
}

export interface Execution {
  id: string;
  accountId: string;
  symbol: string;
  instrumentType: InstrumentType;
  side: FillSide;
  quantity: number;
  price: number;
  timestamp: number;
  multiplier?: number;
  commission?: number;
  fees?: number;
  swap?: number;
}

/** Execution payload for POST (no id/accountId required). */
export interface ExecutionInput {
  symbol: string;
  instrumentType: InstrumentType;
  side: FillSide;
  quantity: number;
  price: number;
  timestamp: number;
  multiplier?: number;
  commission?: number;
  fees?: number;
  swap?: number;
}

export interface TradeAnnotations {
  strategyId?: string;
  setup?: string;
  tags?: string[];
  mistakes?: string[];
  rating?: number;
  notes?: string;
  stopLoss?: number;
  takeProfit?: number;
  mae?: number;
  mfe?: number;
  playbookId?: string;
  playbookIntent?: string;
  playbookChecklist?: Record<string, boolean>;
  playbookReviewDone?: boolean;
  playbookReviewNotes?: string;
}

export interface Trade {
  id: string;
  accountId: string;
  symbol: string;
  instrumentType: InstrumentType;
  direction: TradeDirection;
  quantity: number;
  avgEntryPrice: number;
  avgExitPrice?: number;
  openTime: number;
  closeTime?: number;
  grossPnl: number;
  commission: number;
  fees: number;
  swap: number;
  netPnl: number;
  durationMs?: number;
  rMultiple?: number;
  realizedRr?: number;
  open: boolean;
  executions: Execution[];
  annotations?: TradeAnnotations;
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: MaybeInfinite;
  avgWin: number;
  avgLoss: number;
  payoffRatio: MaybeInfinite;
  expectancy: number;
  avgRMultiple: number | null;
  tradesWithR: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
  avgDurationMs: number;
  drawdown: { maxDrawdown: number; maxDrawdownPct: number };
  recoveryFactor: MaybeInfinite;
}

export interface HealthScoreComponent { value: number; score: number; weight: number }
export interface HealthScore {
  total: number;
  components: {
    profitFactor: HealthScoreComponent;
    avgWinLoss: HealthScoreComponent;
    maxDrawdown: HealthScoreComponent;
    tradeWin: HealthScoreComponent;
    recoveryFactor: HealthScoreComponent;
    consistency: HealthScoreComponent;
  };
}

export interface BreakdownRow {
  key: string;
  label: string;
  trades: number;
  netPnl: number;
  stats: TradeStats;
}

export interface EquityPoint { closeTime: number; cumulativePnl: number; equity: number }

export interface JournalEntry {
  id: string;
  accountId: string;
  date: string;
  body?: string;
  rating?: number;
}

export interface BalanceTransaction {
  id: string;
  accountId: string;
  timestamp: number;
  amount: number;
  kind: 'deposit' | 'withdrawal' | 'fee' | 'payout' | 'adjustment';
  note?: string;
}

export interface Note {
  id: string;
  accountId: string;
  title: string;
  body?: string;
  tags?: string[];
  tradeId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Strategy { id: string; name: string; description?: string; rules?: string[] }
export interface Tag { id: string; label: string; category: 'setup' | 'mistake' | 'emotion' | 'custom' }

export interface ImportRowError { row: number; message: string; raw: Record<string, string> }
export interface ImportResult { imported: number; errors: ImportRowError[] }

export interface DateRange { from?: number; to?: number }

export interface PageMeta { limit: number; offset: number; total: number; hasMore: boolean }
export interface Paginated<T> { items: T[]; page: PageMeta }
export interface ListOpts { limit?: number; offset?: number; sortDir?: 'asc' | 'desc' }
export type TradeSortKey = 'closeTime' | 'openTime' | 'symbol' | 'netPnl' | 'rMultiple' | 'quantity';
export interface TradeQueryOpts extends ListOpts {
  range?: DateRange; symbol?: string; direction?: 'long' | 'short';
  status?: 'open' | 'closed'; strategyId?: string; playbookId?: string; tag?: string; search?: string;
  sortBy?: TradeSortKey;
}
export interface ExecutionQueryOpts extends ListOpts {
  range?: DateRange; symbol?: string; side?: 'buy' | 'sell';
  sortBy?: 'timestamp' | 'symbol' | 'price' | 'quantity';
}

export type ReportDimension =
  | 'day' | 'week' | 'month' | 'dayOfWeek' | 'hourOfDay'
  | 'symbol' | 'strategy' | 'setup' | 'tag' | 'duration';
export type SortBy = 'key' | 'netPnl' | 'trades';

/** The data-access contract. Both the HTTP client and the demo client implement it. */
export interface Api {
  listAccounts(): Promise<Account[]>;
  createAccount(input: { name: string; currency: string; startingBalance?: number; kind?: AccountKind }): Promise<Account>;
  getBalance(accountId: string): Promise<{ accountId: string; balance: number }>;

  addExecutions(accountId: string, execs: ExecutionInput[]): Promise<Execution[]>;
  importCsv(accountId: string, csv: string, defaults?: { instrumentType?: InstrumentType; multiplier?: number }): Promise<ImportResult>;

  queryTrades(accountId: string, opts?: TradeQueryOpts): Promise<Paginated<Trade>>;
  getTrade(accountId: string, tradeId: string): Promise<Trade>;
  getStats(accountId: string, range?: DateRange): Promise<TradeStats>;
  getHealthScore(accountId: string, range?: DateRange): Promise<HealthScore>;
  getEquity(accountId: string, range?: DateRange): Promise<EquityPoint[]>;
  getReport(accountId: string, by: ReportDimension, opts?: { sortBy?: SortBy; tz?: string; range?: DateRange }): Promise<BreakdownRow[]>;
  setTradeAnnotation(tradeId: string, ann: TradeAnnotations): Promise<unknown>;

  listExecutions(accountId: string, opts?: ExecutionQueryOpts): Promise<Paginated<Execution>>;

  listJournal(accountId: string, opts?: ListOpts & { from?: string; to?: string }): Promise<Paginated<JournalEntry>>;
  saveJournal(accountId: string, entry: { date: string; body?: string; rating?: number; id?: string }): Promise<JournalEntry>;

  listNotes(accountId: string, opts?: ListOpts & { search?: string; tag?: string }): Promise<Paginated<Note>>;
  saveNote(accountId: string, note: { id?: string; title: string; body?: string; tags?: string[]; tradeId?: string }): Promise<Note>;
  deleteNote(noteId: string): Promise<{ deleted: boolean }>;

  listBalanceTransactions(accountId: string, opts?: ListOpts & { kind?: string; range?: DateRange }): Promise<Paginated<BalanceTransaction>>;
  addBalanceTransaction(accountId: string, tx: { timestamp?: number; amount: number; kind: BalanceTransaction['kind']; note?: string }): Promise<BalanceTransaction>;

  listStrategies(): Promise<Strategy[]>;
  createStrategy(input: { name: string; description?: string; rules?: string[] }): Promise<Strategy>;
  listTags(): Promise<Tag[]>;
  createTag(input: { label: string; category: Tag['category'] }): Promise<Tag>;

  // Saved filters (Stage 3)
  listSavedFilters(scope: SavedFilterScope): Promise<SavedFilter[]>;
  createSavedFilter(scope: SavedFilterScope, name: string, definition: Record<string, unknown>): Promise<SavedFilter>;
  updateSavedFilter(id: string, patch: { name?: string; definition?: Record<string, unknown> }): Promise<SavedFilter>;
  deleteSavedFilter(id: string): Promise<{ deleted: boolean }>;

  // Progress goals (M6.1)
  listGoals(accountId: string, tz?: string): Promise<GoalWithProgress[]>;
  createGoal(accountId: string, input: GoalInput): Promise<Goal>;
  updateGoal(goalId: string, patch: GoalPatch): Promise<Goal>;
  resetGoal(goalId: string): Promise<Goal>;
  deleteGoal(goalId: string): Promise<{ deleted: boolean }>;

  // Playbooks (M6.2)
  listPlaybooks(opts?: PlaybookListOpts): Promise<Playbook[]>;
  getPlaybook(id: string): Promise<PlaybookDetail>;
  createPlaybook(data: PlaybookData): Promise<Playbook>;
  updatePlaybook(id: string, patch: Partial<PlaybookData>): Promise<Playbook>;
  archivePlaybook(id: string): Promise<Playbook>;
  restorePlaybook(id: string): Promise<Playbook>;
  deletePlaybook(id: string): Promise<{ deleted: boolean }>;
  getPlaybookAnalytics(accountId: string, playbookId: string, tz?: string): Promise<PlaybookAnalytics>;

  // Insights (M6.3)
  getInsights(accountId: string, opts?: { range?: DateRange; tz?: string; thresholds?: Partial<InsightThresholds> }): Promise<InsightsResult>;

  // Prop-firm tracking (M6.4)
  getPropSummary(): Promise<PropSummary>;
  listPropAccounts(status?: PropAccountStatus): Promise<PropAccountWithTotals[]>;
  getPropAccount(id: string): Promise<PropAccountDetail>;
  createPropAccount(data: PropAccountData): Promise<PropAccount>;
  updatePropAccount(id: string, patch: Partial<PropAccountData>): Promise<PropAccount>;
  deletePropAccount(id: string): Promise<{ deleted: boolean }>;
  addPropTransaction(accountId: string, tx: { amount: number; kind: PropTransactionKind; note?: string; timestamp?: number }): Promise<PropTransaction>;
  deletePropTransaction(txId: string): Promise<{ deleted: boolean }>;
}

export type SavedFilterScope = 'trades' | 'reports';
export interface SavedFilter {
  id: string; userId: string; scope: SavedFilterScope; name: string;
  definition: Record<string, unknown>; createdAt: number; updatedAt: number;
}

// --- Progress Tracker (M6.1) ---
export type GoalMetric =
  | 'net_pnl' | 'trade_count' | 'win_rate' | 'avg_r_multiple'
  | 'green_day_rate' | 'avg_day_rating' | 'journaled_day_rate' | 'mistake_count';
export type GoalPeriod = 'daily' | 'weekly' | 'monthly';
export type GoalDirection = 'at_least' | 'at_most';
export type GoalStatus = 'active' | 'paused';
export type MetricCategory = 'performance' | 'behavioral';
export type MetricUnit = 'currency' | 'count' | 'percent' | 'r' | 'rating';

export interface Goal {
  id: string; userId: string; accountId: string;
  metric: GoalMetric; period: GoalPeriod; direction: GoalDirection;
  target: number; status: GoalStatus; startAt: number; createdAt: number; updatedAt: number;
}
export interface GoalProgress {
  goalId: string; metric: GoalMetric; period: GoalPeriod; direction: GoalDirection;
  target: number; status: GoalStatus; category: MetricCategory; unit: MetricUnit;
  periodKey: string; current: number | null; remaining: number | null;
  fraction: number | null; met: boolean | null; sampleSize: number;
  history: { key: string; value: number | null; met: boolean | null }[];
}
export type GoalWithProgress = Goal & { progress: GoalProgress };
export interface GoalInput { metric: GoalMetric; period: GoalPeriod; direction?: GoalDirection; target: number }
export interface GoalPatch { metric?: GoalMetric; period?: GoalPeriod; direction?: GoalDirection; target?: number; status?: GoalStatus }

// --- Playbooks (M6.2) ---
export type PlaybookDirection = 'long' | 'short' | 'both';
export type PlaybookStatus = 'active' | 'archived';
export interface PlaybookChecklistItem { id: string; label: string }
export interface PlaybookReference { type: 'trade' | 'journal' | 'url'; ref: string; label?: string }
export interface Playbook {
  id: string; userId: string; name: string; description?: string; market?: string; symbols?: string[];
  direction?: PlaybookDirection; timeframe?: string; category?: string;
  entryCriteria?: string; confirmationSignals?: string; invalidationConditions?: string;
  stopRules?: string; targetRules?: string; riskRules?: string;
  checklist?: PlaybookChecklistItem[]; reviewPrompts?: PlaybookChecklistItem[];
  examples?: string; notes?: string; references?: PlaybookReference[];
  status: PlaybookStatus; createdAt: number; updatedAt: number;
}
export type PlaybookDetail = Playbook & { linkedTradeCount: number };
export type PlaybookData = Omit<Playbook, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>;
export interface PlaybookListOpts { status?: PlaybookStatus; search?: string; sort?: 'name' | 'created' | 'updated' }
export interface PlaybookAnalytics {
  linkedClosed: number; linkedOpen: number; stats: TradeStats; breakevenRate: number | null;
  bySymbol: BreakdownRow[]; byDirection: BreakdownRow[]; byMonth: BreakdownRow[];
  checklistAdherence: number | null; reviewCompletionRate: number | null;
}

// --- Insights (M6.3) ---
export type InsightType = 'overtrading' | 'loss_streak' | 'revenge_trade' | 'oversized_loss' | 'no_stop_loss' | 'unjournaled_day';
export type InsightLevel = 'trade' | 'day';
export type InsightSeverity = 'low' | 'medium' | 'high';
export interface Insight {
  id: string; type: InsightType; level: InsightLevel; severity: InsightSeverity;
  title: string; detail: string; tradeId?: string; symbol?: string; date?: string; value?: number;
}
export interface InsightThresholds {
  overtradingPerDay: number; lossStreak: number; revengeWindowMin: number;
  revengeSizeMultiple: number; oversizedLossMultiple: number;
}
export interface InsightsResult {
  insights: Insight[]; summary: { type: InsightType; count: number }[];
  thresholds: InsightThresholds; closedTrades: number;
}

// --- Prop-firm tracking (M6.4) ---
export type PropAccountStatus = 'evaluation' | 'funded' | 'passed' | 'failed' | 'breached';
export type PropTransactionKind = 'evaluation_fee' | 'reset_fee' | 'activation_fee' | 'payout' | 'refund' | 'other';
export interface PropAccount {
  id: string; userId: string; firm: string; program?: string; accountSize?: number;
  status: PropAccountStatus; phase?: string; profitTarget?: number; maxDrawdown?: number; dailyLossLimit?: number;
  tradingAccountId?: string; startedAt?: number; notes?: string; createdAt: number; updatedAt: number;
}
export interface PropTransaction {
  id: string; userId: string; propAccountId: string; timestamp: number;
  amount: number; kind: PropTransactionKind; note?: string; createdAt: number;
}
export interface PropAccountTotals { propAccountId: string; cost: number; payout: number; net: number; transactions: number }
export type PropAccountWithTotals = PropAccount & { totals: PropAccountTotals };
export type PropAccountDetail = PropAccount & { totals: PropAccountTotals; transactions: PropTransaction[] };
export type PropAccountData = Omit<PropAccount, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'> & { status?: PropAccountStatus };
export interface PropSummary {
  accounts: number; cost: number; payout: number; net: number;
  byStatus: { status: PropAccountStatus; count: number }[]; perAccount: PropAccountTotals[];
}
