#![cfg(feature = "analysis")]

use crate_cli::analyze::analyze_smart_mix_samples;

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
    assert!(profile.intro_lufs.is_some());
    assert!(profile.outro_lufs.is_some());
    assert!(profile.intro_energy.is_some());
    assert!(profile.outro_energy.is_some());
}

#[test]
fn rust_profile_serializes_the_shared_camel_case_schema() {
    let profile =
        analyze_smart_mix_samples(&click_track(120.0, 120.0, 12.0, 0.0, 0.0), SAMPLE_RATE);

    let payload = serde_json::to_value(profile).unwrap();

    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["analyzerVersion"], "smart-mix-v1");
    assert!(payload["beatGridMs"].is_array());
    assert!(payload.get("bpmConfidence").is_some());
    assert!(payload.get("tempoStability").is_some());
    assert!(payload.get("keyConfidence").is_some());
    assert!(payload.get("camelot").is_some());
}
