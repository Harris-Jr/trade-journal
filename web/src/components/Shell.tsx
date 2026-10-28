import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, List, PlusCircle, PenLine, NotebookText, BarChart3, Target, BookOpen, Lightbulb, Upload, Settings as SettingsIcon,
  Menu, Moon, Sun, Monitor, type LucideProps,
} from 'lucide-react';
import { useApp } from '../state/app.js';
import { AccountSelector } from './AccountSelector.js';
import { DateRangeControls } from './DateRangeControls.js';
import { EmptyState, ErrorState, Loading } from './states.js';

const NAV: { to: string; label: string; Icon: ComponentType<LucideProps>; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/trades', label: 'Trade Log', Icon: List },
  { to: '/add', label: 'Add Trade', Icon: PlusCircle },
  { to: '/journal', label: 'Journal', Icon: PenLine },
  { to: '/notebook', label: 'Notebook', Icon: NotebookText },
  { to: '/reports', label: 'Reports', Icon: BarChart3 },
  { to: '/playbooks', label: 'Playbooks', Icon: BookOpen },
  { to: '/insights', label: 'Insights', Icon: Lightbulb },
  { to: '/progress', label: 'Progress', Icon: Target },
  { to: '/import', label: 'Import', Icon: Upload },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];
const ICON_SIZE = 18;

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('tj.theme') ?? 'system');
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    localStorage.setItem('tj.theme', theme);
  }, [theme]);
  const cycle = (): void => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));
  return [theme, cycle];
}

export function Shell(): JSX.Element {
  const { demoMode, setDemoMode, accounts, accountsLoading, accountsError, reloadAccounts, selectedAccountId, authUser, logout } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const navigate = useNavigate();

  const body = (): JSX.Element => {
    if (accountsLoading && accounts.length === 0) return <Loading label="Loading accounts..." />;
    if (accountsError) {
      return (
        <ErrorState
          message={`${accountsError}. Is the API running on its configured port? You can also explore the UI in Demo mode.`}
          onRetry={reloadAccounts}
        />
      );
    }
    if (accounts.length === 0) {
      return (
        <EmptyState
          title="No accounts yet"
          hint="Create your first account to start logging trades, or turn on Demo mode to explore with sample data."
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => navigate('/settings')}>Create account</button>
              <button className="btn" onClick={() => setDemoMode(true)}>Enable demo mode</button>
            </div>
          }
        />
      );
    }
    if (!selectedAccountId) return <EmptyState title="Select an account" />;
    return <Outlet />;
  };

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar" aria-label="Primary">
        <div className="brand"><span className="dot" aria-hidden="true" /> Trade Journal</div>
        <nav onClick={() => setNavOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
              <span className="ico" aria-hidden="true"><n.Icon size={ICON_SIZE} /></span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="hintbar" style={{ padding: '8px 10px' }}>M5 UI - public clean-room build</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn sm menu-toggle" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}><Menu size={16} /></button>
          <AccountSelector />
          <DateRangeControls />
          <div className="spacer" />
          <button className="btn sm" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />}
          </button>
          <label className="row" style={{ gap: 6, margin: 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
            <span>Demo</span>
          </label>
          {!demoMode && authUser && (
            <div className="row" style={{ gap: 8 }}>
              <span className="dim" style={{ fontSize: '0.82em' }} title={authUser.email}>{authUser.email}</span>
              <button className="btn sm" onClick={logout}>Sign out</button>
            </div>
          )}
        </header>
        {demoMode && <div className="banner demo" role="status">Demo mode - sample data only. Changes are in-memory and reset on reload.</div>}
        <main className="content">{body()}</main>
      </div>
    </div>
  );
}
