"""Sanitised digest of a Sentry event: the only thing a model ever sees (design §6)."""

from __future__ import annotations

import json

from crate.error_inbox import digest as digest_module
from crate.error_inbox.digest import build_digest, digest_hash, group_key, service_tag


def _frame(
    function, *, lineno=10, in_app=True, module=None, filename=None, context=None
):
    module = module if module is not None else "crate.worker_handlers.library"
    filename = filename or "crate/worker_handlers/library.py"
    return {
        "function": function,
        "module": module,
        "filename": filename,
        "absPath": f"/app/{filename}",
        "lineNo": lineno,
        "colNo": None,
        "inApp": in_app,
        "vars": {"track_path": "/music/Secret Artist/a.flac", "token": "local-secret"},
        "context": context
        if context is not None
        else [
            [lineno - 1, "    before()"],
            [lineno, "    current()"],
            [lineno + 1, "    after()"],
        ],
    }


def _event(
    *,
    event_id="a" * 32,
    exceptions=None,
    frames=None,
    tags=None,
    breadcrumbs=None,
    release="crate-abc123",
    message=None,
):
    if frames is None:
        frames = [_frame("run_pipeline", lineno=5), _frame("upsert_album", lineno=42)]
    if exceptions is None:
        exceptions = [
            {
                "type": "IntegrityError",
                "value": 'duplicate key value violates unique constraint "library_albums_artist_name_key"',
                "module": "psycopg2.errors",
                "mechanism": {"type": "generic", "handled": False},
                "stacktrace": {"frames": frames},
            }
        ]
    if breadcrumbs is None:
        breadcrumbs = [
            {
                "category": "query",
                "level": "info",
                "message": "SELECT 1",
                "data": {"x": 1},
            }
        ]
    if tags is None:
        tags = {
            "service": "worker-default",
            "environment": "production",
            "release": release,
            "server_name": "host-7",
            "user": "id:5",
            "task_type": "library_pipeline",
        }
    entries = [{"type": "breadcrumbs", "data": {"values": breadcrumbs}}]
    if exceptions:
        entries.insert(0, {"type": "exception", "data": {"values": exceptions}})
    entries.append(
        {
            "type": "request",
            "data": {
                "url": "https://api.example/x?token=abc",
                "headers": [["Cookie", "s=1"]],
            },
        }
    )
    event = {
        "eventID": event_id,
        "id": event_id,
        "platform": "python",
        "dateCreated": "2026-11-04T10:00:00Z",
        "release": {"version": release} if release else None,
        "tags": [{"key": key, "value": value} for key, value in tags.items()],
        "entries": entries,
        "user": {"id": "5", "ip_address": "203.0.113.9"},
    }
    if message is not None:
        event["message"] = message
        event["title"] = message
    return event


def test_drops_frame_vars_user_and_request():
    digest = build_digest(_event())
    encoded = json.dumps(digest)

    assert all("vars" not in frame for frame in digest["frames"])
    assert "local-secret" not in encoded
    assert "Secret Artist" not in encoded
    assert "203.0.113.9" not in encoded
    assert "Cookie" not in encoded
    assert "user" not in digest
    assert digest["frames"][-1] == {
        "module": "crate.worker_handlers.library",
        "function": "upsert_album",
        "filename": "crate/worker_handlers/library.py",
        "lineno": 42,
        "context": [[41, "    before()"], [42, "    current()"], [43, "    after()"]],
    }


def test_keeps_only_in_app_frames_last_20():
    frames = [_frame(f"lib_{index}", in_app=False) for index in range(5)]
    frames += [_frame(f"app_{index}", lineno=index + 2) for index in range(30)]
    frames.insert(20, _frame("vendored", in_app=False))

    digest = build_digest(_event(frames=frames))

    assert len(digest["frames"]) == 20
    assert [frame["function"] for frame in digest["frames"]] == [
        f"app_{index}" for index in range(10, 30)
    ]


def test_exception_chain_keeps_last_three_and_truncates_values():
    chain = [
        {
            "type": f"Error{index}",
            "value": "x" * 900,
            "stacktrace": {"frames": [_frame("f")]},
        }
        for index in range(4)
    ]

    digest = build_digest(_event(exceptions=chain))

    assert [item["type"] for item in digest["exceptions"]] == [
        "Error1",
        "Error2",
        "Error3",
    ]
    assert all(len(item["value"]) <= 500 for item in digest["exceptions"])


