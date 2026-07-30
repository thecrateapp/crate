//! Audio signal analysis: BPM, key/scale, loudness, energy, dynamic range, and spectral centroid.

use rayon::prelude::*;
use realfft::RealFftPlanner;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
#[cfg(feature = "ml")]
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::mix_profile::{to_camelot, SmartMixProfileResult};
use crate::{collect_audio_files, parse_extensions};

const TARGET_SAMPLE_RATE: u32 = 22050;
const FFT_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;

#[derive(Serialize)]
pub struct AnalysisResult {
    pub path: String,
    pub bpm: Option<f32>,
    pub key: Option<String>,
    pub scale: Option<String>,
    pub loudness: Option<f32>,
    pub energy: Option<f32>,
    pub dynamic_range: Option<f32>,
    pub spectral_centroid: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<HashMap<String, f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danceability: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valence: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acousticness: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrumentalness: Option<f32>,
    #[serde(rename = "mixProfile", skip_serializing_if = "Option::is_none")]
    pub mix_profile: Option<SmartMixProfileResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct BatchAnalysisResult {
    pub tracks: Vec<AnalysisResult>,
    pub total: usize,
    pub analyzed: usize,
    pub failed: usize,
}

fn decode_audio(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "no sample rate".to_string())?;
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        // Mix to mono
        if channels > 1 {
            for frame in 0..num_frames {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += samples[frame * channels + ch];
                }
                all_samples.push(sum / channels as f32);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    // Resample to target rate if needed (simple linear interpolation)
    if sample_rate != TARGET_SAMPLE_RATE && !all_samples.is_empty() {
        let ratio = TARGET_SAMPLE_RATE as f64 / sample_rate as f64;
        let new_len = (all_samples.len() as f64 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);
        for i in 0..new_len {
            let src_pos = i as f64 / ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            if idx + 1 < all_samples.len() {
                resampled.push(all_samples[idx] * (1.0 - frac) + all_samples[idx + 1] * frac);
            } else if idx < all_samples.len() {
                resampled.push(all_samples[idx]);
            }
        }
        return Ok((resampled, TARGET_SAMPLE_RATE));
    }

    Ok((all_samples, sample_rate))
}

/// Decode audio and return the original (pre-resample) mono samples + original sample rate.
/// Used when we need to resample to 32kHz for PANNs (not 22050).
#[cfg(feature = "ml")]
fn decode_audio_original(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "no sample rate".to_string())?;
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        if channels > 1 {
            for frame in 0..num_frames {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += samples[frame * channels + ch];
                }
                all_samples.push(sum / channels as f32);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    Ok((all_samples, sample_rate))
}

fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

fn compute_loudness_db(rms: f32) -> f32 {
    if rms > 0.0 {
        20.0 * rms.log10()
    } else {
        -80.0
    }
}

fn compute_energy(rms: f32) -> f32 {
    let db = compute_loudness_db(rms);
    ((db + 40.0) / 40.0).clamp(0.0, 1.0)
}

fn compute_dynamic_range(samples: &[f32]) -> f32 {
    let frame_size = 2048;
    let hop = 1024;
    let mut frame_rms: Vec<f32> = Vec::new();

    let mut pos = 0;
    while pos + frame_size <= samples.len() {
        let rms = compute_rms(&samples[pos..pos + frame_size]);
        let db = compute_loudness_db(rms);
        frame_rms.push(db);
        pos += hop;
    }

    if frame_rms.len() < 2 {
        return 0.0;
    }

    frame_rms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p5_idx = (frame_rms.len() as f32 * 0.05) as usize;
    let p95_idx = (frame_rms.len() as f32 * 0.95) as usize;
    let p95_idx = p95_idx.min(frame_rms.len() - 1);

    frame_rms[p95_idx] - frame_rms[p5_idx]
}

fn compute_magnitude_spectrum(
    samples: &[f32],
    fft_size: usize,
    planner: &mut RealFftPlanner<f32>,
) -> Vec<f32> {
    let fft = planner.plan_fft_forward(fft_size);
    let mut input = vec![0.0f32; fft_size];
    let len = samples.len().min(fft_size);
    input[..len].copy_from_slice(&samples[..len]);

    // Apply Hann window
    for (i, sample) in input.iter_mut().enumerate() {
        let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos());
        *sample *= w;
    }

