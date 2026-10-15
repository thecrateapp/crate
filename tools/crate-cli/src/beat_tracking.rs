//! Onset strength, tempo estimation and dynamic-programming beat tracking.
//!
//! Ports the librosa pipeline used by the Python analyzer (`onset_strength`,
//! `feature.tempo` and `beat.beat_track`, after Ellis 2007) so both analyzers
//! place beats with the same method.

use realfft::RealFftPlanner;

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
const LOW_BAND_HZ: f32 = 200.0;
const CHROMA_MIN_HZ: f32 = 55.0;
const CHROMA_MAX_HZ: f32 = 5_000.0;
const DOWNBEAT_WINDOW_FRAMES: usize = 2;
const DOWNBEAT_MIN_BEATS: usize = 16;
const DOWNBEAT_MARGIN: f32 = 0.3;

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
pub struct FrameFeatures {
    pub onsets: Vec<f32>,
    pub low_onsets: Vec<f32>,
    pub chroma: Vec<[f32; 12]>,
}

fn low_band_count(sample_rate: u32) -> usize {
    let max_mel = hz_to_mel(sample_rate as f32 / 2.0);
    (0..MEL_BANDS)
        .take_while(|band| {
            mel_to_hz(max_mel * (*band + 1) as f32 / (MEL_BANDS + 1) as f32) < LOW_BAND_HZ
        })
        .count()
        .max(1)
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

/// Index of the first downbeat in `beats` (4/4 assumed) when bass onsets and harmonic
/// changes consistently favor one bar phase across both halves of the track.
pub fn downbeat_phase(features: &FrameFeatures, beats: &[usize]) -> Option<usize> {
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
    let scores: Vec<f32> = (0..beats.len())
        .map(|index| low[index] + harmonic[index] + 0.5 * broad[index])
        .collect();
    let (phase, margin) = best_phase(&scores, 0..beats.len())?;
    if margin < DOWNBEAT_MARGIN {
        return None;
    }
    let middle = beats.len() / 2;
    let (first, _) = best_phase(&scores, 0..middle)?;
    let (second, _) = best_phase(&scores, middle..beats.len())?;
    (first == phase && second == phase).then_some(phase)
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

    #[test]
    fn silence_has_no_tempo_or_beats() {
        let onsets = onset_strength(&vec![0.0; SAMPLE_RATE as usize * 10], SAMPLE_RATE);

        assert_eq!(estimate_tempo(&onsets, SAMPLE_RATE), None);
        assert!(track_beats(&onsets, SAMPLE_RATE).is_empty());
    }
}
