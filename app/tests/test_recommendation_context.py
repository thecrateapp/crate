from __future__ import annotations

from math import isfinite
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from crate.db.tx import read_scope, transaction_scope


def _insert_track(session, *, artist, album_id=None, genre=None, title="Song"):
    entity_uid = str(uuid4())
    track_id = session.execute(
        text(
            """
            INSERT INTO library_tracks
                (entity_uid, album_id, artist, album, filename, title, path, genre)
            VALUES
                (:entity_uid, :album_id, :artist, 'Compilation', :filename,
                 :title, :path, :genre)
            RETURNING id
            """
        ),
        {
            "entity_uid": entity_uid,
            "album_id": album_id,
            "artist": artist,
            "filename": f"{entity_uid}.flac",
            "title": title,
            "path": f"/music/context/{entity_uid}.flac",
            "genre": genre,
        },
    ).scalar_one()
    return {"id": str(track_id), "entity_uid": entity_uid}


@pytest.fixture
def context_catalog(pg_db):
    artists = {}
    with transaction_scope() as session:
        for name, slug in (
            ("Hybrid Artist", "hybrid-artist"),
            ("Guest Artist", "guest-artist"),
            ("Various Artists", "various-artists"),
            ("Metadata-free Artist", "metadata-free-artist"),
        ):
            entity_uid = str(uuid4())
            artist_id = session.execute(
                text(
                    """
                    INSERT INTO library_artists (name, slug, entity_uid)
                    VALUES (:name, :slug, :entity_uid)
                    RETURNING id
                    """
                ),
                {"name": name, "slug": slug, "entity_uid": entity_uid},
            ).scalar_one()
            artists[name] = {"id": str(artist_id), "entity_uid": entity_uid}

        album_uid = str(uuid4())
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES ('Various Artists', 'Compilation', :path, :entity_uid)
                RETURNING id
                """
            ),
            {"path": f"/music/context/{album_uid}", "entity_uid": album_uid},
        ).scalar_one()
        genres = {}
        for slug in ("electronic", "ambient", "folk", "post-hardcore"):
            genres[slug] = session.execute(
                text(
                    """
                    INSERT INTO genres (name, slug) VALUES (:slug, :slug)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"slug": slug},
            ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                VALUES (:artist, :genre_id, :weight, :source)
                """
            ),
            [
                {
                    "artist": artist,
                    "genre_id": genres[slug],
                    "weight": weight,
                    "source": "lastfm",
                }
                for artist, slug, weight in (
                    ("Hybrid Artist", "electronic", 0.9),
                    ("Hybrid Artist", "ambient", 0.6),
                    ("Guest Artist", "folk", 0.8),
                )
            ],
        )
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id, weight, source)
                VALUES (:album_id, :genre_id, 0.75, 'discogs')
                """
            ),
            {"album_id": album_id, "genre_id": genres["post-hardcore"]},
        )
        tagged = _insert_track(
            session, artist="Hybrid Artist", album_id=album_id, genre="Punk"
        )
        untagged = _insert_track(
            session, artist="Guest Artist", album_id=album_id, title="Guest song"
        )
        no_album = _insert_track(session, artist="Hybrid Artist", title="Unfiled song")
        compound = _insert_track(
            session,
            artist="Hybrid Artist",
            album_id=album_id,
            genre="Hip Hop; Punk, punk",
            title="Compound tags",
        )

    return {
        "artists": artists,
        "album": {"id": str(album_id), "entity_uid": album_uid},
        "tagged": tagged,
        "untagged": untagged,
        "no_album": no_album,
        "compound": compound,
    }


