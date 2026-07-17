from __future__ import annotations

from collections import defaultdict


class FakeRedis:
    def __init__(self) -> None:
        self.zsets: dict[str, dict[str, float]] = defaultdict(dict)
        self.expires: dict[str, int] = {}

    def eval(self, _script, numkeys, *args):
        assert numkeys == 2
        peer_key, global_key, cache_key, raw_now, raw_ttl, raw_peer_limit, raw_global_limit = (
            args
        )
        now = float(raw_now)
        ttl = float(raw_ttl)
        peer_limit = int(raw_peer_limit)
        global_limit = int(raw_global_limit)

        for key in (peer_key, global_key):
            self.zsets[key] = {
                member: score
                for member, score in self.zsets[key].items()
                if score > now - ttl
            }

        if cache_key in self.zsets[global_key] or cache_key in self.zsets[peer_key]:
            return 2
        if len(self.zsets[peer_key]) >= peer_limit:
            return 3
        if len(self.zsets[global_key]) >= global_limit:
            return 4

        self.zsets[peer_key][cache_key] = now
        self.zsets[global_key][cache_key] = now
        self.expires[peer_key] = int(ttl)
        self.expires[global_key] = int(ttl)
        return 1


def test_prepare_reservation_limits_each_peer_to_four_unique_variants(monkeypatch):
    from crate.federation import playback_prepare

    redis = FakeRedis()
    monkeypatch.setattr(playback_prepare.time, "time", lambda: 1_000.0)

    results = [
        playback_prepare.acquire_prepare_reservation(redis, "peer-a", f"variant-{i}")
        for i in range(5)
    ]

    assert results[:4] == [playback_prepare.PrepareReservation.ACCEPTED] * 4
    assert results[4] is playback_prepare.PrepareReservation.PEER_LIMITED


def test_prepare_reservation_limits_owner_to_twenty_unique_variants(monkeypatch):
    from crate.federation import playback_prepare

    redis = FakeRedis()
    monkeypatch.setattr(playback_prepare.time, "time", lambda: 1_000.0)

    accepted = [
        playback_prepare.acquire_prepare_reservation(
            redis, f"peer-{index // 4}", f"variant-{index}"
        )
        for index in range(20)
    ]
    denied = playback_prepare.acquire_prepare_reservation(
        redis, "peer-extra", "variant-extra"
    )

    assert accepted == [playback_prepare.PrepareReservation.ACCEPTED] * 20
    assert denied is playback_prepare.PrepareReservation.GLOBAL_LIMITED


def test_prepare_reservation_deduplicates_and_prunes_expired_variants(monkeypatch):
    from crate.federation import playback_prepare

    redis = FakeRedis()
    monkeypatch.setattr(playback_prepare.time, "time", lambda: 1_000.0)

    assert (
        playback_prepare.acquire_prepare_reservation(redis, "peer-a", "variant-a")
        is playback_prepare.PrepareReservation.ACCEPTED
    )
    assert (
        playback_prepare.acquire_prepare_reservation(redis, "peer-a", "variant-a")
        is playback_prepare.PrepareReservation.DUPLICATE
    )

    monkeypatch.setattr(
        playback_prepare.time,
        "time",
        lambda: 1_000.0 + playback_prepare.PREPARE_RESERVATION_TTL_SECONDS + 1,
    )
    assert (
        playback_prepare.acquire_prepare_reservation(redis, "peer-a", "variant-b")
        is playback_prepare.PrepareReservation.ACCEPTED
    )


def test_prepare_reservation_fails_closed_without_redis():
    from crate.federation import playback_prepare

    assert (
        playback_prepare.acquire_prepare_reservation(None, "peer-a", "variant-a")
        is playback_prepare.PrepareReservation.UNAVAILABLE
    )