    let mut spectrum = fft.make_output_vec();
    fft.process(&mut input, &mut spectrum).ok();

    spectrum.iter().map(|c| c.norm()).collect()
}

fn compute_spectral_centroid_value(magnitudes: &[f32], sample_rate: f32, fft_size: usize) -> f32 {
    let freq_resolution = sample_rate / fft_size as f32;
    let weighted_sum: f32 = magnitudes
        .iter()
        .enumerate()
        .map(|(i, &m)| i as f32 * freq_resolution * m)
        .sum();
    let total_magnitude: f32 = magnitudes.iter().sum();
    if total_magnitude > 0.0 {
        weighted_sum / total_magnitude
    } else {
        0.0
    }
}

fn estimate_bpm(samples: &[f32], sample_rate: u32) -> Option<f32> {
    let onsets = compute_onset_envelope(samples);
    estimate_bpm_from_onsets(&onsets, sample_rate)
}

fn compute_onset_envelope(samples: &[f32]) -> Vec<f32> {
    if samples.len() < FFT_SIZE * 4 {
        return Vec::new();
    }
    let mut planner = RealFftPlanner::<f32>::new();
    let mut onsets: Vec<f32> = Vec::new();
    let mut prev_spectrum: Vec<f32> = Vec::new();

    let mut pos = 0;
    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let spectrum = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);

        if !prev_spectrum.is_empty() {
            let flux: f32 = spectrum
                .iter()
                .zip(prev_spectrum.iter())
                .map(|(curr, prev)| (curr - prev).max(0.0))
                .sum();
            onsets.push(flux);
        }

        prev_spectrum = spectrum;
        pos += HOP_SIZE;
    }
    onsets
}

fn estimate_bpm_from_onsets(onsets: &[f32], sample_rate: u32) -> Option<f32> {
    if onsets.len() < 4 {
        return None;
    }

    let sr = sample_rate as f32;
    // Autocorrelation of onset envelope
    let min_lag = (60.0 / 200.0 * sr / HOP_SIZE as f32) as usize; // 200 BPM
    let max_lag = (sr / HOP_SIZE as f32) as usize; // 60 BPM
    let max_lag = max_lag.min(onsets.len() / 2);

    if min_lag >= max_lag {
        return None;
    }

    let mut best_lag = min_lag;
    let mut best_corr = 0.0f32;

    for lag in min_lag..max_lag {
        let corr: f32 = onsets
            .iter()
            .zip(onsets[lag..].iter())
            .map(|(a, b)| a * b)
            .sum();
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }

    if best_corr <= 0.0 {
        return None;
    }

    let bpm = 60.0 * sr / (best_lag as f32 * HOP_SIZE as f32);
    Some((bpm * 10.0).round() / 10.0)
}

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

