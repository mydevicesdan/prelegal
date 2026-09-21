import re
from pathlib import PurePosixPath

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# Next.js prefetches a page's data as e.g. /signup/__next.signup.__PAGE__.txt, but a static export stores the
# file nested: /signup/__next.signup/__PAGE__.txt. (Its own server does this mapping; a plain file server does not.)
_PAYLOAD = re.compile(r"^__next\.([^/]+)\.txt$")


def nested_payload_path(path: str) -> str | None:
    """The on-disk location of a dotted Next.js payload request, or None if the path is not one."""
    location = PurePosixPath(path.replace(chr(92), "/"))  # Starlette passes OS-style paths (backslashes on Windows)
    match = _PAYLOAD.match(location.name)
    if not match:
        return None
    first, *rest = match.group(1).split(".")
    if not rest:
        return None
    return str(location.parent / f"__next.{first}" / "/".join(rest[:-1] + [rest[-1] + ".txt"]))


class FrontendFiles(StaticFiles):
    """The static frontend, plus the payload-path mapping above."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            response = None
        if response is None or response.status_code == 404:
            alternative = nested_payload_path(path)
            if alternative:
                try:
                    found = await super().get_response(alternative, scope)
                except HTTPException:
                    found = None
                if found is not None and found.status_code == 200:
                    return found
        if response is None:
            raise HTTPException(404)
        return response
