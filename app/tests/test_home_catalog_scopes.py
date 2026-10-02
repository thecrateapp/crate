from contextlib import contextmanager
from unittest.mock import Mock

from crate.db.queries import home_catalog


def _session_with_genres(names: list[str]) -> Mock:
    result = Mock()
    result.mappings.return_value.all.return_value = [{"name": name} for name in names]
    session = Mock()
    session.execute.return_value = result
    return session


def test_followed_artist_genres_use_read_scope_without_caller_session(monkeypatch):
    session = _session_with_genres(["Post-punk"])
    scope_events = []

    @contextmanager
    def fake_read_scope():
        scope_events.append("enter")
        yield session
        scope_events.append("exit")

    def unexpected_optional_scope(_session=None):
        raise AssertionError("read-only fallback must not open a write transaction")

    monkeypatch.setattr(home_catalog, "read_scope", fake_read_scope)
    monkeypatch.setattr(
        home_catalog, "optional_scope", unexpected_optional_scope, raising=False
    )

    assert home_catalog.get_followed_artist_genre_names(["artist"], 5) == ["post-punk"]
    assert scope_events == ["enter", "exit"]
    session.execute.assert_called_once()


def test_followed_artist_genres_reuse_caller_session(monkeypatch):
    session = _session_with_genres(["Post-punk"])

    def unexpected_read_scope():
        raise AssertionError("caller session should be reused")

    monkeypatch.setattr(home_catalog, "read_scope", unexpected_read_scope)

    assert home_catalog.get_followed_artist_genre_names(
        ["artist"], 5, session=session
    ) == ["post-punk"]
    session.execute.assert_called_once()