fn detect_key(samples: &[f32], sample_rate: u32) -> (String, String, f32) {
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

fn percentile(values: &[f32], quantile: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut ordered = values.to_vec();
    ordered.sort_by(|left, right| left.total_cmp(right));
    let index = ((ordered.len() - 1) as f32 * quantile.clamp(0.0, 1.0)).round() as usize;
    ordered[index]
}

fn median(values: &[f32]) -> f32 {
    percentile(values, 0.5)
}

fn detect_beat_frames(onsets: &[f32], sample_rate: u32, rough_bpm: Option<f32>) -> Vec<usize> {
    if onsets.len() < 3 {
        return Vec::new();
    }
    let mean = onsets.iter().sum::<f32>() / onsets.len() as f32;
    let variance = onsets
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f32>()
        / onsets.len() as f32;
    let threshold = mean + variance.sqrt() * 0.35;
    let expected_frames = rough_bpm
        .filter(|bpm| *bpm > 0.0)
        .map(|bpm| 60.0 * sample_rate as f32 / (bpm * HOP_SIZE as f32))
        .unwrap_or(1.0);
    let minimum_distance = (expected_frames * 0.45).round().max(1.0) as usize;

    let mut peaks = Vec::new();
    for index in 1..onsets.len() - 1 {
        let current = onsets[index];
        if current < threshold || current < onsets[index - 1] || current <= onsets[index + 1] {
            continue;
        }
        if let Some(previous) = peaks.last_mut() {
            if index - *previous < minimum_distance {
                if current > onsets[*previous] {
                    *previous = index;
                }
                continue;
            }
        }
        peaks.push(index);
    }
    peaks
}

fn tempo_features(
    beat_frames: &[usize],
    onsets: &[f32],
    sample_rate: u32,
) -> (Option<f32>, f32, f32) {
    if beat_frames.len() < 4 {
        return (None, 0.0, 0.0);
    }
    let intervals: Vec<f32> = beat_frames
        .windows(2)
        .map(|pair| (pair[1] - pair[0]) as f32 * HOP_SIZE as f32 * 1_000.0 / sample_rate as f32)
        .collect();
    let median_interval = median(&intervals);
    if median_interval <= 0.0 {
        return (None, 0.0, 0.0);
    }
    let third = (intervals.len() / 3).max(2).min(intervals.len());
    let early_interval = median(&intervals[..third]);
    let late_interval = median(&intervals[intervals.len() - third..]);
    let drift_ratio = (late_interval - early_interval).abs() / median_interval;
    let residuals: Vec<f32> = intervals
        .iter()
        .map(|interval| (interval - median_interval).abs())
        .collect();
    let jitter_ratio = median(&residuals) / median_interval;
    let stability = (1.0 - drift_ratio / 0.25 - jitter_ratio / 0.20).clamp(0.0, 1.0);

    let beat_strength = beat_frames
        .iter()
        .filter_map(|index| onsets.get(*index))
        .sum::<f32>()
        / beat_frames.len() as f32;
    let reference = percentile(onsets, 0.95) + f32::EPSILON;
    let strength_ratio = (beat_strength / reference).clamp(0.0, 1.0);
    let coverage = (beat_frames.len() as f32 / 16.0).clamp(0.0, 1.0);
    let confidence = (0.5 * stability + 0.35 * strength_ratio + 0.15 * coverage).clamp(0.0, 1.0);
    let mean_interval = intervals.iter().sum::<f32>() / intervals.len() as f32;
    let bpm = 60_000.0 / mean_interval;
    (Some(bpm), confidence, stability)
}

fn downbeat_features(
    beat_frames: &[usize],
    beat_grid_ms: &[u64],
    onsets: &[f32],
    bpm_confidence: f32,
) -> (Option<u64>, Option<u8>) {
    if beat_frames.len() < 12 || bpm_confidence < 0.65 {
        return (None, None);
    }
    let mean = onsets.iter().sum::<f32>() / onsets.len() as f32;
    let variance = onsets
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f32>()
        / onsets.len() as f32;
    if variance.sqrt() / (mean + f32::EPSILON) < 1.0 {
        return (None, None);
    }
    let mut phase_scores = [0.0_f32; 4];
    let mut phase_counts = [0_usize; 4];
    for (index, frame) in beat_frames.iter().enumerate() {
        phase_scores[index % 4] += onsets.get(*frame).copied().unwrap_or_default();
        phase_counts[index % 4] += 1;
    }
    for phase in 0..4 {
        phase_scores[phase] /= phase_counts[phase].max(1) as f32;
    }
    let mut ordered = phase_scores;
    ordered.sort_by(f32::total_cmp);
    if ordered[3] <= 0.0 || ordered[3] < ordered[2] * 1.2 {
        return (None, None);
    }
    let phase = phase_scores
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map(|(index, _)| index)
        .unwrap_or_default();
    (beat_grid_ms.get(phase).copied(), Some(4))
}

fn frame_rms(samples: &[f32], sample_rate: u32) -> (Vec<f32>, usize, usize) {
    let frame_length = ((sample_rate as f32 * 0.05).round() as usize).max(256);
    let hop_length = (frame_length / 2).max(128);
    if samples.is_empty() {
        return (Vec::new(), frame_length, hop_length);
    }
    if samples.len() < frame_length {
        return (vec![compute_rms(samples)], frame_length, hop_length);
    }
    let values = (0..=samples.len() - frame_length)
        .step_by(hop_length)
        .map(|start| compute_rms(&samples[start..start + frame_length]))
        .collect();
    (values, frame_length, hop_length)
}

fn detect_mix_cues(
    samples: &[f32],
    sample_rate: u32,
    beat_grid_ms: &[u64],
) -> (Option<u64>, Option<u64>, Option<u64>) {
    let (rms_values, frame_length, hop_length) = frame_rms(samples, sample_rate);
    if rms_values.is_empty() {
        return (None, None, None);
    }
    let dbfs: Vec<f32> = rms_values
        .iter()
        .map(|rms| compute_loudness_db(*rms))
        .collect();
    let peak = dbfs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let threshold = (-55.0_f32).max(peak - 35.0);
    let active_frames: Vec<usize> = dbfs
        .iter()
        .enumerate()
        .filter_map(|(index, value)| (*value >= threshold).then_some(index))
        .collect();
    let (Some(first), Some(last)) = (active_frames.first(), active_frames.last()) else {
        return (None, None, None);
    };
    let duration_ms = samples.len() as u64 * 1_000 / u64::from(sample_rate);
    let active_start_ms = *first as u64 * hop_length as u64 * 1_000 / u64::from(sample_rate);
    let active_end_ms = duration_ms.min(
        (*last as u64 * hop_length as u64 + frame_length as u64) * 1_000 / u64::from(sample_rate),
    );
    let intro = beat_grid_ms
        .iter()
        .find(|position| **position >= active_start_ms)
        .copied()
        .unwrap_or(active_start_ms);
    let outro_target = intro.max(active_end_ms.saturating_sub(4_000));
    let outro = beat_grid_ms
        .iter()
        .rev()
        .find(|position| **position <= outro_target)
        .copied()
        .unwrap_or(outro_target);
    (Some(intro), Some(outro.max(intro)), Some(active_end_ms))
}

fn spectral_density(samples: &[f32], sample_rate: u32) -> Option<f32> {
    if samples.is_empty() {
        return None;
    }
    let mut planner = RealFftPlanner::<f32>::new();
    let mut total = 0.0;
    let mut count = 0;
    for frame in samples
        .chunks(FFT_SIZE)
        .filter(|frame| frame.len() >= FFT_SIZE)
    {
        let magnitudes = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);
        total += compute_spectral_centroid_value(&magnitudes, sample_rate as f32, FFT_SIZE);
        count += 1;
    }
    if count == 0 {
        return None;
    }
    let centroid = total / count as f32;
    Some(((1.0 + centroid).ln() / (1.0 + sample_rate as f32 / 2.0).ln()).clamp(0.0, 1.0))
}

