import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { propSummary, accountTotals } from '../src/analytics/propfirm.js';
import { Repository } from '../src/db/repository.js';
import { createApi } from '../src/server/api.js';
import type { PropAccount, PropTransaction } from '../src/domain/types.js';

const acct = (id: string, status: PropAccount['status']): PropAccount => ({
  id, userId: 'u', firm: 'FTMO', status, createdAt: 0, updatedAt: 0,
});
const tx = (propAccountId: string, amount: number, kind: PropTransaction['kind']): PropTransaction => ({
  id: `t${Math.random()}`, userId: 'u', propAccountId, amount, kind, timestamp: 0, createdAt: 0,
});

describe('propSummary', () => {
  it('aggregates cost, payout and net; missing is zero not invented', () => {
    const accounts = [acct('a', 'funded'), acct('b', 'evaluation'), acct('c', 'failed')];
    const txns = [
      tx('a', -150, 'evaluation_fee'), tx('a', 500, 'payout'),
      tx('b', -80, 'evaluation_fee'), tx('b', -80, 'reset_fee'),
      // c has no transactions
    ];
    const s = propSummary(accounts, txns);
    expect(s.accounts).toBe(3);
    expect(s.cost).toBe(310); // 150 + 80 + 80
    expect(s.payout).toBe(500);
    expect(s.net).toBe(190);
    expect(s.perAccount.find((p) => p.propAccountId === 'a')).toMatchObject({ cost: 150, payout: 500, net: 350 });
    expect(s.perAccount.find((p) => p.propAccountId === 'c')).toMatchObject({ cost: 0, payout: 0, net: 0 });
    expect(s.byStatus).toEqual(expect.arrayContaining([{ status: 'funded', count: 1 }, { status: 'evaluation', count: 1 }, { status: 'failed', count: 1 }]));
  });
  it('accountTotals ignores other accounts', () => {
    expect(accountTotals('a', [tx('a', -100, 'evaluation_fee'), tx('b', 999, 'payout')])).toMatchObject({ cost: 100, payout: 0, net: -100, transactions: 1 });
  });
});

describe('prop-firm API', () => {
  let base: string; let repo: Repository; let server: ReturnType<typeof createApi>; let token: string;
  const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
  const jsonH = () => h({ 'content-type': 'application/json' });
  const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });

  beforeAll(async () => {
    repo = new Repository(':memory:');
    server = createApi(repo);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    token = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'prop@test.com', password: 'password123' }) })).json()).token;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); repo.close(); });

  let pid: string;
  it('validates and creates a prop account', async () => {
    expect((await j(await fetch(`${base}/propfirm/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ program: 'no firm' }) }))).status).toBe(400);
    expect((await j(await fetch(`${base}/propfirm/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ firm: 'X', status: 'nope' }) }))).status).toBe(400);
    const ok = await j(await fetch(`${base}/propfirm/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ firm: 'FTMO', program: '100K 2-step', accountSize: 100000, profitTarget: 10000 }) }));
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('evaluation');
    pid = ok.body.id;
  });

  it('tracks a cash-flow ledger and computes totals', async () => {
    expect((await j(await fetch(`${base}/propfirm/accounts/${pid}/transactions`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ amount: 'x', kind: 'evaluation_fee' }) }))).status).toBe(400);
    expect((await j(await fetch(`${base}/propfirm/accounts/${pid}/transactions`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ amount: -150, kind: 'bogus' }) }))).status).toBe(400);
    await fetch(`${base}/propfirm/accounts/${pid}/transactions`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ amount: -150, kind: 'evaluation_fee' }) });
    await fetch(`${base}/propfirm/accounts/${pid}/transactions`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ amount: 600, kind: 'payout' }) });
    const detail = await j(await fetch(`${base}/propfirm/accounts/${pid}`, { headers: h() }));
    expect(detail.body.totals).toMatchObject({ cost: 150, payout: 600, net: 450 });
    expect(detail.body.transactions).toHaveLength(2);
    const summary = await j(await fetch(`${base}/propfirm/summary`, { headers: h() }));
    expect(summary.body).toMatchObject({ accounts: 1, cost: 150, payout: 600, net: 450 });
    const list = await j(await fetch(`${base}/propfirm/accounts`, { headers: h() }));
    expect(list.body[0].totals.net).toBe(450);
  });

  it('edits and deletes (cascading its ledger)', async () => {
    const edit = await j(await fetch(`${base}/propfirm/accounts/${pid}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ status: 'funded', phase: 'Funded' }) }));
    expect(edit.body.status).toBe('funded');
    const del = await j(await fetch(`${base}/propfirm/accounts/${pid}`, { method: 'DELETE', headers: h() }));
    expect(del.body.deleted).toBe(true);
    const summary = await j(await fetch(`${base}/propfirm/summary`, { headers: h() }));
    expect(summary.body.accounts).toBe(0);
  });

  it('enforces auth and cross-user ownership', async () => {
    const mine = (await (await fetch(`${base}/propfirm/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ firm: 'Topstep' }) })).json()).id;
    const other = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'prop2@test.com', password: 'password123' }) })).json()).token;
    const oh = { authorization: `Bearer ${other}` };
    expect((await j(await fetch(`${base}/propfirm/accounts`))).status).toBe(401);
    expect((await j(await fetch(`${base}/propfirm/accounts/${mine}`, { headers: oh }))).status).toBe(404);
    expect((await j(await fetch(`${base}/propfirm/accounts/${mine}`, { method: 'DELETE', headers: oh }))).status).toBe(404);
    expect((await (await fetch(`${base}/propfirm/accounts`, { headers: oh })).json()).length).toBe(0);
  });
});

describe('prop-firm persistence across reopen', () => {
  it('survives reopening the database (migration v7)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tj-prop-'));
    const dbPath = join(dir, 'p.db');
    try {
      const r1 = new Repository(dbPath);
      const a = r1.createPropAccount('u1', { firm: 'Apex', accountSize: 50000 });
      r1.addPropTransaction('u1', a.id, { amount: -137, kind: 'evaluation_fee' });
      r1.close();
      const r2 = new Repository(dbPath);
      expect(r2.listPropAccounts('u1')).toHaveLength(1);
      expect(r2.propAccountTotals(a.id).cost).toBe(137);
      r2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
