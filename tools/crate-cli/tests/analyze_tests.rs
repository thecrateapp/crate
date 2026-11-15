#![cfg(feature = "analysis")]

mod common;

use std::path::{Path, PathBuf};

use common::{create_test_wav, create_test_wav_with_amplitude};
use crate_cli::analyze::{analyze_track, decode_audio_bounded};
use tempfile::TempDir;

/// Three seconds of AAC-LC in MP4, as ffmpeg encodes it: a 440 Hz sine peaking at 0.64
/// on the left channel and silence on the right.
fn stereo_aac_fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/tests/fixtures/smart_mix/stereo_aac_3s.m4a")
}

#[test]
fn test_analyze_loudness() {
    let dir = TempDir::new().unwrap();

    // Loud sine wave (full amplitude)
    let loud = create_test_wav(&dir, "loud.wav", 440.0, 3.0);
    let loud_result = analyze_track(&loud);
    assert!(loud_result.error.is_none(), "Should analyze without error");
    assert!(loud_result.loudness.is_some());

    // Quiet sine wave - create manually with low amplitude
    let quiet_path = create_test_wav_with_amplitude(&dir, "quiet.wav", 440.0, 3.0, 0.01);

    let quiet_result = analyze_track(&quiet_path);
    assert!(quiet_result.error.is_none());
    assert!(
        loud_result.loudness.unwrap() > quiet_result.loudness.unwrap(),
        "Loud signal ({:?}) should have higher loudness than quiet ({:?})",
        loud_result.loudness,
        quiet_result.loudness
    );
}

#[test]
fn test_analyze_energy_range() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "test.wav", 440.0, 3.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());

    let energy = result.energy.unwrap();
    assert!(
        (0.0..=1.0).contains(&energy),
        "Energy {} should be between 0 and 1",
        energy
    );
}

#[test]
fn test_analyze_key_detection() {
    let dir = TempDir::new().unwrap();
    // A440 should be detected as key A (major or minor)
    let path = create_test_wav(&dir, "a440.wav", 440.0, 5.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    assert!(result.key.is_some(), "Key should be detected");
    assert!(result.scale.is_some(), "Scale should be detected");

    let key = result.key.unwrap();
    let valid_keys = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    assert!(
        valid_keys.contains(&key.as_str()),
        "Key '{}' should be a valid note name",
        key
    );
}

#[test]
fn test_analyze_batch_parallel() {
    let dir = TempDir::new().unwrap();
    create_test_wav(&dir, "t1.wav", 440.0, 2.0);
    create_test_wav(&dir, "t2.wav", 523.25, 2.0);
    create_test_wav(&dir, "t3.wav", 659.25, 2.0);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert_eq!(files.len(), 3);

    use rayon::prelude::*;
    let results: Vec<_> = files.par_iter().map(|f| analyze_track(f)).collect();

    assert_eq!(results.len(), 3);
    for r in &results {
        assert!(
            r.error.is_none(),
            "All tracks should analyze: {:?}",
            r.error
        );
    }
}

#[rstest::rstest]
#[case::invalid("not_audio.txt", b"this is not audio data")]
#[case::empty("empty.wav", b"")]
fn test_analyze_error_files(#[case] filename: &str, #[case] content: &[u8]) {
    let dir = TempDir::new().unwrap();
    let bad_path = dir.path().join(filename);
    std::fs::write(&bad_path, content).unwrap();

    let result = analyze_track(&bad_path);
    assert!(result.error.is_some(), "{} should produce error", filename);
}

#[test]
fn test_analyze_spectral_centroid() {
    let dir = TempDir::new().unwrap();
    // Low frequency
    let low = create_test_wav(&dir, "low.wav", 220.0, 3.0);
    // High frequency
    let high = create_test_wav(&dir, "high.wav", 2000.0, 3.0);

    let low_result = analyze_track(&low);
    let high_result = analyze_track(&high);

    assert!(low_result.error.is_none());
    assert!(high_result.error.is_none());
    assert!(low_result.spectral_centroid.is_some());
    assert!(high_result.spectral_centroid.is_some());

    assert!(
        high_result.spectral_centroid.unwrap() > low_result.spectral_centroid.unwrap(),
        "High freq ({:?}) should have higher centroid than low ({:?})",
        high_result.spectral_centroid,
        low_result.spectral_centroid
    );
}

#[test]
fn test_analyze_dynamic_range() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "test.wav", 440.0, 3.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    assert!(result.dynamic_range.is_some());

    let dr = result.dynamic_range.unwrap();
    assert!(dr >= 0.0, "Dynamic range should be non-negative: {}", dr);
}

#[test]
fn test_analyze_bpm_detection() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "sine.wav", 440.0, 5.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    // BPM may or may not be detected on a pure sine, but should not crash
    // If detected, it should be in a reasonable range
    if let Some(bpm) = result.bpm {
        assert!(
            (30.0..=300.0).contains(&bpm),
            "BPM {} should be in reasonable range",
            bpm
        );
    }
}

