//! Crate CLI library: audio analysis, scanning, fingerprinting, tagging, and library diffing.

#[cfg(feature = "analysis")]
pub mod analyze;
#[cfg(feature = "bliss")]
pub mod bliss;
pub mod diff;
pub mod fingerprint;
#[cfg(feature = "ml")]
pub mod ml;
pub mod quality;
pub mod scan;
pub mod tags;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

/// Collect audio files recursively from a directory, filtered by extension.
pub fn collect_audio_files(dir: &Path, extensions: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = VecDeque::new();
    stack.push_back(dir.to_path_buf());

    while let Some(current) = stack.pop_front() {
        if let Ok(entries) = std::fs::read_dir(&current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push_back(path);
                } else if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                            files.push(path);
                        }
                    }
                }
            }
        }
    }
    files.sort();
    files
}

/// Parse a comma-separated extensions string into a Vec.
pub fn parse_extensions(extensions: &str) -> Vec<String> {
    extensions
        .split(',')
        .map(|s| s.trim().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn collect_audio_files_iterates_deep_tree() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let deep = root.join("a/b/c/d/e");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("track.flac"), b"audio").unwrap();
        fs::write(root.join("shallow.mp3"), b"audio").unwrap();

        let exts = vec!["flac".to_string(), "mp3".to_string()];
        let files = collect_audio_files(root, &exts);

        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|p| p.ends_with("track.flac")));
        assert!(files.iter().any(|p| p.ends_with("shallow.mp3")));
    }
}
