#![cfg(feature = "analysis")]
//! Phrase segmentation and per-bar energy (Smart Mix 3, SM3-D2), mirroring
//! `app/tests/test_smart_mix_structure.py` and its shared fixture.

use std::fs;
use std::path::PathBuf;

use crate_cli::analyze::{analyze_smart_mix_samples, rms_frame_geometry};
use crate_cli::mix_profile::SmartMixProfileResult;
use crate_cli::structure::{
    downbeats_from_anchor, segment_phrases, EnergyFrames, Structure, MAX_ENERGY_CURVE_BARS,
    MAX_PHRASES,
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
    expected: Expected,
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
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/tests/fixtures/smart_mix/structure_v1.json");
    serde_json::from_str(&fs::read_to_string(path).expect("fixture must exist"))
        .expect("fixture must be valid JSON")
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

fn segment(inputs: &BarInputs, beats: &[u64], downbeats: &[u64]) -> Structure {
    let (frame_length, hop) = rms_frame_geometry(SAMPLE_RATE);
    let frames = EnergyFrames {
        rms: &inputs.rms,
        rms_frame_length: frame_length,
        rms_hop: hop,
        bands_db: &inputs.bands,
        band_hop: BAND_HOP,
    };
    segment_phrases(beats, downbeats, &frames, SAMPLE_RATE)
}

fn segment_levels(bar_db: &[f64]) -> Structure {
    let inputs = bar_inputs(bar_db, None);
    segment(&inputs, &inputs.beats, &inputs.downbeats)
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

#[test]
fn fixture_cases_match_the_python_reference() {
    let fixture = fixture();
    assert_eq!(fixture.sample_rate, SAMPLE_RATE);
    assert_eq!(fixture.band_hop, BAND_HOP);
    assert_eq!(fixture.first_beat_ms, FIRST_BEAT_MS);
    assert_eq!(fixture.beat_ms, BEAT_MS);
    for case in &fixture.cases {
        let inputs = bar_inputs(&case.bar_db, case.bar_bands.as_deref());
        let structure = segment(&inputs, &inputs.beats, &inputs.downbeats);
        let expected = &case.expected;
        assert_eq!(
            structure.energy_curve, expected.energy_curve,
            "{}: energy curve",
            case.name
        );
        assert_eq!(
            structure.phrases.len(),
            expected.phrases.len(),
            "{}: phrase count",
            case.name
        );
        for (phrase, wanted) in structure.phrases.iter().zip(&expected.phrases) {
            assert_eq!(
                (phrase.start_beat, phrase.start_ms, phrase.bars, phrase.kind),
                (
                    wanted.start_beat,
                    wanted.start_ms,
                    wanted.bars,
                    wanted.kind.as_str()
                ),
                "{}",
                case.name
            );
            assert!(
                (f64::from(phrase.energy) - wanted.energy).abs() <= 1e-3,
                "{}",
                case.name
            );
            match (phrase.delta_energy, wanted.delta_energy) {
                (None, None) => {}
                (Some(delta), Some(wanted)) => {
                    assert!((f64::from(delta) - wanted).abs() <= 2e-3, "{}", case.name)
                }
                other => panic!("{}: delta energy {other:?}", case.name),
            }
        }
        assert!(
            (f64::from(structure.structure_confidence) - expected.structure_confidence).abs()
                <= 1e-3,
            "{}: confidence {} vs {}",
            case.name,
            structure.structure_confidence,
            expected.structure_confidence
        );
    }
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
    let structure = segment_levels(&blocks(&[8; 263]));

    assert_eq!(structure.energy_curve.unwrap().len(), MAX_ENERGY_CURVE_BARS);
    assert!((64..=MAX_PHRASES).contains(&structure.phrases.len()));
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

    let on_grid = segment(&inputs, &inputs.beats, &inputs.downbeats);
    let shifted = segment(&inputs, &late, &late_downbeats);

    assert_eq!(shifted.energy_curve, on_grid.energy_curve);
    let kinds = |structure: &Structure| -> Vec<&'static str> {
        structure.phrases.iter().map(|phrase| phrase.kind).collect()
    };
    assert_eq!(kinds(&shifted), kinds(&on_grid));
}

#[test]
fn segment_phrases_without_downbeats_has_no_structure() {
    let inputs = bar_inputs(&blocks(&[16, 16]), None);

    let structure = segment(&inputs, &inputs.beats, &[]);

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
