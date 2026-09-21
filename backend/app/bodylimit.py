"""Refuses oversized request bodies before they are read, so a huge upload cannot use up memory."""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

MAX_BODY_BYTES = 4_000_000  # well above the largest honest draft (see drafts_api limits)


class BodySizeLimit:
    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {name: value for name, value in scope["headers"]}
        length = headers.get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
            await self._refuse(413, "That request is too large.", scope, receive, send)
        elif length is None and b"chunked" in headers.get(b"transfer-encoding", b""):
            await self._refuse(411, "The request must state its length.", scope, receive, send)
        else:
            await self.app(scope, receive, send)

    @staticmethod
    async def _refuse(status: int, detail: str, scope: Scope, receive: Receive, send: Send) -> None:
        await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)
