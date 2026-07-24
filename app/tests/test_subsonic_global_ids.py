from __future__ import annotations

import pytest


@pytest.mark.parametrize(
    ("value", "kind", "scope", "identity"),
    [
        ("ar-42", "artist", "local", 42),
        ("al-17", "album", "local", 17),
        ("99", "track", "local", 99),
        (
            "ga-11111111-1111-4111-8111-111111111111",
            "artist",
            "global",
            "11111111-1111-4111-8111-111111111111",
        ),
        (
            "gal-22222222-2222-4222-8222-222222222222",
            "album",
            "global",
            "22222222-2222-4222-8222-222222222222",
        ),
        (
            "gt-33333333-3333-4333-8333-333333333333",
            "track",
            "global",
            "33333333-3333-4333-8333-333333333333",
        ),
    ],
)
def test_subsonic_id_codec_accepts_legacy_and_typed_global_ids(
    value, kind, scope, identity
):
    from crate.subsonic.global_ids import decode_subsonic_id, encode_subsonic_id

    decoded = decode_subsonic_id(value, expected_kind=kind)

    assert decoded.scope == scope
    assert decoded.identity == identity
    assert encode_subsonic_id(decoded) == value


@pytest.mark.parametrize(
    ("value", "expected_kind"),
    [
        ("ga-11111111-1111-4111-8111-111111111111", "album"),
        ("gt-not-a-uuid", "track"),
        ("wat-11111111-1111-4111-8111-111111111111", "track"),
        ("-1", "track"),
        ("ar-zero", "artist"),
    ],
)
def test_subsonic_id_codec_rejects_wrong_type_invalid_uuid_and_unknown_prefix(
    value, expected_kind
):
    from crate.subsonic.global_ids import SubsonicIdError, decode_subsonic_id

    with pytest.raises(SubsonicIdError) as error:
        decode_subsonic_id(value, expected_kind=expected_kind)

    assert error.value.code == 70
    assert error.value.message == "Invalid Subsonic entity ID"
