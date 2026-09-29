# 10 — End-user E2E: AI Decisions, Knowledge, Data source manage

**Date:** 24 Sep 2026 · **SUT:** `http://localhost:3001` (EE, project `kj`, Demo user) · **Method:** Cursor IDE browser as a first-time admin/analyst — click through, no product knowledge assumed.  
**Scope:** `/ai-decisions`, `/knowledge`, `/data/sources/{id}` tabs (Overview · Schema · Permissions · Row filters · Column rules).  
**Stack note:** Client/API went down mid-pass (`You're offline`); Row filters / Column rules create flows and `/data` list were only partially exercised. Findings below are from live UI unless marked *code-confirmed*.

---

## Verdict (one line each)

| Surface | Intuitive? | E2E working? | Vs industry (user view) |
| --- | --- | --- | --- |
| **AI Decisions** | Empty state is clear; create form is short | **No** — Save blocked by plan gate; toast says only `error` | Behind Snowflake Cortex / Azure Content Safety “create classifier” flows that show **upgrade or trial** *before* the form |
| **Knowledge** | Strong orientation copy + tabs | Libraries/docs **yes**; **Test search** hangs / fails; Sync gated | Closer to Notion/Drive “library → index → ask” than raw vector consoles; Test search should match Ask’s retrieval |
| **Data → manage** | Tabs match governance mental model | Overview/Schema/Permissions **usable**; list page `/data` **hung** on full-screen Loading | Schema preview + descriptions ≈ Tableau/Looker catalog; Overview labels/status lag Power BI / Snowflake “source health” |

---

## A. `/ai-decisions`

### What worked
- Page title + empty copy: create a decision → classify rows — readable for a non-engineer.
- **New decision** drawer: Name, Answer type (Yes/No), Question, Confidence threshold, optional unmask — low field count (good).
- Placeholders (“Refund request?”) teach by example.

### What broke / blocked E2E
1. **Plan gate after form fill (P0).**  
   `POST /api/ai-decisions/definitions` → **402** `Feature 'ai_decisions' requires a higher plan.`  
   UI toast: bare **`error`**. Form never warned; **New decision** still offered.  
   User feeling: “I filled everything; product is broken.”  
   *Industry:* gate CTA (Upgrade / Contact admin) on empty state or disabled primary with reason — never after Save.

2. **Create → Preview → Run never reached** because no definition persisted (`GET …/definitions` stayed `[]`).

### UX notes (even if plan unlocked)
- “Send row text unmasked” is advanced; default off is good — needs one-line “when to turn on.”
- Threshold `0.85` without “what happens below this” is opaque for nontech.

**Pointers:** `client/ee/src/ee/app/(dashboard)/ai-decisions/page.tsx` (`saveDefinition` → `message.error`); plan helpers already in `client/src/utils/api.ts` (`isPlanFeatureGate` / modal). Wire those instead of raw `(e as Error).message`.

---

## B. `/knowledge`

### What worked
- Breadcrumb `My data / Knowledge`; subtitle ties upload → Ask / Search docs.
- Tabs: All libraries · Documents in “KBb” · Test search · Sync from apps — discoverable.
- Documents: `ABA_FY2024_Audited_FS-EN.pdf` **ready**, **129** chunks; Rename / Delete / Rebuild search index present.
- Primary actions: Upload document · Search in Ask · Create library.
- Sync tab exposes SharePoint (disabled until connector chosen) — honest about enterprise sync.

### What broke / friction
1. **Test search stuck on “Searching…”** (live).  
   BFF `POST /api/knowledge/search` with valid `data_source_id` → **500** `fetch failed` (Next → API). Catch in `KnowledgeSearchPanel` clears results **without** an error alert → looks like infinite spin or silent empty.  
   *Industry:* Glean / Notion AI show “No matches” or “Search unavailable — retry” within ~3s.

