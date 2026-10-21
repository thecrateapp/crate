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
fn rust_tempo_is_precise_enough_to_extrapolate_to_late_cues() {
    let samples = click_track(120.0, 120.0, 150.0, 0.0, 0.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    let bpm = f64::from(profile.bpm.unwrap());
    let anchor = profile.downbeat_anchor_ms.unwrap() as f64;
    let beats_to_cue = (140_000.0 - anchor) / 500.0;
    let drift_ms = beats_to_cue * (60_000.0 / bpm - 500.0);
    assert!(
        drift_ms.abs() <= 3.0,
        "bpm {bpm} drifts {drift_ms} ms by the cue"
    );
    for position in profile.beat_grid_ms.iter().take(20) {
        let error = *position as f64 - (*position as f64 / 500.0).round() * 500.0;
        assert!(
            error.abs() <= 3.0,
            "beat at {position} ms is {error} ms off"
        );
    }
}

fn click_times_ms(start_bpm: f32, end_bpm: f32, duration_seconds: f32) -> Vec<f64> {
    let mut times = Vec::new();
    let mut beat_time = 0.0_f32;
    while beat_time < duration_seconds {
        times.push(f64::from(beat_time) * 1_000.0);
        let bpm = start_bpm + (end_bpm - start_bpm) * beat_time / duration_seconds;
        beat_time += 60.0 / bpm;
    }
    times
}

#[test]
fn rust_measures_local_tempo_at_the_cues_of_a_drifting_track() {
    let samples = click_track(121.0, 121.6, 150.0, 0.0, 0.0);
    let truth = click_times_ms(121.0, 121.6, 150.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    for (bpm, reference) in [
        (profile.intro_bpm, profile.intro_beat_ms),
        (profile.outro_bpm, profile.outro_beat_ms),
    ] {
        let beat_ms = 60_000.0 / f64::from(bpm.unwrap());
        let reference = reference.unwrap() as f64;
        let last = *truth.last().unwrap();
        for beat in 0..24 {
            let predicted = reference + f64::from(beat) * beat_ms;
            if predicted > last {
                break;
            }
            let error = truth
                .iter()
                .map(|time| predicted - time)
                .min_by(|left, right| left.abs().total_cmp(&right.abs()))
                .unwrap();
            assert!(
                error.abs() <= 4.0,
                "beat {beat} after {reference} ms is {error} ms off"
            );
        }
    }
    assert!(profile.outro_bpm.unwrap() > profile.intro_bpm.unwrap() + 0.3);
}

#[test]
fn rust_local_tempo_ignores_a_misplaced_hit_near_the_cue() {
    let mut samples = click_track(122.0, 122.0, 150.0, 0.0, 0.0);
    let beat_ms = 60_000.0_f64 / 122.0;
    let beat = (147_000.0 / beat_ms).round();
    let start = (beat * beat_ms / 1_000.0 * SAMPLE_RATE as f64) as usize;
    let pulse: Vec<f32> = samples[start..start + 600].to_vec();
    samples[start..start + 600].fill(0.0);
    let shifted = start + (0.040 * SAMPLE_RATE as f64) as usize;
    for (offset, value) in pulse.iter().enumerate() {
        samples[shifted + offset] += value;
    }

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    let outro_bpm = f64::from(profile.outro_bpm.unwrap());
    assert!((outro_bpm - 122.0).abs() <= 0.02, "outro tempo {outro_bpm}");
    let reference = profile.outro_beat_ms.unwrap() as f64;
    let error = reference - (reference / beat_ms).round() * beat_ms;
    assert!(
        error.abs() <= 3.0,
        "outro beat {reference} is {error} ms off"
    );
}

fn accented_clicks(beat_times: &[f32], duration_seconds: f32) -> Vec<f32> {
    let mut samples = vec![0.0_f32; (duration_seconds * SAMPLE_RATE as f32) as usize];
    let pulse_samples = (0.025 * SAMPLE_RATE as f32) as usize;
    for (index, time) in beat_times.iter().enumerate() {
        let amplitude = if index % 4 == 0 { 0.9 } else { 0.35 };
        let start = (time * SAMPLE_RATE as f32) as usize;
        for offset in 0..pulse_samples {
            if let Some(sample) = samples.get_mut(start + offset) {
                *sample += amplitude * (-7.0 * offset as f32 / pulse_samples as f32).exp();
            }
        }
    }
    samples
}

fn sections(parts: &[(f32, f32)]) -> (Vec<f32>, f32) {
    let mut times = Vec::new();
    let mut time = 0.0_f32;
    for (bpm, seconds) in parts {
        let end = time + seconds;
        while time < end {
            times.push(time);
            time += 60.0 / bpm;
        }
    }
    (times, time)
}

#[test]
fn v5_judges_tempo_where_the_mix_happens() {
    let (times, duration) = sections(&[(120.0, 60.0), (140.0, 60.0)]);
    let profile = analyze_smart_mix_samples(&accented_clicks(&times, duration), SAMPLE_RATE);

    assert!(
        profile.tempo_stability.unwrap() < 0.8,
        "global {:?}",
        profile.tempo_stability
    );
    assert!(profile.intro_tempo_stability.unwrap() >= 0.8);
    assert!(profile.outro_tempo_stability.unwrap() >= 0.8);
    let ratio = f64::from(profile.outro_bpm.unwrap()) / f64::from(profile.intro_bpm.unwrap());
    assert!((ratio - 140.0 / 120.0).abs() < 0.01, "tempo ratio {ratio}");
    assert_eq!(profile.quality, "full");
}

#[test]
fn v5_covers_the_longest_mix_at_fast_tempos() {
    let (times, duration) = sections(&[(170.0, 78.0), (150.0, 2.5), (170.0, 9.5)]);
    let profile = analyze_smart_mix_samples(&accented_clicks(&times, duration), SAMPLE_RATE);

    assert!(
        profile.outro_tempo_stability.unwrap() < 0.8,
        "a tempo change 9-12 s before the end must be inside the outro window, got {:?}",
        profile.outro_tempo_stability
    );
}

#[test]
fn v5_keeps_an_irregular_outro_partial() {
    let mut seed = 0x2545_f491_u32;
    let mut jitter = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        (seed as f32 / u32::MAX as f32 * 2.0 - 1.0) * 0.060
    };
    let (mut times, duration) = sections(&[(120.0, 90.0)]);
    for time in times.iter_mut().filter(|time| **time > 66.0) {
        *time += jitter();
    }
    let profile = analyze_smart_mix_samples(&accented_clicks(&times, duration), SAMPLE_RATE);

    assert!(profile.intro_tempo_stability.unwrap() >= 0.8);
    assert!(
        profile.outro_tempo_stability.unwrap() < 0.8,
        "outro {:?}",
        profile.outro_tempo_stability
    );
    assert_eq!(profile.quality, "partial");
}

#[test]
fn v5_finds_each_cue_downbeat_across_a_dropped_beat() {
    let (mut times, duration) = sections(&[(120.0, 90.0)]);
    times.remove(81);
    let accents: Vec<f64> = times
        .iter()
        .enumerate()
        .filter(|(index, _)| index % 4 == 0)
        .map(|(_, time)| f64::from(*time) * 1_000.0)
        .collect();
    let profile = analyze_smart_mix_samples(&accented_clicks(&times, duration), SAMPLE_RATE);

    for downbeat in [profile.intro_downbeat_ms, profile.outro_downbeat_ms] {
        let downbeat = downbeat.expect("cue downbeat") as f64;
        let error = accents
            .iter()
            .map(|accent| (downbeat - accent).abs())
            .fold(f64::INFINITY, f64::min);
        assert!(
            error <= 30.0,
            "downbeat {downbeat} is {error} ms from an accent"
        );
    }
}

fn syncopated_band(bpm: f32, duration_seconds: f32) -> Vec<f32> {
    let mut samples = vec![0.0_f32; (duration_seconds * SAMPLE_RATE as f32) as usize];
    let mut seed = 0x2545_f491_u32;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32
    };
    let hit =
        |samples: &mut Vec<f32>, time: f32, amplitude: f32, noise: &mut dyn FnMut() -> f32| {
            let start = (time * SAMPLE_RATE as f32) as usize;
            let length = (0.06 * SAMPLE_RATE as f32) as usize;
            for offset in 0..length {
                if let Some(sample) = samples.get_mut(start + offset) {
                    *sample += amplitude
                        * (noise() * 2.0 - 1.0)
                        * (-5.0 * offset as f32 / length as f32).exp();
                }
            }
        };
    let beat = 60.0 / bpm;
    let mut index = 0;
    while index as f32 * beat < duration_seconds {
        let time = index as f32 * beat;
        if random() > 0.3 {
            hit(&mut samples, time, 0.8, &mut random);
        }
        if random() > 0.4 {
            let sixteenth = 1 + (random() * 3.0) as usize;
            hit(
                &mut samples,
                time + sixteenth as f32 * beat / 4.0,
                0.8,
                &mut random,
            );
        }
        index += 1;
    }
    for sample in samples.iter_mut() {
        *sample += 0.05 * (random() * 2.0 - 1.0);
    }
    samples
}

