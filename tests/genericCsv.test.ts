import { describe, it, expect } from 'vitest';
import { importExecutionsFromCsv, parseCsv } from '../src/import/genericCsv.js';
import { buildTrades } from '../src/metrics/trade.js';

describe('parseCsv', () => {
  it('handles quotes, embedded commas and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });

  it('strips a leading UTF-8 BOM from the first header', () => {
    const bom = String.fromCharCode(0xfeff);
    const rows = parseCsv(`${bom}symbol,side\nAAPL,buy\n`);
    expect(rows[0]).toEqual(['symbol', 'side']);
  });
});

describe('importExecutionsFromCsv', () => {
  // Multiplier is a per-instrument property, carried per row (blank => 1 for stocks).
  const csv = [
    'Account,Symbol,Type,Side,Qty,Price,Time,Commission,Multiplier',
    'A1,AAPL,stock,BUY,100,10,2024-01-02T09:30:00Z,1,',
    'A1,AAPL,stock,SELL,100,12,2024-01-02T10:00:00Z,1,',
    'A1,ES,futures,buy,1,5000,2024-01-02T11:00:00Z,2,50',
    'A1,ES,futures,sell,1,5005,2024-01-02T11:30:00Z,2,50',
  ].join('\n');

  it('maps aliased headers and normalizes values', () => {
    const { executions, errors } = importExecutionsFromCsv(csv);
    expect(errors).toHaveLength(0);
    expect(executions).toHaveLength(4);
    expect(executions[0]!.side).toBe('buy');
    expect(executions[0]!.instrumentType).toBe('stock');
    expect(executions[0]!.multiplier).toBe(1); // blank => default 1
    expect(executions[2]!.multiplier).toBe(50); // ES futures
    expect(executions[0]!.timestamp).toBe(Date.parse('2024-01-02T09:30:00Z'));
  });

  it('round-trips into aggregated trades', () => {
    const { executions } = importExecutionsFromCsv(csv);
    const trades = buildTrades(executions);
    expect(trades).toHaveLength(2);
    const aapl = trades.find((t) => t.symbol === 'AAPL')!;
    expect(aapl.netPnl).toBe(200 - 2); // (12-10)*100 - 2 comm, multiplier 1
    const es = trades.find((t) => t.symbol === 'ES')!;
    expect(es.netPnl).toBe(5 * 1 * 50 - 4); // (5005-5000)*1*50 - 4 comm
  });

  it('reports per-row errors without throwing', () => {
    const bad = [
      'Symbol,Type,Side,Qty,Price,Time',
      ',stock,buy,1,10,2024-01-01', // missing symbol
      'AAPL,stock,hold,1,10,2024-01-01', // bad side
      'AAPL,stock,buy,-1,10,2024-01-01', // bad qty
      'AAPL,stock,buy,1,10,not-a-date', // bad time
    ].join('\n');
    const { executions, errors } = importExecutionsFromCsv(bad, { defaults: { account: 'A1' } });
    expect(executions).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([1, 2, 3, 4]);
  });
});
