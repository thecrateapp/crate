"""The `stem-analysis/1` document both stem producers write (STEM-D1, D4)."""

from __future__ import annotations

import base64
from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from crate.smart_mix.stems import (
    STEM_SOURCES,
    StemAnalysis,
    choose_analysis,
    encode_levels,
)

REVISION = "a" * 64
OTHER_REVISION = "b" * 64


def _levels(windows: int, values: tuple[int, ...] = (10, 20, 30, 40)) -> dict:
    return {
        stem: base64.b64encode(bytes([value]) * windows).decode("ascii")
        for stem, value in zip(STEM_SOURCES, values, strict=True)
    }


def _payload(*, windows: int = 8, **changes: Any) -> dict:
    payload = {
        "schema": "stem-analysis/1",
        "producer": "crate-decks/0.4.0",
        "separator": {
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": list(STEM_SOURCES),
        },
        "sourceRevision": REVISION,
        "hopMs": 250,
        "levels": _levels(windows),
        "durationMs": windows * 250,
    }
    payload.update(changes)
    return payload


def _analysis(
    *,
    producer: str = "crate-server/2026.11.8",
    model: str = "htdemucs",
    revision: str = REVISION,
) -> StemAnalysis:
    return StemAnalysis.model_validate(
        _payload(
            producer=producer,
            separator={
                "model": model,
                "version": f"{model}-onnx-1",
                "sources": list(STEM_SOURCES),
            },
            sourceRevision=revision,
        )
    )


def test_the_json_document_round_trips_with_base64_levels() -> None:
    payload = _payload(drumBeatsMs=[0, 500, 1_000, 1_500])

    analysis = StemAnalysis.model_validate_json(
        StemAnalysis.model_validate(payload).model_dump_json(by_alias=True)
    )

    assert analysis.levels.drums == bytes([10]) * 8
    assert analysis.levels.vocals == bytes([40]) * 8
    assert analysis.producer_kind == "decks"
    assert analysis.model_dump(by_alias=True, mode="json") == payload


def test_rejects_unknown_schema() -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(schema="stem-analysis/2"))
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(
            {key: value for key, value in _payload().items() if key != "schema"}
        )


def test_rejects_unknown_fields_at_every_level() -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(audio="UklGRg=="))
    separator = {**_payload()["separator"], "weights": "htdemucs.th"}
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(separator=separator))


@pytest.mark.parametrize(
    "sources",
    [
        ["drums", "bass", "other"],
        ["drums", "bass", "other", "vocals", "guitar"],
        ["drums", "bass", "piano", "vocals"],
        ["vocals", "drums", "bass", "other"],
    ],
)
def test_rejects_sources_other_than_the_four(sources: list[str]) -> None:
    separator = {**_payload()["separator"], "sources": sources}

    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(separator=separator))


def test_rejects_levels_for_other_stems() -> None:
    levels = _levels(8)
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(
            _payload(levels={**levels, "guitar": levels["other"]})
        )
    del levels["bass"]
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(levels=levels))


def test_rejects_a_separator_model_that_is_not_accepted() -> None:
    separator = {**_payload()["separator"], "model": "htdemucs_6s"}

    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(separator=separator))


@pytest.mark.parametrize(
    ("duration_ms", "accepted", "rejected"),
    [(2_000, 9, 10), (2_100, 9, 10)],
)
def test_rejects_levels_longer_than_duration_plus_one_window(
    duration_ms: int, accepted: int, rejected: int
) -> None:
    StemAnalysis.model_validate(
        _payload(levels=_levels(accepted), durationMs=duration_ms)
    )

    with pytest.raises(ValidationError, match="longer than"):
        StemAnalysis.model_validate(
            _payload(levels=_levels(rejected), durationMs=duration_ms)
        )


def test_rejects_levels_shorter_than_duration_minus_one_window() -> None:
    StemAnalysis.model_validate(_payload(levels=_levels(7), durationMs=2_000))

    with pytest.raises(ValidationError, match="shorter than"):
        StemAnalysis.model_validate(_payload(levels=_levels(6), durationMs=2_000))


def test_rejects_stems_with_different_window_counts() -> None:
    levels = _levels(8)
    levels["vocals"] = base64.b64encode(bytes(7)).decode("ascii")

    with pytest.raises(ValidationError, match="same number of windows"):
        StemAnalysis.model_validate(_payload(levels=levels))


def test_rejects_levels_that_are_not_base64() -> None:
    levels = {**_levels(8), "drums": "not base64!"}

    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(levels=levels))


@pytest.mark.parametrize("beats", [[0, 500, 500], [500, 0], [-1, 500], [0, 2_001]])
def test_rejects_drum_beats_out_of_order_or_outside_the_track(
    beats: list[int],
) -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(drumBeatsMs=beats))


@pytest.mark.parametrize(
    ("producer", "kind"),
    [("crate-decks/0.4.0", "decks"), ("crate-server/2026.11.8+8d1430fa", "server")],
)
def test_the_producer_names_its_kind(producer: str, kind: str) -> None:
    assert (
        StemAnalysis.model_validate(_payload(producer=producer)).producer_kind == kind
    )


@pytest.mark.parametrize("producer", ["mixxx/2.5", "crate-decks/", "crate-decks", ""])
def test_rejects_a_producer_that_is_not_crate(producer: str) -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(producer=producer))


@pytest.mark.parametrize("revision", ["source-v1", "A" * 64, "a" * 63])
def test_rejects_a_source_revision_that_is_not_the_server_hash(revision: str) -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(sourceRevision=revision))


def test_rejects_another_window_length() -> None:
    with pytest.raises(ValidationError):
        StemAnalysis.model_validate(_payload(hopMs=500))


def test_encodes_minus_60_db_as_0_and_0_db_as_255() -> None:
    assert encode_levels(np.array([-60.0, 0.0])) == bytes([0, 255])
    # Linear in dB, clipped, rounded half up: -30 dB is 127.5 and encodes as 128.
    assert encode_levels(
        np.array([-np.inf, -120.0, -59.9, -59.8, -30.0, 6.0])
    ) == bytes([0, 0, 0, 1, 128, 255])
    assert encode_levels(np.array([], dtype=np.float32)) == b""


def test_encoding_rejects_nan_and_matrices() -> None:
    with pytest.raises(ValueError):
        encode_levels(np.array([-10.0, np.nan]))
    with pytest.raises(ValueError):
        encode_levels(np.zeros((2, 4)))


def test_choose_ignores_analyses_of_another_source_revision() -> None:
    stale = _analysis(model="htdemucs_ft", revision=OTHER_REVISION)
    current = _analysis(producer="crate-decks/0.4.0")

    assert choose_analysis([stale, current], source_revision=REVISION) == current
    assert choose_analysis([stale], source_revision=REVISION) is None
    assert choose_analysis([], source_revision=REVISION) is None


def test_choose_prefers_the_stronger_separator_whoever_produced_it() -> None:
    server = _analysis()
    decks = _analysis(producer="crate-decks/0.4.0", model="htdemucs_ft")

    assert choose_analysis([server, decks], source_revision=REVISION) == decks
    assert choose_analysis([decks, server], source_revision=REVISION) == decks


def test_choose_prefers_the_server_on_a_tie() -> None:
    server = _analysis()
    decks = _analysis(producer="crate-decks/0.4.0")

    assert choose_analysis([decks, server], source_revision=REVISION) == server
    assert choose_analysis([server, decks], source_revision=REVISION) == server
