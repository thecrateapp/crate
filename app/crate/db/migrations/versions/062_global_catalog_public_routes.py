"""Index deterministic public routes for global catalog entities.

Revision ID: 062
Revises: 061
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

from crate.slugs import build_artist_slug, build_public_album_slug


revision = "062"
down_revision = "061"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE global_catalog_artists ADD COLUMN IF NOT EXISTS public_slug TEXT"
    )
    op.execute(
        "ALTER TABLE global_catalog_albums ADD COLUMN IF NOT EXISTS artist_slug TEXT"
    )
    op.execute(
        "ALTER TABLE global_catalog_albums ADD COLUMN IF NOT EXISTS public_slug TEXT"
    )

    bind = op.get_bind()
    artists = bind.execute(
        text("SELECT global_artist_uid, canonical_name FROM global_catalog_artists")
    ).mappings()
    for artist in artists:
        bind.execute(
            text(
                """
                UPDATE global_catalog_artists
                SET public_slug = :public_slug
                WHERE global_artist_uid = :global_artist_uid
                """
            ),
            {
                "global_artist_uid": artist["global_artist_uid"],
                "public_slug": build_artist_slug(artist["canonical_name"]),
            },
        )

    albums = bind.execute(
        text(
            """
            SELECT global_album_uid, artist_name, canonical_name
            FROM global_catalog_albums
            """
        )
    ).mappings()
    for album in albums:
        bind.execute(
            text(
                """
                UPDATE global_catalog_albums
                SET artist_slug = :artist_slug, public_slug = :public_slug
                WHERE global_album_uid = :global_album_uid
                """
            ),
            {
                "global_album_uid": album["global_album_uid"],
                "artist_slug": build_artist_slug(album["artist_name"]),
                "public_slug": build_public_album_slug(album["canonical_name"]),
            },
        )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_artists_public_slug
        ON global_catalog_artists(public_slug)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_public_route
        ON global_catalog_albums(global_artist_uid, public_slug)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_albums_public_route")
    op.execute("DROP INDEX IF EXISTS idx_global_artists_public_slug")
    op.execute("ALTER TABLE global_catalog_albums DROP COLUMN IF EXISTS public_slug")
    op.execute("ALTER TABLE global_catalog_albums DROP COLUMN IF EXISTS artist_slug")
    op.execute("ALTER TABLE global_catalog_artists DROP COLUMN IF EXISTS public_slug")
