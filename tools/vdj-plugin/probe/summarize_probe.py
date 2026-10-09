"""Turn the VH01 probe and server logs into a Markdown results table."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_DIRECTORY = Path.home() / "Library/Application Support/VirtualDJ/CrateProbe"


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    events = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def _callbacks(events: list[dict], name: str) -> list[dict]:
    return [
        event
        for event in events
        if event.get("event") == "callback" and event.get("callback") == name
    ]


def _threads(callbacks: list[dict]) -> str:
    if not callbacks:
        return "not called"
    main = Counter(str(event.get("main")) for event in callbacks)
    threads = len({event.get("thread") for event in callbacks})
    worst = max(event.get("duration_ms", 0) for event in callbacks)
    return (
        f"{len(callbacks)} calls, {threads} thread(s), "
        f"main={dict(main)}, max {worst:.0f} ms"
    )


def summarize(probe: list[dict], server: list[dict]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []

    folders = _callbacks(probe, "GetFolder")
    async_finishes = [e for e in probe if e.get("event") == "folder_async_finish"]
    rows.append(
        (
            "1. Threads and async GetFolder",
            "; ".join(
                [
                    f"OnSearch: {_threads(_callbacks(probe, 'OnSearch'))}",
                    f"GetFolder: {_threads(folders)}",
                    f"GetStreamUrl: {_threads(_callbacks(probe, 'GetStreamUrl'))}",
                    f"async folder finish() calls: {len(async_finishes)}",
                ]
            ),
        )
    )

    stream_calls = Counter(
        event.get("unique_id") for event in _callbacks(probe, "GetStreamUrl")
    )
    requests = defaultdict(list)
    for event in server:
        requests[event.get("path")].append(event)
    request_summary = []
    for path, items in sorted(requests.items()):
        statuses = Counter(item.get("status") for item in items)
        ranges = sum(1 for item in items if item.get("range"))
        heads = sum(1 for item in items if item.get("method") == "HEAD")
        expired = sum(1 for item in items if item.get("status") == 401)
        request_summary.append(
            f"{path}: {len(items)} req, HEAD {heads}, Range {ranges}, "
            f"401 {expired}, status {dict(statuses)}"
        )
    rows.append(
        (
            "2. GetStreamUrl re-calls and HTTP requests",
            f"GetStreamUrl per track {dict(stream_calls)}; "
            + ("; ".join(request_summary) or "no HTTP requests logged"),
        )
    )

    local_calls = {
        key: stream_calls.get(key, 0) for key in ("local-path", "local-file-url")
    }
    rows.append(
        (
            "3. Local path / file:// in GetStreamUrl",
            f"resolved {local_calls}; confirm in VDJ which one plays",
        )
    )

    tree_folders = sorted(
        {
            event.get("folder_id")
            for event in folders
            if str(event.get("folder_id", "")).startswith("probe:tree")
        }
    )
    rows.append(
        (
            "4. Hierarchical folder ids",
            f"GetFolder called for {tree_folders or 'no tree folder'}; "
            "confirm whether VDJ nested them",
        )
    )

    login_events = [
        e for e in probe if e.get("event") in ("login_window", "login_window_closed")
    ]
    rows.append(
        (
            "5. Login UX",
            f"OnLogin: {_threads(_callbacks(probe, 'OnLogin'))}; "
            f"IsLogged: {_threads(_callbacks(probe, 'IsLogged'))}; "
            + "; ".join(
                str(e.get("detail") or f"closed connected={e.get('connected')}")
                for e in login_events
            ),
        )
    )

    deck_states = [e for e in probe if e.get("event") == "deck_state"]
    commands = [e for e in probe if e.get("event") == "send_command"]
    by_origin = Counter(e.get("origin") for e in deck_states)
    pitch = [
        f"{e.get('origin')} hr={e.get('hr')}"
        for e in commands
        if "pitch_reset" in str(e.get("command"))
    ]
    versions = {e.get("origin"): e.get("version") for e in deck_states}
    rows.append(
        (
            "6. VDJScript from a plugin thread",
            f"deck_state by origin {dict(by_origin)}, versions {versions}; "
            f"pitch_reset {pitch or 'not run'}",
        )
    )

    automix = [
        f"{e.get('command')} hr={e.get('hr')}"
        for e in commands
        if str(e.get("command", "")).startswith(("automix_add_next", "playlist_add"))
    ]
    rows.append(
        (
            "7. automix_add_next / playlist_add with netsearch paths",
            "; ".join(automix) or "not run",
        )
    )

    heartbeats = [e for e in probe if e.get("event") == "heartbeat"]
    span_min = 0.0
    if len(heartbeats) > 1:
        span_min = (heartbeats[-1]["uptime_ms"] - heartbeats[0]["uptime_ms"]) / 60_000
    rows.append(
        (
            "8. Source stays loaded",
            f"{len(heartbeats)} heartbeats over {span_min:.1f} min",
        )
    )

    constructed = sum(1 for e in probe if e.get("event") == "constructed")
    releases = [e for e in probe if e.get("event") == "release_end"]
    release_begins = [e for e in probe if e.get("event") == "release_begin"]
    rows.append(
        (
            "9. Release() and restart",
            f"constructed {constructed}, release_begin {len(release_begins)} "
            f"(in-flight search {[e.get('search_in_flight') for e in release_begins]}), "
            f"release_end {len(releases)} "
            f"(join ms {[round(e.get('join_ms', 0)) for e in releases]})",
        )
    )

    paths = sorted(
        {
            e.get(f"deck{deck}_filepath")
            for e in deck_states
            for deck in range(1, 5)
            if str(e.get(f"deck{deck}_filepath", "")).startswith("netsearch://")
        }
    )
    rows.append(("10. Deck filepath format", ", ".join(paths) or "no probe track seen"))
    return rows


def render(rows: list[tuple[str, str]]) -> str:
    lines = ["| Check | Evidence from logs | Observed in VDJ |", "| --- | --- | --- |"]
    for check, evidence in rows:
        lines.append(f"| {check} | {evidence.replace('|', '/')} |  |")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    probe = read_jsonl(args.dir / "probe.jsonl")
    server = read_jsonl(args.dir / "server.jsonl")
    print(render(summarize(probe, server)), end="")


if __name__ == "__main__":
    main()
