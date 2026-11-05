#![cfg(feature = "analysis")]
//! Phrase segmentation and per-bar energy (Smart Mix 3, SM3-D2), mirroring
//! `app/tests/test_smart_mix_structure.py` and its shared fixture.

use std::fs;
use std::path::PathBuf;

use crate_cli::analyze::{
    analyze_smart_mix_samples, analyze_smart_mix_segments, analyze_smart_mix_segments_with_beats,
    rms_frame_geometry, AudioTail,
};
use crate_cli::beat_tracking::{mfcc, ExternalBeats};
use crate_cli::mix_profile::SmartMixProfileResult;
use crate_cli::structure::{
    downbeats_from_anchor, segment_bars, segment_phrases, Bar, BarFeatures, EnergyFrames,
    Structure, MAX_ENERGY_CURVE_BARS, MAX_PHRASES, MFCC_COEFFICIENTS,
};
use serde::Deserialize;

const SAMPLE_RATE: u32 = 11_025;
const BEAT_MS: u64 = 500;
const BAR_MS: u64 = 4 * BEAT_MS;
const FIRST_BEAT_MS: u64 = 1_000;
const BAND_HOP: usize = 256;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    sample_rate: u32,
    band_hop: usize,
    first_beat_ms: u64,
    beat_ms: u64,
    cases: Vec<FixtureCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    name: String,
    bar_db: Vec<f64>,
    bar_bands: Option<Vec<[f64; 3]>>,
    #[serde(default = "trusted")]
    grid_trusted: bool,
    expected: Expected,
}

fn trusted() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    phrases: Vec<ExpectedPhrase>,
    energy_curve: Option<Vec<u8>>,
    structure_confidence: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedPhrase {
    start_beat: u64,
    start_ms: u64,
    bars: u32,
    energy: f64,
    delta_energy: Option<f64>,
    kind: String,
}

fn fixture() -> Fixture {
    load_cases(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../app/tests/fixtures/smart_mix/structure_v1.json"),
    )
}

fn load_cases(path: &std::path::Path) -> Fixture {
    serde_json::from_str(&fs::read_to_string(path).expect("cases must exist"))
        .expect("cases must be valid JSON")
}

/// Replays bar-level cases and lists every disagreement with the Python reference:
/// phrases exactly, energies within 1e-3, curve bytes within 1 and confidence within
/// 1e-3.
fn replay(fixture: &Fixture) -> Vec<String> {
    assert_eq!(fixture.sample_rate, SAMPLE_RATE);
    assert_eq!(fixture.band_hop, BAND_HOP);
    assert_eq!(fixture.first_beat_ms, FIRST_BEAT_MS);
    assert_eq!(fixture.beat_ms, BEAT_MS);
    let mut mismatches = Vec::new();
    for case in &fixture.cases {
        let inputs = bar_inputs(&case.bar_db, case.bar_bands.as_deref());
        let structure = segment(&inputs, &inputs.beats, &inputs.downbeats, case.grid_trusted);
        let expected = &case.expected;
        let curve_matches = match (&structure.energy_curve, &expected.energy_curve) {
            (None, None) => true,
            (Some(curve), Some(wanted)) => {
                curve.len() == wanted.len()
                    && curve
                        .iter()
                        .zip(wanted)
                        .all(|(byte, wanted)| byte.abs_diff(*wanted) <= 1)
            }
            _ => false,
        };
        if !curve_matches {
            mismatches.push(format!("{}: energy curve", case.name));
        }
        let layout: Vec<(u64, u64, u32, &str)> = structure
            .phrases
            .iter()
            .map(|phrase| (phrase.start_beat, phrase.start_ms, phrase.bars, phrase.kind))
            .collect();
        let wanted_layout: Vec<(u64, u64, u32, &str)> = expected
            .phrases
            .iter()
            .map(|phrase| {
                (
                    phrase.start_beat,
                    phrase.start_ms,
                    phrase.bars,
                    phrase.kind.as_str(),
                )
            })
            .collect();
        if layout != wanted_layout {
            mismatches.push(format!(
                "{}: phrases {layout:?} vs {wanted_layout:?}",
                case.name
            ));
        }
        for (phrase, wanted) in structure.phrases.iter().zip(&expected.phrases) {
            let delta_matches = match (phrase.delta_energy, wanted.delta_energy) {
                (None, None) => true,
                (Some(delta), Some(wanted)) => (f64::from(delta) - wanted).abs() <= 2e-3,
                _ => false,
            };
            if (f64::from(phrase.energy) - wanted.energy).abs() > 1e-3 || !delta_matches {
                mismatches.push(format!("{}: phrase energy", case.name));
            }
        }
        let confidence = f64::from(structure.structure_confidence);
        if (confidence - expected.structure_confidence).abs() > 1e-3 {
            mismatches.push(format!(
                "{}: confidence {confidence} vs {}",
                case.name, expected.structure_confidence
            ));
        }
    }
    mismatches
}

