import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { computeInsights } from '../src/analytics/insights.js';
import { Repository } from '../src/db/repository.js';
import { createApi } from '../src/server/api.js';
import type { Trade, TradeAnnotations, JournalEntry } from '../src/domain/types.js';

const T = (iso: string): number => Date.parse(iso);
const DAY = '2024-07-01';

const mk = (o: Partial<Trade> & Pick<Trade, 'netPnl' | 'closeTime'>): Trade => ({
  id: `x${o.closeTime}-${Math.random().toString(36).slice(2)}`, accountId: 'A', symbol: 'AAPL', instrumentType: 'stock',
  direction: o.netPnl >= 0 ? 'long' : 'short', quantity: 10, avgEntryPrice: 10, avgExitPrice: 10,
  openTime: (o.closeTime ?? 0) - 1000, grossPnl: o.netPnl, commission: 0, fees: 0, swap: 0,
  durationMs: 1000, open: false, executions: [], ...o,
});
const types = (r: ReturnType<typeof computeInsights>): string[] => r.insights.map((i) => i.type);

describe('computeInsights heuristics', () => {
  it('overtrading fires above the per-day threshold, not at it', () => {
    const seven = Array.from({ length: 7 }, (_, i) => mk({ netPnl: 1, closeTime: T(`${DAY}T13:0${i}:00Z`) }));
    expect(types(computeInsights(seven, [], 'UTC'))).toContain('overtrading');
    const six = seven.slice(0, 6);
    expect(types(computeInsights(six, [], 'UTC'))).not.toContain('overtrading');
  });

  it('loss streak fires at the threshold of consecutive losers', () => {
    const three = [mk({ netPnl: -1, closeTime: T(`${DAY}T13:00:00Z`) }), mk({ netPnl: -2, closeTime: T(`${DAY}T13:01:00Z`) }), mk({ netPnl: -3, closeTime: T(`${DAY}T13:02:00Z`) })];
    expect(types(computeInsights(three, [{ id: 'j', accountId: 'A', date: DAY }], 'UTC'))).toContain('loss_streak');
    const broken = [mk({ netPnl: -1, closeTime: T(`${DAY}T13:00:00Z`) }), mk({ netPnl: 5, closeTime: T(`${DAY}T13:01:00Z`) }), mk({ netPnl: -3, closeTime: T(`${DAY}T13:02:00Z`) })];
    expect(types(computeInsights(broken, [{ id: 'j', accountId: 'A', date: DAY }], 'UTC'))).not.toContain('loss_streak');
  });

  it('revenge trade: upsized entry shortly after a loss', () => {
    const prev = mk({ netPnl: -100, quantity: 10, avgEntryPrice: 10, closeTime: T(`${DAY}T13:00:00Z`) });
    const revenge = mk({ netPnl: -50, quantity: 25, avgEntryPrice: 10, closeTime: T(`${DAY}T13:40:00Z`), openTime: T(`${DAY}T13:20:00Z`) });
    const j: JournalEntry[] = [{ id: 'j', accountId: 'A', date: DAY }];
    expect(types(computeInsights([prev, revenge], j, 'UTC'))).toContain('revenge_trade');
    // same size, not upsized -> no revenge
    const sameSize = mk({ netPnl: -50, quantity: 10, avgEntryPrice: 10, closeTime: T(`${DAY}T13:40:00Z`), openTime: T(`${DAY}T13:20:00Z`) });
    expect(types(computeInsights([prev, sameSize], j, 'UTC'))).not.toContain('revenge_trade');
    // outside the time window -> no revenge
    const later = mk({ netPnl: -50, quantity: 25, avgEntryPrice: 10, closeTime: T(`${DAY}T18:00:00Z`), openTime: T(`${DAY}T17:30:00Z`) });
    expect(types(computeInsights([prev, later], j, 'UTC'))).not.toContain('revenge_trade');
  });

  it('oversized loss relative to the average loss', () => {
    const trades = [
      mk({ netPnl: -10, closeTime: T(`${DAY}T13:00:00Z`) }),
      mk({ netPnl: -10, closeTime: T(`${DAY}T13:01:00Z`) }),
      mk({ netPnl: -100, closeTime: T(`${DAY}T13:02:00Z`) }), // avg loss ~40, 100 > 2.5x? avg=40 -> 2.5x=100, use larger
    ];
    const r = computeInsights(trades, [{ id: 'j', accountId: 'A', date: DAY }], 'UTC', { oversizedLossMultiple: 2 });
    expect(r.insights.some((i) => i.type === 'oversized_loss')).toBe(true);
  });

  it('no stop only flags losing trades with no recorded stop', () => {
    const withStop: TradeAnnotations = { stopLoss: 9 };
    const trades = [
      mk({ netPnl: -5, closeTime: T(`${DAY}T13:00:00Z`) }), // loser, no stop -> flagged
      mk({ netPnl: -5, closeTime: T(`${DAY}T13:01:00Z`), annotations: withStop }), // loser w/ stop -> not
      mk({ netPnl: 5, closeTime: T(`${DAY}T13:02:00Z`) }), // winner no stop -> not
    ];
    const r = computeInsights(trades, [{ id: 'j', accountId: 'A', date: DAY }], 'UTC');
    expect(r.insights.filter((i) => i.type === 'no_stop_loss')).toHaveLength(1);
  });

  it('unjournaled trading day', () => {
    const trades = [mk({ netPnl: 1, closeTime: T(`${DAY}T13:00:00Z`) })];
    expect(types(computeInsights(trades, [], 'UTC'))).toContain('unjournaled_day');
    expect(types(computeInsights(trades, [{ id: 'j', accountId: 'A', date: DAY }], 'UTC'))).not.toContain('unjournaled_day');
  });

  it('empty dataset yields no insights', () => {
    const r = computeInsights([], [], 'UTC');
    expect(r.insights).toHaveLength(0);
    expect(r.closedTrades).toBe(0);
    expect(r.summary).toHaveLength(0);
  });

  it('open trades are excluded', () => {
    const r = computeInsights([mk({ netPnl: 0, closeTime: T(`${DAY}T13:00:00Z`), open: true })], [], 'UTC');
    expect(r.closedTrades).toBe(0);
  });
});

