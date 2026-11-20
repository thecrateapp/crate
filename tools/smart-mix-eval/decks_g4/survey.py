"""Survey the edges the Decks G4 and G4b reports can pick from (Crate Decks plan, G4).

Signs in to a Crate dev stack like Crate Decks, reads the playlists whose tracks
have audio in the stack's music folder, and asks ``POST
/api/playback/transition-plans`` for every edge between consecutive tracks with
the context Auto DJ's Crate Smart Mix mode sends
(``AutoDJSmartMixAdapter::contextFor`` on a server with every Decks feature):
``smart-mix-v3`` with the candidate menu (``localRefinement``) and the same
context with ``smart-mix-v2`` (G4b). For each edge it also estimates where Auto
DJ's own ``FullIntroOutro`` fade would start (``AutoDJProcessor::
calculateTransition``, replicated in ``autodj_fade_begin_s``) from the Intro and
Outro Decks places from the profile (``AnalysisImporter``), and so whether the
fixed 30 s handover lead is shorter than the plan needs.

The track paths, phrases and per-phrase voice come from the dev database through
``psql`` in a read-only transaction. Only dev stacks are accepted.

usage:
    survey.py --url http://127.0.0.1:8585 --email ... --password ... \\
        --music-root /path/to/test-music --output survey.json
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HEADERS = {
    "X-Crate-App": "decks/0.1.0",
    "X-Device-Fingerprint": "crate-decks-g4-survey",
    "Content-Type": "application/json",
}
# AutoDJSmartMixAdapter::contextFor() with Auto DJ's default 10 s transition, on
# a server announcing beatmatch, bass_handoff, long_beatmatch and local_refinement.
AUTO_DJ_CONTEXT = {
    "source": "decks",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 10_000,
    "userCueProfile": "default",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
    "allowLongBeatmatch": True,
}
PLANNERS = ("smart-mix-v3", "smart-mix-v2")
EDGES_PER_REQUEST = 32
# AutoDJProcessor
AUTO_DJ_TRANSITION_S = 10.0
DIRECTOR_LEAD_S = 30.0
# SmartMixDirector
START_SAFETY_LEAD_MS = 50.0
VOCAL_THRESHOLD = 90  # crate.smart_mix.models.VOCAL_THRESHOLD
PLAYLIST_PREFIX = "G3 · "


def check_dev_stack(url: str) -> None:
    host = urllib.parse.urlsplit(url).hostname or ""
    if host == "localhost":
        return
    address = ipaddress.ip_address(host)
    if not (address.is_loopback or address.is_private):
        raise SystemExit(f"{host} is not a dev stack address")


class Server:
    def __init__(self, url: str) -> None:
        self.url = url.rstrip("/")
        self.token = ""

    def request(self, method: str, path: str, body: Any = None) -> Any:
        headers = dict(HEADERS)
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.url + path, data=data, headers=headers, method=method
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read() or b"null")

    def sign_in(self, email: str, password: str) -> None:
        answer = self.request(
            "POST", "/api/auth/login", {"email": email, "password": password}
        )
        self.token = answer.get("token") or ""
        if not self.token:
            raise SystemExit("The sign-in gave no access token")


def read_only_rows(sql: str) -> list[list[str]]:
    """Rows of ``sql`` from the dev stack's PostgreSQL, in a read-only transaction."""
    command = [
        "docker",
        "exec",
        "crate-dev-postgres",
        "psql",
        "-U",
        "crate",
        "-d",
        "crate",
        "-At",
        "-F",
        "\t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "BEGIN READ ONLY",
        "-c",
        sql,
        "-c",
        "ROLLBACK",
    ]
    output = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    return [
        line.split("\t")
        for line in output.splitlines()
        if line and line not in ("BEGIN", "ROLLBACK")
    ]