struct BarInputs {
    beats: Vec<u64>,
    downbeats: Vec<u64>,
    rms: Vec<f32>,
    bands: Vec<[f32; 3]>,
}

/// Same construction as `_bar_level_inputs` in the Python tests: frames take the
/// level of the bar their centre falls in; outside the bars the RMS is -90 dBFS and
/// the bands -80 dB (zero bands without band levels).
fn bar_inputs(bar_db: &[f64], bar_bands: Option<&[[f64; 3]]>) -> BarInputs {
    let bars = bar_db.len() as u64;
    let beats: Vec<u64> = (0..4 * bars)
        .map(|index| FIRST_BEAT_MS + index * BEAT_MS)
        .collect();
    let downbeats = beats.iter().step_by(4).copied().collect();
    let total_samples =
        ((FIRST_BEAT_MS + bars * BAR_MS + 1_000) * u64::from(SAMPLE_RATE) / 1_000) as usize;
    let bar_of = |centre_ms: f64| {
        let bar = ((centre_ms - FIRST_BEAT_MS as f64) / BAR_MS as f64).floor();
        (bar >= 0.0 && bar < bars as f64).then_some(bar as usize)
    };
    let (frame_length, hop) = rms_frame_geometry(SAMPLE_RATE);
    let rms = (0..=(total_samples - frame_length) / hop)
        .map(|frame| {
            let centre = (frame * hop) as f64 + frame_length as f64 / 2.0;
            let level =
                bar_of(centre * 1_000.0 / f64::from(SAMPLE_RATE)).map_or(-90.0, |bar| bar_db[bar]);
            10.0_f64.powf(level / 20.0) as f32
        })
        .collect();
    let bands = (0..1 + total_samples / BAND_HOP)
        .map(|frame| {
            let centre_ms = (frame * BAND_HOP) as f64 * 1_000.0 / f64::from(SAMPLE_RATE);
            match bar_bands {
                None => [0.0; 3],
                Some(levels) => bar_of(centre_ms)
                    .map_or([-80.0; 3], |bar| levels[bar].map(|level| level as f32)),
            }
        })
        .collect();
    BarInputs {
        beats,
        downbeats,
        rms,
        bands,
    }
}

fn segment(inputs: &BarInputs, beats: &[u64], downbeats: &[u64], grid_trusted: bool) -> Structure {
    let (frame_length, hop) = rms_frame_geometry(SAMPLE_RATE);
    let frames = EnergyFrames {
        rms: &inputs.rms,
        rms_frame_length: frame_length,
        rms_hop: hop,
        bands_db: &inputs.bands,
        band_hop: BAND_HOP,
        chroma: &[],
        mfcc: &[],
    };
    segment_phrases(beats, downbeats, &frames, SAMPLE_RATE, grid_trusted)
}

fn segment_levels(bar_db: &[f64]) -> Structure {
    let inputs = bar_inputs(bar_db, None);
    segment(&inputs, &inputs.beats, &inputs.downbeats, true)
}

fn layout(structure: &Structure) -> Vec<(u64, &'static str)> {
    structure
        .phrases
        .iter()
        .map(|phrase| (phrase.start_beat / 4, phrase.kind))
        .collect()
}

/// The DJ layout of the shared fixture, bar by bar: intro, build, peak, break, peak, outro.
fn dj_bar_db() -> Vec<f64> {
    let mut levels = vec![-28.0; 16];
    levels.extend((0..8).map(|bar| (100.0 * (-28.0 + 9.7 * f64::from(bar) / 7.0)).round() / 100.0));
    levels.extend([-12.0; 16]);
    levels.extend([-27.0; 8]);
    levels.extend([-12.0; 8]);
    levels.extend([-26.3; 8]);
    levels
}

