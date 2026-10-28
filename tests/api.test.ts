import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Repository } from '../src/db/repository.js';
import { createApi } from '../src/server/api.js';

let base: string;
let repo: Repository;
let server: ReturnType<typeof createApi>;

beforeAll(async () => {
  repo = new Repository(':memory:');
  server = createApi(repo);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  repo.close();
});

const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });
const authHeaders = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

async function register(email: string, password = 'password123'): Promise<string> {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.token as string;
}

describe('auth', () => {
  it('health is public', async () => {
    expect((await j(await fetch(`${base}/health`))).status).toBe(200);
  });
  it('rejects unauthenticated access to protected routes', async () => {
    expect((await j(await fetch(`${base}/accounts`))).status).toBe(401);
  });
  it('validates registration input', async () => {
    expect((await j(await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bad', password: 'password123' }) }))).status).toBe(400);
    expect((await j(await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@y.com', password: 'short' }) }))).status).toBe(400);
  });
  it('registers, rejects duplicates, and logs in', async () => {
    const r1 = await j(await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'auth@test.com', password: 'password123' }) }));
    expect(r1.status).toBe(201);
    expect(r1.body.token).toBeTruthy();
    const dup = await j(await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'auth@test.com', password: 'password123' }) }));
    expect(dup.status).toBe(409);
    const bad = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'auth@test.com', password: 'wrong' }) }));
    expect(bad.status).toBe(401);
    const good = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'auth@test.com', password: 'password123' }) }));
    expect(good.status).toBe(200);
    expect(good.body.token).toBeTruthy();
  });
});

describe('authorized end-to-end', () => {
  let token: string;
  let accountId: string;

  it('creates an account', async () => {
    token = await register('owner@test.com');
    const { status, body } = await j(await fetch(`${base}/accounts`, {
      method: 'POST', headers: authHeaders(token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'API', currency: 'USD', startingBalance: 5000 }),
    }));
    expect(status).toBe(201);
    accountId = body.id;
  });

  it('imports CSV and derives trades/stats', async () => {
    const csv = [
      'Symbol,Type,Side,Qty,Price,Time,Commission',
      'AAPL,stock,buy,100,10,2024-01-02T14:00:00Z,1',
      'AAPL,stock,sell,100,12,2024-01-02T15:00:00Z,1',
      'AAPL,stock,buy,100,12,2024-01-03T14:00:00Z,1',
      'AAPL,stock,sell,100,11,2024-01-03T15:00:00Z,1',
    ].join('\n');
    const imp = await j(await fetch(`${base}/accounts/${accountId}/import`, { method: 'POST', headers: authHeaders(token, { 'content-type': 'text/csv' }), body: csv }));
    expect(imp.status).toBe(201);
    expect(imp.body.imported).toBe(4);

    const trades = (await j(await fetch(`${base}/accounts/${accountId}/trades`, { headers: authHeaders(token) }))).body;
    expect(trades.items).toHaveLength(2);
    expect(trades.page.total).toBe(2);
    const stats = (await j(await fetch(`${base}/accounts/${accountId}/stats`, { headers: authHeaders(token) }))).body;
    expect(stats.netPnl).toBe(96); // winner 198, loser -102
  });

  it('returns a symbol report and accepts annotations', async () => {
    const report = (await j(await fetch(`${base}/accounts/${accountId}/reports?by=symbol`, { headers: authHeaders(token) }))).body;
    expect(report[0].key).toBe('AAPL');
    const trades = (await j(await fetch(`${base}/accounts/${accountId}/trades`, { headers: authHeaders(token) }))).body.items;
    const id = encodeURIComponent(trades[0].id);
    const put = await j(await fetch(`${base}/trades/${id}/annotations`, { method: 'PUT', headers: authHeaders(token, { 'content-type': 'application/json' }), body: JSON.stringify({ setup: 'ORB' }) }));
    expect(put.status).toBe(200);
    const after = (await j(await fetch(`${base}/accounts/${accountId}/trades`, { headers: authHeaders(token) }))).body.items;
    expect(after.find((t: any) => t.id === trades[0].id).annotations.setup).toBe('ORB');
    // single-trade endpoint
    const single = await j(await fetch(`${base}/accounts/${accountId}/trades/${id}`, { headers: authHeaders(token) }));
    expect(single.status).toBe(200);
    expect(single.body.annotations.setup).toBe('ORB');
  });

  it('404s an account the user does not have', async () => {
    expect((await j(await fetch(`${base}/accounts/missing/trades`, { headers: authHeaders(token) }))).status).toBe(404);
  });
});

describe('cross-user isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let accountA: string;
  let tradeAId: string;

  beforeAll(async () => {
    tokenA = await register('alice@test.com');
    tokenB = await register('bob@test.com');
    accountA = (await (await fetch(`${base}/accounts`, { method: 'POST', headers: authHeaders(tokenA, { 'content-type': 'application/json' }), body: JSON.stringify({ name: 'Alice', currency: 'USD' }) })).json()).id;
    const csv = 'Symbol,Type,Side,Qty,Price,Time\nAAPL,stock,buy,10,10,2024-02-01T14:00:00Z\nAAPL,stock,sell,10,12,2024-02-01T15:00:00Z';
    await fetch(`${base}/accounts/${accountA}/import`, { method: 'POST', headers: authHeaders(tokenA, { 'content-type': 'text/csv' }), body: csv });
    tradeAId = (await (await fetch(`${base}/accounts/${accountA}/trades`, { headers: authHeaders(tokenA) })).json()).items[0].id;
  });

  it("B cannot see A's account in the list", async () => {
    const list = (await j(await fetch(`${base}/accounts`, { headers: authHeaders(tokenB) }))).body;
    expect(list.find((a: any) => a.id === accountA)).toBeUndefined();
  });
  it("B gets 404 reading A's account by id", async () => {
    expect((await j(await fetch(`${base}/accounts/${accountA}`, { headers: authHeaders(tokenB) }))).status).toBe(404);
    expect((await j(await fetch(`${base}/accounts/${accountA}/trades`, { headers: authHeaders(tokenB) }))).status).toBe(404);
    expect((await j(await fetch(`${base}/accounts/${accountA}/stats`, { headers: authHeaders(tokenB) }))).status).toBe(404);
  });
  it("B cannot write to A's account or annotate A's trade", async () => {
    const imp = await j(await fetch(`${base}/accounts/${accountA}/import`, { method: 'POST', headers: authHeaders(tokenB, { 'content-type': 'text/csv' }), body: 'Symbol,Type,Side,Qty,Price,Time\nX,stock,buy,1,1,2024-01-01T00:00:00Z' }));
    expect(imp.status).toBe(404);
    const ann = await j(await fetch(`${base}/trades/${encodeURIComponent(tradeAId)}/annotations`, { method: 'PUT', headers: authHeaders(tokenB, { 'content-type': 'application/json' }), body: JSON.stringify({ setup: 'hack' }) }));
    expect(ann.status).toBe(404);
  });
  it("A's data is unchanged after B's attempts", async () => {
    const execs = (await j(await fetch(`${base}/accounts/${accountA}/executions`, { headers: authHeaders(tokenA) }))).body;
    expect(execs.items).toHaveLength(2);
  });
});
