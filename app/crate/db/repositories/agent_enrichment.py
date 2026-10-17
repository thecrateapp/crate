"""Scoped enrichment writes with source CAS and manual-value preservation."""

from __future__ import annotations

import hashlib
import json

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.repositories.genres_assignments import set_artist_genres
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import optional_scope, read_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale

_FIELDS = {
    "bio",
    "tags_json",
    "similar_json",
    "spotify_id",
    "spotify_popularity",
    "spotify_followers",
    "mbid",
    "country",
    "area",
    "formed",
    "ended",
    "artist_type",
    "members_json",
    "urls_json",
    "listeners",
    "lastfm_playcount",
    "discogs_id",
    "discogs_profile",
    "discogs_members_json",
}
_JSON_FIELDS = {
    "tags_json",
    "similar_json",
    "members_json",
    "urls_json",
    "discogs_members_json",
}
_ALIASES = {
    "tags_json": "tags",
    "similar_json": "similar_artists",
    "members_json": "members",
    "urls_json": "urls",
    "discogs_members_json": "members",
}


def enrichment_state_version(state: dict) -> str:
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _load(current, uid: str, *, locked: bool) -> dict:
    artist = current.execute(
        text(
            "SELECT to_jsonb(a) FROM library_artists a WHERE entity_uid=CAST(:uid AS uuid)"
            + (" FOR UPDATE" if locked else "")
        ),
        {"uid": uid},
    ).scalar_one_or_none()
    if artist is None:
        raise ValueError("Enrichment target does not exist")
    locks = list(
        current.execute(
            text(
                "SELECT to_jsonb(l) FROM library_field_locks l WHERE entity_type='artist' AND entity_id=:id ORDER BY field_name"
            ),
            {"id": artist["id"]},
        ).scalars()
    )
    genres = list(
        current.execute(
            text(
                "SELECT g.name,ag.source,ag.weight FROM artist_genres ag JOIN genres g ON g.id=ag.genre_id WHERE ag.artist_name=:name ORDER BY g.name,ag.source"
            ),
            {"name": artist["name"]},
        ).mappings()
    )
    cache = current.execute(
        text("SELECT value_json FROM cache WHERE key=:key"),
        {"key": f"agent:enrichment:{uid}:setlists"},
    ).scalar_one_or_none()
    return {
        "artist": artist,
        "locks": locks,
        "genres": [dict(row) for row in genres],
        "setlists": cache,
    }


def read_enrichment_state(artist_uid: str, *, session=None) -> dict:
    if session is not None:
        return _load(session, artist_uid, locked=False)
    with read_scope() as current:
        return _load(current, artist_uid, locked=False)


def _empty(value) -> bool:
    return value is None or value == "" or value == [] or value == {}


