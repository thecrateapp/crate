//! Phrase segmentation and per-bar energy for Smart Mix profiles (SM3-D2).
//!
//! Same algorithm, constants and order of floating-point operations as
//! `app/crate/smart_mix/structure.py`, which documents the rules;
//! `app/tests/fixtures/smart_mix/structure_v1.json` (frames) and `structure_v2.json`
//! (per-bar features with chroma and MFCC) hold cases both must agree on and
//! `test_smart_mix_versions.py` checks that the constants match.
//!
//! The segmentation reuses frames the analyzer already computed: the cue-detection RMS
//! frames give each bar its energy, and the low/mid/high mel band levels, chroma and
//! MFCC of the beat tracker give its spectral balance, harmony and timbre (SM3-D17).
//! Phrases cover the bars that hold music as cue detection defines it, short silent gaps
//! are missing data, and novelty peaks place phrases of 8, 16 or 32 bars on an 8-bar
//! grid; kinds follow rules over phrase level and position.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use serde::Serialize;

pub const BEATS_PER_BAR: usize = 4;
pub const UNIT_BARS: usize = 8;
/// Phrase lengths in 8-bar units (32, 16 and 8 bars), longest first: ties keep it.
pub const PHRASE_UNITS: [usize; 3] = [4, 2, 1];
pub const MIN_STRUCTURE_BARS: usize = 2 * UNIT_BARS;
pub const BAND_COUNT: usize = 3;
pub const LOW_BAND_HZ: f32 = 200.0;
pub const MID_BAND_HZ: f32 = 2_000.0;
/// Cue detection's music: frames within this range of the loudest one and above the floor.
pub const MIN_ACTIVE_DBFS: f64 = -55.0;
pub const ACTIVE_RANGE_DB: f64 = 35.0;
/// RMS frames of 1/20 s (50 ms) in whole samples, with half a frame of hop.
pub const RMS_FRAMES_PER_SECOND: u32 = 20;
pub const RMS_MIN_FRAME_SAMPLES: usize = 256;
pub const RMS_MIN_HOP_SAMPLES: usize = 128;
pub const MAX_PHRASES: usize = 120;
pub const MAX_ENERGY_CURVE_BARS: usize = 2048;
/// Energy scale of the profile: RMS dBFS mapped linearly from -60 (0) to 0 (1).
pub const ENERGY_FLOOR_DB: f64 = -60.0;
/// Bar energy skips this much at each end of the bar, so a grid a few tens of ms off
/// neither pulls in the next section nor drops the downbeat in one analyzer only.
pub const BAR_EDGE_GUARD_MS: u64 = 50;
pub const MAX_GAP_BARS: usize = 2;
pub const NOVELTY_WINDOW_BARS: usize = 4;
pub const NOVELTY_NOISE_DB: f64 = 0.5;
pub const SPECTRAL_WEIGHT: f64 = 0.5;
/// Harmony and timbre novelty (SM3-D17): dB per unit of chroma cosine distance and of
/// standardised MFCC distance, the first 13 MFCC of the mel bands.
pub const HARMONY_WEIGHT: f64 = 2.0;
pub const TIMBRE_WEIGHT: f64 = 8.0;
pub const MFCC_COEFFICIENTS: usize = 13;
/// The first music bar keeps the grid unless another start beats its confidence by this.
pub const OFFSET_ZERO_PREFERENCE: f64 = 0.05;
pub const BOUNDARY_COST_DB: f64 = 4.0;
pub const HYPERBAR_16_BONUS_DB: f64 = 0.25;
pub const HYPERBAR_32_BONUS_DB: f64 = 0.5;
pub const CAP_SEARCH_STEPS: usize = 20;
pub const PEAK_MIN_DB: f64 = 1.0;
pub const SUPPORT_PEAKS: f64 = 3.0;
pub const BAR_JITTER_LIMIT: f64 = 0.08;
pub const GRID_DOUBT_FACTOR: f64 = 0.5;
pub const CONTRAST_DB: f64 = 2.0;
pub const PEAK_WITHIN_DB: f64 = 1.5;
pub const PEAK_ABOVE_TYPICAL_DB: f64 = 1.5;
pub const MAIN_WITHIN_TYPICAL_DB: f64 = 1.5;
pub const BREAK_BELOW_DB: f64 = 3.0;
pub const BUILD_RISE_DB: f64 = 1.5;
/// Tolerance for ties and thresholds, well above the float noise between analyzers.
pub const EPSILON: f64 = 1e-6;

