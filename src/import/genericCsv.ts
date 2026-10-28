/**
 * Generic, broker-agnostic CSV importer (spec A3).
 *
 * We define our OWN explicit executions-level schema rather than copying any
 * broker's columns. Per-broker preset mappings can be added by supplying a
 * ColumnMapping. Supports stocks, futures, options, forex, crypto.
 *
 * Canonical columns (header names, case-insensitive; aliases accepted):
 *   account, symbol, instrument_type, side, quantity, price, timestamp,
 *   multiplier?, commission?, fees?, swap?
 */
import type { Execution, InstrumentType, FillSide } from '../domain/types.js';

export interface ColumnMapping {
  account?: string[];
  symbol: string[];
  instrumentType: string[];
  side: string[];
  quantity: string[];
  price: string[];
  timestamp: string[];
  multiplier?: string[];
  commission?: string[];
  fees?: string[];
  swap?: string[];
}

export const GENERIC_MAPPING: ColumnMapping = {
  account: ['account', 'account_id', 'accountname'],
  symbol: ['symbol', 'ticker', 'instrument'],
  instrumentType: ['instrument_type', 'type', 'asset_class', 'assetclass'],
  side: ['side', 'action', 'direction', 'b/s'],
  quantity: ['quantity', 'qty', 'size', 'shares', 'contracts', 'volume'],
  price: ['price', 'fill_price', 'avg_price', 'executionprice'],
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'executed_at', 'fill_time'],
  multiplier: ['multiplier', 'contract_multiplier', 'point_value'],
  commission: ['commission', 'commissions', 'comm'],
  fees: ['fees', 'fee'],
  swap: ['swap', 'rollover'],
};

export interface ImportDefaults {
  account?: string;
  instrumentType?: InstrumentType;
  multiplier?: number;
}

export interface RowError {
  row: number; // 1-based data row (excludes header)
  message: string;
  raw: Record<string, string>;
}

export interface ImportResult {
  executions: Execution[];
  errors: RowError[];
}

/** RFC-4180-ish CSV parser: handles quotes, escaped quotes, CRLF, embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip leading UTF-8 BOM if present
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '') || rows.length === 0) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  return rows;
}

const normSide = (v: string): FillSide | null => {
  const x = v.trim().toLowerCase();
  if (['buy', 'b', 'long', 'bought', 'bot'].includes(x)) return 'buy';
  if (['sell', 's', 'short', 'sold', 'sld'].includes(x)) return 'sell';
  return null;
};

const normInstrument = (v: string | undefined, fallback?: InstrumentType): InstrumentType | null => {
  const x = (v ?? '').trim().toLowerCase();
  const map: Record<string, InstrumentType> = {
    stock: 'stock', stocks: 'stock', equity: 'stock', shares: 'stock',
    option: 'option', options: 'option', opt: 'option',
    future: 'future', futures: 'future', fut: 'future',
    forex: 'forex', fx: 'forex', currency: 'forex',
    crypto: 'crypto', cryptocurrency: 'crypto', coin: 'crypto',
  };
  return map[x] ?? fallback ?? null;
};

function parseTimestamp(v: string): number | null {
  const x = v.trim();
  if (/^\d{10}$/.test(x)) return Number(x) * 1000; // epoch seconds
  if (/^\d{13}$/.test(x)) return Number(x); // epoch ms
  const t = Date.parse(x);
  return Number.isNaN(t) ? null : t;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const x = v.replace(/[$,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  if (x === '') return null;
  const n = Number(x);
  return Number.isNaN(n) ? null : n;
};

function buildHeaderIndex(header: string[]): Map<string, number> {
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h.trim().toLowerCase(), i));
  return idx;
}

function pick(
  cells: string[],
  idx: Map<string, number>,
  aliases: string[] | undefined,
): string | undefined {
  if (!aliases) return undefined;
  for (const a of aliases) {
    const i = idx.get(a.toLowerCase());
    if (i !== undefined) return cells[i];
  }
  return undefined;
}

export function importExecutionsFromCsv(
  csvText: string,
  opts: { mapping?: ColumnMapping; defaults?: ImportDefaults } = {},
): ImportResult {
  const mapping = opts.mapping ?? GENERIC_MAPPING;
  const defaults = opts.defaults ?? {};
  const rows = parseCsv(csvText);
  const executions: Execution[] = [];
  const errors: RowError[] = [];
  if (rows.length === 0) return { executions, errors };

  const header = rows[0]!;
  const idx = buildHeaderIndex(header);

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const raw: Record<string, string> = {};
    header.forEach((h, i) => (raw[h] = cells[i] ?? ''));
    const fail = (message: string) => errors.push({ row: r, message, raw });

    const symbol = (pick(cells, idx, mapping.symbol) ?? '').trim();
    const sideRaw = pick(cells, idx, mapping.side) ?? '';
    const qty = num(pick(cells, idx, mapping.quantity));
    const price = num(pick(cells, idx, mapping.price));
    const tsRaw = pick(cells, idx, mapping.timestamp) ?? '';

    const side = normSide(sideRaw);
    const instrumentType = normInstrument(
      pick(cells, idx, mapping.instrumentType),
      defaults.instrumentType,
    );
    const timestamp = parseTimestamp(tsRaw);
    const account = (pick(cells, idx, mapping.account) ?? defaults.account ?? '').trim();

    if (!symbol) { fail('missing symbol'); continue; }
    if (!side) { fail(`unrecognized side "${sideRaw}"`); continue; }
    if (qty === null || qty <= 0) { fail(`invalid quantity "${pick(cells, idx, mapping.quantity)}"`); continue; }
    if (price === null || price < 0) { fail(`invalid price "${pick(cells, idx, mapping.price)}"`); continue; }
    if (timestamp === null) { fail(`unparseable timestamp "${tsRaw}"`); continue; }
    if (!instrumentType) { fail('missing/unknown instrument_type (and no default)'); continue; }
    if (!account) { fail('missing account (and no default)'); continue; }

    const execution: Execution = {
      id: `imp_${r}`,
      accountId: account,
      symbol,
      instrumentType,
      side,
      quantity: qty,
      price,
      timestamp,
      multiplier: num(pick(cells, idx, mapping.multiplier)) ?? defaults.multiplier ?? 1,
      commission: num(pick(cells, idx, mapping.commission)) ?? 0,
      fees: num(pick(cells, idx, mapping.fees)) ?? 0,
      swap: num(pick(cells, idx, mapping.swap)) ?? 0,
    };
    executions.push(execution);
  }

  return { executions, errors };
}
