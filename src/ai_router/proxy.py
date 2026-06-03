import logging
from typing import AsyncIterator

import httpx

from ai_router.backends import get_backend
from ai_router.classifier import classify_request
from ai_router.metadata import extract_metadata
from ai_router.models import AppConfig, ModelConfig

logger = logging.getLogger(__name__)


def _find_model_in_tiers(config: AppConfig, model_name: str) -> tuple[str, ModelConfig] | None:
    for tier in config.tiers:
        if tier.name == model_name:
            return tier.name, tier.models[0]
        for model in tier.models:
            if model.name == model_name:
                return tier.name, model
    return None


async def route_request(
    config: AppConfig,
    request_body: dict,
) -> tuple[str, httpx.Response | AsyncIterator[bytes]]:
    model = request_body.get("model", "auto")
    messages = request_body.get("messages", [])
    stream = request_body.get("stream", False)

    # Passthrough: client specified a known model or tier name
    if model != "auto" and config.routing.passthrough_model:
        found = _find_model_in_tiers(config, model)
        if found:
            tier_name, model_config = found
            backend = get_backend(model_config)
            response = await backend.forward(request_body, stream=stream)
            return tier_name, response

    # Classification path
    metadata = extract_metadata(messages)
    last_message = ""
    for m in reversed(messages):
        if m.get("role") == "user" and m.get("content"):
            last_message = m["content"]
            break

    tier_names = [t.name for t in config.tiers]
    tier_name = await classify_request(
        config.classifier,
        metadata=metadata,
        last_message=last_message,
        tier_names=tier_names,
    )

    if tier_name is None:
        tier_name = config.routing.default_tier
        logger.warning(f"Classifier failed, falling back to default tier: {tier_name}")

    tier = next((t for t in config.tiers if t.name == tier_name), config.tiers[0])
    model_config = tier.models[0]
    backend = get_backend(model_config)
    response = await backend.forward(request_body, stream=stream)
    return tier_name, response
