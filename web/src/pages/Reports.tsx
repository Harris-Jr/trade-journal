import { useState } from 'react';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { NetPnlBarChart } from '../components/charts.js';
import { money, signedMoney, pct, ratio, pnlClass } from '../format.js';
import type { ReportDimension, SortBy } from '../api/types.js';

const DIMENSIONS: { key: ReportDimension; label: string }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'setup', label: 'Setup' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'tag', label: 'Tag' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'dayOfWeek', label: 'Day of week' },
  { key: 'hourOfDay', label: 'Hour of day' },
  { key: 'duration', label: 'Hold duration' },
];
const SORTS: { key: SortBy; label: string }[] = [
  { key: 'netPnl', label: 'Net P&L' },
  { key: 'trades', label: '# Trades' },
  { key: 'key', label: 'Label' },
];
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function Reports(): JSX.Element {
  const { api, selectedAccountId, selectedAccount, range } = useApp();
  const id = selectedAccountId!;
  const ccy = selectedAccount?.currency ?? 'USD';
  const [dim, setDim] = useState<ReportDimension>('symbol');
  const [sortBy, setSortBy] = useState<SortBy>('netPnl');

  const q = useQuery(
    () => api.getReport(id, dim, { sortBy, tz: localTz, range }),
    [id, dim, sortBy, range.from, range.to],
  );

  return (
    <div className="stack">
      <h1>Reports</h1>
      <div className="row">
        <label style={{ margin: 0 }}>Breakdown{' '}
          <select value={dim} onChange={(e) => setDim(e.target.value as ReportDimension)} aria-label="Report dimension">
            {DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>Sort by{' '}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Sort by">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <Query result={q} isEmpty={(rows) => rows.length === 0} emptyTitle="No data for this breakdown">
        {(rows) => (
          <>
            <div className="card">
              <h3>Net P&L by {DIMENSIONS.find((d) => d.key === dim)?.label.toLowerCase()}</h3>
              <NetPnlBarChart data={rows.slice(0, 20).map((r) => ({ label: r.label, netPnl: r.netPnl }))} currency={ccy} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{DIMENSIONS.find((d) => d.key === dim)?.label}</th>
                    <th className="num">Trades</th>
                    <th className="num">Net P&L</th>
                    <th className="num">Win rate</th>
                    <th className="num">Profit factor</th>
                    <th className="num">Expectancy</th>
                    <th className="num">Avg win/loss</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{r.trades}</td>
                      <td className={`num ${pnlClass(r.netPnl)}`}>{signedMoney(r.netPnl, ccy)}</td>
                      <td className="num">{pct(r.stats.winRate)}</td>
                      <td className="num">{ratio(r.stats.profitFactor)}</td>
                      <td className="num">{money(r.stats.expectancy, ccy)}</td>
                      <td className="num">{ratio(r.stats.payoffRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hintbar">Calendar breakdowns use your local timezone ({localTz}). All figures come from the backend reporting engine.</p>
          </>
        )}
      </Query>
    </div>
  );
}
