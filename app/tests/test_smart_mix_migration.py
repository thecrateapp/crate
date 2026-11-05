from __future__ import annotations

from importlib import import_module
from pathlib import Path
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from crate.db.tx import read_scope

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "app"
    / "crate"
    / "db"
    / "migrations"
    / "versions"
    / "109_smart_mix_profiles.py"
)
STRUCTURE_COLUMNS = {
    "phrases": "jsonb",
    "energy_curve": "bytea",
    "vocal_presence": "bytea",
    "structure_confidence": "real",
}


def test_migration_contract_is_isolated_from_library_tracks() -> None:
    source = MIGRATION.read_text()

    assert 'revision = "109"' in source
    assert 'down_revision = "108"' in source
    assert 'has_table("track_mix_profiles")' in source
    assert "CREATE INDEX IF NOT EXISTS" in source
    assert '"track_mix_profiles"' in source
    for column in (
        "track_id",
        "profile_version",
        "profile_revision",
        "analyzer",
        "analyzer_version",
        "source_revision",
        "quality",
        "beat_grid_format",
        "beat_grid_data",
        "key_camelot",
        "analyzed_at",
        "updated_at",
    ):
        assert f'"{column}"' in source
    assert 'op.add_column("library_tracks"' not in source
    assert 'op.drop_table("track_mix_profiles")' in source


def test_bootstrap_table_has_constraints_and_coverage_indexes(pg_db) -> None:
    del pg_db

    with read_scope() as session:
        columns = {
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'track_mix_profiles'
                    """
                )
            )
        }
        indexes = {
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'track_mix_profiles'
                    """
                )
            )
        }
        constraints = "\n".join(
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conrelid = 'track_mix_profiles'::regclass
                    """
                )
            )
        )

    assert {
        "track_id",
        "quality",
        "beat_grid_data",
        "profile_revision",
        "source_revision",
    } <= columns
    assert {
        "idx_track_mix_profiles_quality",
        "idx_track_mix_profiles_profile_revision",
        "idx_track_mix_profiles_analyzer_version",
        "idx_track_mix_profiles_updated_at",
        "idx_track_mix_profiles_source_revision",
        "idx_track_mix_profiles_pending",
    } <= indexes
    assert "quality" in constraints
    assert "bpm_confidence" in constraints
    assert "key_confidence" in constraints


def test_structure_migration_up_down(pg_db, monkeypatch) -> None:
    del pg_db
    from crate.db.engine import get_engine

    migration = import_module("crate.db.migrations.versions.147_smart_mix_structure")
    assert (migration.revision, migration.down_revision) == ("147", "146")
    with get_engine().connect() as connection:
        assert (
            connection.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        track_id = _insert_schema_one_profile(connection)
        connection.commit()
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))

        with context.begin_transaction():
            migration.downgrade()
            migration.downgrade()
        assert _structure_columns(connection) == {}

        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert _structure_columns(connection) == {
            name: (data_type, "YES") for name, data_type in STRUCTURE_COLUMNS.items()
        }
        # A profile written before the migration keeps every v1 field and reads
        # back with no structure.
        row = (
            connection.execute(
                text(
                    """
                    SELECT profile_version, analyzer_version, bpm, phrases,
                           energy_curve, vocal_presence, structure_confidence
                    FROM track_mix_profiles WHERE track_id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )
        assert dict(row) == {
            "profile_version": 1,
            "analyzer_version": "smart-mix-audio-v6",
            "bpm": 124.0,
            "phrases": None,
            "energy_curve": None,
            "vocal_presence": None,
            "structure_confidence": None,
        }


def test_bootstrap_schema_creates_the_structure_columns() -> None:
    source = (
        ROOT / "app" / "crate" / "db" / "schema_sections" / "library_catalog.py"
    ).read_text()

    assert "create_smart_mix_structure_v147_schema(cur)" in source


