import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, Api, DateRange } from '../api/types.js';
import { httpApi, auth, setAuthToken, setUnauthorizedHandler, type AuthUser } from '../api/client.js';
import { createDemoApi } from '../demo/demoApi.js';

export type RangePreset = 'all' | '7d' | '30d' | '90d' | 'ytd' | 'custom';
const TOKEN_KEY = 'tj.token';

interface AppState {
  api: Api;
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
  // auth
  authUser: AuthUser | null;
  authReady: boolean; // initial token check finished
  authenticated: boolean; // demo or logged in
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  // accounts
  accounts: Account[];
  accountsLoading: boolean;
  accountsError: string | null;
  reloadAccounts: () => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string) => void;
  selectedAccount: Account | null;
  // date range
  rangePreset: RangePreset;
  setRangePreset: (p: RangePreset) => void;
  range: DateRange;
  customRange: DateRange;
  setCustomRange: (r: DateRange) => void;
}

const Ctx = createContext<AppState | null>(null);

function presetToRange(preset: RangePreset, custom: DateRange): DateRange {
  const now = Date.now();
  const day = 86400_000;
  switch (preset) {
    case '7d': return { from: now - 7 * day };
    case '30d': return { from: now - 30 * day };
    case '90d': return { from: now - 90 * day };
    case 'ytd': return { from: Date.parse(`${new Date().getUTCFullYear()}-01-01T00:00:00Z`) };
    case 'custom': return custom;
    default: return {};
  }
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [demoMode, setDemoMode] = useState<boolean>(() => localStorage.getItem('tj.demo') === '1');
  const demoApiRef = useMemo(() => createDemoApi(), [demoMode]);
  const api = demoMode ? demoApiRef : httpApi;

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>('all');
  const [customRange, setCustomRange] = useState<DateRange>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { localStorage.setItem('tj.demo', demoMode ? '1' : '0'); }, [demoMode]);

  // On a 401 anywhere, drop the session and return to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken(null);
      setAuthUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Validate any stored token once on load (skipped in demo mode).
  useEffect(() => {
    if (demoMode) { setAuthReady(true); return; }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setAuthUser(null); setAuthReady(true); return; }
    setAuthToken(token);
    let cancelled = false;
    auth.me()
      .then((u) => { if (!cancelled) setAuthUser(u); })
      .catch(() => { if (!cancelled) { localStorage.removeItem(TOKEN_KEY); setAuthToken(null); setAuthUser(null); } })
      .finally(() => { if (!cancelled) setAuthReady(true); });
    return () => { cancelled = true; };
  }, [demoMode]);

  const authenticated = demoMode || authUser !== null;

  const login = async (email: string, password: string): Promise<void> => {
    const res = await auth.login(email, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setAuthUser(res.user);
    setReloadKey((k) => k + 1);
  };
  const register = async (email: string, password: string): Promise<void> => {
    const res = await auth.register(email, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setAuthUser(res.user);
    setReloadKey((k) => k + 1);
  };
  const logout = (): void => {
    auth.logout().catch(() => { /* best effort */ });
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setAuthUser(null);
    setAccounts([]);
    setSelectedAccountId(null);
  };

  // Load accounts once authenticated (demo or logged in).
  useEffect(() => {
    if (!authenticated) { setAccountsLoading(false); return; }
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsError(null);
    api.listAccounts()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        setSelectedAccountId((cur) => (cur && list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null));
      })
      .catch((e: unknown) => { if (!cancelled) setAccountsError(e instanceof Error ? e.message : 'Failed to load accounts'); })
      .finally(() => { if (!cancelled) setAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [api, authenticated, reloadKey]);

  const range = useMemo(() => presetToRange(rangePreset, customRange), [rangePreset, customRange]);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  const value: AppState = {
    api, demoMode, setDemoMode,
    authUser, authReady, authenticated, login, register, logout,
    accounts, accountsLoading, accountsError,
    reloadAccounts: () => setReloadKey((k) => k + 1),
    selectedAccountId, setSelectedAccountId, selectedAccount,
    rangePreset, setRangePreset, range, customRange, setCustomRange,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
