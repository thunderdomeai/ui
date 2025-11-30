import base64
import os
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
import jwt
import time
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from uuid import uuid4

from google.api_core import exceptions as gcs_exceptions
from google.cloud import storage
from tenant_stack_template import get_tenant_stack_template, list_tenant_stack_templates

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("unified-ui")

load_dotenv()

app = FastAPI(title="Unified UI Gateway")

BASE_DIR = Path(__file__).resolve().parent

# --- Frontend static assets ---
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")
else:
    logger.warning("Frontend assets directory not found at %s", FRONTEND_DIST / "assets")
logger.info("Frontend dist path: %s (exists=%s)", FRONTEND_DIST, FRONTEND_DIST.exists())


# --- Session / auth bootstrap (kept minimal for now) ---
middleware_key = os.getenv("UI_SESSION_SECRET", "")
if not middleware_key:
    logger.warning("UI_SESSION_SECRET is not configured; using an insecure default key")
    middleware_key = "change-me-in-production"

app.add_middleware(SessionMiddleware, secret_key=middleware_key)


# --- Downstream service base URLs ---
def _normalize_base_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    return value.rstrip("/")


MAIN_API_URL = _normalize_base_url(os.getenv("MAIN_API_URL"))
MCP_REGISTRY_BASE_URL = _normalize_base_url(os.getenv("MCP_REGISTRY_BASE_URL"))
THUNDERDEPLOY_BASE_URL = _normalize_base_url(os.getenv("THUNDERDEPLOY_BASE_URL"))
WEB_RESEARCH_BASE_URL = _normalize_base_url(os.getenv("WEB_RESEARCH_BASE_URL"))
CHEATSHEET_BASE_URL = _normalize_base_url(os.getenv("CHEATSHEET_BASE_URL"))
AGENT_REGISTRY_BASE_URL = _normalize_base_url(os.getenv("AGENT_REGISTRY_BASE_URL") or "https://thunderagents-497847265153.us-central1.run.app")
AGENTONE_CONFIGURATOR_URL = _normalize_base_url(os.getenv("AGENTONE_CONFIGURATOR_URL") or "https://agentone-configurator-176446471226.us-central1.run.app")
TRIGGERSERVICE_BASE_URL = THUNDERDEPLOY_BASE_URL
TRIGGERSERVICE_BASE_URL = _normalize_base_url(
    os.getenv("TRIGGERSERVICE_BASE_URL")
    or os.getenv("THUNDERDEPLOY_BASE_URL")
    or "https://triggerservice-497847265153.us-central1.run.app"
)
DEFAULT_GITHUB_TOKEN = os.getenv("DEFAULT_GITHUB_TOKEN") or os.getenv("GITHUB_TOKEN") or ""
CREDENTIALS_BUCKET = os.getenv("CREDENTIALS_BUCKET") or ""
CREDENTIALS_PREFIX = os.getenv("CREDENTIALS_PREFIX", "unified-ui-credentials")
CREDENTIALS_BUCKET_LOCATION = os.getenv("CREDENTIALS_BUCKET_LOCATION") or "US"


HTTPX_TIMEOUT = httpx.Timeout(600.0, connect=15.0)
READ_TIMEOUT_MESSAGE = (
    "Connecting to the service took too long. The deployment request may still be running; "
    "check the Deployment Dashboard or job history to confirm."
)
REQUEST_ERROR_MESSAGE = "Unable to contact the service. Please try again."

# --- Simple server-side credential store ---
_gcs_bucket = None


