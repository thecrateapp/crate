"""Durable catalog publication intents and exact feed retention boundaries."""

FEDERATION_CATALOG_PUBLICATION_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS federation_catalog_change_outbox (
        id BIGSERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_uid TEXT NOT NULL,
        operation TEXT NOT NULL
            CHECK (operation IN ('upsert', 'delete', 'hide', 'restore')),
        payload_revision TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        retention_until TIMESTAMPTZ NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS federation_catalog_feed_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        last_published_sequence BIGINT NOT NULL DEFAULT 0,
        last_pruned_sequence BIGINT NOT NULL DEFAULT 0,
        CHECK (last_published_sequence >= last_pruned_sequence)
    )
    """,
    # Match the publisher's state -> feed order. The feed barrier waits for old
    # in-flight direct inserts before seeding the watermark; later old-image
    # inserts cannot enter until their redirect trigger has committed.
    "LOCK TABLE federation_catalog_feed_state IN EXCLUSIVE MODE",
    "LOCK TABLE federation_catalog_changes IN ACCESS EXCLUSIVE MODE",
    """
    INSERT INTO federation_catalog_feed_state (
        singleton, last_published_sequence, last_pruned_sequence
    )
    SELECT TRUE,
           COALESCE(MAX(sequence), (
               SELECT CASE WHEN is_called THEN last_value ELSE 0 END
               FROM federation_catalog_changes_sequence_seq
           )),
           COALESCE(MIN(sequence) - 1, (
               SELECT CASE WHEN is_called THEN last_value ELSE 0 END
               FROM federation_catalog_changes_sequence_seq
           ))
    FROM federation_catalog_changes
    ON CONFLICT (singleton) DO UPDATE SET last_published_sequence = GREATEST(
        federation_catalog_feed_state.last_published_sequence,
        EXCLUDED.last_published_sequence
    )
    """,
    """
    CREATE OR REPLACE FUNCTION stage_legacy_federation_catalog_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF current_setting('crate.federation_catalog_publisher', true) = 'on' THEN
            RETURN NEW;
        END IF;
        INSERT INTO federation_catalog_change_outbox (
            entity_type, entity_uid, operation, payload_revision,
            payload_json, occurred_at, retention_until
        ) VALUES (
            NEW.entity_type, NEW.entity_uid, NEW.operation, NEW.payload_revision,
            NEW.payload_json, NEW.occurred_at, NEW.retention_until
        );
        RETURN NULL;
    END $$
    """,
    "DROP TRIGGER IF EXISTS stage_legacy_federation_catalog_change ON federation_catalog_changes",
    """
    CREATE TRIGGER stage_legacy_federation_catalog_change
    BEFORE INSERT ON federation_catalog_changes
    FOR EACH ROW EXECUTE FUNCTION stage_legacy_federation_catalog_change()
    """,
)


def create_federation_catalog_publication_v159_schema(cur) -> None:
    for statement in FEDERATION_CATALOG_PUBLICATION_STATEMENTS:
        cur.execute(statement)


def drop_federation_catalog_publication_v159_schema(cur) -> None:
    # Downgrades preserve committed pending intents before removing the outbox.
    # The legacy unique key is deliberately retained by the additive upgrade.
    cur.execute(
        "SELECT * FROM federation_catalog_feed_state WHERE singleton FOR UPDATE"
    )
    cur.execute("LOCK TABLE federation_catalog_changes IN ACCESS EXCLUSIVE MODE")
    cur.execute("LOCK TABLE federation_catalog_change_outbox IN ACCESS EXCLUSIVE MODE")
    cur.execute("SELECT set_config('crate.federation_catalog_publisher', 'on', true)")
    cur.execute("""
        DO $$
        DECLARE intent RECORD;
        BEGIN
            FOR intent IN SELECT * FROM federation_catalog_change_outbox ORDER BY id
            LOOP
                INSERT INTO federation_catalog_changes (
                    entity_type, entity_uid, operation, payload_revision,
                    payload_json, occurred_at, retention_until
                ) VALUES (
                    intent.entity_type, intent.entity_uid, intent.operation,
                    intent.payload_revision, intent.payload_json, intent.occurred_at,
                    GREATEST(intent.retention_until, NOW() + INTERVAL '90 days')
                )
                ON CONFLICT (entity_type, entity_uid, payload_revision, operation)
                DO UPDATE SET sequence = EXCLUDED.sequence,
                              payload_json = EXCLUDED.payload_json,
                              occurred_at = EXCLUDED.occurred_at,
                              retention_until = EXCLUDED.retention_until;
            END LOOP;
        END $$
    """)
    cur.execute("""
        UPDATE federation_catalog_feed_state
        SET last_published_sequence = GREATEST(
            last_published_sequence,
            COALESCE((SELECT MAX(sequence) FROM federation_catalog_changes), 0)
        ) WHERE singleton
    """)
    cur.execute(
        "DROP TRIGGER IF EXISTS stage_legacy_federation_catalog_change ON federation_catalog_changes"
    )
    cur.execute("DROP FUNCTION IF EXISTS stage_legacy_federation_catalog_change()")
    cur.execute("DROP TABLE IF EXISTS federation_catalog_change_outbox")
    # Keep this tiny recovery singleton across downgrade: MIN(sequence) cannot
    # distinguish compacted/rolled-back gaps from pruned history on re-upgrade.
    # Legacy application images ignore it and retain their existing unique key.


__all__ = [
    "FEDERATION_CATALOG_PUBLICATION_STATEMENTS",
    "create_federation_catalog_publication_v159_schema",
    "drop_federation_catalog_publication_v159_schema",
]
