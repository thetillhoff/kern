import pytest
import httpx
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


@pytest.fixture
def test_client(sample_config_path, monkeypatch):
    monkeypatch.setenv("AI_ROUTER_CONFIG", str(sample_config_path))
    # Reset the cached config
    import ai_router.main
    ai_router.main._config = None
    from ai_router.main import app
    return TestClient(app)


def test_health_endpoint(test_client):
    response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_models_endpoint(test_client):
    response = test_client.get("/v1/models")
    assert response.status_code == 200
    data = response.json()
    model_ids = [m["id"] for m in data["data"]]
    assert "auto" in model_ids
    assert "local" in model_ids
    assert "heavy" in model_ids
    assert "qwen3:4b" in model_ids
    assert "claude-opus" in model_ids


def test_chat_completions_non_streaming(test_client):
    mock_response = httpx.Response(
        200,
        json={"choices": [{"message": {"content": "Hi there"}}]},
    )
    with patch("ai_router.main.route_request", new_callable=AsyncMock, return_value=("local", mock_response)):
        response = test_client.post(
            "/v1/chat/completions",
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": False,
            },
        )
    assert response.status_code == 200
    assert response.headers.get("x-router-tier") == "local"
    assert response.json()["choices"][0]["message"]["content"] == "Hi there"
