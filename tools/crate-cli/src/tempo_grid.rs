//! Constant-tempo grid fitted to the tracked beats.
//!
//! The dynamic-programming tracker follows the strongest onsets. In a break where the
//! off-beats are louder it can lock onto them for a few bars and come back, which inserts
//! or drops a beat. Analyzer v5 published those beats as the grid and took the tempo from
//! a regression of beat index against time, so a single slip moved the BPM by about 1/N
//! (128.346 for a 128 BPM track) and the grid sat half a beat off through the break.
//!
//! The fit here does not count beats. It maximises the coherence of the beat times at
//! twice the beat rate, where a beat on the off-beat lines up with one on the beat, so
//! every tracked beat informs the period and a phase flip costs nothing. A constant grid
//! is published only when the beats stay close to it along the whole track. Its tempo
//! then snaps to a whole (or half) BPM if that keeps the grid within 25 ms over the track,
//! and its phase is checked against the onsets: the majority of the tracked beats picks
//! one of the two half-beat phases, unless both the bass and the broadband onsets are
//! clearly stronger on the other one.

use std::f64::consts::TAU;

use crate::beat_tracking::{FrameFeatures, HOP_SIZE};

const MIN_BEATS: usize = 32;
/// Periods searched around the median tracked interval.
const SEARCH_SPAN: f64 = 0.03;
/// Coherence (0..1) the tracked beats need at the fitted period for a constant grid.
const MIN_COHERENCE: f64 = 0.5;
const BLOCK_BEATS: usize = 16;
/// A block of beats is steady when most of its beats sit within `BEAT_TOLERANCE_MS` of the
/// half-beat lattice and its median residual stays within `BLOCK_TOLERANCE_MS`, so the
/// beats neither drift away nor cycle around it (another tempo aliasing onto the lattice).
const BEAT_TOLERANCE_MS: f64 = 35.0;
const BLOCK_TOLERANCE_MS: f64 = 25.0;
const MIN_STEADY_BLOCKS: f64 = 0.8;
/// Largest drift over the tracked span that snapping the tempo may add, as Mixxx allows.
const SNAP_DRIFT_MS: f64 = 25.0;
/// Onsets must be this much stronger on the other phase, in both bands, to overrule the
/// majority of the tracked beats.
const PHASE_FLIP_RATIO: f32 = 1.25;
const ONSET_WINDOW_FRAMES: usize = 2;
/// A half-beat slide is a run of this many intervals...
const SLIDE_WINDOW_BEATS: usize = 6;
/// ...that spans a whole number of beats plus at least this fraction of a beat...
const SLIDE_MIN_FRACTION: f64 = 0.4;
/// ...with the same tempo (within 3 %) over this many intervals before and after it.
const SLIDE_CONTEXT_BEATS: usize = 8;
const SLIDE_MAX_TEMPO_CHANGE: f64 = 0.03;

/// The tempo of the strongest constant pulse, and the grid when the track keeps it.
#[derive(Debug, Clone, PartialEq)]
pub struct TempoFit {
    /// Fitted tempo in BPM, not snapped. Meaningful even when the tempo moves.
    pub bpm: f64,
    /// Share (0..1) of the tracked beats that agree with a constant pulse.
    pub coherence: f64,
    pub grid: Option<ConstantGrid>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConstantGrid {
    /// Snapped to a whole or half BPM when that fits, otherwise the fitted tempo.
    pub bpm: f64,
    pub period_ms: f64,
    /// Position of one beat; every other beat is a whole number of periods away.
    pub anchor_ms: f64,
    /// Share (0..1) of the tracked beats that sit on the published phase rather than on
    /// the off-beat. Low values mean the phase is ambiguous.
    pub phase_support: f64,
    /// The onsets overruled the majority of the tracked beats.
    pub phase_flipped: bool,
}

impl ConstantGrid {
    /// Grid beats from the one nearest `from_ms` to the one nearest `to_ms`, in whole
    /// milliseconds and never before 1 ms.
    pub fn beats_ms(&self, from_ms: f64, to_ms: f64) -> Vec<u64> {
        let first = ((from_ms - self.anchor_ms) / self.period_ms).round() as i64;
        let last = ((to_ms - self.anchor_ms) / self.period_ms).round() as i64;
        (first..=last)
            .map(|index| self.anchor_ms + index as f64 * self.period_ms)
            .filter(|position| *position >= 1.0)
            .map(|position| position.round() as u64)
            .collect()
    }

