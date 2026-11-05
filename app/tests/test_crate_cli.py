from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace


def test_run_scan_supports_scan_only_binary(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  scan\n", stderr=""
            )
        return SimpleNamespace(returncode=0, stdout='{"artists":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_scan("/music", hash=False, covers=False) == {"artists": []}
    assert calls[-1][:4] == ["/usr/local/bin/crate-cli", "scan", "--dir", "/music"]


def test_run_analyze_returns_none_when_binary_lacks_analyze(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_analyze(file="/music/track.flac") is None
    assert calls == [["/usr/local/bin/crate-cli", "--help"]]


_BEATS = {
    "tracker": "beat-this-small0-dbn",
    "beats_ms": [500, 1_000, 1_500],
    "downbeats_ms": [500],
}


def _analyze_harness(monkeypatch, *, supports_beats: bool) -> list[dict]:
    import json

    from crate import crate_cli, resource_governor

    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")
    monkeypatch.setattr(crate_cli, "supports_command", lambda _name: True)
    monkeypatch.setattr(crate_cli, "supports_analyze_beats", lambda: supports_beats)
    monkeypatch.setattr(crate_cli, "_find_panns_model", lambda: None)
    monkeypatch.setattr(resource_governor, "low_priority_command", list)
    calls: list[dict] = []

    def fake_run(args, **kwargs):
        call = {"args": list(args)}
        if "--beats" in args:
            beats_path = Path(args[args.index("--beats") + 1])
            call["beats_path"] = beats_path
            call["beats"] = json.loads(beats_path.read_text())
        calls.append(call)
        return SimpleNamespace(returncode=0, stdout='{"bpm": 120}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)
    return calls


def test_run_analyze_passes_model_beats_in_a_temporary_file(monkeypatch):
    from crate import crate_cli

    calls = _analyze_harness(monkeypatch, supports_beats=True)

    assert crate_cli.run_analyze(file="/music/track.flac", beats=_BEATS) == {"bpm": 120}
    [call] = calls
    assert call["args"][:4] == [
        "/usr/local/bin/crate-cli",
        "analyze",
        "--file",
        "/music/track.flac",
    ]
    assert call["beats"] == _BEATS
    # The file only lives for the call.
    assert not call["beats_path"].exists()


def test_run_analyze_keeps_an_older_binary_without_beats(monkeypatch):
    from crate import crate_cli

    calls = _analyze_harness(monkeypatch, supports_beats=False)

    assert crate_cli.run_analyze(file="/music/track.flac", beats=_BEATS) == {"bpm": 120}
    assert "--beats" not in calls[0]["args"]
    # Beats only go with a single file.
    calls.clear()
    monkeypatch.setattr(crate_cli, "supports_analyze_beats", lambda: True)
    crate_cli.run_analyze(directory="/music", beats=_BEATS)
    assert "--beats" not in calls[0]["args"]


def test_beats_support_reads_the_analyze_help(monkeypatch):
    from crate import crate_cli

    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")
    helps = {
        "new": "Options:\n  -f, --file <FILE>\n      --beats <BEATS>\n",
        "old": "Options:\n  -f, --file <FILE>\n      --model-path <MODEL_PATH>\n",
    }
    for version, expected in (("new", True), ("old", False)):
        calls: list[list[str]] = []

        def fake_run(args, version=version, **kwargs):
            calls.append(list(args))
            return SimpleNamespace(returncode=0, stdout=helps[version], stderr="")

        monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)
        crate_cli.supports_analyze_beats.cache_clear()

        assert crate_cli.supports_analyze_beats() is expected
        assert calls == [["/usr/local/bin/crate-cli", "analyze", "--help"]]
    crate_cli.supports_analyze_beats.cache_clear()


def test_run_analyze_runs_at_background_priority(monkeypatch):
    from crate import crate_cli, resource_governor

    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")
    monkeypatch.setattr(crate_cli, "supports_command", lambda _name: True)
    monkeypatch.setattr(crate_cli, "_find_panns_model", lambda: None)
    monkeypatch.setattr(
        resource_governor.shutil, "which", lambda name: f"/usr/bin/{name}"
    )
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout='{"bpm": 120}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_analyze(file="/music/track.flac") == {"bpm": 120}
    assert calls == [
        [
            "nice",
            "-n",
            "12",
            "ionice",
            "-c3",
            "/usr/local/bin/crate-cli",
            "analyze",
            "--file",
            "/music/track.flac",
        ]
    ]


def test_run_quality_uses_quality_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  quality\n", stderr=""
            )
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_quality(file="/music/track.flac") == {"tracks": []}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "quality",
        "--file",
        "/music/track.flac",
    ]


def test_run_diff_uses_diff_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  diff\n", stderr=""
            )
        return SimpleNamespace(returncode=0, stdout='{"added_count":0}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_diff("/tmp/before.json", "/tmp/after.json") == {
        "added_count": 0
    }
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "diff",
        "--before",
        "/tmp/before.json",
        "--after",
        "/tmp/after.json",
    ]


def test_run_tags_inspect_uses_tags_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  tags\n", stderr=""
            )
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_tags_inspect(file="/music/track.flac") == {"tracks": []}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "tags",
        "inspect",
        "--file",
        "/music/track.flac",
    ]


def test_run_tags_write_identity_uses_tags_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  tags\n", stderr=""
            )
        return SimpleNamespace(
            returncode=0, stdout='{"written":false,"dry_run":true}', stderr=""
        )

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_tags_write_identity(
        "/music/track.flac",
        artist_uid="artist",
        album_uid="album",
        track_uid="track",
        audio_fingerprint="fp",
        audio_fingerprint_source="quick",
        dry_run=True,
    ) == {"written": False, "dry_run": True}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "tags",
        "write-identity",
        "--file",
        "/music/track.flac",
        "--schema-version",
        "1",
        "--artist-uid",
        "artist",
        "--album-uid",
        "album",
        "--track-uid",
        "track",
        "--audio-fingerprint",
        "fp",
        "--audio-fingerprint-source",
        "quick",
        "--dry-run",
    ]


def test_run_fingerprint_uses_fingerprint_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(
                returncode=0, stdout="Commands:\n  fingerprint\n", stderr=""
            )
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_fingerprint(file="/music/track.flac", mode="full") == {
        "tracks": []
    }
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "fingerprint",
        "--mode",
        "full",
        "--file",
        "/music/track.flac",
    ]


def test_run_bliss_does_not_treat_scan_only_crate_cli_as_legacy_binary(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_bliss(file="/music/track.flac") is None
    assert calls == [["/usr/local/bin/crate-cli", "--help"]]
