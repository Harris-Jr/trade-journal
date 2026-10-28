import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Repository } from '../src/db/repository.js';
import { createApi } from '../src/server/api.js';

let base: string;
let repo: Repository;
let server: ReturnType<typeof createApi>;
let token: string;

const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const jsonH = () => h({ 'content-type': 'application/json' });
const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });

beforeAll(async () => {
  repo = new Repository(':memory:');
  server = createApi(repo);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sf@test.com', password: 'password123' }) })).json()).token;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); repo.close(); });

describe('saved filters', () => {
  let fid: string;

  it('creates, lists, and validates definitions', async () => {
    const create = await j(await fetch(`${base}/saved-filters`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ scope: 'trades', name: 'Winners', definition: { status: 'closed', direction: 'long', sortBy: 'netPnl' } }) }));
    expect(create.status).toBe(201);
    fid = create.body.id;

    const bad = await j(await fetch(`${base}/saved-filters`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ scope: 'trades', name: 'Bad', definition: { dropTable: 'x' } }) }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/unsupported filter key/);

    const badScope = await j(await fetch(`${base}/saved-filters`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ scope: 'nope', name: 'x', definition: {} }) }));
    expect(badScope.status).toBe(400);

    const list = await j(await fetch(`${base}/saved-filters?scope=trades`, { headers: h() }));
    expect(list.body).toHaveLength(1);
  });

  it('renames and updates a definition', async () => {
    const rename = await j(await fetch(`${base}/saved-filters/${fid}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ name: 'Long winners' }) }));
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('Long winners');
    const upd = await j(await fetch(`${base}/saved-filters/${fid}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ definition: { status: 'open' } }) }));
    expect(upd.body.definition).toEqual({ status: 'open' });
    const updBad = await j(await fetch(`${base}/saved-filters/${fid}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ definition: { evil: 1 } }) }));
    expect(updBad.status).toBe(400);
  });

  it('duplicates by creating a copy of the definition', async () => {
    const orig = (await (await fetch(`${base}/saved-filters?scope=trades`, { headers: h() })).json())[0];
    const copy = await j(await fetch(`${base}/saved-filters`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ scope: 'trades', name: `${orig.name} (copy)`, definition: orig.definition }) }));
    expect(copy.status).toBe(201);
    expect(copy.body.definition).toEqual(orig.definition);
  });

  it('enforces ownership across users', async () => {
    const otherToken = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sf2@test.com', password: 'password123' }) })).json()).token;
    expect((await j(await fetch(`${base}/saved-filters?scope=trades`, { headers: { authorization: `Bearer ${otherToken}` } }))).body).toHaveLength(0);
    const del = await j(await fetch(`${base}/saved-filters/${fid}`, { method: 'DELETE', headers: { authorization: `Bearer ${otherToken}` } }));
    expect(del.status).toBe(404);
  });

  it('deletes its own filter', async () => {
    const del = await j(await fetch(`${base}/saved-filters/${fid}`, { method: 'DELETE', headers: h() }));
    expect(del.body.deleted).toBe(true);
  });
});
