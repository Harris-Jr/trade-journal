# Trade Journal (independent)

An independently written trading-journal platform with capabilities comparable to
established products in the category. This repository starts with the **analytical
core** - the part that must be provably correct - and layers UI/API on top.

> This is a clean-room project. It reproduces *capabilities* informed by public,
> observable behavior (shipped client code, public docs/help center). It contains
> **no** third-party source, designs, copy, brand assets, or licensed libraries.
> See `docs/` for the evidence trail and how observed vs. inferred behavior was separated.

A TypeScript backend (domain engine + REST API over SQLite) plus a React/Vite
web frontend. The backend is the single source of truth for every monetary and
performance figure; the UI only renders what the API computes.

## What's implemented (M0-M5)

- **Domain model** (`src/domain`): Account, Execution, Trade, Strategy, Tag, JournalEntry, BalanceTransaction.
- **Trade engine** (`src/metrics/trade.ts`): FIFO lot-matching that builds round-trip trades
  from executions - long/short, scaling in/out, position flips, futures multipliers,
  cost-accurate net P&L, and R-multiple / realized R:R from a planned stop.
- **Statistics** (`src/metrics/stats.ts`): win rate, profit factor, expectancy, avg win/loss,
  payoff ratio, max drawdown (+%), recovery factor, streaks, equity curve.
- **Health Score** (`src/metrics/healthScore.ts`): an independent equivalent of the
  "Zella Score" using publicly documented weights and tier tables (clearly labeled).
- **Generic CSV import** (`src/import/genericCsv.ts`): broker-agnostic, multi-asset, with
  per-row error reporting and extensible column mappings.
- **Reporting breakdowns** (`src/analytics/reports.ts`): by day/week/month (timezone-aware),
  day-of-week, hour-of-day, symbol, strategy, setup, tag, and duration buckets - each with full stats.
- **Persistence** (`src/db/repository.ts`): Node built-in SQLite; executions as source of truth,
  trades derived on read, annotations persisted by deterministic trade id.
- **REST API** (`src/server/api.ts`): framework-free `node:http`, resource shape mirrors the target.
- **Web UI** (`web/`): React + TypeScript + Vite + Recharts (MIT), Lucide icons. Dashboard (stat tiles,
  cumulative-P&L chart, calendar heatmap, Health Score, recent trades), Trade Log
  (search/filter/sort/paginate), Trade Detail (executions + annotation editor), Add Trade,
  Journal, Notebook, Reports (all M3 dimensions), **Playbooks** (documented setups + per-playbook
  analytics), **Insights** (behavioral-pattern flags), **Prop Firms** (manual prop-firm tracking),
  **Progress Tracker** (goals + discipline), CSV Import, and Settings. Responsive desktop/mobile,
  light/dark, keyboard-friendly, with explicit loading/error/empty states and an opt-in Demo mode.
- **Progress Tracker** (`src/analytics/progress.ts`, `web/src/pages/ProgressTracker.tsx`): per-period
  goals (daily/weekly/monthly) for performance metrics (net P&L, trades, win rate, average R-multiple,
  green-day rate) and behavioral/discipline metrics (average day rating, journaling rate, recorded
  mistakes). Progress is derived live from the canonical engine; nothing is stored cumulatively.

Everything above ships with unit/integration tests (backend `tests/`, frontend `web/src/test/`)
that assert hand-computed values and core user workflows.

## Quick start

```bash
npm install
npm test          # run the suite
npm run typecheck # strict TS, no emit
npm run build     # emit dist/
npm run demo      # end-to-end: CSV -> trades -> stats -> health score
npm start         # start the REST API (PORT=3000, DB_PATH=./data.db)
```

### API examples

```bash
curl -s localhost:3000/accounts -X POST -H 'content-type: application/json' \
  -d '{"name":"Main","currency":"USD","startingBalance":10000}'
# -> {"id":"...","name":"Main",...}

curl -s "localhost:3000/accounts/<id>/import" -H 'content-type: text/csv' \
  --data-binary @my_broker_export.csv

curl -s "localhost:3000/accounts/<id>/stats"
curl -s "localhost:3000/accounts/<id>/reports?by=symbol&sort=netPnl"
curl -s "localhost:3000/accounts/<id>/health-score"
```

## Frontend (M5)

```bash
# one-time
npm install            # backend deps
npm run web:install    # frontend deps (web/)

# run API + web together (recommended) - builds backend, starts API on :3000, Vite on :5173
npm run dev:all
# -> open http://localhost:5173

# ...or run them separately
npm start              # API on :3000 (build first: npm run build)
npm run web:dev        # Vite dev server on :5173 (proxies /api -> :3000)
```

First run has no data: either create an account in **Settings** and import a CSV, or
toggle **Demo** in the top bar to explore with deterministic sample data (runs the same
engine as the backend; in-memory only, resets on reload).

### Frontend commands
| Command | What |
|---|---|
| `npm run web:dev` | Vite dev server (hot reload, proxies `/api`) |
| `npm run web:build` | Typecheck + production build to `web/dist` |
| `npm run web:test` | Frontend tests (Vitest + Testing Library) |