describe('insights API', () => {
  let base: string; let repo: Repository; let server: ReturnType<typeof createApi>; let token: string; let accountId: string;
  const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
  const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => undefined) });

  beforeAll(async () => {
    repo = new Repository(':memory:');
    server = createApi(repo);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    token = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ins@test.com', password: 'password123' }) })).json()).token;
    accountId = (await (await fetch(`${base}/accounts`, { method: 'POST', headers: h({ 'content-type': 'application/json' }), body: JSON.stringify({ name: 'I', currency: 'USD' }) })).json()).id;
    // 7 closed trades on one day -> overtrading
    const rows = ['Symbol,Type,Side,Qty,Price,Time'];
    for (let i = 0; i < 7; i++) {
      rows.push(`AAPL,stock,buy,10,10,2024-07-01T13:0${i}:00Z`);
      rows.push(`AAPL,stock,sell,10,11,2024-07-01T13:0${i}:30Z`);
    }
    await fetch(`${base}/accounts/${accountId}/import`, { method: 'POST', headers: h({ 'content-type': 'text/csv' }), body: rows.join('\n') });
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); repo.close(); });

  it('returns insights with a summary', async () => {
    const r = await j(await fetch(`${base}/accounts/${accountId}/insights?tz=UTC`, { headers: h() }));
    expect(r.status).toBe(200);
    expect(r.body.summary.some((s: any) => s.type === 'overtrading')).toBe(true);
    expect(r.body.closedTrades).toBe(7);
  });
  it('validates threshold overrides', async () => {
    expect((await j(await fetch(`${base}/accounts/${accountId}/insights?overtradingPerDay=abc`, { headers: h() }))).status).toBe(400);
    const r = await j(await fetch(`${base}/accounts/${accountId}/insights?overtradingPerDay=10`, { headers: h() }));
    expect(r.body.summary.some((s: any) => s.type === 'overtrading')).toBe(false); // 7 < 10
  });
  it('enforces auth and ownership', async () => {
    expect((await j(await fetch(`${base}/accounts/${accountId}/insights`))).status).toBe(401);
    const other = (await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ins2@test.com', password: 'password123' }) })).json()).token;
    expect((await j(await fetch(`${base}/accounts/${accountId}/insights`, { headers: { authorization: `Bearer ${other}` } }))).status).toBe(404);
  });
});