/// A phrase of `bars` bars from the downbeat at `start_beat` (an index into the beat
/// grid). `energy` is the mean bar power on the profile energy scale and
/// `delta_energy` its change from the previous phrase, absent on the first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phrase {
    pub start_beat: u64,
    pub start_ms: u64,
    pub bars: u32,
    pub energy: f32,
    pub delta_energy: Option<f32>,
    pub kind: &'static str,
}

/// Phrases, one energy byte per bar from the first downbeat (absent without a
/// downbeat) and the segmentation confidence.
#[derive(Debug, Clone, PartialEq)]
pub struct Structure {
    pub phrases: Vec<Phrase>,
    pub energy_curve: Option<Vec<u8>>,
    pub structure_confidence: f32,
}

impl Structure {
    pub fn none() -> Self {
        Self {
            phrases: Vec::new(),
            energy_curve: None,
            structure_confidence: 0.0,
        }
    }
}

/// Frames the analyzer computed for other features. `rms` are the cue-detection RMS
/// frames, frame `i` starting at `i * rms_hop`; `bands_db` holds per STFT frame the mean
/// level (dB) of the mel bands below 200 Hz, below 2 kHz and above, frame `i` centred on
/// sample `i * band_hop`. `chroma` and `mfcc` are per-frame rows on the same frames, as
/// the beat tracker computes them (its chroma lags by the onset envelope's lead); empty
/// slices leave harmony and timbre out of the novelty.
pub struct EnergyFrames<'a> {
    pub rms: &'a [f32],
    pub rms_frame_length: usize,
    pub rms_hop: usize,
    pub bands_db: &'a [[f32; BAND_COUNT]],
    pub band_hop: usize,
    pub chroma: &'a [[f32; 12]],
    pub mfcc: &'a [[f32; MFCC_COEFFICIENTS]],
}

/// Length and hop, in samples, of the 50 ms RMS frames with a 25 ms hop.
pub fn rms_frame_geometry(sample_rate: u32) -> (usize, usize) {
    let frame_length = ((sample_rate / RMS_FRAMES_PER_SECOND) as usize).max(RMS_MIN_FRAME_SAMPLES);
    (frame_length, (frame_length / 2).max(RMS_MIN_HOP_SAMPLES))
}

/// Runs a segmentation, or returns no structure if it panics: a structure failure must
/// never fail the profile.
pub fn guarded(segment: impl FnOnce() -> Structure) -> Structure {
    catch_unwind(AssertUnwindSafe(segment)).unwrap_or_else(|_| {
        eprintln!("smart mix structure failed; keeping the profile without it");
        Structure::none()
    })
}

