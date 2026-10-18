"""Conservative canonical identity; all event writers serialize and recheck here."""

import hashlib
import json
from difflib import SequenceMatcher

from sqlalchemy import text

from crate.db.repositories.show_invalidation import invalidate_show_views
from crate.db.repositories.show_consolidation import consolidate_shows
from crate.db.tx import optional_scope, read_scope

_FIELDS = (
    "artist_name",
    "date",
    "local_time",
    "doors_time",
    "timezone",
    "venue",
    "city",
    "region",
    "country",
    "country_code",
    "address_line1",
    "postal_code",
    "latitude",
    "longitude",
    "url",
    "tickets_url",
    "image_url",
    "lineup",
    "price_range",
    "status",
)


def normalize(value):
    return " ".join(str(value or "").lower().split())


def identity_base(candidate):
    return (
        normalize(candidate.get("artist_name")) + "|" + str(candidate.get("date") or "")
    )


def _artist_names(candidate):
    return {
        normalized
        for name in [candidate.get("artist_name"), *(candidate.get("lineup") or [])]
        if (normalized := normalize(name))
    }


def identity_key(candidate):
    if not all(candidate.get(key) for key in ("artist_name", "date", "venue", "city")):
        return None
    values = [
        normalize(candidate.get(key))
        for key in ("artist_name", "date", "venue", "city", "local_time")
    ]
    values[-1] = values[-1][:5]
    values.append(normalize(candidate.get("country_code") or candidate.get("country")))
    return hashlib.sha256("\x1f".join(values).encode()).hexdigest()


def _source_alias(candidate, source):
    """A provider reference identifies a show; it does not change its editor."""
    if source.get("event_id"):
        alias = {"provider": source["provider"], "event_id": source["event_id"]}
    elif candidate.get("source_event_id"):
        alias = {
            "provider": candidate["source_provider"],
            "event_id": candidate["source_event_id"],
        }
    else:
        return None
    alias["event_id"] = _legacy_id(alias)
    return alias


def _alias_variants(alias):
    event_id, provider = alias["event_id"], alias["provider"]
    # Older Last.fm rows may have only the bare lastfm_event_id alias.
    return (
        [event_id, event_id.removeprefix(provider + ":")]
        if provider != "ticketmaster"
        else [event_id]
    )


def _legacy_id(alias):
    provider, event_id = alias["provider"], alias["event_id"]
    return (
        event_id
        if provider == "ticketmaster" or event_id.startswith(provider + ":")
        else provider + ":" + event_id
    )


def _lock_keys(candidate, source):
    # Every performer shares a lock with sources that choose another headliner
    # or omit support acts. A partial lineup still requires review after locking.
    keys = {
        "show:base:" + artist + "|" + str(candidate.get("date") or "")
        for artist in _artist_names(candidate)
    }
    alias = _source_alias(candidate, source)
    if alias:
        keys.add("show:alias:" + alias["provider"] + ":" + alias["event_id"])
        keys.add("show:legacy:" + _legacy_id(alias))
    return keys