2. **Library name “KBb”** still cryptic (known F-KNOW-01 / data). Fine for power users; bad default for demos.

3. **Sync from apps** — Sync now disabled until site ID; empty connector list needs “Connect SharePoint in Settings” CTA (not just disabled controls).

### Intuition score
Orientation **4/5**; verify-search loop **2/5** until search errors surface and BFF/API path is stable.

**Pointers:** `KnowledgeSearchPanel.tsx` (silent `catch`); `client/src/app/api/knowledge/[...path]/route.ts` (proxy); `knowledge/page.tsx` tabs.

---

## C. `/data` + `/data/sources/{retail}` manage

### Entry
- Direct manage URL for **retail** (`sample_duckdb`) worked.
- **`/data` list:** full-page **Loading…** with no timeout/Back during this session (same class of risk as former F-QE-01). Treat as P1 reliability.

### Overview
| Observed | User impact |
| --- | --- |
| Banner: “Row filtering is not being applied — 1 grant(s) allow all rows.” | Correct for admins; jargon for nontech (align with F-DATA-01 plain language) |
| Label **“Policy name”** for source name | Wrong key: uses `data_source_rls_policy_name` in `DataSourceOverviewTab.tsx` |
| Status **UNKNOWN**, Rows/Size **—**, Updated raw ISO | Feels unfinished vs Snowflake “Active · N tables · last sync” |
| Grantee type `SAMPLE_DUCKDB` | Internal enum, not user language |

### Schema (strongest tab)
- Tables under `retail_supply_chain.*` with Role (ID / Measure / Dimension), description placeholders (“What does this column mean?”), Search tables, **Preview data** → **Hide preview**.
- Quirks: type cell reads like **NumberBIGINT** (joined labels); descriptions empty on sample — expected.
- *Industry:* Matches “catalog + glossary” pattern (Looker LookML explore / Tableau metadata); preview CTA is friendlier than SQL-only consoles.

### Permissions
- Grant composer: people/teams/projects · Explore · Choose row/column access · Grant.
- Existing grant: project **kj** · View/Edit/Manage/Query · “All rows — row filtering not applied” / “All columns…”.
- Intuitive for an IT admin; heavy for a store manager — progressive disclosure OK if Overview already explains “everyone sees all rows.”

### Row filters / Column rules
- Tabs visible (EE). Live create/edit **not finished** this run (stack offline).
- *Code-confirmed:* New policy → `/row-filters/new`, `/column-rules/new`; Column rules has **Suggest** (PII-style) — good industry parallel to BigQuery policy tags / Snowflake masking policies **if** empty states explain “limit which rows/columns each share sees” in plain English.

### “Back to data”
- Present; if `/data` hangs, back button fails the escape hatch.

---

## Industry comparison (user testing lens)

| Practice | Typical product | Aicser today |
| --- | --- | --- |
| Soft-gate premium features | Upgrade card on empty state | AI Decisions: form then 402/`error` |
| Retrieval smoke test | Instant passages + score | Test search: hang / silent fail |
| Source health | Green status + row counts | UNKNOWN / em dashes |
| Row/column security | Named policies + “who uses this” | Permissions sentences good; Overview banner still engineer-speak |
| Knowledge libraries | Friendly names + “Ask about this” | Ask about this library CTA exists — keep; rename demos |

---

## Recommended FE backlog (new IDs)

