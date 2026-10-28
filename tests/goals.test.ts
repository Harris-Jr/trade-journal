import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../src/db/repository.js';
import { createApi } from '../src/server/api.js';

let base: string;
let repo: Repository;
let server: ReturnType<typeof createApi>;
let token: string;
let accountId: string;

const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const jsonH = () => h({ 'content-type': 'application/json' });
const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });

beforeAll(async () => {
  repo = new Repository(':memory:');
  server = createApi(repo);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'goals@test.com', password: 'password123' }) })).json()).token;
  accountId = (await (await fetch(`${base}/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ name: 'G', currency: 'USD', startingBalance: 10000 }) })).json()).id;
  const csv = 'Symbol,Type,Side,Qty,Price,Time\nAAPL,stock,buy,10,10,2024-05-01T14:00:00Z\nAAPL,stock,sell,10,12,2024-05-01T15:00:00Z';
  await fetch(`${base}/accounts/${accountId}/import`, { method: 'POST', headers: h({ 'content-type': 'text/csv' }), body: csv });
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); repo.close(); });

describe('goals API lifecycle', () => {
  let goalId: string;

  it('creates a goal and validates input', async () => {
    const ok = await j(await fetch(`${base}/accounts/${accountId}/goals`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ metric: 'net_pnl', period: 'weekly', target: 500 }) }));
    expect(ok.status).toBe(201);
    expect(ok.body.direction).toBe('at_least'); // default direction applied
    goalId = ok.body.id;

    const badMetric = await j(await fetch(`${base}/accounts/${accountId}/goals`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ metric: 'nope', period: 'weekly', target: 1 }) }));
    expect(badMetric.status).toBe(400);
    const badPeriod = await j(await fetch(`${base}/accounts/${accountId}/goals`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ metric: 'net_pnl', period: 'hourly', target: 1 }) }));
    expect(badPeriod.status).toBe(400);
    const badTarget = await j(await fetch(`${base}/accounts/${accountId}/goals`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ metric: 'win_rate', period: 'weekly', target: 200 }) }));
    expect(badTarget.status).toBe(400);
  });

  it('lists goals with live progress derived from trades', async () => {
    const list = await j(await fetch(`${base}/accounts/${accountId}/goals?tz=UTC`, { headers: h() }));
    expect(list.status).toBe(200);
    const g = list.body.find((x: any) => x.id === goalId);
    expect(g).toBeTruthy();
    expect(g.progress).toBeTruthy();
    expect(typeof g.progress.current === 'number' || g.progress.current === null).toBe(true);
    expect(Array.isArray(g.progress.history)).toBe(true);
  });

  it('pauses and resumes a goal', async () => {
    const pause = await j(await fetch(`${base}/goals/${goalId}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ status: 'paused' }) }));
    expect(pause.body.status).toBe('paused');
    const resume = await j(await fetch(`${base}/goals/${goalId}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ status: 'active' }) }));
    expect(resume.body.status).toBe('active');
    const badStatus = await j(await fetch(`${base}/goals/${goalId}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ status: 'frozen' }) }));
    expect(badStatus.status).toBe(400);
  });

  it('edits a goal with revalidation', async () => {
    const edit = await j(await fetch(`${base}/goals/${goalId}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ target: 1000 }) }));
    expect(edit.body.target).toBe(1000);
    const bad = await j(await fetch(`${base}/goals/${goalId}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ metric: 'win_rate', target: 300 }) }));
    expect(bad.status).toBe(400);
  });

  it('resets a goal (moves start forward, reactivates)', async () => {
    const before = (await (await fetch(`${base}/accounts/${accountId}/goals`, { headers: h() })).json()).find((x: any) => x.id === goalId);
    const reset = await j(await fetch(`${base}/goals/${goalId}/reset`, { method: 'POST', headers: h() }));
    expect(reset.status).toBe(200);
    expect(reset.body.startAt).toBeGreaterThanOrEqual(before.startAt);
    expect(reset.body.status).toBe('active');
  });

  it('deletes a goal', async () => {
    const del = await j(await fetch(`${base}/goals/${goalId}`, { method: 'DELETE', headers: h() }));
    expect(del.body.deleted).toBe(true);
    const after = await j(await fetch(`${base}/accounts/${accountId}/goals`, { headers: h() }));
    expect(after.body.find((x: any) => x.id === goalId)).toBeUndefined();
  });
});

describe('goals authorization', () => {
  it('rejects unauthenticated and cross-user access', async () => {
    const created = await (await fetch(`${base}/accounts/${accountId}/goals`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ metric: 'trade_count', period: 'daily', target: 3 }) })).json();
    expect((await j(await fetch(`${base}/accounts/${accountId}/goals`))).status).toBe(401);

    const otherToken = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'goals2@test.com', password: 'password123' }) })).json()).token;
    const oh = { authorization: `Bearer ${otherToken}` };
    expect((await j(await fetch(`${base}/accounts/${accountId}/goals`, { headers: oh }))).status).toBe(404); // not their account
    expect((await j(await fetch(`${base}/goals/${created.id}`, { method: 'DELETE', headers: oh }))).status).toBe(404); // not their goal
    expect((await j(await fetch(`${base}/goals/${created.id}/reset`, { method: 'POST', headers: oh }))).status).toBe(404);
  });
});

describe('goals persist across a reopen (file-backed)', () => {
  it('survives closing and reopening the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tj-goals-'));
    const dbPath = join(dir, 'g.db');
    try {
      const r1 = new Repository(dbPath);
      const acct = r1.createAccount({ name: 'P', currency: 'USD', startingBalance: 0, kind: 'live', userId: 'u1' });
      const g = r1.createGoal('u1', acct.id, { metric: 'net_pnl', period: 'monthly', direction: 'at_least', target: 2000 });
      r1.close();
      const r2 = new Repository(dbPath);
      const goals = r2.listGoals('u1', acct.id);
      expect(goals).toHaveLength(1);
      expect(goals[0]!.id).toBe(g.id);
      expect(goals[0]!.target).toBe(2000);
      r2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