#[test]
fn rust_keeps_a_steady_grid_through_missing_and_off_beat_hits() {
    let samples = syncopated_band(140.0, 40.0);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);

    let bpm = profile.bpm.unwrap();
    assert!(
        (bpm - 140.0).abs() / 140.0 <= 0.04,
        "detected BPM was {bpm}"
    );
    assert!(
        profile.tempo_stability.unwrap() >= 0.8,
        "stability was {:?}",
        profile.tempo_stability
    );
}

fn rock_bars(bpm: f32, bars: usize, pickup_beats: usize) -> Vec<f32> {
    let beat = 60.0 / bpm;
    let beats = pickup_beats + bars * 4;
    let mut samples = vec![0.0_f32; (beats as f32 * beat * SAMPLE_RATE as f32) as usize];
    let mut seed = 0x9e37_79b9_u32;
    let mut noise = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32 * 2.0 - 1.0
    };
    let roots = [110.0_f32, 146.83, 123.47, 164.81];
    let bar_samples = (4.0 * beat * SAMPLE_RATE as f32) as usize;
    let pickup = (pickup_beats as f32 * beat * SAMPLE_RATE as f32) as usize;
    for (index, sample) in samples.iter_mut().enumerate() {
        let bar = index.saturating_sub(pickup) / bar_samples;
        let root = roots[(bar + usize::from(index < pickup) * 3) % roots.len()];
        let t = index as f32 / SAMPLE_RATE as f32;
        *sample = [1.0_f32, 1.26, 1.5]
            .iter()
            .map(|ratio| 0.08 * (2.0 * std::f32::consts::PI * root * ratio * t).sin())
            .sum();
    }
    for step in 0..beats * 2 {
        let start = (step as f32 * beat / 2.0 * SAMPLE_RATE as f32) as usize;
        let beat_in_bar = (step / 2 + 4 - pickup_beats % 4) % 4;
        let on_beat = step % 2 == 0;
        let hat = (0.03 * SAMPLE_RATE as f32) as usize;
        for offset in 0..hat {
            if let Some(sample) = samples.get_mut(start + offset) {
                *sample += 0.15 * noise() * (-6.0 * offset as f32 / hat as f32).exp();
            }
        }
        if on_beat && (beat_in_bar == 0 || beat_in_bar == 2) {
            let kick = (0.12 * SAMPLE_RATE as f32) as usize;
            for offset in 0..kick {
                let t = offset as f32 / SAMPLE_RATE as f32;
                if let Some(sample) = samples.get_mut(start + offset) {
                    *sample +=
                        0.8 * (2.0 * std::f32::consts::PI * 55.0 * t).sin() * (-30.0 * t).exp();
                }
            }
        }
        if on_beat && (beat_in_bar == 1 || beat_in_bar == 3) {
            let snare = (0.1 * SAMPLE_RATE as f32) as usize;
            for offset in 0..snare {
                if let Some(sample) = samples.get_mut(start + offset) {
                    *sample += 0.5 * noise() * (-6.0 * offset as f32 / snare as f32).exp();
                }
            }
        }
    }
    samples
}

#[test]
fn rust_places_the_downbeat_on_bar_starts_after_a_pickup() {
    let samples = rock_bars(120.0, 12, 1);

    let profile = analyze_smart_mix_samples(&samples, SAMPLE_RATE);
    let anchor = profile.downbeat_anchor_ms.expect("downbeat");
    let bar_ms = 2_000_i64;
    let offset = (anchor as i64 - 500).rem_euclid(bar_ms);
    assert!(
        offset <= 60 || offset >= bar_ms - 60,
        "downbeat {anchor} ms is {offset} ms away from a bar start"
    );
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
    assert_eq!(payload["analyzerVersion"], "smart-mix-audio-v5");
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
