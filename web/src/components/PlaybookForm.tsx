import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useMutation } from '../hooks/useQuery.js';
import type { Playbook, PlaybookData, PlaybookDirection, PlaybookChecklistItem } from '../api/types.js';

const DIRECTIONS: { value: PlaybookDirection | ''; label: string }[] = [
  { value: '', label: 'Any' }, { value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: 'both', label: 'Both' },
];

let itemSeq = 0;
const newItem = (label = ''): PlaybookChecklistItem => ({ id: `n${itemSeq++}`, label });

/** Create or edit a playbook. Only the name is required. */
export function PlaybookForm({ initial, onClose, onSaved }: {
  initial: Playbook | null; onClose: () => void; onSaved: (p: Playbook) => void;
}): JSX.Element {
  const { api } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [market, setMarket] = useState(initial?.market ?? '');
  const [symbols, setSymbols] = useState((initial?.symbols ?? []).join(', '));
  const [direction, setDirection] = useState<PlaybookDirection | ''>(initial?.direction ?? '');
  const [timeframe, setTimeframe] = useState(initial?.timeframe ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [entryCriteria, setEntryCriteria] = useState(initial?.entryCriteria ?? '');
  const [confirmationSignals, setConfirmationSignals] = useState(initial?.confirmationSignals ?? '');
  const [invalidationConditions, setInvalidationConditions] = useState(initial?.invalidationConditions ?? '');
  const [stopRules, setStopRules] = useState(initial?.stopRules ?? '');
  const [targetRules, setTargetRules] = useState(initial?.targetRules ?? '');
  const [riskRules, setRiskRules] = useState(initial?.riskRules ?? '');
  const [examples, setExamples] = useState(initial?.examples ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [checklist, setChecklist] = useState<PlaybookChecklistItem[]>(initial?.checklist ?? []);
  const [reviewPrompts, setReviewPrompts] = useState<PlaybookChecklistItem[]>(initial?.reviewPrompts ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(async () => {
    if (!name.trim()) { setError('Name is required.'); return undefined; }
    const data: PlaybookData = {
      name: name.trim(),
      description: description.trim() || undefined,
      market: market.trim() || undefined,
      symbols: symbols.split(',').map((s) => s.trim()).filter(Boolean),
      direction: direction || undefined,
      timeframe: timeframe.trim() || undefined,
      category: category.trim() || undefined,
      entryCriteria: entryCriteria.trim() || undefined,
      confirmationSignals: confirmationSignals.trim() || undefined,
      invalidationConditions: invalidationConditions.trim() || undefined,
      stopRules: stopRules.trim() || undefined,
      targetRules: targetRules.trim() || undefined,
      riskRules: riskRules.trim() || undefined,
      examples: examples.trim() || undefined,
      notes: notes.trim() || undefined,
      checklist: checklist.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() })),
      reviewPrompts: reviewPrompts.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() })),
    };
    return initial ? api.updatePlaybook(initial.id, data) : api.createPlaybook(data);
  });

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const r = await save.run();
    if (r) onSaved(r);
  };

  const ListEditor = ({ title, items, setItems }: { title: string; items: PlaybookChecklistItem[]; setItems: (v: PlaybookChecklistItem[]) => void }): JSX.Element => (
    <div className="field">
      <label>{title}</label>
      <div className="stack" style={{ gap: 6 }}>
        {items.map((it, i) => (
          <div key={it.id} className="row" style={{ gap: 6 }}>
            <input value={it.label} onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))}
              placeholder={`Item ${i + 1}`} style={{ flex: 1 }} aria-label={`${title} item ${i + 1}`} />
            <button type="button" className="btn sm" aria-label="Remove item" onClick={() => setItems(items.filter((x) => x.id !== it.id))} style={{ display: 'inline-flex' }}><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setItems([...items, newItem()])} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}><Plus size={14} /> Add item</button>
      </div>
    </div>
  );

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={initial ? 'Edit playbook' : 'New playbook'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="sheet" style={{ maxWidth: 560 }} onSubmit={submit}>
        <h2>{initial ? 'Edit playbook' : 'New playbook'}</h2>

        <div className="field"><label htmlFor="pname">Name</label>
          <input id="pname" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} /></div>
        <div className="field"><label htmlFor="pdesc">Description</label>
          <textarea id="pdesc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pmarket">Market</label>
            <input id="pmarket" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="e.g. Futures" /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pdir">Direction</label>
            <select id="pdir" value={direction} onChange={(e) => setDirection(e.target.value as PlaybookDirection | '')}>
              {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ptf">Timeframe</label>
            <input id="ptf" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="e.g. 5m" /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pcat">Category</label>
            <input id="pcat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Momentum" /></div>
        </div>
        <div className="field"><label htmlFor="psym">Symbols (comma-separated)</label>
          <input id="psym" value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder="ES, NQ, AAPL" /></div>

        <h3>Rules</h3>
        <div className="field"><label htmlFor="pentry">Entry criteria</label><textarea id="pentry" rows={2} value={entryCriteria} onChange={(e) => setEntryCriteria(e.target.value)} /></div>
        <div className="field"><label htmlFor="pconf">Confirmation signals</label><textarea id="pconf" rows={2} value={confirmationSignals} onChange={(e) => setConfirmationSignals(e.target.value)} /></div>
        <div className="field"><label htmlFor="pinval">Invalidation conditions</label><textarea id="pinval" rows={2} value={invalidationConditions} onChange={(e) => setInvalidationConditions(e.target.value)} /></div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pstop">Stop-loss rules</label><textarea id="pstop" rows={2} value={stopRules} onChange={(e) => setStopRules(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ptarget">Profit-target rules</label><textarea id="ptarget" rows={2} value={targetRules} onChange={(e) => setTargetRules(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="prisk">Risk-management rules</label><textarea id="prisk" rows={2} value={riskRules} onChange={(e) => setRiskRules(e.target.value)} /></div>

        <h3>Checklists</h3>
        <ListEditor title="Pre-trade checklist" items={checklist} setItems={setChecklist} />
        <ListEditor title="Post-trade review prompts" items={reviewPrompts} setItems={setReviewPrompts} />

        <div className="field"><label htmlFor="pex">Examples</label><textarea id="pex" rows={2} value={examples} onChange={(e) => setExamples(e.target.value)} /></div>
        <div className="field"><label htmlFor="pnotes">Notes</label><textarea id="pnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        {(error || save.error) && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{error ?? save.error}</div>}
        <div className="row between">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={save.pending}>{save.pending ? 'Saving...' : initial ? 'Save changes' : 'Create playbook'}</button>
        </div>
      </form>
    </div>
  );
}
