import { describe, it, expect } from 'vitest';
import { playbookAnalytics } from '../src/analytics/playbook.js';
import type { Playbook, Trade, TradeAnnotations } from '../src/domain/types.js';

const pb: Playbook = {
  id: 'pb', userId: 'u', name: 'ORB', status: 'active', createdAt: 0, updatedAt: 0,
  checklist: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
};

const mk = (netPnl: number, closeTime: number, ann: TradeAnnotations, open = false): Trade => ({
  id: `t${closeTime}`, accountId: 'A', symbol: 'AAPL', instrumentType: 'stock',
  direction: netPnl >= 0 ? 'long' : 'short', quantity: 1, avgEntryPrice: 1, avgExitPrice: open ? undefined : 1,
  openTime: closeTime - 1, closeTime: open ? undefined : closeTime, grossPnl: netPnl, commission: 0, fees: 0, swap: 0,
  netPnl, durationMs: 1, open, executions: [], annotations: ann,
});

describe('playbookAnalytics', () => {
  it('summarizes winning/losing/breakeven/open trades with adherence and review rates', () => {
    const linked = [
      mk(300, 1000, { playbookId: 'pb', playbookChecklist: { a: true, b: true }, playbookReviewDone: true }),
      mk(-100, 2000, { playbookId: 'pb', playbookChecklist: { a: true } }),
      mk(0, 3000, { playbookId: 'pb' }),
      mk(0, 4000, { playbookId: 'pb' }, true), // open, excluded from closed stats
    ];
    const a = playbookAnalytics(linked, pb, 'UTC');
    expect(a.linkedClosed).toBe(3);
    expect(a.linkedOpen).toBe(1);
    expect(a.stats.trades).toBe(3);
    expect(a.stats.netPnl).toBe(200);
    expect(a.breakevenRate).toBeCloseTo(1 / 3, 6);
    expect(a.checklistAdherence).toBeCloseTo((1 + 0.5 + 0) / 3, 6); // 0.5
    expect(a.reviewCompletionRate).toBeCloseTo(1 / 3, 6);
    expect(a.bySymbol.length).toBeGreaterThan(0);
    expect(a.byDirection.length).toBeGreaterThan(0);
  });

  it('empty dataset: zero counts, null ratios (missing distinct from zero)', () => {
    const a = playbookAnalytics([], pb, 'UTC');
    expect(a.linkedClosed).toBe(0);
    expect(a.stats.trades).toBe(0);
    expect(a.breakevenRate).toBeNull();
    expect(a.checklistAdherence).toBeNull();
    expect(a.reviewCompletionRate).toBeNull();
  });

  it('checklistAdherence is null when the playbook defines no checklist', () => {
    const noChecklist: Playbook = { ...pb, checklist: undefined };
    const a = playbookAnalytics([mk(10, 1, { playbookId: 'pb' })], noChecklist, 'UTC');
    expect(a.checklistAdherence).toBeNull();
    expect(a.reviewCompletionRate).toBe(0); // one closed trade, review not done
  });
});
