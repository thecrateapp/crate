"""Canonical persisted inputs for selected repair plans."""

from sqlalchemy import text

from crate.db.tx import read_scope


def get_open_repair_issues(issue_ids: list[int], *, session=None) -> list[dict]:
    if len(issue_ids) > 1000 or any(
        type(value) is not int or value < 1 for value in issue_ids
    ):
        raise ValueError("Repair plans require up to 1000 positive issue IDs")
    if len(set(issue_ids)) != len(issue_ids):
        raise ValueError("Duplicate repair issue IDs")
    if not issue_ids:
        return []

    def _read(current):
        rows = (
            current.execute(
                text(
                    "SELECT * FROM health_issues WHERE id = ANY(:ids) AND status = 'open'"
                ),
                {"ids": issue_ids},
            )
            .mappings()
            .all()
        )
        by_id = {row["id"]: dict(row) for row in rows}
        if set(by_id) != set(issue_ids):
            raise ValueError("A repair issue is missing or no longer open")
        return [by_id[identifier] for identifier in issue_ids]

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


__all__ = ["get_open_repair_issues"]
