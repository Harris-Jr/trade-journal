/**
 * Persistence layer (M4) built on Node's built-in SQLite (`node:sqlite`, Node >=22.5).
 *
 * Executions are the source of truth; Trades are derived on read via buildTrades,
 * and user annotations are stored keyed by the deterministic trade id. This keeps
 * stored data minimal and trade aggregation always consistent with the fills.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Load the (newer) node:sqlite builtin at runtime so bundlers that don't yet know
// it (e.g. Vite/Vitest) never try to statically resolve it. The type-only import
// above is erased at compile time.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncCtor } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
import type {
  Account,
  Execution,
  Strategy,
  Tag,
  JournalEntry,
  BalanceTransaction,
  Note,
  Trade,
  TradeAnnotations,
  Goal,
  GoalMetric,
  GoalPeriod,
  GoalDirection,
  GoalStatus,
  Playbook,
  PlaybookStatus,
  PropAccount,
  PropAccountStatus,
  PropTransaction,
  PropTransactionKind,
} from '../domain/types.js';
import { buildTrades, applyAnnotations } from '../metrics/trade.js';
import { computeStats, equityCurve, type TradeStats, type EquityPoint } from '../metrics/stats.js';
import { healthScore, type HealthScore } from '../metrics/healthScore.js';
import { report, type ReportDimension, type BreakdownRow, type SortBy } from '../analytics/reports.js';
import { evaluateGoal, type GoalProgress } from '../analytics/progress.js';
import { playbookAnalytics, type PlaybookAnalytics } from '../analytics/playbook.js';
import { computeInsights, type InsightsResult, type InsightThresholds } from '../analytics/insights.js';
import { propSummary, accountTotals, type PropSummary, type PropAccountTotals } from '../analytics/propfirm.js';
import { importExecutionsFromCsv, type ColumnMapping, type ImportDefaults, type RowError } from '../import/genericCsv.js';

// --- versioned, additive migrations (tracked via PRAGMA user_version) ---

// v1: the original M0-M5 schema.
const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
  starting_balance REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'live'
);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
  price REAL NOT NULL, timestamp INTEGER NOT NULL, multiplier REAL NOT NULL DEFAULT 1,
  commission REAL NOT NULL DEFAULT 0, fees REAL NOT NULL DEFAULT 0, swap REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_exec_account ON executions(account_id, symbol, timestamp);
CREATE TABLE IF NOT EXISTS trade_annotations (trade_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, rules TEXT);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL, body TEXT, rating INTEGER
);
CREATE TABLE IF NOT EXISTS balance_transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
  amount REAL NOT NULL, kind TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  tags TEXT, trade_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_account ON notes(account_id, updated_at);
`;

// v2 (Stage 1): users/sessions + per-user ownership on accounts/strategies/tags.
const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
ALTER TABLE accounts ADD COLUMN user_id TEXT;
ALTER TABLE strategies ADD COLUMN user_id TEXT;
ALTER TABLE tags ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
`;

// v3 (Stage 2): indexes aligned to the real list query patterns.
const MIGRATION_V3 = `
CREATE INDEX IF NOT EXISTS idx_journal_account_date ON journal_entries(account_id, date);
CREATE INDEX IF NOT EXISTS idx_btx_account_ts ON balance_transactions(account_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_exec_account_ts ON executions(account_id, timestamp);
`;

// v4 (Stage 3): user-scoped saved filters.
const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS saved_filters (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL,
  definition TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_filters_user ON saved_filters(user_id, scope);
`;

// v5 (M6.1): user-scoped, account-scoped progress goals.
const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL,
  metric TEXT NOT NULL, period TEXT NOT NULL, direction TEXT NOT NULL,
  target REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  start_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_user_account ON goals(user_id, account_id);
`;

// v6 (M6.2): user-scoped playbooks (documented trading setups).
const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  name TEXT NOT NULL, description TEXT,
  market TEXT, symbols TEXT, direction TEXT, timeframe TEXT, category TEXT,
  entry_criteria TEXT, confirmation_signals TEXT, invalidation_conditions TEXT,
  stop_rules TEXT, target_rules TEXT, risk_rules TEXT,
  checklist TEXT, review_prompts TEXT, examples TEXT, notes TEXT, refs TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playbooks_user ON playbooks(user_id, status);
`;

// v7 (M6.4): manual prop-firm tracking (accounts + cash-flow ledger).
const MIGRATION_V7 = `
CREATE TABLE IF NOT EXISTS prop_accounts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, firm TEXT NOT NULL, program TEXT,
  account_size REAL, status TEXT NOT NULL DEFAULT 'evaluation', phase TEXT,
  profit_target REAL, max_drawdown REAL, daily_loss_limit REAL,
  trading_account_id TEXT, started_at INTEGER, notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prop_accounts_user ON prop_accounts(user_id, status);
CREATE TABLE IF NOT EXISTS prop_transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prop_account_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL, amount REAL NOT NULL, kind TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prop_txns_account ON prop_transactions(prop_account_id, timestamp);
`;

const MIGRATIONS = [MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6, MIGRATION_V7];

export class Repository {
  readonly db: DatabaseSync;

  constructor(location = ':memory:') {
    this.db = new DatabaseSyncCtor(location);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    let version = row.user_version ?? 0;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec(MIGRATIONS[i]!);
      version = i + 1;
    }
    this.db.exec(`PRAGMA user_version = ${version}`);
  }

  close(): void {
    this.db.close();
  }

  // ---- auth: users & sessions ----
  createUser(email: string, passwordHash: string): UserRecord {
    const id = randomUUID();
    const now = Date.now();
    const normalized = email.trim().toLowerCase();
    this.db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)')
      .run(id, normalized, passwordHash, now);
    return { id, email: normalized, passwordHash, createdAt: now };
  }
  getUserByEmail(email: string): UserRecord | null {
    const r = this.db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return r ? rowToUser(r) : null;
  }
  getUserById(id: string): UserRecord | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToUser(r) : null;
  }
  createSession(userId: string, token: string, ttlMs: number): { token: string; expiresAt: number } {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    this.db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(token, userId, now, expiresAt);
    return { token, expiresAt };
  }
  /** Returns the owning user id for a live (non-expired) session, else null. Expired sessions are purged. */
  getSessionUserId(token: string): string | null {
    const r = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token=?').get(token) as
      { user_id: string; expires_at: number } | undefined;
    if (!r) return null;
    if (r.expires_at <= Date.now()) { this.deleteSession(token); return null; }
    return r.user_id;
  }
  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  }

  // ---- accounts ----
  createAccount(a: Omit<Account, 'id'> & { id?: string; userId?: string }): Account {
    const id = a.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO accounts (id,name,currency,starting_balance,kind,user_id) VALUES (?,?,?,?,?,?)')
      .run(id, a.name, a.currency, a.startingBalance, a.kind, a.userId ?? null);
    return { id, name: a.name, currency: a.currency, startingBalance: a.startingBalance, kind: a.kind };
  }
  getAccount(id: string): Account | null {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToAccount(r) : null;
  }
  /** The owning user id for an account, or null if the account is missing/unowned. */
  getAccountOwner(id: string): string | null {
    const r = this.db.prepare('SELECT user_id FROM accounts WHERE id=?').get(id) as { user_id: string | null } | undefined;
    return r?.user_id ?? null;
  }
  listAccounts(userId?: string): Account[] {
    const rows = userId
      ? this.db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY name').all(userId)
      : this.db.prepare('SELECT * FROM accounts ORDER BY name').all();
    return (rows as Record<string, unknown>[]).map(rowToAccount);
  }

  // ---- executions ----
  addExecutions(accountId: string, execs: Omit<Execution, 'accountId'>[]): Execution[] {
    const stmt = this.db.prepare(
      `INSERT INTO executions (id,account_id,symbol,instrument_type,side,quantity,price,timestamp,multiplier,commission,fees,swap)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const inserted: Execution[] = [];
    const run = this.db.prepare('BEGIN');
    run.run();
    try {
      for (const e of execs) {
        const id = e.id && !e.id.startsWith('imp_') ? e.id : randomUUID();
        stmt.run(
          id, accountId, e.symbol, e.instrumentType, e.side, e.quantity, e.price,
          e.timestamp, e.multiplier ?? 1, e.commission ?? 0, e.fees ?? 0, e.swap ?? 0,
        );
        inserted.push({ ...e, id, accountId });
      }
      this.db.prepare('COMMIT').run();
    } catch (err) {
      this.db.prepare('ROLLBACK').run();
      throw err;
    }
    return inserted;
  }

  listExecutions(accountId: string): Execution[] {
    return (this.db
      .prepare('SELECT * FROM executions WHERE account_id=? ORDER BY timestamp, id')
      .all(accountId) as Record<string, unknown>[]).map(rowToExecution);
  }

  /** Server-side filtered/sorted/paginated executions (filtering happens in SQL). */
  queryExecutions(accountId: string, q: ExecutionQuery): Paginated<Execution> {
    const where: string[] = ['account_id = ?'];
    const args: (string | number)[] = [accountId];
    if (q.symbol) { where.push('symbol = ?'); args.push(q.symbol.toUpperCase()); }
    if (q.side) { where.push('side = ?'); args.push(q.side); }
    if (q.range?.from !== undefined) { where.push('timestamp >= ?'); args.push(q.range.from); }
    if (q.range?.to !== undefined) { where.push('timestamp <= ?'); args.push(q.range.to); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM executions ${whereSql}`).get(...args) as { n: number }).n);
    const col = ({ timestamp: 'timestamp', symbol: 'symbol', price: 'price', quantity: 'quantity' } as const)[q.sortBy ?? 'timestamp'];
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db
      .prepare(`SELECT * FROM executions ${whereSql} ORDER BY ${col} ${dir}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as Record<string, unknown>[];
    return paginate(rows.map(rowToExecution), q.limit, q.offset, total);
  }

  importCsv(
    accountId: string,
    csvText: string,
    opts: { mapping?: ColumnMapping; defaults?: ImportDefaults } = {},
  ): { imported: number; errors: RowError[] } {
    const defaults = { ...opts.defaults, account: accountId };
    const { executions, errors } = importExecutionsFromCsv(csvText, { mapping: opts.mapping, defaults });
    const forAccount = executions.map(({ accountId: _drop, ...rest }) => rest);
    this.addExecutions(accountId, forAccount);
    return { imported: forAccount.length, errors };
  }

  // ---- trades (derived) + annotations ----
  getTrades(accountId: string, range?: DateRange): Trade[] {
    const trades = buildTrades(this.listExecutions(accountId));
    const annRows = this.db.prepare('SELECT trade_id,data FROM trade_annotations').all() as {
      trade_id: string; data: string;
    }[];
    const annById = new Map(annRows.map((r) => [r.trade_id, JSON.parse(r.data) as TradeAnnotations]));
    const withAnn = trades.map((t) => (annById.has(t.id) ? applyAnnotations(t, annById.get(t.id)!) : t));
    return filterByRange(withAnn, range);
  }

  getTradeById(accountId: string, tradeId: string): Trade | null {
    return this.getTrades(accountId).find((t) => t.id === tradeId) ?? null;
  }

  /**
   * Server-side filtered/sorted/paginated trades. Symbol/date filters are pushed
   * to SQL on the underlying executions before trades are built, so the full
   * execution set is not loaded when a symbol is specified; trade-level filters
   * (direction/status/strategy/tag) are then applied to the derived trades.
   */
  queryTrades(accountId: string, q: TradeQuery): Paginated<Trade> {
    const execs = q.symbol
      ? (this.db.prepare('SELECT * FROM executions WHERE account_id=? AND symbol=? ORDER BY timestamp, id')
          .all(accountId, q.symbol.toUpperCase()) as Record<string, unknown>[]).map(rowToExecution)
      : this.listExecutions(accountId);
    const annRows = this.db.prepare('SELECT trade_id,data FROM trade_annotations').all() as { trade_id: string; data: string }[];
    const annById = new Map(annRows.map((r) => [r.trade_id, JSON.parse(r.data) as TradeAnnotations]));
    let trades = buildTrades(execs).map((t) => (annById.has(t.id) ? applyAnnotations(t, annById.get(t.id)!) : t));

    trades = filterByRange(trades, q.range);
    if (q.direction) trades = trades.filter((t) => t.direction === q.direction);
    if (q.status === 'open') trades = trades.filter((t) => t.open);
    if (q.status === 'closed') trades = trades.filter((t) => !t.open);
    if (q.strategyId) trades = trades.filter((t) => t.annotations?.strategyId === q.strategyId);
    if (q.playbookId) trades = trades.filter((t) => t.annotations?.playbookId === q.playbookId);
    if (q.tag) trades = trades.filter((t) => (t.annotations?.tags ?? []).includes(q.tag!));
    if (q.search) {
      const term = q.search.toLowerCase();
      trades = trades.filter((t) => `${t.symbol} ${t.annotations?.setup ?? ''} ${(t.annotations?.tags ?? []).join(' ')}`.toLowerCase().includes(term));
    }

    const dir = q.sortDir === 'asc' ? 1 : -1;
    const key = q.sortBy ?? 'closeTime';
    trades.sort((a, b) => {
      const cmp = tradeSortValue(a, key) < tradeSortValue(b, key) ? -1 : tradeSortValue(a, key) > tradeSortValue(b, key) ? 1 : 0;
      return cmp !== 0 ? cmp * dir : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // deterministic tiebreak
    });
    const total = trades.length;
    return paginate(trades.slice(q.offset, q.offset + q.limit), q.limit, q.offset, total);
  }

  setTradeAnnotation(tradeId: string, ann: TradeAnnotations): void {
    this.db
      .prepare(
        `INSERT INTO trade_annotations (trade_id,data) VALUES (?,?)
         ON CONFLICT(trade_id) DO UPDATE SET data=excluded.data`,
      )
      .run(tradeId, JSON.stringify(ann));
  }

  getStats(accountId: string, range?: DateRange): TradeStats {
    return computeStats(this.getTrades(accountId, range));
  }
  getHealthScore(accountId: string, range?: DateRange): HealthScore {
    return healthScore(this.getTrades(accountId, range));
  }
  getReport(
    accountId: string,
    dimension: ReportDimension,
    opts: { timeZone?: string; sortBy?: SortBy; range?: DateRange } = {},
  ): BreakdownRow[] {
    return report(this.getTrades(accountId, opts.range), dimension, opts);
  }
  getEquity(accountId: string, range?: DateRange): EquityPoint[] {
    const acct = this.getAccount(accountId);
    return equityCurve(this.getTrades(accountId, range), acct?.startingBalance ?? 0);
  }

  // ---- strategies (user-scoped) ----
  createStrategy(s: Omit<Strategy, 'id'> & { id?: string; userId?: string }): Strategy {
    const id = s.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO strategies (id,name,description,rules,user_id) VALUES (?,?,?,?,?)')
      .run(id, s.name, s.description ?? null, s.rules ? JSON.stringify(s.rules) : null, s.userId ?? null);
    return { id, name: s.name, description: s.description, rules: s.rules };
  }
  listStrategies(userId?: string): Strategy[] {
    const rows = userId
      ? this.db.prepare('SELECT * FROM strategies WHERE user_id=? ORDER BY name').all(userId)
      : this.db.prepare('SELECT * FROM strategies ORDER BY name').all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), name: String(r.name),
      description: r.description == null ? undefined : String(r.description),
      rules: r.rules == null ? undefined : (JSON.parse(String(r.rules)) as string[]),
    }));
  }

  // ---- tags (user-scoped) ----
  createTag(t: Omit<Tag, 'id'> & { id?: string; userId?: string }): Tag {
    const id = t.id ?? randomUUID();
    this.db.prepare('INSERT INTO tags (id,label,category,user_id) VALUES (?,?,?,?)').run(id, t.label, t.category, t.userId ?? null);
    return { id, label: t.label, category: t.category };
  }
  listTags(userId?: string): Tag[] {
    const rows = userId
      ? this.db.prepare('SELECT * FROM tags WHERE user_id=? ORDER BY label').all(userId)
      : this.db.prepare('SELECT * FROM tags ORDER BY label').all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), label: String(r.label), category: String(r.category) as Tag['category'],
    }));
  }

  // ---- journal ----
  upsertJournalEntry(j: Omit<JournalEntry, 'id'> & { id?: string }): JournalEntry {
    const id = j.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO journal_entries (id,account_id,date,body,rating) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET body=excluded.body, rating=excluded.rating`,
      )
      .run(id, j.accountId, j.date, j.body ?? null, j.rating ?? null);
    return { ...j, id };
  }
  listJournal(accountId: string): JournalEntry[] {
    return (this.db
      .prepare('SELECT * FROM journal_entries WHERE account_id=? ORDER BY date DESC')
      .all(accountId) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), accountId: String(r.account_id), date: String(r.date),
      body: r.body == null ? undefined : String(r.body),
      rating: r.rating == null ? undefined : Number(r.rating),
    }));
  }

  queryJournal(accountId: string, q: ListQuery & { from?: string; to?: string }): Paginated<JournalEntry> {
    const where: string[] = ['account_id = ?'];
    const args: (string | number)[] = [accountId];
    if (q.from) { where.push('date >= ?'); args.push(q.from); }
    if (q.to) { where.push('date <= ?'); args.push(q.to); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM journal_entries ${whereSql}`).get(...args) as { n: number }).n);
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db.prepare(`SELECT * FROM journal_entries ${whereSql} ORDER BY date ${dir}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as Record<string, unknown>[];
    return paginate(rows.map(rowToJournal), q.limit, q.offset, total);
  }

  // ---- balance transactions ----
  addBalanceTransaction(b: Omit<BalanceTransaction, 'id'> & { id?: string }): BalanceTransaction {
    const id = b.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO balance_transactions (id,account_id,timestamp,amount,kind,note) VALUES (?,?,?,?,?,?)')
      .run(id, b.accountId, b.timestamp, b.amount, b.kind, b.note ?? null);
    return { ...b, id };
  }
  listBalanceTransactions(accountId: string): BalanceTransaction[] {
    return (this.db
      .prepare('SELECT * FROM balance_transactions WHERE account_id=? ORDER BY timestamp')
      .all(accountId) as Record<string, unknown>[]).map(rowToBalanceTx);
  }
  queryBalanceTransactions(accountId: string, q: ListQuery & { range?: DateRange; kind?: string }): Paginated<BalanceTransaction> {
    const where: string[] = ['account_id = ?'];
    const args: (string | number)[] = [accountId];
    if (q.range?.from !== undefined) { where.push('timestamp >= ?'); args.push(q.range.from); }
    if (q.range?.to !== undefined) { where.push('timestamp <= ?'); args.push(q.range.to); }
    if (q.kind) { where.push('kind = ?'); args.push(q.kind); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM balance_transactions ${whereSql}`).get(...args) as { n: number }).n);
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db.prepare(`SELECT * FROM balance_transactions ${whereSql} ORDER BY timestamp ${dir}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as Record<string, unknown>[];
    return paginate(rows.map(rowToBalanceTx), q.limit, q.offset, total);
  }

  // ---- notes (notebook) ----
  upsertNote(n: Omit<Note, 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: number }): Note {
    const id = n.id ?? randomUUID();
    const now = Date.now();
    const existing = this.db.prepare('SELECT created_at FROM notes WHERE id=?').get(id) as { created_at: number } | undefined;
    const createdAt = existing?.created_at ?? n.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO notes (id,account_id,title,body,tags,trade_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body,
           tags=excluded.tags, trade_id=excluded.trade_id, updated_at=excluded.updated_at`,
      )
      .run(id, n.accountId, n.title, n.body ?? null, n.tags ? JSON.stringify(n.tags) : null,
        n.tradeId ?? null, createdAt, now);
    return { id, accountId: n.accountId, title: n.title, body: n.body, tags: n.tags, tradeId: n.tradeId, createdAt, updatedAt: now };
  }
  listNotes(accountId: string): Note[] {
    return (this.db
      .prepare('SELECT * FROM notes WHERE account_id=? ORDER BY updated_at DESC')
      .all(accountId) as Record<string, unknown>[]).map(rowToNote);
  }
  queryNotes(accountId: string, q: ListQuery & { search?: string; tag?: string }): Paginated<Note> {
    const where: string[] = ['account_id = ?'];
    const args: (string | number)[] = [accountId];
    if (q.search) { where.push('(title LIKE ? OR body LIKE ?)'); args.push(`%${q.search}%`, `%${q.search}%`); }
    if (q.tag) { where.push('tags LIKE ?'); args.push(`%${JSON.stringify(q.tag).slice(1, -1)}%`); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM notes ${whereSql}`).get(...args) as { n: number }).n);
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db.prepare(`SELECT * FROM notes ${whereSql} ORDER BY updated_at ${dir}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as Record<string, unknown>[];
    return paginate(rows.map(rowToNote), q.limit, q.offset, total);
  }
  getNote(id: string): Note | null {
    const r = this.db.prepare('SELECT * FROM notes WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToNote(r) : null;
  }
  deleteNote(id: string): boolean {
    const info = this.db.prepare('DELETE FROM notes WHERE id=?').run(id);
    return Number(info.changes) > 0;
  }

  // ---- saved filters (user-scoped; Stage 3) ----
  createSavedFilter(userId: string, scope: SavedFilterScope, name: string, definition: Record<string, unknown>): SavedFilter {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO saved_filters (id,user_id,scope,name,definition,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, userId, scope, name, JSON.stringify(definition), now, now);
    return { id, userId, scope, name, definition, createdAt: now, updatedAt: now };
  }
  listSavedFilters(userId: string, scope?: SavedFilterScope): SavedFilter[] {
    const rows = scope
      ? this.db.prepare('SELECT * FROM saved_filters WHERE user_id=? AND scope=? ORDER BY name').all(userId, scope)
      : this.db.prepare('SELECT * FROM saved_filters WHERE user_id=? ORDER BY scope, name').all(userId);
    return (rows as Record<string, unknown>[]).map(rowToSavedFilter);
  }
  getSavedFilter(id: string): SavedFilter | null {
    const r = this.db.prepare('SELECT * FROM saved_filters WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToSavedFilter(r) : null;
  }
  updateSavedFilter(id: string, patch: { name?: string; definition?: Record<string, unknown> }): SavedFilter | null {
    const existing = this.getSavedFilter(id);
    if (!existing) return null;
    const name = patch.name ?? existing.name;
    const definition = patch.definition ?? existing.definition;
    const now = Date.now();
    this.db.prepare('UPDATE saved_filters SET name=?, definition=?, updated_at=? WHERE id=?')
      .run(name, JSON.stringify(definition), now, id);
    return { ...existing, name, definition, updatedAt: now };
  }
  deleteSavedFilter(id: string): boolean {
    const info = this.db.prepare('DELETE FROM saved_filters WHERE id=?').run(id);
    return Number(info.changes) > 0;
  }

  // ---- progress goals (user-scoped and account-scoped; M6.1) ----
  createGoal(userId: string, accountId: string, g: { metric: GoalMetric; period: GoalPeriod; direction: GoalDirection; target: number }): Goal {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO goals (id,user_id,account_id,metric,period,direction,target,status,start_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, userId, accountId, g.metric, g.period, g.direction, g.target, 'active', now, now, now);
    return { id, userId, accountId, metric: g.metric, period: g.period, direction: g.direction, target: g.target, status: 'active', startAt: now, createdAt: now, updatedAt: now };
  }
  listGoals(userId: string, accountId: string): Goal[] {
    return (this.db.prepare('SELECT * FROM goals WHERE user_id=? AND account_id=? ORDER BY created_at').all(userId, accountId) as Record<string, unknown>[]).map(rowToGoal);
  }
  getGoal(id: string): Goal | null {
    const r = this.db.prepare('SELECT * FROM goals WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToGoal(r) : null;
  }
  updateGoal(id: string, patch: { target?: number; direction?: GoalDirection; period?: GoalPeriod; metric?: GoalMetric; status?: GoalStatus }): Goal | null {
    const g = this.getGoal(id);
    if (!g) return null;
    const next: Goal = {
      ...g,
      target: patch.target ?? g.target,
      direction: patch.direction ?? g.direction,
      period: patch.period ?? g.period,
      metric: patch.metric ?? g.metric,
      status: patch.status ?? g.status,
      updatedAt: Date.now(),
    };
    this.db.prepare('UPDATE goals SET metric=?, period=?, direction=?, target=?, status=?, updated_at=? WHERE id=?')
      .run(next.metric, next.period, next.direction, next.target, next.status, next.updatedAt, id);
    return next;
  }
  /** Reset moves the goal's start to now (fresh progress/history) and reactivates it. */
  resetGoal(id: string): Goal | null {
    const g = this.getGoal(id);
    if (!g) return null;
    const now = Date.now();
    this.db.prepare('UPDATE goals SET start_at=?, status=?, updated_at=? WHERE id=?').run(now, 'active', now, id);
    return { ...g, startAt: now, status: 'active', updatedAt: now };
  }
  deleteGoal(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM goals WHERE id=?').run(id).changes) > 0;
  }
  /** Goals for an account with live progress derived from the canonical engine. */
  goalsWithProgress(userId: string, accountId: string, tz = 'UTC', now = Date.now()): (Goal & { progress: GoalProgress })[] {
    const goals = this.listGoals(userId, accountId);
    if (goals.length === 0) return [];
    const trades = this.getTrades(accountId);
    const journal = this.listJournal(accountId);
    return goals.map((g) => ({ ...g, progress: evaluateGoal(g, trades, journal, tz, now) }));
  }

  // ---- playbooks (user-scoped; M6.2) ----
  createPlaybook(userId: string, p: PlaybookData): Playbook {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO playbooks (id,user_id,name,description,market,symbols,direction,timeframe,category,
        entry_criteria,confirmation_signals,invalidation_conditions,stop_rules,target_rules,risk_rules,
        checklist,review_prompts,examples,notes,refs,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, userId, p.name, p.description ?? null, p.market ?? null, jstr(p.symbols), p.direction ?? null,
      p.timeframe ?? null, p.category ?? null, p.entryCriteria ?? null, p.confirmationSignals ?? null,
      p.invalidationConditions ?? null, p.stopRules ?? null, p.targetRules ?? null, p.riskRules ?? null,
      jstr(p.checklist), jstr(p.reviewPrompts), p.examples ?? null, p.notes ?? null, jstr(p.references),
      'active', now, now,
    );
    return this.getPlaybook(id)!;
  }
  listPlaybooks(userId: string, opts: { status?: PlaybookStatus; search?: string; sort?: 'name' | 'created' | 'updated' } = {}): Playbook[] {
    const where: string[] = ['user_id = ?'];
    const args: (string | number)[] = [userId];
    if (opts.status) { where.push('status = ?'); args.push(opts.status); }
    if (opts.search) { where.push('name LIKE ?'); args.push(`%${opts.search}%`); }
    const order = opts.sort === 'created' ? 'created_at DESC' : opts.sort === 'updated' ? 'updated_at DESC' : 'name COLLATE NOCASE';
    return (this.db.prepare(`SELECT * FROM playbooks WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...args) as Record<string, unknown>[]).map(rowToPlaybook);
  }
  getPlaybook(id: string): Playbook | null {
    const r = this.db.prepare('SELECT * FROM playbooks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToPlaybook(r) : null;
  }
  updatePlaybook(id: string, patch: Partial<PlaybookData>): Playbook | null {
    const cur = this.getPlaybook(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.db.prepare(
      `UPDATE playbooks SET name=?, description=?, market=?, symbols=?, direction=?, timeframe=?, category=?,
        entry_criteria=?, confirmation_signals=?, invalidation_conditions=?, stop_rules=?, target_rules=?, risk_rules=?,
        checklist=?, review_prompts=?, examples=?, notes=?, refs=?, updated_at=? WHERE id=?`,
    ).run(
      n.name, n.description ?? null, n.market ?? null, jstr(n.symbols), n.direction ?? null, n.timeframe ?? null,
      n.category ?? null, n.entryCriteria ?? null, n.confirmationSignals ?? null, n.invalidationConditions ?? null,
      n.stopRules ?? null, n.targetRules ?? null, n.riskRules ?? null, jstr(n.checklist), jstr(n.reviewPrompts),
      n.examples ?? null, n.notes ?? null, jstr(n.references), Date.now(), id,
    );
    return this.getPlaybook(id);
  }
  setPlaybookStatus(id: string, status: PlaybookStatus): Playbook | null {
    const cur = this.getPlaybook(id);
    if (!cur) return null;
    this.db.prepare('UPDATE playbooks SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id);
    return this.getPlaybook(id);
  }
  deletePlaybook(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM playbooks WHERE id=?').run(id).changes) > 0;
  }
  /** Count trades (owned by the user, across their accounts) linked to a playbook. */
  countLinkedTrades(userId: string, playbookId: string): number {
    const rows = this.db.prepare('SELECT trade_id FROM trade_annotations WHERE data LIKE ?')
      .all(`%"playbookId":"${playbookId}"%`) as { trade_id: string }[];
    let n = 0;
    for (const r of rows) {
      const accountId = r.trade_id.split(':')[0] ?? '';
      if (this.getAccountOwner(accountId) === userId) n += 1;
    }
    return n;
  }
  /** Behavioral insights over an account's trades in a range (canonical, heuristic). */
  getInsights(accountId: string, opts: { range?: DateRange; tz?: string; thresholds?: Partial<InsightThresholds> } = {}): InsightsResult {
    const trades = this.getTrades(accountId, opts.range);
    const journal = this.listJournal(accountId);
    return computeInsights(trades, journal, opts.tz ?? 'UTC', opts.thresholds ?? {});
  }

  /** Playbook analytics over a single account's linked trades (canonical engine). */
  getPlaybookAnalytics(accountId: string, playbookId: string, tz = 'UTC'): PlaybookAnalytics | null {
    const pb = this.getPlaybook(playbookId);
    if (!pb) return null;
    const linked = this.getTrades(accountId).filter((t) => t.annotations?.playbookId === playbookId);
    return playbookAnalytics(linked, pb, tz);
  }

  // ---- prop-firm accounts and ledger (user-scoped; M6.4) ----
  createPropAccount(userId: string, p: PropAccountData): PropAccount {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO prop_accounts (id,user_id,firm,program,account_size,status,phase,profit_target,max_drawdown,
        daily_loss_limit,trading_account_id,started_at,notes,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, userId, p.firm, p.program ?? null, p.accountSize ?? null, p.status ?? 'evaluation', p.phase ?? null,
      p.profitTarget ?? null, p.maxDrawdown ?? null, p.dailyLossLimit ?? null, p.tradingAccountId ?? null,
      p.startedAt ?? null, p.notes ?? null, now, now);
    return this.getPropAccount(id)!;
  }
  listPropAccounts(userId: string, opts: { status?: PropAccountStatus } = {}): PropAccount[] {
    const rows = opts.status
      ? this.db.prepare('SELECT * FROM prop_accounts WHERE user_id=? AND status=? ORDER BY created_at DESC').all(userId, opts.status)
      : this.db.prepare('SELECT * FROM prop_accounts WHERE user_id=? ORDER BY created_at DESC').all(userId);
    return (rows as Record<string, unknown>[]).map(rowToPropAccount);
  }
  getPropAccount(id: string): PropAccount | null {
    const r = this.db.prepare('SELECT * FROM prop_accounts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToPropAccount(r) : null;
  }
  updatePropAccount(id: string, patch: Partial<PropAccountData>): PropAccount | null {
    const cur = this.getPropAccount(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.db.prepare(
      `UPDATE prop_accounts SET firm=?, program=?, account_size=?, status=?, phase=?, profit_target=?, max_drawdown=?,
        daily_loss_limit=?, trading_account_id=?, started_at=?, notes=?, updated_at=? WHERE id=?`,
    ).run(n.firm, n.program ?? null, n.accountSize ?? null, n.status, n.phase ?? null, n.profitTarget ?? null,
      n.maxDrawdown ?? null, n.dailyLossLimit ?? null, n.tradingAccountId ?? null, n.startedAt ?? null, n.notes ?? null, Date.now(), id);
    return this.getPropAccount(id);
  }
  /** Delete a prop account and its own cash-flow ledger (which is user-entered, not trade history). */
  deletePropAccount(id: string): boolean {
    this.db.prepare('DELETE FROM prop_transactions WHERE prop_account_id=?').run(id);
    return Number(this.db.prepare('DELETE FROM prop_accounts WHERE id=?').run(id).changes) > 0;
  }
  addPropTransaction(userId: string, propAccountId: string, t: { timestamp?: number; amount: number; kind: PropTransactionKind; note?: string }): PropTransaction {
    const id = randomUUID();
    const now = Date.now();
    const ts = t.timestamp ?? now;
    this.db.prepare('INSERT INTO prop_transactions (id,user_id,prop_account_id,timestamp,amount,kind,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, userId, propAccountId, ts, t.amount, t.kind, t.note ?? null, now);
    return { id, userId, propAccountId, timestamp: ts, amount: t.amount, kind: t.kind, note: t.note, createdAt: now };
  }
  listPropTransactions(propAccountId: string): PropTransaction[] {
    return (this.db.prepare('SELECT * FROM prop_transactions WHERE prop_account_id=? ORDER BY timestamp DESC, created_at DESC').all(propAccountId) as Record<string, unknown>[]).map(rowToPropTransaction);
  }
  getPropTransaction(id: string): PropTransaction | null {
    const r = this.db.prepare('SELECT * FROM prop_transactions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToPropTransaction(r) : null;
  }
  deletePropTransaction(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM prop_transactions WHERE id=?').run(id).changes) > 0;
  }
  propAccountTotals(propAccountId: string): PropAccountTotals {
    return accountTotals(propAccountId, this.listPropTransactions(propAccountId));
  }
  getPropSummary(userId: string): PropSummary {
    const accounts = this.listPropAccounts(userId);
    const txns = (this.db.prepare('SELECT * FROM prop_transactions WHERE user_id=?').all(userId) as Record<string, unknown>[]).map(rowToPropTransaction);
    return propSummary(accounts, txns);
  }

  /** Current balance = starting balance + realized net P&L + balance transactions. */
  getAccountBalance(accountId: string): number {
    const acct = this.getAccount(accountId);
    if (!acct) throw new Error(`unknown account ${accountId}`);
    const net = this.getStats(accountId).netPnl;
    const txns = this.listBalanceTransactions(accountId).reduce((a, t) => a + t.amount, 0);
    return Math.round((acct.startingBalance + net + txns) * 1e6) / 1e6;
  }
}

export interface DateRange { from?: number; to?: number }

export interface PageMeta { limit: number; offset: number; total: number; hasMore: boolean }
export interface Paginated<T> { items: T[]; page: PageMeta }
export interface ListQuery { limit: number; offset: number; sortDir?: 'asc' | 'desc' }
export interface ExecutionQuery extends ListQuery {
  range?: DateRange; symbol?: string; side?: 'buy' | 'sell';
  sortBy?: 'timestamp' | 'symbol' | 'price' | 'quantity';
}
export type TradeSortKey = 'closeTime' | 'openTime' | 'symbol' | 'netPnl' | 'rMultiple' | 'quantity';
export interface TradeQuery extends ListQuery {
  range?: DateRange; symbol?: string; direction?: 'long' | 'short';
  status?: 'open' | 'closed'; strategyId?: string; playbookId?: string; tag?: string; search?: string;
  sortBy?: TradeSortKey;
}

function paginate<T>(items: T[], limit: number, offset: number, total: number): Paginated<T> {
  return { items, page: { limit, offset, total, hasMore: offset + items.length < total } };
}
function tradeSortValue(t: Trade, key: TradeSortKey): number | string {
  switch (key) {
    case 'symbol': return t.symbol;
    case 'netPnl': return t.netPnl;
    case 'rMultiple': return t.rMultiple ?? -Infinity;
    case 'quantity': return t.quantity;
    case 'openTime': return t.openTime;
    case 'closeTime':
    default: return t.closeTime ?? t.openTime;
  }
}

export interface UserRecord { id: string; email: string; passwordHash: string; createdAt: number }
export type SavedFilterScope = 'trades' | 'reports';
export interface SavedFilter {
  id: string; userId: string; scope: SavedFilterScope; name: string;
  definition: Record<string, unknown>; createdAt: number; updatedAt: number;
}

/** Writable playbook fields (everything except server-managed id/userId/status/timestamps). */
export type PlaybookData = Omit<Playbook, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>;

/** Writable prop-account fields; status is optional on create (defaults to evaluation). */
export type PropAccountData = Omit<PropAccount, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'> & { status?: PropAccountStatus };

function rowToPropAccount(r: Record<string, unknown>): PropAccount {
  const n = (v: unknown): number | undefined => (v == null ? undefined : Number(v));
  const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  return {
    id: String(r.id), userId: String(r.user_id), firm: String(r.firm), program: s(r.program),
    accountSize: n(r.account_size), status: String(r.status) as PropAccountStatus, phase: s(r.phase),
    profitTarget: n(r.profit_target), maxDrawdown: n(r.max_drawdown), dailyLossLimit: n(r.daily_loss_limit),
    tradingAccountId: s(r.trading_account_id), startedAt: n(r.started_at), notes: s(r.notes),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToPropTransaction(r: Record<string, unknown>): PropTransaction {
  return {
    id: String(r.id), userId: String(r.user_id), propAccountId: String(r.prop_account_id),
    timestamp: Number(r.timestamp), amount: Number(r.amount), kind: String(r.kind) as PropTransactionKind,
    note: r.note == null ? undefined : String(r.note), createdAt: Number(r.created_at),
  };
}

const jstr = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const jparse = <T>(v: unknown): T | undefined => (v == null ? undefined : (JSON.parse(String(v)) as T));

function rowToPlaybook(r: Record<string, unknown>): Playbook {
  const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  return {
    id: String(r.id), userId: String(r.user_id), name: String(r.name),
    description: s(r.description), market: s(r.market), symbols: jparse<string[]>(r.symbols),
    direction: s(r.direction) as Playbook['direction'], timeframe: s(r.timeframe), category: s(r.category),
    entryCriteria: s(r.entry_criteria), confirmationSignals: s(r.confirmation_signals),
    invalidationConditions: s(r.invalidation_conditions), stopRules: s(r.stop_rules),
    targetRules: s(r.target_rules), riskRules: s(r.risk_rules),
    checklist: jparse<Playbook['checklist']>(r.checklist), reviewPrompts: jparse<Playbook['reviewPrompts']>(r.review_prompts),
    examples: s(r.examples), notes: s(r.notes), references: jparse<Playbook['references']>(r.refs),
    status: String(r.status) as PlaybookStatus, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToGoal(r: Record<string, unknown>): Goal {
  return {
    id: String(r.id), userId: String(r.user_id), accountId: String(r.account_id),
    metric: String(r.metric) as Goal['metric'], period: String(r.period) as Goal['period'],
    direction: String(r.direction) as Goal['direction'], target: Number(r.target),
    status: String(r.status) as Goal['status'], startAt: Number(r.start_at),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToUser(r: Record<string, unknown>): UserRecord {
  return { id: String(r.id), email: String(r.email), passwordHash: String(r.password_hash), createdAt: Number(r.created_at) };
}
function rowToSavedFilter(r: Record<string, unknown>): SavedFilter {
  return {
    id: String(r.id), userId: String(r.user_id), scope: String(r.scope) as SavedFilterScope,
    name: String(r.name), definition: JSON.parse(String(r.definition)) as Record<string, unknown>,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

/** Keep trades whose close (or open, if still open) falls within [from, to]. */
function filterByRange(trades: Trade[], range?: DateRange): Trade[] {
  if (!range || (range.from === undefined && range.to === undefined)) return trades;
  return trades.filter((t) => {
    const ts = t.closeTime ?? t.openTime;
    if (range.from !== undefined && ts < range.from) return false;
    if (range.to !== undefined && ts > range.to) return false;
    return true;
  });
}

function rowToAccount(r: Record<string, unknown>): Account {
  return {
    id: String(r.id), name: String(r.name), currency: String(r.currency),
    startingBalance: Number(r.starting_balance), kind: String(r.kind) as Account['kind'],
  };
}
function rowToNote(r: Record<string, unknown>): Note {
  return {
    id: String(r.id), accountId: String(r.account_id), title: String(r.title),
    body: r.body == null ? undefined : String(r.body),
    tags: r.tags == null ? undefined : (JSON.parse(String(r.tags)) as string[]),
    tradeId: r.trade_id == null ? undefined : String(r.trade_id),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToJournal(r: Record<string, unknown>): JournalEntry {
  return {
    id: String(r.id), accountId: String(r.account_id), date: String(r.date),
    body: r.body == null ? undefined : String(r.body),
    rating: r.rating == null ? undefined : Number(r.rating),
  };
}
function rowToBalanceTx(r: Record<string, unknown>): BalanceTransaction {
  return {
    id: String(r.id), accountId: String(r.account_id), timestamp: Number(r.timestamp),
    amount: Number(r.amount), kind: String(r.kind) as BalanceTransaction['kind'],
    note: r.note == null ? undefined : String(r.note),
  };
}
function rowToExecution(r: Record<string, unknown>): Execution {
  return {
    id: String(r.id), accountId: String(r.account_id), symbol: String(r.symbol),
    instrumentType: String(r.instrument_type) as Execution['instrumentType'],
    side: String(r.side) as Execution['side'], quantity: Number(r.quantity), price: Number(r.price),
    timestamp: Number(r.timestamp), multiplier: Number(r.multiplier),
    commission: Number(r.commission), fees: Number(r.fees), swap: Number(r.swap),
  };
}
