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
let tradeId: string;

const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const jsonH = () => h({ 'content-type': 'application/json' });
const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });

beforeAll(async () => {
  repo = new Repository(':memory:');
  server = createApi(repo);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pb@test.com', password: 'password123' }) })).json()).token;
  accountId = (await (await fetch(`${base}/accounts`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ name: 'PB', currency: 'USD', startingBalance: 10000 }) })).json()).id;
  const csv = 'Symbol,Type,Side,Qty,Price,Time\nAAPL,stock,buy,10,10,2024-06-03T14:00:00Z\nAAPL,stock,sell,10,13,2024-06-03T15:00:00Z';
  await fetch(`${base}/accounts/${accountId}/import`, { method: 'POST', headers: h({ 'content-type': 'text/csv' }), body: csv });
  tradeId = (await (await fetch(`${base}/accounts/${accountId}/trades`, { headers: h() })).json()).items[0].id;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); repo.close(); });

describe('playbook CRUD and validation', () => {
  let pid: string;

  it('rejects a nameless or malformed playbook', async () => {
    expect((await j(await fetch(`${base}/playbooks`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ description: 'x' }) }))).status).toBe(400);
    expect((await j(await fetch(`${base}/playbooks`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ name: 'X', direction: 'sideways' }) }))).status).toBe(400);
  });
  it('creates, lists, and reads a playbook', async () => {
    const create = await j(await fetch(`${base}/playbooks`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ name: 'Opening Range Breakout', direction: 'long', timeframe: '5m', entryCriteria: 'break of OR high', checklist: [{ label: 'News checked' }, { label: 'Above VWAP' }] }) }));
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('active');
    pid = create.body.id;
    const list = await j(await fetch(`${base}/playbooks`, { headers: h() }));
    expect(list.body.some((p: any) => p.id === pid)).toBe(true);
    const get = await j(await fetch(`${base}/playbooks/${pid}`, { headers: h() }));
    expect(get.body.linkedTradeCount).toBe(0);
    expect(get.body.checklist).toHaveLength(2);
  });
  it('edits a playbook', async () => {
    const edit = await j(await fetch(`${base}/playbooks/${pid}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ notes: 'updated', timeframe: '15m' }) }));
    expect(edit.body.timeframe).toBe('15m');
    expect(edit.body.notes).toBe('updated');
  });

  it('associates a trade, filters by playbook, and reflects linked count', async () => {
    const assign = await j(await fetch(`${base}/trades/${encodeURIComponent(tradeId)}/annotations`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ playbookId: pid, playbookChecklist: { c0: true } }) }));
    expect(assign.status).toBe(200);
    const filtered = await j(await fetch(`${base}/accounts/${accountId}/trades?playbook=${pid}`, { headers: h() }));
    expect(filtered.body.page.total).toBe(1);
    const get = await j(await fetch(`${base}/playbooks/${pid}`, { headers: h() }));
    expect(get.body.linkedTradeCount).toBe(1);
  });

  it('rejects assigning an unknown or non-owned playbook', async () => {
    const bad = await j(await fetch(`${base}/trades/${encodeURIComponent(tradeId)}/annotations`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ playbookId: 'does-not-exist' }) }));
    expect(bad.status).toBe(400);
  });

  it('returns analytics from linked trades (canonical engine)', async () => {
    const a = await j(await fetch(`${base}/accounts/${accountId}/playbooks/${pid}/analytics?tz=UTC`, { headers: h() }));
    expect(a.status).toBe(200);
    expect(a.body.linkedClosed).toBe(1);
    expect(a.body.stats.netPnl).toBe(30); // (13-10)*10
  });

  it('archives and restores', async () => {
    expect((await j(await fetch(`${base}/playbooks/${pid}/archive`, { method: 'POST', headers: h() }))).body.status).toBe('archived');
    expect((await j(await fetch(`${base}/playbooks?status=archived`, { headers: h() }))).body.some((p: any) => p.id === pid)).toBe(true);
    expect((await j(await fetch(`${base}/playbooks/${pid}/restore`, { method: 'POST', headers: h() }))).body.status).toBe('active');
  });

  it('refuses to delete while trades are linked, then deletes after unassigning', async () => {
    const blocked = await j(await fetch(`${base}/playbooks/${pid}`, { method: 'DELETE', headers: h() }));
    expect(blocked.status).toBe(409);
    // unassign (replace annotations without playbookId)
    await fetch(`${base}/trades/${encodeURIComponent(tradeId)}/annotations`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({}) });
    const ok = await j(await fetch(`${base}/playbooks/${pid}`, { method: 'DELETE', headers: h() }));
    expect(ok.body.deleted).toBe(true);
  });
});

describe('playbook authorization', () => {
  it('prevents cross-user access', async () => {
    const pid = (await (await fetch(`${base}/playbooks`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ name: 'Private' }) })).json()).id;
    const otherToken = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pb2@test.com', password: 'password123' }) })).json()).token;
    const oh = { authorization: `Bearer ${otherToken}` };
    expect((await j(await fetch(`${base}/playbooks`, { headers: oh }))).body.some((p: any) => p.id === pid)).toBe(false);
    expect((await j(await fetch(`${base}/playbooks/${pid}`, { headers: oh }))).status).toBe(404);
    expect((await j(await fetch(`${base}/playbooks/${pid}`, { method: 'DELETE', headers: oh }))).status).toBe(404);
    expect((await j(await fetch(`${base}/playbooks/${pid}`, { method: 'PUT', headers: { ...oh, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'hijack' }) }))).status).toBe(404);
    expect((await j(await fetch(`${base}/playbooks`))).status).toBe(401);
  });
});

describe('playbook persistence across reopen', () => {
  it('survives closing and reopening the database (migration v6)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tj-pb-'));
    const dbPath = join(dir, 'pb.db');
    try {
      const r1 = new Repository(dbPath);
      const pb = r1.createPlaybook('u1', { name: 'Persisted', checklist: [{ id: 'a', label: 'A' }] });
      r1.close();
      const r2 = new Repository(dbPath);
      const got = r2.getPlaybook(pb.id);
      expect(got?.name).toBe('Persisted');
      expect(got?.checklist).toHaveLength(1);
      r2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
