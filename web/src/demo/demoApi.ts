/**
 * Demo mode (EXPLICIT only). Deterministic seed data is run through the SAME pure
 * engine modules the backend uses (@core/*), so demo statistics are identical to
 * what the server would compute. Demo mutations live in memory and reset on reload.
 * This is never used as a silent fallback for a failed API call.
 */
import { buildTrades, applyAnnotations } from '@core/metrics/trade.js';
import { computeStats, equityCurve } from '@core/metrics/stats.js';
import { healthScore } from '@core/metrics/healthScore.js';
import { report } from '@core/analytics/reports.js';
import { importExecutionsFromCsv } from '@core/import/genericCsv.js';
import { evaluateGoal, METRIC_DEFS } from '@core/analytics/progress.js';
import { playbookAnalytics } from '@core/analytics/playbook.js';
import { computeInsights } from '@core/analytics/insights.js';
import type { Execution as CoreExecution } from '@core/domain/types.js';
import type {
  Goal, GoalWithProgress, GoalInput, GoalPatch,
  Playbook, PlaybookDetail, PlaybookData, PlaybookListOpts, PlaybookAnalytics,
} from '../api/types.js';

const DEMO_PLAYBOOK_ID = 'demo-pb-1';
import type {
  Api, Account, Execution, ExecutionInput, Trade, TradeStats, HealthScore, EquityPoint,
  BreakdownRow, ReportDimension, SortBy, DateRange, JournalEntry, Note, BalanceTransaction,
  Strategy, Tag, ImportResult, TradeAnnotations, InstrumentType,
  Paginated, ListOpts, TradeQueryOpts, ExecutionQueryOpts, SavedFilter, SavedFilterScope,
} from '../api/types.js';

function paginate<T>(all: T[], o?: ListOpts): Paginated<T> {
  const limit = o?.limit ?? 50;
  const offset = o?.offset ?? 0;
  return { items: all.slice(offset, offset + limit), page: { limit, offset, total: all.length, hasMore: offset + limit < all.length } };
}

const DEMO_ACCOUNT_ID = 'demo-account';

// Small deterministic PRNG (mulberry32) seeded once - stable across reloads.
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SymbolSpec { symbol: string; type: InstrumentType; price: number; mult: number; tick: number }
const SYMBOLS: SymbolSpec[] = [
  { symbol: 'AAPL', type: 'stock', price: 180, mult: 1, tick: 0.01 },
  { symbol: 'TSLA', type: 'stock', price: 240, mult: 1, tick: 0.01 },
  { symbol: 'ES', type: 'future', price: 5000, mult: 50, tick: 0.25 },
  { symbol: 'NQ', type: 'future', price: 17500, mult: 20, tick: 0.25 },
  { symbol: 'EURUSD', type: 'forex', price: 1.08, mult: 100000, tick: 0.0001 },
];
const SETUPS = ['ORB', 'Pullback', 'Breakout', 'Reversal', 'Trend'];
const TAGS = ['morning', 'afternoon', 'A+', 'news', 'scalp'];

function seedExecutions(): CoreExecution[] {
  const rand = rng(12345);
  const execs: CoreExecution[] = [];
  const start = Date.parse('2024-01-02T14:30:00Z');
  const dayMs = 24 * 3600_000;
  let eid = 0;
  let day = 0;
  for (let i = 0; i < 60; i++) {
    // advance 0-2 days, skipping weekends roughly
    day += 1 + Math.floor(rand() * 2);
    const base = start + day * dayMs + Math.floor(rand() * 5) * 3600_000;
    const spec = SYMBOLS[Math.floor(rand() * SYMBOLS.length)]!;
    const long = rand() > 0.42;
    const qty = spec.type === 'future' ? 1 + Math.floor(rand() * 3) : spec.type === 'forex' ? 1 : 25 + Math.floor(rand() * 75);
    const win = rand() > 0.44;
    const moveTicks = (4 + Math.floor(rand() * 40)) * (win ? 1 : -1);
    const entry = spec.price * (1 + (rand() - 0.5) * 0.02);
    const exit = long ? entry + moveTicks * spec.tick : entry - moveTicks * spec.tick;
    const comm = spec.type === 'future' ? 2.1 * qty : spec.type === 'forex' ? 0 : 1;
    execs.push({
      id: `d${eid++}`, accountId: DEMO_ACCOUNT_ID, symbol: spec.symbol, instrumentType: spec.type,
      side: long ? 'buy' : 'sell', quantity: qty, price: round(entry, spec.tick), timestamp: base,
      multiplier: spec.mult, commission: comm, fees: 0, swap: 0,
    });
    execs.push({
      id: `d${eid++}`, accountId: DEMO_ACCOUNT_ID, symbol: spec.symbol, instrumentType: spec.type,
      side: long ? 'sell' : 'buy', quantity: qty, price: round(exit, spec.tick), timestamp: base + (10 + Math.floor(rand() * 180)) * 60_000,
      multiplier: spec.mult, commission: comm, fees: 0, swap: 0,
    });
  }
  return execs;
}
const round = (n: number, tick: number): number => Math.round(n / tick) * tick;

