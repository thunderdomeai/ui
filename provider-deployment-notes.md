Provider-side Deployment Notes
==============================

Quick reference for bringing up the provider footprint (thunderdeploy stack) so UIs can deploy/prime customer accounts.

Components
----------
- Thunderagents (Cloud Run) – reads/writes `agents.json` in a GCS bucket; exposes `/api/agents` with CORS allowlist.
- TriggerService (Cloud Run) – accepts deploy/prime requests, persists job/dashboard snapshots to GCS, fans out Cloud Run jobs.
- Thunderdeploy job runner (Cloud Run Job) – does the actual build/deploy inside customer projects using provided SA JSON.
- UI (thunderfront or unified-ui) – talks to TriggerService and thunderagents; unified-ui proxies agent catalog via `/api/agent-catalog`.
- Optional: repolist Cloud Function (separate; serves `repositories.json` from another bucket, not used by thunderdeploy unless you wire it).

Buckets (provider project)
-------------------------
- Agent catalog bucket (default `thunder_agents_catalog`): `agents.json` (and legacy `repositories.json`); used by thunderagents.
- TriggerService dashboard bucket: set `JOB_DASHBOARD_GCS_BUCKET` (blob default `job_dashboard.json`); TriggerService writes job state here.
- Optional unified-ui credential bucket: set `CREDENTIALS_BUCKET`/`CREDENTIALS_PREFIX` if you want shared SA storage for the UI; local dev falls back to `/tmp`.

Service accounts & roles (provider)
-----------------------------------
- Thunderagents runtime SA: storage.objectAdmin on the catalog bucket; Cloud Run runner/invoker as needed.
- TriggerService runtime SA: storage read/write on dashboard bucket; permissions to start Cloud Run jobs in provider project.
- Thunderdeploy job runner SA: runs the job; needs provider logging/metrics basics. Uses customer SA JSON to act in customer projects during deploys.
- UI runtime SA (if unified-ui backend): storage read/write on credential bucket if configured; network access to thunderagents/TriggerService; optional GitHub PAT via env.

CORS
----
- Thunderagents: allowlist in `thunderdeploy/thunderrepos/app.py` (or env override) must include your UI host(s) + localhost for dev.
- TriggerService: set `TRIGGER_ALLOWED_ORIGINS` env to include your UI host(s) + localhost.

Key environment variables
-------------------------
- Thunderagents: `BUCKET_NAME`, `FILE_NAME` (agents.json), `LEGACY_FILE_NAME`, `SERVICE_ACCOUNT_JSON_B64`, `SECRET_KEY`.
- TriggerService: `JOB_DASHBOARD_GCS_BUCKET`, `JOB_DASHBOARD_GCS_BLOB` (optional), `TRIGGER_ALLOWED_ORIGINS`, logging level vars; tenant defaults as needed.
- Unified UI: `TRIGGERSERVICE_BASE_URL`, `AGENT_REGISTRY_BASE_URL`, `MAIN_API_URL` (if used), `DEFAULT_GITHUB_TOKEN`/`GITHUB_TOKEN`, `CREDENTIALS_BUCKET`/`CREDENTIALS_PREFIX` (optional).

Provider bootstrap (happy path)
-------------------------------
1) Create buckets: agent catalog; dashboard; (optional) UI credential bucket.
2) Create SAs and grant bucket access + Cloud Run runner/invoker where appropriate.
3) Deploy services (from `thunderdeploy/Makefile` in provider project):
   - `make setup-permissions` (ensures APIs/roles)
   - `make setup-dashboard` (creates dashboard bucket or seeds `job_dashboard.json`)
   - `make` (deploys thunderagents, triggerservice, thunderfront, job)
4) Set env vars on Cloud Run services (above) and update CORS allowlists.
5) (If using unified-ui) deploy it with envs pointing to TriggerService + thunderagents and optional credential bucket.

Using the stack to deploy customer accounts
-------------------------------------------
- Upload/select source (provider deployer) and target (customer) SAs in the UI.
- Prime customer: call TriggerService `/prime-customer` (UI screens do this) to create buckets, tasks queues, scheduler jobs, SAs in the customer project.
- Deploy: pick agents from the catalog, set branches/env, Deploy → TriggerService starts Cloud Run jobs using customer SA JSON to build/deploy into customer project.
- Observe: TriggerService writes job dashboard data to the dashboard bucket; UI polls for status and can fetch Cloud Logging using the source credential.

Notes
-----
- repolist Cloud Function (`repolist-497847265153.us-central1.run.app`) is separate and serves `repositories.json`; it is not used by thunderagents/thunderdeploy unless you rewire the UI.
- For multi-tenant comms (e.g., Twilio ingress → sapb1-connector, QFX/broker DB per customer), ensure each customer project is primed and deployed with the correct agent configs; TriggerService handles per-customer SA payloads.
