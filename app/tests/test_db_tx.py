"""Actual SQLAlchemy transaction events must not publish uncommitted effects."""

import pytest
from crate.db.tx import register_after_commit
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session


@pytest.fixture
def callback_session():
    engine = create_engine("sqlite://")
    with Session(engine) as session:
        session.execute(text("SELECT 1"))
        yield session
    engine.dispose()


@pytest.mark.parametrize("commit", [True, False])
def test_savepoint_callbacks_wait_for_outer_commit(callback_session, commit):
    session, calls = callback_session, []
    register_after_commit(session, lambda: calls.append("outer"))
    with session.begin_nested():
        session.execute(text("SELECT 1"))
        register_after_commit(session, lambda: calls.append("nested"))
    assert calls == []
    if commit:
        session.commit()
        assert calls == ["outer", "nested"]
    else:
        session.rollback()
        assert calls == []
    session.commit()
    assert calls == (["outer", "nested"] if commit else [])


def test_nested_rollback_discards_only_its_callbacks(callback_session):
    session, calls = callback_session, []
    register_after_commit(session, lambda: calls.append("outer"))
    with session.begin_nested():
        register_after_commit(session, lambda: calls.append("sibling"))
    with pytest.raises(ValueError), session.begin_nested():
        register_after_commit(session, lambda: calls.append("rolled-back"))
        with session.begin_nested():
            register_after_commit(session, lambda: calls.append("descendant"))
        assert calls == []
        raise ValueError("rollback savepoint")
    with session.begin_nested():
        register_after_commit(session, lambda: calls.append("later"))
    assert calls == []
    session.commit()
    assert calls == ["outer", "sibling", "later"]


def test_nested_close_discards_callbacks_and_session_can_be_reused(callback_session):
    session, calls = callback_session, []
    register_after_commit(session, lambda: calls.append("outer"))
    nested = session.begin_nested()
    register_after_commit(session, lambda: calls.append("closed savepoint"))
    nested.close()
    session.commit()
    assert calls == ["outer"]
    register_after_commit(session, lambda: calls.append("closed session"))
    session.execute(text("SELECT 1"))
    session.close()
    session.commit()
    assert calls == ["outer"]


def test_callback_registered_before_autobegin_runs_on_commit():
    calls = []
    with Session() as session:
        register_after_commit(session, lambda: calls.append("logical commit"))
        session.commit()
        session.commit()
    assert calls == ["logical commit"]


@pytest.mark.parametrize("end", ["rollback", "close"])
def test_idle_session_callback_is_discarded_without_sql(end):
    calls = []
    with Session() as session:
        register_after_commit(session, lambda: calls.append("discarded"))
        getattr(session, end)()
        session.commit()
    assert calls == []
