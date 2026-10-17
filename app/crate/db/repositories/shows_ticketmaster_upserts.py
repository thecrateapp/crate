"""Provider compatibility adapter into the canonical event identity service."""

from crate.db.repositories.show_identities import upsert_canonical_show


def upsert_show(external_id: str, artist_name: str, date: str, **kwargs) -> int | None:
    provider = kwargs.get("source") or "ticketmaster"
    if provider not in {"ticketmaster", "setlistfm", "lastfm"}:
        raise ValueError("Unknown show provider")
    fields = {
        key: value
        for key, value in kwargs.items()
        if key
        in {
            "local_time",
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
            "timezone",
            "doors_time",
        }
    }
    if fields.get("status") == "canceled":
        fields["status"] = "cancelled"
    result = upsert_canonical_show(
        {"artist_name": artist_name, "date": date, **fields},
        {
            "provider": provider,
            "event_id": (external_id or "").strip() or None,
            "actor": "provider:" + provider,
        },
    )
    return result.get("show_id")


__all__ = ["upsert_show"]
