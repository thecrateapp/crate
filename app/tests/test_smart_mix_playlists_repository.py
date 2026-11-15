"""Smart Mix playlists: owner, limits, stem jobs and sync revision (STEM-D2)."""

from __future__ import annotations

from dataclasses import replace

import pytest
from sqlalchemy import event, text

from crate.db.cache_settings import set_setting
from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_mutate import delete_playlist
from crate.db.repositories.playlists_tracks import (
    add_playlist_tracks,
    remove_playlist_track,
)
from crate.db.repositories.smart_mix import upsert_track_mix_profile
from crate.db.repositories.smart_mix_playlists import (
    SmartMixPlaylistLimitError,
    SmartMixPlaylistNotFoundError,
    SmartMixPlaylistOwnerError,
    SmartMixSummary,
    get_smart_mix_playlist_limits,
    list_smart_mix_playlists,
    set_smart_mix_playlist,
    smart_mix_summaries,
)
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.stems import (
    STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
    STEM_MAX_TRACKS_PER_USER_SETTING,
)
from tests.test_smart_mix_repository import _profile

REVISION = "a" * 64
NEW_REVISION = "b" * 64


def _user(name: str) -> int:
    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    "INSERT INTO users (email, username, created_at) "
                    "VALUES (:email, :name, now()) RETURNING id"
                ),
                {"email": f"{name}@example.test", "name": name},
            ).scalar_one()
        )


def _tracks(name: str, count: int) -> list[int]:
    """``count`` local tracks of one album, in one statement."""
    artist = f"Stems Artist {name}"
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid) "
                "VALUES (:artist, gen_random_uuid())"
            ),
            {"artist": artist},
        )
        album_id = session.execute(
            text(
                "INSERT INTO library_albums (artist, name, path, entity_uid) "
                "VALUES (:artist, :album, :path, gen_random_uuid()) RETURNING id"
            ),
            {"artist": artist, "album": f"Album {name}", "path": f"/music/{name}"},
        ).scalar_one()
        return [
            int(track_id)
            for track_id in session.execute(
                text(
                    """
                    INSERT INTO library_tracks
                        (album_id, artist, album, filename, title, path,
                         entity_uid, duration)
                    SELECT :album_id, :artist, :album, n || '.flac', 'Track ' || n,
                           :path || '/' || n || '.flac', gen_random_uuid(), 180.0
                    FROM generate_series(1, :count) AS n
                    ORDER BY n
                    RETURNING id
                    """
                ),
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": f"Album {name}",
                    "path": f"/music/{name}",
                    "count": count,
                },
            ).scalars()
        ]


def _fill(playlist_id: int, track_ids: list[int]) -> None:
    """Put tracks in a playlist directly, as a playlist built before Smart Mix."""
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks
                    (playlist_id, track_id, title, position, added_at)
                SELECT :playlist_id, item.track_id, 'Track', item.position, NOW()
                FROM unnest(CAST(:track_ids AS INTEGER[]))
                    WITH ORDINALITY AS item(track_id, position)
                """
            ),
            {"playlist_id": playlist_id, "track_ids": track_ids},
        )


def _playlist(owner: int, track_ids: list[int], name: str = "Set") -> int:
    playlist_id = create_playlist(name=name, user_id=owner)
    _fill(playlist_id, track_ids)
    return playlist_id


def _profiled(track_id: int, revision: str = REVISION) -> None:
    with read_scope() as session:
        uid = session.execute(
            text("SELECT entity_uid::text FROM library_tracks WHERE id = :id"),
            {"id": track_id},
        ).scalar_one()
    upsert_track_mix_profile(track_id, replace(_profile(uid), source_revision=revision))


def _analysed(
    track_id: int, revision: str = REVISION, *, producer_kind: str = "server"
) -> None:
    producer = "crate-server/1" if producer_kind == "server" else "crate-decks/0.4.0"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_signals (
                    track_id, producer_kind, producer, separator_model,
                    separator_version, source_revision, hop_ms, drums_levels,
                    bass_levels, other_levels, vocals_levels, duration_ms
                ) VALUES (
                    :track_id, :producer_kind, :producer, 'htdemucs',
                    'htdemucs-onnx-1', :revision, 250, '\\x01', '\\x01', '\\x01',
                    '\\x01', 250
                )
                """
            ),
            {
                "track_id": track_id,
                "producer_kind": producer_kind,
                "producer": producer,
                "revision": revision,
            },
        )


