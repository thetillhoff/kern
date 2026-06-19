from typing import AsyncIterator

import httpx

from ai_router.models import ModelConfig


class OllamaBackend:
    def __init__(self, model_config: ModelConfig):
        self.endpoint = model_config.endpoint
        self.model_name = model_config.name

    async def forward(
        self,
        request_body: dict,
        stream: bool,
    ) -> httpx.Response | AsyncIterator[bytes]:
        body = dict(request_body)
        body["model"] = self.model_name

        client = httpx.AsyncClient(timeout=120.0)

        if stream:
            req = client.build_request(
                "POST",
                f"{self.endpoint}/v1/chat/completions",
                json={**body, "stream": True},
            )
            try:
                response = await client.send(req, stream=True)
            except Exception:
                await client.aclose()
                raise
            if response.status_code >= 400:
                await response.aread()
                await client.aclose()
                return response
            return self._stream_with_cleanup(response, client)
        else:
            response = await client.post(
                f"{self.endpoint}/v1/chat/completions",
                json={**body, "stream": False},
            )
            await client.aclose()
            return response

    async def _stream_with_cleanup(
        self, response: httpx.Response, client: httpx.AsyncClient
    ) -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()
