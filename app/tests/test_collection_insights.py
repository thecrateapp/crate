"""Worker report uses current local identities and registered listening history."""

from datetime import date
from uuid import uuid4

import pytest
from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
TODAY = date(2026, 10, 24)


@pytest.fixture
def library(pg_db):
    with read_scope() as session:
        yield session


def _album(s, artist="First", title="Same title", year="1999", quarantine=False):
    s.execute(
        text(
            "INSERT INTO library_artists(name, slug) VALUES (:name, :slug) ON CONFLICT DO NOTHING"
        ),
        {"name": artist, "slug": artist.lower()},
    )
    return s.execute(
        text(
            "INSERT INTO library_albums(artist,name,path,year,slug,quarantined_at) VALUES (:artist,:title,:path,:year,:slug,CASE WHEN :quarantine THEN now() ELSE NULL END) RETURNING id"
        ),
        {
            "artist": artist,
            "title": title,
            "path": f"/music/{artist}/{title}",
            "year": year,
            "slug": f"{artist.lower()}-{title.lower().replace(' ', '-')}",
            "quarantine": quarantine,
        },
    ).scalar_one()


def _track(s, album, n=1, genre=None, year=None, bliss=None):
    return dict(
        s.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,path,title,entity_uid,genre,year,bliss_vector) SELECT id,artist,name,:filename,path || '/' || :filename,'Song',:uid,:genre,:year,:bliss FROM library_albums WHERE id=:album RETURNING id,entity_uid::text,path"
            ),
            {
                "album": album,
                "filename": f"{n}.flac",
                "uid": str(uuid4()),
                "genre": genre,
                "year": year,
                "bliss": bliss,
            },
        )
        .mappings()
        .one()
    )


def _play(
    s,
    day,
    *,
    track=None,
    uid=None,
    path=None,
    global_uid=None,
    plays=1,
    minutes=10,
    key=None,
):
    s.execute(
        text(
            "INSERT INTO instance_track_daily(day,entity_key,track_id,track_entity_uid,track_path,global_track_uid,artist,album,play_count,minutes_listened) VALUES (:day,:key,:track,:uid,:path,:global_uid,'old artist','old title',:plays,:minutes)"
        ),
        {
            "day": day,
            "key": key or str(uuid4()),
            "track": track,
            "uid": uid,
            "path": path,
            "global_uid": global_uid,
            "plays": plays,
            "minutes": minutes,
        },
    )


def _report(s, window="30d"):
    from crate.db.queries.collection_insights import build_collection_insights

    return build_collection_insights(window, today=TODAY, session=s)


def _genre(s, name, slug, canonical, classification="genre"):
    gid = s.execute(
        text("INSERT INTO genres(name,slug) VALUES (:name,:slug) RETURNING id"),
        {"name": name, "slug": slug},
    ).scalar_one()
    node = s.execute(
        text(
            "INSERT INTO genre_taxonomy_nodes(name,slug) VALUES (:name,:slug) ON CONFLICT(slug) DO UPDATE SET name=excluded.name RETURNING id"
        ),
        {"name": canonical.title(), "slug": canonical},
    ).scalar_one()
    s.execute(
        text(
            "INSERT INTO genre_taxonomy_aliases(alias_slug,alias_name,genre_id) VALUES (:slug,:name,:node) ON CONFLICT(alias_slug) DO UPDATE SET genre_id=excluded.genre_id"
        ),
        {"slug": slug, "name": name, "node": node},
    )
    s.execute(
        text(
            "INSERT INTO genre_taxonomy_raw_tag_classifications(genre_id,classification) VALUES (:gid,:classification)"
        ),
        {"gid": gid, "classification": classification},
    )
    return gid


def test_uid_precedes_id_aliases_deduplicate_and_remote_quarantine_stay_excluded(
    library,
):
    a = _album(library)
    b = _album(library, "Second")
    quarantined = _album(library, "Hidden", quarantine=True)
    one, two, hidden = (_track(library, album) for album in (a, b, quarantined))
    _play(library, "2026-10-24", uid=one["entity_uid"], track=two["id"])
    _play(library, "2026-10-24", track=one["id"], minutes=5)
    _play(library, "2026-10-24", path=two["path"], minutes=7)
    _play(
        library,
        "2026-10-24",
        uid=str(uuid4()),
        track=one["id"],
        path=one["path"],
        minutes=11,
    )
    _play(library, "2026-10-24", track=hidden["id"], minutes=13)
    _play(library, "2026-10-24", global_uid=str(uuid4()), minutes=17)
    _play(library, "2026-10-24", track=999999, path=one["path"], minutes=19)
    report = _report(library)
    assert report["catalogue"] == {"tracks": 2, "albums": 2}
    assert report["current"] == {
        "plays": 3,
        "minutes": 22,
        "tracks": 2,
        "albums": 2,
        "concentration_pct": 100,
    }
    assert report["excluded"] == {"plays": 4, "minutes": 60}
    assert report["unheard"]["total"] == 0


