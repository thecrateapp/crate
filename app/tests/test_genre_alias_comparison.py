from crate.genre_alias_rules import genre_alias_is_unchanged


def _existing_alias(**overrides):
    return {
        "alias_slug": "rock-en-espanol",
        "genre_id": 7,
        "origin": "manual",
        "confidence": 0.8,
        **overrides,
    }


def test_genre_alias_matches_when_all_persisted_values_are_unchanged():
    assert genre_alias_is_unchanged(
        _existing_alias(), "rock-en-espanol", 7, "manual", 0.8
    )


def test_genre_alias_matches_numeric_confidence_representations():
    from decimal import Decimal

    assert genre_alias_is_unchanged(
        _existing_alias(confidence=Decimal("0.8")),
        "rock-en-espanol",
        7,
        "manual",
        0.8,
    )


def test_genre_alias_matches_null_confidence_when_both_are_null():
    assert genre_alias_is_unchanged(
        _existing_alias(confidence=None), "rock-en-espanol", 7, "manual", None
    )


def test_genre_alias_does_not_match_when_persisted_identity_changes():
    assert not genre_alias_is_unchanged(
        _existing_alias(alias_slug="rock-espanol"),
        "rock-en-espanol",
        7,
        "manual",
        0.8,
    )
    assert not genre_alias_is_unchanged(
        _existing_alias(genre_id=8), "rock-en-espanol", 7, "manual", 0.8
    )
    assert not genre_alias_is_unchanged(
        _existing_alias(origin="inferred"), "rock-en-espanol", 7, "manual", 0.8
    )


def test_genre_alias_does_not_match_when_confidence_changes():
    assert not genre_alias_is_unchanged(
        _existing_alias(confidence=0.7), "rock-en-espanol", 7, "manual", 0.8
    )
    assert not genre_alias_is_unchanged(
        _existing_alias(confidence=None), "rock-en-espanol", 7, "manual", 0.8
    )


def test_missing_genre_alias_does_not_match():
    assert not genre_alias_is_unchanged(None, "rock-en-espanol", 7, "manual", 0.8)
    assert not genre_alias_is_unchanged({}, "rock-en-espanol", 7, "manual", 0.8)