#[test]
fn analyze_cli_takes_external_beats_from_a_json_file() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "tone.wav", 220.0, 20.0);
    let beats_ms: Vec<u64> = (0..38).map(|beat| 1_000 + 500 * beat).collect();
    let downbeats_ms: Vec<u64> = beats_ms.iter().skip(1).step_by(4).copied().collect();
    let beats_path = dir.path().join("beats.json");
    std::fs::write(
        &beats_path,
        serde_json::json!({
            "tracker": "beat-this-small0",
            "beats_ms": beats_ms,
            "downbeats_ms": downbeats_ms,
        })
        .to_string(),
    )
    .unwrap();
    let binary = env!("CARGO_BIN_EXE_crate-cli");

    let help = std::process::Command::new(binary)
        .args(["analyze", "--help"])
        .output()
        .unwrap();
    let output = std::process::Command::new(binary)
        .arg("analyze")
        .arg("--file")
        .arg(&path)
        .arg("--beats")
        .arg(&beats_path)
        .output()
        .unwrap();

    // crate_cli.py passes --beats only to a binary whose help lists it.
    assert!(String::from_utf8_lossy(&help.stdout).contains("--beats"));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let profile = &result["mixProfile"];
    assert_eq!(profile["beatTracker"], "beat-this-small0");
    assert_eq!(profile["beatGridMs"][0], 1_000);
    assert_eq!(profile["downbeatAnchorMs"], 1_500);
}

#[test]
fn analyze_cli_takes_the_model_bar_length() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "tone.wav", 220.0, 20.0);
    let beats_ms: Vec<u64> = (0..38).map(|beat| 1_000 + 500 * beat).collect();
    let downbeats_ms: Vec<u64> = beats_ms.iter().step_by(3).copied().collect();
    let beats_path = dir.path().join("beats.json");
    std::fs::write(
        &beats_path,
        serde_json::json!({
            "tracker": "beat-this-small0-dbn",
            "beats_ms": beats_ms,
            "downbeats_ms": downbeats_ms,
            "beats_per_bar": 3,
        })
        .to_string(),
    )
    .unwrap();
    let binary = env!("CARGO_BIN_EXE_crate-cli");

    let help = std::process::Command::new(binary)
        .args(["analyze", "--help"])
        .output()
        .unwrap();
    let output = std::process::Command::new(binary)
        .arg("analyze")
        .arg("--file")
        .arg(&path)
        .arg("--beats")
        .arg(&beats_path)
        .output()
        .unwrap();

    assert!(String::from_utf8_lossy(&help.stdout).contains("beats_per_bar"));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let profile = &result["mixProfile"];
    assert_eq!(profile["beatTracker"], "beat-this-small0-dbn");
    assert_eq!(profile["timeSignature"], 3);
    assert_eq!(profile["downbeatAnchorMs"], serde_json::Value::Null);
    assert_eq!(profile["phrases"], serde_json::json!([]));
}

#[test]
fn analyze_cli_rejects_an_unreadable_beats_file() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "tone.wav", 220.0, 3.0);
    let beats_path = dir.path().join("beats.json");
    std::fs::write(&beats_path, "not json").unwrap();

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_crate-cli"))
        .arg("analyze")
        .arg("--file")
        .arg(&path)
        .arg("--beats")
        .arg(&beats_path)
        .output()
        .unwrap();

    // A failure, so the worker falls back to the Python analyzer with the same beats.
    assert!(!output.status.success());
}

#[test]
fn stereo_aac_in_mp4_decodes_at_its_real_length() {
    // The MP4 demuxer gives no channel count for AAC: read as mono, the interleaved
    // stereo frames came out twice as long, an octave down and half as fast.
    let decoded = decode_audio_bounded(&stereo_aac_fixture(), 600, 120).unwrap();

    // Three seconds plus the encoder's priming and padding, which the demuxer keeps.
    assert!(
        (3_000..=3_100).contains(&decoded.duration_ms),
        "duration {} ms",
        decoded.duration_ms
    );
    let seconds = decoded.head.len() as f64 / f64::from(decoded.sample_rate);
    assert!((3.0..=3.1).contains(&seconds), "{seconds} s of mono audio");
    assert!(decoded.tail.is_none());
    // Both channels go into the mono mix: half the left channel's peak over a silent
    // right (read as mono, the left samples kept their full 0.64).
    let peak = decoded
        .head
        .iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
    assert!((0.28..0.36).contains(&peak), "mono peak {peak}");
    // The loudness meter reads the decoder's layout too.
    let loudness = decoded.loudness.expect("loudness of a stereo AAC file");
    assert!(loudness.integrated_lufs.is_some());
}

#[test]
fn stereo_aac_in_mp4_gets_a_mix_profile_of_its_real_duration() {
    let result = analyze_track(&stereo_aac_fixture());

    assert!(result.error.is_none(), "{:?}", result.error);
    let profile = result.mix_profile.expect("a mix profile");
    assert!(
        (3_000..=3_100).contains(&profile.duration_ms),
        "duration {} ms",
        profile.duration_ms
    );
    assert!(profile.integrated_lufs.is_some());
}
