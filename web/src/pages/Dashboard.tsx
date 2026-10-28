import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { StatTile } from '../components/StatTile.js';
import { CumulativePnlChart } from '../components/charts.js';
import { CalendarHeatmap, type DayPnl } from '../components/CalendarHeatmap.js';
import { money, signedMoney, pct, ratio, pnlClass, duration, dateTime } from '../format.js';
import type { HealthScore } from '../api/types.js';

export function Dashboard(): JSX.Element {
  const { api, selectedAccountId, selectedAccount, range } = useApp();
  const navigate = useNavigate();
  const id = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';
  const key = [id, range.from, range.to];

  const stats = useQuery(() => api.getStats(id, range), key);
  const equity = useQuery(() => api.getEquity(id, range), key);
  const health = useQuery(() => api.getHealthScore(id, range), key);
  const days = useQuery(() => api.getReport(id, 'day', { range, sortBy: 'key' }), key);
  const recent = useQuery(() => api.queryTrades(id, { range, status: 'closed', sortBy: 'closeTime', sortDir: 'desc', limit: 8 }), key);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Dashboard</h1>
      </div>

      <Query result={stats} isEmpty={(s) => s.trades === 0} emptyTitle="No trades in this range"
        emptyHint="Import a CSV, add a trade, or widen the date range."
        emptyAction={<Link className="btn primary" to="/import">Import trades</Link>}>
        {(s) => (
          <div className="tiles">
            <StatTile label="Net P&L" value={signedMoney(s.netPnl, ccy)} tone={pnlClass(s.netPnl) as 'pos' | 'neg' | 'flat'} sub={`${s.trades} trades`} />
            <StatTile label="Win rate" value={pct(s.winRate)} sub={`${s.wins}W / ${s.losses}L / ${s.breakeven}BE`} />
            <StatTile label="Profit factor" value={ratio(s.profitFactor)} />
            <StatTile label="Expectancy" value={money(s.expectancy, ccy)} sub="per trade" />
            <StatTile label="Avg win / loss" value={ratio(s.payoffRatio)} sub={`${money(s.avgWin, ccy)} / ${money(s.avgLoss, ccy)}`} />
            <StatTile label="Max drawdown" value={money(s.drawdown.maxDrawdown, ccy)} tone="neg" sub={`${s.drawdown.maxDrawdownPct.toFixed(1)}%`} />
            <StatTile label="Avg hold" value={duration(s.avgDurationMs)} />
            <StatTile label="Streaks" value={`${s.maxConsecutiveWins}W - ${s.maxConsecutiveLosses}L`} sub="max consecutive" />
          </div>
        )}
      </Query>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div className="card">
          <h3>Cumulative P&L</h3>
          <Query result={equity} isEmpty={(e) => e.length === 0} emptyTitle="No closed trades yet">
            {(e) => <CumulativePnlChart data={e} currency={ccy} />}
          </Query>
        </div>
        <div className="card">
          <h3>Zella-style Health Score</h3>
          <Query result={health}>{(h) => <HealthScoreView h={h} />}</Query>
        </div>
      </div>

      <div className="card">
        <h3>Calendar</h3>
        <Query result={days} isEmpty={(d) => d.length === 0} emptyTitle="No daily data">
          {(d) => {
            const dayData: DayPnl[] = d.map((r) => ({ date: r.key, netPnl: r.netPnl, trades: r.trades }));
            return <CalendarHeatmap data={dayData} currency={ccy} />;
          }}
        </Query>
      </div>

      <div className="card">
        <div className="row between"><h3>Recent trades</h3><Link to="/trades" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={14} /></Link></div>
        <Query result={recent} isEmpty={(t) => t.items.length === 0} emptyTitle="No trades">
          {(t) => (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th className="num">Net P&L</th><th className="num">R</th></tr></thead>
                <tbody>
                  {t.items.map((tr) => (
                    <tr key={tr.id} className="clickable" onClick={() => navigate(`/trades/${encodeURIComponent(tr.id)}`)}>
                      <td>{tr.closeTime ? dateTime(tr.closeTime) : '-'}</td>
                      <td><Link to={`/trades/${encodeURIComponent(tr.id)}`}>{tr.symbol}</Link></td>
                      <td>{tr.direction}</td>
                      <td className={`num ${pnlClass(tr.netPnl)}`}>{signedMoney(tr.netPnl, ccy)}</td>
                      <td className="num">{tr.rMultiple !== undefined ? `${tr.rMultiple.toFixed(2)}R` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Query>
      </div>
    </div>
  );
}

function HealthScoreView({ h }: { h: HealthScore }): JSX.Element {
  const labels: Record<string, string> = {
    profitFactor: 'Profit factor', avgWinLoss: 'Avg win/loss', maxDrawdown: 'Max drawdown',
    tradeWin: 'Trade win %', recoveryFactor: 'Recovery factor', consistency: 'Consistency',
  };
  return (
    <div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
        <div className="mono" style={{ fontSize: '2.4rem', fontWeight: 700 }}>{Math.round(h.total)}</div>
        <div className="dim">/ 100</div>
      </div>
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        {Object.entries(h.components).map(([k, c]) => (
          <div key={k}>
            <div className="row between" style={{ fontSize: '0.82em' }}>
              <span>{labels[k] ?? k} <span className="dim">- {Math.round(c.weight * 100)}%</span></span>
              <span className="mono">{Math.round(c.score)}</span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(0, Math.min(100, c.score))}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
