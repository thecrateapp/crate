#![cfg(feature = "analysis")]

use crate_cli::key_detection::detect_key;
use crate_cli::mix_profile::to_camelot;

const SAMPLE_RATE: u32 = 22_050;
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn midi_hz(note: usize) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

fn add_note(samples: &mut [f32], note: usize, amplitude: f32, start: usize, length: usize) {
    for partial in 1..=4 {
        let hz = midi_hz(note) * partial as f32;
        let gain = amplitude / partial as f32;
        for offset in 0..length {
            let time = offset as f32 / SAMPLE_RATE as f32;
            if let Some(sample) = samples.get_mut(start + offset) {
                *sample += gain * (2.0 * std::f32::consts::PI * hz * time).sin();
            }
        }
    }
}

/// A cadence (I-IV-V-I, or i-iv-V-i in minor) held over its roots in the bass, with a
/// kick drum on every beat at 120 BPM. In a real mix the kick and bass carry most of
/// the energy below 200 Hz, which is where a linear-frequency chroma is least precise.
fn cadence_over_a_kick(tonic: usize, minor: bool) -> Vec<f32> {
    let chord_seconds = 3.0;
    let chord = (chord_seconds * SAMPLE_RATE as f32) as usize;
    let mut samples = vec![0.0_f32; chord * 4];
    let third = if minor { 3 } else { 4 };
    let progression = [(0, third), (5, third), (7, 4), (0, third)];
    for (index, (degree, chord_third)) in progression.iter().enumerate() {
        let root = tonic + degree;
        let start = index * chord;
        add_note(&mut samples, 36 + root % 12, 0.30, start, chord);
        for interval in [0, *chord_third, 7] {
            add_note(&mut samples, 60 + root % 12 + interval, 0.12, start, chord);
        }
    }
    let beat = SAMPLE_RATE as usize / 2;
    let kick = (0.15 * SAMPLE_RATE as f32) as usize;
    for start in (0..samples.len()).step_by(beat) {
        let mut phase = 0.0_f32;
        for offset in 0..kick {
            let progress = offset as f32 / kick as f32;
            phase += 2.0 * std::f32::consts::PI * (60.0 - 20.0 * progress) / SAMPLE_RATE as f32;
            if let Some(sample) = samples.get_mut(start + offset) {
                *sample += 0.9 * (-6.0 * progress).exp() * phase.sin();
            }
        }
    }
    samples
}

#[test]
fn every_key_survives_a_kick_drum_under_the_harmony() {
    let mut misses = Vec::new();
    for (tonic, name) in NOTE_NAMES.iter().enumerate() {
        for minor in [false, true] {
            let scale = if minor { "minor" } else { "major" };
            let expected = to_camelot(name, scale).unwrap();
            let (key, detected_scale, _) =
                detect_key(&cadence_over_a_kick(tonic, minor), SAMPLE_RATE);
            let detected = to_camelot(&key, &detected_scale).unwrap();
            if detected != expected {
                misses.push(format!("{name} {scale} -> {key} {detected_scale}"));
            }
        }
    }
    assert!(
        misses.is_empty(),
        "{} of 24 keys missed: {misses:?}",
        misses.len()
    );
}

fn pink_noise(seconds: usize) -> Vec<f32> {
    let mut seed = 0x1234_5678_u32;
    let mut white = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32 * 2.0 - 1.0
    };
    // Paul Kellet's economy pink filter.
    let (mut b0, mut b1, mut b2) = (0.0_f32, 0.0_f32, 0.0_f32);
    (0..SAMPLE_RATE as usize * seconds)
        .map(|_| {
            let input = white();
            b0 = 0.99765 * b0 + input * 0.0990460;
            b1 = 0.96300 * b1 + input * 0.2965164;
            b2 = 0.57000 * b2 + input * 1.0526913;
            b0 + b1 + b2 + input * 0.1848
        })
        .collect()
}

fn rms_normalized(samples: Vec<f32>) -> Vec<f32> {
    let rms =
        (samples.iter().map(|value| value * value).sum::<f32>() / samples.len() as f32).sqrt();
    samples.into_iter().map(|value| 0.2 * value / rms).collect()
}

fn spread(profile: &[f32; 12]) -> f32 {
    let strongest = profile.iter().copied().fold(f32::MIN, f32::max);
    let weakest = profile.iter().copied().fold(f32::MAX, f32::min);
    strongest - weakest
}

/// Pink noise has no pitch, so it must not shape the pitch-class profile the way harmony
/// at the same loudness does: v5 read it as F major with full confidence.
#[test]
fn pitchless_noise_does_not_shape_the_pitch_class_profile() {
    let noise = rms_normalized(pink_noise(12));
    let harmony = rms_normalized(cadence_over_a_kick(2, false));

    let noise_profile = crate_cli::key_detection::pitch_class_profile(&noise, SAMPLE_RATE);
    let harmony_profile = crate_cli::key_detection::pitch_class_profile(&harmony, SAMPLE_RATE);

    assert!(
        spread(&noise_profile) < 0.2 * spread(&harmony_profile),
        "noise {noise_profile:?} against harmony {harmony_profile:?}"
    );
}

#[test]
fn a_cadence_keeps_its_key_under_pink_noise() {
    for (tonic, minor, expected) in [(2, false, "10B"), (9, true, "8A"), (6, true, "11A")] {
        let mixed: Vec<f32> = rms_normalized(cadence_over_a_kick(tonic, minor))
            .iter()
            .zip(rms_normalized(pink_noise(12)))
            .map(|(music, noise)| music + 0.3 * noise)
            .collect();

        let (key, scale, _) = detect_key(&mixed, SAMPLE_RATE);

        assert_eq!(to_camelot(&key, &scale), Some(expected), "{key} {scale}");
    }
}
