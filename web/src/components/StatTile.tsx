import type { ReactNode } from 'react';

export function StatTile({ label, value, sub, tone }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'pos' | 'neg' | 'flat';
}): JSX.Element {
  return (
    <div className="tile">
      <div className="k">{label}</div>
      <div className={`v mono ${tone ?? ''}`}>{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  );
}
