"""Internal human show plans reuse the credential-bound operation engine."""

from alembic import op

from crate.db.schema_sections.show_plans_v118 import (
    create_show_plans_v118_schema,
    PREVIOUS_GRANTS,
)

revision = "128"
down_revision = "127"
branch_labels = None
depends_on = None


def upgrade():
    create_show_plans_v118_schema(op)


def downgrade():
    op.execute("""UPDATE tasks SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'failed' END,
        error='Show operations disabled by rollback; inspect effects',updated_at=NOW()
        WHERE id IN (SELECT task_id FROM agent_jobs WHERE payload->>'domain_operation'='shows_import')
        AND status IN ('pending','running','delegated','completing')""")
    op.execute(
        "DELETE FROM agent_requests WHERE task_id IN (SELECT task_id FROM agent_jobs WHERE payload->>'domain_operation'='shows_import')"
    )
    op.execute(
        "DELETE FROM agent_jobs WHERE payload->>'domain_operation'='shows_import'"
    )
    op.execute("DELETE FROM agent_repair_plans WHERE operation='shows_import'")
    op.execute("DELETE FROM agent_principals WHERE kind='human'")
    op.execute(f"""UPDATE agent_principals SET enabled=FALSE,
        grants=CASE WHEN grants && ARRAY[{PREVIOUS_GRANTS}]::text[] THEN ARRAY(
            SELECT g FROM unnest(grants) g WHERE g=ANY(ARRAY[{PREVIOUS_GRANTS}]::text[]))
            ELSE ARRAY['library.health.read']::text[] END
        WHERE grants && ARRAY['curation.shows.read','curation.shows.write']::text[]""")
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    op.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK(cardinality(grants)>0 AND array_position(grants,NULL) IS NULL AND grants <@ ARRAY[{PREVIOUS_GRANTS}]::text[])""")
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_human_owner_check"
    )
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_kind_check"
    )
    op.execute(
        "ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_kind_check CHECK (kind IN ('service','delegated'))"
    )
    op.execute("DROP INDEX IF EXISTS idx_show_editor_principal")
    op.execute("ALTER TABLE agent_principals DROP COLUMN IF EXISTS human_owner_user_id")
