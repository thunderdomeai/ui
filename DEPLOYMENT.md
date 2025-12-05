# Unified UI Deployment Guide

## Quick Deploy

Deploy the Unified UI to Cloud Run with all required environment variables:

```bash
cd /Users/nt/Desktop/aiproject-sap

gcloud run deploy unified-ui \
  --source ui \
  --project thunderdeployone \
  --region us-central1 \
  --set-env-vars="DEFAULT_GITHUB_TOKEN=YOUR_GITHUB_PAT_HERE"
```

## Environment Variables

### Required

- `DEFAULT_GITHUB_TOKEN` - GitHub Personal Access Token for private repository access
  - Used by bootstrap and deployment endpoints to clone thunderdeploy repo
  - Format: `ghp_...`

### Optional

- `TRIGGERSERVICE_BASE_URL` - URL of deployed TriggerService (auto-configured)
- `AGENT_REGISTRY_BASE_URL` - URL of deployed thunderagents/thunderrepos (auto-configured)
- `UI_SESSION_SECRET` - Secret key for session encryption (defaults to insecure key if not set)

## Deployment Workflow

1. **Initial Deployment**
   ```bash
   gcloud run deploy unified-ui --source ui --project thunderdeployone --region us-central1
   ```

2. **With Environment Variables** (Recommended)
   ```bash
   gcloud run deploy unified-ui \
     --source ui \
     --project thunderdeployone \
     --region us-central1 \
     --set-env-vars="DEFAULT_GITHUB_TOKEN=YOUR_GITHUB_PAT_HERE"
   ```

3. **Update Environment Variables Only**
   ```bash
   gcloud run services update unified-ui \
     --project thunderdeployone \
     --region us-central1 \
     --set-env-vars="DEFAULT_GITHUB_TOKEN=ghp_NEW_TOKEN"
   ```

## Local Development

Run locally with hot-reload:

```bash
# Terminal 1: Backend
cd ui
export DEFAULT_GITHUB_TOKEN=YOUR_GITHUB_PAT_HERE
uvicorn main:app --port 8080 --reload

# Terminal 2: Frontend
cd ui/frontend
npm run dev
```

Access at: http://localhost:5173

## Service URL

After deployment, the service will be available at:
- Production: `https://unified-ui-176446471226.us-central1.run.app`

## Features

The Unified UI provides:
- **Provider Setup Wizard** (`/provider-setup`) - Bootstrap provider infrastructure
- **Credential Management** (`/manage-credentials`) - Manage source/target credentials
- **Environment Priming** (`/priming`) - Database setup and validation
- **Tenant Management** (`/thunderdeploy`) - Deploy and manage tenant stacks
- **Dashboard** (`/dashboard`) - Job status and monitoring

## Troubleshooting

### Bootstrap fails with "No GitHub token"
- Ensure `DEFAULT_GITHUB_TOKEN` environment variable is set during deployment
- Re-deploy with `--set-env-vars` flag

### Services can't connect to TriggerService
- Check `TRIGGERSERVICE_BASE_URL` is correctly configured
- Verify TriggerService is deployed and accessible

### CORS errors
- Ensure services (TriggerService, thunderrepos) allow the UI origin
- Check service CORS configuration

## Architecture

```
Unified UI (FastAPI + React)
    ↓ triggers
TriggerService (orchestration)
    ↓ deploys
thunderdeploy services (triggerservice, thunderfront, thunderrepos, thunderjob)
    ↓ manages
Agent stacks (thunderdomecore, etc.)
```
