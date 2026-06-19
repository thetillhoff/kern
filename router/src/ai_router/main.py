import os
import logging
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ai_router.config import load_config
from ai_router.models import AppConfig
from ai_router.proxy import route_request

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Router")

_config: AppConfig | None = None


def get_config() -> AppConfig:
    global _config
    if _config is None:
        config_path = os.environ.get("AI_ROUTER_CONFIG", "config.yaml")
        _config = load_config(config_path)
    return _config


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def list_models():
    config = get_config()
    models = [{"id": "auto", "object": "model", "owned_by": "ai-router"}]
    for tier in config.tiers:
        models.append({"id": tier.name, "object": "model", "owned_by": "ai-router"})
        for model in tier.models:
            models.append({"id": model.name, "object": "model", "owned_by": tier.name})
    return {"object": "list", "data": models}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    config = get_config()
    body = await request.json()

    tier_name, response = await route_request(config, body)

    if isinstance(response, AsyncIterator):
        return StreamingResponse(
            response,
            media_type="text/event-stream",
            headers={"X-Router-Tier": tier_name},
        )
    else:
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return JSONResponse(
                content=response.json(),
                status_code=response.status_code,
                headers={"X-Router-Tier": tier_name},
            )
        return JSONResponse(
            content={"error": response.text},
            status_code=response.status_code,
            headers={"X-Router-Tier": tier_name},
        )


def cli():
    import uvicorn
    config = get_config()
    uvicorn.run(
        "ai_router.main:app",
        host=config.server.host,
        port=config.server.port,
        reload=True,
    )
