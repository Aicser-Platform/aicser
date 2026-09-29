# 07 — Scenario catalog for UI refinements

**Date:** 24 Sep 2026  
**SUT:** `http://localhost:3001` (API `:8001`) · user **Demo** · project **kj** · source **retail**  
**Method:** Live browser walk (+ prior forecast run). OpenRouter System One verified OK for Ultra.  
**Audience:** FE / product — use IDs when filing work.

---

## OpenRouter note

**Yes — OpenRouter is sufficient** for Jev Ultra in this QA track when configured as:

- `TYPESAFE_API_URL=https://openrouter.ai/api/v1/systemone`
- `TYPESAFE_MODEL=typesafe/jev-1.13`
- `OPENROUTER_API_KEY` (also aliased as `TYPESAFE_API_KEY` / `TEXT_MODEL_API_KEY`)

Verified HTTP 200 against OpenRouter System One. Vendor `model.py` under `qa/ui-browser/vendor/` prefers this URL.

> **Note (engine team, 24 Sep):** the `TYPESAFE_*` names above are the QA harness's own. The **app** reads
> `DECISION_LAYER_BACKEND=jev`, `JEV_ENDPOINT` (default `https://openrouter.ai/api/v1/systemone`), `JEV_MODEL`
> (default `typesafe/jev-1.13`) and `OPENROUTER_API_KEY`, from `deploy/.env.ee` for the EE compose stack.
> Locally it now runs in **shadow** mode (`DECISION_LAYER_MODES={"*":"shadow"}`): Jev is asked alongside the current
> path and agreement is logged in `ai_decision_log`, but nothing it says changes an answer until a question set is
> promoted. When score criteria are sent, they must be an **array** (the API returns 400 for an object).

---

## Surfaces toured

| Route | Loaded? | First-screen job (intended) | Nontech fit |
| --- | --- | --- | --- |
| `/login` | Yes | Sign in | Strong |
| `/chat` empty | Yes | Ask about data | Medium–strong empty state |
| `/chat` after forecast | Yes | Read answer + act | Medium (jargon + dual mode ask) |
| `/feed` | Yes | Shared insights | Medium (filters dense) |
| `/query-editor` | **Stuck on Loading…** | Write SQL | Poor (broken/slow + specialist) |
| `/dashboards` | Yes (after wait) | Create / pick template | Strong empty + templates |
| `/data` | Yes | Manage sources | Weak (“ungoverned grant”) |
| `/knowledge` | Yes | Doc libraries | Weak (“KBb”, “AI Search”) |
| `/ai-decisions` | Yes | Per-row decisions | **Strong** empty copy |
| `/chart-designer` | Yes | Chart library | Medium (Studio vs library split) |
| `/settings` | Yes | Account + org + AI | Overwhelming IA |

---

## Scenarios to refine (by persona journey)

### A. First-time / low literacy — “Just ask”

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-ASK-01 | Land on Ask after login | `/` → often chat; nav still **AI Engine** | Rename nav to Ask; default home = chat |
| S-ASK-02 | Empty chat welcome | Good: “Hi Demo…”, starters, ASK YOUR DATA | Keep; replace starter metrics with business words (not `order_total` / `sku`) |
| S-ASK-03 | Composer controls | **Auto** + **Best available** + **retail** always visible | Source loud (“Data: retail”); model Advanced-only |
| S-ASK-04 | Ask forecast on Auto | Pipeline UNDERSTAND→… then answer | Progress: prefer one plain status (“Working on your forecast…”) over 4 technical stages |
| S-ASK-05 | Read forecast answer | Narrative OK; subtitle has blend + 95% CI | Plain reliability first; methods under Advanced (F-CHAT-11) |
| S-ASK-06 | Post-answer mode banner | “Try Forecast?” after Auto already forecasted | Suppress when answer is already that mode (F-CHAT-10) |
| S-ASK-07 | Insights / actions | Cards with “90% sure”, “High priority” | Good pattern; fix copy “Reliability is reliable” |
| S-ASK-08 | Tabs Analysis / Query Result | Specialist naming | “Answer” / “Data table” (F-CHAT-12) |
| S-ASK-09 | Narrow viewport nav | Feed / AI Engine / Data / Studio / More | Prefer same job labels on desktop rail |

