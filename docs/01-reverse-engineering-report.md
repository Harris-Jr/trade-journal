# TradeZella - Public-Surface Reverse-Engineering Report

> Scope & ethics: This report documents **publicly observable** behavior of TradeZella
> (shipped client JavaScript served to any browser, the public marketing site, the
> public help center, and the public `llms-full.txt` product document). No
> authentication was bypassed, no account data was accessed, and no proprietary
> source, credentials, or assets were copied. The goal is a **clean-room** functional
> specification for an independently written equivalent.

Date of analysis: 2026-10-27
Tooling: REA MCP server v6.8.0 (identity verified), plus direct fetch of public assets.

Every claim below is tagged:
- **[OBS]** directly observed in shipped code or official public docs
- **[INF]** reasonable inference from naming/structure/standard practice
- **[ASSUMED]** unverified assumption; flagged for later confirmation

---

## 1. Hosting & topology  [OBS]

| Host | Role | Evidence |
|---|---|---|
| `tradezella.com` -> `www.tradezella.com` | Marketing site (**Webflow**, Cloudflare) | `x-wf-region: us-east-1` response header; 301 redirect |
| `app.tradezella.com` | **Application SPA** (the product) | HTML shell with `id="root"` |
| `api.tradezella.com/api` | Primary REST API base | `REACT_APP_API_URL:"//api.tradezella.com/api"` literal in entry bundle |
| `b.tradezella.com` | Secondary host (purpose unconfirmed) **[INF]** billing/beacon | URL literal in bundle |
| `mcp.tradezella.com/mcp` | Model-Context-Protocol server | `REACT_APP_MCP_URL` |
| `market-data-proxy.herokuapp.com` (+ `-staging`) | Market-data / quote proxy | `REACT_APP_MARKET_DATA_PROXY_API_URL` |
| `ajfhck.tradezella.com/analytics/loader.js` | First-party-proxied analytics (adblock evasion) **[INF]** | obfuscated-subdomain loader literal |

Historical signal: `og:image` points at `traderlab-dev.herokuapp.com` -> the backend's
internal codename appears to be **"traderlab"**, historically on Heroku. **[INF]**

## 2. Frontend stack  [OBS]

Client-rendered **React SPA** (no SSR markers; single `#root`). From chunk filenames and module fingerprints:

| Concern | Technology | Evidence (chunk / module) |
|---|---|---|
| Bundler | **Rolldown** (Vite-family, Rust) | `rolldown-runtime.*.js`; `/static/js/*.<hash>.js` layout |
| UI framework | React | `id="root"`, Babel helper chunks (`defineProperty`, `extends`, `objectWithoutPropertiesLoose`) |
| Styling | **Emotion** (CSS-in-JS) | `emotion-styled.browser.esm.*` |
| Rich-text editor | **Lexical** (Meta) | `LexicalComposerContext.prod`, `SimpleLexicalEditor`, `LexicalDocumentViewer` |
| Advanced charts | **TradingView Charting Library** (licensed) | `/trading_platform/charting_library.standalone.js` |
| Analytics charts | **Highcharts** | `highcharts/highcharts`, `highcharts/modules/{exporting,full-screen}` |
| Icons | Vuesax icon set | `vuesax/{bold,linear,outline}/*` |
| HTML sanitize | DOMPurify | `purify` chunk |
| PDF export | present | `pdfUtils`, `printNote` |

Code splitting: the **core journal app is bundled into the 13.4 MB entry** (`index.<hash>.js`);
53 additional lazy chunks cover Lexical, the Classroom/Course/Listing (marketplace) surface,
Admin, and Chat.

## 3. Third-party integrations  [OBS]
From `REACT_APP_*` config keys and resource paths in the bundle:

- **Error tracking:** Sentry (`REACT_APP_SENTRY_KEY`)
- **Product analytics:** PostHog (`REACT_APP_POSTHOG_*`), Pendo, Userpilot
- **Support/chat:** Intercom (`REACT_APP_INTERCOM_APP_ID`)
- **Churn/retention:** Churnkey (`REACT_APP_CHURN_APP_ID`)
- **Auth:** Google OAuth (`REACT_APP_GOOGLE_OAUTH_ENABLED`), plus `/oauth/authorize`
- **Billing:** Stripe (`account/stripe_portal`, `stripe_subscription_update`, `stripe_yearly_upgrade`)
- **Bank/prop-firm transactions:** **Plaid** (`plaid_connections`)
- **Market data:** **Polygon.io** (`polygon/v3/reference/tickers`), **Finnhub** (`finhub`), **CoinAPI** (`coinapi`), **OANDA** (`oanda`)
- **Video:** Wistia; **Changelog:** Canny; **Link shortener:** Dub (`dub`)
- **AI:** first-party "Zella AI" (`zella_ai/*`), incl. an OAuth-connected desktop app release channel

## 4. Client route map  [OBS]
Extracted from navigation string literals (`docs/evidence/client-routes.txt`). Dynamic
segments shown as `:id`. Two parallel trade areas exist: **`/tracking`** (live trading) and
**`/backtesting`** (simulation), with mirrored sub-views.

