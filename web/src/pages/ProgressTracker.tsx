import { useEffect, useState } from 'react';
import { Target, Plus, Pencil, Pause, Play, RotateCcw, Trash2, Info } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query, EmptyState } from '../components/states.js';
import { ProgressBar, type BarTone } from '../components/ProgressBar.js';
import { NetPnlBarChart } from '../components/charts.js';
import { money, num } from '../format.js';
import { METRIC_DEFS, validateGoalTarget } from '@core/analytics/progress.js';
import type {
  GoalWithProgress, GoalMetric, GoalPeriod, GoalDirection, MetricUnit, GoalProgress,
} from '../api/types.js';

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const METRICS = Object.keys(METRIC_DEFS) as GoalMetric[];
const PERIOD_LABEL: Record<GoalPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

function fmt(unit: MetricUnit, v: number | null | undefined, ccy: string): string {
  if (v === null || v === undefined) return 'No data';
  switch (unit) {
    case 'currency': return money(v, ccy);
    case 'percent': return `${num(v, 1)}%`;
    case 'r': return `${num(v, 2)}R`;
    case 'rating': return `${num(v, 1)} / 5`;
    default: return num(v, 0);
  }
}

function status(p: GoalProgress): { label: string; cls: string; tone: BarTone } {
  if (p.status === 'paused') return { label: 'Paused', cls: '', tone: 'accent' };
  if (p.met === null) return { label: 'No data', cls: '', tone: 'accent' };
  if (p.met) return { label: 'Met', cls: 'ok', tone: 'pos' };
  if (p.direction === 'at_most') return { label: 'Over', cls: 'bad', tone: 'neg' };
  return { label: 'In progress', cls: 'warn', tone: 'warn' };
}

function remainingText(p: GoalProgress, ccy: string): string {
  if (p.current === null || p.remaining === null) return '';
  if (p.direction === 'at_least') return p.met ? 'Target reached' : `${fmt(p.unit, p.remaining, ccy)} to go`;
  return p.remaining >= 0 ? `${fmt(p.unit, p.remaining, ccy)} of budget left` : `${fmt(p.unit, -p.remaining, ccy)} over`;
}

export function ProgressTracker(): JSX.Element {
  const { api, selectedAccountId, selectedAccount, range } = useApp();
  const id = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';

  const goalsQ = useQuery(() => api.listGoals(id, localTz), [id]);
  const activityQ = useQuery(() => api.getReport(id, 'day', { range, sortBy: 'key', tz: localTz }), [id, range.from, range.to]);

  const [editing, setEditing] = useState<GoalWithProgress | null>(null);
  const [creating, setCreating] = useState(false);

  const closeForm = (): void => { setEditing(null); setCreating(false); };
  const afterSave = (): void => { closeForm(); goalsQ.refetch(); };

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Target size={22} /> Progress Tracker</h1>
        <button className="btn primary" onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> New goal
        </button>
      </div>
      <p className="hintbar" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, maxWidth: 760 }}>
        <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Goals measure your process and recent results per period. Performance goals track outcomes; behavioral
        goals track discipline. Reaching a profit target reflects past results only and does not guarantee future profitability.
      </p>

      <Query result={goalsQ} isEmpty={(g) => g.length === 0}
        emptyTitle="No goals yet"
        emptyHint="Set a goal to track consistency and discipline. Start with something like net P&L per week, a journaling rate, or an average day rating."
        emptyAction={<button className="btn primary" onClick={() => setCreating(true)}>Create your first goal</button>}>
        {(goals) => {
          const performance = goals.filter((g) => g.progress.category === 'performance');
          const behavioral = goals.filter((g) => g.progress.category === 'behavioral');
          return (
            <>
              {performance.length > 0 && (
                <section className="stack" style={{ gap: 10 }}>
                  <h2>Performance</h2>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                    {performance.map((g) => <GoalCard key={g.id} goal={g} ccy={ccy} onEdit={() => setEditing(g)} api={api} onChanged={goalsQ.refetch} />)}
                  </div>
                </section>
              )}
              {behavioral.length > 0 && (
                <section className="stack" style={{ gap: 10 }}>
                  <h2>Discipline</h2>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                    {behavioral.map((g) => <GoalCard key={g.id} goal={g} ccy={ccy} onEdit={() => setEditing(g)} api={api} onChanged={goalsQ.refetch} />)}
                  </div>
                </section>
              )}
            </>
          );
        }}
      </Query>

      <div className="card">
        <h3>Daily net P&L (selected range)</h3>
        <Query result={activityQ} isEmpty={(r) => r.length === 0} emptyTitle="No activity in this range">
          {(rows) => <NetPnlBarChart data={rows.map((r) => ({ label: r.key.slice(5), netPnl: r.netPnl }))} currency={ccy} />}
        </Query>
      </div>

      {(creating || editing) && (
        <GoalForm accountId={id} ccy={ccy} initial={editing} api={api} onClose={closeForm} onSaved={afterSave} />
      )}
    </div>
  );
}

