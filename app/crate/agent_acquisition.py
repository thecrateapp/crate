"""Reviewed exact Soulseek acquisition; no alternate peers, upgrades or paid providers."""

import hashlib
import json
import re
import time
import unicodedata
from urllib.parse import quote
from uuid import UUID

import requests

from crate.agent_access import actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.agent_library_operations import (
    _envelope,
    prepare_operation,
)
from crate.agent_library_operations import (
    apply_operation as _apply,
)
from crate.db.repositories import agent_acquisition as store

MAX_BYTES = 2147483648
MAX_FILES = 50
MAX_TIDAL_RESULTS = 50
MAX_TIDAL_DISCOVERY = 500


def _digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _identifier(value, *, path=False):
    if not isinstance(value, str) or not 1 <= len(value) <= (512 if path else 128):
        raise ValueError("Invalid provider identifier")
    if re.search(r'[\x00-\x1f\x7f?#%:<>"|*]', value):
        raise ValueError("Invalid provider identifier")
    parts = value.replace("\\", "/").split("/")
    if any(not p or p in {".", ".."} for p in parts) or (not path and len(parts) != 1):
        raise ValueError("Invalid provider identifier")
    return value


def _transport(method, endpoint, body=None):
    """Bounded body and generic failures; never log credential-bearing provider URLs."""
    from crate import soulseek

    started = time.monotonic()
    try:
        with requests.request(
            method,
            f"{soulseek._base_url().rstrip('/')}/api/v0/{endpoint}",
            headers={"X-API-Key": soulseek._api_key() or ""},
            json=body,
            timeout=(3, 10),
            stream=True,
            allow_redirects=False,
        ) as response:
            if (
                response.status_code == 409
                and method == "POST"
                and endpoint == "transfers/downloads/batches"
            ):
                return {"duplicate_batch": True}
            if (
                response.status_code == 404
                and method == "GET"
                and endpoint.startswith("transfers/downloads/")
                and endpoint.count("/") == 2
            ):
                return None
            response.raise_for_status()
            if response.status_code >= 300:
                raise ValueError("Redirect refused")
            data = bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data) > 1048576 or time.monotonic() - started > 15:
                    raise ValueError("Response too large")
            return json.loads(data) if data else {}
    except Exception:  # noqa: BLE001 — redact all credential-bearing transport errors.
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE",
            "Soulseek response unavailable or exceeds the bounded transport budget",
        ) from None


def _provider_version():
    from crate import soulseek

    return _digest({"url": soulseek._base_url(), "key": soulseek._api_key()})


def _supported_provider():
    application = _transport("GET", "application")
    version = (application.get("version") or {}).get("current")
    if version not in {"0.26.1", "0.26.1.0"}:
        raise DiagnosticError(
            "NOT_EXECUTABLE", "Only the reviewed slskd 0.26.1 batch API is executable"
        )
    server = application.get("server") or {}
    if not server.get("isConnected") or not server.get("isLoggedIn"):
        raise DiagnosticError(
            "NOT_EXECUTABLE", "Soulseek is not connected and logged in"
        )
    return version


def get_acquisition_readiness(principal, *, provider):
    if "library.acquisition.search" not in principal.grants:
        raise DiagnosticError("FORBIDDEN", "Acquisition search is not granted")
    store.authorize_search(principal)
    from crate import soulseek

    tidal_configured = False
    if provider == "tidal":
        from crate import tidal

        tidal_configured = bool(tidal.is_authenticated())
    executable = actions_enabled() and (
        (provider == "soulseek" and bool(soulseek._api_key()))
        or (provider == "tidal" and tidal_configured)
    )
    missing = None
    if executable and provider == "soulseek":
        try:
            _supported_provider()
        except DiagnosticError as error:
            executable, missing = False, str(error)
    return _envelope(
        {
            "provider": provider,
            "executable": executable,
            "reason": missing
            or (
                "bounded_missing_album_search_and_telegram_approved_import"
                if executable and provider == "tidal"
                else None
            )
            or (
                "exact_zero_cost_flac_only"
                if executable
                else "missing_configuration_or_actions_disabled"
                if provider == "soulseek"
                else "provider_has_no_trustworthy_bounded_selection_and_cost_contract"
            ),
            "live_connectivity": "not_configured"
            if provider == "tidal" and not tidal_configured
            else "not_probed"
            if provider == "tidal"
            else "connected"
            if executable
            else "unavailable",
            "destination": "one_approved_new_album_import"
            if provider == "tidal"
            else "staging_then_separately_approved_new_album",
            "max_files": MAX_FILES,
            "max_bytes": MAX_BYTES,
        }
    )


