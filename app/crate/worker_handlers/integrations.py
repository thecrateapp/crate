import json
import logging

from crate.db.events import emit_task_event
from crate.db.jobs.integrations import get_artists_with_similar_json
from crate.db.queries.shows import get_show_sync_locations
from crate.db.repositories.library import get_library_artists
from crate.db.repositories.shows import delete_past_shows, upsert_show
from crate.db.similarities import bulk_upsert_similarities, mark_library_status
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _merge_ticketmaster_events(event_groups: list[list[dict]]) -> list[dict]:
    merged: dict[str, dict] = {}
    anonymous: list[dict] = []
    for events in event_groups:
        for event in events:
            event_id = str(event.get("id") or "").strip()
            if event_id:
                merged.setdefault(event_id, event)
            else:
                anonymous.append(event)
    return [*merged.values(), *anonymous]


def _handle_sync_shows(task_id: str, params: dict, config: dict) -> dict:
    """Sync shows from Ticketmaster to DB for all library artists."""
    from crate.ticketmaster import get_upcoming_shows as tm_get_shows
    from crate.ticketmaster import is_configured

    if not is_configured():
        return {"error": "Ticketmaster not configured"}

    artists, _ = get_library_artists(per_page=10000)
    total = len(artists)
    synced = 0
    shows_found = 0
    sync_locations = get_show_sync_locations()

    p = TaskProgress(phase="fetching", phase_count=2, total=total)

    for index, artist in enumerate(artists):
        if is_cancelled(task_id):
            break
        name = artist["name"]
        p.done = index
        p.item = name
        if index % 10 == 0:
            emit_progress(task_id, p)

        try:
            event_groups = [tm_get_shows(name, limit=30)]
            for location in sync_locations:
                lat = location.get("latitude")
                lon = location.get("longitude")
                if lat is None or lon is None:
                    continue
                event_groups.append(
                    tm_get_shows(
                        name,
                        country_code=str(location.get("country_code") or ""),
                        limit=50,
                        latitude=float(lat),
                        longitude=float(lon),
                        radius_km=int(location.get("show_radius_km") or 60),
                    )
                )
            events = _merge_ticketmaster_events(event_groups)
            for event in events:
                external_id = event.get("id")
                if not external_id:
                    continue
                upsert_show(
                    external_id=external_id,
                    artist_name=name,
                    date=event.get("local_date") or event.get("date", "")[:10],
                    local_time=event.get("local_time"),
                    venue=event.get("venue"),
                    address_line1=event.get("address_line1"),
                    city=event.get("city"),
                    region=event.get("region"),
                    postal_code=event.get("postal_code"),
                    country=event.get("country"),
                    country_code=event.get("country_code"),
                    latitude=float(event["latitude"])
                    if event.get("latitude")
                    else None,
                    longitude=float(event["longitude"])
                    if event.get("longitude")
                    else None,
                    url=event.get("url"),
                    image_url=event.get("image"),
                    lineup=event.get("lineup"),
                    price_range=str(event["price_range"])
                    if event.get("price_range")
                    else None,
                    status=event.get("status", "onsale"),
                )
                shows_found += 1
            synced += 1
            if events:
                emit_task_event(
                    task_id,
                    "info",
                    {
                        "message": f"Found {len(events)} shows for {name}",
                        "artist": name,
                        "count": len(events),
                    },
                )
        except Exception:
            log.debug("Failed to sync shows for %s", name, exc_info=True)

    p.phase = "cleanup"
    p.phase_index = 1
    emit_progress(task_id, p, force=True)
    deleted = delete_past_shows(days_old=30)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Sync complete: {synced} artists checked, {shows_found} shows found, {deleted} old shows removed",
        },
    )
    return {
        "artists_checked": synced,
        "shows_found": shows_found,
        "old_deleted": deleted,
    }


def _handle_backfill_similarities(task_id: str, params: dict, config: dict) -> dict:
    """Populate artist_similarities from existing similar_json on library_artists."""
    rows = get_artists_with_similar_json()

    total = len(rows)
    upserted = 0
    for index, row in enumerate(rows):
        if is_cancelled(task_id):
            break
        similar_json = row["similar_json"]
        if not similar_json:
            continue
        try:
            similar = (
                similar_json
                if isinstance(similar_json, list)
                else json.loads(similar_json)
            )
        except Exception:
            continue
        if not isinstance(similar, list) or not similar:
            continue
        try:
            bulk_upsert_similarities(row["name"], similar)
            upserted += len(similar)
        except Exception:
            log.warning(
                "backfill_similarities: failed for %s", row["name"], exc_info=True
            )
        if index % 50 == 0:
            p_bf = TaskProgress(
                phase="backfill", done=index + 1, total=total, item=row.get("name", "")
            )
            emit_progress(task_id, p_bf)

    try:
        updated = mark_library_status()
        log.info("backfill_similarities: marked %d rows in_library", updated)
    except Exception:
        log.warning("backfill_similarities: mark_library_status failed", exc_info=True)

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Backfill similarities complete: {total} artists, {upserted} rows upserted"
        },
    )
    return {"artists_processed": total, "rows_upserted": upserted}


INTEGRATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_shows": _handle_sync_shows,
    "backfill_similarities": _handle_backfill_similarities,
}
