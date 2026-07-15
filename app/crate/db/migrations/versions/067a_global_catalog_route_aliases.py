"""Persist source-neutral human route aliases for the global catalog.

Revision ID: 067a
Revises: 067
"""

from collections.abc import Sequence

from alembic import op


revision = "067a"
down_revision = "067"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE global_catalog_artist_route_aliases (
            slug TEXT PRIMARY KEY,
            global_artist_uid UUID NOT NULL
                REFERENCES global_catalog_artists(global_artist_uid)
                ON DELETE CASCADE,
            is_canonical BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_global_artist_route_canonical
        ON global_catalog_artist_route_aliases(global_artist_uid)
        WHERE is_canonical
        """
    )
    op.execute(
        """
        INSERT INTO global_catalog_artist_route_aliases (
            slug, global_artist_uid, is_canonical
        )
        SELECT public_slug, global_artist_uid, true
        FROM global_catalog_artists
        WHERE public_slug IS NOT NULL AND public_slug <> ''
        ON CONFLICT (slug) DO NOTHING
        """
    )
    op.execute(
        """
        CREATE TABLE global_catalog_album_route_aliases (
            global_artist_uid UUID NOT NULL
                REFERENCES global_catalog_artists(global_artist_uid)
                ON DELETE CASCADE,
            slug TEXT NOT NULL,
            global_album_uid UUID NOT NULL
                REFERENCES global_catalog_albums(global_album_uid)
                ON DELETE CASCADE,
            is_canonical BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (global_artist_uid, slug)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_global_album_route_canonical
        ON global_catalog_album_route_aliases(global_album_uid)
        WHERE is_canonical
        """
    )
    op.execute(
        """
        INSERT INTO global_catalog_album_route_aliases (
            global_artist_uid, slug, global_album_uid, is_canonical
        )
        SELECT global_artist_uid, public_slug, global_album_uid, true
        FROM global_catalog_albums
        WHERE public_slug IS NOT NULL AND public_slug <> ''
        ON CONFLICT (global_artist_uid, slug) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS global_catalog_album_route_aliases")
    op.execute("DROP TABLE IF EXISTS global_catalog_artist_route_aliases")
