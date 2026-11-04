//! Phrase segmentation and per-bar energy for Smart Mix profiles (SM3-D2).
//!
//! Same algorithm and constants as `app/crate/smart_mix/structure.py`, which documents
//! it; `app/tests/fixtures/smart_mix/structure_v1.json` holds cases both must agree on
//! and `test_smart_mix_versions.py` checks that the constants match.
//!
//! The segmentation reuses frames the analyzer already computed: the cue-detection RMS
//! frames give each bar its energy and the low/mid/high mel band levels of the beat
//! tracker give its spectral balance. Novelty at bar boundaries places phrases of 8, 16
//! or 32 bars on an 8-bar grid; kinds follow rules over phrase energy and position.

use std::collections::HashMap;

use serde::Serialize;

pub const BEATS_PER_BAR: usize = 4;
pub const UNIT_BARS: usize = 8;
/// Phrase lengths in 8-bar units (32, 16 and 8 bars), longest first: ties keep it.
pub const PHRASE_UNITS: [usize; 3] = [4, 2, 1];
pub const MIN_STRUCTURE_BARS: usize = 2 * UNIT_BARS;
pub const BAND_COUNT: usize = 3;
pub const MID_BAND_HZ: f32 = 2_000.0;
/// Energy scale of the profile: RMS dBFS mapped linearly from -60 (0) to 0 (1).
pub const ENERGY_FLOOR_DB: f64 = -60.0;
/// Bars this quiet are silence: phrases start and end on the bars inside them.
pub const SILENCE_DB: f64 = -50.0;
/// Bar energy skips this much at each end of the bar, so a grid a few tens of ms off
/// neither pulls in the next section nor drops the downbeat in one analyzer only.
pub const BAR_EDGE_GUARD_MS: u64 = 50;
pub const NOVELTY_WINDOW_BARS: usize = 4;
pub const NOVELTY_NOISE_DB: f64 = 0.5;
pub const SPECTRAL_WEIGHT: f64 = 0.5;
pub const OFFSET_ZERO_BONUS_DB: f64 = 1.0;
pub const BOUNDARY_COST_DB: f64 = 1.0;
pub const HYPERBAR_16_BONUS_DB: f64 = 0.25;
pub const HYPERBAR_32_BONUS_DB: f64 = 0.5;
pub const CAP_SEARCH_STEPS: usize = 20;
pub const PEAK_MIN_DB: f64 = 1.0;
pub const SUPPORT_PEAKS: f64 = 3.0;
pub const BAR_JITTER_LIMIT: f64 = 0.08;
pub const CONTRAST_DB: f64 = 2.0;
pub const PEAK_WITHIN_DB: f64 = 1.5;
pub const PEAK_ABOVE_TYPICAL_DB: f64 = 1.5;
pub const MAIN_WITHIN_TYPICAL_DB: f64 = 1.5;
pub const BREAK_BELOW_DB: f64 = 3.0;
pub const BUILD_RISE_DB: f64 = 1.5;
pub const MAX_PHRASES: usize = 120;
pub const MAX_ENERGY_CURVE_BARS: usize = 2048;
const EPSILON: f64 = 1e-9;

/// A phrase of `bars` bars from the downbeat at `start_beat` (an index into the beat
/// grid). `energy` is the mean bar energy on the profile energy scale and
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
/// sample `i * band_hop`.
pub struct EnergyFrames<'a> {
    pub rms: &'a [f32],
    pub rms_frame_length: usize,
    pub rms_hop: usize,
    pub bands_db: &'a [[f32; BAND_COUNT]],
    pub band_hop: usize,
}