/// A bar from the downbeat at `start_beat` (an index into the beat grid).
pub struct Bar {
    pub start_beat: u64,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// Per bar: level (dBFS), spectral balance (band levels minus their mean, dB), whether it
/// holds music, mean chroma and mean MFCC.
pub struct BarFeatures {
    pub levels: Vec<f64>,
    pub shapes: Vec<[f64; BAND_COUNT]>,
    pub music: Vec<bool>,
    pub chroma: Vec<[f64; 12]>,
    pub mfcc: Vec<[f64; MFCC_COEFFICIENTS]>,
}

/// A run of equal novelty from bar `first` to bar `last` (inclusive).
struct Peak {
    first: usize,
    last: usize,
    value: f64,
}

impl Peak {
    fn distance(&self, bar: usize) -> usize {
        if (self.first..=self.last).contains(&bar) {
            0
        } else {
            bar.abs_diff(self.first).min(bar.abs_diff(self.last))
        }
    }
}

/// Every fourth beat of the grid, in phase with the downbeat anchor.
pub fn downbeats_from_anchor(beat_grid_ms: &[u64], downbeat_anchor_ms: Option<u64>) -> Vec<u64> {
    let Some(anchor) =
        downbeat_anchor_ms.and_then(|anchor| beat_grid_ms.iter().position(|beat| *beat == anchor))
    else {
        return Vec::new();
    };
    beat_grid_ms
        .iter()
        .skip(anchor % BEATS_PER_BAR)
        .step_by(BEATS_PER_BAR)
        .copied()
        .collect()
}

/// Phrases, energy curve and confidence; `grid_trusted = false` halves the confidence.
pub fn segment_phrases(
    beat_grid_ms: &[u64],
    downbeats_ms: &[u64],
    frames: &EnergyFrames<'_>,
    sample_rate: u32,
    grid_trusted: bool,
) -> Structure {
    let bars = bars(beat_grid_ms, downbeats_ms);
    if bars.is_empty() || sample_rate == 0 {
        return Structure::none();
    }
    segment_bars(
        &bars,
        &bar_features(&bars, frames, sample_rate),
        grid_trusted,
    )
}

/// The segmentation from per-bar features, the input the shared fixtures give.
pub fn segment_bars(bars: &[Bar], features: &BarFeatures, grid_trusted: bool) -> Structure {
    let curve: Vec<u8> = features
        .levels
        .iter()
        .map(|level| energy_byte(*level))
        .collect();
    let music: Vec<usize> = features
        .music
        .iter()
        .enumerate()
        .filter_map(|(index, is_music)| is_music.then_some(index))
        .collect();
    let (Some(&first), Some(&last_music)) = (music.first(), music.last()) else {
        return unsegmented(curve);
    };
    let last = last_music + 1;
    if last - first < MIN_STRUCTURE_BARS {
        return unsegmented(curve);
    }
    let levels = &features.levels[first..last];
    let gaps = gaps(&features.music[first..last]);
    let novelty = novelty(
        levels,
        &features.shapes[first..last],
        &gaps,
        &features.chroma[first..last],
        &features.mfcc[first..last],
    );
    let span = &bars[first..last];
    let (starts, mut confidence) = best_grid(&novelty, &peaks(&novelty, &gaps), span);
    if !grid_trusted {
        confidence *= GRID_DOUBT_FACTOR;
    }
    Structure {
        phrases: phrases(span, levels, &gaps, &starts),
        energy_curve: Some(curve),
        structure_confidence: round4(confidence) as f32,
    }
}

fn unsegmented(curve: Vec<u8>) -> Structure {
    Structure {
        phrases: Vec::new(),
        energy_curve: Some(curve),
        structure_confidence: 0.0,
    }
}

fn bars(beat_grid_ms: &[u64], downbeats_ms: &[u64]) -> Vec<Bar> {
    let index: HashMap<u64, usize> = beat_grid_ms
        .iter()
        .enumerate()
        .map(|(beat, position)| (*position, beat))
        .collect();
    let starts: Vec<(usize, u64)> = downbeats_ms
        .iter()
        .filter_map(|position| index.get(position).map(|beat| (*beat, *position)))
        .collect();
    if starts.len() < 2 {
        return Vec::new();
    }
    let durations: Vec<f64> = starts
        .windows(2)
        .map(|pair| (pair[1].1 - pair[0].1) as f64)
        .collect();
    let last_end = starts[starts.len() - 1].1 + median(&durations) as u64;
    starts
        .iter()
        .enumerate()
        .map(|(position, (beat, start_ms))| Bar {
            start_beat: *beat as u64,
            start_ms: *start_ms,
            end_ms: starts.get(position + 1).map_or(last_end, |next| next.1),
        })
        .take(MAX_ENERGY_CURVE_BARS)
        .collect()
}

/// Each bar's energy (dBFS), spectral balance (band levels minus their mean), chroma,
/// MFCC and whether it holds music: the RMS frames wholly inside the bar and the band
/// frames centred inside it (for chroma and MFCC, the frames all three arrays hold), all
/// leaving out `BAR_EDGE_GUARD_MS` at each end. Non-finite frames count as silence.
fn bar_features(bars: &[Bar], frames: &EnergyFrames<'_>, sample_rate: u32) -> BarFeatures {
    let rate = u64::from(sample_rate);
    let frame_length = frames.rms_frame_length;
    let hop = frames.rms_hop.max(1);
    let band_hop = frames.band_hop.max(1);
    let power: Vec<f64> = frames
        .rms
        .iter()
        .map(|value| {
            let value = if value.is_finite() && *value > 0.0 {
                f64::from(*value)
            } else {
                0.0
            };
            value * value
        })
        .collect();
    let mut power_sums = Vec::with_capacity(power.len() + 1);
    power_sums.push(0.0_f64);
    for value in &power {
        power_sums.push(power_sums[power_sums.len() - 1] + value);
    }
    let peak = power.iter().copied().fold(0.0_f64, f64::max);
    let threshold = if peak > 0.0 {
        let floor_db = MIN_ACTIVE_DBFS.max(10.0 * peak.log10() - ACTIVE_RANGE_DB);
        10.0_f64.powf(floor_db / 10.0)
    } else {
        f64::INFINITY
    };
    let mut music_counts = Vec::with_capacity(power.len() + 1);
    music_counts.push(0_usize);
    for value in &power {
        music_counts.push(music_counts[music_counts.len() - 1] + usize::from(*value >= threshold));
    }
    let mut band_sums = Vec::with_capacity(frames.bands_db.len() + 1);
    band_sums.push([0.0_f64; BAND_COUNT]);
    for bands in frames.bands_db {
        let mut sums = band_sums[band_sums.len() - 1];
        for (sum, level) in sums.iter_mut().zip(bands) {
            *sum += if level.is_finite() {
                f64::from(*level)
            } else {
                0.0
            };
        }
        band_sums.push(sums);
    }
    let frame_count = power.len();
    let band_count = frames.bands_db.len();
    let tonal_frames = band_count.min(frames.chroma.len()).min(frames.mfcc.len());
    let chroma_sums = prefix_sums(&frames.chroma[..tonal_frames]);
    let mfcc_sums = prefix_sums(&frames.mfcc[..tonal_frames]);
    let mut features = BarFeatures {
        levels: Vec::with_capacity(bars.len()),
        shapes: Vec::with_capacity(bars.len()),
        music: Vec::with_capacity(bars.len()),
        chroma: Vec::with_capacity(bars.len()),
        mfcc: Vec::with_capacity(bars.len()),
    };
    for bar in bars {
        let start = ((bar.start_ms + BAR_EDGE_GUARD_MS) * rate / 1_000) as usize;
        let end = (bar.end_ms.saturating_sub(BAR_EDGE_GUARD_MS) * rate / 1_000) as usize;
        let first = ceil_div(start, hop).min(frame_count);
        let last = if end >= frame_length {
            ((end - frame_length) / hop + 1).min(frame_count)
        } else {
            0
        };
        let mean_power = if last > first {
            features
                .music
                .push(music_counts[last] > music_counts[first]);
            (power_sums[last] - power_sums[first]) / (last - first) as f64
        } else {
            features.music.push(false);
            0.0
        };
        features.levels.push(power_db(mean_power));
        let band_first = ceil_div(start, band_hop).min(band_count);
        let band_last = ceil_div(end, band_hop).min(band_count);
        if band_last > band_first {
            let count = (band_last - band_first) as f64;
            let means: [f64; BAND_COUNT] = std::array::from_fn(|band| {
                (band_sums[band_last][band] - band_sums[band_first][band]) / count
            });
            let centre = sum(means.iter().copied()) / BAND_COUNT as f64;
            features.shapes.push(means.map(|mean| mean - centre));
        } else {
            features.shapes.push([0.0; BAND_COUNT]);
        }
        let tonal_first = band_first.min(tonal_frames);
        let tonal_last = band_last.min(tonal_frames);
        features
            .chroma
            .push(window_of(&chroma_sums, tonal_first, tonal_last));
        features
            .mfcc
            .push(window_of(&mfcc_sums, tonal_first, tonal_last));
    }
    features
}

/// Running sums of `f32` frame rows in `f64`, non-finite values as 0.
fn prefix_sums<const N: usize>(frames: &[[f32; N]]) -> Vec<[f64; N]> {
    let mut sums = Vec::with_capacity(frames.len() + 1);
    sums.push([0.0_f64; N]);
    for frame in frames {
        let mut next = sums[sums.len() - 1];
        for (total, value) in next.iter_mut().zip(frame) {
            *total += if value.is_finite() {
                f64::from(*value)
            } else {
                0.0
            };
        }
        sums.push(next);
    }
    sums
}

/// Mean row of the frames `first..last` from their running sums; zeros without frames.
fn window_of<const N: usize>(sums: &[[f64; N]], first: usize, last: usize) -> [f64; N] {
    if last <= first {
        return [0.0; N];
    }
    let count = (last - first) as f64;
    std::array::from_fn(|column| (sums[last][column] - sums[first][column]) / count)
}

/// Runs of at most `MAX_GAP_BARS` silent bars between music bars.
fn gaps(music: &[bool]) -> Vec<bool> {
    let mut gaps = vec![false; music.len()];
    let mut index = 0;
    while index < music.len() {
        if music[index] {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < music.len() && !music[end] {
            end += 1;
        }
        if end - index <= MAX_GAP_BARS {
            gaps[index..end].fill(true);
        }
        index = end;
    }
    gaps
}

/// Novelty at each bar boundary `0..=levels.len()`. Gap bars and boundaries without four
/// bars of music range on each side stay 0: a truncated window cannot tell a pickup or a
/// fade-in from a section change.
fn novelty(
    levels: &[f64],
    shapes: &[[f64; BAND_COUNT]],
    gaps: &[bool],
    chroma: &[[f64; 12]],
    mfcc: &[[f64; MFCC_COEFFICIENTS]],
) -> Vec<f64> {
    let count = levels.len();
    let mut novelty = vec![0.0; count + 1];
    let (harmony, timbre) = harmony_timbre(chroma, mfcc, gaps);
    for boundary in 0..=count {
        let Some((before, after)) = novelty_windows(boundary, gaps) else {
            continue;
        };
        let window_mean = |bars: &[usize], value: &dyn Fn(usize) -> f64| {
            sum(bars.iter().map(|bar| value(*bar))) / bars.len() as f64
        };
        let change = (window_mean(&after, &|bar| levels[bar])
            - window_mean(&before, &|bar| levels[bar]))
        .abs();
        let mut spectral = 0.0;
        // `band` indexes the inner array of every bar in both windows, not `shapes`.
        #[allow(clippy::needless_range_loop)]
        for band in 0..BAND_COUNT {
            spectral += (window_mean(&after, &|bar| shapes[bar][band])
                - window_mean(&before, &|bar| shapes[bar][band]))
            .abs();
        }
        novelty[boundary] = (change + SPECTRAL_WEIGHT * spectral - NOVELTY_NOISE_DB).max(0.0)
            + HARMONY_WEIGHT * harmony[boundary]
            + TIMBRE_WEIGHT * timbre[boundary];
    }
    novelty
}

/// The non-gap bars of the windows before and after a boundary, if it has novelty.
fn novelty_windows(boundary: usize, gaps: &[bool]) -> Option<(Vec<usize>, Vec<usize>)> {
    let count = gaps.len();
    if boundary < NOVELTY_WINDOW_BARS || boundary + NOVELTY_WINDOW_BARS > count || gaps[boundary] {
        return None;
    }
    let before: Vec<usize> = (boundary - NOVELTY_WINDOW_BARS..boundary)
        .filter(|bar| !gaps[*bar])
        .collect();
    let after: Vec<usize> = (boundary..(boundary + NOVELTY_WINDOW_BARS).min(count))
        .filter(|bar| !gaps[*bar])
        .collect();
    (!before.is_empty() && !after.is_empty()).then_some((before, after))
}

/// Harmony and timbre at each bar boundary `0..=gaps.len()`, unweighted (SM3-D17):
/// the cosine distance between the mean chroma of the windows (0 when either is silent)
/// and the distance between their mean MFCC over `sqrt(MFCC_COEFFICIENTS)`, each
/// coefficient standardised over the bars. Boundaries without windows get 0.
fn harmony_timbre(
    chroma: &[[f64; 12]],
    mfcc: &[[f64; MFCC_COEFFICIENTS]],
    gaps: &[bool],
) -> (Vec<f64>, Vec<f64>) {
    let count = gaps.len();
    let mut harmony = vec![0.0; count + 1];
    let mut timbre = vec![0.0; count + 1];
    let standard = standardized_columns(mfcc);
    for boundary in 0..=count {
        let Some((before, after)) = novelty_windows(boundary, gaps) else {
            continue;
        };
        harmony[boundary] =
            cosine_distance(&window_mean(chroma, &before), &window_mean(chroma, &after));
        timbre[boundary] = distance(
            &window_mean(&standard, &before),
            &window_mean(&standard, &after),
        ) / (MFCC_COEFFICIENTS as f64).sqrt();
    }
    (harmony, timbre)
}

/// Each column minus its mean, over its standard deviation (1 when within `EPSILON`).
fn standardized_columns<const N: usize>(rows: &[[f64; N]]) -> Vec<[f64; N]> {
    let mut standard = rows.to_vec();
    if rows.is_empty() {
        return standard;
    }
    let count = rows.len() as f64;
    for column in 0..N {
        let mean = sum(rows.iter().map(|row| row[column])) / count;
        let deviation = (sum(rows
            .iter()
            .map(|row| (row[column] - mean) * (row[column] - mean)))
            / count)
            .sqrt();
        let scale = if deviation > EPSILON { deviation } else { 1.0 };
        for (target, row) in standard.iter_mut().zip(rows) {
            target[column] = (row[column] - mean) / scale;
        }
    }
    standard
}

fn window_mean<const N: usize>(rows: &[[f64; N]], bars: &[usize]) -> [f64; N] {
    std::array::from_fn(|column| sum(bars.iter().map(|bar| rows[*bar][column])) / bars.len() as f64)
}

fn cosine_distance(left: &[f64], right: &[f64]) -> f64 {
    let denominator = sum(left.iter().map(|value| value * value)).sqrt()
        * sum(right.iter().map(|value| value * value)).sqrt();
    if denominator == 0.0 {
        return 0.0;
    }
    1.0 - sum(left.iter().zip(right).map(|(a, b)| a * b)) / denominator
}

fn distance(left: &[f64], right: &[f64]) -> f64 {
    sum(left.iter().zip(right).map(|(a, b)| (b - a) * (b - a))).sqrt()
}

/// Local maxima of the novelty over the non-gap boundaries; a plateau is one.
fn peaks(novelty: &[f64], gaps: &[bool]) -> Vec<Peak> {
    let count = novelty.len() - 1;
    let positions: Vec<usize> = (1..count).filter(|bar| !gaps[*bar]).collect();
    let values: Vec<f64> = positions.iter().map(|bar| novelty[*bar]).collect();
    let mut peaks = Vec::new();
    let mut index = 0;
    while index < values.len() {
        let mut end = index;
        while end + 1 < values.len() && (values[end + 1] - values[index]).abs() <= EPSILON {
            end += 1;
        }
        let value = values[index];
        let left = if index > 0 { values[index - 1] } else { 0.0 };
        let right = values.get(end + 1).copied().unwrap_or(0.0);
        if value >= PEAK_MIN_DB - EPSILON && value > left + EPSILON && value > right + EPSILON {
            peaks.push(Peak {
                first: positions[index],
                last: positions[end],
                value,
            });
        }
        index = end + 1;
    }
    peaks
}

/// Phrase starts (and the end) of the grid that best explains the section changes: for a
/// grid starting on each of the first eight music bars, the partition's confidence, the
/// first bar winning unless another beats it by `OFFSET_ZERO_PREFERENCE`.
fn best_grid(novelty: &[f64], peaks: &[Peak], bars: &[Bar]) -> (Vec<usize>, f64) {
    let count = novelty.len() - 1;
    let mut best_starts = Vec::new();
    let mut best_confidence = f64::NEG_INFINITY;
    let mut best_score = f64::NEG_INFINITY;
    for offset in 0..UNIT_BARS {
        if count < offset + UNIT_BARS {
            break;
        }
        let units = (count - offset) / UNIT_BARS;
        let mut starts = vec![offset];
        for length in capped_partition(novelty, offset, units) {
            starts.push(starts[starts.len() - 1] + length * UNIT_BARS);
        }
        let confidence = confidence(peaks, &starts, bars);
        let score = confidence
            + if offset == 0 {
                OFFSET_ZERO_PREFERENCE
            } else {
                0.0
            };
        if score > best_score + EPSILON {
            best_starts = starts;
            best_confidence = confidence;
            best_score = score;
        }
    }
    (best_starts, best_confidence)
}

/// Phrase lengths in units; raises the boundary cost while over `MAX_PHRASES`.
fn capped_partition(novelty: &[f64], offset: usize, units: usize) -> Vec<usize> {
    let lengths = partition(novelty, offset, units, BOUNDARY_COST_DB);
    if lengths.len() <= MAX_PHRASES {
        return lengths;
    }
    let (mut low, mut high) = (BOUNDARY_COST_DB, 2.0 * BOUNDARY_COST_DB);
    while partition(novelty, offset, units, high).len() > MAX_PHRASES {
        low = high;
        high *= 2.0;
    }
    for _ in 0..CAP_SEARCH_STEPS {
        let middle = 0.5 * (low + high);
        if partition(novelty, offset, units, middle).len() > MAX_PHRASES {
            low = middle;
        } else {
            high = middle;
        }
    }
    partition(novelty, offset, units, high)
}

fn partition(novelty: &[f64], offset: usize, units: usize, cost: f64) -> Vec<usize> {
    let mut gains = vec![0.0; units];
    for (unit, gain) in gains.iter_mut().enumerate().skip(1) {
        let bonus = if unit % 4 == 0 {
            HYPERBAR_32_BONUS_DB
        } else if unit % 2 == 0 {
            HYPERBAR_16_BONUS_DB
        } else {
            0.0
        };
        *gain = novelty[offset + unit * UNIT_BARS] + bonus - cost;
    }
    let mut best = vec![f64::NEG_INFINITY; units + 1];
    best[0] = 0.0;
    let mut choice = vec![0_usize; units + 1];
    for end in 1..=units {
        for length in PHRASE_UNITS {
            if length > end {
                continue;
            }
            let start = end - length;
            let candidate = best[start] + if start > 0 { gains[start] } else { 0.0 };
            if candidate > best[end] + EPSILON {
                best[end] = candidate;
                choice[end] = length;
            }
        }
    }
    let mut lengths = Vec::new();
    let mut end = units;
    while end > 0 {
        lengths.push(choice[end]);
        end -= choice[end];
    }
    lengths.reverse();
    lengths
}

fn phrases(bars: &[Bar], levels: &[f64], gaps: &[bool], starts: &[usize]) -> Vec<Phrase> {
    let level_of = |first: usize, last: usize| -> Option<f64> {
        let members: Vec<f64> = (first..last)
            .filter(|bar| !gaps[*bar])
            .map(|bar| levels[bar])
            .collect();
        (!members.is_empty()).then(|| power_level(&members))
    };
    let spans: Vec<(usize, usize)> = starts.windows(2).map(|pair| (pair[0], pair[1])).collect();
    let mut phrase_levels = Vec::with_capacity(spans.len());
    let mut rises = Vec::with_capacity(spans.len());
    for &(start, end) in &spans {
        phrase_levels.push(level_of(start, end).unwrap_or(ENERGY_FLOOR_DB));
        let middle = (start + end) / 2;
        rises.push(match (level_of(start, middle), level_of(middle, end)) {
            (Some(early), Some(late)) => late - early,
            _ => 0.0,
        });
    }
    let typical_levels: Vec<f64> = (starts[0]..starts[starts.len() - 1])
        .filter(|bar| !gaps[*bar])
        .map(|bar| levels[bar])
        .collect();
    let kinds = kinds(&phrase_levels, &rises, &spans, median(&typical_levels));
    let mut previous: Option<f64> = None;
    spans
        .iter()
        .zip(phrase_levels)
        .zip(kinds)
        .map(|((&(start, end), level), kind)| {
            let energy = round4(energy(level));
            let delta_energy = previous.map(|previous| round4(energy - previous) as f32);
            previous = Some(energy);
            Phrase {
                start_beat: bars[start].start_beat,
                start_ms: bars[start].start_ms,
                bars: (end - start) as u32,
                energy: energy as f32,
                delta_energy,
                kind,
            }
        })
        .collect()
}

fn kinds(
    levels: &[f64],
    rises: &[f64],
    spans: &[(usize, usize)],
    typical: f64,
) -> Vec<&'static str> {
    let count = levels.len();
    let top = levels.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let bottom = levels.iter().copied().fold(f64::INFINITY, f64::min);
    if count < 2 || top - bottom < CONTRAST_DB - EPSILON {
        return vec!["body"; count];
    }
    let peak: Vec<bool> = levels
        .iter()
        .map(|level| {
            *level >= top - PEAK_WITHIN_DB - EPSILON
                && *level >= typical + PEAK_ABOVE_TYPICAL_DB - EPSILON
        })
        .collect();
    let (main, reference) = if peak.contains(&true) {
        (peak.clone(), top)
    } else {
        (
            levels
                .iter()
                .map(|level| *level >= typical - MAIN_WITHIN_TYPICAL_DB - EPSILON)
                .collect::<Vec<bool>>(),
            typical,
        )
    };
    let (Some(first_main), Some(last_main)) = (
        main.iter().position(|is_main| *is_main),
        main.iter().rposition(|is_main| *is_main),
    ) else {
        return vec!["body"; count];
    };
    let middle = 0.5 * (spans[0].0 + spans[count - 1].1) as f64;
    spans
        .iter()
        .enumerate()
        .map(|(index, &(start, end))| {
            if peak[index] {
                "peak"
            } else if index + 1 < count
                && peak[index + 1]
                && rises[index] >= BUILD_RISE_DB - EPSILON
            {
                "build"
            } else if index < first_main && (start as f64) < middle {
                "intro"
            } else if index > last_main && end as f64 > middle {
                "outro"
            } else if first_main < index
                && index < last_main
                && levels[index] <= reference - BREAK_BELOW_DB + EPSILON
            {
                "break"
            } else {
                "body"
            }
        })
        .collect()
}

fn confidence(peaks: &[Peak], boundaries: &[usize], bars: &[Bar]) -> f64 {
    if peaks.is_empty() {
        return 0.0;
    }
    let (mut total, mut aligned, mut support) = (0.0, 0.0, 0.0);
    for peak in peaks {
        let distance = boundaries
            .iter()
            .map(|boundary| peak.distance(*boundary))
            .min()
            .unwrap_or(usize::MAX);
        let weight = match distance {
            0 => 1.0,
            1 => 0.5,
            _ => 0.0,
        };
        total += peak.value;
        aligned += weight * peak.value;
        support += weight;
    }
    let durations: Vec<f64> = bars[..bars.len().saturating_sub(1)]
        .iter()
        .map(|bar| (bar.end_ms - bar.start_ms) as f64)
        .collect();
    if durations.is_empty() {
        return 0.0;
    }
    let typical = median(&durations);
    let residuals: Vec<f64> = durations
        .iter()
        .map(|duration| (duration - typical).abs())
        .collect();
    let jitter = median(&residuals) / typical;
    let regularity = (1.0 - jitter / BAR_JITTER_LIMIT).clamp(0.0, 1.0);
    (aligned / total) * (support / SUPPORT_PEAKS).min(1.0) * regularity
}

fn energy(level_db: f64) -> f64 {
    ((level_db - ENERGY_FLOOR_DB) / -ENERGY_FLOOR_DB).clamp(0.0, 1.0)
}

fn energy_byte(level_db: f64) -> u8 {
    (255.0 * energy(level_db) + 0.5) as u8
}

fn power_db(mean_power: f64) -> f64 {
    if mean_power <= 0.0 {
        return ENERGY_FLOOR_DB;
    }
    (10.0 * mean_power.log10()).clamp(ENERGY_FLOOR_DB, 0.0)
}

/// Level (dB) of the mean power of bars given in dB.
fn power_level(levels_db: &[f64]) -> f64 {
    let powers: Vec<f64> = levels_db
        .iter()
        .map(|level| 10.0_f64.powf(level / 10.0))
        .collect();
    power_db(mean(&powers))
}

/// A plain left-to-right sum, the order the Python analyzer adds in.
fn sum(values: impl Iterator<Item = f64>) -> f64 {
    values.fold(0.0, |total, value| total + value)
}

fn mean(values: &[f64]) -> f64 {
    sum(values.iter().copied()) / values.len() as f64
}

fn median(values: &[f64]) -> f64 {
    let mut ordered = values.to_vec();
    ordered.sort_by(f64::total_cmp);
    let middle = ordered.len() / 2;
    if ordered.len() % 2 == 1 {
        ordered[middle]
    } else {
        0.5 * (ordered[middle - 1] + ordered[middle])
    }
}

/// Four decimals with halves away from zero, written as the Python analyzer writes it.
fn round4(value: f64) -> f64 {
    let scaled = value * 10_000.0;
    (scaled.abs() + 0.5).floor().copysign(scaled) / 10_000.0
}

fn ceil_div(numerator: usize, denominator: usize) -> usize {
    numerator.div_ceil(denominator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_without_main_phrases_are_body() {
        let spans = [(0, 8), (8, 16), (16, 24)];

        assert_eq!(
            kinds(&[-30.0, -33.0, -30.5], &[0.0; 3], &spans, -20.0),
            ["body"; 3]
        );
    }

    #[test]
    fn a_panicking_segmentation_leaves_no_structure() {
        let structure = guarded(|| panic!("segmentation exploded"));

        assert_eq!(structure, Structure::none());
    }
}
