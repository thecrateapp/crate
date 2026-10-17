"""Finite counters contain no actor, source, URL or candidate field values."""


def record_show_metrics(*, candidates: int = 0, result: dict | None = None) -> None:
    from crate.metrics import record_later

    try:
        record_later("shows.import.candidates", min(max(int(candidates), 0), 200))
        rows = ((result or {}).get("execution") or {}).get("items") or []
        for status in (
            "created",
            "already_exists",
            "linked_source",
            "conflict",
            "invalid",
            "failed",
        ):
            count = sum(
                1
                for row in rows[:50]
                if isinstance(row, dict) and row.get("status") == status
            )
            if count:
                record_later("shows.import." + status, count)
    except Exception:
        pass


__all__ = ["record_show_metrics"]