fn signal_features(samples: &[f32], sample_rate: u32) -> (Option<f32>, Option<f32>, Option<f32>) {
    if samples.is_empty() {
        return (None, None, None);
    }
    let loudness = compute_loudness_db(compute_rms(samples));
    let energy = ((loudness + 60.0) / 60.0).clamp(0.0, 1.0);
    (
        Some(loudness),
        Some(energy),
        spectral_density(samples, sample_rate),
    )
}

fn window_samples(
    samples: &[f32],
    sample_rate: u32,
    anchor_ms: Option<u64>,
    backwards: bool,
) -> &[f32] {
    let Some(anchor_ms) = anchor_ms else {
        return &[];
    };
    let anchor = (anchor_ms * u64::from(sample_rate) / 1_000) as usize;
    let window = sample_rate as usize * 5;
    let (start, end) = if backwards {
        let end = anchor.min(samples.len());
        (end.saturating_sub(window), end)
    } else {
        let start = anchor.min(samples.len());
        (start, (start + window).min(samples.len()))
    };
    &samples[start..end]
}

pub fn analyze_smart_mix_samples(samples: &[f32], sample_rate: u32) -> SmartMixProfileResult {
    let duration_ms = if sample_rate == 0 {
        0
    } else {
        samples.len() as u64 * 1_000 / u64::from(sample_rate)
    };
    if sample_rate == 0 || samples.len() < sample_rate as usize * 2 {
        return SmartMixProfileResult::unavailable(duration_ms);
    }

    let onsets = compute_onset_envelope(samples);
    let rough_bpm = estimate_bpm_from_onsets(&onsets, sample_rate);
    let beat_frames = detect_beat_frames(&onsets, sample_rate, rough_bpm);
    let beat_grid_ms: Vec<u64> = beat_frames
        .iter()
        .map(|frame| (*frame + 1) as u64 * HOP_SIZE as u64 * 1_000 / u64::from(sample_rate))
        .collect();
    let (bpm, bpm_confidence, tempo_stability) = tempo_features(&beat_frames, &onsets, sample_rate);
    let (downbeat_anchor_ms, time_signature) =
        downbeat_features(&beat_frames, &beat_grid_ms, &onsets, bpm_confidence);
    let (key, scale, key_confidence) = detect_key(samples, sample_rate);
    let camelot = to_camelot(&key, &scale).map(str::to_owned);
    let (intro_cue_ms, outro_cue_ms, active_end_ms) =
        detect_mix_cues(samples, sample_rate, &beat_grid_ms);
    let intro = signal_features(
        window_samples(samples, sample_rate, intro_cue_ms, false),
        sample_rate,
    );
    let outro = signal_features(
        window_samples(samples, sample_rate, active_end_ms, true),
        sample_rate,
    );
    let global = signal_features(samples, sample_rate);
    let true_peak = samples.iter().copied().map(f32::abs).fold(0.0, f32::max);
    let quality = if beat_grid_ms.len() >= 12
        && bpm_confidence >= 0.75
        && tempo_stability >= 0.8
        && downbeat_anchor_ms.is_some()
    {
        "full"
    } else {
        "partial"
    };

    SmartMixProfileResult {
        schema_version: 1,
        analyzer: "crate-rust".to_string(),
        analyzer_version: "smart-mix-v1".to_string(),
        duration_ms,
        quality: quality.to_string(),
        bpm,
        bpm_confidence: Some(bpm_confidence),
        tempo_stability: Some(tempo_stability),
        beat_anchor_ms: beat_grid_ms.first().copied(),
        downbeat_anchor_ms,
        time_signature,
        beat_grid_ms,
        key: Some(key),
        scale: Some(scale),
        camelot,
        key_confidence: Some(key_confidence),
        intro_cue_ms,
        outro_cue_ms,
        intro_lufs: intro.0,
        outro_lufs: outro.0,
        true_peak_dbfs: Some(compute_loudness_db(true_peak)),
        intro_energy: intro.1,
        outro_energy: outro.1,
        intro_spectral_density: intro.2,
        outro_spectral_density: outro.2,
        global_energy: global.1,
    }
}

