"""Persist exact acquisition source receipts and uncertain transfer attempts."""

from alembic import op
from crate.db.schema_sections.agent_acquisition_v132 import (
    create_agent_acquisition_v132_schema,
)

revision = "132"
down_revision = "131"
branch_labels = None
depends_on = None


def upgrade():
    create_agent_acquisition_v132_schema(op)


def downgrade():
    op.execute("DROP TABLE IF EXISTS agent_acquisition_transfers")
    op.execute("DROP TABLE IF EXISTS agent_acquisition_receipts")
    from crate.db.schema_sections.show_plans_v118 import PREVIOUS_GRANTS

    previous = PREVIOUS_GRANTS + ",'curation.shows.read','curation.shows.write'"
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    # Downgrade fails transactionally until newly introduced grants have been revoked.
    op.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
        AND grants <@ ARRAY[{previous}]::text[])""")
