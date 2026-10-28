/**
 * REST API over Node's built-in http server - no framework dependency.
 *
 * Stage 1 security model: bearer-token auth. Every route except /health and the
 * /auth/{register,login} endpoints requires a valid session token. All
 * account-scoped resources (and their nested routes - executions, import, trades,
 * stats, reports, journal, balance, notes, annotations) are authorized by account
 * ownership: a request for an account the caller does not own returns 404, so IDs
 * cannot be probed. Strategies, tags and saved filters are user-scoped.
 */
import http from 'node:http';
import type { Repository, SavedFilterScope } from '../db/repository.js';
import type { ReportDimension, SortBy } from '../analytics/reports.js';
import type { ImportDefaults } from '../import/genericCsv.js';
import type { GoalMetric, GoalPeriod, GoalDirection, GoalStatus } from '../domain/types.js';
import { METRIC_DEFS, validateGoalTarget } from '../analytics/progress.js';
import { hashPassword, verifyPassword, newToken } from '../auth/password.js';

const SESSION_TTL_MS = 30 * 24 * 3600_000; // 30 days

interface Ctx {
  repo: Repository;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  res: http.ServerResponse;
  userId: string; // guaranteed non-empty for non-public routes
}
type Handler = (c: Ctx) => void | Promise<void>;
interface Route { method: string; pattern: RegExp; handler: Handler; public?: boolean }

const json = (res: http.ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};
const ok = (c: Ctx, payload: unknown): void => json(c.res, 200, payload);
const created = (c: Ctx, payload: unknown): void => json(c.res, 201, payload);
const notFound = (c: Ctx, msg = 'not found'): void => json(c.res, 404, { error: msg });
const badRequest = (c: Ctx, msg: string): void => json(c.res, 400, { error: msg });
const conflict = (c: Ctx, msg: string): void => json(c.res, 409, { error: msg });
const unauthorized = (c: Ctx, msg = 'authentication required'): void => json(c.res, 401, { error: msg });

const VALID_DIMENSIONS: ReportDimension[] = [
  'day', 'week', 'month', 'dayOfWeek', 'hourOfDay', 'symbol', 'strategy', 'setup', 'tag', 'duration',
];

