# 06 — UX rubric (1–5)

Used by `harness/rubric.py` (heuristic) and humans (authoritative).

| Score | Meaning |
| --- | --- |
| 5 | Excellent for low-literacy users; power tools available but not intrusive |
| 4 | Good; minor jargon or density |
| 3 | Acceptable for analysts; weak for nontech |
| 2 | Confusing or jargon-heavy default |
| 1 | Blocks trust or task (empty answer, misleading confidence, wrong door) |

## Dimensions

| Key | Question | Typical owners |
| --- | --- | --- |
| `answer_first` | Is the business answer the first readable thing? | ChatPanel, insight cards |
| `jargon_control` | Are SQL/model/engine terms hidden by default? | nav i18n, ModelSelector, schema tree |
| `progressive_disclosure` | Are advanced panels collapsed until needed? | Sources, Advanced toggles |
| `orientation` | Does the user know where they are and which data is active? | header, source pill |
| `trust_clarity` | Are confidence/limits explained with a next step? | forecast chips, quality banners |
| `nav_jobs` | Do nav labels match jobs (Ask, Dashboards, My data)? | navConfig, messages |
| `composer_clarity` | Can they send a question without configuring a pipeline? | composer footer |
| `empty_error_states` | Do failures show honest partial answers? | empty insights UI |

## Gate (recommended)

For `first_time_nontech` on P0 journeys: **no dimension ≤ 2** and **overall ≥ 3.5** before calling the surface “simple.”