/// Analyze a single track. If `panns` is provided, also compute ML features.
#[cfg(feature = "ml")]
pub fn analyze_track_with_ml(path: &Path, panns: Option<&crate::ml::PannsModel>) -> AnalysisResult {
    let mut result = analyze_track(path);
    if result.error.is_some() {
        return result;
    }

    if let Some(model) = panns {
        match decode_audio_original(path) {
            Ok((orig_samples, orig_sr)) => {
                let waveform_32k = crate::ml::resample_linear(
                    &orig_samples,
                    orig_sr,
                    crate::ml::PANNS_SAMPLE_RATE,
                    crate::ml::PANNS_DURATION,
                );
                let ctx = crate::ml::SignalContext {
                    bpm: result.bpm,
                    scale: result.scale.clone(),
                    energy: result.energy,
                };
                match model.compute_features(&waveform_32k, &ctx) {
                    Ok(features) => {
                        result.mood = Some(features.mood);
                        result.danceability = Some(features.danceability);
                        result.valence = Some(features.valence);
                        result.acousticness = Some(features.acousticness);
                        result.instrumentalness = Some(features.instrumentalness);
                    }
                    Err(e) => {
                        eprintln!("ML inference failed for {}: {}", path.display(), e);
                    }
                }
            }
            Err(e) => {
                eprintln!("Decode for ML failed for {}: {}", path.display(), e);
            }
        }
    }

    result
}