function parseRange(c: Ctx): { from?: number; to?: number } {
  const toMs = (v: string | null): number | undefined => {
    if (!v) return undefined;
    if (/^\d+$/.test(v)) return Number(v);
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  };
  const range: { from?: number; to?: number } = {};
  const from = toMs(c.query.get('from'));
  const to = toMs(c.query.get('to'));
  if (from !== undefined) range.from = from;
  if (to !== undefined) range.to = to;
  return range;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** Parse & validate limit/offset/sortDir. Returns an error string if invalid. */
function parseList(c: Ctx): { limit: number; offset: number; sortDir: 'asc' | 'desc' } | { error: string } {
  const limRaw = c.query.get('limit');
  const offRaw = c.query.get('offset');
  const dirRaw = c.query.get('dir');
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (limRaw !== null) {
    if (!/^\d+$/.test(limRaw)) return { error: 'limit must be a non-negative integer' };
    limit = Number(limRaw);
    if (limit < 1 || limit > MAX_LIMIT) return { error: `limit must be between 1 and ${MAX_LIMIT}` };
  }
  if (offRaw !== null) {
    if (!/^\d+$/.test(offRaw)) return { error: 'offset must be a non-negative integer' };
    offset = Number(offRaw);
  }
  if (dirRaw !== null && dirRaw !== 'asc' && dirRaw !== 'desc') return { error: "dir must be 'asc' or 'desc'" };
  return { limit, offset, sortDir: (dirRaw as 'asc' | 'desc' | null) ?? 'desc' };
}

const TRADE_SORTS = ['closeTime', 'openTime', 'symbol', 'netPnl', 'rMultiple', 'quantity'] as const;
const EXEC_SORTS = ['timestamp', 'symbol', 'price', 'quantity'] as const;

/** Account must exist AND be owned by the caller, else 404 (prevents ID probing). */
function requireOwner(c: Ctx): boolean {
  const id = c.params.id!;
  if (!c.repo.getAccount(id) || c.repo.getAccountOwner(id) !== c.userId) {
    notFound(c, 'account not found');
    return false;
  }
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const routes: Route[] = [
  { method: 'GET', pattern: /^\/health$/, public: true, handler: (c) => ok(c, { ok: true }) },

  // ---- auth ----
  { method: 'POST', pattern: /^\/auth\/register$/, public: true, handler: (c) => {
      const b = c.body as any;
      const email = typeof b?.email === 'string' ? b.email.trim() : '';
      const password = typeof b?.password === 'string' ? b.password : '';
      if (!EMAIL_RE.test(email)) return badRequest(c, 'a valid email is required');
      if (password.length < 8) return badRequest(c, 'password must be at least 8 characters');
      if (c.repo.getUserByEmail(email)) return conflict(c, 'an account with this email already exists');
      const user = c.repo.createUser(email, hashPassword(password));
      const session = c.repo.createSession(user.id, newToken(), SESSION_TTL_MS);
      created(c, { user: { id: user.id, email: user.email }, token: session.token, expiresAt: session.expiresAt });
    } },
  { method: 'POST', pattern: /^\/auth\/login$/, public: true, handler: (c) => {
      const b = c.body as any;
      const email = typeof b?.email === 'string' ? b.email : '';
      const password = typeof b?.password === 'string' ? b.password : '';
      const user = c.repo.getUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) return unauthorized(c, 'invalid email or password');
      const session = c.repo.createSession(user.id, newToken(), SESSION_TTL_MS);
      ok(c, { user: { id: user.id, email: user.email }, token: session.token, expiresAt: session.expiresAt });
    } },
  { method: 'POST', pattern: /^\/auth\/logout$/, handler: (c) => {
      const token = (c as unknown as { token?: string }).token;
      if (token) c.repo.deleteSession(token);
      ok(c, { ok: true });
    } },
  { method: 'GET', pattern: /^\/auth\/me$/, handler: (c) => {
      const u = c.repo.getUserById(c.userId);
      return u ? ok(c, { id: u.id, email: u.email }) : unauthorized(c);
    } },

  // ---- accounts ----
  { method: 'GET', pattern: /^\/accounts$/, handler: (c) => ok(c, c.repo.listAccounts(c.userId)) },
  { method: 'POST', pattern: /^\/accounts$/, handler: (c) => {
      const b = c.body as any;
      if (!b?.name || !b?.currency) return badRequest(c, 'name and currency are required');
      created(c, c.repo.createAccount({
        name: b.name, currency: b.currency,
        startingBalance: Number(b.startingBalance ?? 0), kind: b.kind ?? 'live', userId: c.userId,
      }));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)$/, handler: (c) => {
      if (!requireOwner(c)) return;
      ok(c, c.repo.getAccount(c.params.id!));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/balance$/, handler: (c) => {
      if (!requireOwner(c)) return;
      ok(c, { accountId: c.params.id, balance: c.repo.getAccountBalance(c.params.id!) });
    } },

  // ---- executions ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/executions$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const lp = parseList(c);
      if ('error' in lp) return badRequest(c, lp.error);
      const sortBy = c.query.get('sort');
      if (sortBy && !(EXEC_SORTS as readonly string[]).includes(sortBy)) return badRequest(c, `sort must be one of: ${EXEC_SORTS.join(', ')}`);
      const side = c.query.get('side');
      if (side && side !== 'buy' && side !== 'sell') return badRequest(c, "side must be 'buy' or 'sell'");
      ok(c, c.repo.queryExecutions(c.params.id!, {
        ...lp, range: parseRange(c),
        ...(c.query.get('symbol') ? { symbol: c.query.get('symbol')! } : {}),
        ...(side ? { side: side as 'buy' | 'sell' } : {}),
        ...(sortBy ? { sortBy: sortBy as 'timestamp' | 'symbol' | 'price' | 'quantity' } : {}),
      }));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/executions$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const list = Array.isArray(c.body) ? c.body : null;
      if (!list) return badRequest(c, 'expected a JSON array of executions');
      ok(c, c.repo.addExecutions(c.params.id!, list as any));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/import$/, handler: (c) => {
      if (!requireOwner(c)) return;
      let csv: string;
      let defaults: ImportDefaults | undefined;
      if (typeof c.body === 'string') csv = c.body;
      else if (c.body && typeof (c.body as any).csv === 'string') {
        csv = (c.body as any).csv;
        defaults = (c.body as any).defaults;
      } else return badRequest(c, 'provide CSV as text body or {csv, defaults?}');
      created(c, c.repo.importCsv(c.params.id!, csv, { defaults }));
    } },

  // ---- derived views ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/trades$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const lp = parseList(c);
      if ('error' in lp) return badRequest(c, lp.error);
      const sortBy = c.query.get('sort');
      if (sortBy && !(TRADE_SORTS as readonly string[]).includes(sortBy)) return badRequest(c, `sort must be one of: ${TRADE_SORTS.join(', ')}`);
      const direction = c.query.get('direction');
      if (direction && direction !== 'long' && direction !== 'short') return badRequest(c, "direction must be 'long' or 'short'");
      const status = c.query.get('status');
      if (status && status !== 'open' && status !== 'closed') return badRequest(c, "status must be 'open' or 'closed'");
      ok(c, c.repo.queryTrades(c.params.id!, {
        ...lp, range: parseRange(c),
        ...(c.query.get('symbol') ? { symbol: c.query.get('symbol')! } : {}),
        ...(direction ? { direction: direction as 'long' | 'short' } : {}),
        ...(status ? { status: status as 'open' | 'closed' } : {}),
        ...(c.query.get('strategy') ? { strategyId: c.query.get('strategy')! } : {}),
        ...(c.query.get('playbook') ? { playbookId: c.query.get('playbook')! } : {}),
        ...(c.query.get('tag') ? { tag: c.query.get('tag')! } : {}),
        ...(c.query.get('q') ? { search: c.query.get('q')! } : {}),
        ...(sortBy ? { sortBy: sortBy as import('../db/repository.js').TradeSortKey } : {}),
      }));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/trades\/(?<tradeId>[^/]+)$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const t = c.repo.getTradeById(c.params.id!, decodeURIComponent(c.params.tradeId!));
      return t ? ok(c, t) : notFound(c, 'trade not found');
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/stats$/, handler: (c) => {
      if (!requireOwner(c)) return;
      ok(c, serializeStats(c.repo.getStats(c.params.id!, parseRange(c)) as unknown as Record<string, unknown>));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/health-score$/, handler: (c) => {
      if (!requireOwner(c)) return;
      ok(c, c.repo.getHealthScore(c.params.id!, parseRange(c)));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/equity$/, handler: (c) => {
      if (!requireOwner(c)) return;
      ok(c, c.repo.getEquity(c.params.id!, parseRange(c)));
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/reports$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const by = c.query.get('by') as ReportDimension | null;
      if (!by || !VALID_DIMENSIONS.includes(by)) {
        return badRequest(c, `query 'by' must be one of: ${VALID_DIMENSIONS.join(', ')}`);
      }
      const timeZone = c.query.get('tz') ?? 'UTC';
      const sortBy = (c.query.get('sort') as SortBy | null) ?? undefined;
      const rows = c.repo.getReport(c.params.id!, by, { timeZone, range: parseRange(c), ...(sortBy ? { sortBy } : {}) });
      ok(c, rows.map((r) => ({ ...r, stats: serializeStats(r.stats as unknown as Record<string, unknown>) })));
    } },

  // ---- notebook notes ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/notes$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const lp = parseList(c);
      if ('error' in lp) return badRequest(c, lp.error);
      ok(c, c.repo.queryNotes(c.params.id!, {
        ...lp, ...(c.query.get('q') ? { search: c.query.get('q')! } : {}), ...(c.query.get('tag') ? { tag: c.query.get('tag')! } : {}),
      }));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/notes$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const b = c.body as any;
      if (!b?.title) return badRequest(c, 'title is required');
      created(c, c.repo.upsertNote({ accountId: c.params.id!, title: b.title, body: b.body, tags: b.tags, tradeId: b.tradeId, id: b.id }));
    } },
  { method: 'PUT', pattern: /^\/notes\/(?<noteId>[^/]+)$/, handler: (c) => {
      const existing = c.repo.getNote(decodeURIComponent(c.params.noteId!));
      if (!existing || c.repo.getAccountOwner(existing.accountId) !== c.userId) return notFound(c, 'note not found');
      const b = c.body as any;
      ok(c, c.repo.upsertNote({
        id: existing.id, accountId: existing.accountId,
        title: b?.title ?? existing.title, body: b?.body ?? existing.body,
        tags: b?.tags ?? existing.tags, tradeId: b?.tradeId ?? existing.tradeId,
      }));
    } },
  { method: 'DELETE', pattern: /^\/notes\/(?<noteId>[^/]+)$/, handler: (c) => {
      const existing = c.repo.getNote(decodeURIComponent(c.params.noteId!));
      if (!existing || c.repo.getAccountOwner(existing.accountId) !== c.userId) return notFound(c, 'note not found');
      ok(c, { deleted: c.repo.deleteNote(existing.id) });
    } },

  // ---- trade annotations (ownership derived from the trade id's account prefix) ----
  { method: 'PUT', pattern: /^\/trades\/(?<tradeId>[^/]+)\/annotations$/, handler: (c) => {
      if (!c.body || typeof c.body !== 'object') return badRequest(c, 'expected annotation object');
      const tradeId = decodeURIComponent(c.params.tradeId!);
      const accountId = tradeId.split(':')[0] ?? '';
      if (c.repo.getAccountOwner(accountId) !== c.userId) return notFound(c, 'trade not found');
      if (!c.repo.getTrades(accountId).some((t) => t.id === tradeId)) return notFound(c, 'trade not found');
      // A playbook association may only reference a playbook the caller owns.
      const pbId = (c.body as any).playbookId;
      if (pbId !== undefined && pbId !== null && pbId !== '') {
        const pb = c.repo.getPlaybook(String(pbId));
        if (!pb || pb.userId !== c.userId) return badRequest(c, 'unknown playbook');
      }
      c.repo.setTradeAnnotation(tradeId, c.body as any);
      ok(c, { tradeId, annotations: c.body });
    } },

  // ---- journal ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/journal$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const lp = parseList(c);
      if ('error' in lp) return badRequest(c, lp.error);
      const from = c.query.get('from');
      const to = c.query.get('to');
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) return badRequest(c, 'journal from/to must be YYYY-MM-DD');
      ok(c, c.repo.queryJournal(c.params.id!, { ...lp, ...(from ? { from } : {}), ...(to ? { to } : {}) }));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/journal$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const b = c.body as any;
      if (!b?.date) return badRequest(c, 'date (YYYY-MM-DD) is required');
      created(c, c.repo.upsertJournalEntry({ accountId: c.params.id!, date: b.date, body: b.body, rating: b.rating, id: b.id }));
    } },

  // ---- balance transactions ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/balance-transactions$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const lp = parseList(c);
      if ('error' in lp) return badRequest(c, lp.error);
      ok(c, c.repo.queryBalanceTransactions(c.params.id!, {
        ...lp, range: parseRange(c), ...(c.query.get('kind') ? { kind: c.query.get('kind')! } : {}),
      }));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/balance-transactions$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const b = c.body as any;
      if (typeof b?.amount !== 'number' || !b?.kind) return badRequest(c, 'amount (number) and kind are required');
      created(c, c.repo.addBalanceTransaction({
        accountId: c.params.id!, timestamp: Number(b.timestamp ?? Date.now()),
        amount: b.amount, kind: b.kind, note: b.note,
      }));
    } },

  // ---- strategies & tags (user-scoped) ----
  { method: 'GET', pattern: /^\/strategies$/, handler: (c) => ok(c, c.repo.listStrategies(c.userId)) },
  { method: 'POST', pattern: /^\/strategies$/, handler: (c) => {
      const b = c.body as any;
      if (!b?.name) return badRequest(c, 'name is required');
      created(c, c.repo.createStrategy({ name: b.name, description: b.description, rules: b.rules, id: b.id, userId: c.userId }));
    } },
  { method: 'GET', pattern: /^\/tags$/, handler: (c) => ok(c, c.repo.listTags(c.userId)) },
  { method: 'POST', pattern: /^\/tags$/, handler: (c) => {
      const b = c.body as any;
      if (!b?.label || !b?.category) return badRequest(c, 'label and category are required');
      created(c, c.repo.createTag({ label: b.label, category: b.category, id: b.id, userId: c.userId }));
    } },

  // ---- saved filters (user-scoped) ----
  { method: 'GET', pattern: /^\/saved-filters$/, handler: (c) => {
      const scope = c.query.get('scope');
      if (scope && scope !== 'trades' && scope !== 'reports') return badRequest(c, "scope must be 'trades' or 'reports'");
      ok(c, c.repo.listSavedFilters(c.userId, (scope as SavedFilterScope | null) ?? undefined));
    } },
  { method: 'POST', pattern: /^\/saved-filters$/, handler: (c) => {
      const b = c.body as any;
      if (b?.scope !== 'trades' && b?.scope !== 'reports') return badRequest(c, "scope must be 'trades' or 'reports'");
      if (typeof b?.name !== 'string' || !b.name.trim()) return badRequest(c, 'name is required');
      const err = validateFilterDefinition(b.scope, b.definition);
      if (err) return badRequest(c, err);
      created(c, c.repo.createSavedFilter(c.userId, b.scope, b.name.trim(), b.definition));
    } },
  { method: 'PUT', pattern: /^\/saved-filters\/(?<fid>[^/]+)$/, handler: (c) => {
      const existing = c.repo.getSavedFilter(decodeURIComponent(c.params.fid!));
      if (!existing || existing.userId !== c.userId) return notFound(c, 'saved filter not found');
      const b = c.body as any;
      if (b?.definition !== undefined) {
        const err = validateFilterDefinition(existing.scope, b.definition);
        if (err) return badRequest(c, err);
      }
      if (b?.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) return badRequest(c, 'name must be a non-empty string');
      const patch: { name?: string; definition?: Record<string, unknown> } = {};
      if (b?.name !== undefined) patch.name = b.name.trim();
      if (b?.definition !== undefined) patch.definition = b.definition;
      ok(c, c.repo.updateSavedFilter(existing.id, patch));
    } },
  { method: 'DELETE', pattern: /^\/saved-filters\/(?<fid>[^/]+)$/, handler: (c) => {
      const existing = c.repo.getSavedFilter(decodeURIComponent(c.params.fid!));
      if (!existing || existing.userId !== c.userId) return notFound(c, 'saved filter not found');
      ok(c, { deleted: c.repo.deleteSavedFilter(existing.id) });
    } },

  // ---- progress goals (user-scoped, account-scoped; M6.1) ----
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/goals$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const tz = c.query.get('tz') ?? 'UTC';
      ok(c, c.repo.goalsWithProgress(c.userId, c.params.id!, tz));
    } },
  { method: 'POST', pattern: /^\/accounts\/(?<id>[^/]+)\/goals$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const b = c.body as any;
      const metric = b?.metric as GoalMetric;
      if (!metric || !(metric in METRIC_DEFS)) return badRequest(c, `metric must be one of: ${Object.keys(METRIC_DEFS).join(', ')}`);
      const period = b?.period as GoalPeriod;
      if (!GOAL_PERIODS.includes(period)) return badRequest(c, "period must be 'daily', 'weekly' or 'monthly'");
      const direction = (b?.direction as GoalDirection) ?? METRIC_DEFS[metric].defaultDirection;
      const err = validateGoalTarget(metric, direction, b?.target);
      if (err) return badRequest(c, err);
      created(c, c.repo.createGoal(c.userId, c.params.id!, { metric, period, direction, target: b.target }));
    } },
  { method: 'PUT', pattern: /^\/goals\/(?<goalId>[^/]+)$/, handler: (c) => {
      const g = c.repo.getGoal(decodeURIComponent(c.params.goalId!));
      if (!g || g.userId !== c.userId) return notFound(c, 'goal not found');
      const b = c.body as any;
      const patch: { target?: number; direction?: GoalDirection; period?: GoalPeriod; metric?: GoalMetric; status?: GoalStatus } = {};
      const metric = (b?.metric as GoalMetric) ?? g.metric;
      if (b?.metric !== undefined && !(metric in METRIC_DEFS)) return badRequest(c, 'invalid metric');
      const direction = (b?.direction as GoalDirection) ?? g.direction;
      if (b?.period !== undefined && !GOAL_PERIODS.includes(b.period)) return badRequest(c, "period must be 'daily', 'weekly' or 'monthly'");
      if (b?.status !== undefined && b.status !== 'active' && b.status !== 'paused') return badRequest(c, "status must be 'active' or 'paused'");
      if (b?.metric !== undefined || b?.direction !== undefined || b?.target !== undefined) {
        const target = b?.target ?? g.target;
        const err = validateGoalTarget(metric, direction, target);
        if (err) return badRequest(c, err);
        patch.metric = metric; patch.direction = direction; patch.target = target;
      }
      if (b?.period !== undefined) patch.period = b.period;
      if (b?.status !== undefined) patch.status = b.status;
      ok(c, c.repo.updateGoal(g.id, patch));
    } },
  { method: 'POST', pattern: /^\/goals\/(?<goalId>[^/]+)\/reset$/, handler: (c) => {
      const g = c.repo.getGoal(decodeURIComponent(c.params.goalId!));
      if (!g || g.userId !== c.userId) return notFound(c, 'goal not found');
      ok(c, c.repo.resetGoal(g.id));
    } },
  { method: 'DELETE', pattern: /^\/goals\/(?<goalId>[^/]+)$/, handler: (c) => {
      const g = c.repo.getGoal(decodeURIComponent(c.params.goalId!));
      if (!g || g.userId !== c.userId) return notFound(c, 'goal not found');
      ok(c, { deleted: c.repo.deleteGoal(g.id) });
    } },

  // ---- playbooks (user-scoped; M6.2) ----
  { method: 'GET', pattern: /^\/playbooks$/, handler: (c) => {
      const statusQ = c.query.get('status');
      if (statusQ && statusQ !== 'active' && statusQ !== 'archived') return badRequest(c, "status must be 'active' or 'archived'");
      const sortQ = c.query.get('sort');
      const sort = sortQ === 'created' || sortQ === 'updated' ? sortQ : 'name';
      ok(c, c.repo.listPlaybooks(c.userId, {
        ...(statusQ ? { status: statusQ as 'active' | 'archived' } : {}),
        ...(c.query.get('q') ? { search: c.query.get('q')! } : {}),
        sort,
      }));
    } },
  { method: 'POST', pattern: /^\/playbooks$/, handler: (c) => {
      const data = parsePlaybookBody(c.body, true);
      if ('error' in data) return badRequest(c, data.error);
      created(c, c.repo.createPlaybook(c.userId, data.value));
    } },
  { method: 'GET', pattern: /^\/playbooks\/(?<pid>[^/]+)$/, handler: (c) => {
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      ok(c, { ...pb, linkedTradeCount: c.repo.countLinkedTrades(c.userId, pb.id) });
    } },
  { method: 'PUT', pattern: /^\/playbooks\/(?<pid>[^/]+)$/, handler: (c) => {
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      const data = parsePlaybookBody(c.body, false);
      if ('error' in data) return badRequest(c, data.error);
      ok(c, c.repo.updatePlaybook(pb.id, data.value));
    } },
  { method: 'POST', pattern: /^\/playbooks\/(?<pid>[^/]+)\/archive$/, handler: (c) => {
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      ok(c, c.repo.setPlaybookStatus(pb.id, 'archived'));
    } },
  { method: 'POST', pattern: /^\/playbooks\/(?<pid>[^/]+)\/restore$/, handler: (c) => {
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      ok(c, c.repo.setPlaybookStatus(pb.id, 'active'));
    } },
  { method: 'DELETE', pattern: /^\/playbooks\/(?<pid>[^/]+)$/, handler: (c) => {
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      const linked = c.repo.countLinkedTrades(c.userId, pb.id);
      if (linked > 0) return conflict(c, `playbook has ${linked} linked trade(s); archive it or unassign those trades before deleting`);
      ok(c, { deleted: c.repo.deletePlaybook(pb.id) });
    } },
  { method: 'GET', pattern: /^\/accounts\/(?<id>[^/]+)\/playbooks\/(?<pid>[^/]+)\/analytics$/, handler: (c) => {
      if (!requireOwner(c)) return;
      const pb = c.repo.getPlaybook(decodeURIComponent(c.params.pid!));
      if (!pb || pb.userId !== c.userId) return notFound(c, 'playbook not found');
      const tz = c.query.get('tz') ?? 'UTC';
      const a = c.repo.getPlaybookAnalytics(c.params.id!, pb.id, tz)!;
      ok(c, {
        ...a,
        stats: serializeStats(a.stats as unknown as Record<string, unknown>),
        bySymbol: a.bySymbol.map((r) => ({ ...r, stats: serializeStats(r.stats as unknown as Record<string, unknown>) })),
        byDirection: a.byDirection.map((r) => ({ ...r, stats: serializeStats(r.stats as unknown as Record<string, unknown>) })),
        byMonth: a.byMonth.map((r) => ({ ...r, stats: serializeStats(r.stats as unknown as Record<string, unknown>) })),
      });
    } },
];

