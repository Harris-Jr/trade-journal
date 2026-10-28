import { ArrowRight } from 'lucide-react';
import { useApp, type RangePreset } from '../state/app.js';

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
];

const toInput = (ms?: number): string => (ms === undefined ? '' : new Date(ms).toISOString().slice(0, 10));
const fromInput = (v: string): number | undefined => (v ? Date.parse(`${v}T00:00:00Z`) : undefined);

export function DateRangeControls(): JSX.Element {
  const { rangePreset, setRangePreset, customRange, setCustomRange } = useApp();
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="segmented" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.key} aria-pressed={rangePreset === p.key} onClick={() => setRangePreset(p.key)}>{p.label}</button>
        ))}
      </div>
      {rangePreset === 'custom' && (
        <div className="row" style={{ gap: 6 }}>
          <input aria-label="From date" type="date" value={toInput(customRange.from)}
            onChange={(e) => setCustomRange({ ...customRange, from: fromInput(e.target.value) })} />
          <span className="dim" aria-hidden="true"><ArrowRight size={14} /></span>
          <input aria-label="To date" type="date" value={toInput(customRange.to)}
            onChange={(e) => setCustomRange({ ...customRange, to: fromInput(e.target.value) })} />
        </div>
      )}
    </div>
  );
}
