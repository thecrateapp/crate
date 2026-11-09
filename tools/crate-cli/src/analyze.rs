//! Audio signal analysis: BPM, key/scale, loudness, energy, dynamic range, and spectral centroid.

use rayon::prelude::*;
use realfft::RealFftPlanner;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
#[cfg(feature = "ml")]
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::beat_tracking::{self, ExternalBeats};
use crate::key_detection::detect_key;
use crate::loudness::{LoudnessMeter, LoudnessSummary, MEASUREMENT_VERSION};
use crate::mix_profile::{to_camelot, SmartMixProfileResult, ANALYZER_VERSION};
pub use crate::structure::rms_frame_geometry;
use crate::structure::{self, EnergyFrames, Structure, ACTIVE_RANGE_DB, MIN_ACTIVE_DBFS};
use crate::tempo_grid::{self, ConstantGrid};
use crate::{collect_audio_files, parse_extensions};

const TARGET_SAMPLE_RATE: u32 = 22050;
const FFT_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;
const MEASUREMENT_WINDOW_MS: u64 = 5_000;
const DOWNBEAT_MIN_CONFIDENCE: f32 = 0.65;
const FULL_SCAN_HEAD_SECONDS: u32 = 600;
const FULL_SCAN_TAIL_SECONDS: u32 = 120;
const LOCAL_TEMPO_BEATS: usize = 24;
const LOCAL_TEMPO_MIN_BEATS: usize = 8;
const LOCAL_TEMPO_OUTLIER_MS: f64 = 6.0;
const LOCAL_OUTLIER_SIGMAS: f64 = 3.0;
const LOCAL_DRIFT_LIMIT: f64 = 0.10;
const LOCAL_JITTER_LIMIT: f32 = 0.20;
const CUE_DOWNBEAT_BEATS: usize = 32;
const LOCAL_MIX_WINDOW_MS: f64 = 12_000.0;
const FULL_PROFILE_MIN_STABILITY: f32 = 0.8;
/// Share of the tracked beats that must sit on the published phase of a constant grid
/// for a full profile, which the bass must not contest; below it the grid may be half a
/// beat out. Without a constant grid,
/// a full profile needs tracked beats that never slide half a beat and whose phase the
/// bass does not contest.
const FULL_PROFILE_MIN_PHASE_SUPPORT: f64 = 0.7;
/// A cue takes the constant grid's tempo and beat only when its own tracked tempo is this
/// close: 1 % over the 24-beat cue window is a quarter beat of drift. A constant grid that a
/// cue does not keep, or that part of the track does not keep, cannot back a full profile.
const CUE_GRID_TEMPO_TOLERANCE: f64 = 0.01;

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

fn decode_audio(path: &Path) -> Result<DecodedAudio, String> {
    decode_audio_bounded(path, FULL_SCAN_HEAD_SECONDS, FULL_SCAN_TAIL_SECONDS)
}

pub fn decode_audio_bounded(
    path: &Path,
    head_seconds: u32,
    tail_seconds: u32,
) -> Result<DecodedAudio, String> {
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

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut capture = MonoCapture::new(
        head_seconds as usize * sample_rate as usize,
        tail_seconds as usize * sample_rate as usize,
    );
    // The meter takes the layout of the first decoded buffer (see `mix_to_mono`) and
    // stops measuring if a later buffer changes it.
    let mut layout: Option<(usize, u32)> = None;
    let mut meter: Option<LoudnessMeter> = None;

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
        let channels = spec.channels.count();
        let first = *layout.get_or_insert_with(|| {
            meter = LoudnessMeter::new(channels, spec.rate);
            (channels, spec.rate)
        });
        if (channels, spec.rate) != first {
            meter = None;
        }
        if let Some(active_meter) = meter.as_mut() {
            if active_meter.push_interleaved(samples).is_err() {
                meter = None;
            }
        }
        mix_to_mono(samples, channels, |sample| capture.push(sample));
    }

    let loudness = meter.map(LoudnessMeter::finish);

    let total_frames = capture.total_frames;
    let (head, tail) = capture.finish();
    let target_rate = if head.is_empty() {
        sample_rate
    } else {
        TARGET_SAMPLE_RATE
    };
    Ok(DecodedAudio {
        head: resample_linear(&head, sample_rate, target_rate),
        tail: tail.map(|(samples, start_frame)| {
            (
                resample_linear(&samples, sample_rate, target_rate),
                start_frame as u64 * 1_000 / u64::from(sample_rate),
            )
        }),
        sample_rate: target_rate,
        duration_ms: total_frames as u64 * 1_000 / u64::from(sample_rate),
        loudness,
    })
}

/// Average the interleaved frames of a decoded buffer into mono samples.
///
/// The channel count is the decoded buffer's own, never the codec parameters': the MP4
/// demuxer (symphonia 0.5) sets channels only for PCM sample entries, so an AAC track in
/// an `.m4a` has none, and reading its interleaved stereo frames as mono doubled its
/// length (twice the duration, half the tempo, an octave down).
fn mix_to_mono(samples: &[f32], channels: usize, mut push: impl FnMut(f32)) {
    if channels <= 1 {
        samples.iter().for_each(|sample| push(*sample));
        return;
    }
    for frame in samples.chunks_exact(channels) {
        push(frame.iter().sum::<f32>() / channels as f32);
    }
}

