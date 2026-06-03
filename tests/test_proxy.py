import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock

from ai_router.proxy import route_request
from ai_router.models import AppConfig, ModelConfig, TierConfig


@pytest.fixture
def app_config(sample_config_path):
    from ai_router.config import load_config
    return load_config(sample_config_path)


async def test_route_request_auto_model_calls_classifier(app_config):
    request_body = {
        "model": "auto",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": False,
    }
    mock_response = httpx.Response(200, json={"choices": [{"message": {"content": "Hi"}}]})

    with patch("ai_router.proxy.classify_request", new_callable=AsyncMock, return_value="local") as mock_classify:
        with patch("ai_router.proxy.get_backend") as mock_get_backend:
            mock_backend = AsyncMock()
            mock_backend.forward = AsyncMock(return_value=mock_response)
            mock_get_backend.return_value = mock_backend

            tier, response = await route_request(app_config, request_body)

    assert tier == "local"
    mock_classify.assert_called_once()


async def test_route_request_passthrough_skips_classifier(app_config):
    request_body = {
        "model": "qwen3:4b",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": False,
    }
    mock_response = httpx.Response(200, json={"choices": [{"message": {"content": "Hi"}}]})

    with patch("ai_router.proxy.classify_request", new_callable=AsyncMock) as mock_classify:
        with patch("ai_router.proxy.get_backend") as mock_get_backend:
            mock_backend = AsyncMock()
            mock_backend.forward = AsyncMock(return_value=mock_response)
            mock_get_backend.return_value = mock_backend

            tier, response = await route_request(app_config, request_body)

    mock_classify.assert_not_called()


async def test_route_request_classifier_failure_uses_default(app_config):
    request_body = {
        "model": "auto",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": False,
    }
    mock_response = httpx.Response(200, json={"choices": [{"message": {"content": "Hi"}}]})

    with patch("ai_router.proxy.classify_request", new_callable=AsyncMock, return_value=None):
        with patch("ai_router.proxy.get_backend") as mock_get_backend:
            mock_backend = AsyncMock()
            mock_backend.forward = AsyncMock(return_value=mock_response)
            mock_get_backend.return_value = mock_backend

            tier, response = await route_request(app_config, request_body)

    assert tier == app_config.routing.default_tier
