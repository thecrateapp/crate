"""Bounded canonical show search for curators and remote clients."""

from sqlalchemy import text
from crate.db.tx import read_scope
from crate.mcp.show_schemas import ShowsSearch


def search_canonical_shows(*, session=None, **parameters) -> dict:
    args = ShowsSearch.model_validate(parameters).model_dump(mode="json")
    if args["date_from"] and args["date_to"] and args["date_from"] > args["date_to"]:
        raise ValueError("Start date must precede end date")

    def read(current):
        rows = (
            current.execute(
                text("""
        SELECT s.id,s.revision,s.artist_name,s.date::text,s.local_time,s.doors_time,s.timezone,
          s.venue,s.city,s.region,s.country,s.country_code,s.address_line1,s.postal_code,
          s.latitude,s.longitude,s.url,s.tickets_url,s.image_url,s.lineup,s.price_range,s.status,
          a.entity_uid::text AS artist_uid,a.id AS artist_id,a.slug AS artist_slug
        FROM shows s LEFT JOIN (SELECT lower(name) AS name_key,min(id) AS id FROM library_artists GROUP BY lower(name) HAVING count(*)=1) refs ON refs.name_key=lower(s.artist_name) LEFT JOIN library_artists a ON a.id=refs.id
        WHERE s.merged_into_id IS NULL
          AND (:show_id IS NULL OR s.id=COALESCE((SELECT merged_into_id FROM shows WHERE id=CAST(:show_id AS integer)),CAST(:show_id AS integer)))
          AND (CAST(:show_id AS integer) IS NOT NULL OR (s.archived_at IS NULL AND s.date>=CURRENT_DATE))
          AND (:query='' OR s.artist_name ILIKE :pattern ESCAPE '!' OR s.venue ILIKE :pattern ESCAPE '!' OR s.city ILIKE :pattern ESCAPE '!')
          AND (CAST(:artist_uid AS uuid) IS NULL OR EXISTS(SELECT 1 FROM library_artists x WHERE x.entity_uid=CAST(:artist_uid AS uuid) AND (LOWER(x.name)=LOWER(s.artist_name) OR EXISTS(SELECT 1 FROM unnest(s.lineup) n WHERE LOWER(n)=LOWER(x.name)))))
          AND (CAST(:date_from AS date) IS NULL OR s.date>=CAST(:date_from AS date))
          AND (CAST(:date_to AS date) IS NULL OR s.date<=CAST(:date_to AS date))
        ORDER BY s.date,s.local_time NULLS LAST,s.id LIMIT :take OFFSET :offset
        """),
                {
                    **args,
                    "pattern": "%"
                    + args["query"]
                    .replace("!", "!!")
                    .replace("%", "!%")
                    .replace("_", "!_")
                    + "%",
                    "take": args["limit"] + 1,
                },
            )
            .mappings()
            .all()
        )
        items = [dict(row) for row in rows[: args["limit"]]]
        return {
            "items": items,
            "next_offset": args["offset"] + args["limit"]
            if len(rows) > args["limit"]
            else None,
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


__all__ = ["search_canonical_shows"]
