"""Current Crates schema bootstrap entry point."""

from typing import Any

from crate.db.schema_sections.crates_v091 import create_crates_v091_schema


def create_crates_schema(cur: Any) -> None:
    create_crates_v091_schema(cur)


__all__ = ["create_crates_schema"]