const PLAYBOOK_DIRECTIONS = ['long', 'short', 'both'];

/** Validate and extract writable playbook fields. On create, name is required. */
function parsePlaybookBody(body: unknown, requireName: boolean): { value: any } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'expected a playbook object' };
  const b = body as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
  if (requireName && (typeof b.name !== 'string' || !b.name.trim())) return { error: 'name is required' };
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) return { error: 'name must be a non-empty string' };
  if (b.direction !== undefined && b.direction !== null && !PLAYBOOK_DIRECTIONS.includes(String(b.direction))) return { error: "direction must be 'long', 'short' or 'both'" };
  if (b.symbols !== undefined && !Array.isArray(b.symbols)) return { error: 'symbols must be an array of strings' };
  for (const key of ['checklist', 'reviewPrompts'] as const) {
    if (b[key] !== undefined) {
      if (!Array.isArray(b[key])) return { error: `${key} must be an array of { id, label }` };
      for (const it of b[key] as unknown[]) {
        if (typeof it !== 'object' || it === null || typeof (it as any).label !== 'string') return { error: `${key} items need a label` };
      }
    }
  }
  const value: Record<string, unknown> = {};
  if (b.name !== undefined) value.name = (b.name as string).trim();
  for (const k of ['description', 'market', 'timeframe', 'category', 'entryCriteria', 'confirmationSignals',
    'invalidationConditions', 'stopRules', 'targetRules', 'riskRules', 'examples', 'notes'] as const) {
    const v = str(k); if (v !== undefined) value[k] = v;
  }
  if (b.direction !== undefined) value.direction = b.direction === null ? undefined : String(b.direction);
  if (b.symbols !== undefined) value.symbols = (b.symbols as unknown[]).map(String);
  if (b.checklist !== undefined) value.checklist = (b.checklist as any[]).map((it, i) => ({ id: String(it.id ?? `c${i}`), label: String(it.label) }));
  if (b.reviewPrompts !== undefined) value.reviewPrompts = (b.reviewPrompts as any[]).map((it, i) => ({ id: String(it.id ?? `r${i}`), label: String(it.label) }));
  if (Array.isArray(b.references)) value.references = b.references;
  return { value };
}

