import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpApi, ApiError } from '../api/client.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}
const jsonRes = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('httpApi error handling', () => {
  it('returns parsed JSON on success', async () => {
    stubFetch(async () => jsonRes(200, [{ id: 'a', name: 'X', currency: 'USD', startingBalance: 0, kind: 'live' }]));
    const accounts = await httpApi.listAccounts();
    expect(accounts[0]!.name).toBe('X');
  });

  it('throws ApiError with server message on non-2xx', async () => {
    stubFetch(async () => jsonRes(404, { error: 'account nope not found' }));
    await expect(httpApi.queryTrades('nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'account nope not found',
    });
  });

  it('throws ApiError(0) on network failure', async () => {
    stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    const err = await httpApi.listAccounts().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Network error/);
  });

  it('builds date-range query params', async () => {
    const calls: string[] = [];
    stubFetch(async (url) => { calls.push(url); return jsonRes(200, []); });
    await httpApi.getStats('acc', { from: 1000, to: 2000 });
    expect(calls[0]).toContain('/accounts/acc/stats?from=1000&to=2000');
  });
});
