import { useMemo } from 'react';
import { money } from '../format.js';

export interface DayPnl { date: string; netPnl: number; trades: number }

/**
 * Month calendar colored by daily net P&L (green profit / red loss), opacity
 * scaled to the day's magnitude vs. the month's max. `data` keys are YYYY-MM-DD.
 */
export function CalendarHeatmap({ data, currency, monthMs }: { data: DayPnl[]; currency: string; monthMs?: number }): JSX.Element {
  const byDate = useMemo(() => new Map(data.map((d) => [d.date, d])), [data]);
  const maxAbs = useMemo(() => Math.max(1, ...data.map((d) => Math.abs(d.netPnl))), [data]);

  const anchor = monthMs ?? (data.length ? Date.parse(`${data[data.length - 1]!.date}T00:00:00Z`) : Date.now());
  const d = new Date(anchor);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: Array<DayPnl & { day: number } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hit = byDate.get(key);
    cells.push({ day, date: key, netPnl: hit?.netPnl ?? 0, trades: hit?.trades ?? 0 });
  }

  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <strong>{label}</strong>
        <span className="dim" style={{ fontSize: '0.82em' }}>daily net P&L</span>
      </div>
      <div className="cal">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w} className="dow">{w}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="cell empty" />;
          const has = c.trades > 0;
          const intensity = has ? 0.15 + 0.6 * (Math.abs(c.netPnl) / maxAbs) : 0;
          const bg = !has ? 'var(--surface)' : c.netPnl >= 0
            ? `color-mix(in srgb, var(--pos) ${Math.round(intensity * 100)}%, var(--surface))`
            : `color-mix(in srgb, var(--neg) ${Math.round(intensity * 100)}%, var(--surface))`;
          return (
            <div key={i} className="cell" style={{ background: bg }} title={has ? `${c.date}: ${money(c.netPnl, currency)} (${c.trades} trades)` : c.date}>
              <span className="d">{c.day}</span>
              {has && <span className="p mono">{c.netPnl >= 0 ? '+' : ''}{Math.round(c.netPnl)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
