"""Explicit provider/facet enrichment without full-refresh side effects."""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from uuid import UUID

from crate.artist_bio import normalize_artist_bio
from crate.db.repositories.agent_enrichment import (
    apply_enrichment_result,
    enrichment_state_version,
    read_enrichment_state,
)
from crate.provider_rate_limits import wait_for_provider_slot

PROVIDER_FACETS = {
    "lastfm": (
        "biography",
        "tags",
        "genres",
        "identity",
        "urls",
        "popularity",
        "similar_artists",
    ),
    "spotify": ("tags", "genres", "identity", "urls", "popularity", "similar_artists"),
    "musicbrainz": ("identity", "urls", "members"),
    "discogs": ("biography", "identity", "urls", "members"),
    "setlist": ("setlists",),
}
FACETS = (
    "biography",
    "tags",
    "genres",
    "identity",
    "urls",
    "members",
    "popularity",
    "similar_artists",
    "setlists",
)
_INTERVALS = {
    "lastfm": 0.25,
    "spotify": 0.15,
    "musicbrainz": 1.1,
    "discogs": 1.0,
    "setlist": 1.0,
}


def _selection(values: object, allowed: set, *, maximum: int, label: str) -> list:
    if (
        not isinstance(values, list)
        or not values
        or len(values) > maximum
        or any(not isinstance(v, str) for v in values)
        or len(set(values)) != len(values)
        or set(values) - allowed
    ):
        raise ValueError(f"Invalid {label} selection")
    return list(values)


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    del config
    if operation != "enrichment" or set(parameters) - {
        "artist_uids",
        "providers",
        "facets",
        "mode",
    }:
        raise ValueError("Unsupported enrichment parameters")
    raw_uids = parameters.get("artist_uids")
    if not isinstance(raw_uids, list) or not 1 <= len(raw_uids) <= 20:
        raise ValueError("Enrichment requires 1 to 20 artist UIDs")
    uids = [str(UUID(str(uid))) for uid in raw_uids]
    if len(set(uids)) != len(uids):
        raise ValueError("Duplicate artist UIDs")
    providers = _selection(
        parameters.get("providers"), set(PROVIDER_FACETS), maximum=5, label="provider"
    )
    facets = _selection(parameters.get("facets"), set(FACETS), maximum=9, label="facet")
    mode = parameters.get("mode", "missing")
    if mode not in {"missing", "refresh"}:
        raise ValueError("Unsupported enrichment mode")
    if any(
        not set(facets).intersection(PROVIDER_FACETS[provider])
        for provider in providers
    ):
        raise ValueError(
            "Every selected provider must support at least one selected facet"
        )
    states = [read_enrichment_state(uid) for uid in uids]
    targets = [{"entity_type": "artist", "entity_uid": uid} for uid in uids]
    versions = {
        uid: enrichment_state_version(state)
        for uid, state in zip(uids, states, strict=True)
    }
    changes = [
        {
            "artist_uid": uid,
            "providers": providers,
            "facets": facets,
            "locked_fields_preserved": [lock["field_name"] for lock in state["locks"]],
            "value_policy": "only_missing_unlocked_values"
            if mode == "missing"
            else "replace_unlocked_provider_values_preserve_manual",
            "after": "provider_result_unknown_until_execution",
        }
        for uid, state in zip(uids, states, strict=True)
    ]
    return {
        "document": {
            "operation": operation,
            "targets": targets,
            "source_versions": versions,
            "changes": changes,
            "impact": {
                "database": True,
                "filesystem": False,
                "external_providers": providers,
                "provider_facets": {
                    p: [f for f in facets if f in PROVIDER_FACETS[p]] for p in providers
                },
                "unsupported_provider_facets": {
                    p: [f for f in facets if f not in PROVIDER_FACETS[p]]
                    for p in providers
                },
                "provider_fetches": len(uids) * len(providers),
                "provider_min_intervals_seconds": {p: _INTERVALS[p] for p in providers},
                "transport_requests": "Provider clients may issue multiple requests and reuse their configured caches; refresh does not purge caches",
                "metadata_only": True,
                "setlists_storage": "bounded_metadata_cache_and_job_result",
                "implicit_photos": False,
                "mode": mode,
            },
            "risk": "caution" if mode == "refresh" else "safe",
            "reversibility": "new_plan_required; provider history is recorded in audit",
        },
        "execution": {
            "artist_uids": uids,
            "providers": providers,
            "facets": facets,
            "mode": mode,
            "source_versions": versions,
        },
    }