def autodj_fade_begin_s(outgoing: dict, incoming: dict) -> dict[str, float]:
    """Auto DJ's own FullIntroOutro fade (AutoDJProcessor::calculateTransition).

    Intro and Outro as AnalysisImporter places them: Intro from the active start
    to the intro cue, Outro from the outro cue to the active end. Without a
    position the start (``getFirstSoundSecond``) or the end of the track stands
    in, as upstream's silence analysis would place them. Returns the fade's
    begin and end on the outgoing track and the incoming start, in seconds.
    """

    def ranges(profile: dict) -> tuple[float, float | None, float | None, float]:
        duration = profile["durationMs"] / 1000.0
        start = (profile.get("activeStartMs") or 0) / 1000.0
        if profile.get("quality") != "full":
            # AnalysisImporter leaves the track to upstream: its silence analysis
            # places only the Intro start and the Outro end (first and last sound)
            end = (profile.get("activeEndMs") or profile["durationMs"]) / 1000.0
            return start, None, None, end
        intro_end = profile.get("introCueMs")
        intro_end_s = (
            intro_end / 1000.0 if intro_end and intro_end / 1000.0 > start else None
        )
        active_end = profile.get("activeEndMs")
        end = active_end / 1000.0 if active_end else duration
        outro_cue = profile.get("outroCueMs")
        outro_start = (
            outro_cue / 1000.0
            if outro_cue is not None and outro_cue / 1000.0 < end
            else None
        )
        return start, intro_end_s, outro_start, end

    _, _, out_start, out_end = ranges(outgoing)
    in_start, in_end, in_outro_start, in_outro_end = ranges(incoming)
    outro_start = out_start if out_start is not None else out_end
    outro_length = out_end - outro_start
    intro_end = in_end if in_end is not None else in_start
    # The incoming deck is cued at its intro start (seekToStartPoint)
    to_start = in_start
    to_fade_begin = in_outro_start if in_outro_start is not None else in_outro_end
    if to_fade_begin == in_outro_end:
        to_fade_begin -= AUTO_DJ_TRANSITION_S
    intro_length = 0.0
    if to_start < intro_end and in_start < intro_end:
        intro_length = intro_end - to_start
    length = intro_length
    if outro_length > 0 and (length <= 0 or length > outro_length):
        length = outro_length
    if length > 0:
        if to_start + length > to_fade_begin:
            length = to_fade_begin - to_start
        begin = out_end - length
        end = out_end
    else:
        length = min(to_fade_begin - to_start, AUTO_DJ_TRANSITION_S)
        begin = out_end - length
        end = out_end
    return {"fadeBeginS": begin, "fadeEndS": end, "incomingStartS": to_start}


def director_start_ms(plan: dict, outgoing_duration_ms: float) -> float:
    """SmartMixDirector::startAtMs()."""
    latest = max(0.0, outgoing_duration_ms - plan["durationMs"] - START_SAFETY_LEAD_MS)
    cue = plan["outgoingCueMs"]
    return min(float(cue), latest) if cue > 0 else latest