### B. Share & collaborate — Feed

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-FEED-01 | Open Feed | Scope chips: Only me / company / project / Community / All | Default “My project”; collapse Community for private tenants |
| S-FEED-02 | Post composer | Attach insight / Post | OK; explain “insight” once |
| S-FEED-03 | Card content | Mix of good narrative and raw titles (“Change Principal Amount By Npl Flag”) | Require human title on share; sanitize AI titles |
| S-FEED-04 | Org typo in byline | “Aiccser” | Data quality / display fix |

### C. Dashboards — exec / analyst

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-DASH-01 | Empty dashboards | Excellent CTA + industry templates | Keep as pattern for other empty states |
| S-DASH-02 | Template tags | banking / insurance / education… | Map templates to org industry when known |
| S-DASH-03 | Nav “Dashboard Studio” | Studio = maker; list is under it | Top-level “Dashboards” for execs (F-NAV-02) |
| S-DASH-04 | Slow first paint | Long “Loading…” before content | Skeleton with CTA earlier |

### D. Data & Model — engineer vs everyone

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-DATA-01 | Sources table | `SAMPLE_DUCKDB`, **1 ungoverned grant** | Plain: “Connected · Sample data”; governance under Advanced |
| S-DATA-02 | Breadcrumb Data & Model / Data | Category jargon | “My data” |
| S-DATA-03 | Knowledge libraries | Library name **KBb**; “Open AI Search” | Rename empty defaults; “Search in Ask” |
| S-DATA-04 | AI Decisions empty | Clear value prop + New decision | **Reference empty state** for other modules |

### E. Chart designer

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-CHART-01 | Empty library | Explains Studio vs library | One sentence + primary “Ask Aicser for a chart” CTA |
| S-CHART-02 | Properties panel empty | “Select a widget…” | Hide properties until selection |

### F. Settings / IT / admin

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-SET-01 | Settings IA | 20+ items (SCIM, Residency, Decision Layer, Embed…) | Role-based sections: Me / Workspace / Admin / Developer / AI |
| S-SET-02 | Profile fields | Industry, company size, data experience… | Progressive profile; don’t block Ask |
| S-SET-03 | Decision Layer settings | Present (good for shadow/primary) | Link from AI Decisions product page |

### G. Reliability / blockers

| ID | Scenario | Observed | Refinement |
| --- | --- | --- | --- |
| S-REL-01 | Query Editor | Indefinite **Loading…** (full-screen cube) | Fix hang; never leave nontech on blank loader without timeout + Back |
| S-REL-02 | Route transitions | Several pages slow to leave Loading | Shared app shell skeleton + 8s timeout message |

---

## Verification & status (engine review, 24 Sep 2026)

Each scenario was checked against code or reproduced live. Status: `done` (fixed and verified) · `engine-done` (the server side is fixed; the FE part is still open) · `open` · `data` (content, not code).