def _selections(search_id, raw):
    if not isinstance(raw, list):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Invalid search response")
    groups = {}
    for peer in raw[:50]:
        try:
            username = _identifier(peer["username"])
            for file in peer.get("files", [])[:500]:
                filename = _identifier(file["filename"], path=True)
                parts = filename.replace("\\", "/").split("/")
                if len(parts) < 3 or not filename.lower().endswith(".flac"):
                    continue
                if any(
                    type(file.get(k)) is not int or file[k] <= 0
                    for k in ("size", "bitDepth", "sampleRate")
                ):
                    continue
                key = (username, "/".join(parts[:-1]))
                groups.setdefault(key, []).append(
                    {
                        "filename": filename,
                        "size": file["size"],
                        "bitDepth": file["bitDepth"],
                        "sampleRate": file["sampleRate"],
                    }
                )
        except (KeyError, TypeError, ValueError):
            continue
    result = []
    provider_version = _provider_version()
    for (username, folder), files in groups.items():
        size = sum(f["size"] for f in files)
        names = [f["filename"].replace("\\", "/").split("/")[-1] for f in files]
        if (
            not 1 <= len(files) <= MAX_FILES
            or size > MAX_BYTES
            or len(set(names)) != len(names)
        ):
            continue
        result.append(
            {
                "provider": "soulseek",
                "search_id": search_id,
                "peer": username,
                "artist": folder.split("/")[-2],
                "release": folder.split("/")[-1],
                "files": sorted(files, key=lambda f: f["filename"]),
                "estimated_bytes": size,
                "cost_minor": 0,
                "cost_basis": "Soulseek transfer has no purchase charge",
                "quality": "FLAC; exact bit depth and sample rate per file",
                "provider_version": provider_version,
            }
        )
    return result


def search_acquisition(principal, *, provider, query, limit=5, trace_id=None):
    readiness = get_acquisition_readiness(principal, provider=provider)["data"]
    if not readiness["executable"]:
        raise DiagnosticError("NOT_EXECUTABLE", readiness["reason"])
    if (
        not isinstance(query, str)
        or not 2 <= len(query) <= 160
        or re.search(r"[\x00-\x1f\x7f]", query)
        or not 1 <= limit <= 5
    ):
        raise ValueError("Invalid acquisition search")
    response = _transport(
        "POST",
        "searches",
        {
            "searchText": query,
            "searchTimeout": 5000,
            "responseLimit": 50,
            "fileLimit": 500,
        },
    )
    try:
        search_id = str(UUID(response["id"]))
    except (ValueError, KeyError, TypeError):
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE", "Provider did not return a valid search ID"
        ) from None
    time.sleep(5)
    sources = _selections(
        search_id, _transport("GET", f"searches/{search_id}/responses")
    )[:limit]
    bounded = []
    for source in sources:
        if len(json.dumps(source, ensure_ascii=False).encode()) > 12000:
            continue
        if len(json.dumps(bounded + [source], ensure_ascii=False).encode()) > 45000:
            break
        bounded.append(source)
    receipts = store.save_receipts(principal, bounded)
    return _envelope(
        {
            "provider": provider,
            "results": receipts,
            "coverage": "bounded_partial",
            "selection": "human_required",
            "download_started": False,
        }
    )


def _normalized_release(value):
    decomposed = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in decomposed if char.isalnum())


def _tidal_album_source(artist, album, tidal_artist_id):
    tidal_id = str(album.get("id") or "")
    title = str(album.get("title") or "").strip()
    source_artist = str(album.get("artist") or "").strip()
    tracks = album.get("tracks")
    if (
        not re.fullmatch(r"[0-9]{1,24}", tidal_id)
        or not 1 <= len(title) <= 512
        or len(title.encode("utf-8")) > 512
        or _normalized_release(source_artist) != _normalized_release(artist["name"])
        or type(tracks) is not int
        or not 1 <= tracks <= 500
    ):
        return None
    quality = album.get("quality", [])
    if isinstance(quality, str):
        quality = [quality]
    return {
        "provider": "tidal",
        "tidal_artist_id": str(tidal_artist_id),
        "tidal_album_id": tidal_id,
        "artist_uid": str(artist["entity_uid"]),
        "artist": artist["name"],
        "title": title,
        "year": str(album.get("year") or "")[:4],
        "release_date": str(album.get("release_date") or "")[:10],
        "release_type": str(album.get("type") or "ALBUM")[:32],
        "catalog_offset": max(0, int(album.get("catalog_offset") or 0)),
        "tracks": tracks,
        "quality": sorted(
            item[:64] for item in quality[:8] if isinstance(item, str) and item
        ),
        # The URL is constructed from the bounded numeric Tidal ID, never caller input.
        "url": f"https://tidal.com/album/{tidal_id}",
    }