def voiced_share(phrases: list[dict], levels: bytes, *, last: bool) -> float | None:
    """Share of the two phrases at the outgoing end (or incoming start) voiced."""
    if not phrases or not levels:
        return None
    count = min(len(phrases), len(levels))
    indexes = list(range(count))[-2:] if last else list(range(count))[:2]
    voiced = [levels[index] >= VOCAL_THRESHOLD for index in indexes]
    return sum(voiced) / len(voiced)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", default="http://127.0.0.1:8585")
    parser.add_argument("--email", default=os.environ.get("CRATE_DECKS_LIVE_EMAIL"))
    parser.add_argument(
        "--password", default=os.environ.get("CRATE_DECKS_LIVE_PASSWORD")
    )
    parser.add_argument("--music-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    check_dev_stack(args.url)
    server = Server(args.url)
    server.sign_in(args.email, args.password)

    rows = read_only_rows(
        "select lt.entity_uid::text, lt.path, coalesce(p.phrases::text, 'null'), "
        "coalesce(encode(p.vocal_presence, 'hex'), ''), coalesce(lt.genre, '') "
        "from library_tracks lt left join track_mix_profiles p on p.track_id = lt.id "
        "where lt.path like '/music/%'"
    )
    tracks: dict[str, dict[str, Any]] = {}
    for uid, path, phrases, vocals, genre in rows:
        local = args.music_root / path.removeprefix("/music/")
        if not local.is_file():
            continue
        parsed = json.loads(phrases)
        if isinstance(parsed, dict):
            parsed = parsed.get("phrases")
        tracks[uid] = {
            "path": path,
            "localPath": str(local),
            "phrases": parsed or [],
            "vocals": bytes.fromhex(vocals),
            "genre": genre,
        }
    print(f"{len(tracks)} tracks with audio", file=sys.stderr)

    containers = server.request("GET", "/api/decks/containers")["containers"]
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    for container in containers:
        if container["kind"] != "playlist" or not container["name"].startswith(
            PLAYLIST_PREFIX
        ):
            continue
        listing = server.request(
            "GET", f"/api/decks/containers/playlist/{container['id']}/tracks?limit=500"
        )["tracks"]
        playable = [row for row in listing if row["entity_uid"] in tracks]
        for row in playable:
            tracks[row["entity_uid"]].update(
                {key: row.get(key) for key in ("title", "artist", "bpm", "camelot")}
            )
        for first, second in zip(playable, playable[1:]):
            key = (first["entity_uid"], second["entity_uid"])
            edges.setdefault(key, {"playlists": []})["playlists"].append(
                container["name"]
            )

    profiles = {
        uid: server.request("GET", f"/api/tracks/by-entity/{uid}/mix-profile")
        for uid in {uid for edge in edges for uid in edge}
    }
    plans: dict[str, dict[tuple[str, str], Any]] = {}
    keys = sorted(edges)
    for planner in PLANNERS:
        context = dict(AUTO_DJ_CONTEXT)
        if planner == "smart-mix-v3":
            context["localRefinement"] = True
        plans[planner] = {}
        for index in range(0, len(keys), EDGES_PER_REQUEST):
            batch = keys[index : index + EDGES_PER_REQUEST]
            answer = server.request(
                "POST",
                "/api/playback/transition-plans",
                {
                    "plannerVersion": planner,
                    "edges": [
                        {
                            "outgoingTrackEntityUid": outgoing,
                            "incomingTrackEntityUid": incoming,
                            "context": context,
                        }
                        for outgoing, incoming in batch
                    ],
                },
            )
            for key, plan in zip(batch, answer["plans"]):
                plans[planner][key] = plan

    survey = []
    for key in keys:
        outgoing, incoming = key
        out_profile, in_profile = profiles[outgoing], profiles[incoming]
        fade = autodj_fade_begin_s(out_profile, in_profile)
        handover_s = max(0.0, fade["fadeBeginS"] - DIRECTOR_LEAD_S)
        entry: dict[str, Any] = {
            "outgoing": outgoing,
            "incoming": incoming,
            "playlists": edges[key]["playlists"],
            "outgoingPath": tracks[outgoing]["localPath"],
            "incomingPath": tracks[incoming]["localPath"],
            "outgoingOutroStartMs": (
                out_profile.get("outroCueMs")
                if out_profile.get("quality") == "full"
                else out_profile.get("activeEndMs") or out_profile["durationMs"]
            ),
            "outgoingTitle": f"{tracks[outgoing].get('artist')} - {tracks[outgoing].get('title')}",
            "incomingTitle": f"{tracks[incoming].get('artist')} - {tracks[incoming].get('title')}",
            "outgoingGenre": tracks[outgoing]["genre"],
            "incomingGenre": tracks[incoming]["genre"],
            "outgoingQuality": out_profile.get("quality"),
            "incomingQuality": in_profile.get("quality"),
            "outgoingBpm": out_profile.get("bpm"),
            "incomingBpm": in_profile.get("bpm"),
            "outgoingVoicedEnd": voiced_share(
                tracks[outgoing]["phrases"], tracks[outgoing]["vocals"], last=True
            ),
            "incomingVoicedStart": voiced_share(
                tracks[incoming]["phrases"], tracks[incoming]["vocals"], last=False
            ),
            "outgoingOutroS": (
                (out_profile.get("activeEndMs") or out_profile["durationMs"])
                - (out_profile.get("outroCueMs") or out_profile["durationMs"])
            )
            / 1000.0,
            "autoDj": fade | {"handoverS": handover_s},
            "plans": {},
        }
        for planner in PLANNERS:
            plan = plans[planner][key]
            start_ms = director_start_ms(plan, out_profile["durationMs"])
            entry["plans"][planner] = {
                "mode": plan["mode"],
                "durationMs": plan["durationMs"],
                "outgoingCueMs": plan["outgoingCueMs"],
                "incomingCueMs": plan["incomingCueMs"],
                "incomingTempoRatio": plan["incomingTempoRatio"],
                "bassHandoff": plan["bassHandoff"],
                "curve": plan["curve"],
                "fallbackReason": plan.get("fallbackReason"),
                "candidates": len(plan.get("candidates") or []),
                "directorStartMs": start_ms,
                # Positive: the plan starts before the handover, so the director
                # starts late and jumps the incoming deck forward
                "lateByMs": handover_s * 1000.0 - start_ms,
            }
        survey.append(entry)
    args.output.write_text(
        json.dumps({"context": AUTO_DJ_CONTEXT, "edges": survey}, indent=1)
    )
    print(f"{len(survey)} edges -> {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
