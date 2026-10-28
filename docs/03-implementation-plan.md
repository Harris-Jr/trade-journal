# Implementation Plan - Independent Trading Journal

Principle: build the **verifiable analytical core first** (data model -> metrics -> import),
because it is the highest-value, most testable, least UI-dependent part and is fully understood
from public evidence. UI and advanced modules layer on top.

## Milestones

### M0 - Project foundation (done) (this commit)
- TypeScript monorepo-ready package, strict mode, Vitest.
- Docs: RE report, feature spec, this plan, raw evidence under `docs/evidence/`.

### M1 - Domain core + metrics engine (done) (this commit)
- `src/domain`: typed entities (Account, Execution, Trade, Strategy, Tag, JournalEntry, BalanceTransaction).
- `src/metrics`:
  - Trade construction from executions (**FIFO lot matching**), net/gross P&L, R-multiple, realized R:R, duration, MAE/MFE hooks.
  - Aggregate stats: win rate, profit factor, expectancy, avg win/loss, payoff ratio, max drawdown + recovery factor, cumulative P&L, streaks.
  - **Health Score** (independent Zella-Score equivalent): documented weights + tier tables (`src/metrics/healthScore.ts`).
- `tests/`: worked examples with hand-verified numbers.

### M2 - Generic CSV import (done) (this commit, v1)
- `src/import`: executions-level generic CSV parser with explicit documented schema + column-mapping presets.
- Round-trips into Trade aggregation.

### M3 - Reporting layer (done)
- Breakdown reports (`src/analytics/reports.ts`): by day/week/month (timezone-aware, ISO weeks),
  day-of-week, hour-of-day, symbol, strategy, setup, tag (multi-tag explode), duration buckets.
- Each breakdown returns full `TradeStats` per group with `key|netPnl|trades` sorting.
- `report(trades, dimension, opts)` dispatch used by the API. Open trades excluded.
- (Deferred to M3.1: unit projection $/%/R/ticks/pips/points, saved filters/report settings.)

### M4 - Persistence + REST API (done)
- `src/db/repository.ts`: Node built-in SQLite (`node:sqlite`). Executions are the source of
  truth; trades derived on read; annotations stored by deterministic trade id. CRUD for accounts,
  strategies, tags, journal, balance transactions; CSV import; account balance.
- `src/server/api.ts`: framework-free `node:http` REST API mirroring observed resources -
  `/accounts`, `/accounts/:id/{executions,import,trades,stats,health-score,reports,journal,balance,balance-transactions}`,
  `/trades/:id/annotations`, `/strategies`, `/tags`. `src/server/main.ts` boots a file-backed DB (`npm start`).

### M5 - Web UI (done)
- React + TypeScript + Vite + **Recharts (MIT)** under `web/`. App shell (nav, account selector,
  date-range controls, theme + demo toggles, loading/error/empty states). Dashboard (stat tiles,
  cumulative-P&L chart, calendar heatmap, Health Score, recent trades), Trade Log
  (search/filter/sort/paginate), Trade Detail (executions + annotation editor), Add Trade, Journal,
  Notebook, Reports (all M3 dimensions), CSV Import, Settings. Responsive, light/dark, keyboard-friendly.
- Typed API client + `useQuery`/`useMutation`; errors surfaced, never replaced with fake data.
  Explicit Demo mode runs the **same engine modules** as the backend (`@core/*`) for consistent numbers.
- Added thin, additive backend endpoints to unblock screens (reusing existing engine, no new P&L path):
  `GET /accounts/:id/equity`, notebook `notes` CRUD, and optional `from`/`to` date filtering on derived views.
- Dev: `npm run dev:all` builds the backend, starts the API (localhost) and the Vite dev server with an `/api` proxy.

### M5 hardening pass (done)
- **Stage 1 - Auth & authorization:** scrypt passwords + opaque bearer sessions (`src/auth/password.ts`),
  `users`/`sessions` tables via a `PRAGMA user_version` migration runner, `user_id` ownership on
  accounts/strategies/tags, and API-layer enforcement (`requireOwner`) returning 404 on cross-user
  access; notes and trade-annotation ownership derived from the account. Frontend login/register,
  token storage, 401->logout, and a client-only demo bypass. Negative tests for unauthenticated and
  cross-user access.
- **Stage 2 - Server-side querying:** `{items, page{limit,offset,total,hasMore}}` envelopes with
  validated pagination/filtering pushed to SQL (executions/journal/balance/notes) or applied during
  trade derivation (symbol/date pre-filtered in SQL), deterministic sort with id tiebreak, a
  single-trade endpoint, and indexes (migration v3). Typed client + Trade Log refactored to server-side.
- **Stage 3 - Saved filters:** user-scoped `saved_filters` (migration v4) with create/list/update/
  rename/duplicate/delete, per-scope key allowlist validation, and ownership enforcement; Trade Log UI.
