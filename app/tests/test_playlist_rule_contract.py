import pytest

from crate.playlist_blueprints import build_playlist_blueprints
from crate.playlist_rule_contract import validate_smart_rules
from crate.api.schemas.curation import CreateSystemPlaylistRequest
from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_collection_reads import get_playlist
from crate.api.system_playlists import _validate_generation_mode
from fastapi import HTTPException


def test_editorial_rules_reject_unknown_sort_and_ignored_keys():
    with pytest.raises(ValueError, match="sort"):
        validate_smart_rules({"rules": [], "sort": "surprise"})
    with pytest.raises(ValueError, match="unsupported"):
        validate_smart_rules({"rules": [], "prefer_studio": True})


def test_editorial_rules_reject_unbounded_or_invalid_selections():
    with pytest.raises(ValueError, match="limit"):
        validate_smart_rules({"rules": [], "limit": 501})
    with pytest.raises(ValueError, match="field"):
        validate_smart_rules({"rules": [{"field": "sql", "op": "eq", "value": "x"}]})
    with pytest.raises(ValueError, match="Numeric"):
        validate_smart_rules(
            {"rules": [{"field": "bpm", "op": "gte", "value": "fast"}]}
        )
    with pytest.raises(ValueError, match="four-digit"):
        validate_smart_rules({"rules": [{"field": "year", "op": "gte", "value": 2000}]})


def test_blueprints_use_only_executable_rules():
    for blueprint in [
        *build_playlist_blueprints(artist_name="Poison The Well"),
        *build_playlist_blueprints(genre_name="screamo"),
    ]:
        assert validate_smart_rules(blueprint["smart_rules"])


def test_system_create_preserves_auto_refresh_choice(pg_db):
    request = CreateSystemPlaylistRequest(name="Selected", auto_refresh_enabled=False)
    assert request.auto_refresh_enabled is False
    playlist_id = create_playlist(
        "Selected", scope="system", auto_refresh_enabled=request.auto_refresh_enabled
    )
    assert get_playlist(playlist_id)["auto_refresh_enabled"] is False


def test_admin_rejects_unsupported_new_smart_rules():
    with pytest.raises(HTTPException) as error:
        _validate_generation_mode("smart", {"rules": [], "sort": "surprise"})
    assert error.value.status_code == 422
