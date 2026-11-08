"""Store the ranked candidates of the Smart Mix backfill."""

from alembic import op

from crate.db.schema_sections.smart_mix_backfill_candidates_v155 import (
    create_smart_mix_backfill_candidates_v155_schema,
    drop_smart_mix_backfill_candidates_v155_schema,
)

revision = "155"
down_revision = "154"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_backfill_candidates_v155_schema(op)


def downgrade() -> None:
    # Only a cache: revision 154 ranks the library on every claim.
    drop_smart_mix_backfill_candidates_v155_schema(op)
