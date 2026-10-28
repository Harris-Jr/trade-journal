import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { Star, Pencil, Copy, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { signedMoney, pnlClass, dateTime, num } from '../format.js';
import { projectTrade, unitSuffix, type ValueUnit } from '@core/analytics/projection.js';
import type { Trade, TradeSortKey, SavedFilter } from '../api/types.js';

const PAGE = 25;
const UNITS: ValueUnit[] = ['currency', 'percent', 'R', 'points', 'ticks', 'pips'];

interface TradeFilters { symbol?: string; direction: 'all' | 'long' | 'short'; status: 'all' | 'open' | 'closed'; sortBy: TradeSortKey; sortDir: 'asc' | 'desc'; search: string }
const DEFAULTS: TradeFilters = { direction: 'all', status: 'all', sortBy: 'closeTime', sortDir: 'desc', search: '' };

export function TradeLog(): JSX.Element {
  const { api, selectedAccountId, selectedAccount, range } = useApp();
  const navigate = useNavigate();
  const id = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';
  const startingBalance = selectedAccount?.startingBalance;

  const [f, setF] = useState<TradeFilters>(DEFAULTS);
  const [playbookFilter, setPlaybookFilter] = useState('');
  const [page, setPage] = useState(0);
  const [unit, setUnit] = useState<ValueUnit>('currency');
  const set = <K extends keyof TradeFilters>(k: K, v: TradeFilters[K]): void => { setF((p) => ({ ...p, [k]: v })); setPage(0); };

  const playbooksQ = useQuery(() => api.listPlaybooks({ status: 'active' }), [id]);

  const q = useQuery(
    () => api.queryTrades(id, {
      range, search: f.search.trim() || undefined,
      ...(f.direction !== 'all' ? { direction: f.direction } : {}),
      ...(f.status !== 'all' ? { status: f.status } : {}),
      ...(playbookFilter ? { playbookId: playbookFilter } : {}),
      sortBy: f.sortBy, sortDir: f.sortDir, limit: PAGE, offset: page * PAGE,
    }),
    [id, range.from, range.to, f.search, f.direction, f.status, playbookFilter, f.sortBy, f.sortDir, page],
  );

  // ---- saved filters (Stage 3) ----
  const filtersQ = useQuery(() => api.listSavedFilters('trades'), [id]);
  const applyFilter = (sf: SavedFilter): void => {
    const d = sf.definition as Partial<TradeFilters>;
    setF({ ...DEFAULTS, ...d, direction: (d.direction as TradeFilters['direction']) ?? 'all', status: (d.status as TradeFilters['status']) ?? 'all', search: typeof d.search === 'string' ? d.search : '' });
    setPage(0);
  };
  const currentDefinition = (): Record<string, unknown> => {
    const d: Record<string, unknown> = { sortBy: f.sortBy, sortDir: f.sortDir };
    if (f.direction !== 'all') d.direction = f.direction;
    if (f.status !== 'all') d.status = f.status;
    if (f.search.trim()) d.search = f.search.trim();
    return d;
  };
  const saveCurrent = async (): Promise<void> => {
    const name = prompt('Save current filter as:');
    if (!name?.trim()) return;
    await api.createSavedFilter('trades', name.trim(), currentDefinition());
    filtersQ.refetch();
  };
  const duplicateFilter = async (sf: SavedFilter): Promise<void> => {
    await api.createSavedFilter('trades', `${sf.name} (copy)`, sf.definition);
    filtersQ.refetch();
  };
  const renameFilter = async (sf: SavedFilter): Promise<void> => {
    const name = prompt('Rename filter:', sf.name);
    if (!name?.trim()) return;
    await api.updateSavedFilter(sf.id, { name: name.trim() });
    filtersQ.refetch();
  };
  const deleteFilter = async (sf: SavedFilter): Promise<void> => {
    if (!confirm(`Delete filter "${sf.name}"?`)) return;
    await api.deleteSavedFilter(sf.id);
    filtersQ.refetch();
  };

  const sortHeader = (key: TradeSortKey, label: string, numeric = false): JSX.Element => (
    <th className={`sortable ${numeric ? 'num' : ''}`}
      aria-sort={f.sortBy === key ? (f.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => { if (f.sortBy === key) set('sortDir', f.sortDir === 'asc' ? 'desc' : 'asc'); else { setF((p) => ({ ...p, sortBy: key, sortDir: 'desc' })); setPage(0); } }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, justifyContent: numeric ? 'flex-end' : 'flex-start' }}>
        {label}{f.sortBy === key ? (f.sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
      </span>
    </th>
  );

  const pnlCell = (t: Trade): JSX.Element => {
    const p = projectTrade(t as any, unit, { startingBalance });
    if (!p.available || p.value === null) return <td className="num dim" title={p.reason}>-</td>;
    if (unit === 'currency') return <td className={`num ${pnlClass(t.netPnl)}`}>{signedMoney(p.value, ccy)}</td>;
    const s = p.value > 0 ? '+' : '';
    return <td className={`num ${pnlClass(p.value)}`}>{s}{num(p.value, 2)}{unit === 'percent' ? '' : ' '}{unitSuffix(unit)}</td>;
  };

  return (
    <div className="stack">
      <h1>Trade Log</h1>

      <div className="row">
        <input type="search" placeholder="Search symbol, setup, tag..." value={f.search}
          onChange={(e) => set('search', e.target.value)} aria-label="Search trades" style={{ minWidth: 200 }} />
        <select aria-label="Direction" value={f.direction} onChange={(e) => set('direction', e.target.value as TradeFilters['direction'])}>
          <option value="all">All sides</option><option value="long">Long</option><option value="short">Short</option>
        </select>
        <select aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value as TradeFilters['status'])}>
          <option value="all">All status</option><option value="closed">Closed</option><option value="open">Open</option>
        </select>
        <select aria-label="Playbook" value={playbookFilter} onChange={(e) => { setPlaybookFilter(e.target.value); setPage(0); }}>
          <option value="">All playbooks</option>
          {(playbooksQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label style={{ margin: 0 }}>Show P&L in{' '}
          <select aria-label="Value unit" value={unit} onChange={(e) => setUnit(e.target.value as ValueUnit)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={saveCurrent} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Star size={14} /> Save filter</button>
        {(filtersQ.data ?? []).map((sf) => (
          <span key={sf.id} className="row" style={{ gap: 2, border: '1px solid var(--border)', borderRadius: 8, padding: '2px 4px 2px 8px' }}>
            <button className="btn sm" style={{ border: 0, background: 'transparent' }} onClick={() => applyFilter(sf)} title="Apply">{sf.name}</button>
            <button className="btn sm" style={{ border: 0, background: 'transparent', display: 'inline-flex' }} onClick={() => renameFilter(sf)} aria-label={`Rename ${sf.name}`} title="Rename"><Pencil size={14} /></button>
            <button className="btn sm" style={{ border: 0, background: 'transparent', display: 'inline-flex' }} onClick={() => duplicateFilter(sf)} aria-label={`Duplicate ${sf.name}`} title="Duplicate"><Copy size={14} /></button>
            <button className="btn sm" style={{ border: 0, background: 'transparent', color: 'var(--neg)', display: 'inline-flex' }} onClick={() => deleteFilter(sf)} aria-label={`Delete ${sf.name}`} title="Delete"><X size={14} /></button>
          </span>
        ))}
      </div>

      <Query result={q} isEmpty={(r) => r.page.total === 0} emptyTitle="No matching trades" emptyHint="Adjust filters or date range.">
        {(r) => {
          const pageCount = Math.max(1, Math.ceil(r.page.total / PAGE));
          return (
            <>
              <div className="hintbar">{r.page.total} trade{r.page.total === 1 ? '' : 's'} - showing {r.items.length}</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {sortHeader('closeTime', 'Closed')}
                      {sortHeader('symbol', 'Symbol')}
                      <th>Side</th>
                      {sortHeader('quantity', 'Qty', true)}
                      <th className="num">Entry</th>
                      <th className="num">Exit</th>
                      {sortHeader('netPnl', `P&L (${unit})`, true)}
                      {sortHeader('rMultiple', 'R', true)}
                      <th>Setup</th>
                      <th>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => navigate(`/trades/${encodeURIComponent(t.id)}`)}>
                        <td>{t.open ? <span className="badge">open</span> : (t.closeTime ? dateTime(t.closeTime) : '-')}</td>
                        <td><strong>{t.symbol}</strong></td>
                        <td>{t.direction}</td>
                        <td className="num">{num(t.quantity)}</td>
                        <td className="num">{num(t.avgEntryPrice, 4)}</td>
                        <td className="num">{t.avgExitPrice !== undefined ? num(t.avgExitPrice, 4) : '-'}</td>
                        {pnlCell(t)}
                        <td className="num">{t.rMultiple !== undefined ? `${t.rMultiple.toFixed(2)}R` : '-'}</td>
                        <td>{t.annotations?.setup ?? <span className="dim">-</span>}</td>
                        <td>{(t.annotations?.tags ?? []).map((tag) => <span key={tag} className="tag">{tag}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pageCount > 1 && (
                <div className="row between">
                  <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={14} /> Prev</button>
                  <span className="dim">Page {page + 1} of {pageCount}</span>
                  <button className="btn sm" disabled={!r.page.hasMore} onClick={() => setPage((p) => p + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Next <ChevronRight size={14} /></button>
                </div>
              )}
            </>
          );
        }}
      </Query>
      <p className="hintbar">Server-side filtered, sorted and paginated. ticks/pips need instrument metadata and show "-" until configured. Amounts in {ccy}.</p>
    </div>
  );
}