struct Bar {
    start_beat: u64,
    start_ms: u64,
    end_ms: u64,
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

pub fn segment_phrases(
    beat_grid_ms: &[u64],
    downbeats_ms: &[u64],
    frames: &EnergyFrames<'_>,
    sample_rate: u32,
) -> Structure {
    let bars = bars(beat_grid_ms, downbeats_ms);
    if bars.is_empty() || sample_rate == 0 {
        return Structure::none();
    }
    let (levels, shapes) = bar_features(&bars, frames, sample_rate);
    let curve: Vec<u8> = levels.iter().map(|level| energy_byte(*level)).collect();
    let active: Vec<usize> = levels
        .iter()
        .enumerate()
        .filter_map(|(index, level)| (*level >= SILENCE_DB).then_some(index))
        .collect();
    let unsegmented = |curve: Vec<u8>| Structure {
        phrases: Vec::new(),
        energy_curve: Some(curve),
        structure_confidence: 0.0,
    };
    let (Some(&first), Some(&last_active)) = (active.first(), active.last()) else {
        return unsegmented(curve);
    };
    let last = last_active + 1;
    if last - first < MIN_STRUCTURE_BARS {
        return unsegmented(curve);
    }
    let novelty = novelty(&levels[first..last], &shapes[first..last]);
    let offset = grid_offset(&novelty);
    let units = (last - first - offset) / UNIT_BARS;
    let lengths = capped_partition(&novelty, offset, units);
    let mut starts = vec![offset];
    for length in lengths {
        starts.push(starts[starts.len() - 1] + length * UNIT_BARS);
    }
    let absolute: Vec<usize> = starts.iter().map(|start| first + start).collect();
    let phrases = phrases(&bars, &levels, &absolute);
    let structure_confidence = confidence(&novelty, &starts, &bars[first..last]);
    Structure {
        phrases,
        energy_curve: Some(curve),
        structure_confidence,
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

/// Each bar's energy (dBFS) and spectral balance (band levels minus their mean): the
/// mean power of the RMS frames wholly inside the bar and the band frames centred
/// inside it, both leaving out `BAR_EDGE_GUARD_MS` at each end.
fn bar_features(
    bars: &[Bar],
    frames: &EnergyFrames<'_>,
    sample_rate: u32,
) -> (Vec<f64>, Vec<[f64; BAND_COUNT]>) {
    let rate = u64::from(sample_rate);
    let frame_length = frames.rms_frame_length;
    let hop = frames.rms_hop.max(1);
    let band_hop = frames.band_hop.max(1);
    let mut power_sums = Vec::with_capacity(frames.rms.len() + 1);
    power_sums.push(0.0_f64);
    for value in frames.rms {
        let power = f64::from(*value) * f64::from(*value);
        power_sums.push(power_sums[power_sums.len() - 1] + power);
    }
    let mut band_sums = Vec::with_capacity(frames.bands_db.len() + 1);
    band_sums.push([0.0_f64; BAND_COUNT]);
    for bands in frames.bands_db {
        let mut sums = band_sums[band_sums.len() - 1];
        for (sum, level) in sums.iter_mut().zip(bands) {
            *sum += f64::from(*level);
        }
        band_sums.push(sums);
    }
    let frame_count = frames.rms.len();
    let band_count = frames.bands_db.len();
    let mut levels = Vec::with_capacity(bars.len());
    let mut shapes = Vec::with_capacity(bars.len());
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
            (power_sums[last] - power_sums[first]) / (last - first) as f64
        } else {
            0.0
        };
        levels.push(power_db(mean_power));
        let band_first = ceil_div(start, band_hop).min(band_count);
        let band_last = ceil_div(end, band_hop).min(band_count);
        if band_last > band_first {
            let count = (band_last - band_first) as f64;
            let means: [f64; BAND_COUNT] = std::array::from_fn(|band| {
                (band_sums[band_last][band] - band_sums[band_first][band]) / count
            });
            let centre = means.iter().sum::<f64>() / BAND_COUNT as f64;
            shapes.push(means.map(|mean| mean - centre));
        } else {
            shapes.push([0.0; BAND_COUNT]);
        }
    }
    (levels, shapes)
}

/// Novelty at each bar boundary `0..=levels.len()`; the two ends stay 0.
fn novelty(levels: &[f64], shapes: &[[f64; BAND_COUNT]]) -> Vec<f64> {
    let count = levels.len();
    let mut novelty = vec![0.0; count + 1];
    for boundary in 1..count {
        let low = boundary.saturating_sub(NOVELTY_WINDOW_BARS);
        let high = (boundary + NOVELTY_WINDOW_BARS).min(count);
        let before = mean(&levels[low..boundary]);
        let after = mean(&levels[boundary..high]);
        let band_mean = |range: &[[f64; BAND_COUNT]], band: usize| {
            range.iter().map(|shape| shape[band]).sum::<f64>() / range.len() as f64
        };
        let spectral: f64 = (0..BAND_COUNT)
            .map(|band| {
                (band_mean(&shapes[boundary..high], band) - band_mean(&shapes[low..boundary], band))
                    .abs()
            })
            .sum();
        novelty[boundary] =
            ((after - before).abs() + SPECTRAL_WEIGHT * spectral - NOVELTY_NOISE_DB).max(0.0);
    }
    novelty
}

/// The first of the opening eight active bars on which the 8-bar grid starts.
fn grid_offset(novelty: &[f64]) -> usize {
    let count = novelty.len() - 1;
    let mut best_offset = 0;
    let mut best_score = f64::NEG_INFINITY;
    for offset in 0..UNIT_BARS {
        if count < offset + UNIT_BARS {
            break;
        }
        let mut score: f64 = (offset..count)
            .step_by(UNIT_BARS)
            .filter(|boundary| *boundary >= 1)
            .map(|boundary| novelty[boundary])
            .sum();
        if offset == 0 {
            score += OFFSET_ZERO_BONUS_DB;
        }
        if score > best_score + EPSILON {
            best_offset = offset;
            best_score = score;
        }
    }
    best_offset
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

fn phrases(bars: &[Bar], levels: &[f64], starts: &[usize]) -> Vec<Phrase> {
    let spans: Vec<(usize, usize)> = starts.windows(2).map(|pair| (pair[0], pair[1])).collect();
    let phrase_levels: Vec<f64> = spans
        .iter()
        .map(|(start, end)| mean(&levels[*start..*end]))
        .collect();
    let rises: Vec<f64> = spans
        .iter()
        .map(|(start, end)| {
            let middle = (start + end) / 2;
            mean(&levels[middle..*end]) - mean(&levels[*start..middle])
        })
        .collect();
    let typical = median(&levels[starts[0]..starts[starts.len() - 1]]);
    let kinds = kinds(&phrase_levels, &rises, &spans, typical);
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
    if count < 2 || top - bottom < CONTRAST_DB {
        return vec!["body"; count];
    }
    let peak: Vec<bool> = levels
        .iter()
        .map(|level| *level >= top - PEAK_WITHIN_DB && *level >= typical + PEAK_ABOVE_TYPICAL_DB)
        .collect();
    let (main, reference) = if peak.iter().any(|is_peak| *is_peak) {
        (peak.clone(), top)
    } else {
        (
            levels
                .iter()
                .map(|level| *level >= typical - MAIN_WITHIN_TYPICAL_DB)
                .collect(),
            typical,
        )
    };
    let first_main = main.iter().position(|is_main| *is_main).unwrap_or(0);
    let last_main = main.iter().rposition(|is_main| *is_main).unwrap_or(0);
    let middle = 0.5 * (spans[0].0 + spans[count - 1].1) as f64;
    spans
        .iter()
        .enumerate()
        .map(|(index, &(start, end))| {
            if peak[index] {
                "peak"
            } else if index + 1 < count && peak[index + 1] && rises[index] >= BUILD_RISE_DB {
                "build"
            } else if index < first_main && (start as f64) < middle {
                "intro"
            } else if index > last_main && end as f64 > middle {
                "outro"
            } else if first_main < index
                && index < last_main
                && levels[index] <= reference - BREAK_BELOW_DB
            {
                "break"
            } else {
                "body"
            }
        })
        .collect()
}

fn confidence(novelty: &[f64], boundaries: &[usize], bars: &[Bar]) -> f32 {
    let count = novelty.len() - 1;
    let peaks: Vec<usize> = (1..count)
        .filter(|boundary| {
            novelty[*boundary] >= PEAK_MIN_DB
                && novelty[*boundary] > novelty[boundary - 1]
                && novelty[*boundary] >= novelty[boundary + 1]
        })
        .collect();
    if peaks.is_empty() {
        return 0.0;
    }
    let (mut total, mut aligned, mut support) = (0.0, 0.0, 0.0);
    for peak in peaks {
        let distance = boundaries
            .iter()
            .map(|boundary| peak.abs_diff(*boundary))
            .min()
            .unwrap_or(usize::MAX);
        let weight = match distance {
            0 => 1.0,
            1 => 0.5,
            _ => 0.0,
        };
        total += novelty[peak];
        aligned += weight * novelty[peak];
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
    round4((aligned / total) * (support / SUPPORT_PEAKS).min(1.0) * regularity) as f32
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

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
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

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn ceil_div(numerator: usize, denominator: usize) -> usize {
    numerator.div_ceil(denominator)
}
