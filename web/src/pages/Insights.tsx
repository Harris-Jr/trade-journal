import { useNavigate } from 'react-router-dom';
import { Lightbulb, AlertTriangle, Info, CircleAlert } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import type { Insight, InsightSeverity } from '../api/types.js';

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const sevChip: Record<InsightSeverity, string> = { high: 'bad', medium: 'warn', low: '' };
const SevIcon = ({ s }: { s: InsightSeverity }): JSX.Element =>
  s === 'high' ? <AlertTriangle size={15} /> : s === 'medium' ? <CircleAlert size={15} /> : <Info size={15} />;

export function Insights(): JSX.Element {
  const { api, selectedAccountId, range } = useApp();
  const navigate = useNavigate();
  const id = selectedAccountId!;
  const q = useQuery(() => api.getInsights(id, { range, tz: localTz }), [id, range.from, range.to]);

  return (
    <div className="stack">
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Lightbulb size={22} /> Insights</h1>
      <p className="hintbar" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, maxWidth: 760 }}>
        <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Heuristic observations detected from your own trades and journal in the selected range. They describe
        patterns in the data, not advice, and a flag does not prove a behavior caused a result. Thresholds are documented and adjustable via the API.
      </p>

      <Query result={q} isEmpty={(r) => r.insights.length === 0}
        emptyTitle={q.data && q.data.closedTrades === 0 ? 'No closed trades in this range' : 'No behavioral flags in this range'}
        emptyHint={q.data && q.data.closedTrades === 0 ? 'Import or add trades, or widen the date range.' : 'Nothing stood out against the current thresholds. Widen the range to review more activity.'}>
        {(r) => (
          <>
            <div className="row" style={{ gap: 6 }}>
              <span className="dim" style={{ fontSize: '0.85em' }}>{r.insights.length} flag(s) across {r.closedTrades} closed trades:</span>
              {r.summary.map((s) => <span key={s.type} className="badge">{label(s.type)}: {s.count}</span>)}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {r.insights.map((i) => <InsightCard key={i.id} insight={i} onOpenTrade={(tid) => navigate(`/trades/${encodeURIComponent(tid)}`)} />)}
            </div>
          </>
        )}
      </Query>
    </div>
  );
}

function InsightCard({ insight: i, onOpenTrade }: { insight: Insight; onOpenTrade: (tradeId: string) => void }): JSX.Element {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className={`chip ${sevChip[i.severity]}`}><SevIcon s={i.severity} /> {i.severity}</span>
          <strong>{i.title}</strong>
        </div>
        {i.level === 'trade' && i.tradeId
          ? <button className="btn sm" onClick={() => onOpenTrade(i.tradeId!)}>{i.symbol ? `${i.symbol} trade` : 'Open trade'}</button>
          : i.date ? <span className="dim" style={{ fontSize: '0.82em' }}>{i.date}</span> : null}
      </div>
      <p className="dim" style={{ margin: '6px 0 0', fontSize: '0.9em' }}>{i.detail}</p>
    </div>
  );
}

function label(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
