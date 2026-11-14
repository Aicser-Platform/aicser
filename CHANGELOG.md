# Changelog

Versions follow `MAJOR.MINOR.PATCH`. Database migrations run on start (Docker) or as a job before new pods (Helm) and are forward-only: back up PostgreSQL before upgrading. Entries marked **Action needed** change what operators must configure.

## Unreleased

### Action needed

- **Slack asking now requires `SLACK_SIGNING_SECRET`.** Requests without Slack's signature are refused (anyone could previously ask a workspace's data). Set it from your Slack app's Basic Information page; the Slack page in Settings › Integrations shows the Events URL.
- **Teams messages are verified against Microsoft's signature** and replies go only to Microsoft's addresses. The messaging endpoint is now `<your address>/api/teams/webhook` (the old settings hint pointed elsewhere). Download the app package from Settings › Integrations › Microsoft Teams.
- **Helm chart 0.2.0** adds the background worker (alerts, schedules, Agent tasks, sensors did not run on Kubernetes before), a migration job and disruption budgets. Set `persistence.existingClaim` to a ReadWriteMany volume, or use object storage. See `deploy/OPERATIONS.md`.
- New migrations: `2026_11_01_metric_lifecycle`, `2026_11_01_promotion_requests`, `2026_11_02_seat_requests`, `2026_11_02_share_links`.

### Added

- Light members can ask for an AI seat from the point they are blocked; admins see it in their inbox and approve it in Settings › Billing › Seats. Seat changes show their price first and only happen if billing succeeds; KHQR upgrades apply once paid.
- Share dialog for charts and dashboards: choose who can open it and copy a short link (`/s/...`) that stays the same if you change expiry, password or data settings. Public links show a saved copy by default, and need no embed. Charts get a public link for the first time.
- Numbers in Ask and the Agent open their trail: data source, tables, calculation, query and the data itself, for estimates too.

- Search from anywhere: the header Search control or ⌘K / Ctrl K finds pages, settings and your dashboards, charts, metrics and tables.
- Alerts on your phone or browser (Web Push). Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; people turn it on in Settings › Notifications. New migration: `2026_11_02_push_subscriptions`.
- Releases: compare a project with another (or with Git) and release definitions with a second admin's approval; keep definitions in a GitHub repository (Settings › Project › Releases).
- Power BI and Tableau import, one file or a batch with an inventory of what each holds and shares.
- History for charts and alerts; deprecated metrics (kept for existing charts, no longer offered to Ask).
- @mentions in dashboard comments, with inbox entries and email.
- Excel add-in (desktop and web), with sign-in through Office's dialog on the web.
- Compliance: audit streaming to a SIEM per organization, audit retention, legal hold (Settings › Audit log); AI calls export.
- Adoption page for admins; AI spend limits per project; handover of a person's work before removing them.
- Essentials sidebar for people who view and ask; first-hour steps on the chat welcome; empty pages offer to let the Agent set things up.
- Two-step sign-in with an authenticator app and backup codes (Settings › Security), for password, Supabase and Keycloak sign-in.
- Documents (unstructured files) live under Connections › Documents; `/knowledge` links redirect.

### Fixed

- Moving any chart to trash failed.
- dbt import always answered "Choose a connection".
- Charts the Agent discarded while building a dashboard stayed in the library.
- Single-number answers read like a template ("There are 40 customers are there count").
- Company on a profile could disagree with the organization: it now shows the organization's name everywhere, including in AI answers, and only people who can edit the organization change it.
- Editing, pausing or resuming an alert failed with a server error.
- Alerts whose check cannot run now show "Can't check" instead of OK; pausing closes the open incident; Alerts lists only the current project; Test works on chart and smart alerts. New migration: `2026_11_02_alert_last_error`.
- Every full page load waited 4 seconds before showing anything (language loading waited for sign-in, which had not been started). Pages also download far less code.
- Answers keep running when you refresh or leave `/chat`; coming back shows their progress, and Stop still works.
- Public sharing Off now also stops embeds, embedded assistants and data shares, including links that already exist.
- Alert webhook addresses and PagerDuty keys are encrypted, and shown only as their last four characters. New migration: `2026_11_02_alert_channel_secrets`.
- Charts shared to Insights showed a blank card, and any chart in a box without a fixed height could do the same.
- `/chat` opened empty after a refresh even though the conversation was saved; it now reopens where you were.
- Text typed in `/chat` but not sent stays when you leave or refresh the page (per conversation, for that browser tab).
- Agent tasks show their work as it happens: the plan as progress, a block for each update, and each step's SQL and results in place. The duplicated status line and "usually about" estimate are gone.
- An Agent task survives a failed model call: it tries again, then uses the default model, before giving up. A running query shows its SQL before the result arrives.
- Pages load the same way: one skeleton from click to content, with no blank gap and no spinner in the page body. Ask opens faster, and sidebar pages start loading on hover.
- Alerts: Events is now Incidents, led by when each started; a firing rule links to its incident, so the two tabs no longer look alike.
- The server froze for every user for 10 seconds or more on the first AI request after a start. Opening Ask no longer live-checks every model. Stalls of the server's event loop are now logged with their cause (`AISER_LOOP_STALL_WARN_S`, 0 turns it off).
- Ask and the Agent write for the person asking: job and data experience from Settings › Profile now shape every answer, in plain business language by default. Ask used to read only onboarding answers; the Agent had neither, nor the project or organization name.
- Semantic layer domains can be edited and deleted (with Undo), not only created.
- Numbers in Agent answers link to where they came from. The Agent corrects figures it can't back up before answering; anything still unconfirmed is labelled an estimate, in Ask too. The "x of y figures" count is gone.
- Ask uses Settings › AI memory, and short requests and questions about yourself no longer run a full Agent task.
- A slow data source list no longer clears the selected source for later visits.
- Saying hello to the Agent gets a reply in seconds; it used to run a full analysis.
- Search models stayed in memory when idle (~0.75 GB less per server process once idle).
