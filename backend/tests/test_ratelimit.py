from app.ratelimit import RateLimiter


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_refuses():
    limiter = RateLimiter(limit=3, window_seconds=60, clock=Clock())
    assert [limiter.allow("a") for _ in range(5)] == [True, True, True, False, False]


def test_keys_are_independent():
    limiter = RateLimiter(limit=1, window_seconds=60, clock=Clock())
    assert limiter.allow("a") and limiter.allow("b")
    assert not limiter.allow("a")


def test_events_expire_after_the_window():
    clock = Clock()
    limiter = RateLimiter(limit=2, window_seconds=60, clock=clock)
    assert limiter.allow("a") and limiter.allow("a") and not limiter.allow("a")
    clock.now += 59
    assert not limiter.allow("a")
    clock.now += 2
    assert limiter.allow("a")


def test_a_refused_event_is_not_counted():
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60, clock=clock)
    assert limiter.allow("a")
    clock.now += 30
    assert not limiter.allow("a")  # must not extend the block
    clock.now += 31
    assert limiter.allow("a")


def test_blocked_reset_and_record_for_failure_counting():
    limiter = RateLimiter(limit=2, window_seconds=60, clock=Clock())
    assert not limiter.blocked("a")
    limiter.record("a")
    assert not limiter.blocked("a")
    limiter.record("a")
    assert limiter.blocked("a")
    assert limiter.blocked("a")  # checking does not count as an event
    limiter.reset("a")
    assert not limiter.blocked("a")


def test_a_flood_of_new_keys_cannot_grow_memory_without_bound():
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60, clock=clock, max_keys=100)
    for n in range(1000):
        limiter.record(f"key{n}")
        clock.now += 0.001
    assert len(limiter._events) <= 100
    assert limiter.blocked("key999")  # the newest keys are the ones kept


def test_expired_keys_are_swept_before_live_ones_are_forgotten():
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60, clock=clock, max_keys=3)
    limiter.record("live")
    clock.now += 30
    limiter.record("old1")
    limiter.record("old2")
    clock.now += 40  # "live" is now 70s old, the others are 40s
    limiter.record("new")
    assert not limiter.blocked("live")  # expired, swept
    assert limiter.blocked("old1") and limiter.blocked("old2") and limiter.blocked("new")


def test_memory_is_released_when_events_expire():
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60, clock=clock)
    limiter.allow("a")
    clock.now += 61
    assert not limiter.blocked("a")
    assert "a" not in limiter._events