pub struct DecodedAudio {
    pub head: Vec<f32>,
    pub tail: Option<(Vec<f32>, u64)>,
    pub sample_rate: u32,
    pub duration_ms: u64,
    pub loudness: Option<LoudnessSummary>,
}

struct MonoCapture {
    head: Vec<f32>,
    tail: VecDeque<f32>,
    head_frames: usize,
    tail_frames: usize,
    dropped_frames: usize,
    total_frames: usize,
}

impl MonoCapture {
    fn new(head_frames: usize, tail_frames: usize) -> Self {
        Self {
            head: Vec::new(),
            tail: VecDeque::new(),
            head_frames,
            tail_frames,
            dropped_frames: 0,
            total_frames: 0,
        }
    }

    fn push(&mut self, sample: f32) {
        self.total_frames += 1;
        if self.head.len() < self.head_frames {
            self.head.push(sample);
            return;
        }
        self.tail.push_back(sample);
        if self.tail.len() > self.tail_frames {
            self.tail.pop_front();
            self.dropped_frames += 1;
        }
    }

    fn finish(mut self) -> (Vec<f32>, Option<(Vec<f32>, usize)>) {
        if self.dropped_frames == 0 {
            self.head.extend(self.tail);
            return (self.head, None);
        }
        let start_frame = self.head_frames + self.dropped_frames;
        (
            self.head,
            Some((self.tail.into_iter().collect(), start_frame)),
        )
    }
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = to_rate as f64 / from_rate as f64;
    let new_len = (samples.len() as f64 * ratio) as usize;
    let mut resampled = Vec::with_capacity(new_len);
    for i in 0..new_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        if idx + 1 < samples.len() {
            resampled.push(samples[idx] * (1.0 - frac) + samples[idx + 1] * frac);
        } else if idx < samples.len() {
            resampled.push(samples[idx]);
        }
    }
    resampled
}

