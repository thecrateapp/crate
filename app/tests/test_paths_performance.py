from contextlib import contextmanager
from importlib import import_module
from unittest.mock import MagicMock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

_INDEX_NAME = "idx_library_tracks_bliss_embedding_cosine_hnsw"
_MIGRATION = "crate.db.migrations.versions.139_restore_bliss_cosine_index"


class _MigrationRecorder:
    def __init__(self, catalog_states=(False, True)):
        self.statements = []
        self.in_autocommit = False
        self.catalog_states = iter(catalog_states)

    def get_bind(self):
        return self

    def get_context(self):
        return self

    @contextmanager
    def autocommit_block(self):
        assert not self.in_autocommit
        self.in_autocommit = True
        try:
            yield
        finally:
            self.in_autocommit = False

    def execute(self, statement, parameters=None):
        sql = " ".join(str(statement).split())
        if "CONCURRENTLY" in sql.upper():
            assert self.in_autocommit
        self.statements.append(sql)
        if "pg_index" in sql.lower():
            return _CatalogResult(next(self.catalog_states))


class _CatalogResult:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


def _index_state(connection):
    row = (
        connection.execute(
            text("""
                SELECT index_class.oid AS index_oid,
                       index_info.indisvalid AS valid,
                       index_info.indisready AS ready,
                       access_method.amname AS method,
                       operator_class.opcname AS operator_class,
                       attribute.attname AS column_name,
                       pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate
                FROM pg_index index_info
                JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
                JOIN pg_class table_class ON table_class.oid = index_info.indrelid
                JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
                JOIN pg_am access_method ON access_method.oid = index_class.relam
                JOIN pg_opclass operator_class ON operator_class.oid = index_info.indclass[0]
                JOIN pg_attribute attribute ON attribute.attrelid = table_class.oid
                    AND attribute.attnum = index_info.indkey[0]
                WHERE namespace.nspname = current_schema()
                  AND table_class.relname = 'library_tracks'
                  AND index_class.relname = :index_name
            """),
            {"index_name": _INDEX_NAME},
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row else None


@pytest.fixture
def repair_database(pg_db, monkeypatch):
    from crate.db.engine import get_engine

    migration = import_module(_MIGRATION)
    with get_engine().connect() as connection:
        database_name = connection.execute(
            text("SELECT current_database()")
        ).scalar_one()
        assert database_name.startswith("crate_test_case_")
        connection.rollback()
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        yield connection, context, migration


def test_missing_cosine_index_is_repaired_with_the_original_operator_class(
    repair_database,
):
    connection, context, migration = repair_database
    connection.execute(text(f"DROP INDEX IF EXISTS {_INDEX_NAME}"))
    connection.commit()
    assert _index_state(connection) is None
    connection.rollback()

    with context.begin_transaction():
        migration.upgrade()

    restored = _index_state(connection)
    assert restored is not None
    assert restored["valid"] and restored["ready"]
    assert restored["method"] == "hnsw"
    assert restored["operator_class"] == "vector_cosine_ops"
    assert restored["column_name"] == "bliss_embedding"
    assert restored["predicate"].strip("()") == "bliss_embedding IS NOT NULL"


def test_repair_is_idempotent_and_keeps_an_existing_healthy_index(repair_database):
    connection, context, migration = repair_database
    original = _index_state(connection)
    assert original is not None and original["valid"]
    connection.rollback()

    for _ in range(2):
        with context.begin_transaction():
            migration.upgrade()

    assert _index_state(connection) == original


def test_repair_downgrade_preserves_the_index_owned_by_revision_027(repair_database):
    connection, context, migration = repair_database
    original = _index_state(connection)
    assert original is not None
    connection.rollback()

    with context.begin_transaction():
        migration.downgrade()

    assert _index_state(connection) == original


def test_repair_builds_concurrently_outside_a_transaction(monkeypatch):
    migration = import_module(_MIGRATION)
    recorder = _MigrationRecorder()
    monkeypatch.setattr(migration, "op", recorder)

    migration.upgrade()

    creates = [
        statement
        for statement in recorder.statements
        if statement.upper().startswith("CREATE INDEX")
    ]
    assert len(creates) == 1
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in creates[0].upper()
    assert _INDEX_NAME in creates[0]
    assert "USING hnsw (bliss_embedding vector_cosine_ops)" in creates[0]
    assert "WHERE bliss_embedding IS NOT NULL" in creates[0]
    assert recorder.in_autocommit is False


def test_repair_rebuilds_an_invalid_index_concurrently(monkeypatch):
    migration = import_module(_MIGRATION)
    recorder = _MigrationRecorder(catalog_states=(True, True))
    monkeypatch.setattr(migration, "op", recorder)

    migration.upgrade()

    ddl = [
        statement
        for statement in recorder.statements
        if statement.upper().startswith(("DROP INDEX", "CREATE INDEX"))
    ]
    assert len(ddl) == 2
    assert ddl[0].upper().startswith("DROP INDEX CONCURRENTLY IF EXISTS")
    assert _INDEX_NAME in ddl[0]
    assert ddl[1].upper().startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS")
    assert _INDEX_NAME in ddl[1]
    assert recorder.in_autocommit is False


def test_repair_rejects_an_index_that_is_still_invalid_after_rebuild(monkeypatch):
    migration = import_module(_MIGRATION)
    recorder = _MigrationRecorder(catalog_states=(True, False))
    monkeypatch.setattr(migration, "op", recorder)

    with pytest.raises(RuntimeError):
        migration.upgrade()

    assert recorder.in_autocommit is False


@pytest.mark.parametrize("ready", [True, False], ids=["invalid", "invalid-not-ready"])
def test_repair_restores_an_invalid_cosine_index_in_postgres(repair_database, ready):
    connection, context, migration = repair_database
    connection.execute(
        text("""
            UPDATE pg_index SET indisvalid = FALSE, indisready = :ready
            WHERE indexrelid = to_regclass(:index_name)
        """),
        {"ready": ready, "index_name": _INDEX_NAME},
    )
    connection.commit()
    original = _index_state(connection)
    assert original is not None and not original["valid"]
    assert original["ready"] is ready
    connection.rollback()

    with context.begin_transaction():
        migration.upgrade()

    restored = _index_state(connection)
    assert restored is not None
    assert restored["valid"] and restored["ready"]
    assert restored["index_oid"] != original["index_oid"]
    assert restored["method"] == "hnsw"
    assert restored["operator_class"] == "vector_cosine_ops"
    assert restored["predicate"].strip("()") == "bliss_embedding IS NOT NULL"


@pytest.mark.parametrize("endpoint", ["artist", "genre"])
def test_scene_relation_counts_fold_artist_case_without_duplicating_tracks(
    pg_db, endpoint
):
    from crate.db.queries.paths_scene_queries import (
        list_artist_scene_anchor_candidates,
        list_scene_path_candidates,
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        owner_id = session.execute(
            text(
                "INSERT INTO library_artists (name) VALUES ('Case Artist') RETURNING id"
            )
        ).scalar_one()
        session.execute(
            text("INSERT INTO library_artists (name) VALUES ('case artist')")
        )
        album_id = pg_db.upsert_album(
            {
                "artist": "Case Artist",
                "name": "Case Album",
                "path": "/music/Case Artist/Case Album",
            },
            session=session,
        )
        pg_db.set_artist_genres("Case Artist", [("punk", 1.0, "test")], session=session)
        track_ids = []
        for number in (1, 2):
            track_ids.append(
                session.execute(
                    text("""
                        INSERT INTO library_tracks (
                            album_id, artist, album, filename, title, path,
                            duration, format, bliss_vector, bliss_embedding
                        ) VALUES (
                            :album_id, 'Case Artist', 'Case Album', :filename,
                            :title, :path, 180, 'flac',
                            CAST(:vector AS DOUBLE PRECISION[]),
                            CAST(:embedding AS vector(20))
                        ) RETURNING id
                    """),
                    {
                        "album_id": album_id,
                        "filename": f"{number:02d}.flac",
                        "title": f"Case Track {number}",
                        "path": f"/music/Case Artist/Case Album/{number:02d}.flac",
                        "vector": [0.1] * 20,
                        "embedding": str([0.1] * 20),
                    },
                ).scalar_one()
            )
        session.execute(
            text("""
                INSERT INTO artist_similarities (
                    artist_name, similar_name, score, updated_at
                ) VALUES (:artist, :peer, 0.9, NOW())
            """),
            [
                {"artist": "Case Artist", "peer": "Peer1"},
                {"artist": "case artist", "peer": "Peer2"},
            ],
        )

    if endpoint == "artist":
        rows = list_artist_scene_anchor_candidates(str(owner_id))
    else:
        rows = list_scene_path_candidates(["punk"])["punk"]

    assert len(rows) == len(track_ids), [
        (row["id"], row["artist_relation_score"]) for row in rows
    ]
    assert {row["id"] for row in rows} == set(track_ids)
    assert all(row["artist_relation_score"] == pytest.approx(0.1) for row in rows)


def _candidate_session():
    session = MagicMock()
    session.execute.return_value.mappings.return_value.all.return_value = [
        {
            "id": 1,
            "title": "ANN Track",
            "artist": "ANN Artist",
            "bliss_vector": [0.1] * 20,
            "distance": 0.0,
        }
    ]

    def execute(statement, parameters=None):
        sql = str(statement).lower()
        if "current_setting" in sql:
            snapshot = MagicMock()
            settings = {"ef_search": "47", "iterative_scan": "off"}
            snapshot.mappings.return_value.one.return_value = settings
            snapshot.mappings.return_value.first.return_value = settings
            snapshot.one.return_value = ("47", "off")
            snapshot.first.return_value = ("47", "off")
            snapshot.scalar.return_value = "47" if "ef_search" in sql else "off"
            return snapshot
        return session.execute.return_value

    session.execute.side_effect = execute
    return session


def _assert_local_hnsw_settings(session, expected_limit):
    statements = [str(call.args[0]).strip() for call in session.execute.call_args_list]
    settings = {}
    for index, statement in enumerate(statements):
        if statement.lower().startswith("set local hnsw."):
            name, value = statement.lower().removeprefix("set local ").split("=", 1)
            settings[name.strip()] = (index, value.strip().strip("'"))
    assert "hnsw.ef_search" in settings, statements
    assert int(settings["hnsw.ef_search"][1]) >= expected_limit
    assert settings["hnsw.iterative_scan"][1] == "strict_order"
    ann_position = next(
        index for index, statement in enumerate(statements) if "<=>" in statement
    )
    assert all(position < ann_position for position, _ in settings.values())


@pytest.mark.parametrize("limit", [15, 60, 240])
def test_acoustic_candidates_configure_hnsw_for_the_requested_pool(limit):
    from crate.db.queries.paths_bliss_candidate_queries import find_candidate_rows

    session = _candidate_session()

    rows = find_candidate_rows(
        [0.1] * 20, {99}, limit=limit, use_track_artist=True, session=session
    )

    assert len(rows) == 1
    _assert_local_hnsw_settings(session, max(40, limit))


def test_flexible_anchor_configures_hnsw_for_its_expanded_pool():
    from crate.db.queries.paths_bliss_candidate_queries import find_anchor_track_row

    session = _candidate_session()

    row = find_anchor_track_row(
        "artist", "1", [0.1] * 20, {99}, selection_seed="session", session=session
    )

    assert row["id"] == 1
    _assert_local_hnsw_settings(session, 240)
    ann_call = next(
        call for call in session.execute.call_args_list if "<=>" in str(call.args[0])
    )
    assert ann_call.args[1]["anchor_limit"] == 240


@pytest.mark.parametrize(
    "query", ["generic", "explicit-track", "radio", "optimized-radio"]
)
def test_other_candidate_paths_do_not_change_hnsw_settings(query):
    from crate.db.queries.paths_bliss_candidate_queries import (
        find_anchor_track_row,
        find_candidate_rows,
        find_seeded_radio_candidate_rows,
    )

    session = _candidate_session()
    if query == "generic":
        find_candidate_rows([0.1] * 20, set(), limit=60, session=session)
    elif query == "explicit-track":
        find_anchor_track_row(
            "track", "1", [0.1] * 20, set(), selection_seed="session", session=session
        )
    else:
        find_seeded_radio_candidate_rows(
            [0.1] * 20,
            set(),
            seed_artists=["ANN Artist"],
            limit=60,
            optimized=query == "optimized-radio",
            session=session,
        )

    assert not any(
        "hnsw." in str(call.args[0]).lower() for call in session.execute.call_args_list
    )


@pytest.fixture
def ann_catalog(pg_db):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        assert (
            session.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        pg_db.upsert_artist({"name": "ANN Artist"}, session=session)
        album_id = pg_db.upsert_album(
            {
                "artist": "ANN Artist",
                "name": "ANN Album",
                "path": "/music/ANN Artist/ANN Album",
            },
            session=session,
        )
        rows = (
            session.execute(
                text("""
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path,
                    duration, format, bliss_vector, bliss_embedding
                )
                SELECT :album_id, 'ANN Artist', 'ANN Album', n || '.flac',
                       'ANN-' || n,
                       CASE WHEN n % 11 = 0 THEN '/music/ANN/.hidden/'
                            ELSE '/music/ANN/visible/' END || n || '.flac',
                       180, 'flac', vector_data, CAST(vector_data AS vector(20))
                FROM (
                    SELECT n, ARRAY[1.0, n::DOUBLE PRECISION / 480]
                           || array_fill(0.01::DOUBLE PRECISION, ARRAY[18]) AS vector_data
                    FROM generate_series(1, 480) n
                ) vectors
                RETURNING id, title
            """),
                {"album_id": album_id},
            )
            .mappings()
            .all()
        )
        excluded_ids = {
            row["id"] for row in rows if int(row["title"].split("-")[-1]) % 7 == 0
        }
        session.execute(text("ANALYZE library_tracks"))
    return [1.0, 0.0] + [0.01] * 18, excluded_ids


@pytest.mark.parametrize("limit", [15, 60, 240])
def test_hnsw_candidate_expansion_fills_filtered_pools_in_postgres(ann_catalog, limit):
    from crate.db.queries.paths_bliss_candidate_queries import find_candidate_rows
    from crate.db.tx import read_scope

    vector, excluded_ids = ann_catalog
    with read_scope() as session:
        session.execute(text("SET LOCAL enable_seqscan = off"))
        session.execute(text("SET LOCAL enable_sort = off"))
        session.execute(text("SET LOCAL enable_bitmapscan = off"))
        session.execute(text("SET LOCAL hnsw.ef_search = 40"))
        session.execute(text("SET LOCAL hnsw.iterative_scan = off"))
        recorded = MagicMock(wraps=session)

        rows = find_candidate_rows(
            vector,
            excluded_ids,
            limit=limit,
            use_track_artist=True,
            session=recorded,
        )

        ann_call = next(
            call
            for call in recorded.execute.call_args_list
            if "ORDER BY t.bliss_embedding" in str(call.args[0])
        )
        plan = (
            session.execute(text("EXPLAIN " + str(ann_call.args[0])), ann_call.args[1])
            .scalars()
            .all()
        )
        assert any(_INDEX_NAME in line for line in plan), plan
        assert len(rows) == limit
        assert len({row["id"] for row in rows}) == limit
        assert not (excluded_ids & {row["id"] for row in rows})
        assert all(int(row["title"].split("-")[-1]) % 11 for row in rows)
        distances = [row["distance"] for row in rows]
        assert distances == sorted(distances)


def _hnsw_settings(session):
    return dict(
        session.execute(
            text("""
                SELECT current_setting('hnsw.ef_search') AS ef_search,
                       current_setting('hnsw.iterative_scan') AS iterative_scan
            """)
        )
        .mappings()
        .one()
    )


def _shared_session_path_query(endpoint, session, vector, excluded_ids):
    from crate.db.queries.paths_bliss_candidate_queries import (
        find_anchor_track_row,
        find_candidate_rows,
    )

    if endpoint == "candidates":
        return find_candidate_rows(
            vector, excluded_ids, limit=240, use_track_artist=True, session=session
        )
    artist_id = session.execute(
        text("SELECT id FROM library_artists WHERE name = 'ANN Artist'")
    ).scalar_one()
    return find_anchor_track_row(
        "artist",
        str(artist_id),
        vector,
        excluded_ids,
        selection_seed="shared-session",
        session=session,
    )


@pytest.mark.parametrize("endpoint", ["candidates", "anchor"])
@pytest.mark.parametrize(
    "python_failure", [False, True], ids=["success", "python-error"]
)
def test_path_hnsw_settings_restore_the_shared_session_without_ending_it(
    ann_catalog, endpoint, python_failure
):
    from crate.db.queries.paths_bliss_candidate_queries import find_candidate_rows
    from crate.db.tx import read_scope

    vector, excluded_ids = ann_catalog
    initial = {"ef_search": "47", "iterative_scan": "off"}
    failure = RuntimeError("candidate consumer failed")
    observed_settings = []
    with read_scope() as session:
        session.execute(text("SET LOCAL hnsw.ef_search = 47"))
        session.execute(text("SET LOCAL hnsw.iterative_scan = off"))
        recorded = MagicMock(wraps=session)

        def execute(statement, parameters=None):
            if "ORDER BY t.bliss_embedding" in str(statement):
                observed_settings.append(_hnsw_settings(session))
                if python_failure:
                    raise failure
            return session.execute(statement, parameters)

        recorded.execute.side_effect = execute
        if python_failure:
            with pytest.raises(RuntimeError) as caught:
                _shared_session_path_query(endpoint, recorded, vector, excluded_ids)
            assert caught.value is failure
        else:
            assert _shared_session_path_query(endpoint, recorded, vector, excluded_ids)

        assert observed_settings == [
            {"ef_search": "240", "iterative_scan": "strict_order"}
        ]
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        assert _hnsw_settings(session) == initial
        assert find_candidate_rows(vector, excluded_ids, limit=15, session=session)
        assert _hnsw_settings(session) == initial


@pytest.mark.parametrize("endpoint", ["candidates", "anchor"])
def test_path_hnsw_settings_preserve_the_sql_error_until_the_owner_rolls_back(
    ann_catalog, endpoint
):
    from crate.db.tx import read_scope

    vector, excluded_ids = ann_catalog
    with read_scope() as session:
        baseline = _hnsw_settings(session)
        session.execute(text("SET LOCAL hnsw.ef_search = 47"))
        session.execute(text("SET LOCAL hnsw.iterative_scan = off"))
        recorded = MagicMock(wraps=session)

        def execute(statement, parameters=None):
            if "ORDER BY t.bliss_embedding" in str(statement):
                return session.execute(text("SELECT 1 / 0"))
            return session.execute(statement, parameters)

        recorded.execute.side_effect = execute
        with pytest.raises(DBAPIError) as original:
            _shared_session_path_query(endpoint, recorded, vector, excluded_ids)

        assert original.value.orig.pgcode == "22012"
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        with pytest.raises(DBAPIError) as aborted:
            session.execute(text("SELECT 1"))
        assert aborted.value.orig.pgcode == "25P02"

    with read_scope() as session:
        assert _hnsw_settings(session) == baseline
