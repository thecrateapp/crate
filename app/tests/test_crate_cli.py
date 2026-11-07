from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_run_scan_supports_scan_only_binary(monkeypatch):
    from crate import crate_cli

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
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


def test_run_analyze_keeps_an_older_binary_without_beats(monkeypatch, caplog):
    import logging

    from crate import crate_cli

    calls = _analyze_harness(monkeypatch, supports_beats=False)

    with caplog.at_level(logging.WARNING, logger=crate_cli.__name__):
        assert crate_cli.run_analyze(file="/music/track.flac", beats=_BEATS) == {
            "bpm": 120
        }
    assert "--beats" not in calls[0]["args"]
    # Dropping the model beats is never silent.
    assert "--beats" in caplog.text
    # Beats only go with a single file.
    calls.clear()
    caplog.clear()
    monkeypatch.setattr(crate_cli, "supports_analyze_beats", lambda: True)
    with caplog.at_level(logging.WARNING, logger=crate_cli.__name__):
        crate_cli.run_analyze(directory="/music", beats=_BEATS)
    assert "--beats" not in calls[0]["args"]
    assert "--beats" in caplog.text


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
        crate_cli._analyze_help.cache_clear()

        assert crate_cli.supports_analyze_beats() is expected
        assert crate_cli.supports_analyze_beats() is expected
        # The answer of a binary that replied is kept.
        assert calls == [["/usr/local/bin/crate-cli", "analyze", "--help"]]
    crate_cli._analyze_help.cache_clear()


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def probe_clock(monkeypatch):
    from crate import crate_cli

    clock = _Clock()
    monkeypatch.setattr(crate_cli, "_clock", clock)
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")
    crate_cli._help_text.cache_clear()
    crate_cli._analyze_help.cache_clear()
    yield clock
    crate_cli._help_text.cache_clear()
    crate_cli._analyze_help.cache_clear()


class _Binary:
    """A crate-cli double that counts its calls and answers in turn."""

    def __init__(self, *replies) -> None:
        self.replies = list(replies)
        self.calls: list[list[str]] = []

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        reply = self.replies[0] if len(self.replies) == 1 else self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(returncode=0, stdout=reply, stderr="")


def _broken(*args: str) -> subprocess.CalledProcessError:
    return subprocess.CalledProcessError(2, ["crate-cli", *args], stderr="panic")


# Both probes: the --help that lists the commands and the analyze --help that lists
# --beats, each with a help that answers True.
PROBES = [
    pytest.param(
        lambda cli: cli.supports_command("analyze"),
        ["--help"],
        "Commands:\n  scan\n  analyze\n",
        id="help",
    ),
    pytest.param(
        lambda cli: cli.supports_analyze_beats(),
        ["analyze", "--help"],
        "      --beats <BEATS>\n",
        id="analyze-help",
    ),
]


@pytest.mark.parametrize(("probe", "args", "_help"), PROBES)
def test_failed_probe_is_not_repeated_within_retry_window(
    monkeypatch, caplog, probe_clock, probe, args, _help
):
    from crate import crate_cli

    # A binary whose help always fails, as a broken install would.
    binary = _Binary(_broken(*args))
    monkeypatch.setattr(crate_cli.subprocess, "run", binary)

    with caplog.at_level(logging.WARNING, logger=crate_cli.__name__):
        assert probe(crate_cli) is False
    assert len(caplog.records) == 1
    assert " ".join(args) in caplog.text
    caplog.clear()

    probe_clock.advance(crate_cli.PROBE_RETRY_SECONDS - 1)
    with caplog.at_level(logging.WARNING, logger=crate_cli.__name__):
        assert probe(crate_cli) is False
        assert probe(crate_cli) is False

    # Every track asks; the binary ran once and the failure was logged once.
    assert binary.calls == [["/usr/local/bin/crate-cli", *args]]
    assert caplog.records == []


@pytest.mark.parametrize(("probe", "args", "help_text"), PROBES)
def test_failed_probe_is_repeated_after_retry_window(
    monkeypatch, probe_clock, probe, args, help_text
):
    from crate import crate_cli

    # A loaded worker can miss the 5 s timeout once: that must not turn the binary
    # off until the worker restarts.
    binary = _Binary(
        subprocess.TimeoutExpired(["crate-cli", *args], 5), help_text, help_text
    )
    monkeypatch.setattr(crate_cli.subprocess, "run", binary)

    assert probe(crate_cli) is False
    probe_clock.advance(crate_cli.PROBE_RETRY_SECONDS)
    assert probe(crate_cli) is True
    probe_clock.advance(crate_cli.PROBE_RETRY_SECONDS)
    assert probe(crate_cli) is True

    # The help of a binary that replied is kept.
    assert binary.calls == [["/usr/local/bin/crate-cli", *args]] * 2


def test_a_failed_help_probe_is_asked_again(monkeypatch, caplog, probe_clock):
    from crate import crate_cli

    binary = _Binary(
        subprocess.TimeoutExpired(["crate-cli", "--help"], 5),
        OSError("Resource temporarily unavailable"),
        "Commands:\n  scan\n  analyze\n",
    )
    monkeypatch.setattr(crate_cli.subprocess, "run", binary)

    with caplog.at_level(logging.WARNING, logger=crate_cli.__name__):
        assert crate_cli.supports_command("analyze") is False
        # Every command shares the one --help.
        assert crate_cli.has_subcommands() is False
        probe_clock.advance(crate_cli.PROBE_RETRY_SECONDS)
        assert crate_cli.has_subcommands() is False
    assert "--help" in caplog.text
    probe_clock.advance(crate_cli.PROBE_RETRY_SECONDS)
    assert crate_cli.supports_command("analyze") is True
    assert crate_cli.has_subcommands() is True
    assert crate_cli.supports_command("bliss") is False
    assert len(binary.calls) == 3


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

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
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

    crate_cli._help_text.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_bliss(file="/music/track.flac") is None
    assert calls == [["/usr/local/bin/crate-cli", "--help"]]
