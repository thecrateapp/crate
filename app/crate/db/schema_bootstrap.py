"""Idempotent schema bootstrap for fresh installs and bridge upgrades."""

from crate.db.schema_sections import (
    create_acquisition_schema,
    create_activity_schema,
    create_auth_schema,
    create_core_schema,
    create_curation_schema,
    create_library_schema,
)
from crate.db.schema_sections.agent_access_v109 import create_agent_access_v109_schema
from crate.db.schema_sections.agent_admin_v113 import create_agent_admin_v113_schema
from crate.db.schema_sections.agent_library_v114 import create_agent_library_v114_schema
from crate.db.schema_sections.agent_operations_v115 import (
    create_agent_operations_v115_schema,
)
from crate.db.schema_sections.agent_commands_v111 import (
    create_agent_commands_v111_schema,
)
from crate.db.schema_sections.mcp_oauth_v112 import create_mcp_oauth_v112_schema
from crate.db.schema_sections.editorial_v116 import create_editorial_v116_schema
from crate.db.schema_sections.shows_v117 import create_shows_v117_schema
from crate.db.schema_sections.show_plans_v118 import create_show_plans_v118_schema


def create_schema(cur):
    """Define the final schema shape for every table.

    New installs get all columns from the start. Existing installs that already
    have the tables will get missing columns added via the legacy bridge
    migrations and then Alembic-managed revisions.
    """

    cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    cur.execute("CREATE SEQUENCE IF NOT EXISTS library_artists_id_seq")

    create_core_schema(cur)
    create_auth_schema(cur)
    create_agent_access_v109_schema(cur)
    create_agent_commands_v111_schema(cur)
    create_mcp_oauth_v112_schema(cur)
    create_agent_admin_v113_schema(cur)
    create_library_schema(cur)
    create_agent_library_v114_schema(cur)
    create_agent_operations_v115_schema(cur)
    cur.execute(
        """
        DELETE FROM stream_variants sv
        WHERE sv.track_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM library_tracks lt WHERE lt.id = sv.track_id
          )
        """
    )
    cur.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_stream_variants_track'
                  AND conrelid = 'stream_variants'::regclass
            ) THEN
                ALTER TABLE stream_variants
                ADD CONSTRAINT fk_stream_variants_track
                FOREIGN KEY (track_id) REFERENCES library_tracks(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )
    create_acquisition_schema(cur)
    create_curation_schema(cur)
    create_activity_schema(cur)
    create_editorial_v116_schema(cur)
    create_shows_v117_schema(cur)
    create_show_plans_v118_schema(cur)