| ID | Severity | Finding | Acceptance |
| --- | --- | --- | --- |
| **F-AIDEC-01** | P0 | Plan-gated Save shows toast `error`; New decision offered without upgrade path | Empty state or Save uses plan-gate modal; no form if feature locked |
| **F-AIDEC-02** | P1 | No plain explanation of threshold / unmask | One helper sentence under each control |
| **F-KNOW-02** | P0 | Test search: hanging spin + silent failure on API/BFF error | Error Alert + Retry; never infinite Searching |
| **F-KNOW-03** | P2 | Sync tab: disabled controls without next step | CTA to Settings / connect app |
| **F-DATA-02** | P0 | Overview label “Policy name” for source name | Use source-name i18n key |
| **F-DATA-03** | P1 | Overview Status UNKNOWN + raw ISO + SAMPLE_DUCKDB | Human status (Active), relative time, friendly type |
| **F-DATA-04** | P1 | `/data` full-page Loading with no escape | Same 8s tip + Reload/Back as SQL editor |
| **F-DATA-05** | P2 | Schema type display concatenates category + SQL (`NumberBIGINT`) | Show friendly type; SQL on hover |
| **F-DATA-06** | P2 | Bypass banner grant jargon | Match F-DATA-01 plain copy |

---

## Rubric (this pass)

| Dimension | AI Decisions | Knowledge | Data manage |
| --- | --- | --- | --- |
| First-time orientation | 4 | 4 | 3 (if deep-linked); 2 via `/data` hang |
| Task completion E2E | 1 | 3 (docs ok; search fail) | 3 (view/schema/grants); create policies TBD |
| Trust / error honesty | 1 | 2 | 3 |
| Literacy-friendly copy | 3 | 4 | 2 (Overview) / 4 (Schema descriptions) |

---

## Resume checklist (when stack is up)

1. Confirm plan unlock or show gate UI → create definition → preview → run.  
2. Fix/search: Test search for `revenue` → passages + %.  
3. Row filters: New policy on `stores` → attach on Permissions → banner clears.  
4. Column rules: Suggest → save mask on one PII-like column → grant uses policy.  
5. `/data` list: open retail via Manage without hang.


---

## Engine response (24 Sep, later) — all nine items fixed at the root

| ID | Root cause found | Fix |
| --- | --- | --- |
| F-AIDEC-01 | Not the page: the server's error normaliser dropped `upgrade_required`/`required_plan` whenever a message was present, and the client showed the `error` code ("error") before `message`. Every plan gate in the product was affected; the upgrade prompt could never fire | Both fixed (test updated: extras now survive under `details`); AI Decisions shows the plan requirement before the form |
| F-AIDEC-02 | — | Threshold as %, "what happens below it"; unmask "when to turn on" |
| F-KNOW-02 | The first search after a deploy imported torch (~65 s), loaded the model (~28 s incl. online checks) and downloaded it (400 MB, cache not persisted). The proxy's "fetch failed" was the timeout | Warm-up at startup, cache-first load, `hf_model_cache` volume, 30 s bound with "starting up"; panel shows error + Retry |
| F-KNOW-03 | Connectors are workspace-level server settings with no UI; undocumented | Plain "No apps connected yet" state; settings documented in `.env.ee.example` |
| F-DATA-02..06 | Wrong i18n key; enums shown raw; tag + SQL type rendered with no separator; jargon | See backlog 04 |

**Also changed since this test:** Knowledge is now one master–detail screen (library list → documents; Test search and Sync from apps folded underneath) instead of four tabs.

### Follow-up (verified in a headless browser against the live stack)

- **Search hang, deeper cause:** after the first fix the warm-up itself never finished. Startup warm-ups for the embedding model and the reranker (plus a first search) imported torch in parallel threads and deadlocked. All local model loads now share one lock (`src/shared/model_loading.py`); the schema service's separate loader uses it too. Warm-up now completes ~32–53 s after start; search answers in **0.8 s** (2 s through the app). Before: 2-minute hang.
- **Result order looked inverted (70%, 71%, 72%):** results were ordered by the cross-encoder, but the % shown was the pre-rerank score. The shown score is now the ranking score (e.g. 91%, 87%, 67%…).
- **Table passages** showed raw `|---|`, `<br>`, `**`; they now read as plain lines.
- **AI Decisions locked state** verified: "See plans" + explanation, no form; the empty detail panel no longer says "create a decision".
- **Data source header** no longer shows `sample_duckdb · unknown`.