def search_tidal_missing_albums(principal, *, artist, limit=10, trace_id=None):
    """Search one unambiguous local artist's Tidal releases and mint exact receipts."""
    store.authorize_search(principal)
    if (
        not isinstance(artist, str)
        or not 2 <= len(artist.strip()) <= 160
        or re.search(r"[\x00-\x1f\x7f]", artist)
        or type(limit) is not int
        or not 1 <= limit <= MAX_TIDAL_RESULTS
    ):
        raise ValueError("Invalid bounded Tidal artist search")

    from crate.db.queries import agent_library
    from crate.db.queries.subsonic_artist_album_queries import (
        get_albums_by_artist_name,
    )

    evidence = agent_library.read_artist_evidence(name=artist.strip(), limit=20)
    artists = evidence.get("artists") or []
    if len(artists) != 1:
        return _envelope(
            {
                "resolution": "ambiguous" if artists else "not_found",
                "local_artists": [
                    {
                        "artist_uid": str(row["entity_uid"]),
                        "artist": row["name"],
                    }
                    for row in artists[:20]
                ],
                "results": [],
                "search_started": False,
            }
        )
    local_artist = dict(artists[0])

    from crate import tidal

    if not tidal.is_authenticated():
        raise DiagnosticError("NOT_EXECUTABLE", "Crate Tidal authentication is missing")
    artist_search = tidal.search(local_artist["name"], content_type="artists", limit=5)
    if artist_search.get("error"):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Tidal artist search failed")
    normalized_name = _normalized_release(local_artist["name"])
    matches = [
        row
        for row in artist_search.get("artists", [])
        if _normalized_release(row.get("name")) == normalized_name
        and re.fullmatch(r"[0-9]{1,24}", str(row.get("id") or ""))
    ]
    if len(matches) != 1:
        return _envelope(
            {
                "resolution": "ambiguous" if matches else "provider_artist_not_found",
                "local_artists": [
                    {
                        "artist_uid": str(local_artist["entity_uid"]),
                        "artist": local_artist["name"],
                    }
                ],
                "provider_artists": [
                    {
                        "tidal_artist_id": str(row["id"]),
                        "artist": row.get("name", ""),
                    }
                    for row in matches[:5]
                ],
                "results": [],
                "search_started": False,
            }
        )
    tidal_artist = matches[0]
    albums = tidal.get_artist_albums(str(tidal_artist["id"]), limit=MAX_TIDAL_RESULTS)
    if not albums:
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE", "Tidal discography is unavailable"
        )

    local_names = {
        _normalized_release(row.get("name"))
        for row in get_albums_by_artist_name(local_artist["name"])
    }
    sources = []
    seen_ids = set()
    for album in albums[:MAX_TIDAL_RESULTS]:
        source = _tidal_album_source(local_artist, album, tidal_artist["id"])
        if (
            source is None
            or source["tidal_album_id"] in seen_ids
            or _normalized_release(source["title"]) in local_names
        ):
            continue
        seen_ids.add(source["tidal_album_id"])
        sources.append(source)
    sources.sort(
        key=lambda row: (row["release_date"], row["year"], row["title"].casefold()),
        reverse=True,
    )
    receipts = store.save_receipts(principal, sources[:limit])
    return _envelope(
        {
            "resolution": "resolved",
            "artist_uid": str(local_artist["entity_uid"]),
            "artist": local_artist["name"],
            "provider": "tidal",
            "results": receipts,
            "coverage": "bounded_artist_discography_50",
            "selection": "human_required",
            "download_started": False,
        }
    )


def _resolve_local_tidal_artist(artist_name):
    from crate.db.queries import agent_library

    evidence = agent_library.read_artist_evidence(name=artist_name, limit=20)
    artists = evidence.get("artists") or []
    if len(artists) != 1:
        return None, {
            "resolution": "ambiguous" if artists else "not_found",
            "local_artists": [
                {"artist_uid": str(row["entity_uid"]), "artist": row["name"]}
                for row in artists[:20]
            ],
            "provider_artists": [],
        }
    local_artist = dict(artists[0])
    from crate import tidal

    if not tidal.is_authenticated():
        raise DiagnosticError("NOT_EXECUTABLE", "Crate Tidal authentication is missing")
    artist_search = tidal.search(local_artist["name"], content_type="artists", limit=5)
    if artist_search.get("error"):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Tidal artist search failed")
    normalized_name = _normalized_release(local_artist["name"])
    matches = [
        row
        for row in artist_search.get("artists", [])
        if _normalized_release(row.get("name")) == normalized_name
        and re.fullmatch(r"[0-9]{1,24}", str(row.get("id") or ""))
    ]
    if len(matches) != 1:
        return None, {
            "resolution": "ambiguous" if matches else "provider_artist_not_found",
            "local_artists": [
                {
                    "artist_uid": str(local_artist["entity_uid"]),
                    "artist": local_artist["name"],
                }
            ],
            "provider_artists": [
                {
                    "tidal_artist_id": str(row["id"]),
                    "artist": row.get("name", ""),
                }
                for row in matches[:5]
            ],
        }
    return (local_artist, matches[0]), []


def _tidal_discography(artist_id):
    """Read a bounded paginated catalog and report when its end was not observed."""
    from crate import tidal

    albums = []
    for offset in range(0, MAX_TIDAL_DISCOVERY + MAX_TIDAL_RESULTS, MAX_TIDAL_RESULTS):
        page = tidal.get_artist_albums(
            str(artist_id),
            limit=MAX_TIDAL_RESULTS,
            offset=offset,
            strict=True,
        )
        if page is None:
            raise DiagnosticError(
                "PROVIDER_UNAVAILABLE", "Tidal discography is unavailable"
            )
        if not page:
            return albums, True
        albums.extend(page)
        if len(albums) > MAX_TIDAL_DISCOVERY:
            return albums, False
        if len(page) < MAX_TIDAL_RESULTS:
            return albums, True
    return albums, False


