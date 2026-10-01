# 03 — Journey catalog

YAML sources: `../journeys/*.yaml`. Tags guide scheduling.

| Journey id | Persona | Tags | Severity focus |
| --- | --- | --- | --- |
| `smoke_nav_chat` | first_time_nontech | smoke, nav, p0 | Reach `/chat` |
| `forecast_answer_first` | finance_analyst | forecast, trust, p0 | Answer + trust |
| `composer_controls_density` | first_time_nontech | composer, p1 | Footer triad |
| `sources_advanced_default` | first_time_nontech | sources, p1 | SQL types default |
| `cross_page_dashboard_studio` | sales_vp | nav, dashboards, p1 | Studio findability |

## Suggested weekly set (Phase 2)

1. `smoke_nav_chat` (always)  
2. `forecast_answer_first` (if demo retail source seeded)  
3. Rotate one of: composer / sources / dashboards  

## Writing a new journey

```yaml
id: my_journey
title: Short title
persona: first_time_nontech
start_path: /chat
goal: >
  One natural-language goal for the agent. No CSS selectors in the goal.
checks:
  - kind: url_contains   # url_contains | text_present | text_absent | css_present | note
    value: /chat
    severity: blocker    # blocker | major | minor
    why: …
rubric_focus: [answer_first, jargon_control]
notes_for_devs: >
  Point at files + backlog IDs.
```

## Agent limits → journey design

Avoid journeys that require: file upload, iframe/shadow-only widgets, new browser tabs, canvas-only charts interaction. Prefer typing in the main composer and clicking Ant Design controls in the root document.
