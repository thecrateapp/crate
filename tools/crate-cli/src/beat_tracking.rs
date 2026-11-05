//! Onset strength, tempo estimation and dynamic-programming beat tracking.
//!
//! Ports the librosa pipeline used by the Python analyzer (`onset_strength`,
//! `feature.tempo` and `beat.beat_track`, after Ellis 2007) so both analyzers
//! place beats with the same method. Beats and downbeats from a model (Beat This!,
//! SM3-D14) replace the tracker and the downbeat heuristic when the worker passes them.

use std::path::Path;

use realfft::RealFftPlanner;
use serde::Deserialize;

use crate::structure::{BAND_COUNT, BEATS_PER_BAR, LOW_BAND_HZ, MID_BAND_HZ};

pub const FFT_SIZE: usize = 2048;
pub const HOP_SIZE: usize = 512;
const MEL_BANDS: usize = 128;
const TOP_DB: f32 = 80.0;
const AMIN: f32 = 1e-10;
const TEMPO_WINDOW_SECONDS: f32 = 8.0;
const START_BPM: f32 = 120.0;
const PRIOR_OCTAVES: f32 = 1.5;
const MAX_TEMPO: f32 = 320.0;
const TIGHTNESS: f32 = 100.0;
const CHROMA_MIN_HZ: f32 = 55.0;
const CHROMA_MAX_HZ: f32 = 5_000.0;
const DOWNBEAT_WINDOW_FRAMES: usize = 2;
const DOWNBEAT_MIN_BEATS: usize = 16;
const DOWNBEAT_MARGIN: f32 = 0.3;
const REFINE_LOOKBACK_MS: f64 = 46.0;
const REFINE_LOOKAHEAD_MS: f64 = 12.0;
const REFINE_WINDOW_MS: f64 = 2.0;
const REFINE_RISE_MS: usize = 3;
const REFINE_MIN_RISE: f64 = 0.5;
/// Beat This! downbeats (SM3-D14): a model downbeat votes for the bar phase of the grid
/// beat within this distance, and the winning phase must hold this share of the model
/// downbeats that fall within the grid. Same constants as the Python analyzer
/// (`crate.smart_mix.phrase_grid`).
pub const MODEL_DOWNBEAT_TOLERANCE_MS: u64 = 70;
pub const MODEL_DOWNBEAT_MIN_SHARE: f64 = 0.6;
/// Model beats sit on the attack while the onset envelope peaks a frame later: the onset
/// frame of a model beat is the envelope's peak within this distance, where the tracker's
/// beats sit, so beat strength and stability read the same envelope values.
const MODEL_BEAT_ONSET_WINDOW_MS: f64 = 35.0;

/// Beats and downbeats from a model, as the worker writes them for `analyze --beats`:
/// `{"tracker": "beat-this-small0-dbn", "beats_ms": [...], "downbeats_ms": [...],
/// "beats_per_bar": 4}`. `beats_per_bar` is the bar length the model's DBN chose (3 or
/// 4), absent or null when its bars are not all the same length.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExternalBeats {
    #[serde(default)]
    pub tracker: Option<String>,
    pub beats_ms: Vec<u64>,
    #[serde(default)]
    pub downbeats_ms: Vec<u64>,
    #[serde(default)]
    pub beats_per_bar: Option<u8>,
}

impl ExternalBeats {
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|error| format!("beats: {error}"))?;
        let beats: Self = serde_json::from_str(&text).map_err(|error| format!("beats: {error}"))?;
        Ok(beats.normalized())
    }

    /// Positive, strictly increasing positions, and a positive bar length or none.
    pub fn normalized(mut self) -> Self {
        for positions in [&mut self.beats_ms, &mut self.downbeats_ms] {
            positions.retain(|position| *position > 0);
            positions.sort_unstable();
            positions.dedup();
        }
        self.beats_per_bar = self.beats_per_bar.filter(|beats| *beats > 0);
        self
    }

    /// The model's bar length when it is not four beats (3/4 from the DBN). Phrases and
    /// their consumers count bars of four, so such a track gets that time signature and
    /// no downbeat and no phrases (SM3-D16), as in the Python analyzer.
    pub fn other_meter(&self) -> Option<u8> {
        self.beats_per_bar
            .filter(|beats| *beats > 0 && usize::from(*beats) != BEATS_PER_BAR)
    }
}

fn hz_to_mel(hz: f32) -> f32 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1_000.0;
    let min_log_mel = min_log_hz / f_sp;
    let log_step = 6.4_f32.ln() / 27.0;
    if hz >= min_log_hz {
        min_log_mel + (hz / min_log_hz).ln() / log_step
    } else {
        hz / f_sp
    }
}

fn mel_to_hz(mel: f32) -> f32 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1_000.0;
    let min_log_mel = min_log_hz / f_sp;
    let log_step = 6.4_f32.ln() / 27.0;
    if mel >= min_log_mel {
        min_log_hz * (log_step * (mel - min_log_mel)).exp()
    } else {
        mel * f_sp
    }
}