def search_tidal_missing_artist(principal, *, artist, trace_id=None):
    """Mint one exact receipt for the complete, bounded missing Tidal discography."""
    store.authorize_search(principal)
    if (
        not isinstance(artist, str)
        or not 2 <= len(artist.strip()) <= 160
        or re.search(r"[\x00-\x1f\x7f]", artist)
    ):
        raise ValueError("Invalid bounded Tidal artist search")
    resolved, ambiguous = _resolve_local_tidal_artist(artist.strip())
    if resolved is None:
        return _envelope(
            {
                **ambiguous,
                "releases": [],
                "search_started": False,
                "download_started": False,
            }
        )
    local_artist, tidal_artist = resolved
    albums, complete = _tidal_discography(tidal_artist["id"])
    if not complete:
        return _envelope(
            {
                "resolution": "catalog_limit_exceeded",
                "artist_uid": str(local_artist["entity_uid"]),
                "artist": local_artist["name"],
                "coverage": "incomplete_over_500_releases",
                "catalog_entries_seen": len(albums),
                "download_started": False,
                "receipt_created": False,
            }
        )
    from crate.db.queries.subsonic_artist_album_queries import (
        get_albums_by_artist_name,
    )

    local_names = {
        _normalized_release(row.get("name"))
        for row in get_albums_by_artist_name(local_artist["name"])
    }
    sources = []
    seen_ids = set()
    omitted = 0
    for album in albums:
        source = _tidal_album_source(local_artist, album, tidal_artist["id"])
        if source is None:
            omitted += 1
            continue
        if source["tidal_album_id"] in seen_ids:
            continue
        seen_ids.add(source["tidal_album_id"])
        if _normalized_release(source["title"]) not in local_names:
            sources.append(source)
    if omitted:
        return _envelope(
            {
                "resolution": "catalog_contains_unimportable_releases",
                "artist_uid": str(local_artist["entity_uid"]),
                "artist": local_artist["name"],
                "coverage": "incomplete_unrepresentable_entries",
                "catalog_entries_seen": len(albums),
                "unimportable_entries": omitted,
                "download_started": False,
                "receipt_created": False,
            }
        )
    sources.sort(
        key=lambda row: (row["release_date"], row["year"], row["title"].casefold()),
        reverse=True,
    )
    if len(sources) > MAX_TIDAL_RESULTS:
        return _envelope(
            {
                "resolution": "missing_release_limit_exceeded",
                "artist_uid": str(local_artist["entity_uid"]),
                "artist": local_artist["name"],
                "coverage": "complete_catalog_more_than_50_missing",
                "missing_count": len(sources),
                "max_releases_per_approval": MAX_TIDAL_RESULTS,
                "download_started": False,
                "receipt_created": False,
            }
        )
    if not sources:
        return _envelope(
            {
                "resolution": "already_complete",
                "artist_uid": str(local_artist["entity_uid"]),
                "artist": local_artist["name"],
                "coverage": "complete",
                "catalog_entries_seen": len(albums),
                "missing_count": 0,
                "releases": [],
                "download_started": False,
            }
        )
    batch = {
        "provider": "tidal_artist_batch",
        "tidal_artist_id": str(tidal_artist["id"]),
        "artist_uid": str(local_artist["entity_uid"]),
        "artist": local_artist["name"],
        "catalog_entries_seen": len(albums),
        "releases": sources,
    }
    receipt = store.save_receipts(principal, [batch])[0]
    return _envelope(
        {
            "resolution": "resolved",
            "artist_uid": str(local_artist["entity_uid"]),
            "artist": local_artist["name"],
            "coverage": "complete",
            "catalog_entries_seen": len(albums),
            "missing_count": len(sources),
            "receipt_id": receipt["receipt_id"],
            "releases": [
                {
                    "tidal_album_id": row["tidal_album_id"],
                    "title": row["title"],
                    "year": row["year"],
                    "release_date": row["release_date"],
                    "release_type": row["release_type"],
                    "tracks": row["tracks"],
                }
                for row in sources
            ],
            "selection": "human_required",
            "download_started": False,
        }
    )


