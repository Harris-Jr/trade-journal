import { useState } from 'react';
import { useApp } from '../state/app.js';
import { useMutation } from '../hooks/useQuery.js';
import type { PropAccount, PropAccountData, PropAccountStatus } from '../api/types.js';

const STATUSES: PropAccountStatus[] = ['evaluation', 'funded', 'passed', 'failed', 'breached'];
const numOrUndef = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));
const toDateInput = (ms?: number): string => (ms === undefined ? '' : new Date(ms).toISOString().slice(0, 10));

/** Create or edit a prop-firm account. Only the firm is required. */
export function PropAccountForm({ initial, onClose, onSaved }: {
  initial: PropAccount | null; onClose: () => void; onSaved: (a: PropAccount) => void;
}): JSX.Element {
  const { api, accounts } = useApp();
  const [firm, setFirm] = useState(initial?.firm ?? '');
  const [program, setProgram] = useState(initial?.program ?? '');
  const [status, setStatus] = useState<PropAccountStatus>(initial?.status ?? 'evaluation');
  const [phase, setPhase] = useState(initial?.phase ?? '');
  const [accountSize, setAccountSize] = useState(initial?.accountSize !== undefined ? String(initial.accountSize) : '');
  const [profitTarget, setProfitTarget] = useState(initial?.profitTarget !== undefined ? String(initial.profitTarget) : '');
  const [maxDrawdown, setMaxDrawdown] = useState(initial?.maxDrawdown !== undefined ? String(initial.maxDrawdown) : '');
  const [dailyLossLimit, setDailyLossLimit] = useState(initial?.dailyLossLimit !== undefined ? String(initial.dailyLossLimit) : '');
  const [startedAt, setStartedAt] = useState(toDateInput(initial?.startedAt));
  const [tradingAccountId, setTradingAccountId] = useState(initial?.tradingAccountId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(async () => {
    if (!firm.trim()) { setError('Firm is required.'); return undefined; }
    const data: PropAccountData = {
      firm: firm.trim(), status,
      program: program.trim() || undefined, phase: phase.trim() || undefined, notes: notes.trim() || undefined,
      accountSize: numOrUndef(accountSize), profitTarget: numOrUndef(profitTarget),
      maxDrawdown: numOrUndef(maxDrawdown), dailyLossLimit: numOrUndef(dailyLossLimit),
      startedAt: startedAt ? Date.parse(`${startedAt}T00:00:00Z`) : undefined,
      tradingAccountId: tradingAccountId || undefined,
    };
    return initial ? api.updatePropAccount(initial.id, data) : api.createPropAccount(data);
  });

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const r = await save.run();
    if (r) onSaved(r);
  };

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={initial ? 'Edit prop account' : 'New prop account'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="sheet" style={{ maxWidth: 520 }} onSubmit={submit}>
        <h2>{initial ? 'Edit prop account' : 'New prop account'}</h2>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="firm">Firm</label>
            <input id="firm" value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. FTMO" style={{ width: '100%' }} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="program">Program</label>
            <input id="program" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. 100K 2-step" /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="status">Status</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as PropAccountStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="phase">Phase</label>
            <input id="phase" value={phase} onChange={(e) => setPhase(e.target.value)} placeholder="e.g. Phase 1" /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="size">Account size</label>
            <input id="size" type="number" step="any" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pt">Profit target</label>
            <input id="pt" type="number" step="any" value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="mdd">Max drawdown</label>
            <input id="mdd" type="number" step="any" value={maxDrawdown} onChange={(e) => setMaxDrawdown(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="dll">Daily loss limit</label>
            <input id="dll" type="number" step="any" value={dailyLossLimit} onChange={(e) => setDailyLossLimit(e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="started">Started</label>
            <input id="started" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="link">Linked trading account</label>
            <select id="link" value={tradingAccountId} onChange={(e) => setTradingAccountId(e.target.value)}>
              <option value="">(none)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
        </div>
        <div className="field"><label htmlFor="pnotes">Notes</label>
          <textarea id="pnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {(error || save.error) && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{error ?? save.error}</div>}
        <div className="row between">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={save.pending}>{save.pending ? 'Saving...' : initial ? 'Save changes' : 'Create account'}</button>
        </div>
      </form>
    </div>
  );
}