def _with_forward_headers(
    request: Request,
    *,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    # Forward key auth headers that are already used across the stack.
    for header_name in ("userkey", "authorization", "x-api-key"):
        header_value = request.headers.get(header_name)
        if header_value:
            headers[header_name] = header_value
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
    return headers


async def _proxy_request(
    request: Request,
    *,
    method: str,
    base_url: Optional[str],
    endpoint: str,
    extra_headers: Optional[Dict[str, str]] = None,
    json_body: Optional[Any] = None,
) -> JSONResponse:
    if not base_url:
        raise HTTPException(
            status_code=500,
            detail="Target service is not configured for this environment.",
        )

    target_base = base_url.rstrip("/")
    url = f"{target_base}{endpoint}"
    headers = _with_forward_headers(request, extra_headers=extra_headers)

    logger.info("Proxying %s request to %s", method, url)

    try:
        async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
            response = await client.request(method, url, headers=headers, json=json_body)
    except httpx.ReadTimeout:
        logger.error("Proxy %s %s timed out", method, url)
        return JSONResponse({"detail": READ_TIMEOUT_MESSAGE}, status_code=504)
    except httpx.RequestError as exc:
        logger.error("Proxy %s %s failed: %s", method, url, exc)
        return JSONResponse({"detail": REQUEST_ERROR_MESSAGE}, status_code=502)

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if response.is_error:
        logger.error(
            "Proxy %s %s failed with status %s: %s",
            method,
            url,
            response.status_code,
            payload if payload is not None else response.text,
        )
        detail = payload if payload is not None else {"error": response.text}
        return JSONResponse({"detail": detail}, status_code=response.status_code)

    if payload is None:
        return JSONResponse({}, status_code=response.status_code)
    return JSONResponse(payload, status_code=response.status_code)


async def _proxy_trigger_request(
    request: Request,
    *,
    method: str,
    endpoint: str,
    json_body: Optional[Any] = None,
    params: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    """
    Proxy requests to TriggerService. TriggerService is the only deployment orchestrator;
    priming is allowed outside but still proxied here for UI simplicity.
    """
    if not TRIGGERSERVICE_BASE_URL:
        raise HTTPException(status_code=500, detail="TriggerService is not configured.")

    target_base = TRIGGERSERVICE_BASE_URL.rstrip("/")
    url = f"{target_base}{endpoint}"
    headers = _with_forward_headers(request)
    # Let httpx set the appropriate multipart boundary when sending files.
    if files is not None:
        headers.pop("Content-Type", None)

    try:
        async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
            response = await client.request(
                method,
                url,
                headers=headers,
                json=json_body,
                params=params,
                files=files,
            )
    except httpx.ReadTimeout:
        return JSONResponse({"detail": READ_TIMEOUT_MESSAGE}, status_code=504)
    except httpx.RequestError as exc:
        logger.error("Trigger proxy %s %s failed: %s", method, url, exc)
        return JSONResponse({"detail": REQUEST_ERROR_MESSAGE}, status_code=502)

    try:
        payload = response.json()
    except ValueError:
        payload = response.text

    if response.is_error:
        logger.error(
            "Trigger proxy %s %s failed with status %s: %s",
            method,
            url,
            response.status_code,
            payload,
        )
        return JSONResponse({"detail": payload}, status_code=response.status_code)

    return JSONResponse(payload, status_code=response.status_code)


def _inject_frontend_config(index_html: str) -> str:
    config = {
        "MAIN_API_URL": MAIN_API_URL,
        "MCP_REGISTRY_BASE_URL": MCP_REGISTRY_BASE_URL,
        "THUNDERDEPLOY_BASE_URL": THUNDERDEPLOY_BASE_URL,
        "TRIGGERSERVICE_BASE_URL": TRIGGERSERVICE_BASE_URL,
        "WEB_RESEARCH_BASE_URL": WEB_RESEARCH_BASE_URL,
        "CHEATSHEET_BASE_URL": CHEATSHEET_BASE_URL,
        "AGENT_REGISTRY_BASE_URL": AGENT_REGISTRY_BASE_URL,
        "DEFAULT_GITHUB_TOKEN": DEFAULT_GITHUB_TOKEN,
        "githubToken": DEFAULT_GITHUB_TOKEN,
        "AGENTONE_CONFIGURATOR_URL": AGENTONE_CONFIGURATOR_URL,
    }
    script = "<script>window.__UNIFIED_UI_CONFIG__ = {cfg};</script>".format(
        cfg=json.dumps(config)
    )
    if "</head>" in index_html:
        return index_html.replace("</head>", f"  {script}\n</head>", 1)
    return f"{script}\n{index_html}"


def _serve_frontend() -> HTMLResponse:
    if not FRONTEND_DIST.exists():
        message = (
            "Frontend build directory not found. "
            "Run 'npm install' and 'npm run build' inside ui/frontend/ before starting the server."
        )
        return HTMLResponse(message, status_code=500)
    index_file = FRONTEND_DIST / "index.html"
    if not index_file.exists():
        return HTMLResponse("Frontend index file is missing.", status_code=500)
    index_html = index_file.read_text(encoding="utf-8")
    index_html = _inject_frontend_config(index_html)
    return HTMLResponse(index_html)


@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    return _serve_frontend()


# --- Simple server-side credential store ---
VALID_CREDENTIAL_TYPES = {"source", "target"}
VALID_ENTRY_STATUSES = {"unverified", "verified", "primed"}
DATA_DIR = Path(os.getenv("CREDENTIALS_DIR", "/tmp/unified-ui-credentials"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _store_file_path(type_name: str) -> Path:
    return DATA_DIR / f"{type_name}-store.json"


def _store_blob_name(type_name: str) -> str:
    prefix = CREDENTIALS_PREFIX.strip("/")
    blob_name = f"{type_name}-store.json"
    return f"{prefix}/{blob_name}" if prefix else blob_name


def _empty_store() -> Dict[str, Any]:
    return {"selectedId": None, "entries": {}}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_entry(entry: Any) -> Dict[str, Any]:
    if not isinstance(entry, dict):
        return {
            "credential": None,
            "label": None,
            "createdAt": None,
            "status": "unverified",
        }
    status = entry.get("status") or "unverified"
    if status not in VALID_ENTRY_STATUSES:
        status = "unverified"
    normalized = {
        "credential": entry.get("credential"),
        "label": entry.get("label"),
        "createdAt": entry.get("createdAt") or entry.get("created_at") or None,
        "status": status,
        "projectId": entry.get("projectId") or entry.get("project_id"),
        "verifiedAt": entry.get("verifiedAt") or entry.get("verified_at"),
        "primedAt": entry.get("primedAt") or entry.get("primed_at"),
        "lastCheck": entry.get("lastCheck") or entry.get("last_check"),
        "lastPrimeResult": entry.get("lastPrimeResult") or entry.get("last_prime_result"),
    }
    return normalized


def _normalize_type(type_name: str) -> str:
    if type_name not in VALID_CREDENTIAL_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported credential type.")
    return type_name


def _entry_activation_allowed(type_name: str, entry: Dict[str, Any]) -> bool:
    status = entry.get("status")
    if status == "primed":
        return True
    if type_name == "source" and status == "verified":
        return True
    return False


def _normalize_store_payload(raw: Any, type_name: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return _empty_store()
    store = _empty_store()
    store["selectedId"] = raw.get("selectedId")
    entries = raw.get("entries", {})
    normalized_entries: Dict[str, Any] = {}
    for entry_id, entry_value in entries.items():
        normalized_entries[entry_id] = _normalize_entry(entry_value)
    store["entries"] = normalized_entries

    if store["selectedId"]:
        entry = store["entries"].get(store["selectedId"])
        if not entry or not _entry_activation_allowed(type_name, entry):
            store["selectedId"] = None
    return store


def _get_gcs_bucket():
    global _gcs_bucket
    if not CREDENTIALS_BUCKET:
        return None
    if _gcs_bucket is not None:
        return _gcs_bucket
    try:
        client = storage.Client()
        bucket = client.bucket(CREDENTIALS_BUCKET)
        if not bucket.exists():
            try:
                bucket.create(location=CREDENTIALS_BUCKET_LOCATION)
                logger.info("Created credential bucket %s in %s", CREDENTIALS_BUCKET, CREDENTIALS_BUCKET_LOCATION)
            except gcs_exceptions.Conflict:
                logger.info("Credential bucket %s already exists (created concurrently).", CREDENTIALS_BUCKET)
            except gcs_exceptions.GoogleAPIError as exc:
                logger.error("Failed to create credentials bucket %s: %s", CREDENTIALS_BUCKET, exc)
                raise HTTPException(status_code=500, detail="Unable to create credential bucket.")
        _gcs_bucket = bucket
    except Exception as exc:
        logger.error("Failed to initialize credentials bucket %s: %s", CREDENTIALS_BUCKET, exc)
        raise HTTPException(status_code=500, detail="Credential bucket is not accessible.")
    return _gcs_bucket


def _load_store(type_name: str) -> Dict[str, Any]:
    # Prefer GCS if configured; fall back to local disk for local dev.
    if CREDENTIALS_BUCKET:
        bucket = _get_gcs_bucket()
        blob = bucket.blob(_store_blob_name(type_name))
        try:
            if not blob.exists():
                return _empty_store()
            raw_text = blob.download_as_text(encoding="utf-8")
            return _normalize_store_payload(json.loads(raw_text), type_name)
        except gcs_exceptions.GoogleAPIError as exc:
            logger.error("Failed to read %s credential store from GCS: %s", type_name, exc)
            raise HTTPException(status_code=500, detail="Unable to load credentials from bucket.")
        except Exception as exc:
            logger.warning("Unexpected error reading %s store from GCS, falling back to empty: %s", type_name, exc)
            return _empty_store()

    path = _store_file_path(type_name)
    if not path.exists():
        return _empty_store()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return _normalize_store_payload(raw, type_name)
    except Exception:
        return _empty_store()


def _write_store(type_name: str, store: Dict[str, Any]) -> Dict[str, Any]:
    serialized = json.dumps(store, indent=2)
    if CREDENTIALS_BUCKET:
        bucket = _get_gcs_bucket()
        blob = bucket.blob(_store_blob_name(type_name))
        try:
            blob.upload_from_string(serialized, content_type="application/json")
            return store
        except gcs_exceptions.GoogleAPIError as exc:
            logger.error("Failed to persist %s credential store to GCS: %s", type_name, exc)
            raise HTTPException(status_code=500, detail="Unable to persist credentials to bucket.")
        except Exception as exc:
            logger.error("Unexpected error writing %s store to GCS: %s", type_name, exc)
            raise HTTPException(status_code=500, detail="Unable to persist credentials to bucket.")

    path = _store_file_path(type_name)
    path.write_text(serialized, encoding="utf-8")
    return store


@app.get("/api/credential-store/{type_name}")
async def credential_store_get(type_name: str) -> JSONResponse:
    t = _normalize_type(type_name)
    return JSONResponse(_load_store(t))


@app.post("/api/credential-store/{type_name}/entries")
async def credential_store_add(type_name: str, request: Request) -> JSONResponse:
    t = _normalize_type(type_name)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    credential = body.get("credential")
    label = body.get("label")
    if not isinstance(credential, dict):
        raise HTTPException(status_code=400, detail="credential must be an object")
    entry_id = body.get("id")
    if not entry_id or not isinstance(entry_id, str):
        entry_id = uuid4().hex

    store = _load_store(t)
    created_at = body.get("createdAt") or _now_iso()
    store["entries"][entry_id] = {
        "credential": credential,
        "label": label or entry_id,
        "createdAt": created_at,
        "status": "unverified",
        "projectId": credential.get("project_id"),
    }
    # Do not auto-activate new credentials; they must be verified + primed first.
    store["selectedId"] = store.get("selectedId") if store.get("selectedId") in store["entries"] else None
    _write_store(t, store)
    return JSONResponse({"id": entry_id, **store["entries"][entry_id], "selectedId": store["selectedId"]}, status_code=201)


@app.put("/api/credential-store/{type_name}/selection")
async def credential_store_select(type_name: str, request: Request) -> JSONResponse:
    t = _normalize_type(type_name)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    selected_id = body.get("selectedId")
    store = _load_store(t)
    if selected_id is not None and selected_id not in store["entries"]:
        raise HTTPException(status_code=404, detail="Credential not found")
    if selected_id:
        entry = store["entries"].get(selected_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Credential not found")
        if not _entry_activation_allowed(t, entry):
            if t == "source":
                raise HTTPException(status_code=400, detail="Source credential must be verified or primed before activation.")
            raise HTTPException(status_code=400, detail="Target credential must be primed before activation.")
    store["selectedId"] = selected_id
    _write_store(t, store)
    return JSONResponse({}, status_code=204)


@app.delete("/api/credential-store/{type_name}/entries/{entry_id}")
async def credential_store_delete(type_name: str, entry_id: str) -> JSONResponse:
    t = _normalize_type(type_name)
    store = _load_store(t)
    if entry_id not in store["entries"]:
        raise HTTPException(status_code=404, detail="Credential not found")
    del store["entries"][entry_id]
    if store.get("selectedId") == entry_id:
        store["selectedId"] = None
    _write_store(t, store)
    return JSONResponse(store)


async def _prime_status_for_credential(
    credential: Dict[str, Any],
    project_id: Optional[str],
    region: Optional[str],
    request: Request,
) -> Dict[str, Any]:
    if not TRIGGERSERVICE_BASE_URL:
        raise HTTPException(status_code=500, detail="TriggerService is not configured.")
    try:
        credential_b64 = base64.b64encode(json.dumps(credential).encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to encode credential: {exc}")

    params: Dict[str, Any] = {"credential": credential_b64}
    if project_id:
        params["project_id"] = project_id
    if region:
        params["region"] = region

    url = f"{TRIGGERSERVICE_BASE_URL.rstrip('/')}/prime-status"
    headers = _with_forward_headers(request)
    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        resp = await client.get(url, params=params, headers=headers)
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if resp.is_error or payload is None:
        raise HTTPException(status_code=resp.status_code, detail=payload or resp.text)
    return payload


@app.post("/api/credential-store/{type_name}/entries/{entry_id}/verify")
async def credential_store_verify(type_name: str, entry_id: str, request: Request) -> JSONResponse:
    t = _normalize_type(type_name)
    store = _load_store(t)
    entry = store["entries"].get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Credential not found")
    credential = entry.get("credential")
    if not isinstance(credential, dict):
        raise HTTPException(status_code=400, detail="Stored credential is invalid.")
    try:
        body = await request.json()
    except Exception:
        body = {}

    project_id = body.get("project_id") or body.get("projectId") or entry.get("projectId") or credential.get("project_id")
    region = body.get("region") or "us-central1"

    status_payload = await _prime_status_for_credential(credential, project_id, region, request)

    entry["status"] = "primed" if entry.get("status") == "primed" else "verified"
    entry["verifiedAt"] = _now_iso()
    entry["projectId"] = project_id
    entry["lastCheck"] = {
        "status": status_payload.get("status"),
        "missing_bucket_count": status_payload.get("missing_bucket_count"),
        "missing_service_account_count": status_payload.get("missing_service_account_count"),
    }
    store["entries"][entry_id] = entry
    _write_store(t, store)
    return JSONResponse({"entry": entry, "prime_status": status_payload})


@app.post("/api/credential-store/{type_name}/entries/{entry_id}/mark-primed")
async def credential_store_mark_primed(type_name: str, entry_id: str, request: Request) -> JSONResponse:
    t = _normalize_type(type_name)
    store = _load_store(t)
    entry = store["entries"].get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Credential not found")
    if entry.get("status") not in {"verified", "primed"}:
        raise HTTPException(status_code=400, detail="Verify the credential before marking it primed.")
    try:
        body = await request.json()
    except Exception:
        body = {}

    entry["status"] = "primed"
    entry["primedAt"] = _now_iso()
    if body.get("prime_result"):
        entry["lastPrimeResult"] = body.get("prime_result")
    store["entries"][entry_id] = entry
    _write_store(t, store)
    return JSONResponse({"entry": entry})


# --- Deploy configuration store (simple JSON persisted on disk) ---
CONFIG_STORE_FILE = DATA_DIR / "deploy-configs.json"


def _load_deploy_configs() -> Dict[str, Any]:
    if not CONFIG_STORE_FILE.exists():
        return {"configs": {}}
    try:
        raw = json.loads(CONFIG_STORE_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {"configs": {}}
        if "configs" not in raw or not isinstance(raw["configs"], dict):
            raw["configs"] = {}
        return raw
    except Exception:
        return {"configs": {}}


def _write_deploy_configs(store: Dict[str, Any]) -> Dict[str, Any]:
    CONFIG_STORE_FILE.write_text(json.dumps(store, indent=2), encoding="utf-8")
    return store


def _maybe_parse_b64_json(value: Optional[str]) -> Optional[Any]:
    if not value or not isinstance(value, str):
        return None
    try:
        decoded = base64.b64decode(value)
        return json.loads(decoded)
    except Exception:
        return None


def _build_userrequirements(candidate: Any) -> Optional[Dict[str, Any]]:
    if candidate is None:
        return None
    if isinstance(candidate, dict):
        agents = candidate.get("agents")
        repos = candidate.get("repositories")
        if isinstance(agents, list) or isinstance(repos, list):
            return {
                "agents": agents or repos or [],
                "repositories": repos or agents or [],
            }
        if any(key in candidate for key in ("name", "instance_id", "service", "service_name")):
            return {
                "agents": [candidate],
                "repositories": [candidate],
            }
    if isinstance(candidate, list):
        return {
            "agents": candidate,
            "repositories": candidate,
        }
    return None


def _extract_userrequirements_from_job(job_record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Attempt to recover the userrequirements payload from a job record.
    Job submissions typically stash config snapshots under metadata.config or metadata.config_b64.
    """
    if not isinstance(job_record, dict):
        return None

    metadata = job_record.get("metadata") if isinstance(job_record.get("metadata"), dict) else {}

    candidates = [
        job_record.get("userrequirements"),
        metadata.get("userrequirements") if isinstance(metadata, dict) else None,
        metadata.get("config") if isinstance(metadata, dict) else None,
        job_record.get("config"),
        job_record.get("job_config"),
    ]

    for b64_field in ("config_b64",):
        if isinstance(metadata, dict) and metadata.get(b64_field):
            parsed = _maybe_parse_b64_json(metadata.get(b64_field))
            if parsed:
                candidates.append(parsed)
        if job_record.get(b64_field):
            parsed = _maybe_parse_b64_json(job_record.get(b64_field))
            if parsed:
                candidates.append(parsed)

    for candidate in candidates:
        userreq = _build_userrequirements(candidate)
        if userreq:
            return userreq

    return None


def _derive_waves_from_userrequirements(userreq: Dict[str, Any]) -> Dict[str, Any]:
    waves: Dict[str, Any] = {}
    agents = []
    if isinstance(userreq, dict):
        if isinstance(userreq.get("agents"), list):
            agents.extend(userreq.get("agents") or [])
        elif isinstance(userreq.get("repositories"), list):
            agents.extend(userreq.get("repositories") or [])
    for agent in agents:
        wave_value = 0
        if isinstance(agent, dict):
            wave_value = agent.get("wave")
            if wave_value is None and isinstance(agent.get("environment"), dict):
                env = agent.get("environment")
                wave_value = env.get("wave") or env.get("deployment_wave")
        try:
            wave_idx = int(wave_value) if wave_value is not None else 0
        except (TypeError, ValueError):
            wave_idx = 0
        waves.setdefault(str(wave_idx), []).append(agent)
    if not waves and agents:
        waves["0"] = agents
    return waves or {"0": []}


@app.get("/api/deploy-configs")
async def deploy_configs_list() -> JSONResponse:
    store = _load_deploy_configs()
    configs = [
        {"id": cid, **cfg}
        for cid, cfg in store.get("configs", {}).items()
    ]
    return JSONResponse({"configs": configs})


@app.post("/api/deploy-configs")
async def deploy_configs_create(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    cfg_id = uuid4().hex
    store = _load_deploy_configs()
    store["configs"][cfg_id] = {
        "name": name,
        "description": body.get("description") or "",
        "waves": body.get("waves") or {},
        "metadata": body.get("metadata") or {},
        "userrequirements": body.get("userrequirements") or {},
    }
    _write_deploy_configs(store)
    return JSONResponse({"id": cfg_id, **store["configs"][cfg_id]}, status_code=201)


@app.put("/api/deploy-configs/{cfg_id}")
async def deploy_configs_update(cfg_id: str, request: Request) -> JSONResponse:
    store = _load_deploy_configs()
    if cfg_id not in store.get("configs", {}):
        raise HTTPException(status_code=404, detail="Config not found")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    existing = store["configs"][cfg_id]
    existing.update({
        "name": body.get("name", existing.get("name")),
        "description": body.get("description", existing.get("description")),
        "waves": body.get("waves", existing.get("waves")),
        "metadata": body.get("metadata", existing.get("metadata")),
        "userrequirements": body.get("userrequirements", existing.get("userrequirements")),
    })
    store["configs"][cfg_id] = existing
    _write_deploy_configs(store)
    return JSONResponse({"id": cfg_id, **existing})


@app.delete("/api/deploy-configs/{cfg_id}")
async def deploy_configs_delete(cfg_id: str) -> JSONResponse:
    store = _load_deploy_configs()
    if cfg_id not in store.get("configs", {}):
        raise HTTPException(status_code=404, detail="Config not found")
    del store["configs"][cfg_id]
    _write_deploy_configs(store)
    return JSONResponse({"deleted": cfg_id})


async def _fetch_trigger_job(job_identifier: str, request: Request) -> Dict[str, Any]:
    if not TRIGGERSERVICE_BASE_URL:
        raise HTTPException(status_code=500, detail="TriggerService is not configured.")
    url = f"{TRIGGERSERVICE_BASE_URL.rstrip('/')}/jobs/{job_identifier}"
    headers = _with_forward_headers(request)
    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        resp = await client.get(url, headers=headers)
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if resp.is_error or payload is None:
        raise HTTPException(status_code=resp.status_code, detail=payload or resp.text)
    return payload


@app.post("/api/deploy-configs/from-job")
async def deploy_configs_from_job(request: Request) -> JSONResponse:
    """
    Save a deploy configuration sourced from an existing job record (uses the job's stored userrequirements/config snapshot).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    job_id = body.get("job_id") or body.get("job_identifier")
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    job_record = await _fetch_trigger_job(job_id, request)
    userreq = _extract_userrequirements_from_job(job_record)
    if not userreq:
        raise HTTPException(status_code=404, detail="Job does not contain a reusable userrequirements/config snapshot.")

    waves = _derive_waves_from_userrequirements(userreq)
    store = _load_deploy_configs()
    cfg_id = uuid4().hex
    now_iso = datetime.now(timezone.utc).isoformat()
    name = body.get("name") or f"From job {job_id}"
    description = body.get("description") or f"Imported from job {job_id}"
    metadata = body.get("metadata") or {}
    metadata.update({
        "source": metadata.get("source") or "job",
        "job_identifier": job_id,
        "tenant_id": job_record.get("tenant_id") or job_record.get("client_project"),
        "service_name": job_record.get("service_name") or job_record.get("instance_id"),
        "imported_at": now_iso,
    })

    store["configs"][cfg_id] = {
        "name": name,
        "description": description,
        "waves": waves,
        "metadata": metadata,
        "userrequirements": userreq,
    }
    _write_deploy_configs(store)
    return JSONResponse({"id": cfg_id, **store["configs"][cfg_id]}, status_code=201)


# --- Logs fetch (server-side token) ---


def _to_env_map(env_list: Optional[Any]) -> Dict[str, Any]:
    env_map: Dict[str, Any] = {}
    if isinstance(env_list, list):
        for item in env_list:
            if isinstance(item, dict) and item.get("name") and "value" in item:
                env_map[item["name"]] = item.get("value")
    elif isinstance(env_list, dict):
        return env_list
    return env_map


def _infer_wave_from_labels(labels: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(labels, dict):
        return None
    for key in ("wave", "deployment_wave", "tier"):
        if key in labels:
            try:
                return int(labels[key])
            except Exception:
                continue
    return None


@app.post("/api/run/service-config")
async def run_service_config(request: Request) -> JSONResponse:
    """
    Fetch a Cloud Run service definition using a provided service account and build a minimal userrequirements payload.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    service_account = body.get("service_account")
    service_name = body.get("service_name") or body.get("service")
    project_id = body.get("project_id") or (service_account or {}).get("project_id")
    region = body.get("region") or "us-central1"

    if not isinstance(service_account, dict):
        raise HTTPException(status_code=400, detail="service_account must be supplied as a JSON object.")
    if not service_name or not project_id:
        raise HTTPException(status_code=400, detail="service_name and project_id are required.")

    token = await _get_access_token(service_account, ["https://www.googleapis.com/auth/cloud-platform"])
    run_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services/{service_name}"

    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        resp = await client.get(
            run_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
    if resp.is_error:
        detail = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)

    service_payload = resp.json()
    template = service_payload.get("template") or {}
    containers = template.get("containers") or []
    first_container = containers[0] if containers else {}
    env_map = _to_env_map(first_container.get("env"))
    labels = service_payload.get("labels") or template.get("labels") or {}
    wave = _infer_wave_from_labels(labels) or 0

    agent_entry = {
        "name": service_name,
        "instance_id": service_name,
        "service": service_name,
        "service_name": service_name,
        "wave": wave,
        "environment": {
            "service_name": service_name,
            "region": region,
            "image": first_container.get("image"),
            "env": env_map,
            "labels": labels,
        },
    }

    userrequirements = {
        "agents": [agent_entry],
        "repositories": [agent_entry],
    }

    return JSONResponse(
        {
            "service": service_payload,
            "userrequirements": userrequirements,
        }
    )


@app.post("/api/run/services")
async def run_list_services(request: Request) -> JSONResponse:
    """
    List Cloud Run services using a provided service account (for dropdowns/autocomplete).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    service_account = body.get("service_account")
    project_id = body.get("project_id") or (service_account or {}).get("project_id")
    region = body.get("region") or "us-central1"
    if not isinstance(service_account, dict):
        raise HTTPException(status_code=400, detail="service_account must be supplied as a JSON object.")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required.")

    token = await _get_access_token(service_account, ["https://www.googleapis.com/auth/cloud-platform"])
    base_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services"
    services: list[dict[str, Any]] = []
    page_token = None
    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        while True:
            params = {"pageSize": 200}
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                base_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                params=params,
            )
            if resp.is_error:
                detail = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
                raise HTTPException(status_code=resp.status_code, detail=detail)
            payload = resp.json()
            page_services = payload.get("services") or []
            if page_services:
                services.extend(page_services)
            page_token = payload.get("nextPageToken")
            if not page_token:
                break

    simplified = []
    for svc in services:
        name = svc.get("name", "")
        short_name = name.rsplit("/", 1)[-1] if name else svc.get("serviceName")
        simplified.append(
            {
                "name": short_name,
                "full_name": name,
                "url": svc.get("uri") or svc.get("url"),
                "labels": svc.get("labels") or {},
            }
        )

    return JSONResponse({"services": simplified})


DEFAULT_SAMPLE_PATHS = [
    Path(os.getenv("SAMPLE_USERREQUIREMENTS_PATH", "")),
    BASE_DIR / "sample_userrequirements.json",
    BASE_DIR.parent / "thunderdeploy" / "config" / "thunderdeployone_userrequirements_final.json",
]


@app.get("/api/deploy/sample-userrequirements")
async def deploy_sample_userrequirements(request: Request) -> JSONResponse:
    """
    Load a known-good userrequirements file from disk (defaulting to thunderdeploy/config/thunderdeployone_userrequirements_final.json).
    """
    override_path = request.query_params.get("path")
    candidate_paths = []
    if override_path:
        override = Path(override_path).expanduser()
        candidate_paths.append(override if override.is_absolute() else (BASE_DIR / override).resolve())
    candidate_paths.extend([p for p in DEFAULT_SAMPLE_PATHS if p])

    for path in candidate_paths:
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                return JSONResponse({"userrequirements": payload, "path": str(path)})
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to read sample userrequirements: {exc}")

    raise HTTPException(status_code=404, detail=f"Sample userrequirements not found. Tried: {[str(p) for p in candidate_paths]}")


@app.get("/api/tenant-stack/template")
async def tenant_stack_template() -> JSONResponse:
    """
    Return the sanitized default tenant stack template (10-agent wiring).
    """
    try:
        template = get_tenant_stack_template()
    except Exception as exc:
        logger.exception("Failed to load tenant stack template: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to load tenant stack template: {exc}")
    return JSONResponse(template)


@app.get("/api/tenant-stack/templates")
async def tenant_stack_templates() -> JSONResponse:
    """
    List available tenant stack templates (summary only).
    """
    try:
        templates = list_tenant_stack_templates(summary_only=True)
    except Exception as exc:
        logger.exception("Failed to list tenant stack templates: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to list tenant stack templates: {exc}")
    return JSONResponse({"templates": templates})


@app.get("/api/agent-catalog")
async def agent_catalog(request: Request) -> JSONResponse:
    """
    Fetch the official agent catalog (proxied to avoid CORS issues).
    """
    if not AGENT_REGISTRY_BASE_URL:
        raise HTTPException(status_code=500, detail="Agent registry URL not configured.")
    url = f"{AGENT_REGISTRY_BASE_URL}/api/agents"
    headers = _with_forward_headers(request)
    try:
        async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.is_error:
        detail = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return JSONResponse(resp.json())


@app.get("/create_service_account.sh")
async def serve_onboarding_script() -> FileResponse:
    """
    Serve the customer onboarding/permissions script bundled with the UI.
    Looks for the built asset in the frontend dist; falls back to the source public folder.
    """
    candidates = [
        FRONTEND_DIST / "create_service_account.sh",
        BASE_DIR / "frontend" / "public" / "create_service_account.sh",
        BASE_DIR.parent / "thunderdeploy" / "scripts" / "bootstrap" / "create_service_account.sh",
    ]
    for path in candidates:
        if path.exists():
            return FileResponse(path, media_type="text/x-sh")
    raise HTTPException(status_code=404, detail="create_service_account.sh not found")


def _build_jwt_assertion(service_account_info: Dict[str, Any], scopes: list[str]) -> str:
    audience = "https://oauth2.googleapis.com/token"
    now = int(time.time())
    payload = {
        "iss": service_account_info["client_email"],
        "scope": " ".join(scopes),
        "aud": audience,
        "iat": now,
        "exp": now + 3600,
    }
    headers = {"alg": "RS256", "typ": "JWT", "kid": service_account_info.get("private_key_id")}
    private_key = service_account_info["private_key"]
    return jwt.encode(payload, private_key, algorithm="RS256", headers=headers)


async def _get_access_token(service_account_info: Dict[str, Any], scopes: list[str]) -> str:
    assertion = _build_jwt_assertion(service_account_info, scopes)
    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.is_error:
        detail = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)
    data = resp.json()
    return data.get("access_token")


@app.post("/api/logs/fetch")
async def logs_fetch(request: Request) -> JSONResponse:
    """
    Fetch Cloud Run logs for a service using the provided service account JSON.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    service_account = body.get("service_account")
    project_id = body.get("project_id")
    service_name = body.get("service_name")
    region = body.get("region") or "us-central1"
    limit = int(body.get("limit") or 200)

    if not isinstance(service_account, dict) or not project_id or not service_name:
        raise HTTPException(status_code=400, detail="service_account, project_id, and service_name are required.")

    token = await _get_access_token(service_account, ["https://www.googleapis.com/auth/cloud-platform"])
    filter_str = (
        f'resource.type="cloud_run_revision" '
        f'resource.labels.service_name="{service_name}" '
        f'resource.labels.location="{region}"'
    )
    payload = {
        "resourceNames": [f"projects/{project_id}"],
        "filter": filter_str,
        "pageSize": limit,
        "orderBy": "timestamp desc",
    }
    async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
        resp = await client.post(
            f"https://logging.googleapis.com/v2/projects/{project_id}/entries:list",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if resp.is_error:
        detail = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return JSONResponse(resp.json())


@app.get("/healthz")
async def healthz() -> Dict[str, Any]:
    return {
        "status": "ok",
        "main_api_configured": bool(MAIN_API_URL),
        "mcp_registry_configured": bool(MCP_REGISTRY_BASE_URL),
        "thunderdeploy_configured": bool(THUNDERDEPLOY_BASE_URL),
        "web_research_configured": bool(WEB_RESEARCH_BASE_URL),
        "cheatsheet_configured": bool(CHEATSHEET_BASE_URL),
    }


# --- Example proxy endpoints (minimal skeleton) ---


@app.post("/api/login")
async def login(request: Request) -> JSONResponse:
    """
    Thin wrapper around the core login endpoint.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=MAIN_API_URL,
        endpoint="/login",
        json_body=body,
    )


@app.get("/api/user_info")
async def user_info(request: Request) -> JSONResponse:
    """
    Fetch user info from the core service.
    """
    return await _proxy_request(
        request,
        method="GET",
        base_url=MAIN_API_URL,
        endpoint="/userinfo",
    )


@app.get("/api/mcp/registry")
async def mcp_registry_list(request: Request) -> JSONResponse:
    """
    Admin-only: list MCP registry entries from the MCP Registry service.
    """
    return await _proxy_request(
        request,
        method="GET",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/registry",
    )


@app.post("/api/web-research/invoke")
async def web_research_invoke(request: Request) -> JSONResponse:
    """
    Invoke the web research agent.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=WEB_RESEARCH_BASE_URL,
        endpoint="/invoke",
        json_body=body,
    )


@app.get("/api/cheat-sheet")
async def cheat_sheet_list(request: Request) -> JSONResponse:
    """
    List cheat-sheet entries via the MCP client agent.
    """
    return await _proxy_request(
        request,
        method="GET",
        base_url=CHEATSHEET_BASE_URL,
        endpoint="/cheat-sheet/get-all",
    )


@app.post("/api/cheat-sheet")
async def cheat_sheet_add(request: Request) -> JSONResponse:
    """
    Add a cheat-sheet entry via the MCP client agent.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=CHEATSHEET_BASE_URL,
        endpoint="/add_to_cheat_sheet",
        json_body=body,
    )


@app.put("/api/cheat-sheet/{entry_id}")
async def cheat_sheet_update(entry_id: str, request: Request) -> JSONResponse:
    """
    Update a cheat-sheet entry.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="PUT",
        base_url=CHEATSHEET_BASE_URL,
        endpoint=f"/cheat-sheet/update/{entry_id}",
        json_body=body,
    )


@app.delete("/api/cheat-sheet/{entry_id}")
async def cheat_sheet_delete(entry_id: str, request: Request) -> JSONResponse:
    """
    Delete a cheat-sheet entry.
    """
    return await _proxy_request(
        request,
        method="DELETE",
        base_url=CHEATSHEET_BASE_URL,
        endpoint=f"/cheat-sheet/{entry_id}",
    )


# --- TriggerService proxies (deployment orchestration) ---


@app.post("/api/trigger/prime")
async def trigger_prime_customer(request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /prime-customer.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_trigger_request(
        request,
        method="POST",
        endpoint="/prime-customer",
        json_body=body,
    )


@app.get("/api/trigger/prime-status")
async def trigger_prime_status(request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /prime-status with passthrough query params.
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint="/prime-status",
        params=dict(request.query_params),
    )


@app.get("/api/trigger/jobs")
async def trigger_jobs(request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /jobs (job history/status).
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint="/jobs",
        params=dict(request.query_params),
    )


@app.get("/api/trigger/jobs/{job_identifier}")
async def trigger_job_detail(job_identifier: str, request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /jobs/<job_identifier> for job detail.
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint=f"/jobs/{job_identifier}",
        params=dict(request.query_params),
    )


@app.get("/api/trigger/tenants")
async def trigger_tenants(request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /tenants (multi-tenant awareness).
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint="/tenants",
    )


@app.get("/api/trigger/services/{tenant_id}")
async def trigger_services(tenant_id: str, request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /<tenant_id>/services for health/metadata.
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint=f"/{tenant_id}/services",
        params=dict(request.query_params),
    )


@app.get("/api/trigger/services/{tenant_id}/{service_name}/revisions")
async def trigger_service_revisions(tenant_id: str, service_name: str, request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /<tenant_id>/services/<service_name>/revisions
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint=f"/{tenant_id}/services/{service_name}/revisions",
        params=dict(request.query_params),
    )


@app.post("/api/trigger/services/{tenant_id}/{service_name}/revisions/activate")
async def trigger_service_revision_activate(
    tenant_id: str,
    service_name: str,
    request: Request,
) -> JSONResponse:
    """
    Proxy to TriggerService revision activation.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_trigger_request(
        request,
        method="POST",
        endpoint=f"/{tenant_id}/services/{service_name}/revisions/activate",
        json_body=body,
    )


@app.post("/api/trigger/deploy")
async def trigger_deploy(request: Request) -> JSONResponse:
    """
    Proxy to TriggerService /trigger. Accepts a JSON body:
    {
      "userrequirements": {...},     # required
      "serviceaccount": {...},       # required
      "customer_serviceaccount": {...} # required
    }
    Converts to multipart for TriggerService.
    """
    try:
        body = await request.json()
    except Exception:
        logger.error("Invalid JSON payload in trigger_deploy")
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    required = ("userrequirements", "serviceaccount", "customer_serviceaccount")
    missing = [key for key in required if key not in body]
    if missing:
        logger.error(f"Missing fields in trigger_deploy: {missing}. Keys found: {list(body.keys())}")
        raise HTTPException(status_code=400, detail=f"Missing fields: {', '.join(missing)}")

    files = {
        "userrequirements.json": ("userrequirements.json", json.dumps(body["userrequirements"]), "application/json"),
        "serviceaccount.json": ("serviceaccount.json", json.dumps(body["serviceaccount"]), "application/json"),
        "customer_serviceaccount.json": (
            "customer_serviceaccount.json",
            json.dumps(body["customer_serviceaccount"]),
            "application/json",
        ),
    }

    return await _proxy_trigger_request(
        request,
        method="POST",
        endpoint="/trigger",
        files=files,
    )


@app.get("/api/trigger/job_status/{job_project_id}/{job_region}/{job_name}/{execution_name}")
async def trigger_job_status(
    job_project_id: str,
    job_region: str,
    job_name: str,
    execution_name: str,
    request: Request,
) -> JSONResponse:
    """
    Proxy to TriggerService /job_status/<job_project_id>/<job_region>/<job_name>/<execution_name>.
    """
    return await _proxy_trigger_request(
        request,
        method="GET",
        endpoint=f"/job_status/{job_project_id}/{job_region}/{job_name}/{execution_name}",
        params=dict(request.query_params),
    )


@app.get("/api/provider/health")
async def provider_health(request: Request) -> JSONResponse:
    """
    Lightweight provider health check used by the tenant provisioning UI.
    Reports TriggerService reachability and selected credential presence/status.
    """
    triggerservice = {
        "configured": bool(TRIGGERSERVICE_BASE_URL),
        "reachable": False,
        "detail": "",
    }

    if not TRIGGERSERVICE_BASE_URL:
        triggerservice["detail"] = "TriggerService base URL not configured."
    else:
        url = f"{TRIGGERSERVICE_BASE_URL.rstrip('/')}/tenants"
        headers = _with_forward_headers(request)
        try:
            async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
                resp = await client.get(url, headers=headers)
            if resp.is_error:
                try:
                    payload = resp.json()
                    detail = payload.get("detail") if isinstance(payload, dict) else payload
                except Exception:
                    detail = resp.text
                triggerservice["reachable"] = False
                triggerservice["detail"] = detail or f"HTTP {resp.status_code}"
            else:
                triggerservice["reachable"] = True
                triggerservice["detail"] = "ok"
        except Exception as exc:
            logger.warning("Provider health TriggerService probe failed: %s", exc)
            triggerservice["detail"] = str(exc)

    def _credential_health(type_name: str) -> Dict[str, Any]:
        try:
            store = _load_store(type_name)
        except Exception as exc:
            logger.warning("Failed to load %s credential store for health: %s", type_name, exc)
            return {"present": False, "selectedId": None, "status": None, "projectId": None}
        entries = store.get("entries") or {}
        selected_id = store.get("selectedId")
        entry = entries.get(selected_id) if selected_id else None
        return {
            "present": bool(entries),
            "selectedId": selected_id,
            "status": entry.get("status") if entry else None,
            "projectId": entry.get("projectId") if entry else None,
        }

    source_credential = _credential_health("source")
    target_credential = _credential_health("target")

    selected_source = bool(source_credential.get("selectedId"))
    source_status = (source_credential.get("status") or "").lower()
    target_status = (target_credential.get("status") or "").lower()

    source_ready = source_status in {"primed", "verified"}
    target_selected = bool(target_credential.get("selectedId"))
    target_ready = target_status == "primed"

    overall_status = "ok"
    if (not triggerservice["configured"]) or (not triggerservice["reachable"]) or (not selected_source):
        overall_status = "error"
    elif (not source_ready) or (not target_selected) or (not target_ready):
        overall_status = "warning"

    payload = {
        "triggerservice": triggerservice,
        "source_credential": source_credential,
        "target_credential": target_credential,
        "overall_status": overall_status,
    }
    return JSONResponse(payload)


@app.get("/api/health/summary")
async def health_summary(request: Request) -> JSONResponse:
    """
    Lightweight aggregator for the health dashboard.
    Uses TriggerService services listing when available.
    """
    if not TRIGGERSERVICE_BASE_URL:
        return JSONResponse({"detail": "TriggerService is not configured."}, status_code=500)
    tenant_id = request.query_params.get("tenant_id")
    if not tenant_id:
        return JSONResponse({"detail": "tenant_id is required"}, status_code=400)

    try:
        async with httpx.AsyncClient(timeout=HTTPX_TIMEOUT) as client:
            resp = await client.get(f"{TRIGGERSERVICE_BASE_URL.rstrip('/')}/{tenant_id}/services")
        data = resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch service health: %s", exc)
        data = {"services": []}

    return JSONResponse({"tenant_id": tenant_id, "services": data.get("services", [])})


# --- MCP Registry proxies ---


@app.get("/api/mcp/config")
async def mcp_config(request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/config",
    )


@app.post("/api/mcp/auth/verify")
async def mcp_auth_verify(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/auth/verify",
        json_body=body,
    )


@app.get("/api/mcp/registry")
async def mcp_registry_list(request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/registry",
    )


@app.post("/api/mcp/registry")
async def mcp_registry_create(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/registry",
        json_body=body,
    )


@app.put("/api/mcp/registry/{mcp_id}")
async def mcp_registry_update(mcp_id: int, request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="PUT",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint=f"/registry/{mcp_id}",
        json_body=body,
    )


@app.delete("/api/mcp/registry/{mcp_id}")
async def mcp_registry_delete(mcp_id: int, request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="DELETE",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint=f"/registry/{mcp_id}",
    )


@app.get("/api/mcp/database-mcp-urls")
async def mcp_database_urls(request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/database-mcp-urls",
    )


@app.post("/api/mcp/database-mcp-urls")
async def mcp_database_urls_create(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/database-mcp-urls",
        json_body=body,
    )


@app.put("/api/mcp/database-mcp-urls/{user_id}/{mcp_id}")
async def mcp_database_urls_update(user_id: int, mcp_id: int, request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="PUT",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint=f"/database-mcp-urls/{user_id}/{mcp_id}",
        json_body=body,
    )


@app.delete("/api/mcp/database-mcp-urls/{user_id}/{mcp_id}")
async def mcp_database_urls_delete(user_id: int, mcp_id: int, request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="DELETE",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint=f"/database-mcp-urls/{user_id}/{mcp_id}",
    )


@app.get("/api/mcp/users")
async def mcp_users(request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=MCP_REGISTRY_BASE_URL,
        endpoint="/users",
    )


# --- Agent One Configurator proxies ---


@app.get("/api/agentone/configs")
async def agentone_configs(request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint="/configs",
    )


@app.get("/api/agentone/config/{api_key}")
async def agentone_config_get(api_key: str, request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="GET",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint=f"/config/{api_key}",
    )


@app.post("/api/agentone/config")
async def agentone_config_create(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint="/config",
        json_body=body,
    )


@app.put("/api/agentone/config/{api_key}")
async def agentone_config_update(api_key: str, request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="PUT",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint=f"/config/{api_key}",
        json_body=body,
    )


@app.delete("/api/agentone/config/{api_key}")
async def agentone_config_delete(api_key: str, request: Request) -> JSONResponse:
    return await _proxy_request(
        request,
        method="DELETE",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint=f"/config/{api_key}",
    )


@app.post("/api/agentone/config/{api_key}/provision-cloud-mcp")
async def agentone_config_provision(api_key: str, request: Request) -> JSONResponse:
    body = None
    try:
        if request.headers.get("content-length"):
            body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    return await _proxy_request(
        request,
        method="POST",
        base_url=AGENTONE_CONFIGURATOR_URL,
        endpoint=f"/config/{api_key}/provision-cloud-mcp",
        json_body=body,
    )


@app.get("/api/github/content")
async def github_content(repo: str, path: str, ref: str = "main") -> JSONResponse:
    """
    Proxy to fetch file content from GitHub.
    repo: "owner/repo"
    path: file path (e.g. ".env")
    ref: branch or commit sha
    """
    if not DEFAULT_GITHUB_TOKEN:
        raise HTTPException(status_code=500, detail="Server misconfigured: No GitHub token available.")

    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Authorization": f"token {DEFAULT_GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
    }
    params = {"ref": ref}

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers, params=params)

    if resp.status_code == 404:
        return JSONResponse({"content": None})
    
    if resp.is_error:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    # GitHub API returns 'content' as base64 encoded string
    content_b64 = data.get("content", "")
    try:
        decoded = base64.b64decode(content_b64).decode("utf-8")
    except Exception:
        decoded = ""
    
    return JSONResponse({"content": decoded})


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def catch_all(full_path: str) -> HTMLResponse:
    """
    Serve the SPA for any non-API/non-static route (e.g., /deploy, /health).
    Keep this as the last route so API endpoints and health checks are not shadowed.
    """
    if full_path.startswith(("api/", "assets/", "create_service_account.sh")):
        raise HTTPException(status_code=404, detail="Not found")
    return _serve_frontend()
