export type BarTone = 'accent' | 'pos' | 'neg' | 'warn';

/**
 * A progress bar whose fill settles with a near-critically-damped ease (see styles.css),
 * and that collapses to an indeterminate striped track when a percentage is not
 * meaningful (fraction === null). Width animates from the current rendered value,
 * so repeated renders stay smooth; the global reduced-motion rule removes the easing.
 */
export function ProgressBar({ fraction, tone = 'accent', ariaLabel }: {
  fraction: number | null;
  tone?: BarTone;
  ariaLabel?: string;
}): JSX.Element {
  if (fraction === null) {
    return <div className="progress-track indeterminate" role="img" aria-label={ariaLabel ?? 'no percentage available'} />;
  }
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={ariaLabel}
    >
      <div className={`progress-fill ${tone === 'accent' ? '' : tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