def preview_tidal_acquisition(
    principal, *, receipt_id, quality="max", idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "tidal_acquisition",
        {"receipt_id": receipt_id, "quality": quality},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_tidal_acquisition(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "tidal_acquisition",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def preview_tidal_artist_acquisition(
    principal, *, receipt_id, quality="max", idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "tidal_artist_acquisition",
        {"receipt_id": receipt_id, "quality": quality},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_tidal_artist_acquisition(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "tidal_artist_acquisition",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def _validate_tidal_source(source):
    from crate import tidal

    if not tidal.is_authenticated():
        raise DiagnosticError("NOT_EXECUTABLE", "Crate Tidal authentication is missing")
    artist_search = tidal.search(source["artist"], content_type="artists", limit=5)
    if artist_search.get("error"):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Tidal artist validation failed")
    matches = [
        row
        for row in artist_search.get("artists", [])
        if str(row.get("id") or "") == source["tidal_artist_id"]
        and _normalized_release(row.get("name"))
        == _normalized_release(source["artist"])
    ]
    if len(matches) != 1:
        raise DiagnosticError("EVIDENCE_STALE", "Exact Tidal artist identity changed")
    offset = (
        int(source.get("catalog_offset") or 0) // MAX_TIDAL_RESULTS
    ) * MAX_TIDAL_RESULTS
    albums = tidal.get_artist_albums(
        source["tidal_artist_id"], limit=MAX_TIDAL_RESULTS, offset=offset
    )
    current = [
        _tidal_album_source(
            {"entity_uid": source["artist_uid"], "name": source["artist"]},
            album,
            source["tidal_artist_id"],
        )
        for album in (albums or [])
        if str(album.get("id") or "") == source["tidal_album_id"]
    ]
    if len(current) != 1 or current[0] != source:
        raise DiagnosticError("EVIDENCE_STALE", "Exact Tidal album evidence changed")


def _validate_tidal_artist_batch(source):
    if (
        not isinstance(source, dict)
        or source.get("provider") != "tidal_artist_batch"
        or not 1 <= len(source.get("releases", [])) <= MAX_TIDAL_RESULTS
    ):
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Receipt is not a bounded Tidal artist batch"
        )
    from crate import tidal

    if not tidal.is_authenticated():
        raise DiagnosticError("NOT_EXECUTABLE", "Crate Tidal authentication is missing")
    artist_search = tidal.search(source["artist"], content_type="artists", limit=5)
    if artist_search.get("error"):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Tidal artist validation failed")
    exact_artists = [
        row
        for row in artist_search.get("artists", [])
        if str(row.get("id") or "") == source["tidal_artist_id"]
        and _normalized_release(row.get("name"))
        == _normalized_release(source["artist"])
    ]
    if len(exact_artists) != 1:
        raise DiagnosticError("EVIDENCE_STALE", "Exact Tidal artist identity changed")
    albums, complete = _tidal_discography(source["tidal_artist_id"])
    if not complete:
        raise DiagnosticError(
            "EVIDENCE_STALE", "Tidal discography is no longer fully observable"
        )
    current = []
    ineligible_entries = 0
    for album in albums:
        item = _tidal_album_source(
            {"entity_uid": source["artist_uid"], "name": source["artist"]},
            album,
            source["tidal_artist_id"],
        )
        if item is not None:
            current.append(item)
        else:
            ineligible_entries += 1
    if ineligible_entries or len(albums) != source.get("catalog_entries_seen"):
        raise DiagnosticError("EVIDENCE_STALE", "Tidal catalog coverage changed")
    if len({item["tidal_album_id"] for item in current}) != len(current):
        current = list({item["tidal_album_id"]: item for item in current}.values())
    from crate.db.queries.subsonic_artist_album_queries import (
        get_albums_by_artist_name,
    )

    local_names = {
        _normalized_release(row.get("name"))
        for row in get_albums_by_artist_name(source["artist"])
    }
    missing = [
        item
        for item in current
        if _normalized_release(item["title"]) not in local_names
    ]
    missing.sort(
        key=lambda row: (row["release_date"], row["year"], row["title"].casefold()),
        reverse=True,
    )
    if missing != source["releases"]:
        raise DiagnosticError("EVIDENCE_STALE", "Tidal missing-release set changed")


def _local_album_present(artist_name, title):
    from crate.db.queries.subsonic_artist_album_queries import (
        get_albums_by_artist_name,
    )

    wanted = _normalized_release(title)
    return any(
        _normalized_release(row.get("name")) == wanted
        for row in get_albums_by_artist_name(artist_name)
    )


def preview_acquisition(principal, *, idempotency_key, trace_id=None, **parameters):
    return prepare_operation(
        principal, "acquisition", parameters, idempotency_key, trace_id=trace_id
    )


def apply_acquisition(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "acquisition",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def _validate_source(source):
    _supported_provider()
    if source["provider_version"] != _provider_version():
        raise DiagnosticError("EVIDENCE_STALE", "Provider configuration changed")
    matches = _selections(
        source["search_id"],
        _transport("GET", f"searches/{source['search_id']}/responses"),
    )
    if source not in matches:
        raise DiagnosticError(
            "EVIDENCE_STALE", "Exact peer, files, quality or byte selection changed"
        )


def compile_operation(operation, parameters, config, *, principal, task_id=None):
    if operation == "acquisition_publish":
        from crate.agent_acquisition_publish import compile_publication

        return compile_publication(
            parameters, config, principal=principal, task_id=task_id
        )
    if operation == "tidal_acquisition":
        if set(parameters) != {"receipt_id", "quality"} or parameters[
            "quality"
        ] not in {
            "max",
            "high",
            "normal",
        }:
            raise ValueError("Invalid Tidal acquisition parameters")
        receipt = store.read_receipt(principal, parameters["receipt_id"])
        source = receipt["source"]
        if source.get("provider") != "tidal":
            raise DiagnosticError("SOURCE_CONFLICT", "Receipt is not a Tidal release")
        _validate_tidal_source(source)
        target = store.target_state(source["artist_uid"], source["title"])
        if target["name"] != source["artist"] or _local_album_present(
            source["artist"], source["title"]
        ):
            raise DiagnosticError("ALREADY_EXISTS", "Release is already in Crate")
        return {
            "document": {
                "operation": operation,
                "risk": "high",
                "targets": [
                    {"entity_type": "artist", "entity_uid": source["artist_uid"]}
                ],
                "changes": [
                    {
                        "provider": "tidal",
                        "tidal_album_id": source["tidal_album_id"],
                        "artist": source["artist"],
                        "album": source["title"],
                        "year": source["year"],
                        "release_date": source["release_date"],
                        "tracks": source["tracks"],
                        "quality": parameters["quality"],
                        "quality_fallback": "normal only if Crate detects incomplete or unrecoverable lossless output",
                        "destination": "new album only; no overwrite or upgrade",
                    }
                ],
                "impact": {
                    "scope": "one_exact_album",
                    "download_and_library_import": "single_approved_operation",
                },
                "preconditions": {
                    "source_hash": _digest(source),
                    "source_valid_until": receipt["expires_at"].isoformat(),
                    "target": target,
                },
                "verification": {
                    "status": "exact_release_downloaded_imported_and_indexed"
                },
            },
            "execution": {
                "receipt_id": parameters["receipt_id"],
                "source": source,
                "target": target,
                "quality": parameters["quality"],
            },
        }
    if operation == "tidal_artist_acquisition":
        if set(parameters) != {"receipt_id", "quality"} or parameters[
            "quality"
        ] not in {
            "max",
            "high",
            "normal",
        }:
            raise ValueError("Invalid Tidal artist acquisition parameters")
        receipt = store.read_receipt(principal, parameters["receipt_id"])
        source = receipt["source"]
        _validate_tidal_artist_batch(source)
        target = store.target_state(
            source["artist_uid"], source["releases"][0]["title"]
        )
        if target["name"] != source["artist"]:
            raise DiagnosticError("SOURCE_CONFLICT", "Local artist identity changed")
        for release in source["releases"]:
            store.target_state(source["artist_uid"], release["title"])
            if _local_album_present(source["artist"], release["title"]):
                raise DiagnosticError(
                    "ALREADY_EXISTS", "A Tidal release is already present in Crate"
                )
        return {
            "document": {
                "operation": operation,
                "risk": "high",
                "targets": [
                    {"entity_type": "artist", "entity_uid": source["artist_uid"]}
                ],
                "changes": [
                    {
                        "provider": "tidal",
                        "tidal_artist_id": source["tidal_artist_id"],
                        "artist": source["artist"],
                        "release_count": len(source["releases"]),
                        "releases": [
                            {
                                "tidal_album_id": item["tidal_album_id"],
                                "album": item["title"],
                                "year": item["year"],
                                "release_date": item["release_date"],
                                "release_type": item["release_type"],
                                "tracks": item["tracks"],
                                "quality": parameters["quality"],
                            }
                            for item in source["releases"]
                        ],
                        "quality_fallback": "normal only if Crate detects incomplete or unrecoverable lossless output",
                        "destination": "new albums only; no overwrite or upgrade",
                    }
                ],
                "impact": {
                    "scope": "complete_missing_tidal_discography",
                    "catalog_entries_seen": source["catalog_entries_seen"],
                    "download_and_library_import": "single_approved_operation",
                },
                "preconditions": {
                    "source_hash": _digest(source),
                    "source_valid_until": receipt["expires_at"].isoformat(),
                    "target": target,
                    "all_releases_absent": True,
                },
                "verification": {
                    "status": "all_approved_releases_downloaded_imported_and_indexed"
                },
            },
            "execution": {
                "receipt_id": parameters["receipt_id"],
                "source": source,
                "target": target,
                "quality": parameters["quality"],
            },
        }
    if operation != "acquisition" or set(parameters) != {
        "receipt_id",
        "artist_uid",
        "max_items",
        "max_bytes",
        "max_cost_minor",
        "destination_policy",
    }:
        raise ValueError("Invalid acquisition parameters")
    receipt = store.read_receipt(principal, parameters["receipt_id"])
    source = receipt["source"]
    if (
        parameters["destination_policy"] != "provider_staging_only"
        or type(parameters["max_cost_minor"]) is not int
        or parameters["max_cost_minor"] != 0
        or type(parameters["max_items"]) is not int
        or not len(source["files"]) <= parameters["max_items"] <= MAX_FILES
        or type(parameters["max_bytes"]) is not int
        or not source["estimated_bytes"] <= parameters["max_bytes"] <= MAX_BYTES
    ):
        raise DiagnosticError(
            "LIMIT_EXCEEDED",
            "Exact selection cannot satisfy approved item, byte or zero-cost caps",
        )
    target = store.target_state(parameters["artist_uid"], source["release"])
    if target["name"].casefold() != source["artist"].casefold():
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Provider artist does not match the exact local artist"
        )
    _validate_source(source)
    from crate.agent_acquisition_publish import staging_root

    root = staging_root(config)
    execution = {
        "download_root": str(root),
        **parameters,
        "source": source,
        "target": target,
        "batch_id": parameters["receipt_id"],
        "staging_relative": "crate-agent/" + parameters["receipt_id"],
    }
    return {
        "document": {
            "operation": operation,
            "risk": "high",
            "targets": [
                {"entity_type": "artist", "entity_uid": parameters["artist_uid"]}
            ],
            "changes": [
                {
                    "selection": source,
                    "caps": parameters,
                    "batch_id": execution["batch_id"],
                    "staging_relative": execution["staging_relative"],
                }
            ],
            "impact": {
                "scope": "selected",
                "library_publication": "requires_separate_approved_plan",
            },
            "preconditions": {
                "source_hash": _digest(source),
                "source_valid_until": receipt["expires_at"].isoformat(),
                "target": target,
            },
            "verification": {
                "status": "exact_transfer_and_staged_audio_then_library_pending"
            },
        },
        "execution": execution,
    }


def _downloads(peer):
    raw = _transport("GET", "transfers/downloads/" + quote(_identifier(peer), safe=""))
    if raw is None:
        return []
    if (
        not isinstance(raw, dict)
        or raw.get("username") != peer
        or not isinstance(raw.get("directories"), list)
    ):
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE", "Selected peer transfer state unavailable"
        )
    return [
        {**file, "username": peer}
        for directory in raw["directories"]
        for file in directory.get("files", [])
    ]


def apply_operation(operation, execution, config, *, task_id, authorize):
    if operation == "acquisition_publish":
        from crate.agent_acquisition_publish import apply_publication

        return apply_publication(
            execution, config, task_id=task_id, authorize=authorize
        )
    if operation == "tidal_acquisition":
        source = execution["source"]
        authorize()
        receipt = store.execution_receipt(task_id, execution["receipt_id"])
        if receipt["source"] != source:
            raise DiagnosticError("EVIDENCE_STALE", "Persisted Tidal receipt changed")
        _validate_tidal_source(source)
        current_target = store.target_state(source["artist_uid"], source["title"])
        if current_target != execution["target"] or _local_album_present(
            source["artist"], source["title"]
        ):
            raise DiagnosticError("EVIDENCE_STALE", "Release is no longer absent")
        # Persist the fact that this exact approval crossed its effect boundary. The
        # download itself is long-running, so authority is rechecked at checkpoints.
        authorize(lambda: None)
        from crate.worker_handlers.acquisition import _handle_tidal_download

        result = _handle_tidal_download(
            task_id,
            {
                "url": source["url"],
                "quality": execution["quality"],
                "artist": source["artist"],
                "album": source["title"],
                "entity_type": "album",
                "agent_tidal_selection": source,
            },
            config,
            authorize=authorize,
        )
        if not result.get("success"):
            raise DiagnosticError(
                "RECONCILIATION_REQUIRED",
                "Tidal import did not complete; inspect the operation result before retrying",
            )
        if not _local_album_present(source["artist"], source["title"]):
            raise DiagnosticError(
                "RECONCILIATION_REQUIRED",
                "Files may have moved but the exact album is not indexed yet",
            )
        return {
            "execution": {
                "status": "completed",
                "items": [
                    {
                        "provider": "tidal",
                        "artist_uid": source["artist_uid"],
                        "status": "imported",
                        "tracks": source["tracks"],
                    }
                ],
                "quality": result.get("quality", execution["quality"]),
            },
            "verification": {"status": "passed"},
            "projection": {"status": "library_sync_completed"},
        }
    if operation == "tidal_artist_acquisition":
        source = execution["source"]
        receipt = store.execution_receipt(task_id, execution["receipt_id"])
        if receipt["source"] != source:
            raise DiagnosticError("EVIDENCE_STALE", "Persisted Tidal receipt changed")
        _validate_tidal_artist_batch(source)
        current_target = store.target_state(
            source["artist_uid"], source["releases"][0]["title"]
        )
        if current_target != execution["target"]:
            raise DiagnosticError("EVIDENCE_STALE", "Local artist target changed")
        for release in source["releases"]:
            store.target_state(source["artist_uid"], release["title"])
            if _local_album_present(source["artist"], release["title"]):
                raise DiagnosticError(
                    "EVIDENCE_STALE", "An approved release is no longer absent"
                )
        # One durable effect boundary covers this exact release list and cannot replay.
        authorize(lambda: None)
        from crate.worker_handlers.acquisition import _handle_tidal_download

        completed = []
        failed = None
        for index, release in enumerate(source["releases"], start=1):
            try:
                authorize()
                _validate_tidal_source(release)
                if _local_album_present(source["artist"], release["title"]):
                    raise DiagnosticError(
                        "ALREADY_EXISTS", "An approved release is already present"
                    )
                result = _handle_tidal_download(
                    task_id,
                    {
                        "url": release["url"],
                        "quality": execution["quality"],
                        "artist": release["artist"],
                        "album": release["title"],
                        "entity_type": "album",
                        "agent_tidal_selection": release,
                        "agent_tidal_defer_scan": True,
                        "agent_tidal_processing_id": f"{task_id}_release_{index:02d}",
                    },
                    config,
                    authorize=authorize,
                )
                if not result.get("success") or not _local_album_present(
                    source["artist"], release["title"]
                ):
                    raise DiagnosticError(
                        "RECONCILIATION_REQUIRED",
                        "A Tidal release did not verify after import",
                    )
                completed.append(
                    {
                        "tidal_album_id": release["tidal_album_id"],
                        "album": release["title"],
                        "status": "verified",
                    }
                )
            except Exception as error:
                if not completed:
                    if isinstance(error, DiagnosticError):
                        raise
                    raise DiagnosticError(
                        "RECONCILIATION_REQUIRED",
                        "The first Tidal release could not be verified; inspect the job before retrying",
                    ) from error
                failed = {
                    "tidal_album_id": release["tidal_album_id"],
                    "album": release["title"],
                    "error_code": error.code
                    if isinstance(error, DiagnosticError)
                    else "RECONCILIATION_REQUIRED",
                }
                break
        if completed:
            from crate.worker_handlers import start_scan

            try:
                authorize(start_scan)
            except DiagnosticError:
                failed = failed or {
                    "album": "library_scan",
                    "error_code": "RECONCILIATION_REQUIRED",
                    "status": "failed",
                }
        success = len(completed) == len(source["releases"]) and failed is None
        items = list(completed)
        if failed:
            items.append({**failed, "status": "failed"})
        return {
            "execution": {
                "status": "verified" if success else "partial",
                "items": items,
                "completed_count": len(completed),
                "requested_count": len(source["releases"]),
            },
            "verification": {
                "status": "all_releases_indexed"
                if success
                else "partial_artist_discography_requires_reconciliation"
            },
            "projection": {"status": "library_pending"},
        }
    from crate.agent_acquisition_publish import (
        _safe_path,
        staged_manifest,
        staging_root,
    )
    from crate.worker_handlers import is_cancelled

    if str(staging_root(config)) != execution["download_root"]:
        raise DiagnosticError("EVIDENCE_STALE", "Provider staging root changed")

    source = execution["source"]
    authorize()
    receipt = store.execution_receipt(task_id, execution["receipt_id"])
    if receipt["source"] != source:
        raise DiagnosticError("EVIDENCE_STALE", "Persisted source selection changed")
    _validate_source(source)
    if (
        store.target_state(execution["artist_uid"], source["release"])
        != execution["target"]
    ):
        raise DiagnosticError("EVIDENCE_STALE", "Target library identity changed")
    names = {f["filename"] for f in source["files"]}
    prior = _downloads(source["peer"])
    if any(f.get("filename") in names for f in prior):
        raise DiagnosticError(
            "RECONCILIATION_REQUIRED",
            "Selected paths already have provider transfer state",
        )
    selection_hash = _digest(
        {
            "provider": "soulseek",
            "peer": source["peer"],
            "files": source["files"],
        }
    )
    # Durable separate commit before an external send; failed/uncertain sends never replay.
    store.reserve_transfer(task_id, execution["receipt_id"], selection_hash, execution)
    staging = _safe_path(staging_root(config), execution["staging_relative"])
    if staging.exists() or staging.is_symlink():
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Owned staging destination already exists"
        )
    response = authorize(
        lambda: _transport(
            "POST",
            "transfers/downloads/batches",
            {
                "id": execution["batch_id"],
                "searchId": source["search_id"],
                "username": source["peer"],
                "files": [
                    {"filename": f["filename"], "size": f["size"]}
                    for f in source["files"]
                ],
                "options": {"destination": execution["staging_relative"]},
            },
        )
    )
    status, rows = "pending", []
    enqueue_failed = bool(response.get("failures"))
    for _ in range(24):
        if is_cancelled(task_id):
            status = "cancelled"
            break
        authorize()
        status, rows = _batch_state(execution)
        if enqueue_failed:
            status = "conflict"
        if status != "pending":
            break
        time.sleep(5)
    evidence = {
        "download_root": execution["download_root"],
        "batch_id": execution["batch_id"],
        "staging_relative": execution["staging_relative"],
        "source": source,
        "target": execution["target"],
        "caps": {k: execution[k] for k in ("max_items", "max_bytes", "max_cost_minor")},
        "remote_state": status,
        "transfers": [
            {k: f.get(k) for k in ("filename", "size", "bytesTransferred", "state")}
            for f in rows
        ],
    }
    if status == "staged":
        try:
            evidence["manifest"] = staged_manifest(
                source, config, execution["staging_relative"], check=authorize
            )
        except (DiagnosticError, ValueError, OSError):
            status = "verification_conflict"
    store.record_transfer(task_id, status, evidence)
    return {
        "execution": {
            "status": "completed" if status == "staged" else "partial",
            "items": [{"task_id": task_id, "provider": "soulseek", "status": status}],
            "remote_transfers_may_continue": status != "staged",
            "publication": "not_started",
        },
        "verification": {
            "status": "passed"
            if status == "staged"
            else "manual_reconciliation_required"
        },
        "projection": {"status": "library_pending_separate_approval"},
    }


def _batch_state(execution):
    source = execution["source"]
    batch = _transport("GET", f"transfers/downloads/batches/{execution['batch_id']}")
    rows = batch.get("transfers", [])
    expected = {f["filename"]: f["size"] for f in source["files"]}
    if (
        batch.get("id") != execution["batch_id"]
        or batch.get("username") != source["peer"]
        or batch.get("searchId") != source["search_id"]
        or (batch.get("options") or {}).get("destination")
        != execution["staging_relative"]
        or len(rows) != len({f.get("filename") for f in rows})
        or any(
            f.get("filename") not in expected
            or f.get("username") != source["peer"]
            or f.get("batchId") != execution["batch_id"]
            or f.get("size") != expected[f["filename"]]
            or f.get("bytesTransferred", 0) > expected[f["filename"]]
            for f in rows
        )
    ):
        return "conflict", []
    if any(
        any(s in f.get("state", "") for s in ("Errored", "Rejected", "Cancelled"))
        for f in rows
    ):
        return "conflict", rows
    if len(rows) == len(expected) and all(
        f.get("state") == "Completed, Succeeded"
        and f.get("bytesTransferred") == expected[f["filename"]]
        for f in rows
    ):
        return "staged", rows
    return "pending", rows


def reconcile_transfer(source_job_id, evidence, config, *, check=None):
    """Observe the original batch only. No re-enqueue, peer substitution or resume."""
    from crate.agent_acquisition_publish import staged_manifest, staging_root

    if str(staging_root(config)) != evidence["download_root"]:
        raise DiagnosticError("EVIDENCE_STALE", "Provider staging root changed")
    if evidence["source"]["provider_version"] != _provider_version():
        raise DiagnosticError(
            "EVIDENCE_STALE", "Provider changed since original transfer"
        )
    status, rows = _batch_state(evidence)
    if status != "staged":
        raise DiagnosticError(
            "RECONCILIATION_REQUIRED",
            "Original exact batch has not completed successfully",
        )
    manifest = staged_manifest(
        evidence["source"], config, evidence["staging_relative"], check=check
    )
    result = {
        **evidence,
        "manifest": manifest,
        "remote_state": "staged",
        "transfers": [
            {k: f.get(k) for k in ("filename", "size", "bytesTransferred", "state")}
            for f in rows
        ],
    }
    store.record_transfer(source_job_id, "staged", result)
    return result


def preview_acquisition_publication(
    principal, *, source_job_id, idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "acquisition_publish",
        {"source_job_id": source_job_id},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_acquisition_publication(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "acquisition_publish",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


__all__ = [
    "apply_acquisition",
    "apply_acquisition_publication",
    "apply_operation",
    "compile_operation",
    "get_acquisition_readiness",
    "apply_tidal_acquisition",
    "apply_tidal_artist_acquisition",
    "preview_acquisition",
    "preview_acquisition_publication",
    "preview_tidal_acquisition",
    "preview_tidal_artist_acquisition",
    "reconcile_transfer",
    "search_acquisition",
    "search_tidal_missing_albums",
    "search_tidal_missing_artist",
]