```
/home                               Dashboard
/auth/{login,register,logout,payment,change-password}, /onboarding/congrats
/add-trade, /ftux-add-trade/:id     Manual trade entry (ftux = first-time UX)
/trade-log                          Trade list
/trade-view, /tracking/trade-view   Trade detail
/daily-journal/                     Daily journal
/notebook                           Notebook (Lexical)
/reports, /tracking/reports/recaps_insights
/insights, /insights/zella-score    Zella Insights / Score
/progress-tracker, /tracking/progress-tracker
/strategy/{my-strategy,create-strategy}   Playbooks
/tracking/{add-trade,day-view,replay-trades,pre-market/review/:id}
/replay-trades                      Trade Replay
/pre-market/review                  Pre-market prep
/backtesting, /backtesting/{automated,create-session,new-session,
   day-view,week-view,month,dashboard,trade-view}
/propfirm-sync, /propfirm-sync/create-challenge, /propfirm-sync/:id
/spaces, /spaces/list               Community / Mentor spaces
/mentor, /mentor-mode, /student-mode, /mentor/{mentor-mode,student-mode}
/university                         Zella University
/agents                             Zella AI agents
/referrals
/settings, /settings/{account,profile,subscription,tags,balance-transaction}
/admin/symbol_mappings              Admin
/errors/{403,404}
```

## 5. REST API catalog  [OBS]
Base: `https://api.tradezella.com/api`. 427 distinct path shapes extracted
(`docs/evidence/api-paths.txt`). HTTP-verb call sites in the entry bundle:
`.post` x281, `.delete` x244, `.patch` x100, `.put` x53 (`.get` count unreliable -
collides with lodash `_.get`). Grouped by top-level resource (distinct sub-paths):

| Resource | # | Notable endpoints (observed) |
|---|---:|---|
| `spaces` | 99 | `/:space_id/posts`, `/posts/:id/comments`, `/members`, `/invites`, `/invite_link`, `/chat/channels/:id/messages`, `/chat/channels/:id/pinned_messages`, `/tags`, `/reports`, `/me` |
| `trades` | 33 | `trades/`, `create_execution_in_trade`, `split_trade`, `set_trades_account`, `:id/add_image`, `:id/edit_chart`, `:id/delete_attachment`, `:id/update_attachment_position` |
| `reports` | 33 | performance report variants |
| `user` | 29 | `get/set_dashboard_settings`, `..._report_settings`, `..._trade_log_settings`, `..._trade_details_settings`, `get/set_onboarding`, `tours`, `complete_tour`, `start_trial`, `limits_usage`, `limits_status`, `annual_recap`, `ai_usage_breakdown`, `sign_out_other_devices`, `update_password` |
| `account` | 29 | Stripe billing: `stripe_portal`, `stripe_subscription_update`, `stripe_yearly_upgrade` |
| `admin` | 23 | `symbol_mappings`, `zella_ai`, `delete_user/:id`, `cancel_delete_user/:id` |
| `filters` | 21 | saved filters incl. `filters/winrate` |
| `backtesting` | 16 | `sessions/:id`, `sessions/:id/duplicate` |
| `trading_charts` | 13 | `layouts/{saved,current,autosave}`, `indicators`, `indicator_templates`, `chart_templates`, `default_layouts`, `backtesting_chart_settings` |
| `automated_backtesting` | 12 | `backtests/:id`, `:id/run`, `:id/parse`, `templates`, `trade-context` |
| `zella_ai` | 11 | `chats`, `chats/messages`, `chats/:id/archive`, `responses`, `responses/:id/{turn,stop,decline_tool_result}`, `ai_settings`, `chart_state`, `oauth_connections`, `entity_refs/resolve`, `desktop_release/{latest,download}` |
| `notebook` | 10 | `folders`, `folders/all/notes/search`, `folder_templates`, `tags` |
| `strategy` | 8 | `playbooks`, `my-strategy` |
| `challenges` + `challenge_steps` + `challenge_transactions` | 13 | prop-firm challenge tracking |
| `api_syncs` + `api_credentials` + `external_accounts` + `account_rates` | ~20 | automated broker sync & credentials |
| `plaid_connections` | 3 | Plaid link for prop-firm transactions |
| `imports` | 2 | CSV/file trade import |
| `my_agents` + `assist`/`assists` | ~9 | Zella AI agents + rule-based "assist" configs |
| `zella_scores` | 1 | `zella_scores/current` |
| `day_ratings`, `setup_routine`, `breakeven_settings`, `default_exit_thresholds`, `future_multipliers`, `journal`, `journal_stats`, `tag_categories`, `balance_transactions`, `performance_reports`, `mfa`, `referrals`, `notifications`, `payment`, `guided_flows` | - | journal day ratings, pre-market routine, trade-calc settings, futures multipliers, journals/stats, tagging, deposits/withdrawals, reporting, 2FA, referrals, notifications |

## 6. Inferred data model  [OBS vocabulary / INF relationships]
Field names below were **observed as string literals** in the bundle; entity relationships are **[INF]**.

