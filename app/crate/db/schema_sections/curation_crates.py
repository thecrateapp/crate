"""Current Crates schema bootstrap entry point.

The revision-specific module owns the DDL so bootstrap and Alembic stay in
lockstep; this module is only the stable curation-schema adapter.
"""

from typing import Any

from crate.db.schema_sections.crates_v099 import create_crates_v099_schema


def create_crates_schema(cur: Any) -> None:
    create_crates_v099_schema(cur)


__all__ = ["create_crates_schema"]