fn mel_filterbank(sample_rate: u32) -> Vec<Vec<(usize, f32)>> {
    let bins = FFT_SIZE / 2 + 1;
    let max_mel = hz_to_mel(sample_rate as f32 / 2.0);
    let edges: Vec<f32> = (0..MEL_BANDS + 2)
        .map(|index| mel_to_hz(max_mel * index as f32 / (MEL_BANDS + 1) as f32))
        .collect();
    let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
    (0..MEL_BANDS)
        .map(|band| {
            let (low, center, high) = (edges[band], edges[band + 1], edges[band + 2]);
            let norm = 2.0 / (high - low);
            (0..bins)
                .filter_map(|bin| {
                    let hz = bin as f32 * bin_hz;
                    let rising = (hz - low) / (center - low);
                    let falling = (high - hz) / (high - center);
                    let weight = rising.min(falling).max(0.0) * norm;
                    (weight > 0.0).then_some((bin, weight))
                })
                .collect()
        })
        .collect()
}

/// Per-hop signals shared by beat and downbeat tracking, aligned on the onset envelope.
/// `bands` are not shifted: band frame `i` is the STFT frame centred on `i * HOP_SIZE`,
/// holding the mean mel level (dB) below 200 Hz, below 2 kHz and above.
pub struct FrameFeatures {
    pub onsets: Vec<f32>,
    pub low_onsets: Vec<f32>,
    pub chroma: Vec<[f32; 12]>,
    pub bands: Vec<[f32; BAND_COUNT]>,
}

fn band_count_below(sample_rate: u32, hz: f32) -> usize {
    let max_mel = hz_to_mel(sample_rate as f32 / 2.0);
    (0..MEL_BANDS)
        .take_while(|band| mel_to_hz(max_mel * (*band + 1) as f32 / (MEL_BANDS + 1) as f32) < hz)
        .count()
}

fn low_band_count(sample_rate: u32) -> usize {
    band_count_below(sample_rate, LOW_BAND_HZ).max(1)
}

fn band_levels(mel_db: &[f32], low_bands: usize, mid_bands: usize) -> [f32; BAND_COUNT] {
    let mean = |values: &[f32]| {
        values.iter().map(|value| f64::from(*value)).sum::<f64>() / values.len() as f64
    };
    [
        mean(&mel_db[..low_bands]) as f32,
        mean(&mel_db[low_bands..mid_bands]) as f32,
        mean(&mel_db[mid_bands..]) as f32,
    ]
}

fn pitch_classes(sample_rate: u32) -> Vec<Option<usize>> {
    let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
    (0..=FFT_SIZE / 2)
        .map(|bin| {
            let hz = bin as f32 * bin_hz;
            (CHROMA_MIN_HZ..=CHROMA_MAX_HZ).contains(&hz).then(|| {
                let midi = (12.0 * (hz / 440.0).log2() + 69.0).round() as i32;
                midi.rem_euclid(12) as usize
            })
        })
        .collect()
}

fn mean_rise(current: &[f32], previous: &[f32]) -> f32 {
    current
        .iter()
        .zip(previous)
        .map(|(now, before)| (now - before).max(0.0))
        .sum::<f32>()
        / current.len() as f32
}

pub fn frame_features(samples: &[f32], sample_rate: u32) -> FrameFeatures {
    if samples.len() < FFT_SIZE || sample_rate == 0 {
        return FrameFeatures {
            onsets: Vec::new(),
            low_onsets: Vec::new(),
            chroma: Vec::new(),
            bands: Vec::new(),
        };
    }
    let filters = mel_filterbank(sample_rate);
    let classes = pitch_classes(sample_rate);
    let low_bands = low_band_count(sample_rate);
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|index| {
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * index as f32 / FFT_SIZE as f32).cos()
        })
        .collect();
    let pad = FFT_SIZE / 2;
    let frames = 1 + samples.len() / HOP_SIZE;
    let mut input = vec![0.0_f32; FFT_SIZE];
    let mut spectrum = fft.make_output_vec();
    let mut mel_db = vec![0.0_f32; frames * MEL_BANDS];
    let mut frame_chroma = vec![[0.0_f32; 12]; frames];
    let mut peak_db = f32::MIN;

    for frame in 0..frames {
        let start = (frame * HOP_SIZE) as isize - pad as isize;
        for (offset, value) in input.iter_mut().enumerate() {
            let position = start + offset as isize;
            *value = if position >= 0 && (position as usize) < samples.len() {
                samples[position as usize] * window[offset]
            } else {
                0.0
            };
        }
        fft.process(&mut input, &mut spectrum).ok();
        for (band, weights) in filters.iter().enumerate() {
            let power: f32 = weights
                .iter()
                .map(|(bin, weight)| spectrum[*bin].norm_sqr() * weight)
                .sum();
            let db = 10.0 * power.max(AMIN).log10();
            peak_db = peak_db.max(db);
            mel_db[frame * MEL_BANDS + band] = db;
        }
        let chroma = &mut frame_chroma[frame];
        for (bin, class) in classes.iter().enumerate() {
            if let Some(class) = class {
                chroma[*class] += spectrum[bin].norm_sqr();
            }
        }
        let peak = chroma.iter().copied().fold(0.0_f32, f32::max);
        if peak > 0.0 {
            chroma.iter_mut().for_each(|value| *value /= peak);
        }
    }
    let floor = peak_db - TOP_DB;
    for value in mel_db.iter_mut() {
        *value = value.max(floor);
    }
    let mid_bands = band_count_below(sample_rate, MID_BAND_HZ).max(low_bands + 1);
    let bands = mel_db
        .chunks_exact(MEL_BANDS)
        .map(|frame| band_levels(frame, low_bands, mid_bands))
        .collect();

    let lead = 1 + FFT_SIZE / (2 * HOP_SIZE);
    let mut onsets = vec![0.0_f32; frames];
    let mut low_onsets = vec![0.0_f32; frames];
    let mut chroma = vec![[0.0_f32; 12]; frames];
    for frame in 1..frames {
        let target = frame + lead - 1;
        if target >= frames {
            break;
        }
        let current = &mel_db[frame * MEL_BANDS..(frame + 1) * MEL_BANDS];
        let previous = &mel_db[(frame - 1) * MEL_BANDS..frame * MEL_BANDS];
        onsets[target] = mean_rise(current, previous);
        low_onsets[target] = mean_rise(&current[..low_bands], &previous[..low_bands]);
        chroma[target] = frame_chroma[frame];
    }
    FrameFeatures {
        onsets,
        low_onsets,
        chroma,
        bands,
    }
}

