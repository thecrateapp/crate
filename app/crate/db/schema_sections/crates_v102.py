"""DDL for Alembic revision 102; keep immutable after the revision ships."""

from typing import Any


def create_crates_v102_schema(cur: Any) -> None:
    cur.execute("ALTER TABLE crates ADD COLUMN IF NOT EXISTS short_code TEXT")
    cur.execute(
        """
        DO $$
        DECLARE
            alphabet CONSTANT TEXT :=
                '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
            target RECORD;
            candidate TEXT;
        BEGIN
            FOR target IN SELECT id FROM crates WHERE short_code IS NULL LOOP
                LOOP
                    candidate := '';
                    FOR idx IN 1..8 LOOP
                        candidate := candidate
                            || substr(alphabet, 1 + floor(random() * 62)::int, 1);
                    END LOOP;
                    EXIT WHEN NOT EXISTS (
                        SELECT 1 FROM crates WHERE short_code = candidate
                    );
                END LOOP;
                UPDATE crates SET short_code = candidate WHERE id = target.id;
            END LOOP;
        END $$;
        """
    )
    cur.execute("ALTER TABLE crates ALTER COLUMN short_code SET NOT NULL")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crates_short_code
        ON crates(short_code)
        """
    )
