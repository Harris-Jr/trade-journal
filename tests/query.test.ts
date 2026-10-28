import { describe, it, expect, beforeEach } from 'vitest';
import { Repository } from '../src/db/repository.js';

function seed(repo: Repository): string {
  const acct = repo.createAccount({ name: 'Q', currency: 'USD', startingBalance: 10000, kind: 'live' });
  repo.addExecutions(acct.id, [
    { symbol: 'AAPL', instrumentType: 'stock', side: 'buy', quantity: 100, price: 10, timestamp: 1000 },
    { symbol: 'AAPL', instrumentType: 'stock', side: 'sell', quantity: 100, price: 12, timestamp: 2000 }, // +200 @2000
    { symbol: 'TSLA', instrumentType: 'stock', side: 'buy', quantity: 10, price: 100, timestamp: 1500 },
    { symbol: 'TSLA', instrumentType: 'stock', side: 'sell', quantity: 10, price: 110, timestamp: 2500 }, // +100 @2500
    { symbol: 'AAPL', instrumentType: 'stock', side: 'buy', quantity: 100, price: 12, timestamp: 3000 },
    { symbol: 'AAPL', instrumentType: 'stock', side: 'sell', quantity: 100, price: 11, timestamp: 4000 }, // -100 @4000
    { symbol: 'MSFT', instrumentType: 'stock', side: 'buy', quantity: 5, price: 50, timestamp: 5000 }, // open
  ]);
  return acct.id;
}

describe('queryTrades - filtering/sorting/pagination', () => {
  let repo: Repository;
  let id: string;
  beforeEach(() => { repo = new Repository(':memory:'); id = seed(repo); });

  it('reports consistent totals and page metadata', () => {
    const p = repo.queryTrades(id, { limit: 2, offset: 0 });
    expect(p.page.total).toBe(4); // 3 closed + 1 open
    expect(p.items).toHaveLength(2);
    expect(p.page.hasMore).toBe(true);
    const p2 = repo.queryTrades(id, { limit: 2, offset: 2 });
    expect(p2.items).toHaveLength(2);
    expect(p2.page.hasMore).toBe(false);
  });

  it('handles an empty page past the end', () => {
    const p = repo.queryTrades(id, { limit: 10, offset: 100 });
    expect(p.items).toHaveLength(0);
    expect(p.page.total).toBe(4);
    expect(p.page.hasMore).toBe(false);
  });

  it('filters by symbol and status', () => {
    expect(repo.queryTrades(id, { limit: 50, offset: 0, symbol: 'AAPL' }).page.total).toBe(2);
    expect(repo.queryTrades(id, { limit: 50, offset: 0, status: 'closed' }).page.total).toBe(3);
    expect(repo.queryTrades(id, { limit: 50, offset: 0, status: 'open' }).page.total).toBe(1);
  });

  it('sorts deterministically', () => {
    const asc = repo.queryTrades(id, { limit: 50, offset: 0, sortBy: 'netPnl', sortDir: 'asc' });
    expect(asc.items[0]!.netPnl).toBe(-100);
    const asc2 = repo.queryTrades(id, { limit: 50, offset: 0, sortBy: 'netPnl', sortDir: 'asc' });
    expect(asc2.items.map((t) => t.id)).toEqual(asc.items.map((t) => t.id)); // stable
  });

  it('applies inclusive date boundaries', () => {
    expect(repo.queryTrades(id, { limit: 50, offset: 0, range: { from: 2000 } }).page.total).toBe(4); // @2000 included
    expect(repo.queryTrades(id, { limit: 50, offset: 0, range: { from: 2001 } }).page.total).toBe(3); // excludes the @2000 close
    expect(repo.queryTrades(id, { limit: 50, offset: 0, range: { to: 2500 } }).page.total).toBe(2); // @2000 and @2500
  });

  it('empty account yields an empty page, not an error', () => {
    const empty = repo.createAccount({ name: 'E', currency: 'USD', startingBalance: 0, kind: 'live' });
    const p = repo.queryTrades(empty.id, { limit: 25, offset: 0 });
    expect(p.items).toHaveLength(0);
    expect(p.page.total).toBe(0);
  });
});

describe('queryExecutions - SQL filtering/pagination', () => {
  let repo: Repository;
  let id: string;
  beforeEach(() => { repo = new Repository(':memory:'); id = seed(repo); });

  it('filters by symbol with correct total', () => {
    const p = repo.queryExecutions(id, { limit: 50, offset: 0, symbol: 'AAPL' });
    expect(p.page.total).toBe(4);
    expect(p.items.every((e) => e.symbol === 'AAPL')).toBe(true);
  });
  it('paginates', () => {
    const p = repo.queryExecutions(id, { limit: 3, offset: 0 });
    expect(p.items).toHaveLength(3);
    expect(p.page.total).toBe(7);
    expect(p.page.hasMore).toBe(true);
  });
});
