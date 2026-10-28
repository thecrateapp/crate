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
            eq_gains=[-14, -10, -5, -1, 0, 2, 3, 4, 8, 14],
            eq_reasoning="  Lift   presence without harshness. ",
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
    assert result["eq_gains"] == [
        -12.0,
        -10.0,
        -5.0,
        -1.0,
        0.0,
        2.0,
        3.0,
        4.0,
        8.0,
        12.0,
    ]
    assert result["eq_reasoning"] == "Lift presence without harshness."


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


def test_raw_unmapped_proposal_can_classify_a_tag_as_facet(monkeypatch):
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(
        proposals,
        "get_genre_catalog",
        lambda: {"ambient": {"name": "Ambient", "top_level": True}},
    )
    monkeypatch.setattr(
        proposals,
        "get_genre_detail",
        lambda _slug: {
            "name": "Instrumental",
            "artist_count": 4,
            "album_count": 6,
            "artists": [{"artist_name": "Mogwai"}],
            "albums": [],
        },
    )
    monkeypatch.setattr(
        proposals, "get_genre_cooccurring_artist_slugs", lambda _slug: []
    )
    monkeypatch.setattr(
        proposals, "get_genre_cooccurring_album_slugs", lambda _slug: []
    )

    def fake_generate(**_kwargs):
        return SimpleNamespace(
            recommended_action="classify_facet",
            recommended_target_slug=None,
            facets=[SimpleNamespace(dimension="vocals", name="Instrumental")],
            description="Should not be applied to a facet.",
            aliases=["instrumental"],
            relations=[],
            eq_gains=[],
            eq_reasoning="",
            reasoning="The tag describes vocal presence, not a genre.",
        )

    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal.generate_genre_taxonomy_node_proposal",
        fake_generate,
    )

    result = proposals.build_genre_taxonomy_node_proposal("instrumental")

    assert result["recommended_action"] == "classify_facet"
    assert result["facets"] == [
        {"dimension": "vocals", "slug": "instrumental", "name": "Instrumental"}
    ]
    assert result["description"] == ""
    assert result["aliases"] == []
    assert result["relations"] == []
    assert result["eq_gains"] == []


def test_canonical_node_proposal_cannot_be_classified_as_facet(monkeypatch):
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(
        proposals,
        "get_genre_catalog",
        lambda: {
            "ambient": {
                "name": "Ambient",
                "top_level": True,
                "description": "Atmospheric music.",
                "aliases": [],
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
            }
        },
    )
    monkeypatch.setattr(proposals, "get_genre_seed_artists", lambda _slug: [])
    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal.generate_genre_taxonomy_node_proposal",
        lambda **_kwargs: SimpleNamespace(
            recommended_action="classify_facet",
            facets=[SimpleNamespace(dimension="mood", name="dark")],
            description="Atmospheric music.",
            aliases=[],
            relations=[],
            eq_gains=[0] * 10,
            eq_reasoning="",
            reasoning="Should not reclassify a node.",
        ),
    )

    result = proposals.build_genre_taxonomy_node_proposal("ambient")

    assert result["source_kind"] == "taxonomy_node"
    assert result["recommended_action"] == "needs_review"
    assert result["facets"] == []


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
        lambda slug, **kwargs: {
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