fn dj_layout() -> Vec<(u64, &'static str)> {
    [0, 16, 24, 40, 48, 56].into_iter().zip(DJ_KINDS).collect()
}

fn blocks(lengths: &[usize]) -> Vec<f64> {
    lengths
        .iter()
        .enumerate()
        .flat_map(|(index, length)| {
            std::iter::repeat_n(if index % 2 == 0 { -24.0 } else { -12.0 }, *length)
        })
        .collect()
}

struct Section {
    bars: usize,
    level: f64,
    end_level: f64,
}

const fn steady(bars: usize, level: f64) -> Section {
    Section {
        bars,
        level,
        end_level: level,
    }
}

const DJ_SECTIONS: [Section; 6] = [
    steady(16, 0.015),
    Section {
        bars: 8,
        level: 0.015,
        end_level: 0.08,
    },
    steady(16, 0.15),
    steady(8, 0.02),
    steady(8, 0.15),
    steady(8, 0.03),
];
const DJ_KINDS: [&str; 6] = ["intro", "build", "peak", "break", "peak", "outro"];

/// Same audio as `structured_audio` in `app/tests/smart_mix_structure_audio.py`.
fn structured_audio(sections: &[Section], beats_per_bar: usize) -> Vec<f32> {
    let rate = f64::from(SAMPLE_RATE);
    let beat_seconds = 0.5;
    let total_beats: usize =
        sections.iter().map(|section| section.bars).sum::<usize>() * beats_per_bar;
    let duration = 1.0 + total_beats as f64 * beat_seconds + 1.0;
    let count = (duration * rate).round() as usize;
    let mut envelope = vec![0.0_f64; count];
    let mut position = 1.0;
    for section in sections {
        let start = (position * rate).round() as usize;
        let seconds = (section.bars * beats_per_bar) as f64 * beat_seconds;
        let end = (((position + seconds) * rate).round() as usize).min(count);
        let length = end - start;
        for offset in 0..length {
            let progress = if length > 1 {
                offset as f64 / (length - 1) as f64
            } else {
                0.0
            };
            envelope[start + offset] =
                section.level + (section.end_level - section.level) * progress;
        }
        position += seconds;
    }
    let mut audio: Vec<f64> = (0..count)
        .map(|index| {
            let time = index as f64 / rate;
            let chord: f64 = [220.0, 261.6256, 329.6276]
                .iter()
                .map(|frequency| (2.0 * std::f64::consts::PI * frequency * time).sin())
                .sum();
            envelope[index] * chord
        })
        .collect();
    let pulse_length = (0.025 * rate).round() as usize;
    for beat in 0..total_beats {
        let start = ((1.0 + beat as f64 * beat_seconds) * rate).round() as usize;
        let level = if beat % beats_per_bar == 0 { 0.5 } else { 0.2 };
        for offset in 0..pulse_length.min(count - start) {
            audio[start + offset] +=
                level * (-7.0 * offset as f64 / (pulse_length - 1) as f64).exp();
        }
    }
    audio.into_iter().map(|sample| sample as f32).collect()
}

fn dj_profile() -> SmartMixProfileResult {
    analyze_smart_mix_samples(&structured_audio(&DJ_SECTIONS, 4), SAMPLE_RATE)
}

fn profile_downbeats(profile: &SmartMixProfileResult) -> Vec<u64> {
    downbeats_from_anchor(&profile.beat_grid_ms, profile.downbeat_anchor_ms)
}

/// Beat This! beats on every beat of `structured_audio`, with a downbeat on the first
/// beat of each bar of `beats_per_bar` beats.
fn model_bars(beats_per_bar: usize) -> ExternalBeats {
    let bars: usize = DJ_SECTIONS.iter().map(|section| section.bars).sum();
    let beats_ms: Vec<u64> = (0..(bars * beats_per_bar) as u64)
        .map(|beat| FIRST_BEAT_MS + beat * BEAT_MS)
        .collect();
    ExternalBeats {
        tracker: Some("beat-this-test".to_string()),
        downbeats_ms: beats_ms.iter().step_by(beats_per_bar).copied().collect(),
        beats_ms,
        beats_per_bar: Some(beats_per_bar as u8),
    }
}

