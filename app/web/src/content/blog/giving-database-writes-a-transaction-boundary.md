---
title: "Giving database writes a transaction boundary"
description: "Our database helpers committed their own work. Passing a shared session let a library operation decide which writes should succeed or fail together."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 10
related: [filesystem-to-indexed-catalogue, when-retries-repeat-a-download, reads-from-snapshots]
tags: [How to dismantle Spotify, PostgreSQL, transactions, architecture, history]
sources:
  - app/crate/db/tx.py
  - app/crate/db/engine.py
  - app/crate/db/init_db.py
  - app/crate/db/migrations/versions/001_baseline.py
  - app/tests/test_db_access_boundaries.py
  - app/tests/test_orm_schema_contract.py
---

_Part 10. Reorganising database access around operations, April 2026._

Replacing an artist's genres could commit only part of the work. The function deleted the old
artist-to-genre links and inserted the new ones inside a database context. For each genre, it
called a helper that looked up or created the genre itself. That helper opened another context,
borrowed another connection and committed independently.

If inserting the artist's new links later failed, the outer transaction rolled back. A genre
created by the inner helper remained. The Python functions were nested; their transactions were
separate.

We had already moved the catalogue to PostgreSQL, as described in
[the second chapter](/blog/filesystem-to-indexed-catalogue). PostgreSQL could keep several writes
atomic. Our helpers made it awkward to tell PostgreSQL which writes belonged together.

For a replacement that creates a missing genre and then fails to insert its artist link, the
control flow is:

| Step | Outer connection | Genre helper's connection |
| --- | --- | --- |
| Remove the artist's old genre links | Delete remains uncommitted. | Not opened yet. |
| Look up or create the new genre | Outer transaction is still open. | Insert the missing genre and commit it. |
| Insert the replacement link and fail | Roll back the deletion and restore the old links. | Its commit has already completed. |

The artist keeps the old links, but the new genre definition remains. Both database contexts did
what they were written to do. We needed the operation to decide when their work was complete.

## Two connections inside one function call