def _text(value, limit=4096) -> str | None:
    return value[:limit] if isinstance(value, str) and value.strip() else None


def _strings(value, limit=50) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(
        dict.fromkeys(
            v[:200].strip() for v in value[:limit] if isinstance(v, str) and v.strip()
        )
    )


def _number(value, maximum: int = 2147483647) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return max(0, min(int(number), maximum)) if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _urls(values) -> dict:
    if not isinstance(values, dict):
        return {}
    return {
        k[:100]: v[:4096]
        for k, v in list(values.items())[:30]
        if isinstance(k, str)
        and isinstance(v, str)
        and v.startswith(("https://", "http://"))
    }


def _similar(values) -> list[dict]:
    if not isinstance(values, list):
        return []
    results = []
    for value in values[:50]:
        if not isinstance(value, dict) or not _text(value.get("name"), 200):
            continue
        try:
            score = float(value.get("score") or value.get("match") or 0)
        except (TypeError, ValueError, OverflowError):
            score = 0
        results.append(
            {
                "name": value["name"][:200],
                "score": max(0, min(score, 1)) if math.isfinite(score) else 0,
            }
        )
    return results


def _setlists(payload) -> list[dict]:
    if not isinstance(payload, list):
        return []
    result = []
    for entry in payload[:100]:
        if isinstance(entry, str):
            result.append({"name": entry[:200]})
        elif isinstance(entry, dict):
            result.append(
                {
                    k: value[:4096] if isinstance(value, str) else value
                    for k, value in list(entry.items())[:20]
                    if isinstance(k, str)
                    and k
                    in {
                        "name",
                        "song",
                        "title",
                        "artist",
                        "date",
                        "eventDate",
                        "venue",
                        "city",
                        "country",
                        "url",
                        "count",
                        "rank",
                        "probability",
                        "frequency",
                        "play_count",
                    }
                    and (
                        isinstance(value, str)
                        or type(value) in {int, bool}
                        or isinstance(value, float)
                        and math.isfinite(value)
                    )
                }
            )
    return [entry for entry in result if entry]


def _fetch(provider: str, name: str, facets: list[str]):
    from crate import enrichment

    wait_for_provider_slot(provider, _INTERVALS[provider])
    if provider == "spotify":
        from crate import spotify

        artist = spotify.search_artist(name)
        if not artist:
            return None
        return {
            "artist": artist,
            "related_artists": spotify.get_related_artists(artist["id"])
            if "similar_artists" in facets
            else [],
        }
    if provider == "discogs":
        from crate import discogs

        if not discogs.is_configured():
            raise ValueError("Provider is not configured")
        match = discogs.search_artist(name)
        if not match or not match.get("id"):
            return None
        identifier = match["id"]
        details = (
            discogs.get_artist(identifier)
            if set(facets) & {"biography", "members", "urls"}
            else {}
        )
        details = details or {}
        return {
            "discogs_id": identifier,
            "discogs_url": f"https://www.discogs.com/artist/{identifier}",
            "discogs_profile": details.get("profile"),
            "discogs_members": [
                m.get("name") for m in details.get("members", []) if isinstance(m, dict)
            ],
        }
    if provider == "lastfm":
        import requests
        from crate import lastfm

        cached = lastfm.get_cached_artist_info(name)
        if cached:
            return cached
        key = lastfm._lastfm_key()
        if not key:
            raise ValueError("Provider is not configured")
        response = requests.get(
            "https://ws.audioscrobbler.com/2.0/",
            params={
                "method": "artist.getinfo",
                "artist": name,
                "api_key": key,
                "format": "json",
            },
            timeout=10,
        )
        response.raise_for_status()
        artist = response.json().get("artist")
        if not isinstance(artist, dict):
            return None
        bio = artist.get("bio") or {}
        stats = artist.get("stats") or {}
        raw_tags = artist.get("tags") or {}
        return {
            "bio": bio.get("content") or bio.get("summary"),
            "mbid": artist.get("mbid"),
            "tags": [
                tag["name"]
                for tag in raw_tags.get("tag", [])
                if isinstance(tag, dict) and "name" in tag
            ],
            "url": artist.get("url"),
            "listeners": stats.get("listeners"),
            "playcount": stats.get("playcount"),
            "similar": lastfm._get_similar_artists(name, limit=30)
            if "similar_artists" in facets
            else [],
        }
    fetcher = {
        "musicbrainz": enrichment._fetch_musicbrainz_payload,
        "setlist": enrichment._fetch_setlist_payload,
    }[provider]
    return fetcher(name)


