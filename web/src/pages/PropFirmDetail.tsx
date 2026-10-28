import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Plus } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { StatTile } from '../components/StatTile.js';
import { PropAccountForm } from '../components/PropAccountForm.js';
import { money, signedMoney, pnlClass, dateOnly } from '../format.js';
import type { PropAccountStatus, PropTransactionKind } from '../api/types.js';

const statusChip: Record<PropAccountStatus, string> = { funded: 'ok', passed: 'ok', failed: 'bad', breached: 'bad', evaluation: 'warn' };
const KINDS: PropTransactionKind[] = ['evaluation_fee', 'reset_fee', 'activation_fee', 'payout', 'refund', 'other'];
const kindLabel = (k: string): string => k.replace(/_/g, ' ');
// Fee kinds are entered as costs (stored negative); payout/refund are credits (positive).
const isCredit = (k: PropTransactionKind): boolean => k === 'payout' || k === 'refund';

export function PropFirmDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { api, selectedAccount, accounts } = useApp();
  const navigate = useNavigate();
  const ccy = selectedAccount?.currency ?? 'USD';
  const pid = decodeURIComponent(id);

  const q = useQuery(() => api.getPropAccount(pid), [pid]);
  const [editing, setEditing] = useState(false);
  const del = useMutation(() => api.deletePropAccount(pid));
  const addTx = useMutation((tx: { amount: number; kind: PropTransactionKind; note?: string }) => api.addPropTransaction(pid, tx));
  const delTx = useMutation((txId: string) => api.deletePropTransaction(txId));

  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<PropTransactionKind>('evaluation_fee');
  const [note, setNote] = useState('');
  const [txError, setTxError] = useState<string | null>(null);

  const submitTx = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setTxError(null);
    const magnitude = Number(amount);
    if (!Number.isFinite(magnitude) || magnitude <= 0) { setTxError('Enter a positive amount.'); return; }
    const signed = isCredit(kind) ? magnitude : -magnitude;
    const r = await addTx.run({ amount: signed, kind, note: note.trim() || undefined });
    if (r) { setAmount(''); setNote(''); q.refetch(); }
  };

  return (
    <div className="stack">
      <div className="row"><Link to="/propfirm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={15} /> Prop Firms</Link></div>
      <Query result={q}>
        {(a) => {
          const linkedName = accounts.find((x) => x.id === a.tradingAccountId)?.name;
          return (
            <>
              <div className="row between">
                <h1 style={{ margin: 0 }}>{a.firm} <span className={`chip ${statusChip[a.status]}`} style={{ verticalAlign: 'middle' }}>{a.status}</span></h1>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={14} /> Edit</button>
                  <button className="btn sm danger" disabled={del.pending}
                    onClick={async () => { if (!confirm('Delete this prop account and its cash-flow ledger? This does not affect any trades.')) return; const r = await del.run(); if (r?.deleted) navigate('/propfirm'); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
              {del.error && <div className="error-box" role="alert">{del.error}</div>}

              <div className="row" style={{ gap: 4 }}>
                {[a.program, a.phase].filter(Boolean).map((m) => <span key={m} className="badge">{m}</span>)}
                {linkedName && <span className="badge">linked: {linkedName}</span>}
              </div>

              <div className="tiles">
                <StatTile label="Fees paid" value={money(a.totals.cost, ccy)} tone="neg" />
                <StatTile label="Payouts" value={money(a.totals.payout, ccy)} tone="pos" />
                <StatTile label="Net" value={signedMoney(a.totals.net, ccy)} tone={pnlClass(a.totals.net) as 'pos' | 'neg' | 'flat'} />
                {a.accountSize !== undefined && <StatTile label="Account size" value={money(a.accountSize, ccy)} />}
                {a.profitTarget !== undefined && <StatTile label="Profit target" value={money(a.profitTarget, ccy)} />}
                {a.maxDrawdown !== undefined && <StatTile label="Max drawdown" value={money(a.maxDrawdown, ccy)} />}
              </div>
              {a.notes && <div className="card"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.notes}</p></div>}

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Cash-flow ledger</h3>
                <form className="row" onSubmit={submitTx} style={{ alignItems: 'flex-end', gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="tkind">Kind</label>
                    <select id="tkind" value={kind} onChange={(e) => setKind(e.target.value as PropTransactionKind)}>
                      {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                    </select></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="tamt">Amount ({ccy})</label>
                    <input id="tamt" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="positive" style={{ width: 120 }} /></div>
                  <div className="field" style={{ margin: 0, flex: 1 }}><label htmlFor="tnote">Note</label>
                    <input id="tnote" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                  <button className="btn" type="submit" disabled={addTx.pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Add</button>
                </form>
                <p className="hintbar" style={{ marginTop: 4 }}>Fees are recorded as costs; payouts and refunds as credits. Enter a positive amount; the sign is applied by kind.</p>
                {(txError || addTx.error) && <div className="error-box" role="alert" style={{ margin: '8px 0' }}>{txError ?? addTx.error}</div>}

                {a.transactions.length === 0 ? (
                  <div className="state"><div className="big">No transactions yet</div><div className="dim">Add an evaluation fee or a payout above.</div></div>
                ) : (
                  <div className="table-wrap" style={{ marginTop: 10 }}>
                    <table>
                      <thead><tr><th>Date</th><th>Kind</th><th className="num">Amount</th><th>Note</th><th /></tr></thead>
                      <tbody>
                        {a.transactions.map((t) => (
                          <tr key={t.id}>
                            <td>{dateOnly(t.timestamp)}</td>
                            <td>{kindLabel(t.kind)}</td>
                            <td className={`num ${pnlClass(t.amount)}`}>{signedMoney(t.amount, ccy)}</td>
                            <td>{t.note ?? ''}</td>
                            <td className="num"><button className="btn sm danger" aria-label="Delete transaction" style={{ border: 0, background: 'transparent', display: 'inline-flex' }}
                              disabled={delTx.pending} onClick={async () => { const r = await delTx.run(t.id); if (r) q.refetch(); }}><Trash2 size={14} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {editing && <PropAccountForm initial={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); q.refetch(); }} />}
            </>
          );
        }}
      </Query>
    </div>
  );
}