- **Account** (`external_accounts`, `account_rates`): broker/prop accounts; `starting_balance`, `account_balance`, multi-currency, `future_multipliers`.
- **Trade** (`trades`): aggregates executions. Observed fields: `net_pnl`, `gross_pnl`, `r_multiple`, `realized_rr`, `planned_rr`/`initial_target`, `mae`, `mfe`, `commission`, `fees`, `swap`, `entry_price`, `exit_price`, `quantity`, `side` (long/short), `symbol`, `instrument_type`, `setup`, `mistakes`, `stop_loss`, `take_profit`, `trade_rating`, `tags`. Supports `split_trade`, image/chart attachments.
- **Execution**: individual fills (`create_execution_in_trade`); a Trade = ordered set of executions.
- **Strategy/Playbook** (`strategy/playbooks`): named setup with rules; trades attach to it; per-strategy metrics.
- **Tag / TagCategory** (`settings/tags`, `tag_categories`): user labels incl. mistakes/setups/emotions.
- **JournalEntry / DayRating** (`daily-journal`, `day_ratings`, `journal`, `journal_stats`): per-day notes + rating.
- **Note / Notebook** (`notebook/folders`, `notebook/tags`): Lexical rich-text docs in folders.
- **BalanceTransaction** (`balance_transactions`): deposits/withdrawals/adjustments.
- **BacktestSession** (`backtesting/sessions`, `automated_backtesting/backtests`): simulated-trade container.
- **ZellaScore** (`zella_scores/current`): composite health score (see report section 7).
- **Space / Post / Comment / Channel / Message / Invite / Member**: community+mentor graph.
- **Challenge / ChallengeStep / ChallengeTransaction**: prop-firm evaluations via Plaid.

## 7. Documented calculations  [OBS - public help center & llms-full.txt]

**Zella Score** (0-100 composite; help article 10305642). Weighted blend of six 0-100 sub-scores:

| Component | Weight | Scoring (documented) |
|---|---:|---|
| Profit Factor | 25% | Tiered: >=2.6->100; 2.4-2.59->90-99; 2.2-2.39->80-89; 2.0-2.19->70-79; 1.9-1.99->60-69; 1.8-1.89->50-59; <1.8->20 |
| Average Win/Loss ratio | 20% | Same tier table as Profit Factor |
| Max Drawdown | 20% | `score = 100 - DD%`, where `DD% = (peak-to-trough drop / max cumulative P&L before drop) x 100` |
| Trade Win % | 15% | `score = min(100, (win% / TopThreshold) x 100)`, default `TopThreshold = 60` (e.g. 25/60x100 = 41.67) |
| Recovery Factor | 10% | Tiered: >=3.5->100; 3.0-3.49->70-89; 2.5-2.99->60-69; 2.0-2.49->50-59; 1.5-1.99->30-49; 1.0-1.49->1-29; <1.0->0 |
| Consistency | 10% | if avg profit<0 ->0; else `score = 100 - (stddev(profits) / total profit)` |

> Note: exact sub-formulas for Profit Factor / Avg W-L / Trade-Win / Recovery are shown only as
> images in the help article; the **tier tables and the three textual formulas above are verbatim**.
> Our implementation reproduces these as an *independent equivalent* and is clearly labeled as such.

**Standard metrics** (industry-standard; confirmed as supported in docs):
`win rate`, `profit factor = gross profit / gross loss`, `expectancy`, `R-multiple`,
`avg risk-reward`, `avg win / avg loss`, `max drawdown & recovery`, `cumulative P&L`,
`P&L by day/week/month`, by setup/strategy, by symbol, by time-of-day/day-of-week,
`trade duration`, `MAE/MFE`, net P&L after commissions+fees.

## 8. Import methods & formats  [OBS - help center]
Three logging methods: **Automated broker sync** (API), **File upload** (CSV/Excel), **Manual entry**.
- 500+ brokers/prop-firms; broker-specific CSV mappings (e.g., Tradovate, Tradier orders export, TradeZero).
- **Generic CSV template** for unsupported brokers: pick "Generic", download template, supports
  Stocks, Futures, Options, Forex, Crypto. (Exact generic column headers not fully captured from public
  docs - flagged **[ASSUMED]**; our importer defines an explicit, documented schema of our own.)
- MetaTrader 4/5 sync via server/login/investor-password. Prop Firm Sync pulls fees/resets/payouts via Plaid.

## 9. Product modules  [OBS - llms-full.txt]
1. **Journaling + Analytics** (core) - 2. **Backtesting** (historical data back to Sep 2014) -
3. **Trade Replay** - 4. **Strategies/Playbooks** - 5. **Progress Tracker** (rule adherence) -
6. **Mentor Mode (Spaces)** - 7. **Zella University** - 8. **Free Strategies Library** -
9. **Community** - 10. **Prop Firm Sync** - 11. **Zella AI** (agents: Auto-Tagger, Session Review,
Market Sentiment Briefing; conversational assistant with memory).

Pricing (public): Essential $35/mo, Pro $59/mo, Ultra $99/mo (-25% annual); no free tier/trial.

See `02-feature-spec.md` for per-feature detail with confidence, and `03-implementation-plan.md` for the build roadmap.
