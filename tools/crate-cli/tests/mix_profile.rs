use std::fs;
use std::path::PathBuf;

use crate_cli::mix_profile::{decode_beat_grid, encode_beat_grid};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeatGridFixture {
    format: String,
    positions_ms: Vec<u64>,
    encoded_hex: String,
}

fn fixture() -> BeatGridFixture {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/tests/fixtures/smart_mix/beat_grid_v1.json");
    serde_json::from_str(&fs::read_to_string(path).expect("fixture must exist"))
        .expect("fixture must be valid JSON")
}

#[test]
fn rust_matches_the_shared_python_golden_fixture() {
    let fixture = fixture();

    assert_eq!(fixture.format, "delta-ms-v1");
    assert_eq!(
        hex::encode(encode_beat_grid(&fixture.positions_ms).unwrap()),
        fixture.encoded_hex
    );
    assert_eq!(
        decode_beat_grid(&hex::decode(fixture.encoded_hex).unwrap()).unwrap(),
        fixture.positions_ms
    );
}

#[test]
fn rust_rejects_non_monotonic_and_malformed_grids() {
    assert!(encode_beat_grid(&[100, 100]).is_err());
    assert!(decode_beat_grid(&[]).is_err());
    assert!(decode_beat_grid(&[2, 0]).is_err());
    assert!(decode_beat_grid(&[1, 1, 0]).is_err());
}