pub fn analyze_track(path: &Path) -> AnalysisResult {
    let (samples, sample_rate) = match decode_audio(path) {
        Ok(r) => r,
        Err(e) => {
            return AnalysisResult {
                path: path.to_string_lossy().to_string(),
                bpm: None,
                key: None,
                scale: None,
                loudness: None,
                energy: None,
                dynamic_range: None,
                spectral_centroid: None,
                mood: None,
                danceability: None,
                valence: None,
                acousticness: None,
                instrumentalness: None,
                mix_profile: None,
                error: Some(e),
            }
        }
    };

    if samples.is_empty() {
        return AnalysisResult {
            path: path.to_string_lossy().to_string(),
            bpm: None,
            key: None,
            scale: None,
            loudness: None,
            energy: None,
            dynamic_range: None,
            spectral_centroid: None,
            mood: None,
            danceability: None,
            valence: None,
            acousticness: None,
            instrumentalness: None,
            mix_profile: None,
            error: Some("empty audio".to_string()),
        };
    }

    let rms = compute_rms(&samples);
    let loudness = compute_loudness_db(rms);
    let energy = compute_energy(rms);
    let dynamic_range = compute_dynamic_range(&samples);
    let bpm = estimate_bpm(&samples, sample_rate);
    let (key, scale, _) = detect_key(&samples, sample_rate);
    let mix_profile = Some(analyze_smart_mix_samples(&samples, sample_rate));

    // Average spectral centroid
    let mut planner = RealFftPlanner::<f32>::new();
    let mut centroid_sum = 0.0f32;
    let mut centroid_count = 0;
    let mut pos = 0;
    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let magnitudes = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);
        centroid_sum += compute_spectral_centroid_value(&magnitudes, sample_rate as f32, FFT_SIZE);
        centroid_count += 1;
        pos += HOP_SIZE;
    }
    let spectral_centroid = if centroid_count > 0 {
        Some((centroid_sum / centroid_count as f32 * 10.0).round() / 10.0)
    } else {
        None
    };

    AnalysisResult {
        path: path.to_string_lossy().to_string(),
        bpm,
        key: Some(key),
        scale: Some(scale),
        loudness: Some((loudness * 10.0).round() / 10.0),
        energy: Some((energy * 1000.0).round() / 1000.0),
        dynamic_range: Some((dynamic_range * 10.0).round() / 10.0),
        spectral_centroid,
        mood: None,
        danceability: None,
        valence: None,
        acousticness: None,
        instrumentalness: None,
        mix_profile,
        error: None,
    }
}

pub fn run_analyze(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
    model_path: Option<PathBuf>,
) {
    let exts = parse_extensions(&extensions);

    // Load PANNs model if path provided and feature enabled
    #[cfg(feature = "ml")]
    let panns: Option<Arc<crate::ml::PannsModel>> = model_path.as_ref().and_then(|p| {
        if !p.exists() {
            eprintln!("Model file not found: {}", p.display());
            return None;
        }
        match crate::ml::PannsModel::load(p) {
            Ok(m) => {
                eprintln!("PANNs CNN14 model loaded from {}", p.display());
                Some(Arc::new(m))
            }
            Err(e) => {
                eprintln!("Failed to load PANNs model: {}", e);
                None
            }
        }
    });

    #[cfg(not(feature = "ml"))]
    let _ = model_path;

    if let Some(file_path) = file {
        #[cfg(feature = "ml")]
        let result = analyze_track_with_ml(&file_path, panns.as_ref().map(|m| m.as_ref()));
        #[cfg(not(feature = "ml"))]
        let result = analyze_track(&file_path);

        println!("{}", serde_json::to_string(&result).unwrap_or_default());
        return;
    }

    if let Some(dir_path) = dir {
        let files = collect_audio_files(&dir_path, &exts);
        let total = files.len();
        eprintln!("Found {} files, analyzing...", total);

        #[cfg(feature = "ml")]
        let results: Vec<AnalysisResult> = if let Some(model) = panns.as_ref() {
            // Sequential when using ML model (ONNX session requires &mut)
            files
                .iter()
                .map(|f| analyze_track_with_ml(f, Some(model.as_ref())))
                .collect()
        } else {
            files.par_iter().map(|f| analyze_track(f)).collect()
        };

        #[cfg(not(feature = "ml"))]
        let results: Vec<AnalysisResult> = files.par_iter().map(|f| analyze_track(f)).collect();

        let analyzed = results.iter().filter(|r| r.error.is_none()).count();
        let batch = BatchAnalysisResult {
            tracks: results,
            total,
            analyzed,
            failed: total - analyzed,
        };
        println!("{}", serde_json::to_string(&batch).unwrap_or_default());
        return;
    }

    eprintln!("Usage: crate-cli analyze --file <path> or --dir <path>");
    std::process::exit(1);
}
