from crate.llm.prompts.genre_node_description import (
    build_genre_node_description_prompt,
)


def test_genre_node_description_prompt_includes_taxonomy_context():
    prompt = build_genre_node_description_prompt(
        genre_name="Instrumental Rock",
        slug="instrumental-rock",
        parent_genres=["rock"],
        related_genres=["post-rock", "math rock"],
        aliases=["instrumental"],
        seed_artists=["Russian Circles"],
    )

    assert 'description for the music genre "Instrumental Rock"' in prompt
    assert "Parent genres: rock." in prompt
    assert "Related genres: post-rock, math rock." in prompt
    assert "Known aliases/tags: instrumental." in prompt
    assert "Local library artist examples: Russian Circles." in prompt
