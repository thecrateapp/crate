from types import SimpleNamespace


def _request(user_id: int = 7):
    return SimpleNamespace(
        state=SimpleNamespace(
            user={
                "id": user_id,
                "email": "listener@example.test",
                "role": "user",
            }
        )
    )


def test_me_artist_suggestion_creates_request(monkeypatch):
    from crate.api.me import suggest_artist
    from crate.api.schemas.acquisition import ArtistSuggestionCreateRequest

    created: dict = {}
    response = {
        "id": 12,
        "artist_name": "New Band",
        "normalized_artist_name": "new band",
        "status": "new",
        "created_by_user_id": 7,
        "supporter_count": 1,
        "supporters": [],
    }

    def fake_create_artist_suggestion(**kwargs):
        created.update(kwargs)
        return response

    monkeypatch.setattr(
        "crate.api.me.create_artist_suggestion", fake_create_artist_suggestion
    )

    result = suggest_artist(
        _request(),
        ArtistSuggestionCreateRequest(
            artist_name="New Band",
            artist_url="https://example.test/new-band",
            note="Please add this.",
        ),
    )

    assert result == response
    assert created == {
        "user_id": 7,
        "artist_name": "New Band",
        "artist_url": "https://example.test/new-band",
        "note": "Please add this.",
    }


def test_artist_suggestion_reuses_open_duplicate(pg_db):
    from crate.db.repositories.artist_suggestions import create_artist_suggestion

    first_user = pg_db.create_user("artist-suggestion-first@test.com")
    second_user = pg_db.create_user("artist-suggestion-second@test.com")

    first = create_artist_suggestion(
        user_id=first_user["id"],
        artist_name="New Band",
        note="first",
    )
    second = create_artist_suggestion(
        user_id=second_user["id"],
        artist_name=" new   band ",
        note="second",
    )

    assert second["id"] == first["id"]
    assert second["supporter_count"] == 2


def test_acquisition_artist_suggestion_status_updates_as_manager(monkeypatch):
    from crate.api.acquisition import update_acquisition_artist_suggestion
    from crate.api.schemas.acquisition import ArtistSuggestionStatusRequest

    updated: dict = {}
    response = {
        "id": 12,
        "artist_name": "New Band",
        "normalized_artist_name": "new band",
        "status": "dismissed",
        "created_by_user_id": 7,
        "triaged_by_user_id": 1,
        "supporter_count": 1,
        "supporters": [],
    }

    monkeypatch.setattr(
        "crate.api.acquisition._require_acquisition_manager",
        lambda _request: {"id": 1, "role": "librarian"},
    )

    def fake_update_artist_suggestion_status(suggestion_id, **kwargs):
        updated["suggestion_id"] = suggestion_id
        updated.update(kwargs)
        return response

    monkeypatch.setattr(
        "crate.api.acquisition.update_artist_suggestion_status",
        fake_update_artist_suggestion_status,
    )

    result = update_acquisition_artist_suggestion(
        _request(1),
        12,
        ArtistSuggestionStatusRequest(status="dismissed"),
    )

    assert result == response
    assert updated == {
        "suggestion_id": 12,
        "status": "dismissed",
        "actor_user_id": 1,
        "linked_artist_id": None,
        "linked_task_id": None,
    }