function GoalCard({ goal, ccy, onEdit, api, onChanged }: {
  goal: GoalWithProgress; ccy: string; onEdit: () => void; api: ReturnType<typeof useApp>['api']; onChanged: () => void;
}): JSX.Element {
  const p = goal.progress;
  const def = METRIC_DEFS[goal.metric];
  const st = status(p);
  const pauseResume = useMutation(() => api.updateGoal(goal.id, { status: goal.status === 'active' ? 'paused' : 'active' }));
  const reset = useMutation(() => api.resetGoal(goal.id));
  const del = useMutation(() => api.deleteGoal(goal.id));

  const act = async (run: () => Promise<unknown>): Promise<void> => { const r = await run(); if (r !== undefined) onChanged(); };

  return (
    <div className="card" style={{ opacity: goal.status === 'paused' ? 0.72 : 1 }}>
      <div className="row between">
        <div>
          <div style={{ fontWeight: 650 }}>{def.label}</div>
          <div className="dim" style={{ fontSize: '0.8em' }}>{PERIOD_LABEL[goal.period]} target {goal.direction === 'at_most' ? 'at most' : 'at least'} {fmt(p.unit, goal.target, ccy)}</div>
        </div>
        <span className={`chip ${st.cls}`}>{st.label}</span>
      </div>

      <div className="row" style={{ alignItems: 'baseline', gap: 6, margin: '10px 0 2px' }}>
        <span className="mono" style={{ fontSize: '1.5rem', fontWeight: 650 }}>{fmt(p.unit, p.current, ccy)}</span>
        <span className="dim" style={{ fontSize: '0.82em' }}>{remainingText(p, ccy)}</span>
      </div>
      <ProgressBar fraction={p.fraction} tone={st.tone} ariaLabel={`${def.label} progress`} />

      <div className="row between" style={{ marginTop: 12 }}>
        <HistorySparkline history={p.history} />
        <div className="row" style={{ gap: 2 }}>
          <IconBtn label="Edit goal" onClick={onEdit}><Pencil size={15} /></IconBtn>
          <IconBtn label={goal.status === 'active' ? 'Pause goal' : 'Resume goal'} disabled={pauseResume.pending} onClick={() => act(pauseResume.run)}>
            {goal.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
          </IconBtn>
          <IconBtn label="Reset goal" disabled={reset.pending} onClick={() => { if (confirm('Reset this goal? Progress and history will restart from now.')) act(reset.run); }}>
            <RotateCcw size={15} />
          </IconBtn>
          <IconBtn label="Delete goal" danger disabled={del.pending} onClick={() => { if (confirm('Delete this goal? This cannot be undone.')) act(del.run); }}>
            <Trash2 size={15} />
          </IconBtn>
        </div>
      </div>
      {p.sampleSize === 0 && p.current === null && (
        <div className="hintbar" style={{ marginTop: 8 }}>{def.help}</div>
      )}
    </div>
  );
}

function IconBtn({ children, label, onClick, danger, disabled }: {
  children: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}): JSX.Element {
  return (
    <button className="btn sm" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      style={{ border: 0, background: 'transparent', display: 'inline-flex', color: danger ? 'var(--neg)' : 'var(--text)' }}>
      {children}
    </button>
  );
}

function HistorySparkline({ history }: { history: GoalProgress['history'] }): JSX.Element {
  if (history.length === 0) return <span className="dim" style={{ fontSize: '0.78em' }}>No history yet</span>;
  return (
    <span className="spark" aria-label="recent periods">
      {history.map((h) => (
        <span key={h.key} className={`seg ${h.met === true ? 'ok' : h.met === false ? 'bad' : ''}`}
          style={{ height: h.value === null ? 6 : 18 }} title={`${h.key}: ${h.value === null ? 'no data' : h.value}`} />
      ))}
    </span>
  );
}

function GoalForm({ accountId, ccy, initial, api, onClose, onSaved }: {
  accountId: string; ccy: string; initial: GoalWithProgress | null;
  api: ReturnType<typeof useApp>['api']; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const [metric, setMetric] = useState<GoalMetric>(initial?.metric ?? 'net_pnl');
  const [period, setPeriod] = useState<GoalPeriod>(initial?.period ?? 'weekly');
  const [direction, setDirection] = useState<GoalDirection>(initial?.direction ?? METRIC_DEFS[metric].defaultDirection);
  const [target, setTarget] = useState<string>(initial ? String(initial.target) : '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation(async () => {
    const value = Number(target);
    const err = validateGoalTarget(metric, direction, value);
    if (err) { setError(err); return undefined; }
    if (initial) return api.updateGoal(initial.id, { metric, period, direction, target: value });
    return api.createGoal(accountId, { metric, period, direction, target: value });
  });
  const def = METRIC_DEFS[metric];

  // When the metric changes, snap direction to one it allows.
  useEffect(() => {
    if (!def.allowedDirections.includes(direction)) setDirection(def.defaultDirection);
  }, [metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const r = await save.run();
    if (r !== undefined) onSaved();
  };

  const unitHint = def.unit === 'currency' ? ccy : def.unit === 'percent' ? '%' : def.unit === 'r' ? 'R' : def.unit === 'rating' ? '1-5' : 'count';

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={initial ? 'Edit goal' : 'New goal'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="sheet" onSubmit={submit}>
        <h2>{initial ? 'Edit goal' : 'New goal'}</h2>
        <div className="field">
          <label htmlFor="gm">Metric</label>
          <select id="gm" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)} style={{ width: '100%' }} disabled={!!initial}>
            <optgroup label="Performance">
              {METRICS.filter((m) => METRIC_DEFS[m].category === 'performance').map((m) => <option key={m} value={m}>{METRIC_DEFS[m].label}</option>)}
            </optgroup>
            <optgroup label="Discipline">
              {METRICS.filter((m) => METRIC_DEFS[m].category === 'behavioral').map((m) => <option key={m} value={m}>{METRIC_DEFS[m].label}</option>)}
            </optgroup>
          </select>
          <span className="hintbar">{def.help}</span>
        </div>
        <div className="field">
          <label>Period</label>
          <div className="segmented" role="group" aria-label="Period">
            {(['daily', 'weekly', 'monthly'] as GoalPeriod[]).map((pp) => (
              <button type="button" key={pp} aria-pressed={period === pp} onClick={() => setPeriod(pp)}>{PERIOD_LABEL[pp]}</button>
            ))}
          </div>
        </div>
        {def.allowedDirections.length > 1 && (
          <div className="field">
            <label htmlFor="gd">Objective</label>
            <select id="gd" value={direction} onChange={(e) => setDirection(e.target.value as GoalDirection)}>
              <option value="at_least">At least (minimum)</option>
              <option value="at_most">At most (budget)</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="gt">Target ({unitHint})</label>
          <input id="gt" type="number" step={def.integer ? '1' : 'any'} value={target}
            onChange={(e) => setTarget(e.target.value)} required style={{ width: '100%' }} />
          {(def.min !== undefined || def.max !== undefined) && (
            <span className="hintbar">
              {def.min !== undefined && def.max !== undefined ? `Between ${def.min} and ${def.max}.`
                : def.min !== undefined ? `At least ${def.min}.` : `At most ${def.max}.`}
            </span>
          )}
        </div>
        {error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="row between">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={save.pending}>{save.pending ? 'Saving...' : initial ? 'Save changes' : 'Create goal'}</button>
        </div>
      </form>
    </div>
  );
}