def test_canonical_genres_fractionally_split_deduplicate_aliases_and_exclude_facets(
    library,
):
    rock = _genre(library, "Guitar Rock", "guitar-rock", "rock")
    _genre(library, "Alt Rock", "alt-rock", "rock")
    jazz = _genre(library, "Jazz sounds", "jazz-sounds", "jazz")
    _genre(library, "French language", "french-language", "french", "facet")
    a, b = _album(library), _album(library, "Second", year=None)
    t = _track(library, a, genre="Guitar Rock, Alt Rock, Jazz sounds, French language")
    _track(library, b, genre="Unmapped")
    # Duplicate taxonomy associations must never duplicate time or membership.
    for gid in (rock, jazz):
        library.execute(
            text("INSERT INTO album_genres(album_id,genre_id) VALUES (:album,:genre)"),
            {"album": a, "genre": gid},
        )
    _play(library, "2026-10-24", track=t["id"], plays=4, minutes=20)
    r = _report(library)
    genres = {g["key"]: g for g in r["genres"]}
    assert set(genres) == {"rock", "jazz", "unknown"}
    for key in ("rock", "jazz"):
        assert {
            k: genres[key][k]
            for k in (
                "tracks",
                "albums",
                "played_tracks",
                "plays",
                "minutes",
                "catalogue_share",
                "listening_share",
            )
        } == {
            "tracks": 1,
            "albums": 1,
            "played_tracks": 1,
            "plays": 2,
            "minutes": 10,
            "catalogue_share": 25,
            "listening_share": 50,
        }
    assert genres["unknown"]["catalogue_share"] == 50
    assert {d["key"]: d["catalogue_share"] for d in r["decades"]} == {
        "1990": 50,
        "unknown": 50,
    }


def test_full_prior_period_timeline_movers_and_all_history_exploration(library):
    recent = _track(library, _album(library))
    dormant_album = _album(library, "Dormant")
    dormant = _track(library, dormant_album)
    unheard_album = _album(library, "Unheard")
    _track(library, unheard_album)
    falling = _track(library, _album(library, "Falling"))
    _play(library, "2026-04-01", uid=dormant["entity_uid"])
    _play(library, "2026-09-01", track=recent["id"], minutes=4)
    _play(library, "2026-09-01", track=falling["id"], minutes=12)
    _play(library, "2026-10-01", track=recent["id"], minutes=14)
    r = _report(library)
    assert r["period"] == {
        "start": "2026-09-25",
        "end": "2026-10-24",
        "previous_start": "2026-08-26",
        "previous_end": "2026-09-24",
        "history_start": "2026-04-01",
        "calendar": "listener_local_days",
        "previous_complete": True,
        "history_complete": True,
    }
    assert len(r["timeline"]) == 30
    assert r["timeline"][6] == {
        "day": "2026-10-01",
        "minutes": 14,
        "previous_minutes": 16,
    }
    assert r["current"]["minutes"] == 14
    assert r["previous"]["minutes"] == 16
    assert r["rising"][0]["name"] == "First"
    assert r["rising"][0]["delta_minutes"] == 10
    assert r["falling"][0]["name"] == "Falling"
    assert r["unheard"]["total"] == 1
    assert r["unheard"]["items"][0]["id"] == unheard_album
    assert r["rediscover"]["items"][0]["id"] == dormant_album
    assert r["rediscover"]["items"][0]["last_day"] == "2026-04-01"


def test_incomplete_previous_history_suppresses_movers_and_empty_is_finite(library):
    r = _report(library)
    assert r["ready"] is True
    assert r["period"]["history_start"] is None
    assert r["period"]["previous_complete"] is False
    assert r["current"]["concentration_pct"] is None
    assert r["genres"] == []
    t = _track(library, _album(library))
    _play(library, "2026-09-20", track=t["id"])
    _play(library, "2026-10-24", track=t["id"])
    r = _report(library)
    assert r["period"]["previous_complete"] is False
    assert r["rising"] == r["falling"] == []
    with pytest.raises(ValueError, match="window"):
        _report(library, "7d")


