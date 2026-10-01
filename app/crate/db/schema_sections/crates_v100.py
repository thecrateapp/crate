"""DDL for Alembic revision 100; keep immutable after the revision ships."""

from typing import Any


def create_crates_v100_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE crates
        ADD COLUMN IF NOT EXISTS is_ordered BOOLEAN NOT NULL DEFAULT TRUE
        """
    )
    cur.execute(
        """
        ALTER TABLE crates
        ADD COLUMN IF NOT EXISTS sort_direction TEXT NOT NULL DEFAULT 'asc'
        """
    )
    cur.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'crates'::regclass
                  AND conname = 'crates_sort_direction_check'
            ) THEN
                ALTER TABLE crates
                ADD CONSTRAINT crates_sort_direction_check
                CHECK (sort_direction IN ('asc', 'desc'));
            END IF;
        END $$
        """
    )
    cur.execute(
        """
        ALTER TABLE crates
        ADD COLUMN IF NOT EXISTS loop_enabled BOOLEAN NOT NULL DEFAULT FALSE
        """
    )


__all__ = ["create_crates_v100_schema"]
