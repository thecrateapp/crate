use std::error::Error;
use std::fmt::{Display, Formatter};

use serde::Serialize;

pub const FORMAT_NAME: &str = "delta-ms-v1";
pub const FORMAT_VERSION: u8 = 1;
pub const MAX_BEAT_COUNT: usize = 100_000;
pub const MAX_GRID_DURATION_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_VARINT_BYTES: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartMixProfileResult {
    pub schema_version: u8,
    pub analyzer: String,
    pub analyzer_version: String,
    pub duration_ms: u64,
    pub quality: String,
    pub bpm: Option<f32>,
    pub bpm_confidence: Option<f32>,
    pub tempo_stability: Option<f32>,
    pub beat_anchor_ms: Option<u64>,
    pub downbeat_anchor_ms: Option<u64>,
    pub time_signature: Option<u8>,
    pub beat_grid_ms: Vec<u64>,
    pub key: Option<String>,
    pub scale: Option<String>,
    pub camelot: Option<String>,
    pub key_confidence: Option<f32>,
    pub intro_cue_ms: Option<u64>,
    pub outro_cue_ms: Option<u64>,
    pub intro_lufs: Option<f32>,
    pub outro_lufs: Option<f32>,
    pub true_peak_dbfs: Option<f32>,
    pub intro_energy: Option<f32>,
    pub outro_energy: Option<f32>,
    pub intro_spectral_density: Option<f32>,
    pub outro_spectral_density: Option<f32>,
    pub global_energy: Option<f32>,
}

impl SmartMixProfileResult {
    pub fn unavailable(duration_ms: u64) -> Self {
        Self {
            schema_version: 1,
            analyzer: "crate-rust".to_string(),
            analyzer_version: "smart-mix-v1".to_string(),
            duration_ms,
            quality: "unavailable".to_string(),
            bpm: None,
            bpm_confidence: Some(0.0),
            tempo_stability: Some(0.0),
            beat_anchor_ms: None,
            downbeat_anchor_ms: None,
            time_signature: None,
            beat_grid_ms: Vec::new(),
            key: None,
            scale: None,
            camelot: None,
            key_confidence: Some(0.0),
            intro_cue_ms: None,
            outro_cue_ms: None,
            intro_lufs: None,
            outro_lufs: None,
            true_peak_dbfs: None,
            intro_energy: None,
            outro_energy: None,
            intro_spectral_density: None,
            outro_spectral_density: None,
            global_energy: None,
        }
    }
}

pub fn to_camelot(key: &str, scale: &str) -> Option<&'static str> {
    match (key, scale) {
        ("G#", "minor") => Some("1A"),
        ("D#", "minor") => Some("2A"),
        ("A#", "minor") => Some("3A"),
        ("F", "minor") => Some("4A"),
        ("C", "minor") => Some("5A"),
        ("G", "minor") => Some("6A"),
        ("D", "minor") => Some("7A"),
        ("A", "minor") => Some("8A"),
        ("E", "minor") => Some("9A"),
        ("B", "minor") => Some("10A"),
        ("F#", "minor") => Some("11A"),
        ("C#", "minor") => Some("12A"),
        ("B", "major") => Some("1B"),
        ("F#", "major") => Some("2B"),
        ("C#", "major") => Some("3B"),
        ("G#", "major") => Some("4B"),
        ("D#", "major") => Some("5B"),
        ("A#", "major") => Some("6B"),
        ("F", "major") => Some("7B"),
        ("C", "major") => Some("8B"),
        ("G", "major") => Some("9B"),
        ("D", "major") => Some("10B"),
        ("A", "major") => Some("11B"),
        ("E", "major") => Some("12B"),
        _ => None,
    }
}

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
