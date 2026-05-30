from crate import equalizer
from crate.db.repositories.equalizer_presets import (
    EqualizerPresetRecord,
    TrackEqualizerContext,
    normalize_eq_gains,
)


def _track_context(
    *,
    track_entity_uid: str | None = "11111111-1111-1111-1111-111111111111",
    album_entity_uid: str | None = "22222222-2222-2222-2222-222222222222",
    energy: float | None = None,
    spectral_complexity: float | None = None,
) -> TrackEqualizerContext:
    return TrackEqualizerContext(
        track_id=10,
        track_entity_uid=track_entity_uid,
        album_id=20 if album_entity_uid else None,
        album_entity_uid=album_entity_uid,
        title="Track",
        artist="Artist",
        album="Album",
        energy=energy,
        loudness=None,
        dynamic_range=None,
        spectral_complexity=spectral_complexity,
        danceability=None,
        valence=None,
        acousticness=None,
        instrumentalness=None,
    )


def _preset(
    *,
    scope: str,
    target_type: str,
    target_entity_uid: str,
    user_id: int | None = None,
    gain: float,
    label: str,
) -> EqualizerPresetRecord:
    return EqualizerPresetRecord(
        id=1,
        scope=scope,
        target_type=target_type,
        target_entity_uid=target_entity_uid,
        user_id=user_id,
        gains=[gain] * 10,
        label=label,
        reasoning="test",
        source="manual",
        created_by=user_id,
    )


def test_normalize_eq_gains_validates_and_clamps_bands():
    assert normalize_eq_gains([-20, -12.123, -1, 0, 1, 2, 3, 4, 12.129, 20]) == [
        -12.0,
        -12.0,
        -1.0,
        0.0,
        1.0,
        2.0,
        3.0,
        4.0,
        12.0,
        12.0,
    ]


def test_resolve_effective_eq_prefers_user_track_preset(monkeypatch):
    context = _track_context()
    presets = {
        ("user", "track", context.track_entity_uid, 7): _preset(
            scope="user",
            target_type="track",
            target_entity_uid=context.track_entity_uid or "",
            user_id=7,
            gain=1.0,
            label="Mine",
        ),
        ("instance", "track", context.track_entity_uid, None): _preset(
            scope="instance",
            target_type="track",
            target_entity_uid=context.track_entity_uid or "",
            gain=2.0,
            label="Curator track",
        ),
        ("instance", "album", context.album_entity_uid, None): _preset(
            scope="instance",
            target_type="album",
            target_entity_uid=context.album_entity_uid or "",
            gain=3.0,
            label="Curator album",
        ),
    }

    monkeypatch.setattr(
        equalizer, "get_track_equalizer_context", lambda _track_id: context
    )
    monkeypatch.setattr(
        equalizer,
        "get_equalizer_preset",
        lambda **kwargs: presets.get(
            (
                kwargs["scope"],
                kwargs["target_type"],
                kwargs["target_entity_uid"],
                kwargs.get("user_id"),
            )
        ),
    )
    monkeypatch.setattr(equalizer, "_resolve_genre_eq", lambda _context: None)

    result = equalizer.resolve_effective_track_eq(10, user_id=7)

    assert result is not None
    assert result.source == "user_track_preset"
    assert result.gains == [1.0] * 10
    assert result.label == "Mine"


def test_resolve_effective_eq_falls_back_to_album_before_analysis(monkeypatch):
    context = _track_context(energy=0.9, spectral_complexity=0.8)
    album_preset = _preset(
        scope="instance",
        target_type="album",
        target_entity_uid=context.album_entity_uid or "",
        gain=3.0,
        label="Album curve",
    )

    def fake_get_preset(**kwargs):
        if kwargs["target_type"] == "album":
            return album_preset
        return None

    monkeypatch.setattr(
        equalizer, "get_track_equalizer_context", lambda _track_id: context
    )
    monkeypatch.setattr(equalizer, "get_equalizer_preset", fake_get_preset)
    monkeypatch.setattr(equalizer, "_resolve_genre_eq", lambda _context: None)

    result = equalizer.resolve_effective_track_eq(10, user_id=7)

    assert result is not None
    assert result.source == "instance_album_preset"
    assert result.gains == [3.0] * 10


def test_resolve_effective_eq_uses_audio_analysis_before_flat(monkeypatch):
    context = _track_context(energy=0.9, spectral_complexity=0.8)
    monkeypatch.setattr(
        equalizer, "get_track_equalizer_context", lambda _track_id: context
    )
    monkeypatch.setattr(equalizer, "get_equalizer_preset", lambda **_kwargs: None)
    monkeypatch.setattr(equalizer, "_resolve_genre_eq", lambda _context: None)

    result = equalizer.resolve_effective_track_eq(10, user_id=7)

    assert result is not None
    assert result.source == "audio_analysis_preset"
    assert result.gains != equalizer.FLAT_EQ_GAINS


def test_save_user_track_preset_requires_track_entity_uid(monkeypatch):
    monkeypatch.setattr(
        equalizer,
        "get_track_equalizer_context",
        lambda _track_id: _track_context(track_entity_uid=None),
    )

    try:
        equalizer.save_user_track_eq_preset(10, user_id=7, gains=[0] * 10)
    except ValueError as exc:
        assert "entity UID" in str(exc)
    else:
        raise AssertionError("Expected missing entity UID to raise")
