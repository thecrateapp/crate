from crate.llm.prompts.playlist_description import build_playlist_description_prompt


def test_playlist_description_prompt_includes_editorial_context():
    prompt = build_playlist_description_prompt(
        name="Screamo Core Tracks",
        category="genre",
        smart_rules={"rules": [{"field": "genre", "op": "is", "value": "screamo"}]},
        tracks=[
            {
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "genre": "screamo, hardcore",
            },
            {
                "title": "January 10th, 2014",
                "artist": "The World Is a Beautiful Place...",
                "album": "Harmlessness",
                "genre": "screamo",
            },
        ],
    )

    assert 'Write a playlist description for "Screamo Core Tracks".' in prompt
    assert "Representative artists: Converge" in prompt
    assert "Genre signals: screamo" in prompt
    assert "No markdown" in prompt