def _structure_columns(connection) -> dict[str, tuple[str, str]]:
    return {
        row.column_name: (row.data_type, row.is_nullable)
        for row in connection.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'track_mix_profiles'
                  AND column_name = ANY(:names)
                """
            ),
            {"names": list(STRUCTURE_COLUMNS)},
        )
    }


def _insert_schema_one_profile(connection) -> int:
    suffix = uuid.uuid4().hex
    connection.execute(
        text(
            """
            INSERT INTO library_artists (name, entity_uid)
            VALUES (:artist, CAST(:uid AS uuid))
            """
        ),
        {"artist": f"Migration Artist {suffix}", "uid": str(uuid.uuid4())},
    )
    album_id = connection.execute(
        text(
            """
            INSERT INTO library_albums (artist, name, path, entity_uid)
            VALUES (:artist, :album, :path, CAST(:uid AS uuid))
            RETURNING id
            """
        ),
        {
            "artist": f"Migration Artist {suffix}",
            "album": f"Album {suffix}",
            "path": f"/music/migration-{suffix}",
            "uid": str(uuid.uuid4()),
        },
    ).scalar_one()
    track_id = connection.execute(
        text(
            """
            INSERT INTO library_tracks (
                album_id, artist, album, filename, title, path, entity_uid, duration
            )
            VALUES (
                :album_id, :artist, :album, 'track.flac', 'Track', :path,
                CAST(:uid AS uuid), 180.0
            )
            RETURNING id
            """
        ),
        {
            "album_id": album_id,
            "artist": f"Migration Artist {suffix}",
            "album": f"Album {suffix}",
            "path": f"/music/migration-{suffix}/track.flac",
            "uid": str(uuid.uuid4()),
        },
    ).scalar_one()
    connection.execute(
        text(
            """
            INSERT INTO track_mix_profiles (
                track_id, profile_version, profile_revision, analyzer,
                analyzer_version, source_revision, quality, bpm, analyzed_at
            )
            VALUES (
                :track_id, 1, 'revision', 'crate-rust', 'smart-mix-audio-v6',
                'source', 'full', 124.0, NOW()
            )
            """
        ),
        {"track_id": track_id},
    )
    return int(track_id)


def test_vocal_detector_migration_up_down(pg_db, monkeypatch) -> None:
    del pg_db
    from crate.db.engine import get_engine

    migration = import_module(
        "crate.db.migrations.versions.148_smart_mix_vocal_detector"
    )
    assert (migration.revision, migration.down_revision) == ("148", "147")
    with get_engine().connect() as connection:
        assert (
            connection.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))

        with context.begin_transaction():
            migration.downgrade()
            migration.downgrade()
        assert _vocal_detector_column(connection) is None

        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert _vocal_detector_column(connection) == ("text", "YES")


def test_bootstrap_schema_creates_the_vocal_detector_column() -> None:
    source = (
        ROOT / "app" / "crate" / "db" / "schema_sections" / "library_catalog.py"
    ).read_text()

    assert "create_smart_mix_vocal_detector_v148_schema(cur)" in source


def _vocal_detector_column(connection) -> tuple[str, str] | None:
    row = connection.execute(
        text(
            """
            SELECT data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'track_mix_profiles'
              AND column_name = 'vocal_detector'
            """
        )
    ).first()
    return None if row is None else (row.data_type, row.is_nullable)


def test_beat_tracker_migration_up_down(pg_db, monkeypatch) -> None:
    del pg_db
    from crate.db.engine import get_engine

    migration = import_module("crate.db.migrations.versions.149_smart_mix_beat_tracker")
    assert (migration.revision, migration.down_revision) == ("149", "148")
    with get_engine().connect() as connection:
        assert (
            connection.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))

        with context.begin_transaction():
            migration.downgrade()
            migration.downgrade()
        assert _profile_column(connection, "beat_tracker") is None

        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert _profile_column(connection, "beat_tracker") == ("text", "YES")


def test_bootstrap_schema_creates_the_beat_tracker_column() -> None:
    source = (
        ROOT / "app" / "crate" / "db" / "schema_sections" / "library_catalog.py"
    ).read_text()

    assert "create_smart_mix_beat_tracker_v149_schema(cur)" in source


def _profile_column(connection, column: str) -> tuple[str, str] | None:
    row = connection.execute(
        text(
            """
            SELECT data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'track_mix_profiles'
              AND column_name = :column
            """
        ),
        {"column": column},
    ).first()
    return None if row is None else (row.data_type, row.is_nullable)
