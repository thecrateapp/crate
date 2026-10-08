from __future__ import annotations

import math
from collections.abc import Iterable

FORMAT_NAME = "delta-ms-v1"
FORMAT_VERSION = 1
MAX_BEAT_COUNT = 100_000
MAX_GRID_DURATION_MS = 24 * 60 * 60 * 1_000
_MAX_VARINT_BYTES = 10


class BeatGridCodecError(ValueError):
    pass


def encode_beat_grid(positions_ms: Iterable[int | float]) -> bytes:
    positions = [_rounded_ms(position) for position in positions_ms]
    if len(positions) > MAX_BEAT_COUNT:
        raise BeatGridCodecError(f"beat grid exceeds {MAX_BEAT_COUNT} positions")

    encoded = bytearray([FORMAT_VERSION])
    encoded.extend(_encode_varint(len(positions)))
    previous = 0
    for position in positions:
        if position <= previous:
            raise BeatGridCodecError(
                "beat positions must be positive and strictly increasing"
            )
        if position > MAX_GRID_DURATION_MS:
            raise BeatGridCodecError("beat grid exceeds the duration budget")
        encoded.extend(_encode_varint(position - previous))
        previous = position
    return bytes(encoded)


def decode_beat_grid(payload: bytes) -> list[int]:
    if not payload:
        raise BeatGridCodecError("beat grid payload is empty")
    if payload[0] != FORMAT_VERSION:
        raise BeatGridCodecError("unsupported beat grid format version")

    offset = 1
    count, offset = _decode_varint(payload, offset)
    if count > MAX_BEAT_COUNT:
        raise BeatGridCodecError(f"beat grid exceeds {MAX_BEAT_COUNT} positions")

    positions: list[int] = []
    position = 0
    for _ in range(count):
        delta, offset = _decode_varint(payload, offset)
        if delta <= 0:
            raise BeatGridCodecError("beat deltas must be positive")
        position += delta
        if position > MAX_GRID_DURATION_MS:
            raise BeatGridCodecError("beat grid exceeds the duration budget")
        positions.append(position)
    if offset != len(payload):
        raise BeatGridCodecError("beat grid payload contains trailing bytes")
    return positions


def _rounded_ms(value: int | float) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BeatGridCodecError("beat positions must be numeric milliseconds")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise BeatGridCodecError(
            "beat positions must be finite non-negative milliseconds"
        )
    return round(number)


def _encode_varint(value: int) -> bytes:
    if value < 0:
        raise BeatGridCodecError("varints cannot encode negative values")
    encoded = bytearray()
    while True:
        current = value & 0x7F
        value >>= 7
        if value:
            encoded.append(current | 0x80)
        else:
            encoded.append(current)
            return bytes(encoded)


def _decode_varint(payload: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    for _ in range(_MAX_VARINT_BYTES):
        if offset >= len(payload):
            raise BeatGridCodecError("truncated beat grid varint")
        current = payload[offset]
        offset += 1
        value |= (current & 0x7F) << shift
        if current & 0x80 == 0:
            return value, offset
        shift += 7
    raise BeatGridCodecError("beat grid varint is too large")
