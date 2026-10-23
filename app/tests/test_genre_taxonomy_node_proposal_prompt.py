from crate.llm.prompts.genre_taxonomy_node_proposal import (
    build_genre_taxonomy_node_proposal_prompt,
)


def test_genre_taxonomy_node_proposal_prompt_limits_allowed_targets():
    prompt = build_genre_taxonomy_node_proposal_prompt(
        genre_name="Instrumental Rock",
        slug="instrumental-rock",
        current_description="",
        current_relations={"parent": ["rock"]},
        aliases=["instrumental"],
        seed_artists=["Mogwai", "Explosions in the Sky"],
        candidate_targets=[
            {"slug": "rock", "name": "Rock"},
            {"slug": "post-rock", "name": "Post-Rock"},
        ],
    )

    assert "Allowed target slugs:" in prompt
    assert "- post-rock: Post-Rock" in prompt
    assert "Current parent: rock." in prompt
    assert "Known aliases/raw tags: instrumental." in prompt
    assert "Representative artists: Mogwai, Explosions in the Sky." in prompt
    assert "Return exactly ten gains in dB ordered 32, 64, 125" in prompt
    assert "complete EQ suggestion even when the node currently inherits" in prompt


def test_raw_genre_taxonomy_node_prompt_includes_local_evidence_and_merge_guidance():
    prompt = build_genre_taxonomy_node_proposal_prompt(
        genre_name="Instrumental",
        slug="instrumental",
        source_kind="raw_genre",
        aliases=["instrumental"],
        seed_artists=["Mogwai"],
        sample_albums=["Mogwai - Young Team"],
        cooccurring_genres=["instrumental-rock", "post-rock"],
        artist_count=1,
        album_count=1,
        candidate_targets=[
            {"slug": "instrumental-rock", "name": "Instrumental Rock"},
            {"slug": "post-rock", "name": "Post-Rock"},
        ],
    )

    assert "Source kind: raw_genre." in prompt
    assert "Local evidence size: 1 artists, 1 albums." in prompt
    assert "Representative artists: Mogwai." in prompt
    assert "Representative albums: Mogwai - Young Team." in prompt
    assert (
        "Local co-occurring canonical genres: instrumental-rock, post-rock." in prompt
    )
    assert "Use delete_marginal when the tag looks noisy or marginal" in prompt
    assert "Only use create_node when the tag represents a meaningful musical" in prompt
    assert "Use classify_facet for non-genre descriptors" in prompt
    assert "dimension/name pairs" in prompt
    assert "leave EQ gains empty" in prompt


def test_taxonomy_node_prompt_does_not_reclassify_a_canonical_node_as_facet():
    prompt = build_genre_taxonomy_node_proposal_prompt(
        genre_name="Dark Ambient",
        slug="dark-ambient",
        source_kind="taxonomy_node",
    )

    assert "Never use classify_facet" in prompt