def test_track_tag_wins_without_losing_contradictory_genre_provenance(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    context = load_endpoint_contexts([("track", context_catalog["tagged"]["id"])])[0]

    assert context["artists"] == ["Hybrid Artist"]
    assert context["genre_weights"] == {"punk": 1.0}
    assert any(
        signal["slug"] == "punk"
        and signal["source"] == "track_tag"
        and signal["provider"] == "file"
        and "punk" in signal["raw_genre"].lower()
        for signal in context["genre_signals"]
    )
    assert any(
        signal["slug"] == "post-hardcore"
        and signal["source"] == "album_genre"
        and signal["provider"] == "discogs"
        and signal["weight"] == pytest.approx(0.75)
        for signal in context["genre_signals"]
    )
    assert any(
        signal["slug"] == "electronic"
        and signal["source"] == "artist_genre"
        and signal["provider"] == "lastfm"
        and signal["weight"] == pytest.approx(0.9)
        for signal in context["genre_signals"]
    )


def test_missing_track_tag_falls_back_to_album_then_artist(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    album_fallback, artist_fallback = load_endpoint_contexts(
        [
            ("track", context_catalog["untagged"]["id"]),
            ("track", context_catalog["no_album"]["id"]),
        ]
    )

    assert album_fallback["artists"] == ["Guest Artist"]
    assert album_fallback["genre_weights"] == {"post-hardcore": pytest.approx(0.75)}
    assert artist_fallback["artists"] == ["Hybrid Artist"]
    assert artist_fallback["genre_weights"] == pytest.approx(
        {"electronic": 0.9, "ambient": 0.6}
    )


@pytest.mark.parametrize("weight", [0, -0.5, float("nan"), float("inf"), None])
def test_invalid_album_weights_do_not_block_artist_fallback(context_catalog, weight):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    with transaction_scope() as session:
        session.execute(
            text("UPDATE album_genres SET weight = :weight WHERE album_id = :album_id"),
            {"weight": weight, "album_id": int(context_catalog["album"]["id"])},
        )

    context = load_endpoint_contexts([("track", context_catalog["untagged"]["id"])])[0]

    assert context["genre_weights"] == {"folk": pytest.approx(0.8)}
    assert all(
        isfinite(value) and value > 0 for value in context["genre_weights"].values()
    )
    assert context["genre_signals"]
    assert all(
        signal["source"] != "album_genre"
        and isfinite(signal["weight"])
        and signal["weight"] > 0
        for signal in context["genre_signals"]
    )


def test_empty_compound_track_tag_uses_album_fallback(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET genre = ' ; , ' WHERE id = :track_id"),
            {"track_id": int(context_catalog["tagged"]["id"])},
        )

    context = load_endpoint_contexts([("track", context_catalog["tagged"]["id"])])[0]

    assert context["genre_weights"] == {"post-hardcore": pytest.approx(0.75)}
    assert not any(
        signal["source"] == "track_tag" for signal in context["genre_signals"]
    )


def test_album_uses_weighted_genres_and_actual_compilation_performers(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    context = load_endpoint_contexts([("album", context_catalog["album"]["id"])])[0]

    assert set(context["artists"]) == {
        "Various Artists",
        "Hybrid Artist",
        "Guest Artist",
    }
    assert context["genre_weights"] == {"post-hardcore": pytest.approx(0.75)}
    assert all("Compilation —" not in artist for artist in context["artists"])


def test_local_ids_entity_uids_artist_names_and_slugs_resolve_same_context(
    context_catalog,
):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    artist = context_catalog["artists"]["Hybrid Artist"]
    track = context_catalog["tagged"]
    album = context_catalog["album"]
    contexts = load_endpoint_contexts(
        [
            ("track", track["id"]),
            ("track", track["entity_uid"]),
            ("album", album["id"]),
            ("album", album["entity_uid"]),
            ("artist", artist["id"]),
            ("artist", artist["entity_uid"]),
            ("artist", "HYBRID ARTIST"),
            ("artist", "hybrid-artist"),
        ]
    )

    assert len(contexts) == 8
    assert contexts[0] == contexts[1]
    assert contexts[2] == contexts[3]
    assert contexts[4] == contexts[5] == contexts[6] == contexts[7]
    assert contexts[4]["artists"] == ["Hybrid Artist"]
    assert contexts[4]["genre_weights"] == pytest.approx(
        {"electronic": 0.9, "ambient": 0.6}
    )


def test_compound_tags_and_explicit_aliases_use_canonical_genres(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    track, genre = load_endpoint_contexts(
        [("track", context_catalog["compound"]["id"]), ("genre", "hip hop")]
    )

    assert track["genre_weights"] == {"hip-hop": 1.0, "punk": 1.0}
    assert {
        signal["slug"]
        for signal in track["genre_signals"]
        if signal["source"] == "track_tag"
    } == {"hip-hop", "punk"}
    assert genre["artists"] == []
    assert genre["genre_weights"] == {"hip-hop": 1.0}
    assert any(
        signal["slug"] == "hip-hop"
        and signal["source"] == "endpoint_genre"
        and signal["provider"] == "explicit"
        for signal in genre["genre_signals"]
    )


def test_missing_metadata_and_unresolved_endpoints_keep_batch_order(context_catalog):
    from crate.db.queries.recommendation_context import load_endpoint_contexts

    contexts = load_endpoint_contexts(
        [
            ("track", "9223372036854775807"),
            ("artist", context_catalog["artists"]["Metadata-free Artist"]["id"]),
            ("album", str(uuid4())),
            ("unsupported", "Punk — Label"),
        ]
    )

    empty = {"artists": [], "genre_weights": {}, "genre_signals": []}
    assert len(contexts) == 4
    assert contexts[0] == contexts[2] == contexts[3] == empty
    assert contexts[1] == {**empty, "artists": ["Metadata-free Artist"]}


def test_batched_context_uses_one_select_and_callers_uncommitted_transaction(
    context_catalog, monkeypatch
):
    from crate.db.queries import recommendation_context
    from crate.genre_taxonomy import resolve_genre_slug

    resolve_genre_slug("punk")
    statements = []

    def forbid_scope():
        raise AssertionError("Context lookup must reuse the caller's transaction")

    monkeypatch.setattr(recommendation_context, "read_scope", forbid_scope)
    with read_scope() as session:
        pending = _insert_track(session, artist="Hybrid Artist", genre="Punk")
        connection = session.connection()

        def record(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith(("SELECT", "WITH")):
                statements.append(statement)

        event.listen(connection, "before_cursor_execute", record)
        try:
            contexts = recommendation_context.load_endpoint_contexts(
                [
                    ("track", pending["id"]),
                    ("album", context_catalog["album"]["id"]),
                    ("artist", context_catalog["artists"]["Guest Artist"]["id"]),
                    ("track", context_catalog["tagged"]["entity_uid"]),
                ],
                session=session,
            )
        finally:
            event.remove(connection, "before_cursor_execute", record)

    assert contexts[0]["artists"] == ["Hybrid Artist"]
    assert contexts[0]["genre_weights"] == {"punk": 1.0}
    assert len(contexts) == 4
    assert len(statements) == 1


def test_empty_context_batch_never_opens_or_uses_a_database_session(monkeypatch):
    from crate.db.queries import recommendation_context

    def forbid_io(*_args, **_kwargs):
        raise AssertionError("An empty context batch must not access the database")

    monkeypatch.setattr(recommendation_context, "read_scope", forbid_io)
    assert recommendation_context.load_endpoint_contexts([]) == []
    assert (
        recommendation_context.load_endpoint_contexts(
            [], session=SimpleNamespace(execute=forbid_io)
        )
        == []
    )
