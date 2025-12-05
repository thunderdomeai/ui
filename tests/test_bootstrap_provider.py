import json
import os
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient

# Ensure the project root and ui directory are on sys.path so imports in ui.main work.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
UI_DIR = os.path.join(PROJECT_ROOT, "ui")
for path in (PROJECT_ROOT, UI_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from ui.main import app


class FakeResponse:
    def __init__(self):
        self._payload = {
            "id": "build-123",
            "status": "QUEUED",
            "logUrl": "https://example.test/log",
        }
        self.status_code = 200
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload

    @property
    def is_error(self):
        return False


class FakeHttpxClient:
    """
    Minimal async context manager that records the Cloud Build request body.
    """

    last_request = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        FakeHttpxClient.last_request = {
            "url": url,
            "headers": headers,
            "json": json,
        }
        return FakeResponse()


@patch("ui.main.httpx.AsyncClient", new=FakeHttpxClient)
@patch("ui.main._get_source_build_token_and_project")
def test_bootstrap_provider_build_body_uses_env_and_not_substitutions(mock_get_token):
    """
    The Cloud Build step for provider bootstrap must pass PROJECT_ID/REGION via env,
    not as PROJECT_ID=$$PROJECT_ID REGION=$$REGION in the command string.
    """
    mock_get_token.return_value = (
        "test-project-123",
        "fake-access-token",
        "builder@test-project-123.iam.gserviceaccount.com",
    )

    client = TestClient(app)

    response = client.post(
        "/api/bootstrap/provider",
        json={
            "region": "europe-west1",
            "branch": "main",
            "repo_url": "https://github.com/thunderdomeai/thunderdeploy.git",
        },
    )

    assert response.status_code == 200
    assert FakeHttpxClient.last_request is not None

    build_body = FakeHttpxClient.last_request["json"]
    steps = build_body["steps"]
    assert len(steps) == 2

    bootstrap_step = steps[1]

    # Ensure PROJECT_ID and REGION are passed via env.
    env_vars = bootstrap_step.get("env") or []
    assert f"PROJECT_ID=test-project-123" in env_vars
    assert f"REGION=europe-west1" in env_vars

    # Ensure the command does not use Cloud Build substitutions for these values.
    args = bootstrap_step.get("args") or []
    cmd = " ".join(args)
    assert "make bootstrap-provider" in cmd
    assert "PROJECT_ID=$$PROJECT_ID" not in cmd
    assert "REGION=$$REGION" not in cmd
