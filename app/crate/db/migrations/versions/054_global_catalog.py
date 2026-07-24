"""Global federated catalog read model.

Revision ID: 054
Revises: 053
"""

from collections.abc import Sequence

from alembic import op


revision = "054"
down_revision = "053"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_artists (
            global_artist_uid UUID PRIMARY KEY,
            canonical_name TEXT NOT NULL,
            sort_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            musicbrainz_artist_mbid TEXT,
            aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            local_artist_id BIGINT,
            local_artist_entity_uid UUID,
            display_source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            availability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            source_count INTEGER NOT NULL DEFAULT 0,
            has_local BOOLEAN NOT NULL DEFAULT false,
            has_remote BOOLEAN NOT NULL DEFAULT false,
            has_photo BOOLEAN NOT NULL DEFAULT false,
            search_vector TSVECTOR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_artists_mbid_unique
        ON global_catalog_artists(musicbrainz_artist_mbid)
        WHERE musicbrainz_artist_mbid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_artists_normalized_name
        ON global_catalog_artists(normalized_name)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_artists_search_fts
        ON global_catalog_artists USING gin(search_vector)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_artists_name_trgm
        ON global_catalog_artists USING gin(canonical_name gin_trgm_ops)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_albums (
            global_album_uid UUID PRIMARY KEY,
            global_artist_uid UUID NOT NULL
                REFERENCES global_catalog_artists(global_artist_uid)
                ON DELETE CASCADE,
            canonical_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            year TEXT,
            release_date TEXT,
            track_count INTEGER,
            total_duration_seconds INTEGER,
            musicbrainz_release_group_mbid TEXT,
            musicbrainz_release_mbid TEXT,
            upc TEXT,
            local_album_id BIGINT,
            local_album_entity_uid UUID,
            display_source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            artwork_source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            availability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            source_count INTEGER NOT NULL DEFAULT 0,
            has_local BOOLEAN NOT NULL DEFAULT false,
            has_remote BOOLEAN NOT NULL DEFAULT false,
            has_cover BOOLEAN NOT NULL DEFAULT false,
            search_vector TSVECTOR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_artist_uid
        ON global_catalog_albums(global_artist_uid)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_normalized_year
        ON global_catalog_albums(normalized_name, year)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_albums_release_mbid_unique
        ON global_catalog_albums(musicbrainz_release_mbid)
        WHERE musicbrainz_release_mbid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_release_group_mbid
        ON global_catalog_albums(musicbrainz_release_group_mbid)
        WHERE musicbrainz_release_group_mbid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_upc
        ON global_catalog_albums(upc)
        WHERE upc IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_search_fts
        ON global_catalog_albums USING gin(search_vector)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_albums_name_trgm
        ON global_catalog_albums USING gin(canonical_name gin_trgm_ops)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_tracks (
            global_track_uid UUID PRIMARY KEY,
            global_album_uid UUID
                REFERENCES global_catalog_albums(global_album_uid)
                ON DELETE SET NULL,
            global_artist_uid UUID NOT NULL
                REFERENCES global_catalog_artists(global_artist_uid)
                ON DELETE CASCADE,
            canonical_title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            album_name TEXT,
            disc_number INTEGER,
            track_number INTEGER,
            duration_seconds INTEGER,
            musicbrainz_recording_mbid TEXT,
            isrc TEXT,
            local_track_id BIGINT,
            local_track_entity_uid UUID,
            display_source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            availability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            source_count INTEGER NOT NULL DEFAULT 0,
            has_local BOOLEAN NOT NULL DEFAULT false,
            has_remote BOOLEAN NOT NULL DEFAULT false,
            search_vector TSVECTOR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_album_uid
        ON global_catalog_tracks(global_album_uid)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_artist_uid
        ON global_catalog_tracks(global_artist_uid)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_normalized_duration
        ON global_catalog_tracks(normalized_title, duration_seconds)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_tracks_recording_mbid_unique
        ON global_catalog_tracks(musicbrainz_recording_mbid)
        WHERE musicbrainz_recording_mbid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_isrc
        ON global_catalog_tracks(isrc)
        WHERE isrc IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_search_fts
        ON global_catalog_tracks USING gin(search_vector)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_title_trgm
        ON global_catalog_tracks USING gin(canonical_title gin_trgm_ops)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_sources (
            id BIGSERIAL PRIMARY KEY,
            entity_type TEXT NOT NULL,
            global_entity_uid UUID NOT NULL,
            source_kind TEXT NOT NULL,
            node_uid UUID,
            remote_entity_uid TEXT,
            local_id BIGINT,
            local_entity_uid UUID,
            source_revision TEXT,
            source_deleted_at TIMESTAMPTZ,
            source_stale BOOLEAN NOT NULL DEFAULT false,
            source_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            match_key TEXT NOT NULL,
            match_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
            match_method TEXT NOT NULL DEFAULT 'unknown',
            preferred_for_display BOOLEAN NOT NULL DEFAULT false,
            preferred_for_artwork BOOLEAN NOT NULL DEFAULT false,
            preferred_for_playback BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT global_catalog_sources_entity_type_check
                CHECK (entity_type IN ('artist', 'album', 'track')),
            CONSTRAINT global_catalog_sources_kind_check
                CHECK (source_kind IN ('local', 'federated')),
            CONSTRAINT global_catalog_sources_local_ref_check
                CHECK (
                    source_kind <> 'local'
                    OR local_id IS NOT NULL
                    OR local_entity_uid IS NOT NULL
                ),
            CONSTRAINT global_catalog_sources_remote_ref_check
                CHECK (
                    source_kind <> 'federated'
                    OR (node_uid IS NOT NULL AND remote_entity_uid IS NOT NULL)
                )
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_sources_local_entity_unique
        ON global_catalog_sources(entity_type, local_entity_uid)
        WHERE source_kind = 'local' AND local_entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_sources_local_id_unique
        ON global_catalog_sources(entity_type, local_id)
        WHERE source_kind = 'local' AND local_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_sources_remote_entity_unique
        ON global_catalog_sources(node_uid, entity_type, remote_entity_uid)
        WHERE source_kind = 'federated'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_sources_entity
        ON global_catalog_sources(entity_type, global_entity_uid)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_sources_node
        ON global_catalog_sources(node_uid)
        WHERE node_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_sources_match_key
        ON global_catalog_sources(entity_type, match_key)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_match_decisions (
            decision_id UUID PRIMARY KEY,
            entity_type TEXT NOT NULL,
            decision_type TEXT NOT NULL,
            source_a_json JSONB NOT NULL,
            source_b_json JSONB NOT NULL,
            target_global_uid UUID,
            reason TEXT,
            admin_user_id BIGINT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT global_catalog_decisions_entity_type_check
                CHECK (entity_type IN ('artist', 'album', 'track')),
            CONSTRAINT global_catalog_decisions_type_check
                CHECK (
                    decision_type IN (
                        'force_merge',
                        'force_split',
                        'ignore_candidate'
                    )
                )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_match_decisions_entity
        ON global_catalog_match_decisions(entity_type, target_global_uid)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_reconciliation_runs (
            run_id UUID PRIMARY KEY,
            mode TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ,
            peer_count INTEGER NOT NULL DEFAULT 0,
            source_rows_seen INTEGER NOT NULL DEFAULT 0,
            sources_upserted INTEGER NOT NULL DEFAULT 0,
            canonical_created INTEGER NOT NULL DEFAULT 0,
            canonical_updated INTEGER NOT NULL DEFAULT 0,
            auto_merged INTEGER NOT NULL DEFAULT 0,
            ambiguous_candidates INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT global_catalog_runs_mode_check
                CHECK (mode IN ('incremental', 'full', 'peer', 'local'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_reconciliation_runs_status
        ON global_catalog_reconciliation_runs(status, started_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS global_catalog_reconciliation_runs")
    op.execute("DROP TABLE IF EXISTS global_catalog_match_decisions")
    op.execute("DROP TABLE IF EXISTS global_catalog_sources")
    op.execute("DROP TABLE IF EXISTS global_catalog_tracks")
    op.execute("DROP TABLE IF EXISTS global_catalog_albums")
    op.execute("DROP TABLE IF EXISTS global_catalog_artists")
