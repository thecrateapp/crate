#![cfg(feature = "analysis")]

use crate_cli::analyze::{
    analyze_smart_mix_samples, analyze_smart_mix_samples_with_loudness, analyze_smart_mix_segments,
    decode_audio_bounded, AudioTail,
};
use crate_cli::loudness::LoudnessMeter;

const SAMPLE_RATE: u32 = 22_050;

fn click_track(
    start_bpm: f32,
    end_bpm: f32,
    duration_seconds: f32,
    leading_seconds: f32,
    trailing_seconds: f32,
) -> Vec<f32> {
    let mut samples = vec![0.0_f32; (duration_seconds * SAMPLE_RATE as f32) as usize];
    let mut beat_time = leading_seconds;
    let mut beat_index = 0;
    let body_end = duration_seconds - trailing_seconds;
    while beat_time < body_end {
        let progress = beat_time / duration_seconds;
        let bpm = start_bpm + (end_bpm - start_bpm) * progress;
        let amplitude = if beat_index % 4 == 0 { 0.9 } else { 0.35 };
        let start = (beat_time * SAMPLE_RATE as f32) as usize;
        let pulse_samples = (0.025 * SAMPLE_RATE as f32) as usize;
        for offset in 0..pulse_samples {
            if start + offset >= samples.len() {
                break;
            }
            samples[start + offset] +=
                amplitude * (-7.0 * offset as f32 / pulse_samples as f32).exp();
        }
        beat_time += 60.0 / bpm;
        beat_index += 1;
    }
    samples
}

#[test]
fn rust_extracts_versioned_stable_mix_profile() {
    let samples = click_track(120.0, 120.0, 20.0, 0.0, 0.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    assert_eq!(profile.schema_version, 1);
    assert_eq!(profile.analyzer, "crate-rust");
    assert_eq!(profile.quality, "full");
    assert!(
        (profile.bpm.unwrap() - 120.0).abs() <= 1.0,
        "detected BPM was {:?}",
        profile.bpm
    );
    assert!(profile.bpm_confidence.unwrap() >= 0.75);
    assert!(profile.tempo_stability.unwrap() >= 0.8);
    assert!(profile.beat_grid_ms.len() >= 30);
    assert!(profile.downbeat_anchor_ms.is_some());
    assert_eq!(profile.time_signature, Some(4));
}

#[test]
fn rust_marks_drifting_tempo_as_partial() {
    let samples = click_track(120.0, 132.0, 24.0, 0.0, 0.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    assert_eq!(profile.quality, "partial");
    assert!(profile.tempo_stability.unwrap() < 0.8);
}

#[test]
fn rust_cues_avoid_leading_and_trailing_silence() {
    let samples = click_track(128.0, 128.0, 24.0, 2.0, 2.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    assert!(profile.intro_cue_ms.unwrap() >= 1_500);
    assert!(profile.outro_cue_ms.unwrap() > 10_000);
    assert!(profile.outro_cue_ms.unwrap() < 22_000);
    assert!(profile.active_start_ms.unwrap() >= 1_500);
    assert!(profile.active_end_ms.unwrap() <= 22_500);
    assert_eq!(profile.intro_lufs, None);
    assert_eq!(profile.outro_lufs, None);
    assert_eq!(profile.true_peak_dbfs, None);
    assert_eq!(profile.measurement_version, None);
    assert!(profile.intro_energy.is_some());
    assert!(profile.outro_energy.is_some());
}

#[test]
fn rust_profile_serializes_the_shared_camel_case_schema() {
    let profile =
        analyze_smart_mix_samples(&click_track(120.0, 120.0, 12.0, 0.0, 0.0), SAMPLE_RATE);

    let payload = serde_json::to_value(profile).unwrap();

    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["analyzerVersion"], "smart-mix-audio-v2");
    assert!(payload.get("measurementVersion").is_some());
    assert!(payload.get("integratedLufs").is_some());
    assert!(payload.get("activeStartMs").is_some());
    assert!(payload.get("activeEndMs").is_some());
    assert!(payload["beatGridMs"].is_array());
    assert!(payload.get("bpmConfidence").is_some());
    assert!(payload.get("tempoStability").is_some());
    assert!(payload.get("keyConfidence").is_some());
    assert!(payload.get("camelot").is_some());
}

#[test]
fn measured_profile_publishes_bs1770_loudness_and_true_peak() {
    let samples = click_track(128.0, 128.0, 24.0, 2.0, 2.0);
    let mut meter = LoudnessMeter::new(1, SAMPLE_RATE).unwrap();
    meter.push_interleaved(&samples).unwrap();
    let loudness = meter.finish();

    let profile = analyze_smart_mix_samples_with_loudness(&samples, SAMPLE_RATE, Some(&loudness));

    assert_eq!(profile.measurement_version.as_deref(), Some("bs1770-v1"));
    assert!(profile.integrated_lufs.is_some());
    assert!(profile.intro_lufs.is_some());
    assert!(profile.outro_lufs.is_some());
    assert!(profile.true_peak_dbfs.unwrap() <= 0.5);
}

fn write_wav(path: &std::path::Path, samples: &[f32]) {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32_767.0) as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn long_tracks_keep_only_a_bounded_head_and_tail() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("long.wav");
    write_wav(&path, &click_track(124.0, 124.0, 40.0, 0.0, 3.0));

    let decoded = decode_audio_bounded(&path, 10, 10).unwrap();

    assert_eq!(decoded.duration_ms, 40_000);
    assert_eq!(decoded.head.len(), 10 * SAMPLE_RATE as usize);
    let (tail, tail_start_ms) = decoded.tail.as_ref().expect("tail segment");
    assert_eq!(tail.len(), 10 * SAMPLE_RATE as usize);
    assert_eq!(*tail_start_ms, 30_000);
    assert!(decoded.loudness.as_ref().unwrap().integrated_lufs.is_some());

    let profile = analyze_smart_mix_segments(
        &decoded.head,
        Some(AudioTail {
            samples: tail,
            start_ms: *tail_start_ms,
        }),
        decoded.sample_rate,
        Some(decoded.duration_ms),
        decoded.loudness.as_ref(),
    );

    assert_eq!(profile.duration_ms, 40_000);
    assert_eq!(profile.quality, "partial");
    assert!(profile
        .beat_grid_ms
        .iter()
        .all(|position| *position <= 10_000));
    let active_end_ms = profile.active_end_ms.unwrap();
    assert!(
        (36_000..=37_500).contains(&active_end_ms),
        "{active_end_ms}"
    );
    assert!(profile.outro_cue_ms.unwrap() > 30_000);
    assert!(profile.outro_lufs.is_some());
}

#[test]
fn short_tracks_are_still_scanned_in_full() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("short.wav");
    write_wav(&path, &click_track(124.0, 124.0, 15.0, 0.0, 0.0));

    let decoded = decode_audio_bounded(&path, 10, 10).unwrap();

    assert!(decoded.tail.is_none());
    assert_eq!(decoded.head.len(), 15 * SAMPLE_RATE as usize);
    assert_eq!(decoded.duration_ms, 15_000);
}
