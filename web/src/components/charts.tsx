import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import type { EquityPoint } from '../api/types.js';
import { money, dateOnly } from '../format.js';

const AXIS = 'var(--text-dim)';
const GRID = 'var(--border)';

export function CumulativePnlChart({ data, currency }: { data: EquityPoint[]; currency: string }): JSX.Element {
  const rows = data.map((p, i) => ({ i, equity: p.equity, pnl: p.cumulativePnl, t: p.closeTime }));
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="i" tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(i) => (rows[i] ? dateOnly(rows[i]!.t) : '')} minTickGap={40} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v) => money(v, currency)} width={78} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            labelFormatter={(i) => (rows[i as number] ? dateOnly(rows[i as number]!.t) : '')}
            formatter={(v: number, name) => [money(v, currency), name === 'equity' ? 'Equity' : 'Cum. P&L']}
          />
          <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} fill="url(#eq)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetPnlBarChart({ data, currency }: { data: { label: string; netPnl: number }[]; currency: string }): JSX.Element {
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} interval={0} angle={data.length > 8 ? -35 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 60 : 24} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v) => money(v, currency)} width={78} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            formatter={(v: number) => [money(v, currency), 'Net P&L']}
          />
          <ReferenceLine y={0} stroke={AXIS} />
          <Bar dataKey="netPnl" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.netPnl >= 0 ? 'var(--pos)' : 'var(--neg)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