fn model_profile(beats_per_bar: usize) -> SmartMixProfileResult {
    analyze_smart_mix_segments_with_beats(
        &structured_audio(&DJ_SECTIONS, beats_per_bar),
        None,
        SAMPLE_RATE,
        None,
        None,
        Some(&model_bars(beats_per_bar)),
    )
}

#[test]
fn three_four_meter_gets_no_phrases() {
    // Phrases and their consumers count bars of four beats: a track the DBN hears in
    // 3/4 says so and gets no downbeat and no phrases, so it goes to crossfade
    // (SM3-D16).
    let in_four = model_profile(4);
    let in_three = model_profile(3);

    assert_eq!(in_four.time_signature, Some(4));
    assert_eq!(in_four.downbeat_anchor_ms, Some(FIRST_BEAT_MS));
    assert!(in_four
        .phrases
        .as_ref()
        .is_some_and(|phrases| !phrases.is_empty()));
    assert_eq!(in_three.time_signature, Some(3));
    assert_eq!(in_three.downbeat_anchor_ms, None);
    assert_eq!(in_three.intro_downbeat_ms, None);
    assert_eq!(in_three.outro_downbeat_ms, None);
    assert!(in_three
        .phrases
        .as_ref()
        .is_some_and(|phrases| phrases.is_empty()));
    assert_eq!(in_three.energy_curve, None);
    assert_eq!(in_three.beat_tracker.as_deref(), Some("beat-this-test"));
}