/// Mean positive first difference of a log-power mel spectrogram, one value per hop.
pub fn onset_strength(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    frame_features(samples, sample_rate).onsets
}

fn window_peak(values: &[f32], frame: usize) -> f32 {
    let start = frame.saturating_sub(DOWNBEAT_WINDOW_FRAMES);
    let end = (frame + DOWNBEAT_WINDOW_FRAMES + 1).min(values.len());
    values[start.min(end)..end]
        .iter()
        .copied()
        .fold(0.0_f32, f32::max)
}

fn mean_chroma(chroma: &[[f32; 12]], start: usize, end: usize) -> [f32; 12] {
    let mut total = [0.0_f32; 12];
    let end = end.min(chroma.len());
    if start >= end {
        return total;
    }
    for frame in &chroma[start..end] {
        for (sum, value) in total.iter_mut().zip(frame) {
            *sum += value;
        }
    }
    total
}

fn chroma_distance(left: &[f32; 12], right: &[f32; 12]) -> f32 {
    let dot: f32 = left.iter().zip(right).map(|(a, b)| a * b).sum();
    let norm = left.iter().map(|a| a * a).sum::<f32>().sqrt()
        * right.iter().map(|b| b * b).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        0.0
    } else {
        1.0 - dot / norm
    }
}

fn standardized(values: Vec<f32>) -> Vec<f32> {
    let count = values.len() as f32;
    let mean = values.iter().sum::<f32>() / count;
    let deviation = (values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f32>()
        / count)
        .sqrt();
    if deviation <= f32::EPSILON {
        return vec![0.0; values.len()];
    }
    values
        .iter()
        .map(|value| (value - mean) / deviation)
        .collect()
}

fn best_phase(scores: &[f32], indices: std::ops::Range<usize>) -> Option<(usize, f32)> {
    let mut totals = [0.0_f32; 4];
    let mut counts = [0_usize; 4];
    for index in indices {
        totals[index % 4] += scores[index];
        counts[index % 4] += 1;
    }
    if counts.contains(&0) {
        return None;
    }
    let means: Vec<f32> = totals
        .iter()
        .zip(counts)
        .map(|(total, count)| total / count as f32)
        .collect();
    let mut ordered = means.clone();
    ordered.sort_by(|left, right| right.total_cmp(left));
    let phase = means.iter().position(|mean| *mean == ordered[0])?;
    Some((phase, ordered[0] - ordered[1]))
}

fn downbeat_scores(features: &FrameFeatures, beats: &[usize]) -> Option<Vec<f32>> {
    if beats.len() < DOWNBEAT_MIN_BEATS {
        return None;
    }
    let low = standardized(
        beats
            .iter()
            .map(|frame| window_peak(&features.low_onsets, *frame))
            .collect(),
    );
    let broad = standardized(
        beats
            .iter()
            .map(|frame| window_peak(&features.onsets, *frame))
            .collect(),
    );
    let harmonic = standardized(
        (0..beats.len())
            .map(|index| {
                if index == 0 || index + 1 == beats.len() {
                    return 0.0;
                }
                let before = mean_chroma(&features.chroma, beats[index - 1], beats[index]);
                let after = mean_chroma(&features.chroma, beats[index], beats[index + 1]);
                chroma_distance(&before, &after)
            })
            .collect(),
    );
    Some(
        (0..beats.len())
            .map(|index| low[index] + harmonic[index] + 0.5 * broad[index])
            .collect(),
    )
}

/// Index of the first downbeat in `beats` (4/4 assumed) when bass onsets and harmonic
/// changes consistently favor one bar phase across both halves of the track.
pub fn downbeat_phase(features: &FrameFeatures, beats: &[usize]) -> Option<usize> {
    let scores = downbeat_scores(features, beats)?;
    let (phase, margin) = best_phase(&scores, 0..beats.len())?;
    if margin < DOWNBEAT_MARGIN {
        return None;
    }
    let middle = beats.len() / 2;
    let (first, _) = best_phase(&scores, 0..middle)?;
    let (second, _) = best_phase(&scores, middle..beats.len())?;
    (first == phase && second == phase).then_some(phase)
}

/// Bar phase of a short window of beats. The window is local by construction, so a
/// clear margin is enough; requiring both halves to agree would leave each half with
/// only a few bars per phase.
pub fn window_downbeat_phase(features: &FrameFeatures, beats: &[usize]) -> Option<usize> {
    let scores = downbeat_scores(features, beats)?;
    let (phase, margin) = best_phase(&scores, 0..beats.len())?;
    (margin >= DOWNBEAT_MARGIN).then_some(phase)
}

