"""Store the ranked candidates of the Smart Mix backfill."""

from alembic import op

from crate.db.schema_sections.smart_mix_backfill_candidates_v154 import (
    create_smart_mix_backfill_candidates_v154_schema,
    drop_smart_mix_backfill_candidates_v154_schema,
)

revision = "154"
down_revision = "153"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_backfill_candidates_v154_schema(op)


def downgrade() -> None:
    # Only a cache: revision 153 ranks the library on every claim.
    drop_smart_mix_backfill_candidates_v154_schema(op)
