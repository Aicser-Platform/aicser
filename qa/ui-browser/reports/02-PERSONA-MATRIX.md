# 02 — Persona matrix

Personas live as YAML under `../personas/`. Use them when designing UI *and* when writing journeys.

| Persona id | Literacy | Primary surfaces | Must feel simple | May stay powerful |
| --- | --- | --- | --- | --- |
| `first_time_nontech` | low | `/chat` | Answer, one chart, one next step | — |
| `finance_analyst` | medium | `/chat` forecast | Confidence explained, non-empty insights | Mode = Forecast |
| `sales_vp` | medium | `/chat` diagnose, `/dashboards` | Drivers + actions | Dashboard Studio deep edit |
| `data_engineer` | high | `/data`, Sources | Clear source selection | Full schema tree + types |
| `it_admin` | medium | Settings, identity | Find Settings without Query Editor | SCIM / residency advanced |

## Design rule

**One chrome, multiple disclosure levels** — do not ship a separate “dumb” app. Hide Query Editor / SQL types / model picker behind role or Advanced for low-literacy personas; keep them one click away for engineers.

## Persona × failure modes (from live UI review)

| Persona | Likely failure on current AI Engine chrome |
| --- | --- |
| first_time_nontech | Nav jargon; Sources BIGINT; model pill; noisy chart |
| finance_analyst | ~0% confidence; empty insights after timeout; wrong metric |
| sales_vp | Answer buried; Studio naming; no certified badge |
| data_engineer | Source pill confused with industry; OK with types |
| it_admin | Lost in AI Engine density before Settings |

## Adding a persona

1. Add `personas/<id>.yaml`  
2. Add at least one journey referencing `persona: <id>`  
3. Update this table in the same PR  
