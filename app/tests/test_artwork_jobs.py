from contextlib import contextmanager

import crate.db.jobs.artwork as artwork_jobs


def test_set_album_has_cover_marks_local_catalog_source_dirty(monkeypatch):
    class Result:
        def scalar_one_or_none(self):
            return "album-entity-uid"

    class Session:
        statement = None

        def execute(self, statement, _params):
            self.statement = str(statement)
            return Result()

    session = Session()

    @contextmanager
    def transaction_scope():
        yield session

    dirty_sources = []
    monkeypatch.setattr(artwork_jobs, "transaction_scope", transaction_scope)
    monkeypatch.setattr(
        artwork_jobs,
        "enqueue_local_dirty_source",
        lambda entity_type, entity_uid, operation, *, session: dirty_sources.append(
            (entity_type, entity_uid, operation, session)
        ),
        raising=False,
    )

    artwork_jobs.set_album_has_cover(132)

    assert "RETURNING entity_uid" in session.statement
    assert dirty_sources == [("album", "album-entity-uid", "upsert", session)]
