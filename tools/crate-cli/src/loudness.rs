use ebur128::{EbuR128, Mode};

pub const MEASUREMENT_VERSION: &str = "bs1770-v1";
pub const BLOCK_HOP_MS: u64 = 100;
const BLOCK_LENGTH_MS: u64 = 400;
const MAX_SUPPORTED_CHANNELS: usize = 6;
const ABSOLUTE_GATE_LUFS: f64 = -70.0;
const RELATIVE_GATE_LU: f64 = -10.0;

#[derive(Debug, Clone, PartialEq)]
pub struct LoudnessSummary {
    pub integrated_lufs: Option<f64>,
    pub true_peak_dbfs: Option<f64>,
    pub momentary_lufs: Vec<f64>,
}

impl LoudnessSummary {
    pub fn window_lufs(&self, start_ms: u64, end_ms: u64) -> Option<f64> {
        let blocks: Vec<f64> = self
            .momentary_lufs
            .iter()
            .enumerate()
            .filter_map(|(index, loudness)| {
                let block_end_ms = (index as u64 + 1) * BLOCK_HOP_MS;
                let block_start_ms = block_end_ms.checked_sub(BLOCK_LENGTH_MS)?;
                (block_start_ms >= start_ms && block_end_ms <= end_ms).then_some(*loudness)
            })
            .collect();
        gated_loudness(&blocks)
    }
}

pub struct LoudnessMeter {
    meter: EbuR128,
    channels: usize,
    frames_per_block: usize,
    pending_frames: usize,
    measured_frames: usize,
    block_length_frames: usize,
    momentary_lufs: Vec<f64>,
}

impl LoudnessMeter {
    pub fn new(channels: usize, sample_rate: u32) -> Option<Self> {
        if channels == 0 || channels > MAX_SUPPORTED_CHANNELS || sample_rate == 0 {
            return None;
        }
        let meter = EbuR128::new(channels as u32, sample_rate, Mode::I | Mode::TRUE_PEAK).ok()?;
        let frames_per_block = (u64::from(sample_rate) * BLOCK_HOP_MS / 1_000).max(1) as usize;
        Some(Self {
            meter,
            channels,
            frames_per_block,
            pending_frames: 0,
            measured_frames: 0,
            block_length_frames: frames_per_block * (BLOCK_LENGTH_MS / BLOCK_HOP_MS) as usize,
            momentary_lufs: Vec::new(),
        })
    }

    pub fn push_interleaved(&mut self, samples: &[f32]) -> Result<(), String> {
        let mut remaining = samples;
        while !remaining.is_empty() {
            let frames_to_block = self.frames_per_block - self.pending_frames;
            let available_frames = remaining.len() / self.channels;
            if available_frames == 0 {
                break;
            }
            let frames = frames_to_block.min(available_frames);
            let (chunk, rest) = remaining.split_at(frames * self.channels);
            self.meter
                .add_frames_f32(chunk)
                .map_err(|error| format!("loudness: {error}"))?;
            self.pending_frames += frames;
            self.measured_frames += frames;
            if self.pending_frames == self.frames_per_block {
                self.pending_frames = 0;
                self.momentary_lufs
                    .push(if self.measured_frames >= self.block_length_frames {
                        self.meter.loudness_momentary().unwrap_or(f64::NEG_INFINITY)
                    } else {
                        f64::NEG_INFINITY
                    });
            }
            remaining = rest;
        }
        Ok(())
    }

    pub fn finish(self) -> LoudnessSummary {
        let true_peak = (0..self.channels as u32)
            .filter_map(|channel| self.meter.true_peak(channel).ok())
            .fold(0.0_f64, f64::max);
        LoudnessSummary {
            integrated_lufs: self
                .meter
                .loudness_global()
                .ok()
                .filter(|value| value.is_finite()),
            true_peak_dbfs: (true_peak > 0.0).then(|| 20.0 * true_peak.log10()),
            momentary_lufs: self.momentary_lufs,
        }
    }
}

