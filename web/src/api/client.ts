import type {
  Api, Account, AccountKind, Execution, ExecutionInput, Trade, TradeStats, HealthScore,
  EquityPoint, BreakdownRow, ReportDimension, SortBy, DateRange, JournalEntry, Note,
  BalanceTransaction, Strategy, Tag, ImportResult, TradeAnnotations, InstrumentType,
  Paginated, ListOpts, TradeQueryOpts, ExecutionQueryOpts, SavedFilter, SavedFilterScope,
  Goal, GoalWithProgress, GoalInput, GoalPatch,
  Playbook, PlaybookDetail, PlaybookData, PlaybookListOpts, PlaybookAnalytics,
} from './types.js';

export class ApiError extends Error {
  constructor(public status: number, message: string, public url: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export function setAuthToken(token: string | null): void { authToken = token; }
export function setUnauthorizedHandler(fn: (() => void) | null): void { onUnauthorized = fn; }

function rangeQuery(range?: DateRange, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  if (range?.from !== undefined) p.set('from', String(range.from));
  if (range?.to !== undefined) p.set('to', String(range.to));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, isCsv = false): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = isCsv ? 'text/csv' : 'application/json';
  if (authToken) headers['authorization'] = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : isCsv ? (body as string) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Network error: could not reach ${url}`, url);
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const msg = parsed && typeof parsed === 'object' && 'error' in parsed
      ? String((parsed as { error: unknown }).error)
      : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, url);
  }
  return parsed as T;
}

export interface AuthUser { id: string; email: string }
export interface AuthResult { user: AuthUser; token: string; expiresAt: number }

export const auth = {
  register: (email: string, password: string) => request<AuthResult>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) => request<AuthResult>('POST', '/auth/login', { email, password }),
  me: () => request<AuthUser>('GET', '/auth/me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
};

export const httpApi: Api = {
  listAccounts: () => request<Account[]>('GET', '/accounts'),
  createAccount: (input) => request<Account>('POST', '/accounts', input),
  getBalance: (id) => request<{ accountId: string; balance: number }>('GET', `/accounts/${id}/balance`),

  listExecutions: (id, o?: ExecutionQueryOpts) => request<Paginated<Execution>>('GET', `/accounts/${id}/executions${qs({
    from: o?.range?.from, to: o?.range?.to, symbol: o?.symbol, side: o?.side,
    sort: o?.sortBy, dir: o?.sortDir, limit: o?.limit, offset: o?.offset,
  })}`),
  addExecutions: (id, execs) => request<Execution[]>('POST', `/accounts/${id}/executions`, execs),
  importCsv: (id, csv, defaults) =>
    defaults
      ? request<ImportResult>('POST', `/accounts/${id}/import`, { csv, defaults })
      : request<ImportResult>('POST', `/accounts/${id}/import`, csv, true),

  queryTrades: (id, o?: TradeQueryOpts) => request<Paginated<Trade>>('GET', `/accounts/${id}/trades${qs({
    from: o?.range?.from, to: o?.range?.to, symbol: o?.symbol, direction: o?.direction, status: o?.status,
    strategy: o?.strategyId, playbook: o?.playbookId, tag: o?.tag, q: o?.search, sort: o?.sortBy, dir: o?.sortDir, limit: o?.limit, offset: o?.offset,
  })}`),
  getTrade: (id, tradeId) => request<Trade>('GET', `/accounts/${id}/trades/${encodeURIComponent(tradeId)}`),
  getStats: (id, range) => request<TradeStats>('GET', `/accounts/${id}/stats${rangeQuery(range)}`),
  getHealthScore: (id, range) => request<HealthScore>('GET', `/accounts/${id}/health-score${rangeQuery(range)}`),
  getEquity: (id, range) => request<EquityPoint[]>('GET', `/accounts/${id}/equity${rangeQuery(range)}`),
  getReport: (id, by, opts) =>
    request<BreakdownRow[]>('GET', `/accounts/${id}/reports${rangeQuery(opts?.range, { by, sort: opts?.sortBy, tz: opts?.tz })}`),
  setTradeAnnotation: (tradeId, ann) =>
    request('PUT', `/trades/${encodeURIComponent(tradeId)}/annotations`, ann),

  listJournal: (id, o?: ListOpts & { from?: string; to?: string }) => request<Paginated<JournalEntry>>('GET', `/accounts/${id}/journal${qs({
    from: o?.from, to: o?.to, dir: o?.sortDir, limit: o?.limit, offset: o?.offset,
  })}`),
  saveJournal: (id, entry) => request<JournalEntry>('POST', `/accounts/${id}/journal`, entry),

  listNotes: (id, o?: ListOpts & { search?: string; tag?: string }) => request<Paginated<Note>>('GET', `/accounts/${id}/notes${qs({
    q: o?.search, tag: o?.tag, dir: o?.sortDir, limit: o?.limit, offset: o?.offset,
  })}`),
  saveNote: (id, note) =>
    note.id
      ? request<Note>('PUT', `/notes/${encodeURIComponent(note.id)}`, note)
      : request<Note>('POST', `/accounts/${id}/notes`, note),
  deleteNote: (noteId) => request<{ deleted: boolean }>('DELETE', `/notes/${encodeURIComponent(noteId)}`),

  listBalanceTransactions: (id, o?: ListOpts & { kind?: string; range?: DateRange }) => request<Paginated<BalanceTransaction>>('GET', `/accounts/${id}/balance-transactions${qs({
    from: o?.range?.from, to: o?.range?.to, kind: o?.kind, dir: o?.sortDir, limit: o?.limit, offset: o?.offset,
  })}`),
  addBalanceTransaction: (id, tx) => request<BalanceTransaction>('POST', `/accounts/${id}/balance-transactions`, tx),

  listStrategies: () => request<Strategy[]>('GET', '/strategies'),
  createStrategy: (input) => request<Strategy>('POST', '/strategies', input),
  listTags: () => request<Tag[]>('GET', '/tags'),
  createTag: (input) => request<Tag>('POST', '/tags', input),

  listSavedFilters: (scope: SavedFilterScope) => request<SavedFilter[]>('GET', `/saved-filters${qs({ scope })}`),
  createSavedFilter: (scope, name, definition) => request<SavedFilter>('POST', '/saved-filters', { scope, name, definition }),
  updateSavedFilter: (id, patch) => request<SavedFilter>('PUT', `/saved-filters/${encodeURIComponent(id)}`, patch),
  deleteSavedFilter: (id) => request<{ deleted: boolean }>('DELETE', `/saved-filters/${encodeURIComponent(id)}`),

  listGoals: (id, tz?: string) => request<GoalWithProgress[]>('GET', `/accounts/${id}/goals${qs({ tz })}`),
  createGoal: (id, input: GoalInput) => request<Goal>('POST', `/accounts/${id}/goals`, input),
  updateGoal: (goalId, patch: GoalPatch) => request<Goal>('PUT', `/goals/${encodeURIComponent(goalId)}`, patch),
  resetGoal: (goalId) => request<Goal>('POST', `/goals/${encodeURIComponent(goalId)}/reset`),
  deleteGoal: (goalId) => request<{ deleted: boolean }>('DELETE', `/goals/${encodeURIComponent(goalId)}`),

  listPlaybooks: (o?: PlaybookListOpts) => request<Playbook[]>('GET', `/playbooks${qs({ status: o?.status, q: o?.search, sort: o?.sort })}`),
  getPlaybook: (id) => request<PlaybookDetail>('GET', `/playbooks/${encodeURIComponent(id)}`),
  createPlaybook: (data: PlaybookData) => request<Playbook>('POST', '/playbooks', data),
  updatePlaybook: (id, patch) => request<Playbook>('PUT', `/playbooks/${encodeURIComponent(id)}`, patch),
  archivePlaybook: (id) => request<Playbook>('POST', `/playbooks/${encodeURIComponent(id)}/archive`),
  restorePlaybook: (id) => request<Playbook>('POST', `/playbooks/${encodeURIComponent(id)}/restore`),
  deletePlaybook: (id) => request<{ deleted: boolean }>('DELETE', `/playbooks/${encodeURIComponent(id)}`),
  getPlaybookAnalytics: (accountId, playbookId, tz?: string) =>
    request<PlaybookAnalytics>('GET', `/accounts/${accountId}/playbooks/${encodeURIComponent(playbookId)}/analytics${qs({ tz })}`),
};

export type { Api, AccountKind, ExecutionInput, InstrumentType, ReportDimension, SortBy, TradeAnnotations };