/// Decode audio and return the original (pre-resample) mono samples + original sample rate.
/// Used when we need to resample to 32kHz for PANNs (not 22050).
#[cfg(feature = "ml")]
fn decode_audio_original(path: &Path, max_seconds: usize) -> Result<(Vec<f32>, u32), String> {
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

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();
    let max_samples = max_seconds * sample_rate as usize;

    while all_samples.len() < max_samples {
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
        mix_to_mono(sample_buf.samples(), spec.channels.count(), |sample| {
            all_samples.push(sample)
        });
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

pub(crate) fn compute_magnitude_spectrum(
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

/// Tempo from a least-squares fit of beat index against refined beat time.
///
/// Frame-quantised intervals bias the mean interval by up to a hop over the
/// whole track, which the planner then extrapolates from the downbeat anchor
/// to a cue minutes later. Fitting the refined grid keeps that drift sub-ms.
fn grid_bpm(beat_grid_ms: &[u64]) -> Option<f32> {
    let beats: Vec<(f64, f64)> = beat_grid_ms
        .iter()
        .enumerate()
        .map(|(index, time)| (index as f64, *time as f64))
        .collect();
    fit_beats(&beats).map(|fit| (60_000.0 / fit.period) as f32)
}

struct BeatFit {
    period: f64,
    mean_index: f64,
    mean_time: f64,
}

impl BeatFit {
    fn time_at(&self, index: f64) -> f64 {
        self.mean_time + (index - self.mean_index) * self.period
    }
}

fn fit_beats(beats: &[(f64, f64)]) -> Option<BeatFit> {
    if beats.len() < 4 {
        return None;
    }
    let count = beats.len() as f64;
    let mean_index = beats.iter().map(|(index, _)| index).sum::<f64>() / count;
    let mean_time = beats.iter().map(|(_, time)| time).sum::<f64>() / count;
    let (covariance, variance) = beats.iter().fold(
        (0.0_f64, 0.0_f64),
        |(covariance, variance), (index, time)| {
            let di = index - mean_index;
            (covariance + di * (time - mean_time), variance + di * di)
        },
    );
    let period = covariance / variance;
    (period > 0.0).then_some(BeatFit {
        period,
        mean_index,
        mean_time,
    })
}

#[derive(Debug, Clone, Copy)]
struct LocalBeat {
    bpm: f32,
    beat_ms: Option<u64>,
    stability: f32,
}

fn nearest_beat(beat_grid_ms: &[u64], cue_ms: u64) -> usize {
    beat_grid_ms
        .iter()
        .enumerate()
        .min_by_key(|(_, position)| position.abs_diff(cue_ms))
        .map_or(0, |(index, _)| index)
}

fn mix_window_beats(beat_grid_ms: &[u64]) -> usize {
    let mut intervals: Vec<u64> = beat_grid_ms
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect();
    intervals.sort_unstable();
    let interval = intervals.get(intervals.len() / 2).copied().unwrap_or(0) as f64;
    if interval <= 0.0 {
        return LOCAL_TEMPO_BEATS;
    }
    LOCAL_TEMPO_BEATS.max((LOCAL_MIX_WINDOW_MS / interval).ceil() as usize)
}

fn window_start(len: usize, nearest: usize, count: usize) -> usize {
    nearest.saturating_sub(count / 2).min(len - count)
}

/// Tempo, a fitted beat position and beat stability from the beats around a cue.
///
/// The planner phases the decks at the cues, so tempo and stability are measured
/// over the longest mix the planner allows (12 s, never fewer than 24 beats) instead
/// of across the whole track: a breakdown elsewhere must not hide a steady outro,
/// and a messy outro must not pass because the rest of the track is steady. The
/// window clamps at the track ends, so it runs forward from an intro cue and
/// backward from an outro cue.
///
/// Tempo, the beat reference and tempo drift come from regressions over the refined
/// beats, which average their per-beat attack noise: refined attacks on real
/// recordings scatter by tens of milliseconds even when the pulse is steady. A
/// drift of d across the window moves beats about d * beats * period / 8 off the
/// fitted line, so the limit is far tighter than for a whole track: 2% drift, about
/// 30 ms at 120 BPM over 24 beats, still reads as steady. Jitter comes from the
/// tracker beats of the same window, which stay regular on steady music, after
/// removing the half-frame alternation that frame quantization adds to any pulse.
fn local_beat(
    beat_grid_ms: &[u64],
    beat_frames: &[usize],
    sample_rate: u32,
    cue_ms: Option<u64>,
) -> Option<LocalBeat> {
    let cue_ms = cue_ms?;
    if beat_grid_ms.len() < 4 || beat_frames.len() != beat_grid_ms.len() {
        return None;
    }
    let nearest = nearest_beat(beat_grid_ms, cue_ms);
    let count = mix_window_beats(beat_grid_ms).min(beat_grid_ms.len());
    let start = window_start(beat_grid_ms.len(), nearest, count);
    let beats: Vec<(f64, f64)> = beat_grid_ms[start..start + count]
        .iter()
        .enumerate()
        .map(|(offset, time)| ((start + offset) as f64, *time as f64))
        .collect();
    let jitter = interval_jitter(&frame_intervals_ms(
        &beat_frames[start..start + count],
        sample_rate,
    ));
    let half_frame_ms = 0.5 * HOP_SIZE as f64 * 1_000.0 / f64::from(sample_rate);
    fit_local_beat(beats, nearest as f64, jitter, half_frame_ms)
}

/// `local_beat` for model beats (SM3-D14). On a constant grid the window is the mix window
/// of grid beats around the cue, and each model beat counts by its grid beat: a stretch
/// where the DBN holds half the tempo, or skips a beat, keeps the grid's tempo instead of
/// halving it. Without a constant grid it is the model beats around the cue. Jitter comes
/// from the model beats, forgiving their 20 ms frames, and not from the onset peaks near
/// them: attacks scatter around a steady pulse, and the model's beats are the pulse.
fn model_local_beat(
    beats_ms: &[u64],
    grid: Option<&ConstantGrid>,
    grid_ms: &[u64],
    cue_ms: Option<u64>,
) -> Option<LocalBeat> {
    let cue_ms = cue_ms?;
    let (window, nearest) = match grid {
        Some(grid) if !grid_ms.is_empty() => {
            let nearest = nearest_beat(grid_ms, cue_ms);
            let count = mix_window_beats(grid_ms).min(grid_ms.len());
            let start = window_start(grid_ms.len(), nearest, count);
            let from = grid_ms[start] as f64 - grid.period_ms / 2.0;
            let to = grid_ms[start + count - 1] as f64 + grid.period_ms / 2.0;
            let window: Vec<(f64, f64)> = tempo_grid::model_beat_points(beats_ms, Some(grid))
                .into_iter()
                .filter(|(_, time)| (from..=to).contains(time))
                .collect();
            (window, grid.beat_number(grid_ms[nearest] as f64))
        }
        _ => {
            if beats_ms.len() < 4 {
                return None;
            }
            let nearest = nearest_beat(beats_ms, cue_ms);
            let count = mix_window_beats(beats_ms).min(beats_ms.len());
            let start = window_start(beats_ms.len(), nearest, count);
            let window: Vec<(f64, f64)> =
                tempo_grid::model_beat_points(&beats_ms[start..start + count], None)
                    .into_iter()
                    .map(|(offset, time)| (start as f64 + offset, time))
                    .collect();
            (window, nearest as f64)
        }
    };
    let intervals: Vec<f32> = tempo_grid::step_intervals(&window)
        .into_iter()
        .map(|interval| interval as f32)
        .collect();
    fit_local_beat(
        window,
        nearest,
        interval_jitter(&intervals),
        tempo_grid::MODEL_BEAT_RESOLUTION_MS,
    )
}

/// The regression of `local_beat` over the beats of a cue window, given as (beat number,
/// time in ms) pairs, with the beat reference taken at beat number `nearest`. `jitter`
/// is the interval jitter of the window's beats, of which `resolution_ms` (half the time
/// step the beats are quantised to) is forgiven.
fn fit_local_beat(
    mut beats: Vec<(f64, f64)>,
    nearest: f64,
    jitter: Option<f32>,
    resolution_ms: f64,
) -> Option<LocalBeat> {
    let mut fit = fit_beats(&beats)?;
    while beats.len() > LOCAL_TEMPO_MIN_BEATS {
        let residuals: Vec<f64> = beats
            .iter()
            .map(|(index, time)| (time - fit.time_at(*index)).abs())
            .collect();
        let mut ordered = residuals.clone();
        ordered.sort_by(|left, right| left.total_cmp(right));
        let sigma = 1.4826 * ordered[ordered.len() / 2];
        let limit = LOCAL_TEMPO_OUTLIER_MS.max(LOCAL_OUTLIER_SIGMAS * sigma);
        let (worst, residual) = residuals
            .iter()
            .copied()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .unwrap_or((0, 0.0));
        if residual <= limit {
            break;
        }
        beats.remove(worst);
        fit = fit_beats(&beats)?;
    }
    let half = beats.len() / 2;
    let drift = match (fit_beats(&beats[..half]), fit_beats(&beats[half..])) {
        (Some(first), Some(second)) => (first.period - second.period).abs() / fit.period,
        _ => 1.0,
    };
    let resolution_ratio = resolution_ms / fit.period;
    let jitter = (jitter.unwrap_or(1.0) - resolution_ratio as f32).max(0.0);
    let stability =
        (1.0 - (drift / LOCAL_DRIFT_LIMIT) as f32 - jitter / LOCAL_JITTER_LIMIT).clamp(0.0, 1.0);
    let reference = fit.time_at(nearest);
    Some(LocalBeat {
        bpm: (60_000.0 / fit.period) as f32,
        beat_ms: (reference >= 0.0).then(|| reference.round() as u64),
        stability,
    })
}

/// The bar downbeat nearest a cue, phased only from the beats around that cue so a
/// dropped beat or a section change elsewhere in the track cannot shift it.
fn cue_downbeat_ms(
    features: &beat_tracking::FrameFeatures,
    beat_frames: &[usize],
    beat_grid_ms: &[u64],
    cue_ms: Option<u64>,
) -> Option<u64> {
    let cue_ms = cue_ms?;
    if beat_frames.len() != beat_grid_ms.len() || beat_grid_ms.is_empty() {
        return None;
    }
    let nearest = nearest_beat(beat_grid_ms, cue_ms);
    let count = CUE_DOWNBEAT_BEATS.min(beat_frames.len());
    let start = window_start(beat_frames.len(), nearest, count);
    let phase = beat_tracking::window_downbeat_phase(features, &beat_frames[start..start + count])?;
    bar_downbeat_near(beat_grid_ms, start + phase, nearest)
}

/// The bar downbeat nearest a cue from the model downbeats around it: the window of
/// `cue_downbeat_ms` and the phase rule of the anchor (SM3-D14).
fn model_cue_downbeat_ms(
    beat_grid_ms: &[u64],
    downbeats_ms: &[u64],
    cue_ms: Option<u64>,
) -> Option<u64> {
    let cue_ms = cue_ms?;
    if beat_grid_ms.is_empty() {
        return None;
    }
    let nearest = nearest_beat(beat_grid_ms, cue_ms);
    let count = CUE_DOWNBEAT_BEATS.min(beat_grid_ms.len());
    let start = window_start(beat_grid_ms.len(), nearest, count);
    let phase = beat_tracking::downbeat_phase_from_model(
        &beat_grid_ms[start..start + count],
        downbeats_ms,
    )?;
    bar_downbeat_near(beat_grid_ms, start + phase, nearest)
}

/// The downbeat nearest beat `nearest` of the bars that start on beat `first`.
fn bar_downbeat_near(beat_grid_ms: &[u64], first: usize, nearest: usize) -> Option<u64> {
    let bars = ((nearest as f64 - first as f64) / 4.0).round().max(0.0) as usize;
    let mut index = first + bars * 4;
    while index >= beat_grid_ms.len() && index >= 4 {
        index -= 4;
    }
    beat_grid_ms.get(index).copied()
}

/// On a constant grid the tempo and beat at a cue are the grid's, as long as the tracked
/// beats around the cue keep the grid's tempo; otherwise they stay the tracked ones.
/// Stability always comes from the tracked beats, so a messy outro stays messy.
fn on_constant_grid(
    local: LocalBeat,
    grid: Option<&ConstantGrid>,
    cue_ms: Option<u64>,
) -> LocalBeat {
    match (grid, cue_ms) {
        (Some(grid), Some(cue_ms)) if keeps_grid_tempo(&local, grid) => {
            let beat = grid.beat_near_ms(cue_ms as f64);
            LocalBeat {
                bpm: grid.bpm as f32,
                beat_ms: (beat >= 0.0).then(|| beat.round() as u64),
                stability: local.stability,
            }
        }
        _ => local,
    }
}

fn keeps_grid_tempo(local: &LocalBeat, grid: &ConstantGrid) -> bool {
    (f64::from(local.bpm) / grid.bpm - 1.0).abs() <= CUE_GRID_TEMPO_TOLERANCE
}

/// The published beats and their onset frames: the constant grid over the tracked span
/// when the track keeps one tempo, otherwise the tracked beats.
fn published_grid(
    grid: Option<&ConstantGrid>,
    tracked_ms: &[u64],
    tracked_frames: &[usize],
    sample_rate: u32,
) -> (Vec<u64>, Vec<usize>) {
    let (Some(grid), Some(first), Some(last)) = (grid, tracked_ms.first(), tracked_ms.last())
    else {
        return (tracked_ms.to_vec(), tracked_frames.to_vec());
    };
    let beats = grid.beats_ms(*first as f64, *last as f64);
    let frame_ms = HOP_SIZE as f64 * 1_000.0 / f64::from(sample_rate);
    let frames = beats
        .iter()
        .map(|beat| (*beat as f64 / frame_ms).round() as usize)
        .collect();
    (beats, frames)
}

struct TempoFeatures {
    frame_bpm: Option<f32>,
    stability: f32,
    strength_ratio: f32,
    coverage: f32,
}

impl TempoFeatures {
    const EMPTY: Self = Self {
        frame_bpm: None,
        stability: 0.0,
        strength_ratio: 0.0,
        coverage: 0.0,
    };

    fn confidence(&self, stability: f32) -> f32 {
        (0.5 * stability + 0.35 * self.strength_ratio + 0.15 * self.coverage).clamp(0.0, 1.0)
    }
}

fn frame_intervals_ms(beat_frames: &[usize], sample_rate: u32) -> Vec<f32> {
    beat_frames
        .windows(2)
        .map(|pair| (pair[1] - pair[0]) as f32 * HOP_SIZE as f32 * 1_000.0 / sample_rate as f32)
        .collect()
}

fn interval_jitter(intervals: &[f32]) -> Option<f32> {
    let median_interval = median(intervals);
    if intervals.is_empty() || median_interval <= 0.0 {
        return None;
    }
    let residuals: Vec<f32> = intervals
        .iter()
        .map(|interval| (interval - median_interval).abs())
        .collect();
    Some(median(&residuals) / median_interval)
}

/// Steadiness of a run of beat intervals: penalises tempo drift between its first and
/// last thirds and the median interval jitter.
fn interval_stability(intervals: &[f32]) -> Option<f32> {
    if intervals.len() < 3 {
        return None;
    }
    let median_interval = median(intervals);
    if median_interval <= 0.0 {
        return None;
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
    Some((1.0 - drift_ratio / 0.25 - jitter_ratio / 0.20).clamp(0.0, 1.0))
}

fn tempo_features(beat_frames: &[usize], onsets: &[f32], sample_rate: u32) -> TempoFeatures {
    if beat_frames.len() < 4 {
        return TempoFeatures::EMPTY;
    }
    let intervals = frame_intervals_ms(beat_frames, sample_rate);
    let Some(stability) = interval_stability(&intervals) else {
        return TempoFeatures::EMPTY;
    };

    let beat_strength = beat_frames
        .iter()
        .filter_map(|index| onsets.get(*index))
        .sum::<f32>()
        / beat_frames.len() as f32;
    let reference = percentile(onsets, 0.95) + f32::EPSILON;
    let strength_ratio = (beat_strength / reference).clamp(0.0, 1.0);
    let coverage = (beat_frames.len() as f32 / 16.0).clamp(0.0, 1.0);
    let mean_interval = intervals.iter().sum::<f32>() / intervals.len() as f32;
    TempoFeatures {
        frame_bpm: Some(60_000.0 / mean_interval),
        stability,
        strength_ratio,
        coverage,
    }
}

fn frame_rms(samples: &[f32], sample_rate: u32) -> (Vec<f32>, usize, usize) {
    let (frame_length, hop_length) = rms_frame_geometry(sample_rate);
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

/// Musical bounds and default cues: `(active_start, intro_cue, outro_cue, active_end)`.
///
/// The active bounds enclose the 50 ms RMS frames (25 ms hop) within 35 dB of the loudest
/// frame and above -55 dBFS. They mark where the music is, not where sound stops: a fade
/// or a reverb tail continues past the active end, which therefore falls 1-6 s before a
/// -60 dB end of sound such as Mixxx's. The intro cue is the first beat at or after the
/// start and the outro cue the last beat 4 s before the end. Same rule as the Python
/// `cue_detection.detect_mix_cues`.
fn detect_mix_cues(
    samples: &[f32],
    sample_rate: u32,
    beat_grid_ms: &[u64],
) -> (Option<u64>, Option<u64>, Option<u64>, Option<u64>) {
    let (rms_values, frame_length, hop_length) = frame_rms(samples, sample_rate);
    cues_from_rms(
        samples.len(),
        sample_rate,
        beat_grid_ms,
        &rms_values,
        frame_length,
        hop_length,
    )
}

/// `detect_mix_cues` over RMS frames the caller already computed with `frame_rms`.
fn cues_from_rms(
    sample_count: usize,
    sample_rate: u32,
    beat_grid_ms: &[u64],
    rms_values: &[f32],
    frame_length: usize,
    hop_length: usize,
) -> (Option<u64>, Option<u64>, Option<u64>, Option<u64>) {
    if rms_values.is_empty() {
        return (None, None, None, None);
    }
    let dbfs: Vec<f32> = rms_values
        .iter()
        .map(|rms| compute_loudness_db(*rms))
        .collect();
    let peak = dbfs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let threshold = (MIN_ACTIVE_DBFS as f32).max(peak - ACTIVE_RANGE_DB as f32);
    let active_frames: Vec<usize> = dbfs
        .iter()
        .enumerate()
        .filter_map(|(index, value)| (*value >= threshold).then_some(index))
        .collect();
    let (Some(first), Some(last)) = (active_frames.first(), active_frames.last()) else {
        return (None, None, None, None);
    };
    let duration_ms = sample_count as u64 * 1_000 / u64::from(sample_rate);
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
    (
        Some(active_start_ms),
        Some(intro),
        Some(outro.max(intro)),
        Some(active_end_ms),
    )
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
    analyze_smart_mix_samples_with_loudness(samples, sample_rate, None)
}

pub fn analyze_smart_mix_samples_with_loudness(
    samples: &[f32],
    sample_rate: u32,
    loudness: Option<&LoudnessSummary>,
) -> SmartMixProfileResult {
    analyze_smart_mix_segments(samples, None, sample_rate, None, loudness)
}

pub struct AudioTail<'a> {
    pub samples: &'a [f32],
    pub start_ms: u64,
}

pub fn analyze_smart_mix_segments(
    samples: &[f32],
    tail: Option<AudioTail<'_>>,
    sample_rate: u32,
    total_duration_ms: Option<u64>,
    loudness: Option<&LoudnessSummary>,
) -> SmartMixProfileResult {
    analyze_smart_mix_segments_with_beats(
        samples,
        tail,
        sample_rate,
        total_duration_ms,
        loudness,
        None,
    )
}

/// The mix profile; with `beats` (Beat This!, SM3-D14) the model's beats replace the
/// tracker and its downbeats pick the bar phase of the grid, as in the Python analyzer.
pub fn analyze_smart_mix_segments_with_beats(
    samples: &[f32],
    tail: Option<AudioTail<'_>>,
    sample_rate: u32,
    total_duration_ms: Option<u64>,
    loudness: Option<&LoudnessSummary>,
    beats: Option<&ExternalBeats>,
) -> SmartMixProfileResult {
    let duration_ms = total_duration_ms.unwrap_or(if sample_rate == 0 {
        0
    } else {
        samples.len() as u64 * 1_000 / u64::from(sample_rate)
    });
    if sample_rate == 0 || samples.len() < sample_rate as usize * 2 {
        return SmartMixProfileResult::unavailable(duration_ms);
    }

    let features = beat_tracking::frame_features(samples, sample_rate);
    let onsets = &features.onsets;
    let (beat_frames, tracked_ms) = match beats {
        Some(external) => {
            // The model's beats over the analysed audio (the head of a long track).
            let analysed_ms = samples.len() as u64 * 1_000 / u64::from(sample_rate);
            let tracked: Vec<u64> = external
                .beats_ms
                .iter()
                .copied()
                .filter(|beat| *beat > 0 && *beat <= analysed_ms)
                .collect();
            (
                beat_tracking::model_beat_frames(&tracked, onsets, sample_rate),
                tracked,
            )
        }
        None => {
            let frames = beat_tracking::track_beats(onsets, sample_rate);
            let refined = beat_tracking::refine_beat_times_ms(samples, sample_rate, &frames);
            (frames, refined)
        }
    };
    let tempo = tempo_features(&beat_frames, onsets, sample_rate);
    let tempo_fit = tempo_grid::fit_tempo(&tracked_ms, &features, sample_rate);
    let constant_grid = tempo_fit.as_ref().and_then(|fit| fit.grid.clone());
    // Model beats are measured on the track's constant grid and to the model's resolution,
    // as in the Python analyzer: a half-tempo intro or 20 ms frames are not an unsteady
    // tempo, and the onset peaks near the beats are not the beats.
    let tempo_stability = match beats {
        Some(_) => {
            tempo_grid::model_beat_stability(&tracked_ms, constant_grid.as_ref()).unwrap_or(0.0)
        }
        None => tempo.stability,
    };
    let (beat_grid_ms, grid_frames) = published_grid(
        constant_grid.as_ref(),
        &tracked_ms,
        &beat_frames,
        sample_rate,
    );
    let bpm = match (&constant_grid, &tempo_fit) {
        (Some(grid), _) => Some(grid.bpm as f32),
        (None, Some(fit)) => Some(((fit.bpm * 1_000.0).round() / 1_000.0) as f32),
        (None, None) => grid_bpm(&tracked_ms),
    }
    .or(tempo.frame_bpm);
    let (key, scale, key_confidence) = detect_key(samples, sample_rate);
    let camelot = to_camelot(&key, &scale).map(str::to_owned);
    let (rms, rms_frame_length, rms_hop) = frame_rms(samples, sample_rate);
    let (active_start_ms, intro_cue_ms, mut outro_cue_ms, mut active_end_ms) = cues_from_rms(
        samples.len(),
        sample_rate,
        &beat_grid_ms,
        &rms,
        rms_frame_length,
        rms_hop,
    );
    let intro = signal_features(
        window_samples(samples, sample_rate, intro_cue_ms, false),
        sample_rate,
    );
    let outro = match &tail {
        Some(tail) => {
            let (_, _, tail_outro_ms, tail_end_ms) =
                detect_mix_cues(tail.samples, sample_rate, &[]);
            outro_cue_ms = tail_outro_ms.map(|position| position + tail.start_ms);
            active_end_ms = tail_end_ms.map(|position| position + tail.start_ms);
            signal_features(
                window_samples(tail.samples, sample_rate, tail_end_ms, true),
                sample_rate,
            )
        }
        None => signal_features(
            window_samples(samples, sample_rate, active_end_ms, true),
            sample_rate,
        ),
    };
    let cue_beat = |cue_ms: Option<u64>| match beats {
        Some(_) => model_local_beat(&tracked_ms, constant_grid.as_ref(), &beat_grid_ms, cue_ms),
        None => local_beat(&tracked_ms, &beat_frames, sample_rate, cue_ms),
    };
    let intro_tracked = cue_beat(intro_cue_ms);
    let outro_tracked = if tail.is_none() {
        cue_beat(outro_cue_ms)
    } else {
        None
    };
    let grid_holds = constant_grid.as_ref().is_none_or(|grid| {
        !grid.tempo_deviates
            && [intro_tracked, outro_tracked]
                .iter()
                .flatten()
                .all(|local| keeps_grid_tempo(local, grid))
    });
    let intro_local =
        intro_tracked.map(|local| on_constant_grid(local, constant_grid.as_ref(), intro_cue_ms));
    let outro_local =
        outro_tracked.map(|local| on_constant_grid(local, constant_grid.as_ref(), outro_cue_ms));
    let cue_stability = intro_local
        .zip(outro_local)
        .map(|(intro, outro)| 0.5 * (intro.stability + outro.stability));
    let bpm_confidence = tempo.confidence(cue_stability.unwrap_or(tempo_stability));
    let other_meter = beats.and_then(ExternalBeats::other_meter);
    let (intro_downbeat_ms, outro_downbeat_ms, downbeat_anchor_ms) = match beats {
        // Phrases and the planner count bars of four beats: a track the DBN hears in
        // another meter (3/4) says so and gets no downbeat and no phrases (SM3-D16).
        Some(_) if other_meter.is_some() => (None, None, None),
        // The model's downbeats decide the bar alone: a track whose downbeats hold no
        // clear phase of the grid gets no downbeat, and no phrases.
        Some(external) => {
            let downbeats = &external.downbeats_ms;
            (
                model_cue_downbeat_ms(&beat_grid_ms, downbeats, intro_cue_ms),
                tail.is_none()
                    .then(|| model_cue_downbeat_ms(&beat_grid_ms, downbeats, outro_cue_ms))
                    .flatten(),
                beat_tracking::downbeat_phase_from_model(&beat_grid_ms, downbeats)
                    .and_then(|phase| beat_grid_ms.get(phase).copied()),
            )
        }
        None => {
            let downbeat_detectable = tempo.confidence(tempo_stability) >= DOWNBEAT_MIN_CONFIDENCE;
            let intro_downbeat_ms = downbeat_detectable
                .then(|| cue_downbeat_ms(&features, &grid_frames, &beat_grid_ms, intro_cue_ms))
                .flatten();
            let outro_downbeat_ms = (downbeat_detectable && tail.is_none())
                .then(|| cue_downbeat_ms(&features, &grid_frames, &beat_grid_ms, outro_cue_ms))
                .flatten();
            let downbeat_anchor_ms = downbeat_detectable
                .then(|| {
                    beat_tracking::downbeat_phase(&features, &grid_frames)
                        .and_then(|phase| beat_grid_ms.get(phase).copied())
                })
                .flatten()
                .or(intro_downbeat_ms);
            (intro_downbeat_ms, outro_downbeat_ms, downbeat_anchor_ms)
        }
    };
    let time_signature = other_meter.or(downbeat_anchor_ms.map(|_| 4));
    let global = signal_features(samples, sample_rate);
    let intro_lufs = loudness.zip(intro_cue_ms).and_then(|(summary, start_ms)| {
        summary.window_lufs(start_ms, start_ms + MEASUREMENT_WINDOW_MS)
    });
    let outro_lufs = loudness.zip(active_end_ms).and_then(|(summary, end_ms)| {
        summary.window_lufs(end_ms.saturating_sub(MEASUREMENT_WINDOW_MS), end_ms)
    });
    let steady_cues = intro_local.zip(outro_local).is_some_and(|(intro, outro)| {
        intro.beat_ms.is_some()
            && outro.beat_ms.is_some()
            && intro.stability >= FULL_PROFILE_MIN_STABILITY
            && outro.stability >= FULL_PROFILE_MIN_STABILITY
    });
    let clear_phase = match &constant_grid {
        Some(grid) => grid.phase_support >= FULL_PROFILE_MIN_PHASE_SUPPORT && !grid.phase_contested,
        None => {
            tempo_grid::half_beat_slides(&tracked_ms) == 0
                && !tempo_grid::bass_contests_tracked_beats(&tracked_ms, &features, sample_rate)
        }
    };
    // The planner takes outgoing phrases from the end of the track, which a head-and-tail
    // scan never segments: no structure beats a truncated one.
    let downbeats = structure::downbeats_from_anchor(&beat_grid_ms, downbeat_anchor_ms);
    let grid_trusted = clear_phase
        && constant_grid
            .as_ref()
            .is_none_or(|grid| !grid.tempo_deviates);
    let structure = if tail.is_some() || downbeats.is_empty() {
        Structure::none()
    } else {
        structure::guarded(|| {
            structure::segment_phrases(
                &beat_grid_ms,
                &downbeats,
                &EnergyFrames {
                    rms: &rms,
                    rms_frame_length,
                    rms_hop,
                    bands_db: &features.bands,
                    band_hop: beat_tracking::HOP_SIZE,
                    chroma: &features.chroma,
                    mfcc: &features.mfcc,
                },
                sample_rate,
                grid_trusted,
            )
        })
    };
    let quality = if tail.is_none()
        && beat_grid_ms.len() >= 12
        && bpm_confidence >= 0.75
        && steady_cues
        && clear_phase
        && grid_holds
    {
        "full"
    } else {
        "partial"
    };

    SmartMixProfileResult {
        schema_version: 1,
        analyzer: "crate-rust".to_string(),
        analyzer_version: ANALYZER_VERSION.to_string(),
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
        intro_bpm: intro_local.map(|local| local.bpm),
        intro_beat_ms: intro_local.and_then(|local| local.beat_ms),
        outro_bpm: outro_local.map(|local| local.bpm),
        outro_beat_ms: outro_local.and_then(|local| local.beat_ms),
        intro_tempo_stability: intro_local.map(|local| local.stability),
        outro_tempo_stability: outro_local.map(|local| local.stability),
        intro_downbeat_ms,
        outro_downbeat_ms,
        intro_lufs: intro_lufs.map(|value| value as f32),
        outro_lufs: outro_lufs.map(|value| value as f32),
        true_peak_dbfs: loudness
            .and_then(|summary| summary.true_peak_dbfs)
            .map(|value| value as f32),
        integrated_lufs: loudness
            .and_then(|summary| summary.integrated_lufs)
            .map(|value| value as f32),
        measurement_version: loudness.map(|_| MEASUREMENT_VERSION.to_string()),
        active_start_ms,
        active_end_ms,
        intro_energy: intro.1,
        outro_energy: outro.1,
        intro_spectral_density: intro.2,
        outro_spectral_density: outro.2,
        global_energy: global.1,
        phrases: Some(structure.phrases),
        energy_curve: structure.energy_curve,
        vocal_presence: None,
        structure_confidence: Some(structure.structure_confidence),
        beat_tracker: beats.and_then(|external| external.tracker.clone()),
    }
}

/// Analyze a single track. If `panns` is provided, also compute ML features.
#[cfg(feature = "ml")]
pub fn analyze_track_with_ml(
    path: &Path,
    panns: Option<&crate::ml::PannsModel>,
    beats: Option<&ExternalBeats>,
) -> AnalysisResult {
    let mut result = analyze_track_with_beats(path, beats);
    if result.error.is_some() {
        return result;
    }

    if let Some(model) = panns {
        match decode_audio_original(path, crate::ml::PANNS_DURATION) {
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
    analyze_track_with_beats(path, None)
}

/// `analyze_track` with model beats for the mix profile (`analyze --beats`).
pub fn analyze_track_with_beats(path: &Path, beats: Option<&ExternalBeats>) -> AnalysisResult {
    let decoded = match decode_audio(path) {
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

    let DecodedAudio {
        head: samples,
        tail,
        sample_rate,
        duration_ms,
        loudness: measured_loudness,
    } = decoded;

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
    let mix_profile = analyze_smart_mix_segments_with_beats(
        &samples,
        tail.as_ref().map(|(samples, start_ms)| AudioTail {
            samples,
            start_ms: *start_ms,
        }),
        sample_rate,
        Some(duration_ms),
        measured_loudness.as_ref(),
        beats,
    );
    let (key, scale) = (mix_profile.key.clone(), mix_profile.scale.clone());

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
        key,
        scale,
        loudness: Some((loudness * 10.0).round() / 10.0),
        energy: Some((energy * 1000.0).round() / 1000.0),
        dynamic_range: Some((dynamic_range * 10.0).round() / 10.0),
        spectral_centroid,
        mood: None,
        danceability: None,
        valence: None,
        acousticness: None,
        instrumentalness: None,
        mix_profile: Some(mix_profile),
        error: None,
    }
}

pub fn run_analyze(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
    model_path: Option<PathBuf>,
    beats_path: Option<PathBuf>,
) {
    let exts = parse_extensions(&extensions);
    // A beats file that cannot be read fails the run, so the worker falls back to the
    // Python analyzer with the same beats instead of silently tracking its own.
    let beats = match beats_path.as_deref().map(ExternalBeats::load) {
        Some(Ok(beats)) => Some(beats),
        Some(Err(error)) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
        None => None,
    };
    if beats.is_some() && file.is_none() {
        eprintln!("--beats describes one track: use it with --file");
        std::process::exit(1);
    }

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
        let result = analyze_track_with_ml(
            &file_path,
            panns.as_ref().map(|m| m.as_ref()),
            beats.as_ref(),
        );
        #[cfg(not(feature = "ml"))]
        let result = analyze_track_with_beats(&file_path, beats.as_ref());

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
                .map(|f| analyze_track_with_ml(f, Some(model.as_ref()), None))
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