    /// The grid beat nearest a position.
    pub fn beat_near_ms(&self, position_ms: f64) -> f64 {
        self.anchor_ms + ((position_ms - self.anchor_ms) / self.period_ms).round() * self.period_ms
    }
}

/// Offset of `value` from the nearest multiple of `period`, in `[-period/2, period/2]`.
fn wrap(value: f64, period: f64) -> f64 {
    value - (value / period).round() * period
}

/// Mean resultant length and angle of the beat times on a circle of `period / harmonic`.
fn resultant(times: &[f64], period: f64, harmonic: f64) -> (f64, f64) {
    let (sine, cosine) = times.iter().fold((0.0, 0.0), |(sine, cosine), time| {
        let angle = TAU * harmonic * time / period;
        (sine + angle.sin(), cosine + angle.cos())
    });
    let count = times.len() as f64;
    (
        (sine * sine + cosine * cosine).sqrt() / count,
        sine.atan2(cosine),
    )
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

/// Period with the most coherent beats at twice the beat rate, around `initial`.
fn best_period(times: &[f64], initial: f64, span: f64) -> (f64, f64) {
    let step = (initial * initial / (16.0 * span)).max(1e-3);
    let search = |from: f64, to: f64, step: f64| {
        let mut best = (initial, f64::MIN);
        let mut period = from;
        while period <= to {
            let (coherence, _) = resultant(times, period, 2.0);
            if coherence > best.1 {
                best = (period, coherence);
            }
            period += step;
        }
        best
    };
    let (coarse, _) = search(
        initial * (1.0 - SEARCH_SPAN),
        initial * (1.0 + SEARCH_SPAN),
        step,
    );
    search(coarse - step, coarse + step, step / 20.0)
}

/// Steady when most runs of beats stay on the half-beat lattice.
fn is_steady(times: &[f64], period: f64, lattice: f64) -> bool {
    let residuals: Vec<f64> = times
        .iter()
        .map(|time| wrap(time - lattice, period / 2.0))
        .collect();
    let blocks: Vec<&[f64]> = residuals
        .chunks(BLOCK_BEATS)
        .filter(|block| block.len() * 2 >= BLOCK_BEATS)
        .collect();
    let steady = blocks
        .iter()
        .filter(|block| {
            let near = block
                .iter()
                .filter(|residual| residual.abs() <= BEAT_TOLERANCE_MS)
                .count();
            2 * near >= block.len() && median(&mut block.to_vec()).abs() <= BLOCK_TOLERANCE_MS
        })
        .count();
    !blocks.is_empty() && steady as f64 >= MIN_STEADY_BLOCKS * blocks.len() as f64
}

fn snapped_period(period: f64, span: f64) -> f64 {
    let bpm = 60_000.0 / period;
    [1.0, 2.0]
        .iter()
        .map(|fraction| 60_000.0 / ((bpm * fraction).round() / fraction))
        .find(|candidate| (candidate - period).abs() * span / period <= SNAP_DRIFT_MS)
        .unwrap_or(period)
}

/// Median onset peak around the grid positions between `from` and `to` (ms), for the
/// broadband and the bass onsets: the typical beat position, so one loud section (a
/// break full of claps on the off-beat) cannot decide the phase of the whole track.
fn onset_evidence(
    features: &FrameFeatures,
    sample_rate: u32,
    phase: f64,
    period: f64,
    (from, to): (f64, f64),
) -> (f32, f32) {
    let frame_ms = HOP_SIZE as f64 * 1_000.0 / f64::from(sample_rate);
    let peak = |values: &[f32], frame: usize| {
        let start = frame.saturating_sub(ONSET_WINDOW_FRAMES);
        let end = (frame + ONSET_WINDOW_FRAMES + 1).min(values.len());
        values[start.min(end)..end]
            .iter()
            .copied()
            .fold(0.0_f32, f32::max)
    };
    let (mut broad, mut low) = (Vec::new(), Vec::new());
    let mut position = phase + ((from - phase) / period).ceil() * period;
    while position <= to {
        let frame = (position / frame_ms).round() as usize;
        if frame < features.onsets.len() {
            broad.push(f64::from(peak(&features.onsets, frame)));
            low.push(f64::from(peak(&features.low_onsets, frame)));
        }
        position += period;
    }
    if broad.is_empty() {
        return (0.0, 0.0);
    }
    (median(&mut broad) as f32, median(&mut low) as f32)
}

/// Fits the strongest constant pulse to refined beat positions (ms) and, when the track
/// keeps it, a constant grid checked against the onsets of the same analysis.
pub fn fit_tempo(beats_ms: &[u64], features: &FrameFeatures, sample_rate: u32) -> Option<TempoFit> {
    if beats_ms.len() < MIN_BEATS || sample_rate == 0 {
        return None;
    }
    let times: Vec<f64> = beats_ms.iter().map(|beat| *beat as f64).collect();
    let span = times[times.len() - 1] - times[0];
    let mut intervals: Vec<f64> = times.windows(2).map(|pair| pair[1] - pair[0]).collect();
    let initial = median(&mut intervals);
    if initial <= 0.0 || span <= 0.0 {
        return None;
    }
    let (fitted, coherence) = best_period(&times, initial, span);
    let lattice = |period: f64| {
        let (_, angle) = resultant(&times, period, 2.0);
        (angle / TAU * period / 2.0).rem_euclid(period / 2.0)
    };
    let bpm = 60_000.0 / fitted;
    if coherence < MIN_COHERENCE || !is_steady(&times, fitted, lattice(fitted)) {
        return Some(TempoFit {
            bpm,
            coherence,
            grid: None,
        });
    }

    let period = snapped_period(fitted, span);
    let on_beat = lattice(period);
    let off_beat = on_beat + period / 2.0;
    let near = |phase: f64| {
        times
            .iter()
            .filter(|time| wrap(*time - phase, period).abs() < period / 4.0)
            .count() as f64
            / times.len() as f64
    };
    let support = near(on_beat);
    let (majority, minority) = if support >= 0.5 {
        (on_beat, off_beat)
    } else {
        (off_beat, on_beat)
    };
    let tracked = (times[0], times[times.len() - 1]);
    let (majority_broad, majority_low) =
        onset_evidence(features, sample_rate, majority, period, tracked);
    let (minority_broad, minority_low) =
        onset_evidence(features, sample_rate, minority, period, tracked);
    let phase_flipped = minority_broad >= PHASE_FLIP_RATIO * majority_broad
        && minority_low >= PHASE_FLIP_RATIO * majority_low;
    let phase = if phase_flipped { minority } else { majority };
    let mut offsets: Vec<f64> = times
        .iter()
        .map(|time| wrap(time - phase, period))
        .filter(|offset| offset.abs() < period / 4.0)
        .collect();
    let anchor_ms = if offsets.is_empty() {
        phase
    } else {
        phase + median(&mut offsets)
    };
    Some(TempoFit {
        bpm,
        coherence,
        grid: Some(ConstantGrid {
            bpm: 60_000.0 / period,
            period_ms: period,
            anchor_ms,
            phase_support: near(phase),
            phase_flipped,
        }),
    })
}

/// Places where the tracked beats slide half a beat, which leaves part of the grid on the
/// off-beat. The tracker does it over a few beats (two intervals of 1.25 beats, or four of
/// 0.875), so a slide is a short run of intervals spanning a whole and a half beats of the
/// tempo around it, with the same tempo before and after: a tempo change or a dropped
/// beat is not a slide.
pub fn half_beat_slides(beats_ms: &[u64]) -> usize {
    let intervals: Vec<f64> = beats_ms
        .windows(2)
        .map(|pair| pair[1] as f64 - pair[0] as f64)
        .collect();
    let mut slides = 0;
    let mut index = SLIDE_CONTEXT_BEATS;
    while index + SLIDE_WINDOW_BEATS + SLIDE_CONTEXT_BEATS <= intervals.len() {
        let before = median(&mut intervals[index - SLIDE_CONTEXT_BEATS..index].to_vec());
        let after_start = index + SLIDE_WINDOW_BEATS;
        let after = median(&mut intervals[after_start..after_start + SLIDE_CONTEXT_BEATS].to_vec());
        let period = 0.5 * (before + after);
        let beats = intervals[index..after_start].iter().sum::<f64>() / period;
        if period > 0.0
            && (before - after).abs() / period <= SLIDE_MAX_TEMPO_CHANGE
            && (beats - beats.round()).abs() >= SLIDE_MIN_FRACTION
        {
            slides += 1;
            index = after_start + SLIDE_CONTEXT_BEATS;
        } else {
            index += 1;
        }
    }
    slides
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: u32 = 22_050;

    fn frame_ms() -> f64 {
        HOP_SIZE as f64 * 1_000.0 / f64::from(SAMPLE_RATE)
    }

    /// Onset envelopes with a peak at each listed position (ms).
    fn features(duration_ms: f64, broad: &[(f64, f32)], low: &[(f64, f32)]) -> FrameFeatures {
        let frames = (duration_ms / frame_ms()) as usize + 4;
        let mut features = FrameFeatures {
            onsets: vec![0.05; frames],
            low_onsets: vec![0.05; frames],
            chroma: vec![[0.0; 12]; frames],
        };
        for (values, peaks) in [
            (&mut features.onsets, broad),
            (&mut features.low_onsets, low),
        ] {
            for (position, strength) in peaks {
                let frame = (position / frame_ms()).round() as usize;
                if let Some(value) = values.get_mut(frame) {
                    *value = value.max(*strength);
                }
            }
        }
        features
    }

    fn lattice(bpm: f64, count: usize, offset: f64) -> Vec<f64> {
        (0..count)
            .map(|index| offset + index as f64 * 60_000.0 / bpm)
            .collect()
    }

    fn rounded(times: &[f64]) -> Vec<u64> {
        times.iter().map(|time| time.round() as u64).collect()
    }

    #[test]
    fn a_whole_tempo_snaps_and_keeps_the_beat_phase() {
        let mut seed = 7_u32;
        let beats: Vec<f64> = lattice(128.0, 300, 230.0)
            .into_iter()
            .map(|time| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                time + (seed >> 16) as f64 / 65_536.0 * 30.0 - 15.0
            })
            .collect();
        let strong: Vec<(f64, f32)> = beats.iter().map(|time| (*time, 1.0)).collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(150_000.0, &strong, &strong),
            SAMPLE_RATE,
        )
        .unwrap();

        let grid = fit.grid.unwrap();
        assert_eq!(grid.bpm, 128.0);
        assert!(
            wrap(grid.anchor_ms - 230.0, grid.period_ms).abs() <= 3.0,
            "{grid:?}"
        );
        assert!(grid.phase_support > 0.95);
    }