- **Stage 4 - Value projections:** `src/analytics/projection.ts` (currency/percent/R/points/ticks/pips)
  with documented formulas, percent denominator = account starting balance, and explicit
  unavailable-data behavior; never invents instrument specs. Trade Log "Show P&L in" selector.

### M6.1 - Progress Tracker (done)
- Goals persisted in a user-scoped, account-scoped `goals` table (migration v5), with CRUD
  plus pause/resume (status) and reset (moves startAt to now). Authorization mirrors the rest of
  the API: account ownership for list/create (404 on cross-user), goal ownership for mutate/delete.
- Metrics (performance): net_pnl, trade_count, win_rate, avg_r_multiple, green_day_rate.
  Metrics (behavioral/discipline): avg_day_rating, journaled_day_rate, mistake_count.
  Direction at_least or at_most per metric; period daily/weekly/monthly.
- Progress is derived live from the canonical engine (computeStats) and journal/annotation data.
  `src/analytics/progress.ts` documents every decision (timezone via shared reports.periodKey,
  realized net P&L only, open trades excluded, breakeven counted, no-data for ratio metrics,
  startAt/reset semantics, zero/negative target handling). `avgRMultiple` was added to the canonical
  TradeStats and reused (no second P&L path).
- API: GET/POST `/accounts/:id/goals`, PUT/DELETE `/goals/:id`, POST `/goals/:id/reset`.
- Web: `/progress` page and nav entry. Goal cards with Apple-style progress bars (critically-damped
  CSS ease, reduced-motion aware), status chips, per-goal history sparklines, a translucent create/edit
  sheet with scrim, an activity chart over the date range, empty/loading/error states, and confirmations
  for reset/delete. Fixed a stale-closure bug in useMutation found while testing.

### M6.2 - Playbooks (done)
- First-class documented setups in a user-scoped `playbooks` table (migration v6): name (only required
  field), description, market, symbols, direction, timeframe, category, the rule sections (entry,
  confirmation, invalidation, stop, target, risk), pre-trade checklist, post-trade review prompts,
  examples, notes, references, and active/archived status.
- Relationship to existing concepts (no duplication): tags are free labels; `setup` is a short free-text
  name; `strategyId` is the original lightweight link (kept for the "by strategy" report); `playbookId`
  (new) links a trade to a Playbook. Trade-to-playbook association and per-trade execution records
  (pre-trade intent, checklist state, review completion/notes) live in the existing trade_annotations
  JSON, so the association needs no migration and never touches executions, trade IDs or realized P&L.
- Analytics (`src/analytics/playbook.ts`) are built only from the canonical engine over a playbook's
  linked closed trades for the selected account: count, net P&L, win/breakeven rate, avg win/loss,
  profit factor, expectancy, avg R-multiple, max drawdown + recovery, by-symbol/direction/month
  breakdowns, plus checklist-adherence and review-completion rates. Missing data is distinguished from
  zero; open trades are excluded; association is described as correlation, not causation.
- API: GET/POST `/playbooks`, GET/PUT/DELETE `/playbooks/:id`, POST `/playbooks/:id/{archive,restore}`,
  GET `/accounts/:id/playbooks/:pid/analytics`; a `playbook` filter on `/accounts/:id/trades`; and
  playbook-ownership validation on the trade annotations endpoint. Deletion is refused (409) while
  trades are linked - archive or unassign first - so history is never silently destroyed.
- Web: `/playbooks` list and `/playbooks/:id` detail (plan, analytics, linked trades, archive/restore/
  delete), a reusable playbook form sheet, Trade Detail playbook assignment with pre-trade intent,
  checklist and post-trade review, and a Trade Log playbook filter. Fixed no app bugs this milestone.

### M6+ - Advanced modules (prioritized)
1. Progress Tracker (rule adherence) - high value, low complexity.
2. Playbook analytics surfacing (M1 already computes per-group stats).
3. Insights heuristics (transparent, documented thresholds).
4. Prop-firm tracking (manual first; Plaid optional).
5. Backtesting / Trade Replay (requires historical market-data source - evaluate providers).
6. Multi-user, auth, billing, Spaces/Mentor, Zella-AI-style assistant.

## Build order rationale
- M1/M2 deliver a **provably correct** engine that any UI or API can consume - the part most at
  risk of silent error, so it ships with tests.
- Market-data-dependent features (backtesting/replay) are deliberately last: they need a licensed/paid
  data source and are the least specified by public evidence.

## Verification strategy
- Every metric has a unit test with hand-computed expected values.
- Health-score components tested against the documented tier tables and worked examples
  (e.g., Trade-Win 25% -> 41.67 at threshold 60).
- Importer tested with representative multi-asset CSV fixtures.