### Environment variables
| Var | Scope | Default | Purpose |
|---|---|---|---|
| `PORT` | backend | `3000` | API listen port (localhost) |
| `DB_PATH` | backend | `./data.db` | SQLite file path |
| `VITE_API_PROXY_TARGET` | web dev | `http://localhost:3000` | Where Vite proxies `/api` |
| `VITE_API_BASE` | web build | `/api` | API base path the client calls |

No secrets are read by, or exposed in, the frontend. Only `VITE_`-prefixed vars reach the
browser bundle by design, and neither of ours carries a secret.

### Authentication & authorization
- **Bearer-token auth.** `POST /auth/register` and `POST /auth/login` return `{ user, token }`; send `Authorization: Bearer <token>` on every other request. `GET /auth/me` echoes the current user; `POST /auth/logout` revokes the token. Passwords are hashed with scrypt + per-password salt (Node built-ins); sessions are opaque random tokens with a 30-day TTL.
- **Ownership is enforced on every account-scoped route** (and nested routes: executions, import, trades, stats, reports, journal, balance, notes, annotations). A request for an account you don't own returns **404**, so IDs can't be probed. Strategies, tags and saved filters are user-scoped.
- **Local dev / demo:** registration is open (self-hosted model) - create an account on first run. **Demo mode is entirely client-side** (no API, no auth) and never weakens the server.
- The API binds to localhost and the browser talks to it same-origin via the Vite `/api` proxy - no CORS, no public exposure. The SQLite file and password hashes are never exposed to the frontend.
- Before a public/multi-user deployment: terminate TLS in front of the API, add login rate-limiting, and review token lifetime. See "Known limitations".

### Querying (pagination & filtering)
List endpoints return `{ items, page: { limit, offset, total, hasMore } }`. Common query params: `limit` (1-200, default 50), `offset` (>=0), `dir` (`asc`|`desc`).
- `GET /accounts/:id/trades` - `symbol, direction, status(open|closed), strategy, tag, q(search), sort(closeTime|openTime|symbol|netPnl|rMultiple|quantity), from, to`. Deterministic sort (stable id tiebreak). Symbol/date filters are pushed to SQL before trades are built. `GET /accounts/:id/trades/:tradeId` fetches one.
- `GET /accounts/:id/executions` - `symbol, side, sort(timestamp|symbol|price|quantity), from, to`.
- `GET /accounts/:id/journal` - `from, to` (YYYY-MM-DD). `GET /accounts/:id/balance-transactions` - `kind, from, to`. `GET /accounts/:id/notes` - `q, tag`.
Invalid params return `400` with a message.

### Saved filters
User-scoped, per-scope (`trades` | `reports`): `GET /saved-filters?scope=`, `POST /saved-filters {scope,name,definition}`, `PUT /saved-filters/:id {name?,definition?}` (rename = name-only), `DELETE /saved-filters/:id`. Duplicate = POST a copy of a definition. Definitions are validated against a per-scope key allowlist, so unsupported query params can't be stored.

### Progress goals (M6.1)
User-scoped and account-scoped. All financial values are derived from the canonical engine; there is no second P&L path.
- `GET /accounts/:id/goals?tz=<IANA>` - goals for the account, each with live `progress` (current value, remaining, fraction, met, sampleSize, and a short per-period history). Account ownership required (404 otherwise).
- `POST /accounts/:id/goals {metric, period, direction?, target}` - create. `direction` defaults per metric. Targets are validated per metric (ranges/integer), 400 on invalid.
- `PUT /goals/:goalId {metric?, period?, direction?, target?, status?}` - edit, pause (`status:"paused"`), resume (`status:"active"`). Goal ownership required.
- `POST /goals/:goalId/reset` - move the goal's start to now (fresh progress/history) and reactivate.
- `DELETE /goals/:goalId` - delete.

Metrics: performance (`net_pnl`, `trade_count`, `win_rate`, `avg_r_multiple`, `green_day_rate`) and behavioral (`avg_day_rating`, `journaled_day_rate`, `mistake_count`). Periods: `daily`, `weekly`, `monthly`. Direction: `at_least` or `at_most`. The exact calculation decisions (timezone, realized P&L only, open/breakeven handling, no-data behavior, zero/negative targets, reset semantics) are documented at the top of `src/analytics/progress.ts`.

### Playbooks (M6.2)
Documented trading setups, user-scoped. A playbook has a name (the only required field) plus optional
description, market, symbols, direction, timeframe, category, rule sections (entry, confirmation,
invalidation, stop, target, risk), a pre-trade checklist, post-trade review prompts, examples, notes,
references, and an active/archived status.
- `GET /playbooks?status=&q=&sort=`, `POST /playbooks`, `GET/PUT/DELETE /playbooks/:id`, `POST /playbooks/:id/archive`, `POST /playbooks/:id/restore`.
- `GET /accounts/:id/playbooks/:pid/analytics?tz=` - performance over the playbook's linked closed trades in that account (canonical engine): counts, net P&L, win/breakeven rate, avg win/loss, profit factor, expectancy, avg R-multiple, drawdown/recovery, by-symbol/direction/month, checklist adherence and review completion. Missing data is distinct from zero; open trades excluded.
- Trade association uses the `playbookId` (and per-trade execution fields) on trade annotations, set via the existing `PUT /trades/:tradeId/annotations` (which now validates playbook ownership). Filter the Trade Log with `GET /accounts/:id/trades?playbook=<id>`.
- Relationship to existing fields: tags are free labels; `setup` is a short text name; `strategyId` is the original lightweight link (kept for the "by strategy" report); `playbookId` is the new first-class link. They are not duplicates.
- Deletion is refused with 409 while trades are linked; archive or unassign first. Archiving and deleting never modify executions, trade IDs, realized P&L, or annotations beyond the playbook link.

