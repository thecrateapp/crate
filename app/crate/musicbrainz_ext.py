import logging

import musicbrainzngs

from crate.db.cache_store import get_cache, set_cache

log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("crate", "1.0", "https://github.com/thecrateapp/crate")


def _search_mbid(name: str) -> str | None:
    from thefuzz import fuzz

    try:
        result = musicbrainzngs.search_artists(artist=name, limit=5)
        artists = result.get("artist-list", [])
        # Find best match by name similarity (avoid Black Curse -> Black Sabbath)
        for a in artists:
            mb_name = a.get("name", "")
            if fuzz.ratio(name.lower(), mb_name.lower()) >= 80:
                return a["id"]
    except Exception:
        log.debug("MB artist search failed for %s", name)
    return None


def get_artist_details(name: str) -> dict | None:
    cache_key = f"mb:detail:{name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached

    mbid = _search_mbid(name)
    if not mbid:
        return None

    try:
        artist = musicbrainzngs.get_artist_by_id(
            mbid, includes=["url-rels", "artist-rels"]
        )["artist"]
    except Exception:
        log.debug("MB artist details failed for %s", name)
        return None

    life_span = artist.get("life-span", {})

    members = []
    for rel in artist.get("artist-relation-list", []):
        if rel.get("type") in ("member of band", "is person"):
            member = {
                "name": rel.get("artist", {}).get("name", ""),
                "type": rel.get("type", ""),
                "begin": rel.get("begin", ""),
                "end": rel.get("end", ""),
                "attributes": rel.get("attribute-list", []),
            }
            members.append(member)

    urls: dict[str, str] = {}
    url_type_map = {
        "wikipedia": "wikipedia",
        "official homepage": "official",
        "wikidata": "wikidata",
        "allmusic": "allmusic",
        "discogs": "discogs",
        "BBC Music page": "bbc",
        "streaming music": "spotify",
    }
    for rel in artist.get("url-relation-list", []):
        rel_type = rel.get("type", "")
        url = rel.get("target", "")
        mapped = url_type_map.get(rel_type)
        if mapped:
            urls[mapped] = url
        elif "spotify" in url:
            urls["spotify"] = url

    result = {
        "mbid": mbid,
        "type": artist.get("type", ""),
        "begin_date": life_span.get("begin", ""),
        "end_date": life_span.get("end", ""),
        "country": artist.get("country", ""),
        "area": artist.get("area", {}).get("name", ""),
        "disambiguation": artist.get("disambiguation", ""),
        "members": members,
        "urls": urls,
    }

    set_cache(cache_key, result)
    return result


def get_artist_releases(mbid: str) -> list[dict]:
    """Get all release groups (albums, EPs, singles) for an artist by MBID.
    Returns list sorted by date descending."""
    cache_key = f"mb:releases:{mbid}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    try:
        all_releases = []
        offset = 0
        max_pages = 5  # safety limit
        page = 0
        while page < max_pages:
            page += 1
            try:
                result = musicbrainzngs.browse_release_groups(
                    artist=mbid,
                    release_type=["album", "ep"],
                    limit=100,
                    offset=offset,
                )
            except musicbrainzngs.ResponseError:
                log.debug("MB 404/error for MBID %s, skipping", mbid)
                set_cache(cache_key, [], ttl=86400)  # cache empty for 24h
                return []
            groups = result.get("release-group-list", [])
            if not groups:
                break
            for rg in groups:
                title = rg.get("title", "")
                rg_type = rg.get("primary-type", "Album")
                first_release = rg.get("first-release-date", "")
                year = first_release[:4] if first_release else ""
                all_releases.append(
                    {
                        "title": title,
                        "year": year,
                        "type": rg_type,
                        "mbid": rg.get("id", ""),
                        "first_release_date": first_release,
                    }
                )
            offset += len(groups)
            if offset >= int(result.get("release-group-count", 0)):
                break

        all_releases.sort(key=lambda r: r.get("first_release_date", ""), reverse=True)
        set_cache(cache_key, all_releases, ttl=86400)  # 24h
        return all_releases
    except Exception:
        log.debug("MB releases failed for %s", mbid, exc_info=True)
        return []


def get_release_group_tracklist(release_group_mbid: str) -> list[dict]:
    """Return the best known tracklist for a MusicBrainz release group."""
    mbid = (release_group_mbid or "").strip()
    if not mbid:
        return []

    cache_key = f"mb:release-group-tracks:{mbid}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    try:
        result = musicbrainzngs.browse_releases(
            release_group=mbid,
            includes=["recordings"],
            limit=10,
        )
    except Exception:
        log.debug("MB release-group tracklist failed for %s", mbid, exc_info=True)
        return []

    releases = result.get("release-list", [])
    releases.sort(key=_release_tracklist_preference)
    for release in releases:
        tracks = _extract_release_tracks(release)
        if tracks:
            set_cache(cache_key, tracks, ttl=86400)
            return tracks

    set_cache(cache_key, [], ttl=86400)
    return []


def _release_tracklist_preference(release: dict) -> tuple[int, int, str]:
    country = str(release.get("country") or "")
    country_rank = 0 if country in {"XW", "US", "GB"} else 1
    track_count = 0
    for medium in release.get("medium-list") or []:
        track_count += len(medium.get("track-list") or [])
    return (country_rank, -track_count, str(release.get("date") or "9999-12-31"))


def _extract_release_tracks(release: dict) -> list[dict]:
    tracks: list[dict] = []
    for medium in release.get("medium-list") or []:
        for track in medium.get("track-list") or []:
            recording = track.get("recording") or {}
            title = recording.get("title") or track.get("title") or ""
            if not title:
                continue
            position = len(tracks) + 1
            try:
                position = int(track.get("position") or track.get("number") or position)
            except (TypeError, ValueError):
                pass
            length = track.get("track_or_recording_length") or track.get("length")
            duration = None
            try:
                duration = round(int(length) / 1000) if length else None
            except (TypeError, ValueError):
                duration = None
            tracks.append(
                {
                    "position": position,
                    "title": title,
                    "duration": duration,
                    "recording_mbid": recording.get("id", ""),
                }
            )
    return tracks