| ID | Verdict | Status | Note |
| --- | --- | --- | --- |
| S-ASK-01 | ⏸ | open | `nav.ai_engine` is “AI Engine”; renaming to “Ask” needs product sign-off (backlog F-NAV-01) |
| S-ASK-02 | ✅ | engine-done | Starter questions from `/api/ai/chat/discover` now use words, not `order_total` / `sku` |
| S-ASK-03 | ✅ | open | Disclosure work (F-CHAT-05/06/07). The engine now fails over between models on its own (Gemini backup, hedged), so hiding the picker is safe |
| S-ASK-04 | ✏️ | engine-done | Progress now sets expectations: “usually about N s” learned per mode, and “Taking longer than usual…” only past that mode's slow mark; stall lines are translated. Collapsing the stage breadcrumb to one line is still FE work |
| S-ASK-05 | ✅ | done | Subtitle is “next N months · about 89% reliable…”; methods behind “How this forecast was made” (F-CHAT-03/11) |
| S-ASK-06 | ✅ | done | No mode hint on Auto or for the mode already in use (F-CHAT-10) |
| S-ASK-07 | ✅ | done | “Reliability is reliable” removed (F-CHAT-13); low reliability always gives a reason and a fix (F-CHAT-04) |
| S-ASK-08 | ⏸ | open | Tabs “Answer” / “Data table”: copy change, same naming sign-off |
| S-ASK-09 | ✅ | open | Use the same labels on mobile and desktop once F-NAV-01 is settled |
| S-FEED-01..03 | ✅ | open | S-FEED-03: answer text now goes through a plain-names pass; apply it at share time too (F-FEED-01) |
| S-FEED-04 | ✏️ | data | The org is named “Aicser” in the database; check which profile field the byline reads before changing code |
| S-DASH-01..03 | ✅ | open | Keep the empty state as the reference pattern |
| S-DASH-04 | ✅ | engine-done | AI dashboard builds now take 20–25 s (was 40–50 s) with a real AI plan every run; page-shell skeletons are still FE work |
| S-DATA-01/02 | ✅ | open | Plain status and “My data” copy |
| S-DATA-03 | ✏️ | data | “KBb” is a library name a user typed; the “Open AI Search” copy is still worth changing |
| S-DATA-04 | ✅ | — | Reference empty state; Decide now also records what was decided, feeding calibration |
| S-CHART-01/02 | ✅ | open | See 08 D-CHART-* |
| S-SET-01..03 | ✅ | open | Settings grew this round (Identity/SCIM, AI Residency, Decision Layer), so role sections are more urgent |
| S-REL-01 | ✅ | open | Loads in 10–15 s today, but still needs a timeout + Back. The NL→Run failure seen there was an engine bug, now fixed (08 §C) |
| S-REL-02 | ✅ | open | Shared shell skeleton + 8 s message |

## Suggested refinement sprints (ordered)

**Sprint A — Ask clarity (highest ROI)**  
S-ASK-01, 03, 05, 06, 07 copy, 08 · backlog F-NAV-01, F-CHAT-05..12  

**Sprint B — Empty states & sharing**  
S-DASH-01 pattern → Data/Knowledge; S-FEED-03 titles; S-DATA-01 plain status  

**Sprint C — Role shells**  
S-SET-01; hide Query Editor for low-literacy; S-ASK-09 align mobile/desktop labels  

**Sprint D — Reliability**  
S-REL-01 Query Editor load; S-REL-02/S-DASH-04 skeletons  

---

## Journey YAML to add next (QA harness)

```text
ask_empty_starters.yaml      # starters use business language (engine side done — assert no snake_case)
forecast_no_mode_nag.yaml    # no Try Forecast after forecast answer
feed_share_title.yaml        # shared card has human title
data_plain_status.yaml       # no "ungoverned" on default view
query_editor_loads.yaml      # must leave Loading within 8s
settings_role_sections.yaml  # admin vs me
answer_considerations.yaml   # "What this answer took into account" lists horizon, data range, caveats
wait_expectation.yaml        # second run of a mode shows "usually about N s"
decide_case.yaml             # per-record decision: case file card + record "What did you decide?"
ai_search_no_kb.yaml         # says no documents are connected before answering from data
forecast_methods_collapsed.yaml  # no model names or "95% CI" until "How this forecast was made" is opened
```

---

## File pointers (quick)

| Area | Path |
| --- | --- |
| Nav labels | `client/src/layouts/Navigation/navConfig.ts`, `messages/*/nav` |
| Chat shell | `client/ee/.../ChatPanel/ChatPanelMain.tsx` |
| Mode / model pills | `InlineModeSelector.tsx`, `ModelSelector.tsx` |
| Feed | `client` feed pages / cards |
| Dashboards empty | `client/.../dashboards` |
| Data sources table | data sources list UI |
| Settings IA | `client/ee/.../settings` |
| Prior backlog | `04-UI-FINDINGS-BACKLOG.md` |
