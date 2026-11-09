---
title: "A beat grid in two bytes per beat"
description: "Smart Mix keeps every beat of every analysed track. Storing gaps as varints instead of timestamps cuts a six-minute grid from 6 KB to 1.5 KB."
date: 2026-11-10
tags: [Smart Mix, encoding, PostgreSQL, Rust]
sources:
  - app/crate/smart_mix/beat_grid.py
  - tools/crate-cli/src/mix_profile.rs
  - app/tests/fixtures/smart_mix/beat_grid_v1.json
  - app/crate/smart_mix/tempo_grid.py
---

To beatmatch two tracks we need to know where every beat falls. In Smart Mix, the part of Crate that plans
DJ-style transitions, we keep a beat grid for every analysed track: one timestamp per beat.

A six-minute track at 128 BPM has 767 beats. Written as 64-bit floats that's 6,136 bytes; as a JSON array of
milliseconds, 5,900. Per track it's nothing. Multiplied by a library it adds up: if all of production's roughly
138,000 tracks were six minutes at 128 BPM, float grids alone would take about 850 MB.

The gaps between timestamps are much smaller than the timestamps themselves. At 128 BPM a beat lands every
468.75 ms, so the gaps in milliseconds are 469, 468, 469, 469. We store those gaps.

## The format

The format is called `delta-ms-v1`. It is one version byte, the number of beats, then one gap per beat, all in
whole milliseconds. The first gap is measured from zero, so it doubles as the time of the first beat.

```python source="app/crate/smart_mix/beat_grid.py#L22-L34" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "position - previous"
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
```

Each number is written as a varint (unsigned LEB128): seven bits of value per byte, with the top bit saying whether
another byte follows. Any gap from 128 ms to 16,383 ms fits in exactly two bytes, which covers every tempo from
about 3.7 to 468 BPM. The gaps between beats cost two bytes at those tempos.

We test both implementations against the same golden fixture: five beats in twelve bytes.

![Twelve bytes decoded into five beats, with the 469 ms gap broken down into its two varint bytes.](/blog/a-beat-grid-in-a-few-bytes/encoding.svg)

For the six-minute track that's 1 + 2 + 767 × 2 = 1,537 bytes, a quarter of the float version. Across that
hypothetical library of six-minute tracks it's about 210 MB instead of 850.

## Where precision goes

We round the beat positions before calculating the gaps. For steady tracks, the analyser computes every beat
from an anchor and a period, then rounds each position on its own:

```python source="app/crate/smart_mix/tempo_grid.py#L67-L75" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "_round_half_away(position)"
def beats_ms(self, from_ms: float, to_ms: float) -> tuple[int, ...]:
    first = int(_round_half_away((from_ms - self.anchor_ms) / self.period_ms))
    last = int(_round_half_away((to_ms - self.anchor_ms) / self.period_ms))
    positions = (
        self.anchor_ms + index * self.period_ms for index in range(first, last + 1)
    )
    return tuple(
        int(_round_half_away(position)) for position in positions if position >= 1.0
    )
```

Gaps are then taken between those rounded times, so decoding gives back exactly the same whole milliseconds. Each
beat is at most half a millisecond from where the analyser put it, about 0.1% of a beat at 128 BPM, and the
error never carries over to the next beat. That's why the gaps alternate between 468 and 469.

## Strict on the way back

The decoder rejects an unknown version byte, a count above 100,000 beats, a zero gap, a grid longer than 24
hours, a varint cut short or longer than ten bytes, and leftover bytes at the end. A grid that fails these checks
raises an error before it can supply beat positions to a mix.

Python writes the grids into the database. The Rust command-line tool that runs the audio analysis keeps its own
copy of the codec, and tests hold the two together:

```rust source="tools/crate-cli/src/mix_profile.rs#L180-L198" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "checked_add"
for _ in 0..count {
    let delta = decode_varint(payload, &mut offset)?;
    if delta == 0 {
        return Err(MixProfileCodecError("beat deltas must be positive"));
    }
    position = position
        .checked_add(delta)
        .ok_or(MixProfileCodecError("beat position overflow"))?;
    if position > MAX_GRID_DURATION_MS {
        return Err(MixProfileCodecError("beat grid exceeds duration budget"));
    }
    positions.push(position);
}
if offset != payload.len() {
    return Err(MixProfileCodecError(
        "beat grid payload contains trailing bytes",
    ));
}
Ok(positions)
```

Both read the same fixture file, `app/tests/fixtures/smart_mix/beat_grid_v1.json`, and must produce the same hex
and decode it back to the same beats. Another test checks that both sides call the format by the same name.

## Where the bytes live

The grid is stored in `track_mix_profiles` as two columns, `beat_grid_format` and `beat_grid_data` (a `BYTEA`),
with a check that they are either both set or both empty. Clients never see the binary. The mix profile API
returns a summary by default, and only `detail=full` adds `beatGridMs`, decoded into a plain JSON list.

## What we left on the table

Steady-tempo grids are very repetitive. The six-minute grid above compresses with zlib from 1,537 bytes to 30, and
a steady grid is already fully described by its anchor and BPM, which the profile also stores. The codec uses
neither fact and spends two bytes per beat even when every gap is the same.

We use the same per-beat format for steady tracks and tracks whose tempo drifts. That costs about 1.5 KB for
the six-minute example, even though its regular grid could be much smaller. PostgreSQL only tries to compress
values above roughly 2 KB, so most grids are stored as they are. If grid storage or transfer becomes a problem,
we could try run-length encoding for repeated gaps. That would need its own version byte.

## Read the code

The Python codec is `app/crate/smart_mix/beat_grid.py` and the Rust one is in `tools/crate-cli/src/mix_profile.rs`.
The shared fixture is `app/tests/fixtures/smart_mix/beat_grid_v1.json`.
