"""Add hybrid full-text search vectors for the library.

Revision ID: 045
Revises: 044
"""

from typing import Sequence, Union

from alembic import op


revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _run_concurrently(statement: str) -> None:
    with op.get_context().autocommit_block():
        op.execute(statement)


def upgrade() -> None:
    op.execute(
        "ALTER TABLE library_artists ADD COLUMN IF NOT EXISTS search_vector tsvector"
    )
    op.execute(
        "ALTER TABLE library_albums ADD COLUMN IF NOT EXISTS search_vector tsvector"
    )
    op.execute(
        "ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS search_vector tsvector"
    )

    op.execute("""
        CREATE OR REPLACE FUNCTION library_artists_search_update()
        RETURNS trigger AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION library_albums_search_update()
        RETURNS trigger AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(NEW.artist, '')), 'B');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION library_tracks_search_update()
        RETURNS trigger AS $$
        DECLARE
            album_name_text TEXT;
        BEGIN
            SELECT name INTO album_name_text
            FROM library_albums
            WHERE id = NEW.album_id;

            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(NEW.artist, '')), 'B') ||
                setweight(to_tsvector('simple', coalesce(album_name_text, NEW.album, '')), 'C');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION library_albums_search_cascade()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.name IS DISTINCT FROM OLD.name THEN
                UPDATE library_tracks
                SET search_vector = DEFAULT
                WHERE album_id = NEW.id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'trg_artists_search_vector'
            ) THEN
                CREATE TRIGGER trg_artists_search_vector
                    BEFORE INSERT OR UPDATE ON library_artists
                    FOR EACH ROW EXECUTE FUNCTION library_artists_search_update();
            END IF;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'trg_albums_search_vector'
            ) THEN
                CREATE TRIGGER trg_albums_search_vector
                    BEFORE INSERT OR UPDATE ON library_albums
                    FOR EACH ROW EXECUTE FUNCTION library_albums_search_update();
            END IF;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tracks_search_vector'
            ) THEN
                CREATE TRIGGER trg_tracks_search_vector
                    BEFORE INSERT OR UPDATE ON library_tracks
                    FOR EACH ROW EXECUTE FUNCTION library_tracks_search_update();
            END IF;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'trg_albums_search_cascade'
            ) THEN
                CREATE TRIGGER trg_albums_search_cascade
                    AFTER UPDATE ON library_albums
                    FOR EACH ROW EXECUTE FUNCTION library_albums_search_cascade();
            END IF;
        END $$
    """)

    op.execute("UPDATE library_artists SET search_vector = DEFAULT")
    op.execute("UPDATE library_albums SET search_vector = DEFAULT")
    op.execute("UPDATE library_tracks SET search_vector = DEFAULT")

    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_artists_search_fts "
        "ON library_artists USING gin(search_vector)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_albums_search_fts "
        "ON library_albums USING gin(search_vector)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracks_search_fts "
        "ON library_tracks USING gin(search_vector)"
    )


def downgrade() -> None:
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_tracks_search_fts")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_albums_search_fts")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_artists_search_fts")

    op.execute("DROP TRIGGER IF EXISTS trg_albums_search_cascade ON library_albums")
    op.execute("DROP TRIGGER IF EXISTS trg_tracks_search_vector ON library_tracks")
    op.execute("DROP TRIGGER IF EXISTS trg_albums_search_vector ON library_albums")
    op.execute("DROP TRIGGER IF EXISTS trg_artists_search_vector ON library_artists")
    op.execute("DROP FUNCTION IF EXISTS library_albums_search_cascade()")
    op.execute("DROP FUNCTION IF EXISTS library_tracks_search_update()")
    op.execute("DROP FUNCTION IF EXISTS library_albums_search_update()")
    op.execute("DROP FUNCTION IF EXISTS library_artists_search_update()")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS search_vector")
    op.execute("ALTER TABLE library_albums DROP COLUMN IF EXISTS search_vector")
    op.execute("ALTER TABLE library_artists DROP COLUMN IF EXISTS search_vector")