fn nearest_beat_index(beat_grid_ms: &[u64], position: u64) -> usize {
    let after = beat_grid_ms.partition_point(|beat| *beat < position);
    if after == 0 {
        return 0;
    }
    if after == beat_grid_ms.len() {
        return after - 1;
    }
    let before = after - 1;
    if position - beat_grid_ms[before] <= beat_grid_ms[after] - position {
        before
    } else {
        after
    }
}

/// Index of the first downbeat in `beat_grid_ms`: the bar phase (index mod 4) that
/// collects the most model downbeats, each voting for its nearest grid beat within
/// `MODEL_DOWNBEAT_TOLERANCE_MS`, if it holds `MODEL_DOWNBEAT_MIN_SHARE` of the model
/// downbeats between the first and the last beat (within the tolerance).
pub fn downbeat_phase_from_model(beat_grid_ms: &[u64], downbeats_ms: &[u64]) -> Option<usize> {
    let (first, last) = (*beat_grid_ms.first()?, *beat_grid_ms.last()?);
    let mut votes = [0_usize; BEATS_PER_BAR];
    let mut counted = 0_usize;
    for &downbeat in downbeats_ms {
        if downbeat + MODEL_DOWNBEAT_TOLERANCE_MS < first
            || downbeat > last + MODEL_DOWNBEAT_TOLERANCE_MS
        {
            continue;
        }
        counted += 1;
        let index = nearest_beat_index(beat_grid_ms, downbeat);
        if beat_grid_ms[index].abs_diff(downbeat) <= MODEL_DOWNBEAT_TOLERANCE_MS {
            votes[index % BEATS_PER_BAR] += 1;
        }
    }
    if counted == 0 {
        return None;
    }
    // On a tie the earlier phase wins; a tie never reaches a share above one half.
    let phase = (0..BEATS_PER_BAR)
        .max_by(|left, right| votes[*left].cmp(&votes[*right]).then(right.cmp(left)))?;
    (votes[phase] as f64 >= MODEL_DOWNBEAT_MIN_SHARE * counted as f64).then_some(phase)
}

/// Onset frame of each model beat: the onset envelope's peak within
/// `MODEL_BEAT_ONSET_WINDOW_MS`, never before the previous beat's frame.
pub fn model_beat_frames(beats_ms: &[u64], onsets: &[f32], sample_rate: u32) -> Vec<usize> {
    if sample_rate == 0 {
        return Vec::new();
    }
    let frame_ms = HOP_SIZE as f64 * 1_000.0 / f64::from(sample_rate);
    let window = ((MODEL_BEAT_ONSET_WINDOW_MS / frame_ms).round() as usize).max(1);
    let mut previous = 0_usize;
    beats_ms
        .iter()
        .map(|beat| {
            let centre = (*beat as f64 / frame_ms).round() as usize;
            let start = centre.saturating_sub(window).max(previous);
            let end = (centre + window + 1).min(onsets.len());
            let frame = if start < end {
                (start..end).fold(start, |best, frame| {
                    if onsets[frame] > onsets[best] {
                        frame
                    } else {
                        best
                    }
                })
            } else {
                centre.max(previous)
            };
            previous = frame;
            frame
        })
        .collect()
}

fn frames_per_second(sample_rate: u32) -> f32 {
    sample_rate as f32 / HOP_SIZE as f32
}

/// Global tempo from a mean local-autocorrelation tempogram weighted by a log-normal prior.
pub fn estimate_tempo(onsets: &[f32], sample_rate: u32) -> Option<f32> {
    let frame_rate = frames_per_second(sample_rate);
    let window_length = (TEMPO_WINDOW_SECONDS * frame_rate) as usize;
    if onsets.len() < 4 || window_length < 4 || onsets.iter().all(|value| *value <= 0.0) {
        return None;
    }
    let fft_size = (2 * window_length).next_power_of_two();
    let mut planner = RealFftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(fft_size);
    let inverse = planner.plan_fft_inverse(fft_size);
    let window: Vec<f32> = (0..window_length)
        .map(|index| {
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * index as f32 / window_length as f32).cos()
        })
        .collect();
    let half = window_length / 2;
    let mut tempogram = vec![0.0_f64; window_length];
    let mut input = vec![0.0_f32; fft_size];
    let mut spectrum = forward.make_output_vec();
    let mut correlation = vec![0.0_f32; fft_size];
    let mut windows = 0_usize;

    for center in (0..onsets.len()).step_by(4) {
        input.iter_mut().for_each(|value| *value = 0.0);
        for (offset, weight) in window.iter().enumerate() {
            let position = center as isize + offset as isize - half as isize;
            let value = if position < 0 {
                onsets[0]
            } else if position as usize >= onsets.len() {
                onsets[onsets.len() - 1]
            } else {
                onsets[position as usize]
            };
            input[offset] = value * weight;
        }
        forward.process(&mut input, &mut spectrum).ok();
        for bin in spectrum.iter_mut() {
            *bin = realfft::num_complex::Complex::new(bin.norm_sqr(), 0.0);
        }
        inverse.process(&mut spectrum, &mut correlation).ok();
        let zero_lag = correlation[0];
        if zero_lag <= 0.0 {
            continue;
        }
        for (lag, total) in tempogram.iter_mut().enumerate() {
            *total += f64::from(correlation[lag] / zero_lag);
        }
        windows += 1;
    }
    if windows == 0 {
        return None;
    }

    let mut best: Option<(f32, f32)> = None;
    for (lag, total) in tempogram.iter().enumerate().skip(1) {
        let bpm = 60.0 * frame_rate / lag as f32;
        if bpm > MAX_TEMPO {
            continue;
        }
        let strength = (*total / windows as f64) as f32;
        let prior = -0.5 * ((bpm.log2() - START_BPM.log2()) / PRIOR_OCTAVES).powi(2);
        let score = (1.0 + 1e6 * strength.max(0.0)).ln() + prior;
        if best.is_none_or(|(_, best_score)| score > best_score) {
            best = Some((bpm, score));
        }
    }
    best.map(|(bpm, _)| bpm)
}

