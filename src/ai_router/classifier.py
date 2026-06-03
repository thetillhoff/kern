import json
import logging

import httpx

from ai_router.models import ClassifierConfig

logger = logging.getLogger(__name__)


async def classify_request(
    config: ClassifierConfig,
    metadata: dict,
    last_message: str,
    tier_names: list[str],
) -> str | None:
    prompt = f"Metadata: {json.dumps(metadata)}\n\nUser message: {last_message}\n\nClassify into one of: {', '.join(tier_names)}"

    try:
        async with httpx.AsyncClient(timeout=config.timeout_ms / 1000) as client:
            response = await client.post(
                f"{config.endpoint}/api/chat",
                json={
                    "model": config.model,
                    "messages": [
                        {"role": "system", "content": config.system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                    "format": "json",
                },
            )
        if response.status_code >= 400:
            logger.warning(f"Classifier HTTP error: {response.status_code}")
            return None
    except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.ConnectError) as e:
        logger.warning(f"Classifier failed: {e}")
        return None

    try:
        content = response.json()["message"]["content"]
        parsed = json.loads(content)
        tier = parsed.get("tier")
        if tier in tier_names:
            return tier
        logger.warning(f"Classifier returned unknown tier: {tier}")
        return None
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(f"Classifier response parse error: {e}")
        return None
