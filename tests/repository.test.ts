import { describe, it, expect, beforeEach } from 'vitest';
import { Repository } from '../src/db/repository.js';

describe('Repository (in-memory SQLite)', () => {
  let repo: Repository;
  beforeEach(() => {
    repo = new Repository(':memory:');
  });

  it('persists executions and derives trades + stats', () => {
    const acct = repo.createAccount({ name: 'Main', currency: 'USD', startingBalance: 10000, kind: 'live' });
    repo.addExecutions(acct.id, [
      { id: 'a', symbol: 'AAPL', instrumentType: 'stock', side: 'buy', quantity: 100, price: 10, timestamp: 1, commission: 1 },
      { id: 'b', symbol: 'AAPL', instrumentType: 'stock', side: 'sell', quantity: 100, price: 12, timestamp: 2, commission: 1 },
    ]);
    const trades = repo.getTrades(acct.id);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.netPnl).toBe(198);
    expect(repo.getStats(acct.id).netPnl).toBe(198);
    expect(repo.getAccountBalance(acct.id)).toBe(10198);
  });

  it('stores trade annotations keyed by deterministic id and recomputes R', () => {
    const acct = repo.createAccount({ name: 'M', currency: 'USD', startingBalance: 0, kind: 'live' });
    repo.addExecutions(acct.id, [
      { symbol: 'AAPL', instrumentType: 'stock', side: 'buy', quantity: 100, price: 10, timestamp: 1 },
      { symbol: 'AAPL', instrumentType: 'stock', side: 'sell', quantity: 100, price: 13, timestamp: 2 },
    ]);
    const [t] = repo.getTrades(acct.id);
    repo.setTradeAnnotation(t!.id, { stopLoss: 9, setup: 'breakout', tags: ['momo'] });
    const [t2] = repo.getTrades(acct.id); // rebuilt from executions; annotation must survive
    expect(t2!.annotations?.setup).toBe('breakout');
    expect(t2!.rMultiple).toBe(3);
  });

  it('imports CSV directly into an account', () => {
    const acct = repo.createAccount({ name: 'Imp', currency: 'USD', startingBalance: 0, kind: 'live' });
    const csv = [
      'Symbol,Type,Side,Qty,Price,Time,Commission',
      'TSLA,stock,buy,10,100,2024-01-02T14:00:00Z,1',
      'TSLA,stock,sell,10,110,2024-01-02T15:00:00Z,1',
    ].join('\n');
    const result = repo.importCsv(acct.id, csv);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(repo.getStats(acct.id).netPnl).toBe(98);
  });

  it('balance transactions affect account balance', () => {
    const acct = repo.createAccount({ name: 'B', currency: 'USD', startingBalance: 1000, kind: 'live' });
    repo.addBalanceTransaction({ accountId: acct.id, timestamp: 1, amount: 500, kind: 'deposit' });
    repo.addBalanceTransaction({ accountId: acct.id, timestamp: 2, amount: -200, kind: 'withdrawal' });
    expect(repo.getAccountBalance(acct.id)).toBe(1300);
  });

  it('equity curve runs from starting balance using backend netPnl', () => {
    const acct = repo.createAccount({ name: 'Eq', currency: 'USD', startingBalance: 1000, kind: 'live' });
    repo.addExecutions(acct.id, [
      { symbol: 'AAPL', instrumentType: 'stock', side: 'buy', quantity: 10, price: 10, timestamp: 1 },
      { symbol: 'AAPL', instrumentType: 'stock', side: 'sell', quantity: 10, price: 15, timestamp: 2 },
    ]);
    const eq = repo.getEquity(acct.id);
    expect(eq.at(-1)!.equity).toBe(1050);
  });

  it('notes CRUD (notebook), including trade link', () => {
    const acct = repo.createAccount({ name: 'N', currency: 'USD', startingBalance: 0, kind: 'live' });
    const n = repo.upsertNote({ accountId: acct.id, title: 'Plan', body: 'ORB only', tags: ['plan'] });
    expect(repo.listNotes(acct.id)).toHaveLength(1);
    const updated = repo.upsertNote({ id: n.id, accountId: acct.id, title: 'Plan v2', tradeId: 'A:AAPL:1' });
    expect(updated.title).toBe('Plan v2');
    expect(updated.createdAt).toBe(n.createdAt); // createdAt preserved
    expect(repo.getNote(n.id)!.tradeId).toBe('A:AAPL:1');
    expect(repo.deleteNote(n.id)).toBe(true);
    expect(repo.listNotes(acct.id)).toHaveLength(0);
  });

  it('CRUD for strategies, tags, journal', () => {
    const acct = repo.createAccount({ name: 'C', currency: 'USD', startingBalance: 0, kind: 'live' });
    repo.createStrategy({ name: 'ORB', rules: ['break open range'] });
    repo.createTag({ label: 'A+', category: 'setup' });
    repo.upsertJournalEntry({ accountId: acct.id, date: '2024-01-02', body: 'good day', rating: 5 });
    expect(repo.listStrategies()[0]!.rules).toEqual(['break open range']);
    expect(repo.listTags()[0]!.label).toBe('A+');
    expect(repo.listJournal(acct.id)[0]!.rating).toBe(5);
  });
});
