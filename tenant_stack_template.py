import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Set, Tuple

BASE_DIR = Path(__file__).resolve().parent

TEMPLATE_ID = "tenant-stack-default"
TEMPLATE_LABEL = "Default 10-agent Tenant Stack"
TEMPLATE_DESCRIPTION = (
    "Known-good wiring for Thunderdome/Thunderdeploy: core, broker, MCP, scheduling, portal, etc."
)
TEMPLATE_PATH_ENV = "TENANT_STACK_TEMPLATE_PATH"

STRICT_PLACEHOLDERS: Dict[str, str] = {
    "project_id": "{{PROJECT_ID}}",
    "tenant_id": "{{TENANT_ID}}",
    "google_cloud_project": "{{PROJECT_ID}}",
    "region": "{{REGION}}",
    "database_instance": "{{DB_INSTANCE}}",
    "database_name": "{{DB_NAME}}",
    "db_username": "{{DB_USERNAME}}",
    "db_password": "REPLACE_ME_DB_PASSWORD",
    "github_token": "REPLACE_ME_GITHUB_TOKEN",
}

SENSITIVE_KEYWORDS: Tuple[str, ...] = (
    "token",
    "secret",
    "password",
    "api_key",
    "apikey",
    "auth",
    "credential",
    "sa",
    "sid",
    "key",
)
URL_KEYWORDS: Tuple[str, ...] = ("url", "endpoint", "base_url")

_template_cache: Dict[str, Any] | None = None


def _normalize_key(key: str | None) -> str:
    if not key:
        return "VALUE"
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", key).strip("_")
    return cleaned.upper() or "VALUE"


def _resolve_template_path() -> Path:
    override = os.getenv(TEMPLATE_PATH_ENV)
    if override:
        override_path = Path(override).expanduser()
        return override_path if override_path.is_absolute() else (BASE_DIR / override_path).resolve()
    candidates = [
        BASE_DIR / "thunderdeploy" / "config" / "thunderdeployone_userrequirements_final.json",
        BASE_DIR.parent / "thunderdeploy" / "config" / "thunderdeployone_userrequirements_final.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    # Fall back to the first candidate for deterministic error messages.
    return candidates[0]


def _collect_known_coordinates(payload: Any) -> Tuple[Set[str], Set[str], Set[str]]:
    project_ids: Set[str] = set()
    regions: Set[str] = set()
    db_instances: Set[str] = set()

    def walk(node: Any, key: str | None = None) -> None:
        if isinstance(node, dict):
            for child_key, child_value in node.items():
                lower = child_key.lower()
                if lower in ("project_id", "tenant_id", "google_cloud_project") and isinstance(child_value, str):
                    project_ids.add(child_value)
                if lower == "region" and isinstance(child_value, str):
                    regions.add(child_value)
                if lower == "database_instance" and isinstance(child_value, str):
                    db_instances.add(child_value)
                walk(child_value, child_key)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return project_ids, regions, db_instances


def _placeholder_for_key(key: str | None) -> str | None:
    if not key:
        return None
    lower = key.lower()
    if lower in STRICT_PLACEHOLDERS:
        return STRICT_PLACEHOLDERS[lower]
    if any(keyword in lower for keyword in URL_KEYWORDS):
        return f"https://REPLACE_ME_{_normalize_key(key)}"
    if any(keyword in lower for keyword in SENSITIVE_KEYWORDS) or lower.startswith("db"):
        return f"REPLACE_ME_{_normalize_key(key)}"
    return None


def _looks_like_secret_value(value: str) -> bool:
    if value.startswith("-----BEGIN") or value.startswith("ssh-"):
        return True
    if len(value) > 32 and any(c.isdigit() for c in value) and any(c.isalpha() for c in value):
        if not value.lower().startswith("http"):
            return True
    return False


def _replace_known_tokens(value: str, tokens: Iterable[str], placeholder: str) -> str:
    for token in tokens:
        if token:
            value = value.replace(token, placeholder)
    return value


def _sanitize_value(
    value: Any,
    key: str | None,
    *,
    project_ids: Set[str],
    regions: Set[str],
    db_instances: Set[str],
) -> Any:
    if isinstance(value, dict):
        return {
            child_key: _sanitize_value(
                child_value,
                child_key,
                project_ids=project_ids,
                regions=regions,
                db_instances=db_instances,
            )
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [
            _sanitize_value(item, None, project_ids=project_ids, regions=regions, db_instances=db_instances)
            for item in value
        ]
    if not isinstance(value, str):
        return value

    placeholder = _placeholder_for_key(key)
    if placeholder:
        return placeholder

    sanitized = value
    sanitized = _replace_known_tokens(sanitized, project_ids, "{{PROJECT_ID}}")
    sanitized = _replace_known_tokens(sanitized, regions, "{{REGION}}")
    sanitized = _replace_known_tokens(sanitized, db_instances, "{{DB_INSTANCE}}")
    sanitized = re.sub(r"\\b\\d{11,}\\b", "{{PROJECT_NUMBER}}", sanitized)
    if sanitized != value:
        return sanitized

    if _looks_like_secret_value(value):
        return f"REPLACE_ME_{_normalize_key(key)}"

    return value


def sanitize_tenant_stack_template(payload: Dict[str, Any]) -> Dict[str, Any]:
    project_ids, regions, db_instances = _collect_known_coordinates(payload)
    return _sanitize_value(payload, None, project_ids=project_ids, regions=regions, db_instances=db_instances)


def get_tenant_stack_template() -> Dict[str, Any]:
    """
    Load and sanitize the default tenant stack template, returning metadata and sanitized userrequirements.
    """
    global _template_cache
    if _template_cache is not None:
        return _template_cache

    path = _resolve_template_path()
    if not path.exists():
        raise FileNotFoundError(f"Tenant stack template not found at {path}")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to read tenant stack template: {exc}") from exc

    sanitized = sanitize_tenant_stack_template(payload)
    _template_cache = {
        "id": TEMPLATE_ID,
        "label": TEMPLATE_LABEL,
        "description": TEMPLATE_DESCRIPTION,
        "version": 1,
        "userrequirements": sanitized,
    }
    return _template_cache


def list_tenant_stack_templates(summary_only: bool = True) -> list[Dict[str, Any]]:
    template = get_tenant_stack_template()
    if summary_only:
        return [
            {
                "id": template["id"],
                "label": template["label"],
                "description": template["description"],
                "version": template["version"],
            }
        ]
    return [template]
