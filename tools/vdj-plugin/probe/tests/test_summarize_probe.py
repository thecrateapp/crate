from __future__ import annotations

from summarize_probe import render, summarize


def _callback(name, **fields):
    return {
        "event": "callback",
        "callback": name,
        "thread": "t1",
        "main": False,
        "duration_ms": 3,
        **fields,
    }


def test_summary_covers_every_check_with_log_evidence():
    probe = [
        {"event": "constructed"},
        _callback("OnSearch", query="x"),
        _callback("GetFolder", folder_id="probe:async"),
        _callback("GetFolder", folder_id="probe:tree/a/b"),
        {"event": "folder_async_finish", "finished": True},
        _callback("GetStreamUrl", unique_id="http-short"),
        _callback("GetStreamUrl", unique_id="http-short"),
        _callback("GetStreamUrl", unique_id="local-path"),
        _callback("OnLogin"),
        {
            "event": "login_window",
            "detail": "OnLogin ran on the main thread; opening directly",
        },
        {
            "event": "deck_state",
            "origin": "background",
            "version": "2026",
            "deck1_filepath": "netsearch://plugin-CrateProbe/http-short",
        },
        {
            "event": "send_command",
            "origin": "callback",
            "command": 'automix_add_next "netsearch://plugin-CrateProbe/http-short"',
            "hr": 0,
        },
        {
            "event": "send_command",
            "origin": "background",
            "command": "deck 1 pitch_reset",
            "hr": 0,
        },
        {"event": "heartbeat", "uptime_ms": 0},
        {"event": "heartbeat", "uptime_ms": 600_000},
        {"event": "release_begin", "search_in_flight": True},
        {"event": "release_end", "join_ms": 120},
    ]
    server = [
        {
            "path": "/media/probe-short.wav",
            "method": "GET",
            "range": None,
            "status": 200,
        },
        {
            "path": "/media/probe-short.wav",
            "method": "GET",
            "range": "bytes=100-",
            "status": 401,
        },
    ]

    rows = dict(summarize(probe, server))

    assert len(rows) == 10
    assert "async folder finish() calls: 1" in rows["1. Threads and async GetFolder"]
    assert "'http-short': 2" in rows["2. GetStreamUrl re-calls and HTTP requests"]
    assert "401 1" in rows["2. GetStreamUrl re-calls and HTTP requests"]
    assert "probe:tree/a/b" in rows["4. Hierarchical folder ids"]
    assert "main thread" in rows["5. Login UX"]
    assert "background hr=0" in rows["6. VDJScript from a plugin thread"]
    assert (
        "automix_add_next"
        in rows["7. automix_add_next / playlist_add with netsearch paths"]
    )
    assert "10.0 min" in rows["8. Source stays loaded"]
    assert "join ms [120]" in rows["9. Release() and restart"]
    assert (
        rows["10. Deck filepath format"] == "netsearch://plugin-CrateProbe/http-short"
    )


def test_render_produces_a_markdown_table():
    table = render([("1. A", "x | y")])

    assert table.splitlines()[0] == "| Check | Evidence from logs | Observed in VDJ |"
    assert "x / y" in table