fn gated_loudness(blocks: &[f64]) -> Option<f64> {
    let audible: Vec<f64> = blocks
        .iter()
        .copied()
        .filter(|loudness| loudness.is_finite() && *loudness > ABSOLUTE_GATE_LUFS)
        .collect();
    let relative_gate = mean_loudness(&audible)? + RELATIVE_GATE_LU;
    let gated: Vec<f64> = audible
        .into_iter()
        .filter(|loudness| *loudness > relative_gate)
        .collect();
    mean_loudness(&gated)
}

fn mean_loudness(blocks: &[f64]) -> Option<f64> {
    if blocks.is_empty() {
        return None;
    }
    let energy = blocks
        .iter()
        .map(|loudness| 10.0_f64.powf(loudness / 10.0))
        .sum::<f64>()
        / blocks.len() as f64;
    Some(10.0 * energy.log10())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine_frames(left: f32, right: f32, frequency: f32, seconds: f32) -> Vec<f32> {
        let frames = (RATE as f32 * seconds) as usize;
        let mut samples = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let value = (2.0 * std::f32::consts::PI * frequency * frame as f32 / RATE as f32).sin();
            samples.push(left * value);
            samples.push(right * value);
        }
        samples
    }

    fn measure(samples: &[f32], channels: usize) -> LoudnessSummary {
        let mut meter = LoudnessMeter::new(channels, RATE).expect("meter");
        for chunk in samples.chunks(4_093 * channels) {
            meter.push_interleaved(chunk).expect("push");
        }
        meter.finish()
    }

    #[test]
    fn stereo_sine_matches_the_bs1770_reference_level() {
        let summary = measure(&sine_frames(0.5, 0.5, 997.0, 20.0), 2);

        let integrated = summary.integrated_lufs.expect("integrated");
        assert!((integrated - (-6.02)).abs() <= 0.1, "{integrated}");
    }

    #[test]
    fn opposite_phase_channels_keep_their_true_peak() {
        let summary = measure(&sine_frames(0.9, -0.8, 997.0, 5.0), 2);

        let peak = summary.true_peak_dbfs.expect("true peak");
        assert!((peak - 20.0 * 0.9_f64.log10()).abs() <= 0.1, "{peak}");
    }

    #[test]
    fn intersample_peak_is_detected() {
        let frames = RATE as usize * 3;
        let mut samples = Vec::with_capacity(frames);
        for frame in 0..frames {
            let phase = std::f32::consts::FRAC_PI_2 * frame as f32 + std::f32::consts::FRAC_PI_4;
            samples.push(phase.sin());
        }
        let sample_peak = samples.iter().copied().map(f32::abs).fold(0.0, f32::max);

        let summary = measure(&samples, 1);

        assert!(20.0 * f64::from(sample_peak).log10() < -2.9);
        let peak = summary.true_peak_dbfs.expect("true peak");
        assert!(peak > -0.5, "{peak}");
    }

    #[test]
    fn silence_has_no_loudness_or_peak() {
        let summary = measure(&vec![0.0; RATE as usize * 4], 2);

        assert_eq!(summary.integrated_lufs, None);
        assert_eq!(summary.true_peak_dbfs, None);
        assert_eq!(summary.window_lufs(0, 4_000), None);
    }

    #[test]
    fn windows_measure_only_their_own_section() {
        let mut samples = sine_frames(0.1, 0.1, 997.0, 10.0);
        samples.extend(sine_frames(0.8, 0.8, 997.0, 10.0));
        let summary = measure(&samples, 2);

        let quiet = summary.window_lufs(1_000, 9_000).expect("quiet window");
        let loud = summary.window_lufs(11_000, 19_000).expect("loud window");
        assert!((loud - quiet - 18.06).abs() <= 0.2, "{quiet} {loud}");
    }

    #[test]
    fn short_windows_have_no_measurement() {
        let summary = measure(&sine_frames(0.5, 0.5, 997.0, 10.0), 2);

        assert_eq!(summary.window_lufs(2_000, 2_300), None);
    }

    #[test]
    fn unsupported_layouts_are_not_measured() {
        assert!(LoudnessMeter::new(8, RATE).is_none());
        assert!(LoudnessMeter::new(0, RATE).is_none());
    }
}
