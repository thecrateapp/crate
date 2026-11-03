//! Musical key from a pitch-class profile matched against Krumhansl-Kessler key profiles.

use realfft::RealFftPlanner;

use crate::analyze::compute_magnitude_spectrum;

const FFT_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;

const KRUMHANSL_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KRUMHANSL_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn compute_chromagram(samples: &[f32], sample_rate: u32) -> [f32; 12] {
    let mut chroma = [0.0f32; 12];
    let sr = sample_rate as f32;
    let mut planner = RealFftPlanner::<f32>::new();

    let mut pos = 0;
    let mut frame_count = 0;

    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let magnitudes = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);

        // Map each frequency bin to a pitch class
        for (bin, &mag) in magnitudes.iter().enumerate() {
            let freq = bin as f32 * sr / FFT_SIZE as f32;
            if !(20.0..=5000.0).contains(&freq) {
                continue;
            }
            // Convert frequency to MIDI note, then to pitch class
            let midi = 69.0 + 12.0 * (freq / 440.0).log2();
            let pitch_class = ((midi.round() as i32 % 12) + 12) % 12;
            chroma[pitch_class as usize] += mag * mag; // Energy
        }

        pos += HOP_SIZE;
        frame_count += 1;
    }

    if frame_count > 0 {
        for c in &mut chroma {
            *c /= frame_count as f32;
        }
    }

    chroma
}

fn pearson_correlation(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let n = 12.0f32;
    let sum_a: f32 = a.iter().sum();
    let sum_b: f32 = b.iter().sum();
    let mean_a = sum_a / n;
    let mean_b = sum_b / n;

    let mut num = 0.0f32;
    let mut den_a = 0.0f32;
    let mut den_b = 0.0f32;

    for i in 0..12 {
        let da = a[i] - mean_a;
        let db = b[i] - mean_b;
        num += da * db;
        den_a += da * da;
        den_b += db * db;
    }

    let den = (den_a * den_b).sqrt();
    if den > 0.0 {
        num / den
    } else {
        0.0
    }
}

pub fn detect_key(samples: &[f32], sample_rate: u32) -> (String, String, f32) {
    let chroma = compute_chromagram(samples, sample_rate);

    let mut best_key = 0usize;
    let mut best_scale = "major";
    let mut best_corr = f32::MIN;
    let mut second_corr = f32::MIN;

    for shift in 0..12 {
        let mut rotated = [0.0f32; 12];
        for i in 0..12 {
            rotated[i] = chroma[(i + shift) % 12];
        }

        let major_corr = pearson_correlation(&rotated, &KRUMHANSL_MAJOR);
        let minor_corr = pearson_correlation(&rotated, &KRUMHANSL_MINOR);

        if major_corr > best_corr {
            second_corr = best_corr;
            best_corr = major_corr;
            best_key = shift;
            best_scale = "major";
        } else if major_corr > second_corr {
            second_corr = major_corr;
        }
        if minor_corr > best_corr {
            second_corr = best_corr;
            best_corr = minor_corr;
            best_key = shift;
            best_scale = "minor";
        } else if minor_corr > second_corr {
            second_corr = minor_corr;
        }
    }

    let confidence =
        (((best_corr + 1.0) * 0.35) + (best_corr - second_corr).max(0.0)).clamp(0.0, 1.0);
    (
        NOTE_NAMES[best_key].to_string(),
        best_scale.to_string(),
        confidence,
    )
}