def _extract(provider: str, payload) -> dict:
    if provider == "setlist":
        return {"setlists": {"setlists": _setlists(payload)}}
    if not isinstance(payload, dict):
        raise ValueError("Provider returned an invalid payload")
    if provider == "lastfm":
        tags = _strings(payload.get("tags"))
        return {
            "biography": {
                "fields": {
                    "bio": normalize_artist_bio(_text(payload.get("bio"), 50000))
                }
            },
            "tags": {"fields": {"tags_json": tags}},
            "genres": {"genres": tags},
            "identity": {"fields": {"mbid": _text(payload.get("mbid"))}},
            "urls": {"fields": {"urls_json": _urls({"lastfm": payload.get("url")})}},
            "popularity": {
                "fields": {
                    "listeners": _number(payload.get("listeners")),
                    "lastfm_playcount": _number(
                        payload.get("playcount"), 9223372036854775807
                    ),
                }
            },
            "similar_artists": {
                "fields": {"similar_json": _similar(payload.get("similar"))}
            },
        }
    if provider == "spotify":
        artist = payload.get("artist") or {}
        if not isinstance(artist, dict):
            raise ValueError("Spotify returned an invalid artist")
        genres = _strings(artist.get("genres"))
        followers = artist.get("followers")
        if isinstance(followers, dict):
            followers = followers.get("total")
        urls = _urls({"spotify": artist.get("url")})
        identifier = artist.get("id")
        if (
            not urls
            and isinstance(identifier, str)
            and re.fullmatch(r"[A-Za-z0-9]{22}", identifier)
        ):
            urls["spotify"] = f"https://open.spotify.com/artist/{identifier}"
        return {
            "tags": {"fields": {"tags_json": genres}},
            "genres": {"genres": genres},
            "identity": {"fields": {"spotify_id": _text(artist.get("id"))}},
            "urls": {"fields": {"urls_json": urls}},
            "popularity": {
                "fields": {
                    "spotify_popularity": min(100, value)
                    if (value := _number(artist.get("popularity"))) is not None
                    else None,
                    "spotify_followers": _number(followers),
                }
            },
            "similar_artists": {
                "fields": {"similar_json": _similar(payload.get("related_artists"))}
            },
        }
    if provider == "musicbrainz":
        fields = {
            "mbid": _text(payload.get("mbid")),
            "country": _text(payload.get("country")),
            "area": _text(payload.get("area")),
            "formed": _text(payload.get("begin_date")),
            "ended": _text(payload.get("end_date")),
            "artist_type": _text(payload.get("type")),
        }
        members = payload.get("members") or []
        if isinstance(members, list):
            members = [
                m["name"]
                if isinstance(m, dict) and isinstance(m.get("name"), str)
                else m
                for m in members[:100]
            ]
        return {
            "identity": {"fields": fields},
            "urls": {"fields": {"urls_json": _urls(payload.get("urls"))}},
            "members": {"fields": {"members_json": _strings(members, 100)}},
        }
    return {
        "biography": {
            "fields": {
                "discogs_profile": normalize_artist_bio(
                    _text(payload.get("discogs_profile"), 2000)
                )
            }
        },
        "identity": {
            "fields": {
                "discogs_id": _text(str(payload["discogs_id"]))
                if payload.get("discogs_id")
                else None
            }
        },
        "urls": {
            "fields": {"urls_json": _urls({"discogs": payload.get("discogs_url")})}
        },
        "members": {
            "fields": {
                "discogs_members_json": _strings(payload.get("discogs_members"), 100)
            }
        },
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize: Callable
) -> dict:
    del config
    if operation != "enrichment":
        raise ValueError("Unsupported enrichment operation")
    results = []
    for uid in execution["artist_uids"]:
        authorize()
        state = read_enrichment_state(uid)
        expected = execution["source_versions"][uid]
        if enrichment_state_version(state) != expected:
            results.append(
                {
                    "artist_uid": uid,
                    "status": "conflict",
                    "code": "SOURCE_CHANGED",
                    "providers": [],
                }
            )
            continue
        providers = []
        for provider in execution["providers"]:
            authorize()
            selected = [
                facet
                for facet in execution["facets"]
                if facet in PROVIDER_FACETS[provider]
            ]
            unsupported = [
                {"facet": facet, "status": "not_supported"}
                for facet in execution["facets"]
                if facet not in PROVIDER_FACETS[provider]
            ]
            try:
                payload = authorize(
                    lambda p=provider: _fetch(p, state["artist"]["name"], selected)
                )
                if not payload:
                    providers.append(
                        {
                            "provider": provider,
                            "status": "no_data",
                            "code": "PROVIDER_EMPTY_OR_UNAVAILABLE",
                            "recoverable": True,
                            "facets": [
                                {"facet": facet, "status": "no_data"}
                                for facet in selected
                            ]
                            + unsupported,
                        }
                    )
                    continue
                extracted = _extract(provider, payload)
            except Exception as error:
                from crate.agent_diagnostics import DiagnosticError

                if isinstance(error, DiagnosticError):
                    raise
                providers.append(
                    {
                        "provider": provider,
                        "status": "failed",
                        "code": "PROVIDER_FETCH_FAILED",
                        "recoverable": True,
                        "facets": [
                            {"facet": facet, "status": "failed"} for facet in selected
                        ]
                        + unsupported,
                    }
                )
                continue
            result = authorize(
                lambda p=provider, data=extracted: apply_enrichment_result(
                    uid,
                    expected_version=expected,
                    provider=p,
                    mode=execution["mode"],
                    facets={facet: data[facet] for facet in selected},
                    task_id=task_id,
                )
            )
            providers.append(
                {
                    "provider": provider,
                    **{
                        key: value
                        for key, value in result.items()
                        if key != "source_version"
                    },
                }
            )
            providers[-1]["facets"] += unsupported
            if result["status"] != "completed":
                break
            expected = result["source_version"]
        failed = any(p["status"] != "completed" for p in providers)
        results.append(
            {
                "artist_uid": uid,
                "status": "partial" if failed else "completed",
                "providers": providers,
            }
        )
    failed = any(item["status"] != "completed" for item in results)
    return {
        "execution": {"status": "partial" if failed else "completed", "items": results},
        "verification": {
            "status": "partial" if failed else "passed",
            "evidence": "Persisted fields, preserved locks/manual genres, provider audit and source CAS are verified in the write transaction; provider availability is reported independently",
            "items": [
                {"artist_uid": item["artist_uid"], "status": item["status"]}
                for item in results
            ],
        },
    }


__all__ = ["PROVIDER_FACETS", "FACETS", "compile_operation", "apply_operation"]