def _jobs() -> dict[int, dict]:
    with read_scope() as session:
        return {
            row["track_id"]: dict(row)
            for row in session.execute(
                text(
                    "SELECT track_id, state, attempts, source_revision, requested_at "
                    "FROM track_stem_jobs"
                )
            ).mappings()
        }


def test_only_the_owner_turns_a_playlist_on(pg_db) -> None:
    del pg_db
    owner, other = _user("sm-owner"), _user("sm-other")
    playlist_id = _playlist(owner, _tracks("owner-only", 2))

    with pytest.raises(SmartMixPlaylistOwnerError):
        set_smart_mix_playlist(playlist_id, user_id=other, enabled=True)
    with pytest.raises(SmartMixPlaylistNotFoundError):
        set_smart_mix_playlist(playlist_id + 1_000, user_id=owner, enabled=True)
    # A system playlist has no owner who could turn it on.
    system_id = create_playlist(name="Editorial", user_id=owner, scope="system")
    with pytest.raises(SmartMixPlaylistOwnerError):
        set_smart_mix_playlist(system_id, user_id=owner, enabled=True)
    assert list_smart_mix_playlists(owner, since_revision=None) == []

    state = set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    assert state.playlist_id == playlist_id
    assert state.user_id == owner
    assert state.enabled is True
    assert state.enabled_at is not None and state.disabled_at is None
    assert state.last_used_at is not None
    assert state.revision == 1


def test_caps_at_300_tracks_per_playlist_by_default(pg_db) -> None:
    del pg_db
    owner = _user("sm-cap")
    tracks = _tracks("cap", 301)
    playlist_id = _playlist(owner, tracks[:300])

    assert get_smart_mix_playlist_limits().max_tracks_per_playlist == 300
    assert set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True).enabled
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=False)
    _fill(playlist_id, tracks[300:])

    with pytest.raises(SmartMixPlaylistLimitError) as raised:
        set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    assert (raised.value.limit, raised.value.max_tracks, raised.value.tracks) == (
        "playlist",
        300,
        301,
    )
    # The refused change leaves nothing behind: still off, revision unchanged.
    (state,) = list_smart_mix_playlists(owner, since_revision=None)
    assert state.enabled is False and state.revision == 2


def test_the_admin_per_playlist_limit_replaces_the_default(pg_db) -> None:
    del pg_db
    owner = _user("sm-admin-cap")
    tracks = _tracks("admin-cap", 3)
    playlist_id = _playlist(owner, tracks)
    # The same track twice counts once, and tracks from another instance not at all.
    _fill(playlist_id, tracks[:1])
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO playlist_tracks (playlist_id, title, position, added_at) "
                "VALUES (:playlist_id, 'Remote', 10, NOW())"
            ),
            {"playlist_id": playlist_id},
        )
    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "2")

    assert get_smart_mix_playlist_limits().max_tracks_per_playlist == 2
    with pytest.raises(SmartMixPlaylistLimitError) as raised:
        set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    assert (raised.value.limit, raised.value.max_tracks, raised.value.tracks) == (
        "playlist",
        2,
        3,
    )

    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "3")
    assert set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True).enabled


def test_no_per_user_limit_by_default(pg_db) -> None:
    del pg_db
    owner = _user("sm-no-user-cap")
    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "3")
    playlists = [_playlist(owner, _tracks(f"no-user-cap-{n}", 3)) for n in range(3)]

    assert get_smart_mix_playlist_limits().max_tracks_per_user is None
    for playlist_id in playlists:
        set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    assert all(
        state.enabled for state in list_smart_mix_playlists(owner, since_revision=None)
    )


def test_the_admin_per_user_limit_applies_across_the_users_playlists_when_set(
    pg_db,
) -> None:
    del pg_db
    owner, other = _user("sm-user-cap"), _user("sm-user-cap-other")
    first_tracks = _tracks("user-cap-first", 3)
    first = _playlist(owner, first_tracks)
    second = _playlist(owner, _tracks("user-cap-second", 3))
    # Shares a track with the first one: the limit counts distinct tracks.
    third = _playlist(owner, [first_tracks[0], *_tracks("user-cap-third", 1)])
    # Another user's Smart Mix playlist does not count against this user.
    foreign = _playlist(other, _tracks("user-cap-foreign", 4))
    set_smart_mix_playlist(foreign, user_id=other, enabled=True)
    set_setting(STEM_MAX_TRACKS_PER_USER_SETTING, "5")

    assert get_smart_mix_playlist_limits().max_tracks_per_user == 5
    set_smart_mix_playlist(first, user_id=owner, enabled=True)
    with pytest.raises(SmartMixPlaylistLimitError) as raised:
        set_smart_mix_playlist(second, user_id=owner, enabled=True)
    assert (raised.value.limit, raised.value.max_tracks, raised.value.tracks) == (
        "user",
        5,
        6,
    )
    assert set_smart_mix_playlist(third, user_id=owner, enabled=True).enabled
    # A disabled playlist frees its tracks.
    set_smart_mix_playlist(first, user_id=owner, enabled=False)
    set_smart_mix_playlist(third, user_id=owner, enabled=False)
    assert set_smart_mix_playlist(second, user_id=owner, enabled=True).enabled


