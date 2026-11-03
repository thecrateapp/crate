//! Musical key from a semitone pitch-class profile matched against the Krumhansl-Kessler
//! key profiles.
//!
//! Analyzer v5 summed the power of each 2048-point FFT bin (10.8 Hz wide at 22.05 kHz)
//! into the pitch class of the bin centre, from 20 Hz up. Below about 180 Hz a bin is
//! wider than a semitone, so the low bins fell on the pitch classes of the multiples of
//! 10.8 Hz: the harmonic series of a slightly flat F (F, C, F, A, C, D...). Kick and
//! bass carry most of the power down there, so whatever the key, most tracks came out as
//! F major, D minor or A minor (7B, 7A and 8A: 81 % of the library).
//!
//! The profile below maps a long FFT onto semitone bands from A1 upward. Each band is a
//! triangular kernel in log frequency that sums to one, so no pitch class collects more
//! bins than another. Bands are log-compressed and measured against the median of the
//! neighbouring bands, so broadband energy (kicks, noise, cymbals) cancels out and a
//! strong tonic does not mask the third next to it. The difference is kept signed: noise
//! then averages to zero in every band instead of favouring the narrowest (lowest) ones.

use realfft::RealFftPlanner;

const FFT_SIZE: usize = 8_192;
const HOP_SIZE: usize = 4_096;
/// A1 (55 Hz) to G#6 (1.66 kHz), five whole octaves.
const LOWEST_NOTE: usize = 33;
const NOTE_COUNT: usize = 60;
/// Half-width of each band, in semitones: neighbouring bands overlap by half.
const BAND_WIDTH_SEMITONES: f32 = 1.0;
/// Log compression, relative to the loudest band of the track.
const COMPRESSION: f32 = 100.0;
/// Whitening subtracts the median of this many bands on each side.
const WHITENING_RADIUS: usize = 6;

const KRUMHANSL_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KRUMHANSL_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn note_hz(note: usize) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

/// Sparse (bin, weight) kernels for the analysed notes plus the whitening margin on
/// both sides, so the outermost analysed bands are whitened like the inner ones.
fn band_kernels(sample_rate: u32) -> Vec<Vec<(usize, f32)>> {
    let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
    (LOWEST_NOTE - WHITENING_RADIUS..LOWEST_NOTE + NOTE_COUNT + WHITENING_RADIUS)
        .map(|note| {
            let centre = note_hz(note);
            let mut weights: Vec<(usize, f32)> = (1..=FFT_SIZE / 2)
                .filter_map(|bin| {
                    let distance = (12.0 * (bin as f32 * bin_hz / centre).log2()).abs();
                    let weight = 1.0 - distance / BAND_WIDTH_SEMITONES;
                    (weight > 0.0).then_some((bin, weight))
                })
                .collect();
            let total: f32 = weights.iter().map(|(_, weight)| weight).sum();
            if total > 0.0 {
                weights.iter_mut().for_each(|(_, weight)| *weight /= total);
            }
            weights
        })
        .collect()
}

/// Mean magnitude per semitone band, one row per frame.
fn band_spectrogram(samples: &[f32], sample_rate: u32) -> Vec<Vec<f32>> {
    if samples.is_empty() || sample_rate == 0 {
        return Vec::new();
    }
    let kernels = band_kernels(sample_rate);
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|index| {
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * index as f32 / FFT_SIZE as f32).cos()
        })
        .collect();
    let mut input = vec![0.0_f32; FFT_SIZE];
    let mut spectrum = fft.make_output_vec();
    let frames = 1 + samples.len().saturating_sub(FFT_SIZE) / HOP_SIZE;
    (0..frames)
        .map(|frame| {
            let start = frame * HOP_SIZE;
            for (offset, value) in input.iter_mut().enumerate() {
                *value = samples.get(start + offset).copied().unwrap_or(0.0) * window[offset];
            }
            fft.process(&mut input, &mut spectrum).ok();
            kernels
                .iter()
                .map(|weights| {
                    weights
                        .iter()
                        .map(|(bin, weight)| spectrum[*bin].norm() * weight)
                        .sum()
                })
                .collect()
        })
        .collect()
}

/// Harmonic weight of each pitch class (0 = C) over the whole signal. Only the shape
/// matters: values are relative and may be negative for classes below the noise floor.
pub fn pitch_class_profile(samples: &[f32], sample_rate: u32) -> [f32; 12] {
    let mut profile = [0.0_f32; 12];
    let bands = band_spectrogram(samples, sample_rate);
    let peak = bands.iter().flatten().copied().fold(0.0_f32, f32::max);
    if peak <= f32::EPSILON {
        return profile;
    }
    let mut compressed = vec![0.0_f32; NOTE_COUNT + 2 * WHITENING_RADIUS];
    let mut neighbours = [0.0_f32; 2 * WHITENING_RADIUS + 1];
    for frame in &bands {
        for (value, band) in compressed.iter_mut().zip(frame) {
            *value = (COMPRESSION * band / peak).ln_1p();
        }
        for index in 0..NOTE_COUNT {
            neighbours.copy_from_slice(&compressed[index..=index + 2 * WHITENING_RADIUS]);
            neighbours.sort_unstable_by(f32::total_cmp);
            let floor = neighbours[WHITENING_RADIUS];
            profile[(LOWEST_NOTE + index) % 12] += compressed[index + WHITENING_RADIUS] - floor;
        }
    }
    profile
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
    let chroma = pitch_class_profile(samples, sample_rate);

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