def test_music_paths_are_reduced():
    frames = [
        _frame(
            "scan",
            context=[[9, "path = '/music/Guns N' Roses/Use Your Illusion I/01.flac'"]],
        )
    ]
    exceptions = [
        {
            "type": "FileNotFoundError",
            "value": "[Errno 2] No such file or directory: '/music/Guns N' Roses/Use Your Illusion I/01 - Right Next Door to Hell.flac'",
            "stacktrace": {"frames": frames},
        }
    ]
    breadcrumbs = [
        {
            "category": "scan",
            "level": "info",
            "message": "reading /music/A, B (Live)/x.flac now",
        }
    ]

    digest = build_digest(_event(exceptions=exceptions, breadcrumbs=breadcrumbs))
    encoded = json.dumps(digest)

    assert digest["exceptions"][0]["value"] == (
        "[Errno 2] No such file or directory: '/music/<path>"
    )
    assert digest["breadcrumbs"][0]["message"] == "reading /music/<path>"
    assert digest["frames"][0]["context"] == [[9, "path = '/music/<path>"]]
    assert "Roses" not in encoded
    assert "Live" not in encoded


def test_query_strings_removed():
    breadcrumbs = [
        {
            "category": "fetch",
            "level": "error",
            "message": "GET https://api.lespedants.org/api/me?token=abc&x=1 [502]",
        },
        {
            "category": "navigation",
            "level": "info",
            "message": "/api/stream/12?sig=xyz",
        },
        {"category": "ui", "level": "info", "message": "Retry? yes"},
    ]

    digest = build_digest(_event(breadcrumbs=breadcrumbs))

    assert [crumb["message"] for crumb in digest["breadcrumbs"]] == [
        "GET https://api.lespedants.org/api/me [502]",
        "/api/stream/12",
        "Retry? yes",
    ]


def test_emails_and_ip_addresses_removed():
    exceptions = [
        {
            "type": "AuthError",
            "value": "login for bob@example.com from 203.0.113.9 via fe80::1 at 12:34:56 in add::helper",
            "stacktrace": {"frames": [_frame("login")]},
        }
    ]

    value = build_digest(_event(exceptions=exceptions))["exceptions"][0]["value"]

    assert value == "login for <email> from <ip> via <ip> at 12:34:56 in add::helper"


def test_tag_allowlist():
    digest = build_digest(_event())

    assert digest["tags"] == {
        "service": "worker-default",
        "environment": "production",
        "release": "crate-abc123",
        "task_type": "library_pipeline",
    }


def test_breadcrumbs_last_10_with_only_category_level_and_short_message():
    breadcrumbs = [
        {
            "category": f"c{index}",
            "level": "info",
            "message": "m" * 400,
            "data": {"secret": 1},
        }
        for index in range(15)
    ]

    digest = build_digest(_event(breadcrumbs=breadcrumbs))

    assert [crumb["category"] for crumb in digest["breadcrumbs"]] == [
        f"c{index}" for index in range(5, 15)
    ]
    assert all(
        set(crumb) == {"category", "level", "message"}
        for crumb in digest["breadcrumbs"]
    )
    assert all(len(crumb["message"]) <= 160 for crumb in digest["breadcrumbs"])


def test_message_only_event_keeps_the_message():
    digest = build_digest(
        _event(
            exceptions=[], message="Crate C0 diagnostic obs_c0_123 for ops@example.com"
        )
    )

    assert digest["exceptions"] == []
    assert digest["frames"] == []
    assert digest["message"] == "Crate C0 diagnostic obs_c0_123 for <email>"


def _size(digest):
    return len(json.dumps(digest, ensure_ascii=False, separators=(",", ":")).encode())


def _crumbs(count):
    return [
        {"category": "http", "level": "info", "message": "b" * 150}
        for _ in range(count)
    ]


