"""Conservative canonical identity; all event writers serialize and recheck here."""

import hashlib
import json
from difflib import SequenceMatcher

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
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


def _rows(current, candidate, source):
    alias = None
    if source.get("event_id"):
        alias = current.execute(
            text(
                "SELECT show_id FROM show_source_aliases WHERE provider=:provider AND event_id=:event_id"
            ),
            source,
        ).scalar_one_or_none()
    if alias or candidate.get("existing_show_id"):
        rows = (
            current.execute(
                text(
                    "SELECT * FROM shows WHERE id=COALESCE((SELECT merged_into_id FROM shows WHERE id=:id),:id)"
                ),
                {"id": alias or candidate["existing_show_id"]},
            )
            .mappings()
            .all()
        )
        return list(map(dict, rows)), True
    rows = (
        current.execute(
            text("""SELECT * FROM shows WHERE date=CAST(:date AS date)
        AND merged_into_id IS NULL
        AND lower(regexp_replace(btrim(artist_name),'\\s+',' ','g'))=:artist ORDER BY id"""),
            {
                "date": candidate.get("date"),
                "artist": normalize(candidate.get("artist_name")),
            },
        )
        .mappings()
        .all()
    )
    return list(map(dict, rows)), False


def _match(current, candidate, source) -> dict:
    rows, exact = _rows(current, candidate, source)
    if exact:
        if not rows:
            return {
                "status": "conflict",
                "matches": [],
                "reason": "Selected show is missing",
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
    for row in rows:
        countries = [
            normalize(value)
            for value in (candidate.get("country_code"), row.get("country_code"))
        ]
        if all(countries) and countries[0] != countries[1]:
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
            matches.append(row)
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


def upsert_canonical_show(candidate: dict, source: dict, *, session=None) -> dict:
    if not candidate.get("artist_name") or not candidate.get("date"):
        return {
            "status": "invalid",
            "reason": "Artist and unambiguous date are required",
        }
    with optional_scope(session) as current:
        lock_keys = {"show:base:" + identity_base(candidate)}
        if source.get("event_id"):
            lock_keys.add("show:alias:" + source["provider"] + ":" + source["event_id"])
        for key in sorted(lock_keys):
            current.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": key},
            )
        match = _match(current, candidate, source)
        if match["status"] in {"conflict", "invalid"}:
            return match
        existing = match.get("show")
        manual = source["provider"] in {"manual", "mcp"}
        if existing:
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
            }
        lineup = [
            values["artist_name"],
            *((existing or {}).get("lineup") or []),
            *(candidate.get("lineup") or []),
        ]
        values["lineup"] = list(dict.fromkeys(name for name in lineup if name))
        values["status"] = values.get("status") or "scheduled"
        values["identity_key"] = identity_key(values)
        collision = current.execute(
            text("SELECT id FROM shows WHERE identity_key=:key AND id<>:id"),
            {"key": values["identity_key"], "id": (existing or {}).get("id", 0)},
        ).scalar_one_or_none()
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
            sql = f"UPDATE shows SET {assignments},updated_at=NOW() WHERE id=:id RETURNING id,revision"
        else:
            if manual and not values["identity_key"]:
                return {
                    "status": "invalid",
                    "reason": "Venue and city are required for a new manual show",
                }
            sql = f"INSERT INTO shows ({','.join(fields)},created_at,updated_at) VALUES ({','.join(expressions[key] for key in fields)},NOW(),NOW()) RETURNING id,revision"
        stored = dict(current.execute(text(sql), values).mappings().one())
        show_id = stored["id"]
        if source.get("event_id"):
            legacy_id = source["event_id"]
            if source["provider"] != "ticketmaster" and not legacy_id.startswith(
                source["provider"] + ":"
            ):
                legacy_id = source["provider"] + ":" + legacy_id
            current.execute(
                text(
                    "UPDATE shows SET external_id=:external WHERE id=:id AND external_id IS NULL"
                ),
                {"external": legacy_id, "id": show_id},
            )
        evidence = {"source": source, "candidate": candidate}
        encoded = json.dumps(evidence, sort_keys=True, default=str)
        current.execute(
            text("""INSERT INTO show_sources(show_id,fingerprint,provider,actor,evidence)
            VALUES (:id,:hash,:provider,:actor,CAST(:evidence AS jsonb)) ON CONFLICT DO NOTHING"""),
            {
                "id": show_id,
                "hash": hashlib.sha256(encoded.encode()).hexdigest(),
                "provider": source["provider"],
                "actor": source["actor"],
                "evidence": encoded,
            },
        )
        if source.get("event_id"):
            current.execute(
                text("""INSERT INTO show_source_aliases(provider,event_id,show_id,evidence)
                VALUES (:provider,:event_id,:id,CAST(:evidence AS jsonb)) ON CONFLICT DO NOTHING"""),
                {**source, "id": show_id, "evidence": encoded},
            )
        for scope in ("shows", "upcoming", "home"):
            append_domain_event(
                "ui.invalidate",
                {"scope": scope},
                scope="ui.invalidate",
                subject_key=scope,
                session=current,
            )
        return {
            "status": "linked_source"
            if existing and source.get("event_id")
            else "already_exists"
            if existing
            else "created",
            "show_id": show_id,
            "revision": current.execute(
                text("SELECT revision FROM shows WHERE id=:id"), {"id": show_id}
            ).scalar_one(),
        }


__all__ = [
    "normalize",
    "identity_base",
    "identity_key",
    "preview_show",
    "upsert_canonical_show",
    "consolidate_shows",
]
