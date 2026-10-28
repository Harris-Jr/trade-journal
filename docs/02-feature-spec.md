# Feature Specification (clean-room, evidence-tagged)

Confidence: **High** = documented in official public docs *and* corroborated in shipped code;
**Medium** = one source or strong inference; **Low** = named only, behavior assumed.

For an independent build we reproduce *capabilities*, not TradeZella's code, visuals, or wording.

---

## A. Core journal (build first)

### A1. Accounts
- **What:** Multiple trading accounts (live + a dedicated Backtesting account), each with starting
  balance, currency, and type (cash/futures/prop). Running balance = starting balance +/- trades +/- balance transactions.
- **Evidence:** `external_accounts`, `account_rates`, `balance_transactions`, multi-currency, "Unlimited trading accounts" (docs). **Confidence: High.**
- **Independent behavior:** account CRUD; derive current balance; per-account and aggregated analytics.

### A2. Trades & Executions
- **What:** A Trade is an ordered set of Executions (fills) on one symbol. Open->close derives
  `side`, avg entry/exit, quantity, gross/net P&L (after commission+fees+swap), R-multiple,
  realized R:R, MAE/MFE, duration. Supports partial fills, scaling in/out, and `split_trade`.
- **Evidence (fields observed in code):** `net_pnl, gross_pnl, r_multiple, realized_rr, planned_rr,
  mae, mfe, commission, fees, swap, entry_price, exit_price, quantity, side, symbol, instrument_type,
  stop_loss, take_profit, initial_target, setup, mistakes, trade_rating, tags`; endpoints
  `create_execution_in_trade`, `split_trade`. **Confidence: High** (fields), **Medium** (exact aggregation rules).
- **Independent behavior:** build trades from executions via FIFO lot matching; compute all metrics
  independently (see `src/metrics`). Attach screenshots/charts, rating (-/+), setup, mistakes, tags, notes.

### A3. Trade logging - manual, CSV import, (sync later)
- **What:** Manual entry; **generic CSV importer** (Stocks/Futures/Options/Forex/Crypto); broker auto-sync (deferred).
- **Evidence:** docs (3 methods, generic template), `imports`, `api_syncs`, `api_credentials`. **Confidence: High** (manual+CSV), **Medium** (exact generic columns -> we define our own schema).
- **Independent behavior:** executions-level CSV import with a documented, broker-agnostic column mapping
  and per-broker preset mappings addable later.

### A4. Tags, Setups, Mistakes
- **What:** User-defined tag categories (setup, mistake, emotion, custom); attach to trades; filter/report by tag.
- **Evidence:** `settings/tags`, `tag_categories`, `mistakes`, `setup`, "emotional state correlation via notebook tags". **Confidence: High.**

### A5. Strategies / Playbooks
- **What:** Named setup with documented entry/exit rules; attach trades; independent per-strategy
  win rate / profit factor / R-multiple / expectancy.
- **Evidence:** `strategy/playbooks`, `strategy/my-strategy`; docs section "Strategies (Playbooks)". **Confidence: High.**

### A6. Daily Journal & Day Rating
- **What:** Per-day journal entry (rich text), a day rating, and day-level stats roll-up.
- **Evidence:** `daily-journal`, `day_ratings`, `journal`, `journal_stats`. **Confidence: High** (exists), **Medium** (rating scale).

### A7. Notebook
- **What:** Folder-organized rich-text notes (Lexical), templates, tags, full-text search, PDF/print export.
- **Evidence:** `notebook/folders`, `folder_templates`, `notebook/tags`, `folders/all/notes/search`, `pdfUtils`, `printNote`; Lexical chunks. **Confidence: High.**

### A8. Analytics, Reports & Dashboard
- **What:** 50+ reports; customizable drag-and-drop dashboard (calendar, cumulative P&L, stat widgets);
  values viewable as $, %, R, ticks, pips, points; saved dashboard/report templates & filters.
- **Evidence:** `reports` (33), `performance_reports`, `filters` (21), `user/get+set_dashboard_settings`,
  `user/..._report_settings`; docs section Analytics. **Confidence: High.**
- **Report breakdowns (documented):** win rate, profit factor, R-multiple, avg R:R, avg win vs loss,
  max drawdown+recovery, cumulative P&L, P&L by day/week/month, by setup, by symbol, by time-of-day,
  by day-of-week, trade duration, MAE/MFE.

### A9. Zella-Score-equivalent "Health Score"
- **What:** Single 0-100 trading-health score.
- **Evidence:** `zella_scores/current`, `insights/zella-score`, help article (weights + tiers, section 7 of report). **Confidence: High** (formula structure/weights/tiers), **Medium** (exact image-only sub-formulas -> independent equivalent).

### A10. Insights (behavioral flags)
- **What:** Auto-detected patterns: revenge trading, overtrading, premature exits, missed scaling - trade- and day-level; filterable.
- **Evidence:** `insights`, docs section "Zella Insights". **Confidence: Medium** (behaviors listed; thresholds not public -> we define transparent heuristics).

---

## B. Advanced modules (later phases)

| Module | Evidence | Confidence | Notes for independent build |
|---|---|---|---|
| Backtesting (manual) | `backtesting/sessions/*`, docs | High (exists) / Low (market-data source) | Needs historical OHLC data source; chart via TradingView/own charts |
| Automated backtesting | `automated_backtesting/backtests/:id/{run,parse}` | Medium | Strategy-rule parser + runner |
| Trade Replay | `/replay-trades`, docs | Medium | Needs tick/second data; replay own executions over OHLC |
| Progress Tracker | `/progress-tracker`, docs | High | Rule-adherence checklist + trend |
| Pre-market routine / review | `setup_routine`, `pre-market/review` | Medium | Checklist + plan vs. actual |
| Prop Firm Sync | `propfirm-sync`, `challenges`, `plaid_connections` | High (exists) / Low (Plaid) | Manual entry equiv first |
| Mentor Mode / Spaces | `spaces` (99), `mentor`, `mentee_sessions` | High | Sharing + community; large scope, defer |
| Zella AI (agents + chat) | `zella_ai/*`, `my_agents`, `agents` | High (exists) / Low (impl) | Auto-tagger/session-review are tractable with our own LLM calls |
| University / Strategies library / Community | `university`, courses/listings chunks | High | Content platform; out of core scope |
| Billing (Stripe), Referrals, 2FA, OAuth | `account/stripe_*`, `referrals`, `mfa`, `oauth` | High | Standard; add when multi-user |

---

## C. Explicitly out of scope / not reproduced
- TradeZella's proprietary code, UI designs, copy, brand assets, licensed TradingView library.
- Any subscription-gated screen we could not observe is reproduced as a **reasonable independent
  equivalent** and labeled as such; we do not claim parity with unverified behavior.
