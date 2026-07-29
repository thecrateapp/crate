use std::error::Error;
use std::fmt::{Display, Formatter};

pub const FORMAT_NAME: &str = "delta-ms-v1";
pub const FORMAT_VERSION: u8 = 1;
pub const MAX_BEAT_COUNT: usize = 100_000;
pub const MAX_GRID_DURATION_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_VARINT_BYTES: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MixProfileCodecError(&'static str);

impl Display for MixProfileCodecError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl Error for MixProfileCodecError {}

pub fn encode_beat_grid(positions_ms: &[u64]) -> Result<Vec<u8>, MixProfileCodecError> {
    if positions_ms.len() > MAX_BEAT_COUNT {
        return Err(MixProfileCodecError("beat grid exceeds maximum count"));
    }

    let mut encoded = vec![FORMAT_VERSION];
    encode_varint(positions_ms.len() as u64, &mut encoded);
    let mut previous = 0;
    for &position in positions_ms {
        if position <= previous {
            return Err(MixProfileCodecError(
                "beat positions must be positive and strictly increasing",
            ));
        }
        if position > MAX_GRID_DURATION_MS {
            return Err(MixProfileCodecError("beat grid exceeds duration budget"));
        }
        encode_varint(position - previous, &mut encoded);
        previous = position;
    }
    Ok(encoded)
}

pub fn decode_beat_grid(payload: &[u8]) -> Result<Vec<u64>, MixProfileCodecError> {
    if payload.first().copied() != Some(FORMAT_VERSION) {
        return Err(MixProfileCodecError(
            "unsupported or missing beat grid version",
        ));
    }

    let mut offset = 1;
    let count = decode_varint(payload, &mut offset)?;
    if count > MAX_BEAT_COUNT as u64 {
        return Err(MixProfileCodecError("beat grid exceeds maximum count"));
    }

    let mut positions = Vec::with_capacity(count as usize);
    let mut position = 0_u64;
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
}

fn encode_varint(mut value: u64, encoded: &mut Vec<u8>) {
    loop {
        let current = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            encoded.push(current);
            return;
        }
        encoded.push(current | 0x80);
    }
}

fn decode_varint(payload: &[u8], offset: &mut usize) -> Result<u64, MixProfileCodecError> {
    let mut value = 0_u64;
    let mut shift = 0;
    for _ in 0..MAX_VARINT_BYTES {
        let current = payload
            .get(*offset)
            .copied()
            .ok_or(MixProfileCodecError("truncated beat grid varint"))?;
        *offset += 1;
        value |= u64::from(current & 0x7f) << shift;
        if current & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
    }
    Err(MixProfileCodecError("beat grid varint is too large"))
}