`get_db_ctx()` did useful work. It borrowed a connection from the psycopg2 pool, disabled autocommit
and yielded a dictionary cursor. A clean exit committed; an exception rolled back. Finally, it
closed the cursor and returned the connection to the pool.
[The old database context](https://github.com/thecrateapp/crate/blob/4ffc3e84d8b13e054bb8b9e5c442dbda26dcdc85/app/crate/db/core.py#L175-L200).

That was convenient for a standalone query. It became a problem when a function needed to call
another function that also opened a context. Our genre replacement code looked like this:

```python source="app/crate/db/genres.py#L34-L46" commit="4ffc3e84d8b13e054bb8b9e5c442dbda26dcdc85" "get_or_create_genre(name)"
def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]]):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM artist_genres WHERE artist_name = %s", (artist_name,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (artist_name, genre_id, weight, source),
            )
```

The `cur` above owned the deletion and the new artist links. It was never passed to
`get_or_create_genre()`. That function opened its own `get_db_ctx()` and returned after its lookup
or insert had committed.
[The independently committed genre helper](https://github.com/thecrateapp/crate/blob/4ffc3e84d8b13e054bb8b9e5c442dbda26dcdc85/app/crate/db/genres.py#L17-L31).

The two `with` blocks borrowed two connections. Calling one function inside the other held the
outer connection for longer, but gave it no authority over the helper's commit. An extra surrounding
Python function would have the same problem unless it passed the connection through.

## Repeat the failure with one session

Sharing a transaction did not require an ORM. Psycopg's documented connection context commits or
rolls back the transaction when the block exits; closing a cursor does neither. We could have kept
psycopg2 throughout and passed a connection or cursor to helpers. The relevant distinction was
whether several calls used the same transaction.
[Psycopg 2.9 transaction contexts](https://www.psycopg.org/docs/usage.html#with-statement).

SQLAlchemy offered a session we could pass through an operation, together with connection pooling
and support for mapped models where we wanted them. Its 2.0 documentation recommends keeping the
session lifecycle outside the functions that manipulate data. A caller can open one transaction,
call several functions with that session, then commit or roll back the combined work.
[SQLAlchemy 2.0 session scope](https://docs.sqlalchemy.org/en/20/orm/session_basics.html#when-do-i-construct-a-session-when-do-i-commit-it-and-when-do-i-close-it).

We adopted that pattern while retaining SQL we needed to see directly. Genre upserts still used
`INSERT ... ON CONFLICT`. Read-heavy code kept its joins and aggregates. SQLAlchemy's `text()`
carried bound parameters and executed those statements through the session. The migration did not
require translating every query into relationships and ORM expressions.

The SQLAlchemy version of `transaction_scope()` owned one session for the operation:

```python source="app/crate/db/tx.py#L77-L86" commit="8a71ad52360a18fff4e05cf7a9738a52b96a8e4b" "session.commit()"
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
```

The function using the scope can return a result from inside the block, but the context manager
still has to commit before that return completes. An exception from the operation or the commit
runs through rollback, and the session closes in either case.

Helpers then accepted an optional `session` parameter. With no session, a helper remained usable
on its own: it opened a scope and called itself with that session. With a session, it performed its
work inside the caller's transaction.

The genre replacement changed at the point where it called the inner helper:

```python source="app/crate/db/genres.py#L53-L72" commit="8a71ad52360a18fff4e05cf7a9738a52b96a8e4b" "session=session"
def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]], *, session=None):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    if session is None:
        with transaction_scope() as s:
            return set_artist_genres(artist_name, genres, session=s)
    session.execute(
        text("DELETE FROM artist_genres WHERE artist_name = :artist_name"),
        {"artist_name": artist_name},
    )
    for name, weight, source in genres:
        genre_id = get_or_create_genre(name, session=session)
        if genre_id < 0:
            continue
        session.execute(
            text(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (:artist_name, :genre_id, :weight, :source) "
                "ON CONFLICT DO NOTHING"
            ),
            {"artist_name": artist_name, "genre_id": genre_id, "weight": weight, "source": source},
        )
```

Run the failed replacement again with this version. The deletion and genre creation are pending
on the same session. `get_or_create_genre()` returns an ID without committing it. When the link
insert raises, rollback restores the old artist links and removes the new genre definition as well.
A successful replacement commits both together.

![Before the refactor, genre replacement held one connection while its helper created and committed a genre on another. After the refactor, both functions use one session and the genre definition and artist links share the final commit or rollback.](/blog/giving-database-writes-a-transaction-boundary/shared-session.svg)

[Open the transaction diagram at full size](/blog/giving-database-writes-a-transaction-boundary/shared-session.svg).

The same calling convention appeared in user, playlist and task functions. A shared
`optional_scope(session)` helper provided another way to express it: reuse a supplied session, or
open a managed transaction if there is none. Its default was a write scope. Calling it without a
session did not discover some ambient transaction elsewhere in the application.
[Scope reuse](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/tx.py#L89-L107).

That default preserved old call sites, which was useful during the migration and easy to misread.
Two consecutive calls that each omitted `session=` still owned separate transactions. The
registration endpoint, for example, continued to consume an invite, create a user and create a
login session through separate helper calls. Giving those helpers the option to participate in a
larger transaction did not automatically compose that endpoint into one.
[Registration at the time of the refactor](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/api/auth.py#L474-L502).

We also added `read_scope()` for paths that only read. It rolls back and closes on exit rather than
committing. The helper's name describes the intended use; it does not send `SET TRANSACTION READ
ONLY` to PostgreSQL. Keeping writes out of read modules needed an architectural rule as well.
[Read scope implementation](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/tx.py#L110-L129).

## Dispatch has to wait for the task row

Genre replacement stayed inside PostgreSQL. Task creation had a second destination: after writing
a task row, it dispatched a Dramatiq message. Passing a session changed when that row became visible.
If a helper sent the message before the caller committed, a worker could receive work whose task
row was not ready to read.

For this operation, the sequence had to be write row → commit → dispatch. Rolling back the database
should also discard the pending dispatch.

The April implementation registered dispatch as an after-commit callback. Its tests opened a
shared session, created a task and checked that dispatch had not happened and another database
read could not see the row yet. After commit, the row existed and dispatch had happened once. A
second test raised an exception inside the scope and checked that neither the row nor the dispatch
survived.
[Task creation and deferred dispatch](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/tasks.py#L64-L91),
[commit and rollback tests](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/tests/test_db.py#L187-L211).

The process could still fail after committing and before dispatch, leaving a task row without its
broker message. Sharing the session made the database writes atomic; publishing the message needed
its own recovery. The early callback implementation also lacked the later rules for ownership
across nested savepoints.

## Migrating the callers without replacing every query

Callers moved over in stages. Initially, `transaction_scope()` wrapped the existing cursor context.
At that point it still yielded a psycopg2 cursor and had the same
commit behaviour. It gave us one named place to change the lifecycle while we extracted database
work from callers.
[The initial transaction wrapper](https://github.com/thecrateapp/crate/blob/8bddfbe126541a048143cb147a9b9c82a1ba6695/app/crate/db/tx.py#L43-L59).

The SQLAlchemy engine arrived alongside the legacy pool. Both connected to the same PostgreSQL
database, but they had independent connection lifecycles. Code using one pool could not join a
transaction simply because another piece of code used the other pool against the same database.
That coexistence let the migration proceed incrementally; it did not erase the boundary we were
trying to fix.
[Engine and session factory](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/engine.py#L43-L74).

SQL was also spread across the API. The related-albums handler, for example, opened a cursor and
queried genres, other albums and audio aggregates while constructing the HTTP response. Changing
that query meant editing a router; deciding how long to keep its transaction open was mixed into
the same function.
[The related-albums handler before extraction](https://github.com/thecrateapp/crate/blob/4ffc3e84d8b13e054bb8b9e5c442dbda26dcdc85/app/crate/api/browse_album.py#L24-L85).

We moved persistence into `crate.db` and divided the new modules by the work they performed:

| Module family | Responsibility |
| --- | --- |
| `queries/` | Read operations used by browse pages, radio, analytics and other consumers |
| `repositories/` | Domain persistence and writes that callers could compose with a shared session |
| `jobs/` | Database work for background and maintenance operations |

A handler could ask for related albums through a query function instead of opening its own cursor.
A worker could call a database job without carrying SQL through its filesystem or provider logic.
The database layer owned transaction scopes; the API continued to own request validation and the
HTTP response.

The old flat modules and `crate.db` exports remained during this transition. We kept a compatibility
test that checked public functions were still exported, while a separate boundary test prohibited
facade imports in a growing list of migrated modules. The compatibility test protected callers we
had not moved yet; the boundary test stopped migrated modules from returning to the old imports.
[Facade compatibility test](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/tests/test_db_facade_exports.py),
[initial boundary tests](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/tests/test_db_access_boundaries.py#L61-L115).

The boundary checks parsed Python's syntax tree. They looked for database transport calls outside
`db/`, prohibited the old cursor helper outside its allowed compatibility locations, and checked
imports in the migrated modules. Their coverage depended on the patterns and migrated modules they
listed; new ways of reaching the database needed new checks.

Mapped models arrived as another step. We added definitions for settings, users and other domains,
but the first settings repository still executed explicit SQL through a session. The models did
not replace the SQL automatically. Each call site still had to adopt the new session convention.
[Early settings repository](https://github.com/thecrateapp/crate/blob/774ceaf18c1e8b6a1f99d12f7541eca408c2340c/app/crate/db/repositories/settings.py#L25-L67).

The checks became stricter as the old paths disappeared. Today's tests reject the legacy cursor
helper across runtime code, keep write statements out of query modules and compare the active
ORM mappings with the migrated PostgreSQL schema. That stronger contract came after the initial
migration; it should not be read back into every April call site.
[Current database boundaries](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_db_access_boundaries.py),
[current mapping contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_orm_schema_contract.py).

## Starting from an existing database

Our old startup code created the schema and ran a list of numbered in-application migrations.
That had accumulated twenty-nine migrations before we introduced Alembic. Replacing it with an
empty migration environment would not tell Alembic what an existing installation already had.

Alembic records the installed revision and follows each migration's `down_revision` link to find
the path to the requested target. The migration files contain explicit upgrade operations. This
gave us a separate place to review a schema change and its predecessor.
[Alembic 1.20 revision and upgrade model](https://alembic.sqlalchemy.org/en/latest/tutorial.html#create-a-migration-script).

We first introduced a baseline revision, `001`, whose upgrade did nothing. Startup still ran the
old schema creation and the frozen legacy migration list, then ran Alembic. Existing databases
could enter the new revision history without trying to recreate their tables; new installations
still obtained their schema from the old bootstrap. The baseline's downgrade refused to drop the
whole database.
[Initial baseline](https://github.com/thecrateapp/crate/blob/4c9a3de1ee3da8112757bb5407c4e130433f4bfe/app/crate/db/migrations/versions/001_baseline.py),
[the transitional startup path](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/core.py#L231-L270).

That hybrid startup was still present when the main database refactor landed. Later in April,
we made Alembic responsible for fresh installation as well. The baseline called the schema builder
through a small adapter bound to Alembic's connection:

```python source="app/crate/db/migrations/versions/001_baseline.py#L25-L37" commit="8224a3d74563a9f4b17766df0e45e729e928ce2f" "create_schema"
def upgrade() -> None:
    from crate.db.schema_bootstrap import create_schema

    bind = op.get_bind()

    class _AlembicCursorAdapter:
        def __init__(self, connection):
            self._connection = connection

        def execute(self, statement: str) -> None:
            self._connection.execute(text(statement))

    create_schema(_AlembicCursorAdapter(bind))
```

The adapter let the existing schema builder execute its SQL through the migration connection.
Runtime startup could then stop invoking the pre-Alembic migration bridge. It ran Alembic first,
followed by the default genre taxonomy and administrator seed in one shared session.
[The Alembic-only startup path](https://github.com/thecrateapp/crate/blob/8224a3d74563a9f4b17766df0e45e729e928ce2f/app/crate/db/core.py#L255-L270).

An installation already recorded at `001` would not rerun that baseline just because its code had
changed. Subsequent revisions still had to carry changes for existing databases. Building an empty
database and upgrading an existing one were two paths we needed to preserve.

API and worker processes could start together, so initialization also retained a PostgreSQL
advisory lock around the migration work. The lock serialized participating startup processes; it
did not make a schema migration non-blocking for ordinary queries or turn every migration into a
safe rollback.
[Migration lock](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/crate/db/core.py#L203-L224).