def _rows(current, candidate, source):
    alias_ids = []
    reference = _source_alias(candidate, source)
    if reference:
        alias_ids = (
            current.execute(
                text(
                    "SELECT DISTINCT COALESCE(s.merged_into_id,s.id) FROM show_source_aliases a "
                    "JOIN shows s ON s.id=a.show_id WHERE a.provider=:provider AND a.event_id=ANY(:variants)"
                ),
                {**reference, "variants": _alias_variants(reference)},
            )
            .scalars()
            .all()
        )
    if alias_ids or candidate.get("existing_show_id"):
        rows = (
            current.execute(
                text(
                    "SELECT * FROM shows WHERE id=ANY(:ids) OR id IN (SELECT merged_into_id FROM shows WHERE id=ANY(:ids))"
                ),
                {"ids": alias_ids or [candidate["existing_show_id"]]},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows if not row["merged_into_id"]], True
    rows = (
        current.execute(
            text("""SELECT * FROM shows WHERE date=CAST(:date AS date)
        AND merged_into_id IS NULL
        AND (lower(regexp_replace(btrim(artist_name),'\\s+',' ','g'))=ANY(:artists)
            OR EXISTS(SELECT 1 FROM unnest(lineup) AS performer(name)
                WHERE lower(regexp_replace(btrim(performer.name),'\\s+',' ','g'))=ANY(:artists)))
        ORDER BY id"""),
            {
                "date": candidate.get("date"),
                "artists": sorted(_artist_names(candidate)),
            },
        )
        .mappings()
        .all()
    )
    return list(map(dict, rows)), False


def _match(current, candidate, source) -> dict:
    rows, exact = _rows(current, candidate, source)
    return _match_rows(candidate, rows, exact)


def _match_rows(candidate, rows, exact) -> dict:
    if exact:
        if len(rows) != 1:
            return {
                "status": "conflict",
                "matches": [row["id"] for row in rows],
                "reason": "Selected show is missing or provider aliases conflict",
            }
        row = rows[0]
        if (
            candidate.get("existing_show_id")
            and candidate["existing_show_id"] != row["id"]
        ):
            return {
                "status": "conflict",
                "matches": [row["id"]],
                "reason": "Selected show was consolidated; review the canonical show",
            }
        if (
            candidate.get("expected_revision")
            and row["revision"] != candidate["expected_revision"]
        ):
            return {
                "status": "conflict",
                "matches": [row["id"]],
                "reason": "Show revision changed",
            }
        return {"status": "already_exists", "show": row}
    matches, possible = [], []
    artists = _artist_names(candidate)
    for row in rows:
        row_artists = _artist_names(row)
        if str(candidate.get("date")) != str(row.get("date")) or not (
            artists & row_artists
        ):
            continue
        countries = [
            normalize(value)
            for value in (candidate.get("country_code"), row.get("country_code"))
        ]
        if all(countries) and countries[0] != countries[1]:
            continue
        country_names = [
            normalize(candidate.get("country")),
            normalize(row.get("country")),
        ]
        if (
            not all(countries)
            and all(country_names)
            and country_names[0] != country_names[1]
        ):
            continue
        same_venue = normalize(candidate.get("venue")) == normalize(row.get("venue"))
        same_city = normalize(candidate.get("city")) == normalize(row.get("city"))
        times = [
            normalize(value)[:5]
            for value in (candidate.get("local_time"), row.get("local_time"))
        ]
        if all(times) and times[0] != times[1]:
            continue
        if (
            same_venue
            and same_city
            and candidate.get("venue")
            and candidate.get("city")
        ):
            if (
                normalize(candidate.get("artist_name"))
                == normalize(row.get("artist_name"))
                or artists == row_artists
            ):
                matches.append(row)
            else:
                possible.append(row)
        elif (
            not candidate.get("venue")
            or not row.get("venue")
            or not candidate.get("city")
            or not row.get("city")
        ):
            possible.append(row)
        elif (
            same_city
            and SequenceMatcher(
                None, normalize(candidate["venue"]), normalize(row["venue"])
            ).ratio()
            >= 0.85
        ):
            possible.append(row)
    if possible or len(matches) > 1:
        return {
            "status": "conflict",
            "matches": [r["id"] for r in matches + possible],
            "reason": "Ambiguous event identity",
        }
    if matches:
        return {"status": "already_exists", "show": matches[0]}
    return {"status": "created"}


def preview_show(candidate: dict, source: dict, *, session=None) -> dict:
    def read(current):
        result = _match(current, candidate, source)
        if "show" in result:
            result = {
                **result,
                "show_id": result["show"]["id"],
                "revision": result["show"]["revision"],
            }
        return result

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def match_show_candidates(
    candidates: list[dict], *, expected_ids=(), lock=False, session=None
) -> dict:
    """One indexed batch lookup for a bounded manual/MCP selection."""
    if not 1 <= len(candidates) <= 50:
        raise ValueError("Choose 1 to 50 show candidates")

    def read(current):
        keys = []
        for candidate in candidates:
            alias = _source_alias(candidate, {})
            keys.append(
                {
                    "item_id": candidate["item_id"],
                    "artists": sorted(_artist_names(candidate)),
                    "date": candidate.get("date"),
                    **(alias or {"provider": None, "event_id": None}),
                    "alternate_event_id": _alias_variants(alias)[-1] if alias else None,
                }
            )
        ids = list(
            set(expected_ids)
            | {
                candidate["existing_show_id"]
                for candidate in candidates
                if candidate.get("existing_show_id")
            }
        )
        statement = """WITH wanted AS (SELECT * FROM jsonb_to_recordset(CAST(:keys AS jsonb))
                AS w(item_id text,artists text[],date date,provider text,event_id text,alternate_event_id text)),
            resolved_aliases AS (
                SELECT w.item_id,COALESCE(s.merged_into_id,a.show_id) AS show_id
                FROM wanted w JOIN show_source_aliases a ON a.provider=w.provider AND a.event_id IN (w.event_id,w.alternate_event_id)
                JOIN shows s ON s.id=a.show_id),
            alias_items AS (SELECT show_id,jsonb_agg(item_id) AS item_ids FROM resolved_aliases GROUP BY show_id)
            SELECT s.*,COALESCE(a.item_ids,'[]'::jsonb) AS _alias_items FROM shows s
            LEFT JOIN alias_items a ON a.show_id=s.id WHERE a.show_id IS NOT NULL OR s.id=ANY(:ids)
            OR s.id IN (SELECT merged_into_id FROM shows WHERE id=ANY(:ids))
            OR (s.merged_into_id IS NULL AND EXISTS(SELECT 1 FROM wanted w WHERE s.date=w.date
                AND (lower(regexp_replace(btrim(s.artist_name),'\\s+',' ','g'))=ANY(w.artists)
                    OR EXISTS(SELECT 1 FROM unnest(s.lineup) AS performer(name)
                        WHERE lower(regexp_replace(btrim(performer.name),'\\s+',' ','g'))=ANY(w.artists)))))
            ORDER BY s.id"""
        if lock:
            statement += " FOR UPDATE OF s"
        rows = [
            dict(row)
            for row in current.execute(
                text(statement), {"keys": json.dumps(keys, default=str), "ids": ids}
            ).mappings()
        ]
        indexed = {row["id"]: row for row in rows}
        aliases = {}
        for row in rows:
            for item in set(row.pop("_alias_items")):
                aliases.setdefault(item, []).append(row)
        results = {}
        for candidate in candidates:
            selected = candidate.get("existing_show_id")
            alias_rows = aliases.get(candidate["item_id"])
            if alias_rows:
                matches = alias_rows
            elif selected:
                row = indexed.get(selected)
                row = (
                    indexed.get(row["merged_into_id"])
                    if row and row["merged_into_id"]
                    else row
                )
                matches = [row] if row else []
            else:
                matches = [
                    row
                    for row in rows
                    if row["merged_into_id"] is None
                    and str(row["date"]) == str(candidate.get("date"))
                    and _artist_names(row) & _artist_names(candidate)
                ]
            results[candidate["item_id"]] = _match_rows(
                candidate, matches, bool(selected or alias_rows)
            )
        return results

    if session is not None:
        return read(session)
    if lock:
        raise ValueError("Locked batch matching requires the caller transaction")
    with read_scope() as current:
        return read(current)


def upsert_canonical_show(
    candidate: dict, source: dict, *, session=None, _matched=None
) -> dict:
    if not candidate.get("artist_name") or not candidate.get("date"):
        return {
            "status": "invalid",
            "reason": "Artist and unambiguous date are required",
        }
    with optional_scope(session) as current:
        for key in sorted(_lock_keys(candidate, source)):
            current.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": key},
            )
        if _matched is not None and session is None:
            raise ValueError(
                "A prepared match requires the caller's locked transaction"
            )
        match = _matched if _matched is not None else _match(current, candidate, source)
        if match["status"] in {"conflict", "invalid"}:
            return match
        existing = match.get("show")
        manual = source["provider"] in {"manual", "mcp"}
        if existing and _matched is None:
            current.execute(
                text("SELECT id FROM shows WHERE id=:id FOR UPDATE"),
                {"id": existing["id"]},
            ).one()
            existing = dict(
                current.execute(
                    text("SELECT * FROM shows WHERE id=:id"), {"id": existing["id"]}
                )
                .mappings()
                .one()
            )
            if (
                candidate.get("expected_revision")
                and existing["revision"] != candidate["expected_revision"]
            ):
                return {
                    "status": "conflict",
                    "matches": [existing["id"]],
                    "reason": "Show revision changed",
                }
        if existing and existing.get("merged_into_id") is not None:
            return {
                "status": "conflict",
                "matches": [existing["merged_into_id"]],
                "reason": "Show was consolidated while waiting for its write lock; retry the canonical alias",
            }
        values = {key: (existing or {}).get(key) for key in _FIELDS}
        provenance = dict((existing or {}).get("field_provenance") or {})
        for key in _FIELDS:
            if key not in candidate:
                continue
            if candidate[key] is None and not (
                manual and candidate.get("existing_show_id")
            ):
                continue
            protected = provenance.get(key, {}).get("provider") in {"manual", "mcp"}
            if existing and (
                (
                    key == "artist_name"
                    and not (manual and candidate.get("existing_show_id"))
                )
                or (protected and not manual)
            ):
                continue
            values[key] = candidate[key]
            provenance[key] = {
                "provider": source["provider"],
                "actor": source["actor"],
                "evidence": candidate.get("evidence"),
                "source_ref": candidate.get("source_ref"),
                "extractor": candidate.get("extractor"),
                "extractor_model": candidate.get("extractor_model"),
            }
        if manual and "lineup" in candidate:
            lineup = [
                values["artist_name"],
                candidate.get("artist_name"),
                *(candidate.get("lineup") or []),
            ]
        elif provenance.get("lineup", {}).get("provider") in {"manual", "mcp"}:
            lineup = [values["artist_name"], *(values.get("lineup") or [])]
        else:
            lineup = [
                values["artist_name"],
                candidate.get("artist_name"),
                *((existing or {}).get("lineup") or []),
                *(candidate.get("lineup") or []),
            ]
        unique_lineup = {}
        for name in lineup:
            if normalized := normalize(name):
                unique_lineup.setdefault(normalized, name)
        values["lineup"] = list(unique_lineup.values())
        values["status"] = values.get("status") or "scheduled"
        values["identity_key"] = identity_key(values)
        collision = (
            None
            if _matched is not None
            else current.execute(
                text("SELECT id FROM shows WHERE identity_key=:key AND id<>:id"),
                {"key": values["identity_key"], "id": (existing or {}).get("id", 0)},
            ).scalar_one_or_none()
        )
        if collision:
            return {
                "status": "conflict",
                "matches": [collision],
                "reason": "New identity belongs to another show",
            }
        values["field_provenance"] = json.dumps(provenance)
        values["source"] = (existing or {}).get("source") or source["provider"]
        fields = [*_FIELDS, "identity_key", "field_provenance", "source"]
        expressions = {key: f":{key}" for key in fields}
        expressions["date"] = "CAST(:date AS date)"
        expressions["field_provenance"] = "CAST(:field_provenance AS jsonb)"
        if existing:
            values["id"] = existing["id"]
            assignments = ",".join(f"{key}={expressions[key]}" for key in fields)
            sql = f"UPDATE shows SET {assignments},archived_at=CASE WHEN CAST(:date AS date)>=CURRENT_DATE THEN NULL ELSE archived_at END,updated_at=NOW() WHERE id=:id RETURNING id,revision"
        else:
            if manual and not values["identity_key"]:
                return {
                    "status": "invalid",
                    "reason": "Venue and city are required for a new manual show",
                }
            sql = f"INSERT INTO shows ({','.join(fields)},created_at,updated_at) VALUES ({','.join(expressions[key] for key in fields)},NOW(),NOW()) RETURNING id,revision"
        stored = dict(current.execute(text(sql), values).mappings().one())
        show_id = stored["id"]
        alias = _source_alias(candidate, source)
        if alias:
            legacy_id = _legacy_id(alias)
            updated_revision = current.execute(
                text(
                    "UPDATE shows SET external_id=:external WHERE id=:id AND external_id IS NULL "
                    "AND NOT EXISTS(SELECT 1 FROM shows WHERE external_id=:external) RETURNING revision"
                ),
                {"external": legacy_id, "id": show_id},
            ).scalar_one_or_none()
            if updated_revision is not None:
                stored["revision"] = updated_revision
        evidence = {"source": source, "candidate": candidate}
        encoded = json.dumps(evidence, sort_keys=True, default=str)
        source_added = current.execute(
            text("""INSERT INTO show_sources(show_id,fingerprint,provider,actor,evidence)
            VALUES (:id,:hash,:provider,:actor,CAST(:evidence AS jsonb)) ON CONFLICT DO NOTHING RETURNING id"""),
            {
                "id": show_id,
                "hash": hashlib.sha256(encoded.encode()).hexdigest(),
                "provider": source["provider"],
                "actor": source["actor"],
                "evidence": encoded,
            },
        ).scalar_one_or_none()
        if alias:
            current.execute(
                text("""INSERT INTO show_source_aliases(provider,event_id,show_id,evidence)
                VALUES (:provider,:event_id,:id,CAST(:evidence AS jsonb)) ON CONFLICT DO NOTHING"""),
                {**alias, "id": show_id, "evidence": encoded},
            )
        if _matched is None:
            invalidate_show_views(
                [
                    values["artist_name"],
                    *values["lineup"],
                    *((existing or {}).get("lineup") or []),
                ],
                session=current,
            )
        return {
            "status": "linked_source"
            if existing and source_added is not None
            else "already_exists"
            if existing
            else "created",
            "show_id": show_id,
            "revision": stored["revision"],
        }


__all__ = [
    "normalize",
    "identity_base",
    "identity_key",
    "preview_show",
    "upsert_canonical_show",
    "consolidate_shows",
    "match_show_candidates",
]
