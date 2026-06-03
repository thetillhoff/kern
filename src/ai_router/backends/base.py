from typing import AsyncIterator, Protocol, runtime_checkable

import httpx


@runtime_checkable
class Backend(Protocol):
    async def forward(
        self,
        request_body: dict,
        stream: bool,
    ) -> httpx.Response | AsyncIterator[bytes]:
        ...