def test_size_cap_trims_breadcrumbs_first(monkeypatch):
    frames = [_frame(f"f{index}", lineno=index + 6) for index in range(20)]
    full = build_digest(_event(frames=frames, breadcrumbs=_crumbs(10)))
    monkeypatch.setattr(digest_module, "MAX_DIGEST_BYTES", _size(full) - 300)

    trimmed = build_digest(_event(frames=frames, breadcrumbs=_crumbs(10)))

    assert _size(trimmed) <= digest_module.MAX_DIGEST_BYTES
    assert 0 < len(trimmed["breadcrumbs"]) < 10
    assert [frame["context"] for frame in trimmed["frames"]] == [
        frame["context"] for frame in full["frames"]
    ]
    assert trimmed["truncated"] is True
    assert full["truncated"] is False


def test_size_cap_then_trims_context_lines(monkeypatch):
    context = [[line, "c" * 300] for line in range(11)]
    frames = [_frame(f"f{index}", context=context) for index in range(20)]

    digest = build_digest(_event(frames=frames, breadcrumbs=_crumbs(10)))

    assert _size(digest) <= digest_module.MAX_DIGEST_BYTES
    assert digest["breadcrumbs"] == []
    assert len(digest["frames"]) == 20
    assert all(
        len(text) <= 200 for frame in digest["frames"] for _, text in frame["context"]
    )


def test_hash_stable_across_event_ids_releases_and_line_numbers():
    first = _event(
        event_id="a" * 32,
        release="crate-aaa",
        frames=[_frame("run", lineno=5), _frame("upsert_album", lineno=42)],
        exceptions=None,
        breadcrumbs=_crumbs(3),
    )
    second = _event(
        event_id="b" * 32,
        release="crate-bbb",
        frames=[_frame("run", lineno=7), _frame("upsert_album", lineno=49)],
        breadcrumbs=_crumbs(8),
    )
    numbered_a = _event(
        exceptions=[
            {
                "type": "TaskError",
                "value": "task 1234 failed for 9f1c2e4a-0b1d-4c55-9d1e-8a7b6c5d4e3f",
                "stacktrace": {"frames": [_frame("run")]},
            }
        ]
    )
    numbered_b = _event(
        exceptions=[
            {
                "type": "TaskError",
                "value": "task 98 failed for 0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a",
                "stacktrace": {"frames": [_frame("run")]},
            }
        ]
    )
    other_type = _event(
        exceptions=[
            {
                "type": "OperationalError",
                "value": "task 98 failed",
                "stacktrace": {"frames": [_frame("run")]},
            }
        ]
    )

    assert digest_hash(build_digest(first)) == digest_hash(build_digest(second))
    assert digest_hash(build_digest(numbered_a)) == digest_hash(
        build_digest(numbered_b)
    )
    assert digest_hash(build_digest(numbered_b)) != digest_hash(
        build_digest(other_type)
    )


def test_group_key_same_for_same_top_frame():
    base = build_digest(_event(frames=[_frame("run"), _frame("upsert_album")]))
    other_caller = build_digest(
        _event(
            frames=[_frame("backfill"), _frame("upsert_album", lineno=99)],
            exceptions=None,
        )
    )
    other_top = build_digest(_event(frames=[_frame("run"), _frame("upsert_track")]))

    assert group_key(base) == group_key(other_caller)
    assert group_key(base) != group_key(other_top)


def test_group_key_ignores_bundle_hashes_and_relative_prefixes():
    def js_event(filename):
        frame = _frame("refresh", module="", filename=filename)
        return build_digest(
            _event(
                exceptions=[
                    {
                        "type": "TypeError",
                        "value": "Failed to fetch",
                        "stacktrace": {"frames": [frame]},
                    }
                ]
            )
        )

    assert group_key(js_event("/assets/HomeSection-wKVIecUd.js")) == group_key(
        js_event("/assets/HomeSection-Xy12AbCd.js")
    )
    assert group_key(js_event("../src/App.tsx")) == group_key(
        js_event("../../src/App.tsx")
    )


def test_service_tag_is_the_trimmed_service_of_the_event():
    assert service_tag({"tags": {"service": "  worker-fast "}}) == "worker-fast"
    assert service_tag({"tags": {"service": "x" * 150}}) == "x" * 100
    for digest in ({}, {"tags": None}, {"tags": {"service": 7}}, {"tags": {}}):
        assert service_tag(digest) is None
    assert service_tag({"tags": {"service": "   "}}) is None
