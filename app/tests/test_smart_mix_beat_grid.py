from __future__ import annotations

import json
from pathlib import Path

import pytest

from crate.smart_mix.beat_grid import (
    BeatGridCodecError,
    MAX_BEAT_COUNT,
    decode_beat_grid,
    encode_beat_grid,
)

FIXTURE = Path(__file__).parent / "fixtures" / "smart_mix" / "beat_grid_v1.json"


@pytest.mark.parametrize("beat_count", [0, 1, 16, 500, 5_000])
def test_delta_ms_round_trips_generated_monotonic_grids(
    beat_count: int,
) -> None:
    positions = [round(index * 468.75, 3) for index in range(1, beat_count + 1)]

    decoded = decode_beat_grid(encode_beat_grid(positions))

    assert len(decoded) == len(positions)
    assert all(
        abs(expected - actual) <= 1
        for expected, actual in zip(positions, decoded, strict=True)
    )


def test_empty_grid_has_an_explicit_versioned_representation() -> None:
    encoded = encode_beat_grid([])

    assert encoded == b"\x01\x00"
    assert decode_beat_grid(encoded) == []


@pytest.mark.parametrize(
    "positions",
    [[100, 100], [200, 100], [-1], [float("nan")]],
)
def test_rejects_invalid_or_non_monotonic_grids(positions: list[float]) -> None:
    with pytest.raises(BeatGridCodecError):
        encode_beat_grid(positions)


@pytest.mark.parametrize(
    "payload",
    [b"", b"\x02\x00", b"\x01", b"\x01\x01\x80", b"\x01\x01\x00"],
)
def test_rejects_malformed_payloads(payload: bytes) -> None:
    with pytest.raises(BeatGridCodecError):
        decode_beat_grid(payload)


def test_enforces_maximum_beat_count() -> None:
    with pytest.raises(BeatGridCodecError):
        encode_beat_grid(range(1, MAX_BEAT_COUNT + 2))


def test_binary_encoding_is_smaller_than_json_floats() -> None:
    positions = [index * 468.75 for index in range(1, 2_000)]

    encoded = encode_beat_grid(positions)
    json_payload = json.dumps(positions).encode()

    assert len(encoded) < len(json_payload) / 3


def test_python_matches_the_shared_golden_fixture() -> None:
    fixture = json.loads(FIXTURE.read_text())

    encoded = encode_beat_grid(fixture["positionsMs"])

    assert encoded.hex() == fixture["encodedHex"]
    assert (
        decode_beat_grid(bytes.fromhex(fixture["encodedHex"])) == fixture["positionsMs"]
    )