fn local_score(onsets: &[f32], period: usize) -> Vec<f32> {
    let count = onsets.len() as f32;
    let mean = onsets.iter().sum::<f32>() / count;
    let variance = onsets
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f32>()
        / (count - 1.0).max(1.0);
    let scale = variance.sqrt() + f32::EPSILON;
    let radius = period as isize;
    let kernel: Vec<f32> = (-radius..=radius)
        .map(|offset| (-0.5 * (offset as f32 * 32.0 / period as f32).powi(2)).exp())
        .collect();
    (0..onsets.len() as isize)
        .map(|index| {
            kernel
                .iter()
                .enumerate()
                .filter_map(|(position, weight)| {
                    let source = index + position as isize - radius;
                    (source >= 0 && (source as usize) < onsets.len())
                        .then(|| onsets[source as usize] / scale * weight)
                })
                .sum()
        })
        .collect()
}

fn last_beat(cumulative: &[f32]) -> usize {
    let count = cumulative.len();
    let is_peak = |index: usize| {
        let previous = cumulative[index.saturating_sub(1)];
        let next = cumulative[(index + 1).min(count - 1)];
        index > 0 && cumulative[index] > previous && cumulative[index] >= next
    };
    let mut peaks: Vec<f32> = (0..count)
        .filter(|index| is_peak(*index))
        .map(|index| cumulative[index])
        .collect();
    if peaks.is_empty() {
        return count - 1;
    }
    peaks.sort_by(f32::total_cmp);
    let middle = peaks.len() / 2;
    let median = if peaks.len().is_multiple_of(2) {
        (peaks[middle - 1] + peaks[middle]) / 2.0
    } else {
        peaks[middle]
    };
    (0..count)
        .rev()
        .find(|index| is_peak(*index) && cumulative[*index] * 2.0 > median)
        .unwrap_or(count - 1)
}

fn trim_weak_beats(local: &[f32], beats: Vec<usize>) -> Vec<usize> {
    if beats.is_empty() {
        return beats;
    }
    let strengths: Vec<f32> = beats.iter().map(|beat| local[*beat]).collect();
    let kernel = [0.0_f32, 0.5, 1.0, 0.5, 0.0];
    let smoothed: Vec<f32> = (0..strengths.len() as isize)
        .map(|index| {
            kernel
                .iter()
                .enumerate()
                .filter_map(|(position, weight)| {
                    let source = index + position as isize - 2;
                    (source >= 0 && (source as usize) < strengths.len())
                        .then(|| strengths[source as usize] * weight)
                })
                .sum()
        })
        .collect();
    let threshold = 0.5
        * (smoothed.iter().map(|value| value * value).sum::<f32>() / smoothed.len() as f32).sqrt();
    let Some(first) = smoothed.iter().position(|value| *value > threshold) else {
        return Vec::new();
    };
    let last = smoothed
        .iter()
        .rposition(|value| *value > threshold)
        .unwrap_or(first);
    beats[first..=last].to_vec()
}

/// Beat frame indices from dynamic programming over the onset envelope at the global tempo.
pub fn track_beats(onsets: &[f32], sample_rate: u32) -> Vec<usize> {
    if onsets.len() < 4 || onsets.iter().all(|value| *value <= 0.0) {
        return Vec::new();
    }
    let Some(bpm) = estimate_tempo(onsets, sample_rate) else {
        return Vec::new();
    };
    let period = (frames_per_second(sample_rate) * 60.0 / bpm)
        .round()
        .max(1.0) as usize;
    let local = local_score(onsets, period);
    let threshold = 0.01 * local.iter().copied().fold(f32::MIN, f32::max);
    let earliest = 2 * period;
    let latest = (period as f32 / 2.0).round() as usize;
    let offsets: Vec<usize> = (latest.max(1)..=earliest).rev().collect();
    let transition: Vec<f32> = offsets
        .iter()
        .map(|offset| -TIGHTNESS * (*offset as f32 / period as f32).ln().powi(2))
        .collect();

    let mut cumulative = vec![0.0_f32; local.len()];
    let mut backlink = vec![None; local.len()];
    let mut started = false;
    for index in 0..local.len() {
        let mut best_score = f32::MIN;
        let mut best_source = None;
        for (offset, weight) in offsets.iter().zip(&transition) {
            let (score, source) = if *offset <= index {
                (weight + cumulative[index - offset], Some(index - offset))
            } else {
                (*weight, None)
            };
            if score > best_score {
                best_score = score;
                best_source = source;
            }
        }
        cumulative[index] = local[index] + best_score;
        if !started && local[index] < threshold {
            backlink[index] = None;
        } else {
            backlink[index] = best_source;
            started = true;
        }
    }

    let mut beats = vec![last_beat(&cumulative)];
    while let Some(previous) = backlink[*beats.last().unwrap()] {
        beats.push(previous);
    }
    beats.reverse();
    trim_weak_beats(&local, beats)
}

