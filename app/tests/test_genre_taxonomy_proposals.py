from types import SimpleNamespace


def test_build_genre_taxonomy_node_proposal_filters_unknown_targets(monkeypatch):
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(
        proposals,
        "get_genre_catalog",
        lambda: {
            "instrumental-rock": {
                "name": "Instrumental Rock",
                "description": "",
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
                "aliases": ["instrumental"],
            },
            "rock": {"name": "Rock", "top_level": True},
            "post-rock": {"name": "Post-Rock", "top_level": False},
        },
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_seed_artists",
        lambda _slug: [{"artist_name": "Mogwai"}],
    )

    class Relation:
        relation_type = "related"
        target_slugs = ["post-rock", "made-up-scene"]
        confidence = 0.91
        reasoning = "Shared instrumental dynamics."

    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal.generate_genre_taxonomy_node_proposal",
        lambda **_kwargs: SimpleNamespace(
            description="Guitar-led instrumental rock with post-rock dynamics.",
            aliases=["instrumental"],
            relations=[Relation()],
            reasoning="Seed artists point to post-rock adjacency.",
        ),
    )

    result = proposals.build_genre_taxonomy_node_proposal("instrumental-rock")

    assert result["ok"] is True
    assert result["description"].startswith("Guitar-led")
    assert result["relations"] == [
        {
            "relation_type": "related",
            "target_slugs": ["post-rock"],
            "confidence": 0.91,
            "reasoning": "Shared instrumental dynamics.",
        }
    ]


def test_build_genre_taxonomy_node_proposal_supports_raw_unmapped_genre(
    monkeypatch,
):
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(
        proposals,
        "get_genre_catalog",
        lambda: {
            "instrumental-rock": {
                "name": "Instrumental Rock",
                "top_level": False,
            },
            "rock": {"name": "Rock", "top_level": True},
        },
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_detail",
        lambda _slug: {
            "name": "Instrumental",
            "artist_count": 1,
            "album_count": 2,
            "artists": [{"artist_name": "Mogwai"}],
            "albums": [
                {"artist": "Mogwai", "name": "Young Team"},
                {
                    "artist": "Explosions in the Sky",
                    "name": "The Earth Is Not a Cold Dead Place",
                },
            ],
        },
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_cooccurring_artist_slugs",
        lambda _slug: [{"canonical_slug": "instrumental-rock"}],
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_cooccurring_album_slugs",
        lambda _slug: [{"canonical_slug": "rock"}],
    )

    captured = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            recommended_action="alias_existing",
            recommended_target_slug="instrumental-rock",
            description="Instrumental rock is guitar-driven rock without vocals.",
            aliases=["instrumental"],
            relations=[],
            reasoning="One local artist and co-occurring nodes make this better as an alias.",
        )

    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal.generate_genre_taxonomy_node_proposal",
        fake_generate,
    )

    result = proposals.build_genre_taxonomy_node_proposal("instrumental")

    assert result["ok"] is True
    assert result["source_kind"] == "raw_genre"
    assert result["recommended_action"] == "alias_existing"
    assert result["recommended_target_slug"] == "instrumental-rock"
    assert result["evidence"]["seed_artists"] == ["Mogwai"]
    assert result["evidence"]["sample_albums"][0] == "Mogwai - Young Team"
    assert captured["source_kind"] == "raw_genre"
    assert captured["artist_count"] == 1
    assert captured["sample_albums"][1].startswith("Explosions in the Sky")
    assert "instrumental-rock" in captured["cooccurring_genres"]
    assert captured["candidate_targets"][0]["slug"] == "instrumental-rock"


def test_build_genre_taxonomy_rebuild_proposal_is_review_only(monkeypatch):
    from crate import genre_taxonomy_inference as inference
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(
        proposals,
        "list_unmapped_genres_for_inference",
        lambda limit: [
            {
                "slug": "instrumental",
                "name": "Instrumental",
                "artist_count": 3,
                "album_count": 4,
            }
        ],
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_catalog",
        lambda: {
            "instrumental-rock": {
                "name": "Instrumental Rock",
                "description": "",
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
                "aliases": [],
                "top_level": False,
                "eq_gains": None,
            },
            "rock": {
                "name": "Rock",
                "description": "Broad guitar music.",
                "parents": [],
                "top_level": True,
                "eq_gains": [0.0] * 10,
            },
        },
    )
    monkeypatch.setattr(
        proposals,
        "get_sound_intelligence_health",
        lambda: {"eq": {"total_tracks": 1, "sources": []}, "taxonomy": {}},
    )
    monkeypatch.setattr(
        proposals,
        "build_genre_taxonomy_node_proposal",
        lambda slug: {
            "ok": True,
            "slug": slug,
            "description": "Instrumental rock without vocals.",
            "relations": [],
        },
    )
    monkeypatch.setattr(
        inference,
        "_collect_local_evidence",
        lambda _slug, _name: SimpleNamespace(
            cooccurring={},
            external={},
            family_hints={},
            artists=["Mogwai"],
        ),
    )
    monkeypatch.setattr(inference, "_collect_external_evidence", lambda _artists: {})
    monkeypatch.setattr(
        inference,
        "infer_canonical_genre",
        lambda *_args, **_kwargs: {
            "canonical_slug": "instrumental-rock",
            "confidence": 0.91,
            "mode": "specific",
            "reason": "lexical and local evidence",
        },
    )

    progress_events = []
    result = proposals.build_genre_taxonomy_rebuild_proposal(
        alias_limit=5,
        node_limit=1,
        progress_callback=progress_events.append,
    )

    assert result["applied"] is False
    assert result["summary"]["alias_proposals"] == 1
    assert result["summary"]["node_proposals"] == 1
    assert result["alias_proposals"][0]["target_slug"] == "instrumental-rock"
    assert progress_events[-1]["phase"] == "nodes"
