import json
import pytest
import httpx
from unittest.mock import AsyncMock, patch

from ai_router.classifier import classify_request
from ai_router.models import ClassifierConfig


@pytest.fixture
def classifier_config():
    return ClassifierConfig(
        endpoint="http://localhost:11434",
        model="qwen3:4b",
        system_prompt="Classify into: local, medium, heavy. Respond with JSON.",
        metadata=["token_count", "has_code", "conversation_turns", "last_message_length"],
        timeout_ms=5000,
    )


async def test_classify_returns_tier(classifier_config):
    mock_response = httpx.Response(
        200,
        json={"message": {"content": '{"tier": "heavy", "reason": "complex code"}'}},
    )
    with patch("ai_router.classifier.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        tier = await classify_request(
            classifier_config,
            metadata={"token_count": 500, "has_code": True, "conversation_turns": 5, "last_message_length": 200},
            last_message="Refactor this entire module to use async generators",
            tier_names=["local", "medium", "heavy"],
        )
    assert tier == "heavy"


async def test_classify_timeout_returns_none(classifier_config):
    with patch("ai_router.classifier.httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=httpx.TimeoutException("timeout")):
        tier = await classify_request(
            classifier_config,
            metadata={"token_count": 100, "has_code": False, "conversation_turns": 1, "last_message_length": 20},
            last_message="Hi",
            tier_names=["local", "medium", "heavy"],
        )
    assert tier is None


async def test_classify_invalid_json_returns_none(classifier_config):
    mock_response = httpx.Response(
        200,
        json={"message": {"content": "I think this is medium complexity"}},
    )
    with patch("ai_router.classifier.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        tier = await classify_request(
            classifier_config,
            metadata={"token_count": 100, "has_code": False, "conversation_turns": 1, "last_message_length": 20},
            last_message="Hi",
            tier_names=["local", "medium", "heavy"],
        )
    assert tier is None
