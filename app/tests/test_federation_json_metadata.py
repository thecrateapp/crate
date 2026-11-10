from __future__ import annotations

import pytest


@pytest.fixture
def federation_api():
    from crate.api import federation

    return federation


def test_json_metadata_list_ignores_invalid_json(federation_api):
    assert federation_api._json_list('{"broken"') == []


def test_manifest_genres_ignores_invalid_json(federation_api):
    assert federation_api._manifest_genres({"genres_json": '{"broken"'}) == []


@pytest.mark.parametrize("helper", ["_json_list", "_manifest_genres"])
@pytest.mark.parametrize("error_type", [ValueError, RecursionError])
def test_json_metadata_helpers_ignore_decoder_input_errors(
    helper, error_type, monkeypatch, federation_api
):
    def invalid_input(_value):
        raise error_type("invalid metadata input")

    monkeypatch.setattr(federation_api._json, "loads", invalid_input)
    value = "[]" if helper == "_json_list" else {"genres_json": "[]"}
    assert getattr(federation_api, helper)(value) == []


@pytest.mark.parametrize("helper", ["_json_list", "_manifest_genres"])
def test_json_metadata_helpers_do_not_hide_unexpected_decoder_failures(
    helper, monkeypatch, federation_api
):
    def broken_decoder(_value):
        raise RuntimeError("unexpected decoder failure")

    monkeypatch.setattr(federation_api._json, "loads", broken_decoder)
    value = "[]" if helper == "_json_list" else {"genres_json": "[]"}
    with pytest.raises(RuntimeError, match="unexpected decoder failure"):
        getattr(federation_api, helper)(value)
