import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { money, signedMoney, num, dateTime, duration, pnlClass } from '../format.js';
import type { Trade, TradeAnnotations, Playbook } from '../api/types.js';

export function TradeDetail(): JSX.Element {
  const { tradeId = '' } = useParams();
  const { api, selectedAccountId, selectedAccount } = useApp();
  const id = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';

  const tradeQ = useQuery(() => api.getTrade(id, decodeURIComponent(tradeId)), [id, tradeId]);
  const strategiesQ = useQuery(() => api.listStrategies(), []);
  const playbooksQ = useQuery(() => api.listPlaybooks({ status: 'active' }), []);

  return (
    <div className="stack">
      <div className="row"><Link to="/trades" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={15} /> Trade Log</Link></div>
      <Query result={tradeQ}>
        {(trade) => (
          <TradeView trade={trade} ccy={ccy} strategies={strategiesQ.data ?? []} playbooks={playbooksQ.data ?? []} onSaved={tradeQ.refetch} api={api} />
        )}
      </Query>
    </div>
  );
}

function TradeView({ trade, ccy, strategies, playbooks, onSaved, api }: {
  trade: Trade; ccy: string; strategies: { id: string; name: string }[]; playbooks: Playbook[]; onSaved: () => void; api: ReturnType<typeof useApp>['api'];
}): JSX.Element {
  const save = useMutation((ann: TradeAnnotations) => api.setTradeAnnotation(trade.id, ann));
  const a = trade.annotations ?? {};
  const [setup, setSetup] = useState(a.setup ?? '');
  const [strategyId, setStrategyId] = useState(a.strategyId ?? '');
  const [rating, setRating] = useState<number>(a.rating ?? 0);
  const [tags, setTags] = useState((a.tags ?? []).join(', '));
  const [mistakes, setMistakes] = useState((a.mistakes ?? []).join(', '));
  const [stopLoss, setStopLoss] = useState(a.stopLoss !== undefined ? String(a.stopLoss) : '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [playbookId, setPlaybookId] = useState(a.playbookId ?? '');
  const [intent, setIntent] = useState(a.playbookIntent ?? '');
  const [checklist, setChecklist] = useState<Record<string, boolean>>(a.playbookChecklist ?? {});
  const [reviewDone, setReviewDone] = useState<boolean>(a.playbookReviewDone ?? false);
  const [reviewNotes, setReviewNotes] = useState(a.playbookReviewNotes ?? '');
  const [saved, setSaved] = useState(false);
  const selectedPb = playbooks.find((p) => p.id === playbookId);

  // Keep the form in sync if the underlying trade/annotations change.
  useEffect(() => {
    const ann = trade.annotations ?? {};
    setSetup(ann.setup ?? ''); setStrategyId(ann.strategyId ?? ''); setRating(ann.rating ?? 0);
    setTags((ann.tags ?? []).join(', ')); setMistakes((ann.mistakes ?? []).join(', '));
    setStopLoss(ann.stopLoss !== undefined ? String(ann.stopLoss) : ''); setNotes(ann.notes ?? '');
    setPlaybookId(ann.playbookId ?? ''); setIntent(ann.playbookIntent ?? '');
    setChecklist(ann.playbookChecklist ?? {}); setReviewDone(ann.playbookReviewDone ?? false);
    setReviewNotes(ann.playbookReviewNotes ?? '');
  }, [trade.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const ann: TradeAnnotations = {
      setup: setup || undefined, strategyId: strategyId || undefined, rating,
      tags: list(tags), mistakes: list(mistakes),
      stopLoss: stopLoss ? Number(stopLoss) : undefined, notes: notes || undefined,
      playbookId: playbookId || undefined,
      playbookIntent: playbookId && intent ? intent : undefined,
      playbookChecklist: playbookId && Object.keys(checklist).length ? checklist : undefined,
      playbookReviewDone: playbookId && reviewDone ? true : undefined,
      playbookReviewNotes: playbookId && reviewNotes ? reviewNotes : undefined,
    };
    const res = await save.run(ann);
    if (res !== undefined) { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000); }
  };

  return (
    <>
      <div className="row between">
        <h1>{trade.symbol} <span className="dim" style={{ fontWeight: 400 }}>- {trade.direction} - {trade.instrumentType}</span></h1>
        {trade.open && <span className="badge">open position</span>}
      </div>

      <div className="tiles">
        <Tile k="Net P&L" v={signedMoney(trade.netPnl, ccy)} tone={pnlClass(trade.netPnl)} />
        <Tile k="Gross P&L" v={signedMoney(trade.grossPnl, ccy)} />
        <Tile k="Fees" v={money(trade.commission + trade.fees + trade.swap, ccy)} sub="commission + fees + swap" />
        <Tile k="R-multiple" v={trade.rMultiple !== undefined ? `${trade.rMultiple.toFixed(2)}R` : '-'} sub={trade.rMultiple === undefined ? 'set a stop below' : undefined} />
        <Tile k="Realized R:R" v={trade.realizedRr !== undefined ? trade.realizedRr.toFixed(2) : '-'} />
        <Tile k="Quantity" v={num(trade.quantity)} />
        <Tile k="Avg entry / exit" v={`${num(trade.avgEntryPrice, 4)} / ${trade.avgExitPrice !== undefined ? num(trade.avgExitPrice, 4) : '-'}`} />
        <Tile k="Duration" v={trade.durationMs ? duration(trade.durationMs) : '-'} sub={trade.openTime ? dateTime(trade.openTime) : undefined} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="card">
          <h3>Executions ({trade.executions.length})</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Side</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {[...trade.executions].sort((x, y) => x.timestamp - y.timestamp).map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.timestamp)}</td>
                    <td>{e.side}</td>
                    <td className="num">{num(e.quantity)}</td>
                    <td className="num">{num(e.price, 4)}</td>
                    <td className="num">{money(e.commission ?? 0, ccy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hintbar" style={{ marginTop: 8 }}>
            P&L, R-multiple and duration are computed by the backend trade engine from these executions.
            To change them, add corrective executions or re-import; this screen never recomputes P&L independently.
          </p>
        </div>

        <form className="card" onSubmit={onSubmit}>
          <h3>Annotations</h3>
          <div className="field"><label htmlFor="setup">Setup</label>
            <input id="setup" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. ORB" /></div>
          <div className="field"><label htmlFor="strategy">Strategy (legacy)</label>
            <select id="strategy" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              <option value="">(none)</option>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="playbook">Playbook</label>
            <select id="playbook" value={playbookId} onChange={(e) => setPlaybookId(e.target.value)}>
              <option value="">(none)</option>
              {playbooks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          {selectedPb && (
            <div className="field" style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
              <div className="field"><label htmlFor="intent">Pre-trade intention</label>
                <textarea id="intent" rows={2} value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="What is the plan for this trade?" /></div>
              {(selectedPb.checklist?.length ?? 0) > 0 && (
                <div className="field"><label>Pre-trade checklist</label>
                  <div className="stack" style={{ gap: 4 }}>
                    {selectedPb.checklist!.map((it) => (
                      <label key={it.id} className="row" style={{ gap: 6, margin: 0, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!checklist[it.id]} onChange={(e) => setChecklist({ ...checklist, [it.id]: e.target.checked })} /> {it.label}
                      </label>
                    ))}
                  </div></div>
              )}
              <label className="row" style={{ gap: 6, margin: '0 0 6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={reviewDone} onChange={(e) => setReviewDone(e.target.checked)} /> Post-trade review completed
              </label>
              {(selectedPb.reviewPrompts?.length ?? 0) > 0 && (
                <p className="hintbar" style={{ marginTop: 0 }}>{selectedPb.reviewPrompts!.map((p) => p.label).join(' - ')}</p>
              )}
              <div className="field"><label htmlFor="rnotes">Review notes</label>
                <textarea id="rnotes" rows={2} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} /></div>
            </div>
          )}
          <div className="field"><label htmlFor="rating">Rating</label>
            <select id="rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              <option value={1}>Good (+1)</option><option value={0}>Neutral (0)</option><option value={-1}>Poor (-1)</option>
            </select></div>
          <div className="field"><label htmlFor="tags">Tags (comma-separated)</label>
            <input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="morning, A+" /></div>
          <div className="field"><label htmlFor="mistakes">Mistakes (comma-separated)</label>
            <input id="mistakes" value={mistakes} onChange={(e) => setMistakes(e.target.value)} placeholder="chased, oversized" /></div>
          <div className="field"><label htmlFor="stop">Planned stop (price)</label>
            <input id="stop" type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="enables R-multiple" /></div>
          <div className="field"><label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {save.error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{save.error}</div>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={save.pending}>{save.pending ? 'Saving...' : 'Save annotations'}</button>
            {saved && <span className="pos row" style={{ gap: 3, display: 'inline-flex', alignItems: 'center' }}><Check size={15} /> Saved</span>}
            <Link className="btn" to={`/notebook?trade=${encodeURIComponent(trade.id)}`}>Add linked note</Link>
          </div>
        </form>
      </div>
    </>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }): JSX.Element {
  return <div className="tile"><div className="k">{k}</div><div className={`v mono ${tone ?? ''}`}>{v}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