### Insights (M6.3)
Heuristic behavioral flags computed from the user's own closed trades, executions and journal (canonical engine only; no fabrication; correlation, not causation).
- `GET /accounts/:id/insights?tz=&from=&to=` with optional threshold overrides (`overtradingPerDay`, `lossStreak`, `revengeWindowMin`, `revengeSizeMultiple`, `oversizedLossMultiple`). Owner-scoped. Returns `{ insights, summary, thresholds, closedTrades }`.
- Detected patterns: overtrading, losing streak, revenge trade, oversized loss, losing trade without a recorded stop, and un-journaled trading day. Thresholds and formulas are documented at the top of `src/analytics/insights.ts`. MFE-dependent patterns (premature exit, missed scaling) are not implemented because that data is not captured.

### Prop-firm tracking (M6.4)
Manual tracking of prop-firm evaluations and funded accounts, user-scoped, independent of the trade engine (the cash-flow ledger is the user's own record and never mixes into trade P&L).
- `GET /propfirm/summary` - portfolio totals (fees paid, payouts, net) and status counts.
- `GET /propfirm/accounts?status=`, `POST /propfirm/accounts`, `GET/PUT/DELETE /propfirm/accounts/:id`.
- `POST /propfirm/accounts/:id/transactions` (signed amount: negative fee, positive payout), `DELETE /propfirm/transactions/:id`.
- Deleting a prop account removes only its own ledger entries; no trade, execution, or annotation is affected. Plaid/bank sync is out of scope (manual entry).

### Database
SQLite via `node:sqlite`, evolved through additive migrations tracked by `PRAGMA user_version`:
v1 core (accounts, executions, trade_annotations, strategies, tags, journal_entries, balance_transactions, notes),
v2 auth (users, sessions, ownership columns), v3 query indexes, v4 saved_filters, v5 goals, v6 playbooks,
v7 prop_accounts + prop_transactions.
Trade-to-playbook association and per-trade playbook execution records live in the trade_annotations JSON (no migration).

### Value projections (display units)
The Trade Log "Show P&L in" selector reprojects values **without touching the P&L engine** (`src/analytics/projection.ts`): `currency` (netPnl), `percent` (netPnl / account starting balance x 100), `R` (engine rMultiple; needs a planned stop), `points` (signed price move), `ticks`/`pips` (points / tickSize/pipSize - **require instrument metadata**, shown as "-" until configured; specs are never invented). Formulas, the percent denominator, and unavailable-data behavior are documented at the top of that module.

## Documentation

- `docs/01-reverse-engineering-report.md` - public-surface analysis: stack, routes, API catalog, data model, calculations (evidence-tagged).
- `docs/02-feature-spec.md` - feature-by-feature spec with confidence levels.
- `docs/03-implementation-plan.md` - prioritized roadmap (M0-M6+).
- `docs/evidence/` - raw extracted artifacts (route list, API paths, resource counts).

## Known limitations
- **Single-node auth posture:** opaque bearer tokens with a 30-day TTL, open registration (self-hosted model), no refresh rotation, no login rate-limiting, and TLS is expected to be terminated by a proxy in front. Harden these before public/multi-user deployment.
- **Editing a logged trade** adds corrective executions or re-imports; there is no execution edit/delete endpoint yet. Annotations (setup, tags, stop, notes, rating) are fully editable.
- **ticks/pips projections require per-instrument metadata** (tick/pip size), which has no storage/config UI yet, so those units render "-". currency/%/R/points work from existing data.
- **No screenshots in this environment** (no headless browser available on the host); the UI is verified via frontend workflow tests, production builds, and backend API smoke tests.
- Frontend ships as a single ~635 KB JS bundle (mostly Recharts); code-splitting is a later optimization.

## Roadmap (next)

M3 reporting (done), M4 persistence + REST API (done), M5 web UI (done), and the **M5 hardening pass**
(Stage 1 auth + ownership (done), Stage 2 server-side querying (done), Stage 3 saved filters (done),
Stage 4 value projections (done)) are done, plus **M6.1 Progress Tracker (done)**, **M6.2 Playbooks (done)**,
**M6.3 Insights (done)**, and **M6.4 Prop-firm tracking (done)**. Next: M6.5+ backtesting/replay, plus
deployment hardening (TLS, rate-limiting, instrument-metadata config for ticks/pips).
See `docs/03-implementation-plan.md`.
