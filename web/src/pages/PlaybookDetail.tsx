import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { PlaybookForm } from '../components/PlaybookForm.js';
import { StatTile } from '../components/StatTile.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { NetPnlBarChart } from '../components/charts.js';
import { money, signedMoney, pct, ratio, num, pnlClass, dateTime } from '../format.js';
import type { PlaybookDetail as PlaybookDetailType } from '../api/types.js';

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const rate = (v: number | null): string => (v === null ? 'No data' : pct(v, 0));

export function PlaybookDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { api, selectedAccountId, selectedAccount } = useApp();
  const navigate = useNavigate();
  const accountId = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';
  const pid = decodeURIComponent(id);

  const pbQ = useQuery(() => api.getPlaybook(pid), [pid]);
  const analyticsQ = useQuery(() => api.getPlaybookAnalytics(accountId, pid, localTz), [pid, accountId]);
  const tradesQ = useQuery(() => api.queryTrades(accountId, { playbookId: pid, sortBy: 'closeTime', sortDir: 'desc', limit: 10 }), [pid, accountId]);

  const [editing, setEditing] = useState(false);
  const del = useMutation(() => api.deletePlaybook(pid));

  const archiveRestore = useMutation((archived: boolean) => (archived ? api.restorePlaybook(pid) : api.archivePlaybook(pid)));

  return (
    <div className="stack">
      <div className="row"><Link to="/playbooks" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={15} /> Playbooks</Link></div>

      <Query result={pbQ}>
        {(pb) => (
          <>
            <div className="row between">
              <h1 style={{ margin: 0 }}>{pb.name} {pb.status === 'archived' && <span className="chip" style={{ verticalAlign: 'middle' }}>Archived</span>}</h1>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={14} /> Edit</button>
                <button className="btn sm" disabled={archiveRestore.pending}
                  onClick={async () => { const r = await archiveRestore.run(pb.status === 'archived'); if (r) pbQ.refetch(); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {pb.status === 'archived' ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
                </button>
                <button className="btn sm danger" disabled={del.pending}
                  onClick={async () => { if (!confirm('Delete this playbook? Only allowed when no trades are linked. Trade history is never changed.')) return; const r = await del.run(); if (r?.deleted) navigate('/playbooks'); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={14} /> Delete</button>
              </div>
            </div>
            {del.error && <div className="error-box" role="alert">{del.error}</div>}

            <div className="row" style={{ gap: 4 }}>
              {[pb.market, pb.direction, pb.timeframe, pb.category].filter(Boolean).map((m) => <span key={m} className="badge">{m}</span>)}
              {(pb.symbols ?? []).map((s) => <span key={s} className="tag">{s}</span>)}
            </div>
            {pb.description && <p>{pb.description}</p>}

            <RuleSections pb={pb} />

            <div className="card">
              <div className="row between"><h3 style={{ margin: 0 }}>Performance ({selectedAccount?.name})</h3>
                <span className="hintbar">Linked closed trades, computed by the trade engine. Association describes, it does not prove causation.</span></div>
              <Query result={analyticsQ} isEmpty={(a) => a.linkedClosed === 0 && a.linkedOpen === 0}
                emptyTitle="No linked trades in this account"
                emptyHint="Assign trades to this playbook from a trade's detail view.">
                {(a) => (
                  <>
                    <div className="tiles" style={{ marginTop: 10 }}>
                      <StatTile label="Linked closed" value={num(a.stats.trades, 0)} sub={a.linkedOpen ? `${a.linkedOpen} open` : undefined} />
                      <StatTile label="Net P&L" value={signedMoney(a.stats.netPnl, ccy)} tone={pnlClass(a.stats.netPnl) as 'pos' | 'neg' | 'flat'} />
                      <StatTile label="Win rate" value={pct(a.stats.winRate)} sub={`BE ${rate(a.breakevenRate)}`} />
                      <StatTile label="Profit factor" value={ratio(a.stats.profitFactor)} />
                      <StatTile label="Expectancy" value={money(a.stats.expectancy, ccy)} sub="per trade" />
                      <StatTile label="Avg R" value={a.stats.avgRMultiple === null ? 'No data' : `${num(a.stats.avgRMultiple, 2)}R`} sub={`${a.stats.tradesWithR} with stop`} />
                      <StatTile label="Avg win / loss" value={`${money(a.stats.avgWin, ccy)} / ${money(a.stats.avgLoss, ccy)}`} />
                      <StatTile label="Max drawdown" value={money(a.stats.drawdown.maxDrawdown, ccy)} tone="neg" sub={`recovery ${ratio(a.stats.recoveryFactor)}`} />
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 14 }}>
                      <div>
                        <div className="row between" style={{ fontSize: '0.85em' }}><span>Checklist adherence</span><span className="mono">{rate(a.checklistAdherence)}</span></div>
                        <ProgressBar fraction={a.checklistAdherence} tone="accent" ariaLabel="checklist adherence" />
                      </div>
                      <div>
                        <div className="row between" style={{ fontSize: '0.85em' }}><span>Review completion</span><span className="mono">{rate(a.reviewCompletionRate)}</span></div>
                        <ProgressBar fraction={a.reviewCompletionRate} tone="accent" ariaLabel="review completion" />
                      </div>
                    </div>

                    {a.byMonth.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <h4 style={{ margin: '0 0 6px' }}>Net P&L by month</h4>
                        <NetPnlBarChart data={a.byMonth.map((r) => ({ label: r.label, netPnl: r.netPnl }))} currency={ccy} />
                      </div>
                    )}

                    {(a.bySymbol.length > 0 || a.byDirection.length > 0) && (
                      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 14 }}>
                        <BreakdownTable title="By symbol" rows={a.bySymbol} ccy={ccy} />
                        <BreakdownTable title="By direction" rows={a.byDirection} ccy={ccy} />
                      </div>
                    )}
                  </>
                )}
              </Query>
            </div>

            <div className="card">
              <div className="row between"><h3 style={{ margin: 0 }}>Linked trades</h3>
                <Link to={`/trades`}>Open Trade Log</Link></div>
              <Query result={tradesQ} isEmpty={(r) => r.items.length === 0} emptyTitle="No linked trades in this account">
                {(r) => (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th className="num">Net P&L</th><th className="num">R</th></tr></thead>
                      <tbody>
                        {r.items.map((t) => (
                          <tr key={t.id} className="clickable" onClick={() => navigate(`/trades/${encodeURIComponent(t.id)}`)}>
                            <td>{t.open ? <span className="badge">open</span> : (t.closeTime ? dateTime(t.closeTime) : '-')}</td>
                            <td><strong>{t.symbol}</strong></td>
                            <td>{t.direction}</td>
                            <td className={`num ${pnlClass(t.netPnl)}`}>{signedMoney(t.netPnl, ccy)}</td>
                            <td className="num">{t.rMultiple !== undefined ? `${t.rMultiple.toFixed(2)}R` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Query>
            </div>

            {editing && <PlaybookForm initial={pb} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); pbQ.refetch(); }} />}
          </>
        )}
      </Query>
    </div>
  );
}

function RuleSections({ pb }: { pb: PlaybookDetailType }): JSX.Element {
  const sections: [string, string | undefined][] = [
    ['Entry criteria', pb.entryCriteria], ['Confirmation signals', pb.confirmationSignals],
    ['Invalidation conditions', pb.invalidationConditions], ['Stop-loss rules', pb.stopRules],
    ['Profit-target rules', pb.targetRules], ['Risk management', pb.riskRules],
    ['Examples', pb.examples], ['Notes', pb.notes],
  ];
  const present = sections.filter(([, v]) => v && v.trim());
  if (present.length === 0 && (pb.checklist?.length ?? 0) === 0 && (pb.reviewPrompts?.length ?? 0) === 0) return <></>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Plan</h3>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {present.map(([title, v]) => (
          <div key={title}><div className="dim" style={{ fontSize: '0.8em', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
            <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{v}</p></div>
        ))}
      </div>
      {(pb.checklist?.length ?? 0) > 0 && (
        <div style={{ marginTop: 12 }}><div className="dim" style={{ fontSize: '0.8em', textTransform: 'uppercase' }}>Pre-trade checklist</div>
          <ul>{pb.checklist!.map((i) => <li key={i.id}>{i.label}</li>)}</ul></div>
      )}
      {(pb.reviewPrompts?.length ?? 0) > 0 && (
        <div><div className="dim" style={{ fontSize: '0.8em', textTransform: 'uppercase' }}>Post-trade review</div>
          <ul>{pb.reviewPrompts!.map((i) => <li key={i.id}>{i.label}</li>)}</ul></div>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows, ccy }: { title: string; rows: { key: string; label: string; trades: number; netPnl: number }[]; ccy: string }): JSX.Element {
  return (
    <div>
      <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{title.replace('By ', '')}</th><th className="num">Trades</th><th className="num">Net P&L</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><td>{r.label}</td><td className="num">{r.trades}</td><td className={`num ${pnlClass(r.netPnl)}`}>{signedMoney(r.netPnl, ccy)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