const GOAL_PERIODS: GoalPeriod[] = ['daily', 'weekly', 'monthly'];

// Allowed keys per saved-filter scope - anything else is rejected so unsupported
// query parameters can never be persisted. All values must be strings.
const TRADE_FILTER_KEYS = new Set(['symbol', 'direction', 'status', 'strategyId', 'tag', 'search', 'sortBy', 'sortDir', 'rangePreset']);
const REPORT_FILTER_KEYS = new Set(['dimension', 'sortBy', 'rangePreset']);
function validateFilterDefinition(scope: SavedFilterScope, def: unknown): string | null {
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return 'definition must be an object';
  const allowed = scope === 'trades' ? TRADE_FILTER_KEYS : REPORT_FILTER_KEYS;
  for (const [k, v] of Object.entries(def)) {
    if (!allowed.has(k)) return `unsupported filter key: ${k}`;
    if (v !== undefined && v !== null && typeof v !== 'string') return `filter '${k}' must be a string`;
  }
  return null;
}

function serializeStats(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    out[k] = typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
  }
  return out;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return { __parseError: true }; }
  }
  return raw;
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? h[0] ?? '' : h);
  return m ? m[1]!.trim() : null;
}

export function createApi(repo: Repository): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = (req.method ?? 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
      if (body && (body as any).__parseError) return json(res, 400, { error: 'invalid JSON body' });

      const token = bearer(req);
      const userId = token ? repo.getSessionUserId(token) : null;

      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        if (!r.public && !userId) return json(res, 401, { error: 'authentication required' });
        const ctx = { repo, params: m.groups ?? {}, query: url.searchParams, body, res, userId: userId ?? '', token } as Ctx;
        await r.handler(ctx);
        return;
      }
      json(res, 404, { error: `no route for ${method} ${url.pathname}` });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
    }
  });
}
