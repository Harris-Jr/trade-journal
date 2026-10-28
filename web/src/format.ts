import type { MaybeInfinite } from './api/types.js';

export function money(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}
export function signedMoney(n: number, currency = 'USD'): string {
  return `${n > 0 ? '+' : ''}${money(n, currency)}`;
}
export function num(n: number, dp = 2): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp }).format(n);
}
export function pct(fraction: number, dp = 1): string {
  return `${(fraction * 100).toFixed(dp)}%`;
}
/** Render a stat that may be Infinity/NaN (serialized as a string by the API). */
export function ratio(v: MaybeInfinite, dp = 2): string {
  if (typeof v === 'string') return v === 'Infinity' ? '∞' : v === '-Infinity' ? '-∞' : '-';
  return v.toFixed(dp);
}
export function duration(ms: number): string {
  if (!ms || ms <= 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
export function dateOnly(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { dateStyle: 'medium' });
}
export function pnlClass(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat';
}