function inf(n: number): number | 'Infinity' | '-Infinity' | 'NaN' {
  return Number.isFinite(n) ? n : (String(n) as 'Infinity' | '-Infinity' | 'NaN');
}
function statsToApi(s: ReturnType<typeof computeStats>): TradeStats {
  return { ...s, profitFactor: inf(s.profitFactor), payoffRatio: inf(s.payoffRatio), recoveryFactor: inf(s.recoveryFactor) } as unknown as TradeStats;
}
function inRange(t: Trade, range?: DateRange): boolean {
  if (!range) return true;
  const ts = t.closeTime ?? t.openTime;
  if (range.from !== undefined && ts < range.from) return false;
  if (range.to !== undefined && ts > range.to) return false;
  return true;
}

export function createDemoApi(): Api {
  const accounts: Account[] = [
    { id: DEMO_ACCOUNT_ID, name: 'Demo Account', currency: 'USD', startingBalance: 25000, kind: 'live' },
  ];
  const executions = new Map<string, CoreExecution[]>([[DEMO_ACCOUNT_ID, seedExecutions()]]);
  const annotations = new Map<string, TradeAnnotations>();
  const journal: JournalEntry[] = [];
  const notes: Note[] = [
    { id: 'demo-note-1', accountId: DEMO_ACCOUNT_ID, title: 'Trading plan', body: 'Only trade A+ setups before 11:00. Max 3 trades/day.', tags: ['plan'], createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 },
  ];
  const balanceTx: BalanceTransaction[] = [];
  const strategies: Strategy[] = SETUPS.map((s, i) => ({ id: `strat-${i}`, name: s, rules: [`Follow the ${s} rules`] }));
  const tags: Tag[] = TAGS.map((t, i) => ({ id: `tag-${i}`, label: t, category: 'custom' as const }));
  const savedFilters: SavedFilter[] = [];
  const nowSeed = Date.now();
  const goals: Goal[] = [
    { id: 'demo-goal-1', userId: 'demo', accountId: DEMO_ACCOUNT_ID, metric: 'net_pnl', period: 'weekly', direction: 'at_least', target: 1000, status: 'active', startAt: nowSeed - 60 * 86400000, createdAt: nowSeed, updatedAt: nowSeed },
    { id: 'demo-goal-2', userId: 'demo', accountId: DEMO_ACCOUNT_ID, metric: 'journaled_day_rate', period: 'weekly', direction: 'at_least', target: 80, status: 'active', startAt: nowSeed - 60 * 86400000, createdAt: nowSeed, updatedAt: nowSeed },
  ];

  const playbooks: Playbook[] = [
    {
      id: DEMO_PLAYBOOK_ID, userId: 'demo', name: 'Opening Range Breakout',
      description: 'Break and hold of the opening range on strong relative volume.',
      direction: 'long', timeframe: '5m', category: 'Momentum',
      entryCriteria: 'Price breaks the first 5-minute range high and holds above it.',
      confirmationSignals: 'Above VWAP, rising volume.',
      invalidationConditions: 'Close back inside the range.',
      stopRules: 'Below the range low.', targetRules: 'First target at 2R.',
      riskRules: 'Risk at most 1 percent of the account per trade.',
      checklist: [{ id: 'c0', label: 'News and events checked' }, { id: 'c1', label: 'Above VWAP' }, { id: 'c2', label: 'Volume rising' }],
      reviewPrompts: [{ id: 'r0', label: 'Did I follow the plan?' }, { id: 'r1', label: 'Was the stop respected?' }],
      status: 'active', createdAt: nowSeed - 40 * 86400000, updatedAt: nowSeed - 2 * 86400000,
    },
  ];

  // Seed some annotations deterministically against derived trade ids.
  const rand = rng(999);
  const seededTrades = buildTrades(executions.get(DEMO_ACCOUNT_ID)!);
  for (const t of seededTrades) {
    if (rand() > 0.3) {
      const linksPlaybook = rand() > 0.45;
      annotations.set(t.id, {
        setup: SETUPS[Math.floor(rand() * SETUPS.length)],
        tags: [TAGS[Math.floor(rand() * TAGS.length)]!],
        rating: rand() > 0.5 ? 1 : rand() > 0.5 ? 0 : -1,
        stopLoss: t.avgEntryPrice * (t.direction === 'long' ? 0.99 : 1.01),
        ...(linksPlaybook ? {
          playbookId: DEMO_PLAYBOOK_ID,
          playbookChecklist: { c0: true, c1: rand() > 0.3, c2: rand() > 0.5 },
          playbookReviewDone: rand() > 0.4,
        } : {}),
      });
    }
  }

  const trades = (accountId: string, range?: DateRange): Trade[] => {
    const raw = buildTrades(executions.get(accountId) ?? []);
    return raw
      .map((t) => (annotations.has(t.id) ? applyAnnotations(t, annotations.get(t.id)!) : t) as unknown as Trade)
      .filter((t) => inRange(t, range));
  };
  const coreTrades = (accountId: string, range?: DateRange) =>
    trades(accountId, range) as unknown as Parameters<typeof computeStats>[0];

  const delay = <T>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 120));

  return {
    listAccounts: () => delay([...accounts]),
    createAccount: (input) => {
      const a: Account = { id: `demo-${accounts.length}`, name: input.name, currency: input.currency, startingBalance: input.startingBalance ?? 0, kind: input.kind ?? 'live' };
      accounts.push(a); executions.set(a.id, []); return delay(a);
    },
    getBalance: (id) => {
      const acct = accounts.find((a) => a.id === id)!;
      const net = computeStats(coreTrades(id)).netPnl;
      const tx = balanceTx.filter((b) => b.accountId === id).reduce((s, b) => s + b.amount, 0);
      return delay({ accountId: id, balance: Math.round((acct.startingBalance + net + tx) * 1e6) / 1e6 });
    },
    listExecutions: (id, o?: ExecutionQueryOpts) => {
      let list = (executions.get(id) ?? []).map((e) => ({ ...e })) as Execution[];
      if (o?.symbol) list = list.filter((e) => e.symbol === o.symbol!.toUpperCase());
      if (o?.side) list = list.filter((e) => e.side === o.side);
      if (o?.range?.from !== undefined) list = list.filter((e) => e.timestamp >= o.range!.from!);
      if (o?.range?.to !== undefined) list = list.filter((e) => e.timestamp <= o.range!.to!);
      list.sort((a, b) => (a.timestamp - b.timestamp) * (o?.sortDir === 'asc' ? 1 : -1));
      return delay(paginate(list, o));
    },
    addExecutions: (id, execs: ExecutionInput[]) => {
      const list = executions.get(id) ?? [];
      const added = execs.map((e, i) => ({ ...e, id: `n${list.length + i}`, accountId: id })) as CoreExecution[];
      executions.set(id, [...list, ...added]);
      return delay(added as unknown as Execution[]);
    },
    importCsv: (id, csv, defaults) => {
      const { executions: ex, errors } = importExecutionsFromCsv(csv, { defaults: { ...defaults, account: id } });
      const list = executions.get(id) ?? [];
      executions.set(id, [...list, ...(ex.map(({ accountId: _a, ...rest }) => ({ ...rest, accountId: id, id: `i${list.length}-${rest.symbol}-${rest.timestamp}` })) as CoreExecution[])]);
      return delay({ imported: ex.length, errors } as ImportResult);
    },
    queryTrades: (id, o?: TradeQueryOpts) => {
      let list = trades(id, o?.range);
      if (o?.symbol) list = list.filter((t) => t.symbol === o.symbol!.toUpperCase());
      if (o?.direction) list = list.filter((t) => t.direction === o.direction);
      if (o?.status === 'open') list = list.filter((t) => t.open);
      if (o?.status === 'closed') list = list.filter((t) => !t.open);
      if (o?.strategyId) list = list.filter((t) => t.annotations?.strategyId === o.strategyId);
      if (o?.playbookId) list = list.filter((t) => t.annotations?.playbookId === o.playbookId);
      if (o?.tag) list = list.filter((t) => (t.annotations?.tags ?? []).includes(o.tag!));
      if (o?.search) {
        const term = o.search.toLowerCase();
        list = list.filter((t) => `${t.symbol} ${t.annotations?.setup ?? ''} ${(t.annotations?.tags ?? []).join(' ')}`.toLowerCase().includes(term));
      }
      const key = o?.sortBy ?? 'closeTime';
      const dir = o?.sortDir === 'asc' ? 1 : -1;
      const val = (t: Trade): number | string => key === 'symbol' ? t.symbol : key === 'netPnl' ? t.netPnl
        : key === 'rMultiple' ? (t.rMultiple ?? -Infinity) : key === 'quantity' ? t.quantity
        : key === 'openTime' ? t.openTime : (t.closeTime ?? t.openTime);
      list.sort((a, b) => { const av = val(a), bv = val(b); const c = av < bv ? -1 : av > bv ? 1 : 0; return c !== 0 ? c * dir : (a.id < b.id ? -1 : 1); });
      return delay(paginate(list, o));
    },
    getTrade: (id, tradeId) => {
      const t = trades(id).find((x) => x.id === tradeId);
      if (!t) return Promise.reject(new Error('trade not found'));
      return delay(t);
    },
    getStats: (id, range) => delay(statsToApi(computeStats(coreTrades(id, range)))),
    getHealthScore: (id, range) => delay(healthScore(coreTrades(id, range)) as unknown as HealthScore),
    getEquity: (id, range) => {
      const acct = accounts.find((a) => a.id === id);
      return delay(equityCurve(coreTrades(id, range), acct?.startingBalance ?? 0) as EquityPoint[]);
    },
    getReport: (id, by: ReportDimension, opts) => {
      const rows = report(coreTrades(id, opts?.range), by, { timeZone: opts?.tz ?? 'UTC', ...(opts?.sortBy ? { sortBy: opts.sortBy as SortBy } : {}) });
      return delay(rows.map((r) => ({ ...r, stats: statsToApi(r.stats) })) as unknown as BreakdownRow[]);
    },
    setTradeAnnotation: (tradeId, ann) => { annotations.set(tradeId, { ...annotations.get(tradeId), ...ann }); return delay({ tradeId, annotations: ann }); },

    listJournal: (id, o?: ListOpts & { from?: string; to?: string }) => {
      let list = journal.filter((j) => j.accountId === id);
      if (o?.from) list = list.filter((j) => j.date >= o.from!);
      if (o?.to) list = list.filter((j) => j.date <= o.to!);
      list.sort((a, b) => a.date < b.date ? 1 : -1);
      return delay(paginate(list, o));
    },
    saveJournal: (id, entry) => {
      const existing = journal.find((j) => j.id === entry.id || (j.accountId === id && j.date === entry.date));
      if (existing) { Object.assign(existing, { body: entry.body, rating: entry.rating }); return delay(existing); }
      const j: JournalEntry = { id: entry.id ?? `j${journal.length}`, accountId: id, date: entry.date, body: entry.body, rating: entry.rating };
      journal.push(j); return delay(j);
    },
    listNotes: (id, o?: ListOpts & { search?: string; tag?: string }) => {
      let list = notes.filter((n) => n.accountId === id);
      if (o?.search) { const t = o.search.toLowerCase(); list = list.filter((n) => `${n.title} ${n.body ?? ''}`.toLowerCase().includes(t)); }
      if (o?.tag) list = list.filter((n) => (n.tags ?? []).includes(o.tag!));
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return delay(paginate(list, o));
    },
    saveNote: (id, note) => {
      if (note.id) {
        const n = notes.find((x) => x.id === note.id)!;
        Object.assign(n, { title: note.title, body: note.body, tags: note.tags, tradeId: note.tradeId, updatedAt: Date.now() });
        return delay(n);
      }
      const n: Note = { id: `note-${notes.length}`, accountId: id, title: note.title, body: note.body, tags: note.tags, tradeId: note.tradeId, createdAt: Date.now(), updatedAt: Date.now() };
      notes.push(n); return delay(n);
    },
    deleteNote: (noteId) => { const i = notes.findIndex((n) => n.id === noteId); if (i >= 0) notes.splice(i, 1); return delay({ deleted: i >= 0 }); },

    listBalanceTransactions: (id, o?: ListOpts & { kind?: string; range?: DateRange }) => {
      let list = balanceTx.filter((b) => b.accountId === id);
      if (o?.kind) list = list.filter((b) => b.kind === o.kind);
      if (o?.range?.from !== undefined) list = list.filter((b) => b.timestamp >= o.range!.from!);
      if (o?.range?.to !== undefined) list = list.filter((b) => b.timestamp <= o.range!.to!);
      list.sort((a, b) => (a.timestamp - b.timestamp) * (o?.sortDir === 'asc' ? 1 : -1));
      return delay(paginate(list, o));
    },
    addBalanceTransaction: (id, tx) => { const b: BalanceTransaction = { id: `bt${balanceTx.length}`, accountId: id, timestamp: tx.timestamp ?? Date.now(), amount: tx.amount, kind: tx.kind, note: tx.note }; balanceTx.push(b); return delay(b); },

    listStrategies: () => delay([...strategies]),
    createStrategy: (input) => { const s: Strategy = { id: `strat-${strategies.length}`, ...input }; strategies.push(s); return delay(s); },
    listTags: () => delay([...tags]),
    createTag: (input) => { const t: Tag = { id: `tag-${tags.length}`, ...input }; tags.push(t); return delay(t); },

    listSavedFilters: (scope: SavedFilterScope) => delay(savedFilters.filter((f) => f.scope === scope)),
    createSavedFilter: (scope, name, definition) => {
      const f: SavedFilter = { id: `sf-${savedFilters.length}`, userId: 'demo', scope, name, definition, createdAt: Date.now(), updatedAt: Date.now() };
      savedFilters.push(f); return delay(f);
    },
    updateSavedFilter: (id, patch) => {
      const f = savedFilters.find((x) => x.id === id);
      if (!f) return Promise.reject(new Error('not found'));
      if (patch.name !== undefined) f.name = patch.name;
      if (patch.definition !== undefined) f.definition = patch.definition;
      f.updatedAt = Date.now();
      return delay(f);
    },
    deleteSavedFilter: (id) => { const i = savedFilters.findIndex((x) => x.id === id); if (i >= 0) savedFilters.splice(i, 1); return delay({ deleted: i >= 0 }); },

    listGoals: (id, tz?: string) => {
      const t = trades(id);
      const jrn = journal.filter((jj) => jj.accountId === id);
      const now = Date.now();
      const out: GoalWithProgress[] = goals
        .filter((g) => g.accountId === id)
        .map((g) => ({ ...g, progress: evaluateGoal(g as never, t as never, jrn as never, tz ?? 'UTC', now) as unknown as GoalWithProgress['progress'] }));
      return delay(out);
    },
    createGoal: (id, input: GoalInput) => {
      const direction = input.direction ?? METRIC_DEFS[input.metric].defaultDirection;
      const now = Date.now();
      const g: Goal = { id: `goal-${goals.length}-${now}`, userId: 'demo', accountId: id, metric: input.metric, period: input.period, direction, target: input.target, status: 'active', startAt: now, createdAt: now, updatedAt: now };
      goals.push(g);
      return delay(g);
    },
    updateGoal: (goalId, patch: GoalPatch) => {
      const g = goals.find((x) => x.id === goalId);
      if (!g) return Promise.reject(new Error('goal not found'));
      if (patch.metric !== undefined) g.metric = patch.metric;
      if (patch.period !== undefined) g.period = patch.period;
      if (patch.direction !== undefined) g.direction = patch.direction;
      if (patch.target !== undefined) g.target = patch.target;
      if (patch.status !== undefined) g.status = patch.status;
      g.updatedAt = Date.now();
      return delay(g);
    },
    resetGoal: (goalId) => {
      const g = goals.find((x) => x.id === goalId);
      if (!g) return Promise.reject(new Error('goal not found'));
      g.startAt = Date.now(); g.status = 'active'; g.updatedAt = Date.now();
      return delay(g);
    },
    deleteGoal: (goalId) => { const i = goals.findIndex((x) => x.id === goalId); if (i >= 0) goals.splice(i, 1); return delay({ deleted: i >= 0 }); },

    listPlaybooks: (o?: PlaybookListOpts) => {
      let list = [...playbooks];
      if (o?.status) list = list.filter((p) => p.status === o.status);
      if (o?.search) { const s = o.search.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(s)); }
      list.sort((a, b) => o?.sort === 'created' ? b.createdAt - a.createdAt : o?.sort === 'updated' ? b.updatedAt - a.updatedAt : a.name.localeCompare(b.name));
      return delay(list);
    },
    getPlaybook: (pid) => {
      const p = playbooks.find((x) => x.id === pid);
      if (!p) return Promise.reject(new Error('playbook not found'));
      const linkedTradeCount = countLinked(pid);
      return delay({ ...p, linkedTradeCount } as PlaybookDetail);
    },
    createPlaybook: (data: PlaybookData) => {
      const now = Date.now();
      const p: Playbook = { ...data, id: `pb-${playbooks.length}-${now}`, userId: 'demo', status: 'active', createdAt: now, updatedAt: now };
      playbooks.push(p);
      return delay(p);
    },
    updatePlaybook: (pid, patch) => {
      const p = playbooks.find((x) => x.id === pid);
      if (!p) return Promise.reject(new Error('playbook not found'));
      Object.assign(p, patch, { updatedAt: Date.now() });
      return delay(p);
    },
    archivePlaybook: (pid) => { const p = playbooks.find((x) => x.id === pid)!; p.status = 'archived'; p.updatedAt = Date.now(); return delay(p); },
    restorePlaybook: (pid) => { const p = playbooks.find((x) => x.id === pid)!; p.status = 'active'; p.updatedAt = Date.now(); return delay(p); },
    deletePlaybook: (pid) => {
      if (countLinked(pid) > 0) return Promise.reject(new Error('playbook has linked trades; archive it or unassign those trades before deleting'));
      const i = playbooks.findIndex((x) => x.id === pid);
      if (i >= 0) playbooks.splice(i, 1);
      return delay({ deleted: i >= 0 });
    },
    getPlaybookAnalytics: (accountId, pid, tz?: string) => {
      const pb = playbooks.find((x) => x.id === pid);
      if (!pb) return Promise.reject(new Error('playbook not found'));
      const linked = trades(accountId).filter((t) => t.annotations?.playbookId === pid);
      const a = playbookAnalytics(linked as never, pb as never, tz ?? 'UTC');
      return delay({
        ...a,
        stats: statsToApi(a.stats),
        bySymbol: a.bySymbol.map((r) => ({ ...r, stats: statsToApi(r.stats) })),
        byDirection: a.byDirection.map((r) => ({ ...r, stats: statsToApi(r.stats) })),
        byMonth: a.byMonth.map((r) => ({ ...r, stats: statsToApi(r.stats) })),
      } as unknown as PlaybookAnalytics);
    },

    getInsights: (accountId, opts) => {
      const t = trades(accountId, opts?.range);
      const jrn = journal.filter((jj) => jj.accountId === accountId);
      return delay(computeInsights(t as never, jrn as never, opts?.tz ?? 'UTC', opts?.thresholds ?? {}) as unknown as import('../api/types.js').InsightsResult);
    },
  };

  function countLinked(pid: string): number {
    let n = 0;
    for (const acct of accounts) n += trades(acct.id).filter((t) => t.annotations?.playbookId === pid).length;
    return n;
  }
}
