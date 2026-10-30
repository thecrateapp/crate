from copy import deepcopy

from crate.db import paths_path_builder as builder
from crate.db import paths_similarity


def test_acoustic_path_uses_real_artists_and_specific_endpoint_genres(monkeypatch):
    genre_map = {
        "seed performer": {"electronic": 1.0},
        "punk candidate": {"punk": 1.0},
        "electronic candidate": {"electronic": 1.0},
    }
    original_genres = deepcopy(genre_map)
    contexts = [
        {"artists": ["Seed Performer"], "genre_weights": {"punk": 1.0}},
        {"artists": ["Destination Performer"], "genre_weights": {}},
    ]
    calls, scored = [], []

    def load(endpoints, **_kwargs):
        calls.append(endpoints)
        return deepcopy(contexts)

    def select(*args, **kwargs):
        artists = args[7]
        score = kwargs["genre_overlap"]
        scored.append(
            (
                artists,
                score("Punk Candidate", artists, genre_map),
                score("Electronic Candidate", artists, genre_map),
            )
        )
        return None

    monkeypatch.setattr(builder, "load_endpoint_contexts", load, raising=False)
    monkeypatch.setattr(builder, "_load_artist_similarity_graph", lambda **_kwargs: {})
    monkeypatch.setattr(builder, "_load_shared_members_graph", lambda **_kwargs: {})
    monkeypatch.setattr(builder, "_load_artist_genres", lambda **_kwargs: genre_map)
    monkeypatch.setattr(builder, "_find_anchor_track", lambda *args, **_kwargs: None)
    monkeypatch.setattr(builder, "_find_best_candidate", select)
    monkeypatch.setattr(
        builder, "resolve_endpoint_label", lambda *a: "Title — Artist", raising=False
    )
    monkeypatch.setattr(
        paths_similarity, "_expand_genre_weights", lambda values: values
    )

    builder.compute_path("track", "1", [0.1] * 20, "album", "2", [0.2] * 20, 3)

    assert scored[0][0] == ["Seed Performer", "Destination Performer"]
    assert scored[0][1] > scored[0][2]
    assert calls == [[("track", "1"), ("album", "2")]]
    assert genre_map == original_genres
