import threading
import time
from collections import deque
from collections.abc import Callable

# Enough for any honest use; past it the oldest keys are forgotten so a flood of made-up keys cannot grow memory.
MAX_KEYS = 10_000


class RateLimiter:
    """Allows `limit` events per key in any `window_seconds`. In memory, so it is per process: fine for a
    single server, and it resets on restart like the rest of the (temporary) data."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_KEYS,
    ):
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str) -> deque[float] | None:
        """The key's events still inside the window, or None (forgetting the key) if there are none."""
        events = self._events.get(key)
        if events is None:
            return None
        cutoff = self._clock() - self.window
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def _make_room(self) -> None:
        for key in list(self._events):
            self._prune(key)
        while len(self._events) >= self.max_keys:
            del self._events[next(iter(self._events))]  # the oldest key

    def _append(self, key: str) -> None:
        events = self._prune(key)
        if events is None:
            if len(self._events) >= self.max_keys:
                self._make_room()
            events = self._events[key] = deque()
        events.append(self._clock())

    def blocked(self, key: str) -> bool:
        """Whether the key has used up its allowance (without counting a new event)."""
        with self._lock:
            events = self._prune(key)
            return events is not None and len(events) >= self.limit

    def record(self, key: str) -> None:
        with self._lock:
            self._append(key)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def allow(self, key: str) -> bool:
        """Counts an event and returns True, or returns False if the key is over its allowance. Checking and
        counting happen together, so parallel requests cannot all slip under the limit."""
        with self._lock:
            events = self._prune(key)
            if events is not None and len(events) >= self.limit:
                return False
            self._append(key)
            return True