def test_improvements_include_only_listened_tracks_without_current_full_or_bliss(
    library,
):
    album = _album(library)
    states = [
        ("full", ANALYZER_VERSION, PROFILE_SCHEMA_VERSION, False, [1.0]),
        ("full", "old", PROFILE_SCHEMA_VERSION, False, []),
        ("full", ANALYZER_VERSION, PROFILE_SCHEMA_VERSION + 1, False, None),
        ("full", ANALYZER_VERSION, PROFILE_SCHEMA_VERSION, True, [2.0]),
        ("partial", ANALYZER_VERSION, PROFILE_SCHEMA_VERSION, False, None),
    ]
    for n, (quality, analyzer, version, stale, bliss) in enumerate(states, 1):
        t = _track(library, album, n, bliss=bliss)
        library.execute(
            text(
                "INSERT INTO track_mix_profiles(track_id,profile_version,profile_revision,analyzer,analyzer_version,source_revision,quality,analyzed_at,source_stale_at) VALUES (:id,:version,'test','crate-python',:analyzer,'test',:quality,now(),CASE WHEN :stale THEN now() ELSE NULL END)"
            ),
            {
                "id": t["id"],
                "version": version,
                "analyzer": analyzer,
                "quality": quality,
                "stale": stale,
            },
        )
        _play(library, "2026-10-24", track=t["id"], minutes=n)
    _track(library, album, 6)  # Unheard missing analyses have no registered impact.
    r = _report(library)
    improvements = {i["key"]: i for i in r["improvements"]}
    assert improvements["full"]["tracks"] == 4
    assert improvements["full"]["minutes"] == 14
    assert improvements["bliss"]["tracks"] == 3
    assert improvements["bliss"]["minutes"] == 10
    assert improvements["full"]["albums"][0]["played_tracks"] == 4
    assert improvements["full"]["albums"][0]["minutes"] == 14


def test_album_then_artist_fallback_uses_mapped_canonical_and_track_tier_wins(library):
    rock = _genre(library, "Alias rock", "alias-rock", "rock")
    jazz = _genre(library, "Alias jazz", "alias-jazz", "jazz")
    facet = _genre(library, "Quiet mood", "quiet-mood", "quiet", "facet")
    a = _album(library)
    b = _album(library, "Second")
    library.execute(
        text("INSERT INTO album_genres(album_id,genre_id) VALUES (:album,:genre)"),
        {"album": a, "genre": rock},
    )
    library.execute(
        text(
            "INSERT INTO artist_genres(artist_name,genre_id) VALUES ('First',:jazz),('Second',:jazz),('Second',:facet)"
        ),
        {"jazz": jazz, "facet": facet},
    )
    _track(library, a, genre="Alias jazz")
    _track(library, a, 2, genre="Quiet mood, Unmapped")
    _track(library, b, genre="Quiet mood")
    r = _report(library)
    assert {g["key"]: g["tracks"] for g in r["genres"]} == {"jazz": 2, "rock": 1}


def test_explicit_taxonomy_alias_overrides_old_direct_canonical_slug(library):
    # A curated alias may redirect a spelling that still names a taxonomy node.
    old = _genre(library, "Old genre", "old-genre", "old-genre")
    target = _genre(library, "New genre", "new-genre", "new-genre")
    library.execute(
        text(
            "UPDATE genre_taxonomy_aliases SET genre_id=(SELECT genre_id FROM genre_taxonomy_aliases WHERE alias_slug='new-genre') WHERE alias_slug='old-genre'"
        )
    )
    a = _album(library)
    library.execute(
        text("INSERT INTO album_genres(album_id,genre_id) VALUES (:album,:genre)"),
        {"album": a, "genre": old},
    )
    _track(library, a, genre="Old genre")
    _track(library, a, 2)
    assert {g["key"]: g["tracks"] for g in _report(library)["genres"]} == {
        "new-genre": 2
    }
    assert old != target


def test_missing_rollup_backfill_invalidates_previous_comparison(library):
    t = _track(library, _album(library))
    _play(library, "2026-08-01", track=t["id"])
    _play(library, "2026-10-24", track=t["id"])
    library.execute(
        text(
            "INSERT INTO user_track_daily(user_id,day,entity_key,play_count,first_played_at,last_played_at) VALUES (1,'2026-01-01','older',1,'2026-01-01','2026-01-01')"
        )
    )
    r = _report(library)
    assert r["period"]["history_start"] == "2026-01-01"
    assert r["period"]["history_complete"] is False
    assert r["period"]["previous_complete"] is False
    assert r["rising"] == r["falling"] == []


