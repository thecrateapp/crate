"""Repair stale global genre assertions after alias provenance cleanup.

Revision ID: 078
Revises: 077
"""

from collections.abc import Sequence

from alembic import op


revision = "078"
down_revision = "077"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE crate_stale_genre_alias_assertions
        ON COMMIT DROP AS
        SELECT
            assertion.id AS assertion_id,
            source.entity_type,
            source.global_entity_uid
        FROM global_catalog_genre_assertions assertion
        JOIN global_catalog_sources source ON source.id = assertion.source_id
        WHERE assertion.invalidated_at IS NULL
          AND assertion.global_genre_uid IS NOT NULL
          AND assertion.mapping_method IN ('local_alias', 'receiver_mapping')
          AND source.source_deleted_at IS NULL
          AND NOT source.source_stale
          AND NOT EXISTS (
              SELECT 1
              FROM genre_taxonomy_nodes node
              WHERE node.taxonomy_id = 'crate-core'
                AND node.global_genre_uid = assertion.global_genre_uid
                AND (
                    node.slug = trim(
                        both '-' from regexp_replace(
                            lower(assertion.raw_label),
                            '[^a-z0-9]+',
                            '-',
                            'g'
                        )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM genre_taxonomy_aliases alias
                        WHERE alias.genre_id = node.id
                          AND (
                              alias.alias_slug = trim(
                                  both '-' from regexp_replace(
                                      lower(assertion.raw_label),
                                      '[^a-z0-9]+',
                                      '-',
                                      'g'
                                  )
                              )
                              OR lower(alias.alias_name) = lower(assertion.raw_label)
                          )
                    )
                )
          )
        """
    )
    op.execute(
        """
        UPDATE global_catalog_genre_assertions assertion
        SET invalidated_at = NOW()
        FROM crate_stale_genre_alias_assertions stale
        WHERE assertion.id = stale.assertion_id
          AND assertion.invalidated_at IS NULL
        """
    )
    op.execute(
        """
        DELETE FROM global_catalog_entity_genres membership
        USING (
            SELECT DISTINCT entity_type, global_entity_uid
            FROM crate_stale_genre_alias_assertions
        ) affected
        WHERE membership.entity_type = affected.entity_type
          AND membership.global_entity_uid = affected.global_entity_uid
        """
    )
    op.execute(
        """
        INSERT INTO global_catalog_entity_genres (
            entity_type,
            global_entity_uid,
            global_genre_uid,
            direct_score,
            aggregate_score,
            supporting_source_count,
            supporting_node_count,
            preferred_for_display,
            computed_at
        )
        SELECT
            source.entity_type,
            source.global_entity_uid,
            assertion.global_genre_uid,
            LEAST(
                1.0,
                SUM(
                    CASE WHEN assertion.is_direct
                        THEN assertion.weight * assertion.confidence
                        ELSE 0
                    END
                )
            ) AS direct_score,
            LEAST(1.0, SUM(assertion.weight * assertion.confidence))
                AS aggregate_score,
            COUNT(DISTINCT source.id)::integer AS supporting_source_count,
            COUNT(DISTINCT COALESCE(source.node_uid::text, 'local'))::integer
                AS supporting_node_count,
            BOOL_OR(source.preferred_for_display) AS preferred_for_display,
            NOW()
        FROM global_catalog_genre_assertions assertion
        JOIN global_catalog_sources source ON source.id = assertion.source_id
        JOIN (
            SELECT DISTINCT entity_type, global_entity_uid
            FROM crate_stale_genre_alias_assertions
        ) affected
          ON affected.entity_type = source.entity_type
         AND affected.global_entity_uid = source.global_entity_uid
        WHERE assertion.invalidated_at IS NULL
          AND assertion.global_genre_uid IS NOT NULL
          AND source.source_deleted_at IS NULL
          AND NOT source.source_stale
        GROUP BY
            source.entity_type,
            source.global_entity_uid,
            assertion.global_genre_uid
        ON CONFLICT (entity_type, global_entity_uid, global_genre_uid)
        DO UPDATE SET
            direct_score = EXCLUDED.direct_score,
            aggregate_score = EXCLUDED.aggregate_score,
            supporting_source_count = EXCLUDED.supporting_source_count,
            supporting_node_count = EXCLUDED.supporting_node_count,
            preferred_for_display = EXCLUDED.preferred_for_display,
            computed_at = EXCLUDED.computed_at
        """
    )


def downgrade() -> None:
    # Invalidated mappings referenced aliases that no longer exist. Restoring
    # those assertions would reintroduce the corrupt genre memberships.
    pass