    #[test]
    fn a_section_on_the_off_beat_does_not_move_the_tempo_or_the_phase() {
        let period = 60_000.0 / 128.0;
        let beats: Vec<f64> = lattice(128.0, 300, 100.0)
            .into_iter()
            .enumerate()
            .map(|(index, time)| {
                if (100..160).contains(&index) {
                    time + period / 2.0
                } else {
                    time
                }
            })
            .collect();
        let kicks: Vec<(f64, f32)> = lattice(128.0, 300, 100.0)
            .into_iter()
            .map(|time| (time, 1.0))
            .collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(150_000.0, &kicks, &kicks),
            SAMPLE_RATE,
        )
        .unwrap();

        let grid = fit.grid.unwrap();
        assert_eq!(grid.bpm, 128.0);
        assert!(
            wrap(grid.anchor_ms - 100.0, period).abs() <= 1.0,
            "{grid:?}"
        );
        assert!((grid.phase_support - 0.8).abs() < 0.01);
    }

    #[test]
    fn onsets_overrule_beats_tracked_on_the_off_beat() {
        let period = 60_000.0 / 120.0;
        let beats = lattice(120.0, 200, 250.0 + period / 2.0);
        let kicks: Vec<(f64, f32)> = lattice(120.0, 200, 250.0)
            .into_iter()
            .map(|time| (time, 1.0))
            .collect();
        let weak: Vec<(f64, f32)> = beats.iter().map(|time| (*time, 0.4)).collect();
        let broad: Vec<(f64, f32)> = kicks.iter().chain(&weak).copied().collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(110_000.0, &broad, &kicks),
            SAMPLE_RATE,
        )
        .unwrap();

        let grid = fit.grid.unwrap();
        assert!(grid.phase_flipped);
        assert!(
            wrap(grid.anchor_ms - 250.0, period).abs() <= 1.0,
            "{grid:?}"
        );
        assert_eq!(grid.phase_support, 0.0);
    }

    #[test]
    fn a_fractional_tempo_is_not_snapped() {
        let beats = lattice(127.6, 400, 50.0);
        let strong: Vec<(f64, f32)> = beats.iter().map(|time| (*time, 1.0)).collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(200_000.0, &strong, &strong),
            SAMPLE_RATE,
        )
        .unwrap();

        let grid = fit.grid.unwrap();
        assert!((grid.bpm - 127.6).abs() < 0.005, "{grid:?}");
    }

    #[test]
    fn a_drifting_tempo_gets_no_constant_grid() {
        let mut beats = Vec::new();
        let mut time = 0.0;
        while time < 150_000.0 {
            beats.push(time);
            time += 60_000.0 / (121.0 + 0.6 * time / 150_000.0);
        }
        let strong: Vec<(f64, f32)> = beats.iter().map(|time| (*time, 1.0)).collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(150_000.0, &strong, &strong),
            SAMPLE_RATE,
        )
        .unwrap();

        assert!(fit.grid.is_none(), "{fit:?}");
        assert!((fit.bpm - 121.3).abs() < 0.3, "{fit:?}");
    }

    #[test]
    fn two_tempos_get_no_constant_grid_even_where_they_alias() {
        // 60 BPM beats land on the 70 BPM half-beat lattice every third beat and
        // alternate symmetrically around it in between.
        let mut beats = lattice(60.0, 60, 0.0);
        let second = lattice(70.0, 70, 60_000.0);
        beats.extend(second);
        let strong: Vec<(f64, f32)> = beats.iter().map(|time| (*time, 1.0)).collect();

        let fit = fit_tempo(
            &rounded(&beats),
            &features(125_000.0, &strong, &strong),
            SAMPLE_RATE,
        )
        .unwrap();

        assert!(fit.grid.is_none(), "{fit:?}");
    }

    /// A live take whose tracked beats slide half a beat over two beats and back.
    fn sliding_take() -> Vec<f64> {
        let period = 60_000.0 / 87.0;
        let mut beats = Vec::new();
        let mut time = 0.0;
        for index in 0..200 {
            beats.push(time);
            let wander = 1.0 + 0.01 * (index as f64 / 9.0).sin();
            let slide = match index {
                40 => 1.26,
                41 => 1.24,
                120..=123 => 0.875,
                _ => 1.0,
            };
            time += period * wander * slide;
        }
        beats
    }

    #[test]
    fn half_beat_slides_are_counted() {
        assert_eq!(half_beat_slides(&rounded(&sliding_take())), 2);
    }

    #[test]
    fn a_steady_take_or_a_tempo_change_has_no_half_beat_slide() {
        let steady = lattice(87.0, 200, 30.0);
        let mut change = lattice(120.0, 100, 0.0);
        let start = change[change.len() - 1] + 60_000.0 / 140.0;
        change.extend(lattice(140.0, 100, start));
        let mut dropped = lattice(128.0, 200, 0.0);
        dropped.remove(90);

        assert_eq!(half_beat_slides(&rounded(&steady)), 0);
        assert_eq!(half_beat_slides(&rounded(&change)), 0);
        assert_eq!(half_beat_slides(&rounded(&dropped)), 0);
    }

    #[test]
    fn grid_beats_cover_the_requested_span_on_the_lattice() {
        let grid = ConstantGrid {
            bpm: 120.0,
            period_ms: 500.0,
            anchor_ms: 1_250.0,
            phase_support: 1.0,
            phase_flipped: false,
        };

        assert_eq!(grid.beats_ms(-300.0, 1_900.0), vec![250, 750, 1_250, 1_750]);
        assert_eq!(grid.beat_near_ms(2_010.0), 2_250.0);
    }

    #[test]
    fn too_few_beats_fit_nothing() {
        let beats = rounded(&lattice(120.0, MIN_BEATS - 1, 0.0));

        assert_eq!(
            fit_tempo(&beats, &features(20_000.0, &[], &[]), SAMPLE_RATE),
            None
        );
    }
}