/// Places each tracked beat on the attack of its onset with millisecond precision.
///
/// Beats come out of the hop-sized onset envelope, so they are quantised to ~23 ms
/// and lag the attack by the envelope's alignment. Each beat is moved to the
/// steepest rise of short-window log energy shortly before its frame; beats
/// without a clear attack keep their frame time.
pub fn refine_beat_times_ms(samples: &[f32], sample_rate: u32, beat_frames: &[usize]) -> Vec<u64> {
    if sample_rate == 0 {
        return Vec::new();
    }
    let rate = f64::from(sample_rate);
    let step = (rate / 1_000.0).round().max(1.0) as usize;
    let step_ms = step as f64 * 1_000.0 / rate;
    let window = ((REFINE_WINDOW_MS * rate / 1_000.0) as usize).max(1);
    let energy: Vec<f64> = (0..samples.len() / step)
        .map(|index| {
            let start = index * step;
            let end = (start + window).min(samples.len());
            let sum: f64 = samples[start..end]
                .iter()
                .map(|value| f64::from(*value) * f64::from(*value))
                .sum();
            (sum / (end - start).max(1) as f64 + 1e-12).ln()
        })
        .collect();
    let mut refined = Vec::with_capacity(beat_frames.len());
    let mut previous: Option<u64> = None;
    for frame in beat_frames {
        let frame_ms = *frame as f64 * HOP_SIZE as f64 * 1_000.0 / rate;
        let from =
            (((frame_ms - REFINE_LOOKBACK_MS).max(0.0) / step_ms) as usize).max(REFINE_RISE_MS);
        let to = (((frame_ms + REFINE_LOOKAHEAD_MS) / step_ms) as usize)
            .min(energy.len().saturating_sub(1));
        let best = (from..=to)
            .filter(|index| *index < energy.len())
            .map(|index| (index, energy[index] - energy[index - REFINE_RISE_MS]))
            .max_by(|left, right| left.1.total_cmp(&right.1));
        let mut position = match best {
            Some((index, rise)) if rise >= REFINE_MIN_RISE => {
                (index as f64 * step_ms).round() as u64
            }
            _ => frame_ms.round() as u64,
        };
        position = position.max(previous.map_or(1, |last| last + 1));
        previous = Some(position);
        refined.push(position);
    }
    refined
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: u32 = 22_050;

    fn clicks(bpm: f32, seconds: f32) -> Vec<f32> {
        let mut samples = vec![0.0_f32; (seconds * SAMPLE_RATE as f32) as usize];
        let step = 60.0 / bpm;
        let mut time = 0.0;
        while time < seconds {
            let start = (time * SAMPLE_RATE as f32) as usize;
            for offset in 0..550 {
                if let Some(sample) = samples.get_mut(start + offset) {
                    *sample += 0.9 * (-7.0 * offset as f32 / 550.0).exp();
                }
            }
            time += step;
        }
        samples
    }

    #[test]
    fn refined_beats_land_on_the_click_attacks() {
        let samples = clicks(120.0, 30.0);
        let onsets = onset_strength(&samples, SAMPLE_RATE);
        let beats = track_beats(&onsets, SAMPLE_RATE);

        let refined = refine_beat_times_ms(&samples, SAMPLE_RATE, &beats);

        assert_eq!(refined.len(), beats.len());
        let errors: Vec<f64> = refined
            .iter()
            .map(|position| {
                let beat = (*position as f64 / 500.0).round() * 500.0;
                *position as f64 - beat
            })
            .collect();
        let mean = errors.iter().sum::<f64>() / errors.len() as f64;
        let worst = errors
            .iter()
            .fold(0.0_f64, |acc, value| acc.max(value.abs()));
        assert!(mean.abs() <= 2.0, "mean bias {mean} ms");
        assert!(worst <= 3.0, "worst error {worst} ms");
    }

    #[test]
    fn a_beat_on_the_first_frame_stays_inside_the_positive_grid() {
        let silence = vec![0.0_f32; SAMPLE_RATE as usize * 4];

        let refined = refine_beat_times_ms(&silence, SAMPLE_RATE, &[0, 0, 43]);

        assert_eq!(refined[0], 1);
        assert!(refined.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn frame_beats_lag_the_attacks_they_are_refined_from() {
        let samples = clicks(120.0, 30.0);
        let beats = track_beats(&onset_strength(&samples, SAMPLE_RATE), SAMPLE_RATE);
        let mean_lag = beats
            .iter()
            .map(|frame| {
                let ms = *frame as f64 * HOP_SIZE as f64 * 1_000.0 / f64::from(SAMPLE_RATE);
                ms - (ms / 500.0).round() * 500.0
            })
            .sum::<f64>()
            / beats.len() as f64;

        assert!(mean_lag > 5.0, "frame beats lag by {mean_lag} ms");
    }

    #[test]
    fn beats_without_an_attack_keep_their_frame_time() {
        let silence = vec![0.0_f32; SAMPLE_RATE as usize * 4];

        let refined = refine_beat_times_ms(&silence, SAMPLE_RATE, &[43, 86]);

        let expected: Vec<u64> = [43_u64, 86]
            .iter()
            .map(|frame| {
                ((*frame as f64) * HOP_SIZE as f64 * 1_000.0 / f64::from(SAMPLE_RATE)).round()
                    as u64
            })
            .collect();
        assert_eq!(refined, expected);
    }

    #[test]
    fn mel_scale_round_trips() {
        for hz in [0.0_f32, 440.0, 1_000.0, 5_000.0, 11_025.0] {
            assert!((mel_to_hz(hz_to_mel(hz)) - hz).abs() < 0.5, "{hz}");
        }
    }

    #[test]
    fn tempo_prefers_the_click_rate_over_its_octaves() {
        for bpm in [90.0_f32, 120.0, 150.0] {
            let onsets = onset_strength(&clicks(bpm, 30.0), SAMPLE_RATE);
            let estimate = estimate_tempo(&onsets, SAMPLE_RATE).unwrap();
            assert!((estimate - bpm).abs() / bpm < 0.04, "{bpm} -> {estimate}");
        }
    }

    #[test]
    fn beats_are_evenly_spaced_on_a_click_track() {
        let onsets = onset_strength(&clicks(120.0, 30.0), SAMPLE_RATE);
        let beats = track_beats(&onsets, SAMPLE_RATE);

        assert!(beats.len() >= 50, "{} beats", beats.len());
        let spacing = 60.0 / 120.0 * frames_per_second(SAMPLE_RATE);
        for pair in beats.windows(2) {
            let interval = (pair[1] - pair[0]) as f32;
            assert!((interval - spacing).abs() <= 1.5, "interval {interval}");
        }
    }

    fn bar_features(bar_starts: &[usize], kick_beats: &[usize], beats: usize) -> FrameFeatures {
        let spacing = 20;
        let frames = beats * spacing + spacing;
        let mut features = FrameFeatures {
            onsets: vec![0.2; frames],
            low_onsets: vec![0.1; frames],
            chroma: vec![[0.0; 12]; frames],
            bands: Vec::new(),
        };
        let mut chord = 0;
        for beat in 0..beats {
            let frame = beat * spacing;
            if bar_starts.contains(&beat) {
                chord = (chord + 5) % 12;
            }
            features.onsets[frame] = 1.0;
            if kick_beats.contains(&beat) {
                features.low_onsets[frame] = 1.0;
            }
            for slot in &mut features.chroma[frame..frame + spacing] {
                *slot = [0.0; 12];
                slot[chord] = 1.0;
                slot[(chord + 4) % 12] = 0.8;
                slot[(chord + 7) % 12] = 0.6;
            }
        }
        features
    }

    fn beat_frames(beats: usize) -> Vec<usize> {
        (0..beats).map(|beat| beat * 20).collect()
    }

    #[test]
    fn downbeat_follows_bass_and_chord_changes_after_a_pickup() {
        let beats = 33;
        let bars: Vec<usize> = (1..beats).step_by(4).collect();
        let kicks: Vec<usize> = (1..beats).step_by(2).collect();
        let features = bar_features(&bars, &kicks, beats);

        assert_eq!(downbeat_phase(&features, &beat_frames(beats)), Some(1));
    }

    #[test]
    fn no_downbeat_without_bar_structure() {
        let beats = 32;
        let kicks: Vec<usize> = (0..beats).collect();
        let features = bar_features(&[], &kicks, beats);

        assert_eq!(downbeat_phase(&features, &beat_frames(beats)), None);
    }

    #[test]
    fn no_downbeat_when_the_bar_shifts_halfway() {
        let beats = 34;
        let mut bars: Vec<usize> = (0..16).step_by(4).collect();
        bars.extend((18..beats).step_by(4));
        let features = bar_features(&bars, &bars, beats);

        assert_eq!(downbeat_phase(&features, &beat_frames(beats)), None);
    }

    #[test]
    fn short_grids_have_no_downbeat() {
        let beats = 12;
        let bars: Vec<usize> = (0..beats).step_by(4).collect();
        let features = bar_features(&bars, &bars, beats);

        assert_eq!(downbeat_phase(&features, &beat_frames(beats)), None);
    }

    fn model_grid(beats: u64) -> Vec<u64> {
        (0..beats).map(|beat| 1_000 + 500 * beat).collect()
    }

    fn on_phase(grid: &[u64], phase: usize, beats: std::ops::Range<usize>) -> Vec<u64> {
        beats
            .filter(|beat| beat % 4 == phase)
            .map(|beat| grid[beat])
            .collect()
    }

    #[test]
    fn model_downbeat_constants_match_the_python_analyzer() {
        assert_eq!(MODEL_DOWNBEAT_TOLERANCE_MS, 70);
        assert_eq!(MODEL_DOWNBEAT_MIN_SHARE, 0.6);
    }

    #[test]
    fn downbeat_phase_from_model_downbeats() {
        let grid = model_grid(64);
        // A pickup: the bar starts on the third beat, with two stray downbeats.
        let mut downbeats = on_phase(&grid, 2, 0..64);
        downbeats.extend([grid[4], grid[40]]);
        downbeats.sort_unstable();
        assert_eq!(downbeat_phase_from_model(&grid, &downbeats), Some(2));

        // Jitter within the tolerance still votes.
        let jittered: Vec<u64> = on_phase(&grid, 3, 0..64)
            .iter()
            .enumerate()
            .map(|(index, beat)| if index % 2 == 0 { beat - 60 } else { beat + 60 })
            .collect();
        assert_eq!(downbeat_phase_from_model(&grid, &jittered), Some(3));

        // Downbeats outside the grid neither vote nor dilute the share.
        let mut outside = vec![10, 200, grid[63] + 2_000, grid[63] + 4_000];
        outside.extend(on_phase(&grid, 1, 0..64));
        outside.sort_unstable();
        assert_eq!(downbeat_phase_from_model(&grid, &outside), Some(1));

        // Six of ten on one phase is exactly the share.
        let mut exact = on_phase(&grid, 0, 0..24);
        exact.extend([grid[1], grid[5], grid[9], grid[13]]);
        exact.sort_unstable();
        assert_eq!(exact.len(), 10);
        assert_eq!(downbeat_phase_from_model(&grid, &exact), Some(0));

        // A drifting tracked grid: each downbeat votes for its nearest beat.
        let drifting: Vec<u64> = (0..40_u64)
            .map(|beat| 1_000 + 480 * beat + 2 * beat * beat)
            .collect();
        let late: Vec<u64> = (1..40).step_by(4).map(|beat| drifting[beat] + 20).collect();
        assert_eq!(downbeat_phase_from_model(&drifting, &late), Some(1));
    }

    #[test]
    fn no_downbeat_below_min_share() {
        let grid = model_grid(64);
        let mut split = on_phase(&grid, 0, 0..32);
        split.extend(on_phase(&grid, 2, 32..64));
        let waltz: Vec<u64> = (0..64).step_by(3).map(|beat| grid[beat]).collect();
        let off_by_more: Vec<u64> = on_phase(&grid, 3, 0..64)
            .iter()
            .map(|beat| beat + MODEL_DOWNBEAT_TOLERANCE_MS + 30)
            .collect();
        let mut below = on_phase(&grid, 0, 0..20);
        below.extend([grid[1], grid[5], grid[9], grid[13]]);

        assert_eq!(downbeat_phase_from_model(&grid, &split), None);
        assert_eq!(downbeat_phase_from_model(&grid, &waltz), None);
        assert_eq!(downbeat_phase_from_model(&grid, &off_by_more), None);
        assert_eq!(downbeat_phase_from_model(&grid, &below), None);
        assert_eq!(downbeat_phase_from_model(&grid, &[]), None);
        assert_eq!(
            downbeat_phase_from_model(&[], &on_phase(&grid, 0, 0..64)),
            None
        );
    }

    #[test]
    fn external_beats_read_the_python_payload() {
        let beats: ExternalBeats = serde_json::from_str(
            r#"{"tracker": "beat-this-small0", "beats_ms": [1500, 0, 500, 1000, 1000],
                "downbeats_ms": [1500, 500], "beats_per_bar": 3}"#,
        )
        .unwrap();
        let beats = beats.normalized();

        assert_eq!(beats.tracker.as_deref(), Some("beat-this-small0"));
        assert_eq!(beats.beats_ms, vec![500, 1_000, 1_500]);
        assert_eq!(beats.downbeats_ms, vec![500, 1_500]);
        assert_eq!(beats.beats_per_bar, Some(3));
        assert_eq!(beats.other_meter(), Some(3));
    }

    #[test]
    fn only_a_bar_other_than_four_is_another_meter() {
        for (payload, beats_per_bar) in [
            (r#"{"beats_ms": [500], "beats_per_bar": 4}"#, Some(4)),
            (r#"{"beats_ms": [500], "beats_per_bar": null}"#, None),
            (r#"{"beats_ms": [500]}"#, None),
            (r#"{"beats_ms": [500], "beats_per_bar": 0}"#, None),
        ] {
            let beats = serde_json::from_str::<ExternalBeats>(payload)
                .unwrap()
                .normalized();

            assert_eq!(beats.beats_per_bar, beats_per_bar, "{payload}");
            assert_eq!(beats.other_meter(), None, "{payload}");
        }
    }

    #[test]
    fn model_beats_take_the_onset_peak_as_their_frame() {
        let samples = clicks(120.0, 10.0);
        let onsets = onset_strength(&samples, SAMPLE_RATE);
        // The clicks start at 0 s, every 500 ms; the model hears the attacks.
        let beats_ms: Vec<u64> = (1..19).map(|beat| 500 * beat).collect();

        let frames = model_beat_frames(&beats_ms, &onsets, SAMPLE_RATE);

        assert_eq!(frames.len(), beats_ms.len());
        for (frame, beat) in frames.iter().zip(&beats_ms) {
            let window = &onsets[frame.saturating_sub(2)..(frame + 3).min(onsets.len())];
            assert_eq!(
                onsets[*frame],
                window.iter().copied().fold(0.0_f32, f32::max)
            );
            let ms = *frame as f64 * HOP_SIZE as f64 * 1_000.0 / f64::from(SAMPLE_RATE);
            assert!(
                (ms - *beat as f64).abs() <= 50.0,
                "beat {beat} on frame {ms} ms"
            );
        }
        assert!(frames.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn close_model_beats_keep_their_frames_in_order() {
        let onsets: Vec<f32> = (0..40)
            .map(|frame| if frame % 7 == 0 { 1.0 } else { 0.1 })
            .collect();
        // Beats closer than the snapping window may not swap frames.
        let beats_ms: Vec<u64> = vec![100, 140, 180, 600];

        let frames = model_beat_frames(&beats_ms, &onsets, SAMPLE_RATE);

        assert!(
            frames.windows(2).all(|pair| pair[0] <= pair[1]),
            "{frames:?}"
        );
    }

    #[test]
    fn silence_has_no_tempo_or_beats() {
        let onsets = onset_strength(&vec![0.0; SAMPLE_RATE as usize * 10], SAMPLE_RATE);

        assert_eq!(estimate_tempo(&onsets, SAMPLE_RATE), None);
        assert!(track_beats(&onsets, SAMPLE_RATE).is_empty());
    }
}
