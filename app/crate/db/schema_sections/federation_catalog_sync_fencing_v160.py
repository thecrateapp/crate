"""Per-peer sync generations that fence stale catalog sync sessions (FED-D11).

A session increments ``federation_catalog_cursors.sync_generation`` under the
row lock when it starts, and every later write re-checks it. Writers that
check it declare that in the transaction-local setting below.

The triggers are the database half of the fence:

* the generation never moves backwards;
* disabling a peer, or moving it out of ``approved``, bumps the generation in
  the same transaction, so a running session is fenced whoever revoked it;
* writers that do not declare the fence (images older than migration 160)
  keep working until the first fenced session starts, and from then on cannot
  move a peer's checkpoint or write its catalog rows while it is approved.
"""

FENCE_SETTING = "crate.federation_catalog_sync_fence"

FEDERATION_CATALOG_SYNC_FENCING_STATEMENTS = (
    """
    ALTER TABLE federation_catalog_cursors
        ADD COLUMN IF NOT EXISTS sync_generation BIGINT NOT NULL DEFAULT 0
    """,
    f"""
    CREATE OR REPLACE FUNCTION guard_federation_catalog_cursor_fence()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF NEW.sync_generation < OLD.sync_generation THEN
            RAISE EXCEPTION
                'federation catalog sync generation for % cannot move backwards (% -> %)',
                OLD.node_uid, OLD.sync_generation, NEW.sync_generation;
        END IF;
        IF OLD.sync_generation > 0
           AND COALESCE(current_setting('{FENCE_SETTING}', true), '') = ''
           AND (
               NEW.cursor IS DISTINCT FROM OLD.cursor
               OR NEW.last_applied_cursor IS DISTINCT FROM OLD.last_applied_cursor
               OR NEW.snapshot_cursor IS DISTINCT FROM OLD.snapshot_cursor
               OR NEW.sync_session_uid IS DISTINCT FROM OLD.sync_session_uid
               OR NEW.full_sync_completed_at IS DISTINCT FROM OLD.full_sync_completed_at
           )
        THEN
            RAISE EXCEPTION
                'federation catalog sync fenced: peer % has a fenced sync session '
                '(generation %) and this writer does not declare one',
                OLD.node_uid, OLD.sync_generation;
        END IF;
        RETURN NEW;
    END $$
    """,
    "DROP TRIGGER IF EXISTS guard_federation_catalog_cursor_fence "
    "ON federation_catalog_cursors",
    """
    CREATE TRIGGER guard_federation_catalog_cursor_fence
    BEFORE UPDATE ON federation_catalog_cursors
    FOR EACH ROW EXECUTE FUNCTION guard_federation_catalog_cursor_fence()
    """,
    f"""
    CREATE OR REPLACE FUNCTION guard_federation_catalog_item_fence()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF COALESCE(current_setting('{FENCE_SETTING}', true), '') <> '' THEN
            RETURN NEW;
        END IF;
        -- A disabled or revoked peer is never protected: disabling it must
        -- always be able to tombstone its rows.
        IF EXISTS (
            SELECT 1
            FROM federation_catalog_cursors cursors
            JOIN federation_nodes peer ON peer.node_uid = cursors.node_uid
            WHERE cursors.node_uid = NEW.node_uid
              AND cursors.sync_generation > 0
              AND peer.trust_state = 'approved'
              AND peer.disabled_at IS NULL
        ) THEN
            RAISE EXCEPTION
                'federation catalog sync fenced: peer % has a fenced sync session '
                'and this writer does not declare one',
                NEW.node_uid;
        END IF;
        RETURN NEW;
    END $$
    """,
    "DROP TRIGGER IF EXISTS guard_federation_catalog_item_fence "
    "ON federation_catalog_items",
    """
    CREATE TRIGGER guard_federation_catalog_item_fence
    BEFORE INSERT OR UPDATE ON federation_catalog_items
    FOR EACH ROW EXECUTE FUNCTION guard_federation_catalog_item_fence()
    """,
    """
    CREATE OR REPLACE FUNCTION fence_federation_catalog_sync_on_revocation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        UPDATE federation_catalog_cursors
        SET sync_generation = sync_generation + 1, updated_at = NOW()
        WHERE node_uid = NEW.node_uid;
        RETURN NEW;
    END $$
    """,
    "DROP TRIGGER IF EXISTS fence_federation_catalog_sync_on_revocation "
    "ON federation_nodes",
    """
    CREATE TRIGGER fence_federation_catalog_sync_on_revocation
    AFTER UPDATE OF trust_state, disabled_at ON federation_nodes
    FOR EACH ROW
    WHEN (
        (OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL)
        OR (
            OLD.trust_state = 'approved'
            AND NEW.trust_state IS DISTINCT FROM 'approved'
        )
    )
    EXECUTE FUNCTION fence_federation_catalog_sync_on_revocation()
    """,
)


def create_federation_catalog_sync_fencing_v160_schema(cur) -> None:
    for statement in FEDERATION_CATALOG_SYNC_FENCING_STATEMENTS:
        cur.execute(statement)


def drop_federation_catalog_sync_fencing_v160_schema(cur) -> None:
    cur.execute(
        "DROP TRIGGER IF EXISTS fence_federation_catalog_sync_on_revocation "
        "ON federation_nodes"
    )
    cur.execute("DROP FUNCTION IF EXISTS fence_federation_catalog_sync_on_revocation()")
    cur.execute(
        "DROP TRIGGER IF EXISTS guard_federation_catalog_item_fence "
        "ON federation_catalog_items"
    )
    cur.execute("DROP FUNCTION IF EXISTS guard_federation_catalog_item_fence()")
    cur.execute(
        "DROP TRIGGER IF EXISTS guard_federation_catalog_cursor_fence "
        "ON federation_catalog_cursors"
    )
    cur.execute("DROP FUNCTION IF EXISTS guard_federation_catalog_cursor_fence()")
    cur.execute(
        "ALTER TABLE federation_catalog_cursors DROP COLUMN IF EXISTS sync_generation"
    )


__all__ = [
    "FEDERATION_CATALOG_SYNC_FENCING_STATEMENTS",
    "FENCE_SETTING",
    "create_federation_catalog_sync_fencing_v160_schema",
    "drop_federation_catalog_sync_fencing_v160_schema",
]
