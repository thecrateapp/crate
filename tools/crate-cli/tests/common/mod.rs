use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn write_le_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn write_le_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn write_wav_header(
    data_len: usize,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let mut header = Vec::new();

    header.extend_from_slice(b"RIFF");
    write_le_u32(&mut header, (36 + data_len) as u32);
    header.extend_from_slice(b"WAVE");

    header.extend_from_slice(b"fmt ");
    write_le_u32(&mut header, 16); // Subchunk1Size
    write_le_u16(&mut header, 1); // AudioFormat (PCM)
    write_le_u16(&mut header, channels);
    write_le_u32(&mut header, sample_rate);
    write_le_u32(&mut header, byte_rate);
    write_le_u16(&mut header, block_align);
    write_le_u16(&mut header, bits_per_sample);

    header.extend_from_slice(b"data");
    write_le_u32(&mut header, data_len as u32);

    header
}

pub fn create_test_wav(
    dir: &TempDir,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
) -> PathBuf {
    create_test_wav_at(dir.path(), filename, frequency, duration_secs)
}

#[allow(dead_code)]
pub fn create_test_wav_with_amplitude(
    dir: &TempDir,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
    amplitude: f32,
) -> PathBuf {
    create_test_wav_at_with_amplitude(dir.path(), filename, frequency, duration_secs, amplitude)
}

pub fn create_test_wav_at(
    dir: &Path,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
) -> PathBuf {
    create_test_wav_at_with_amplitude(dir, filename, frequency, duration_secs, 1.0)
}

pub fn create_test_wav_at_with_amplitude(
    dir: &Path,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
    amplitude: f32,
) -> PathBuf {
    let path = dir.join(filename);
    let sample_rate = 22050;
    let channels = 1;
    let bits_per_sample = 16;
    let num_samples = (sample_rate as f32 * duration_secs) as usize;
    let data_len = num_samples * channels * bits_per_sample as usize / 8;

    let mut header = write_wav_header(data_len, sample_rate, channels as u16, bits_per_sample);
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = (t * frequency * 2.0 * std::f32::consts::PI).sin() * amplitude;
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        header.extend_from_slice(&sample_i16.to_le_bytes());
    }
    std::fs::write(&path, header).unwrap();
    path
}

#[allow(dead_code)]
pub fn create_test_library(dir: &TempDir) -> PathBuf {
    let lib = dir.path().join("library");
    let artist_dir = lib.join("Test Artist");
    let album_dir = artist_dir.join("2024").join("Test Album");
    std::fs::create_dir_all(&album_dir).unwrap();

    create_test_wav_at(&album_dir, "01 - Track One.wav", 440.0, 3.0);
    create_test_wav_at(&album_dir, "02 - Track Two.wav", 523.25, 3.0);
    create_test_wav_at(&album_dir, "03 - Track Three.wav", 659.25, 3.0);

    // Fake cover art
    std::fs::write(album_dir.join("cover.jpg"), b"fake jpeg data").unwrap();

    // Fake artist photo
    std::fs::write(artist_dir.join("artist.jpg"), b"fake photo").unwrap();

    lib
}
