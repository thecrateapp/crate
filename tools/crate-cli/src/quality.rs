//! Quick quality probe: format, bitrate, sample rate, duration, and channel count.

use lofty::file::AudioFile;
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct QualityResult {
    pub root: Option<String>,
    pub tracks: Vec<QualityTrack>,
    pub total_files: usize,
    pub error_count: usize,
}

#[derive(Serialize)]
pub struct QualityTrack {
    pub path: String,
    pub filename: String,
    pub format: String,
    pub size: u64,
    pub duration_ms: Option<u64>,
    pub duration: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub channels: Option<u32>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn ext_to_format(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
}

fn probe_file(path: &Path) -> QualityTrack {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let format = ext_to_format(path);

    match lofty::read_from_path(path) {
        Ok(tagged) => {
            let props = tagged.properties();
            let duration_ms = props.duration().as_millis() as u64;
            QualityTrack {
                path: path.to_string_lossy().to_string(),
                filename,
                format,
                size,
                duration_ms: Some(duration_ms),
                duration: Some(duration_ms as f64 / 1000.0),
                bitrate: props
                    .audio_bitrate()
                    .map(|bitrate| bitrate.saturating_mul(1000)),
                sample_rate: props.sample_rate(),
                bit_depth: props.bit_depth().map(u32::from),
                channels: props.channels().map(u32::from),
                ok: true,
                error: None,
            }
        }
        Err(error) => QualityTrack {
            path: path.to_string_lossy().to_string(),
            filename,
            format,
            size,
            duration_ms: None,
            duration: None,
            bitrate: None,
            sample_rate: None,
            bit_depth: None,
            channels: None,
            ok: false,
            error: Some(error.to_string()),
        },
    }
}

pub fn quality_file(path: PathBuf) -> QualityResult {
    quality_files(vec![path])
}

pub fn quality_files(mut paths: Vec<PathBuf>) -> QualityResult {
    paths.sort();
    paths.dedup();
    let tracks: Vec<QualityTrack> = paths.par_iter().map(|path| probe_file(path)).collect();
    let error_count = tracks.iter().filter(|track| !track.ok).count();
    let root = if paths.len() == 1 {
        paths
            .first()
            .and_then(|path| path.parent())
            .map(|parent| parent.to_string_lossy().to_string())
    } else {
        None
    };
    QualityResult {
        root,
        total_files: tracks.len(),
        error_count,
        tracks,
    }
}

pub fn quality_directory(dir: PathBuf, extensions: String) -> QualityResult {
    quality_directories(vec![dir], extensions)
}

pub fn quality_directories(dirs: Vec<PathBuf>, extensions: String) -> QualityResult {
    let exts = parse_extensions(&extensions);
    let mut files: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|dir| collect_audio_files(dir, &exts))
        .collect();
    files.sort();
    files.dedup();
    let tracks: Vec<QualityTrack> = files.par_iter().map(|path| probe_file(path)).collect();
    let error_count = tracks.iter().filter(|track| !track.ok).count();
    let root = if dirs.len() == 1 {
        dirs.first().map(|dir| dir.to_string_lossy().to_string())
    } else {
        None
    };

    QualityResult {
        root,
        total_files: tracks.len(),
        error_count,
        tracks,
    }
}

pub fn run_quality(files: Vec<PathBuf>, dirs: Vec<PathBuf>, extensions: String) {
    let result = if !files.is_empty() {
        quality_files(files)
    } else if !dirs.is_empty() {
        quality_directories(dirs, extensions)
    } else {
        QualityResult {
            root: None,
            tracks: Vec::new(),
            total_files: 0,
            error_count: 0,
        }
    };
    println!("{}", serde_json::to_string(&result).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::quality_directories;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn quality_directory_scans_only_requested_directories() {
        let temp = TempDir::new().unwrap();
        let album_one = temp.path().join("Album One");
        let album_two = temp.path().join("Album Two");
        let unrelated_album = temp.path().join("Unrelated Album");
        fs::create_dir_all(&album_one).unwrap();
        fs::create_dir_all(&album_two).unwrap();
        fs::create_dir_all(&unrelated_album).unwrap();
        fs::write(album_one.join("one.flac"), b"not audio").unwrap();
        fs::write(album_two.join("two.flac"), b"not audio").unwrap();
        fs::write(unrelated_album.join("unrelated.flac"), b"not audio").unwrap();

        let result = quality_directories(vec![album_one, album_two], "flac".to_string());

        assert_eq!(result.root, None);
        assert_eq!(result.total_files, 2);
        assert!(result
            .tracks
            .iter()
            .all(|track| !track.path.contains("Unrelated Album")));
    }
}