def test_turning_on_queues_jobs_only_for_tracks_without_a_current_analysis(
    pg_db,
) -> None:
    del pg_db
    owner = _user("sm-queue")
    analysed, stale, unprofiled, decks_only, unanalysed = _tracks("queue", 5)
    for track_id in (analysed, stale, decks_only, unanalysed):
        _profiled(track_id)
    _analysed(analysed)
    # The file changed after its server analysis: the analysis no longer applies.
    _analysed(stale, NEW_REVISION)
    # A Decks upload does not replace the server's separation (stem files, STEM-D6).
    _analysed(decks_only, producer_kind="decks")
    playlist_id = _playlist(
        owner, [analysed, stale, unprofiled, decks_only, unanalysed]
    )

    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    jobs = _jobs()
    assert set(jobs) == {stale, unprofiled, decks_only, unanalysed}
    assert {job["state"] for job in jobs.values()} == {"pending"}
    assert {job["attempts"] for job in jobs.values()} == {0}
    # The job records the revision it was asked for; none while there is no profile.
    assert jobs[stale]["source_revision"] == REVISION
    assert jobs[unprofiled]["source_revision"] is None


def test_turning_on_again_requeues_finished_jobs_whose_analysis_no_longer_applies(
    pg_db,
) -> None:
    del pg_db
    owner = _user("sm-requeue")
    done, failed, running = _tracks("requeue", 3)
    for track_id in (done, failed, running):
        _profiled(track_id)
    playlist_id = _playlist(owner, [done, failed, running])
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_jobs
                    (track_id, state, attempts, source_revision, finished_at)
                VALUES (:done, 'ready', 1, :old, NOW()),
                       (:failed, 'failed', 3, :current, NOW()),
                       (:running, 'analyzing', 1, :current, NULL)
                """
            ),
            {
                "done": done,
                "failed": failed,
                "running": running,
                "old": NEW_REVISION,
                "current": REVISION,
            },
        )

    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    jobs = _jobs()
    assert (jobs[done]["state"], jobs[done]["attempts"]) == ("pending", 0)
    assert jobs[done]["source_revision"] == REVISION
    # A failure of the same file and a running job are left to the worker.
    assert (jobs[failed]["state"], jobs[failed]["attempts"]) == ("failed", 3)
    assert jobs[running]["state"] == "analyzing"


def test_a_track_in_two_playlists_has_one_job(pg_db) -> None:
    del pg_db
    owner = _user("sm-shared-track")
    shared, own = _tracks("shared-track", 2)
    first = _playlist(owner, [shared])
    second = _playlist(owner, [shared, own])

    set_smart_mix_playlist(first, user_id=owner, enabled=True)
    requested_at = _jobs()[shared]["requested_at"]
    set_smart_mix_playlist(second, user_id=owner, enabled=True)

    jobs = _jobs()
    assert set(jobs) == {shared, own}
    # The pending job keeps its place in the queue.
    assert jobs[shared]["requested_at"] == requested_at


def test_revision_grows_on_every_change_and_lists_changes_since_a_revision_including_turned_off(
    pg_db,
) -> None:
    del pg_db
    owner, other = _user("sm-revision"), _user("sm-revision-other")
    first = _playlist(owner, _tracks("revision-first", 1))
    second = _playlist(owner, _tracks("revision-second", 1))
    foreign = _playlist(other, _tracks("revision-foreign", 1))
    extra = _tracks("revision-extra", 1)

    assert set_smart_mix_playlist(first, user_id=owner, enabled=True).revision == 1
    assert set_smart_mix_playlist(second, user_id=owner, enabled=True).revision == 2
    # Turning on a playlist that is on changes nothing.
    assert set_smart_mix_playlist(second, user_id=owner, enabled=True).revision == 2
    off = set_smart_mix_playlist(first, user_id=owner, enabled=False)
    assert (off.enabled, off.revision) == (False, 3)
    assert off.disabled_at is not None
    # Each user has their own sequence.
    assert set_smart_mix_playlist(foreign, user_id=other, enabled=True).revision == 1
    # Track changes of a Smart Mix playlist are changes too: Decks syncs its tracks.
    add_playlist_tracks(second, [{"track_id": extra[0]}])
    remove_playlist_track(second, 1)
    # A playlist that is off does not move.
    add_playlist_tracks(first, [{"track_id": extra[0]}])

    everything = list_smart_mix_playlists(owner, since_revision=None)
    assert [(s.playlist_id, s.enabled, s.revision) for s in everything] == [
        (first, False, 3),
        (second, True, 5),
    ]
    since = list_smart_mix_playlists(owner, since_revision=3)
    assert [(s.playlist_id, s.revision) for s in since] == [(second, 5)]
    assert list_smart_mix_playlists(owner, since_revision=5) == []
    assert [
        s.playlist_id for s in list_smart_mix_playlists(owner, since_revision=2)
    ] == [first, second]


def test_deleting_the_playlist_removes_its_row(pg_db) -> None:
    del pg_db
    owner = _user("sm-delete")
    (track_id,) = _tracks("delete", 1)
    playlist_id = _playlist(owner, [track_id])
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    assert delete_playlist(playlist_id)

    assert list_smart_mix_playlists(owner, since_revision=None) == []
    with read_scope() as session:
        rows = session.execute(
            text("SELECT COUNT(*) FROM smart_mix_playlists WHERE playlist_id = :id"),
            {"id": playlist_id},
        ).scalar_one()
    assert rows == 0
    # Work and analyses are per track: the job stays for other playlists.
    assert set(_jobs()) == {track_id}


def test_adding_tracks_beyond_a_limit_is_refused_and_rolled_back(pg_db) -> None:
    del pg_db
    owner = _user("sm-add-cap")
    tracks = _tracks("add-cap", 3)
    playlist_id = _playlist(owner, tracks[:2])
    plain = _playlist(owner, tracks[:2], name="Plain")
    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "2")
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    with pytest.raises(SmartMixPlaylistLimitError):
        add_playlist_tracks(playlist_id, [{"track_id": tracks[2]}])

    with read_scope() as session:
        count = session.execute(
            text("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :id"),
            {"id": playlist_id},
        ).scalar_one()
    assert count == 2
    assert tracks[2] not in _jobs()
    # Playlists that are not Smart Mix playlists keep no limit.
    assert add_playlist_tracks(plain, [{"track_id": tracks[2]}]) == 1


def test_removing_tracks_leaves_jobs_and_analyses_alone(pg_db) -> None:
    del pg_db
    owner = _user("sm-remove")
    analysed, pending = _tracks("remove", 2)
    _profiled(analysed)
    _analysed(analysed)
    playlist_id = _playlist(owner, [analysed, pending])
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)

    remove_playlist_track(playlist_id, 1)
    remove_playlist_track(playlist_id, 1)

    assert set(_jobs()) == {pending}
    with read_scope() as session:
        analyses = session.execute(
            text("SELECT COUNT(*) FROM track_stem_signals WHERE track_id = :id"),
            {"id": analysed},
        ).scalar_one()
    assert analyses == 1


def test_summaries_read_many_playlists_in_one_query(pg_db) -> None:
    del pg_db
    from crate.db.engine import get_engine

    owner = _user("sm-summaries")
    analysed, stale, waiting = _tracks("summaries", 3)
    for track_id in (analysed, stale):
        _profiled(track_id)
    _analysed(analysed)
    _analysed(stale, NEW_REVISION)
    enabled = _playlist(owner, [analysed, stale, waiting, analysed])
    disabled = _playlist(owner, [analysed])
    plain = _playlist(owner, [analysed])
    empty = _playlist(owner, [])
    for playlist_id in (enabled, disabled, empty):
        set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    set_smart_mix_playlist(disabled, user_id=owner, enabled=False)
    statements: list[str] = []

    def capture(_conn, _cursor, statement, *_args) -> None:
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        summaries = smart_mix_summaries([enabled, disabled, plain, empty, 999_999])
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert len(statements) == 1, statements
    assert summaries == {
        # Ready means a server analysis of the track's current file.
        enabled: SmartMixSummary(enabled=True, ready=1, total=3),
        disabled: SmartMixSummary(enabled=False, ready=0, total=0),
        plain: SmartMixSummary(enabled=False, ready=0, total=0),
        empty: SmartMixSummary(enabled=True, ready=0, total=0),
        999_999: SmartMixSummary(enabled=False, ready=0, total=0),
    }
    assert smart_mix_summaries([]) == {}