@pytest.mark.parametrize(
    "window,days,start,prior_start",
    [
        ("90d", 90, "2026-07-27", "2026-04-28"),
        ("365d", 365, "2025-10-25", "2024-10-25"),
    ],
)
def test_windows_fill_all_days_and_exclude_future_activity(
    library, window, days, start, prior_start
):
    t = _track(library, _album(library))
    _play(library, "2026-10-25", track=t["id"])
    r = _report(library, window)
    assert r["period"]["start"] == start
    assert r["period"]["previous_start"] == prior_start
    assert len(r["timeline"]) == days
    assert r["timeline"][0]["day"] == start
    assert r["timeline"][-1]["day"] == "2026-10-24"
    assert r["period"]["history_start"] is None
    assert r["current"]["plays"] == 0
    assert r["unheard"]["total"] == 1


def test_concentration_is_top_ten_time_not_play_counts_and_lists_are_bounded(library):
    for n in range(12):
        t = _track(library, _album(library, f"Artist {n}"))
        _play(library, "2026-01-01", track=t["id"])
        _play(
            library,
            "2026-10-24",
            track=t["id"],
            plays=100 if n == 0 else 1,
            minutes=n + 1,
        )
    r = _report(library)
    assert r["current"]["concentration_pct"] == pytest.approx(75 / 78 * 100)
    assert len(r["rising"]) == 6
    assert [a["current_minutes"] for a in r["rising"]] == [12, 11, 10, 9, 8, 7]
    assert len(r["improvements"][0]["albums"]) == 6
    assert len(r["decades"][0]["examples"]) == 3


def test_nonfinite_or_negative_stored_listening_never_leaks_into_report(library):
    t = _track(library, _album(library))
    for minutes in (float("nan"), float("inf"), -10):
        _play(library, "2026-10-24", track=t["id"], minutes=minutes)
    r = _report(library)
    assert r["current"]["minutes"] == 0
    assert r["current"]["plays"] == 3
    assert r["current"]["concentration_pct"] is None


def test_builder_owns_one_batched_read_when_no_session_is_supplied(pg_db):
    from crate.db.engine import get_engine
    from crate.db.queries.collection_insights import build_collection_insights
    from crate.db.tx import transaction_scope
    from sqlalchemy import event

    with transaction_scope() as session:
        a = _album(session)
        for n in range(1, 8):
            t = _track(session, a, n)
            _play(session, "2026-10-24", track=t["id"])
    statements = []

    def record_statement(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        report = build_collection_insights(today=TODAY)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    assert report["catalogue"] == {"tracks": 7, "albums": 1}
    assert report["current"]["plays"] == 7
    assert len(statements) == 1


def test_categories_and_unheard_samples_are_bounded_without_losing_total(library):
    for n in range(27):
        genre = _genre(
            library, f"Fixture genre {n}", f"fixture-genre-{n}", f"fixture-node-{n}"
        )
        a = _album(library, f"Artist {n}")
        library.execute(
            text("INSERT INTO album_genres(album_id,genre_id) VALUES (:album,:genre)"),
            {"album": a, "genre": genre},
        )
        _track(library, a)
    _track(library, _album(library, "Unknown"))
    report = _report(library)
    assert len(report["genres"]) == 25
    assert report["genres"][-1]["key"] == "unknown"
    assert report["unheard"]["total"] == 28
    assert len(report["unheard"]["items"]) == 6
    # The denominator remains the complete inventory after response truncation.
    assert report["genres"][0]["catalogue_share"] == pytest.approx(100 / 28)


def test_report_streams_one_small_row_per_track_without_internal_columns(library):
    from crate.db.queries.collection_insights_sql import _REPORT_SQL

    with read_scope() as s:
        album = _album(s)
        _track(s, album, n=1, genre="Rock")
        _track(s, album, n=2)
        rows = s.execute(
            text(_REPORT_SQL),
            {
                "today": date(2026, 10, 24),
                "start": date(2026, 9, 25),
                "previous_start": date(2026, 8, 26),
                "previous_end": date(2026, 9, 24),
                "profile_version": PROFILE_SCHEMA_VERSION,
                "analyzer_version": ANALYZER_VERSION,
            },
        ).all()

    kinds = [kind for kind, _payload in rows]
    tracks = [payload for kind, payload in rows if kind == "track"]
    assert kinds.count("track") == 2
    assert kinds.count("meta") == 1
    assert all("path" not in t and "genre" not in t for t in tracks)
    assert all("genres" in t and "current_minutes" in t for t in tracks)
