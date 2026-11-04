"""Admit the `ops.errors.read` MCP grant in `agent_principals`.

The grants CHECK lists every allowed scope; v132 is the previous list.
"""

from crate.db.schema_sections.show_plans_v118 import PREVIOUS_GRANTS

V132_GRANTS = (
    PREVIOUS_GRANTS
    + ",'curation.shows.read','curation.shows.write','library.acquisition.search','library.acquisition.write'"
)
V144_GRANTS = V132_GRANTS + ",'ops.errors.read'"


def _grants_check(cur, grants: str) -> None:
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
        AND grants <@ ARRAY[{grants}]::text[])""")


def create_error_inbox_grant_v144_schema(cur) -> None:
    _grants_check(cur, V144_GRANTS)


def drop_error_inbox_grant_v144_schema(cur) -> None:
    """Restore the v132 list. Fails until every `ops.errors.read` grant is revoked."""
    _grants_check(cur, V132_GRANTS)


__all__ = [
    "V132_GRANTS",
    "V144_GRANTS",
    "create_error_inbox_grant_v144_schema",
    "drop_error_inbox_grant_v144_schema",
]