#[test]
fn fixture_cases_match_the_python_reference() {
    let mismatches = replay(&fixture());

    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

/// Replays an external case file in the fixture format, such as fuzz cases generated
/// from the Python reference: `SMART_MIX_STRUCTURE_CASES=<path> cargo test -- --ignored`.
#[test]
#[ignore = "needs SMART_MIX_STRUCTURE_CASES"]
fn external_cases_match_the_python_reference() {
    let path = std::env::var("SMART_MIX_STRUCTURE_CASES").expect("SMART_MIX_STRUCTURE_CASES");
    let fixture = load_cases(std::path::Path::new(&path));
    let mismatches = replay(&fixture);

    eprintln!(
        "{} cases, {} mismatches",
        fixture.cases.len(),
        mismatches.len()
    );
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn segments_on_eight_bar_multiples() {
    let profile = dj_profile();
    let phrases = profile.phrases.expect("structure");

    let expected: Vec<u64> = [0_u64, 16, 24, 40, 48, 56]
        .iter()
        .map(|bar| FIRST_BEAT_MS + bar * BAR_MS)
        .collect();
    assert_eq!(phrases.len(), expected.len());
    for (phrase, target) in phrases.iter().zip(&expected) {
        assert!([8, 16, 32].contains(&phrase.bars));
        assert!(phrase.start_ms.abs_diff(*target) <= BEAT_MS, "{phrase:?}");
        assert_eq!(
            profile.beat_grid_ms[phrase.start_beat as usize],
            phrase.start_ms
        );
    }
    for pair in phrases.windows(2) {
        assert_eq!(
            pair[1].start_beat,
            pair[0].start_beat + 4 * u64::from(pair[0].bars)
        );
    }
}

#[test]
fn detects_break_and_peak_kinds() {
    let profile = dj_profile();
    let phrases = profile.phrases.expect("structure");

    let kinds: Vec<&str> = phrases.iter().map(|phrase| phrase.kind).collect();
    assert_eq!(kinds, DJ_KINDS);
    assert!(profile.structure_confidence.unwrap() >= 0.7);
    assert!(phrases[0].delta_energy.is_none());
    assert!(profile.vocal_presence.is_none());
}

#[test]
fn low_confidence_on_irregular_meter() {
    let sections: Vec<Section> = (0..12)
        .map(|index| steady(5, if index % 2 == 0 { 0.02 } else { 0.15 }))
        .collect();

    let profile = analyze_smart_mix_samples(&structured_audio(&sections, 5), SAMPLE_RATE);

    assert!(profile.structure_confidence.unwrap() < 0.4);
}

#[test]
fn low_confidence_on_irregular_phrase_lengths() {
    let irregular = segment_levels(&blocks(&[5; 16]));
    let regular = segment_levels(&blocks(&[16, 8, 16, 8, 16, 16]));

    assert!(irregular.structure_confidence < 0.4);
    assert!(regular.structure_confidence > 0.7);
    let starts: Vec<u64> = regular
        .phrases
        .iter()
        .map(|phrase| phrase.start_beat / 4)
        .collect();
    assert_eq!(starts, [0, 16, 24, 40, 48, 64]);
}

#[test]
fn energy_curve_one_byte_per_bar() {
    let profile = dj_profile();
    let curve = profile.energy_curve.clone().expect("curve");
    let downbeats = profile_downbeats(&profile);

    assert_eq!(curve.len(), downbeats.len());
    let first_bar = ((downbeats[0] as f64 - FIRST_BEAT_MS as f64) / BAR_MS as f64).round() as usize;
    let peak: Vec<u8> = (26..38).map(|bar| curve[bar - first_bar]).collect();
    let intro: Vec<u8> = (2..14).map(|bar| curve[bar - first_bar]).collect();
    let build: Vec<u8> = (16..24).map(|bar| curve[bar - first_bar]).collect();
    assert!(
        peak.iter().all(|value| value.abs_diff(193) <= 3),
        "{peak:?}"
    );
    assert!(*intro.iter().max().unwrap() as u32 + 40 < *peak.iter().min().unwrap() as u32);
    assert!(build.windows(2).all(|pair| pair[0] <= pair[1]), "{build:?}");

    let levels = [-60.0, -45.5, -30.2, -12.25, -3.0, 0.0].repeat(4);
    let exact = segment_levels(&levels);
    let expected: Vec<u8> = levels
        .iter()
        .map(|level| (255.0 * (level + 60.0) / 60.0 + 0.5) as u8)
        .collect();
    assert_eq!(exact.energy_curve, Some(expected));
}

#[test]
fn caps_phrase_count() {
    let levels: Vec<f64> = (0..263_u32)
        .flat_map(|block| std::iter::repeat_n(-12.0 - f64::from(block * 7 % 13), 8))
        .collect();

    let structure = segment_levels(&levels);

    assert_eq!(structure.energy_curve.unwrap().len(), MAX_ENERGY_CURVE_BARS);
    // Every boundary differs, so the cost search can stop just under the cap.
    assert!((MAX_PHRASES - 10..=MAX_PHRASES).contains(&structure.phrases.len()));
    assert!(structure
        .phrases
        .iter()
        .all(|phrase| [8, 16, 32].contains(&phrase.bars)));
}

#[test]
fn steady_groove_is_body_between_intro_and_outro() {
    let mut levels = vec![-20.0; 16];
    levels.extend([-12.0, -12.4, -11.8, -12.2].repeat(24));
    levels.extend(vec![-19.0; 16]);

    let structure = segment_levels(&levels);

    let kinds: Vec<&str> = structure.phrases.iter().map(|phrase| phrase.kind).collect();
    assert_eq!(kinds.first(), Some(&"intro"));
    assert_eq!(kinds.last(), Some(&"outro"));
    assert!(kinds[1..kinds.len() - 1].iter().all(|kind| *kind == "body"));
}

#[test]
fn bar_energy_ignores_grid_offsets_up_to_the_edge_guard() {
    let inputs = bar_inputs(&blocks(&[16, 8, 16, 8, 16, 16]), None);
    let late: Vec<u64> = inputs.beats.iter().map(|beat| beat + 30).collect();
    let late_downbeats: Vec<u64> = late.iter().step_by(4).copied().collect();

    let on_grid = segment(&inputs, &inputs.beats, &inputs.downbeats, true);
    let shifted = segment(&inputs, &late, &late_downbeats, true);

    assert_eq!(shifted.energy_curve, on_grid.energy_curve);
    let kinds = |structure: &Structure| -> Vec<&'static str> {
        structure.phrases.iter().map(|phrase| phrase.kind).collect()
    };
    assert_eq!(kinds(&shifted), kinds(&on_grid));
}

#[test]
fn segment_phrases_without_downbeats_has_no_structure() {
    let inputs = bar_inputs(&blocks(&[16, 16]), None);

    let structure = segment(&inputs, &inputs.beats, &[], true);

    assert!(structure.phrases.is_empty());
    assert!(structure.energy_curve.is_none());
    assert_eq!(structure.structure_confidence, 0.0);
}

#[test]
fn downbeats_follow_the_anchor_phase() {
    let grid: Vec<u64> = (1..12).map(|beat| beat * 500).collect();

    assert_eq!(
        downbeats_from_anchor(&grid, Some(3_000)),
        [1_000, 3_000, 5_000]
    );
    assert!(downbeats_from_anchor(&grid, None).is_empty());
    assert!(downbeats_from_anchor(&grid, Some(3_100)).is_empty());
}

#[test]
fn profile_serializes_the_structure_for_the_python_reader() {
    let payload = serde_json::to_value(dj_profile()).unwrap();

    assert_eq!(payload["phrases"][0]["kind"], "intro");
    assert_eq!(payload["phrases"][0]["startBeat"], 0);
    assert!(payload["phrases"][0]["deltaEnergy"].is_null());
    assert!(payload["phrases"][1]["deltaEnergy"].is_number());
    assert!(payload["energyCurve"]
        .as_array()
        .is_some_and(|curve| !curve.is_empty()));
    assert!(payload["vocalPresence"].is_null());
    assert!(payload["structureConfidence"].is_number());
    let unavailable = serde_json::to_value(SmartMixProfileResult::unavailable(1_000)).unwrap();
    assert!(unavailable["phrases"].is_null());
    assert!(unavailable["energyCurve"].is_null());
    assert!(unavailable["structureConfidence"].is_null());
}

#[test]
fn silent_bar_at_the_end_of_each_peak_keeps_the_boundaries() {
    let mut levels = dj_bar_db();
    levels[39] = -60.0;
    levels[55] = -60.0;

    assert_eq!(layout(&segment_levels(&levels)), dj_layout());
}

#[test]
fn silent_bar_before_the_drop_keeps_the_build() {
    let mut levels = dj_bar_db();
    levels[23] = -60.0;

    assert_eq!(layout(&segment_levels(&levels)), dj_layout());
}

#[test]
fn gap_bars_inside_steady_music_leave_it_body() {
    let one_gap = [vec![-8.0; 7], vec![-60.0]].concat();
    let two_gaps = [vec![-8.0; 6], vec![-60.0; 2]].concat();
    let half = [one_gap.repeat(4), two_gaps.repeat(4)].concat();

    let structure = segment_levels(&half.repeat(2));

    assert!(!structure.phrases.is_empty());
    assert!(structure.phrases.iter().all(|phrase| phrase.kind == "body"));
}

#[test]
fn phrases_cover_the_bars_cue_detection_counts_as_music() {
    let fade: Vec<f64> = (0..24)
        .map(|bar| (100.0 * (-8.0 - 41.0 * f64::from(bar) / 23.0)).round() / 100.0)
        .collect();
    let active_bars = 32 + fade.iter().filter(|level| **level >= -43.0).count() as u64;
    let loud = segment_levels(&[vec![-8.0; 32], fade, vec![-70.0; 4]].concat());
    let last = loud.phrases.last().unwrap();
    assert!(last.start_beat / 4 + u64::from(last.bars) <= active_bars);
    assert_eq!(loud.phrases[0].start_beat, 0);

    let quiet = segment_levels(&[vec![-53.0; 8], vec![-22.0; 32], vec![-53.0; 8]].concat());
    let last = quiet.phrases.last().unwrap();
    assert_eq!(quiet.phrases[0].start_beat, 0);
    assert_eq!(last.start_beat / 4 + u64::from(last.bars), 48);
}

#[test]
fn doubtful_grid_halves_the_confidence() {
    let inputs = bar_inputs(&dj_bar_db(), None);

    let trusted = segment(&inputs, &inputs.beats, &inputs.downbeats, true);
    let doubtful = segment(&inputs, &inputs.beats, &inputs.downbeats, false);

    assert_eq!(layout(&doubtful), layout(&trusted));
    assert!((doubtful.structure_confidence - 0.5 * trusted.structure_confidence).abs() <= 1e-4);
}

#[test]
fn corrupt_frames_do_not_poison_the_rest_of_the_track() {
    let levels = dj_bar_db();
    let bands = vec![[-20.0, -30.0, -40.0]; levels.len()];
    let clean_inputs = bar_inputs(&levels, Some(&bands));
    let mut dirty_inputs = bar_inputs(&levels, Some(&bands));
    dirty_inputs.rms[200] = f32::NAN;
    dirty_inputs.rms[900] = f32::INFINITY;
    dirty_inputs.bands[300][1] = f32::NAN;
    dirty_inputs.bands[1_500][0] = f32::NEG_INFINITY;

    let clean = segment(
        &clean_inputs,
        &clean_inputs.beats,
        &clean_inputs.downbeats,
        true,
    );
    let dirty = segment(
        &dirty_inputs,
        &dirty_inputs.beats,
        &dirty_inputs.downbeats,
        true,
    );

    assert_eq!(layout(&dirty), layout(&clean));
    let (clean_curve, dirty_curve) = (clean.energy_curve.unwrap(), dirty.energy_curve.unwrap());
    assert_eq!(dirty_curve.len(), clean_curve.len());
    assert!(dirty_curve
        .iter()
        .zip(&clean_curve)
        .all(|(dirty, clean)| dirty.abs_diff(*clean) <= 1));
    assert!(dirty.structure_confidence.is_finite());
}

#[test]
fn truncated_analysis_has_no_structure() {
    let samples = structured_audio(&DJ_SECTIONS, 4);
    let head = &samples[..40 * SAMPLE_RATE as usize];
    let tail_start = samples.len() - 20 * SAMPLE_RATE as usize;

    let profile = analyze_smart_mix_segments(
        head,
        Some(AudioTail {
            samples: &samples[tail_start..],
            start_ms: tail_start as u64 * 1_000 / u64::from(SAMPLE_RATE),
        }),
        SAMPLE_RATE,
        Some(samples.len() as u64 * 1_000 / u64::from(SAMPLE_RATE)),
        None,
    );

    assert_eq!(profile.quality, "partial");
    assert_eq!(profile.phrases, Some(Vec::new()));
    assert_eq!(profile.energy_curve, None);
    assert_eq!(profile.structure_confidence, Some(0.0));
}

#[test]
fn rms_frame_geometry_uses_whole_samples() {
    assert_eq!(rms_frame_geometry(22_050), (1_102, 551));
    assert_eq!(rms_frame_geometry(11_025), (551, 275));
    assert_eq!(rms_frame_geometry(8_000), (400, 200));
    assert_eq!(rms_frame_geometry(4_000), (256, 128));
}

// Harmony and timbre novelty (SM3-D17), mirroring the Python tests and the per-bar
// fixture structure_v2.json.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureFixture {
    mfcc_reference: MfccReference,
    cases: Vec<FeatureCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MfccReference {
    mel_db: Vec<f32>,
    mfcc: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureCase {
    name: String,
    bars: Vec<[u64; 3]>,
    levels: Vec<f64>,
    shapes: Vec<[f64; 3]>,
    music: Vec<bool>,
    chroma: Vec<[f64; 12]>,
    mfcc: Vec<[f64; MFCC_COEFFICIENTS]>,
    grid_trusted: bool,
    expected: FeatureExpected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureExpected {
    phrases: Vec<ExpectedPhrase>,
    structure_confidence: f64,
}

fn feature_fixture() -> FeatureFixture {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/tests/fixtures/smart_mix/structure_v2.json");
    serde_json::from_str(&fs::read_to_string(path).expect("cases must exist"))
        .expect("cases must be valid JSON")
}

/// Bars of a steady 120 BPM grid from `FIRST_BEAT_MS`.
fn steady_bars(count: usize) -> Vec<Bar> {
    (0..count as u64)
        .map(|bar| Bar {
            start_beat: 4 * bar,
            start_ms: FIRST_BEAT_MS + bar * BAR_MS,
            end_ms: FIRST_BEAT_MS + (bar + 1) * BAR_MS,
        })
        .collect()
}

fn one_hot(pitch_class: usize) -> [f64; 12] {
    std::array::from_fn(|index| if index == pitch_class { 1.0 } else { 0.0 })
}

fn phrase_start_bars(
    shapes: &[[f64; 3]],
    chroma: &[[f64; 12]],
    mfcc: &[[f64; MFCC_COEFFICIENTS]],
) -> Vec<u64> {
    let features = BarFeatures {
        levels: vec![-12.0; shapes.len()],
        shapes: shapes.to_vec(),
        music: vec![true; shapes.len()],
        chroma: chroma.to_vec(),
        mfcc: mfcc.to_vec(),
    };
    segment_bars(&steady_bars(shapes.len()), &features, true)
        .phrases
        .iter()
        .map(|phrase| phrase.start_beat / 4)
        .collect()
}

#[test]
fn structure_v2_fixture_matches() {
    let fixture = feature_fixture();
    let mut mismatches = Vec::new();
    for case in &fixture.cases {
        let bars: Vec<Bar> = case
            .bars
            .iter()
            .map(|&[start_beat, start_ms, end_ms]| Bar {
                start_beat,
                start_ms,
                end_ms,
            })
            .collect();
        let features = BarFeatures {
            levels: case.levels.clone(),
            shapes: case.shapes.clone(),
            music: case.music.clone(),
            chroma: case.chroma.clone(),
            mfcc: case.mfcc.clone(),
        };
        let structure = segment_bars(&bars, &features, case.grid_trusted);
        let layout: Vec<(u64, u64, u32, &str)> = structure
            .phrases
            .iter()
            .map(|phrase| (phrase.start_beat, phrase.start_ms, phrase.bars, phrase.kind))
            .collect();
        let wanted: Vec<(u64, u64, u32, &str)> = case
            .expected
            .phrases
            .iter()
            .map(|phrase| {
                (
                    phrase.start_beat,
                    phrase.start_ms,
                    phrase.bars,
                    phrase.kind.as_str(),
                )
            })
            .collect();
        if layout != wanted {
            mismatches.push(format!("{}: phrases {layout:?} vs {wanted:?}", case.name));
        }
        for (phrase, wanted) in structure.phrases.iter().zip(&case.expected.phrases) {
            let delta_matches = match (phrase.delta_energy, wanted.delta_energy) {
                (None, None) => true,
                (Some(delta), Some(wanted)) => (f64::from(delta) - wanted).abs() <= 1e-4,
                _ => false,
            };
            if (f64::from(phrase.energy) - wanted.energy).abs() > 1e-4 || !delta_matches {
                mismatches.push(format!("{}: phrase energy", case.name));
            }
        }
        let confidence = f64::from(structure.structure_confidence);
        if (confidence - case.expected.structure_confidence).abs() > 1e-4 {
            mismatches.push(format!("{}: confidence {confidence}", case.name));
        }
    }

    assert!(fixture.cases.len() >= 4);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn harmony_change_is_a_boundary() {
    // Harmony adds at most 2 dB, under the 4 dB boundary cost: a chord change from C to
    // F# at bar 16 splits a section whose band balance shifts by 2.5 dB of v7 novelty,
    // which alone does not. Same case as the Python test.
    let shapes: Vec<[f64; 3]> = [[1.5, 0.0, -1.5]; 16]
        .into_iter()
        .chain([[-1.5, 0.0, 1.5]; 16])
        .collect();
    let mut timbre = [10.0; MFCC_COEFFICIENTS];
    timbre[0] = -120.0;
    timbre[1] = 80.0;
    let mfcc = vec![timbre; 32];
    let chord_change: Vec<[f64; 12]> = [one_hot(0); 16]
        .into_iter()
        .chain([one_hot(6); 16])
        .collect();
    let same_chord = vec![one_hot(0); 32];

    assert!(phrase_start_bars(&shapes, &chord_change, &mfcc).contains(&16));
    assert!(!phrase_start_bars(&shapes, &same_chord, &mfcc).contains(&16));
}

#[test]
fn mfcc_matches_orthonormal_dct() {
    let reference = feature_fixture().mfcc_reference;

    let coefficients = mfcc(&reference.mel_db);

    assert_eq!(reference.mfcc.len(), MFCC_COEFFICIENTS);
    for (index, (value, wanted)) in coefficients.iter().zip(&reference.mfcc).enumerate() {
        assert!(
            (f64::from(*value) - wanted).abs() <= 1e-3,
            "coefficient {index}: {value} vs {wanted}"
        );
    }
}