def apply_enrichment_result(
    artist_uid: str,
    *,
    expected_version: str,
    provider: str,
    mode: str,
    facets: dict,
    task_id: str,
    session=None,
) -> dict:
    if provider not in {
        "lastfm",
        "spotify",
        "musicbrainz",
        "discogs",
        "setlist",
    } or mode not in {"missing", "refresh"}:
        raise ValueError("Unsupported enrichment policy")
    with optional_scope(session) as current:
        state = _load(current, artist_uid, locked=True)
        if enrichment_state_version(state) != expected_version:
            return {"status": "conflict", "facets": [], "code": "SOURCE_CHANGED"}
        artist = state["artist"]
        locked = {lock["field_name"] for lock in state["locks"]}
        results = []
        changed = False
        for facet, content in facets.items():
            updates = {}
            blocked = []
            present = []
            for field, value in content.get("fields", {}).items():
                if field not in _FIELDS:
                    raise ValueError("Unsupported enrichment field")
                if _empty(value):
                    continue
                if (
                    field in locked
                    or _ALIASES.get(field, field) in locked
                    or facet in locked
                ):
                    blocked.append(field)
                elif mode == "missing" and not _empty(artist.get(field)):
                    present.append(field)
                else:
                    updates[field] = value
            assignments = []
            params = {"id": artist["id"]}
            before = {}
            after = {}
            for field, value in updates.items():
                if field == "urls_json":
                    value = {**(artist.get(field) or {}), **value}
                if artist.get(field) == value:
                    continue
                before[field] = artist.get(field)
                after[field] = value
                params[field] = json.dumps(value) if field in _JSON_FIELDS else value
                assignments.append(
                    f"{field}=CAST(:{field} AS jsonb)"
                    if field in _JSON_FIELDS
                    else f"{field}=:{field}"
                )
            if assignments:
                # SQL_SAFE: fields must belong to the closed _FIELDS allowlist.
                current.execute(
                    text(
                        "UPDATE library_artists SET "
                        + ", ".join(assignments)
                        + ", enriched_at=NOW(),updated_at=NOW() WHERE id=:id"
                    ),
                    params,
                )
                artist.update(after)
                changed = True
            extra = False
            if facet == "genres" and content.get("genres"):
                if "genres" in locked:
                    blocked.append("genres")
                elif mode == "missing" and state["genres"]:
                    present.append("genres")
                else:
                    source = f"enrichment:{provider}"
                    before["genres"] = [
                        row for row in state["genres"] if row["source"] == source
                    ]
                    genres = [
                        (name, max(0.1, 1 - index * 0.05), source)
                        for index, name in enumerate(content["genres"])
                    ]
                    set_artist_genres(artist["name"], genres, session=current)
                    after["genres"] = content["genres"]
                    extra = True
            if facet == "setlists" and content.get("setlists"):
                if "setlists" in locked:
                    blocked.append("setlists")
                elif mode == "missing" and not _empty(state["setlists"]):
                    present.append("setlists")
                else:
                    before["setlists"] = state["setlists"]
                    after["setlists"] = content["setlists"]
                    current.execute(
                        text(
                            "INSERT INTO cache(key,value_json,updated_at) VALUES (:key,CAST(:value AS jsonb),NOW()) ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=EXCLUDED.updated_at"
                        ),
                        {
                            "key": f"agent:enrichment:{artist_uid}:setlists",
                            "value": json.dumps(content["setlists"]),
                        },
                    )
                    extra = True
            if facet == "similar_artists" and "similar_json" in after:
                rows = [
                    {
                        "artist": artist["name"],
                        "name": entry["name"],
                        "score": entry["score"],
                        "source": provider,
                    }
                    for entry in after["similar_json"]
                ]
                if rows:
                    current.execute(
                        text(
                            "INSERT INTO artist_similarities(artist_name,similar_name,score,source,updated_at) VALUES (:artist,:name,:score,:source,NOW()) ON CONFLICT(artist_name,similar_name) DO UPDATE SET score=EXCLUDED.score,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at WHERE artist_similarities.source <> 'manual'"
                        ),
                        rows,
                    )
            changed = changed or extra
            results.append(
                {
                    "facet": facet,
                    "status": "applied"
                    if after
                    else "locked"
                    if blocked
                    else "present"
                    if present
                    else "no_data",
                    "before": before,
                    "after": after,
                    "locked_fields": blocked,
                    "present_fields": present,
                }
            )
        current.execute(
            text(
                "INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json,task_id) VALUES (NOW(),'scoped_artist_enrichment','artist',:uid,CAST(:details AS jsonb),:task)"
            ),
            {
                "uid": artist_uid,
                "task": task_id,
                "details": json.dumps(
                    {"source": provider, "mode": mode, "facets": results}, default=str
                ),
            },
        )
        if changed:
            current.execute(
                text(
                    "UPDATE library_artists SET enriched_at=NOW(),updated_at=NOW() WHERE id=:id"
                ),
                {"id": artist["id"]},
            )
            enqueue_local_dirty_source("artist", artist_uid, "upsert", session=current)
            mark_ui_snapshots_stale(scope="library", session=current)
            append_domain_event(
                "ui.invalidate",
                {"scope": "library"},
                scope="ui.invalidate",
                subject_key=f"artist:{artist_uid}",
                session=current,
            )
        final = _load(current, artist_uid, locked=False)
        verified = True
        for result in results:
            for field, value in result["after"].items():
                if field == "genres":
                    observed = {row["name"].casefold() for row in final["genres"]}
                    verified = verified and all(
                        name.casefold() in observed for name in value
                    )
                elif field == "setlists":
                    verified = verified and final["setlists"] == value
                else:
                    verified = verified and final["artist"].get(field) == value
        manual_before = {
            row["name"] for row in state["genres"] if row["source"] == "manual"
        }
        manual_after = {
            row["name"] for row in final["genres"] if row["source"] == "manual"
        }
        verified = (
            verified
            and manual_before == manual_after
            and state["locks"] == final["locks"]
        )
        return {
            "status": "completed" if verified else "partial",
            "verification": "passed" if verified else "failed",
            "facets": results,
            "source_version": enrichment_state_version(final),
        }


__all__ = [
    "enrichment_state_version",
    "read_enrichment_state",
    "apply_enrichment_result",
]
