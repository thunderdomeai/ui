Unified UI Service
===================

This folder hosts the unified UI + BFF (backend‑for‑frontend) that replaces the scattered
frontends (thunderfront, mcpregistry client, sapb1 configurator shell, etc.) with one
Cloud Run entrypoint.

High‑level goals
----------------
- Serve a single React SPA for onboarding, priming, TriggerService deployments, agent/MCP configuration, and health dashboards.
- Keep TriggerService as the only deployment orchestrator; priming happens before we ever call TriggerService.
- Embed the sapb1 Agent Configurator (AI Q/A MCP builder) into the same experience.
- Act as a thin BFF that proxies to downstream services (agent catalog, TriggerService, MCP registry, Web Research, cheat sheet) while keeping secrets in the credential manager.
- Give operators a predictable UX: “left‑to‑right” navigation from onboarding → permissions → priming → deploy → verify.

Backend (FastAPI)
-----------------

- Entry point: `ui/main.py`
- Environment variables:
  - `MAIN_API_URL` – base URL for the core ThunderdomeCore service.
  - `MCP_REGISTRY_BASE_URL` – base URL for the MCP registry service.
  - `THUNDERDEPLOY_BASE_URL` – base URL for the Thunderdeploy API.
  - `WEB_RESEARCH_BASE_URL` – base URL for the Web Research Agent.
  - `CHEATSHEET_BASE_URL` – base URL for the MCP client agent.
  - `UI_SESSION_SECRET` – secret key for session middleware.
  - `AGENT_REGISTRY_BASE_URL` – optional override for the agent catalog service (defaults to `https://thunderagents-497847265153.us-central1.run.app`).
  - `DEFAULT_GITHUB_TOKEN` / `GITHUB_TOKEN` – optional GitHub token passed to the frontend as `window.__UNIFIED_UI_CONFIG__.githubToken`.
- Exposes:
  - `GET /` – serves the built React SPA from `ui/frontend/dist`.
  - `GET /healthz` – reports basic wiring/configuration status.
  - `POST /api/login` – proxies to `MAIN_API_URL /login`.
  - `GET /api/user_info` – proxies to `MAIN_API_URL /userinfo`.
  - `GET /api/mcp/registry` – proxies to `MCP_REGISTRY_BASE_URL /registry`.
  - `POST /api/web-research/invoke` – proxies to `WEB_RESEARCH_BASE_URL /invoke`.
  - `GET /api/cheat-sheet` – proxies to `CHEATSHEET_BASE_URL /cheat-sheet/get-all`.
  - `GET /api/agent-catalog` – proxies to the agent catalog (thunderagents) with CORS handled server‑side so the SPA never talks to it directly.

Frontend (React + Vite)
-----------------------

- Located under `ui/frontend`.
- Standard Vite React app with entry at `src/main.jsx`.
- At runtime, a `window.__UNIFIED_UI_CONFIG__` object is injected from the
  backend, exposing the configured backend base URLs to the SPA.
- Key screens (thunderfront‑inspired):
  - Overview: entry point and quick nav to all flows.
  - Onboarding: download/setup scripts, generate tokens, connect to the right projects.
  - Permissions: verifies required IAM roles before deployments.
  - Priming: Cloud SQL instance/db/user/schema bootstrap + reachability checks.
  - Deploy: wave‑based TriggerService runner (core → broker/scheduling → app services) with env loading from GitHub and deployed configs, plus manual polling/logs.
  - Credentials: upload/select source/target service accounts for deployments; deploy buttons stay disabled until both are active.
  - AI Configurator: sapb1 Agent Configurator/MCP builder folded into the same UI.
  - Health: provider/customer status views.
- Uses the agent catalog via `/api/agent-catalog` (backend proxy) to avoid CORS/HTML fallbacks on Cloud Run.

User paths & flows
------------------
- First‑time operator: open Overview → Onboarding (download setup script) → Permissions → Priming → Deploy.
- Deploy board:
  - Drag agents from the catalog into waves, select branches, adjust env/buckets/db options.
  - “Preview Deployment JSON” to inspect the generated `userrequirements`.
  - “Deploy Selected” submits jobs to TriggerService; status + logs poll automatically.
  - Manual poll button is available per instance if you need a refresh.
- Credentials: pick active source/target service accounts before running deployments; the UI blocks deploy buttons until both are active.
- Agent catalog: loaded through the backend proxy; if the catalog is unreachable the UI surfaces a snackbar and the deploy board stays empty.

GitHub token handling
---------------------
- Frontend reads `VITE_GITHUB_TOKEN` for branch/env fetches. In Cloud Run, the backend can also inject `window.__UNIFIED_UI_CONFIG__.githubToken` from `DEFAULT_GITHUB_TOKEN`/`GITHUB_TOKEN`.
- To run locally: create `ui/frontend/.env` with `VITE_GITHUB_TOKEN=<your_pat>` (repo read scope), then `npm run dev`.

Cloud Run usage
---------------

Build and run locally:

```bash
cd ui
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
uvicorn main:app --reload --port 8080
```

Then visit `http://localhost:8080/` to see the unified UI shell and `http://localhost:8080/healthz`
for wiring status. In Cloud Run, set the environment variables above to point at the
existing internal services and use this service as the single public UI endpoint.
