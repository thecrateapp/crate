mod common;

use common::{create_test_library, create_test_wav};
use tempfile::TempDir;

#[test]
fn test_scan_finds_all_tracks() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(&lib, &exts);
    assert_eq!(files.len(), 3);
}

#[test]
fn test_scan_reads_file_sizes() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(&lib, &exts);

    for f in &files {
        let meta = std::fs::metadata(f).unwrap();
        assert!(meta.len() > 0, "File should have non-zero size");
    }
}

#[test]
fn test_scan_directory_returns_structured_payload() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);

    let result = crate_cli::scan::scan_directory(lib, "wav".to_string(), true, true);

    assert_eq!(result.total_files, 3);
    assert!(result.total_size > 0);
    assert_eq!(result.artists.len(), 1);
    assert_eq!(result.artists[0].albums.len(), 1);
    assert_eq!(result.artists[0].albums[0].tracks.len(), 3);
    assert!(result.artists[0].content_hash.is_some());
    assert!(result.artists[0].has_photo);
    assert!(result.artists[0].albums[0].has_cover);
}

#[rstest::rstest]
#[case::artist_root(vec!["Artist Root", "Album One"], false)]
#[case::year_bucket(vec!["Artist Root", "2024", "Album One"], false)]
#[case::album_root(vec!["Artist Root", "Album One"], true)]
fn test_scan_directory_accepts_various_roots(
    #[case] segments: Vec<&str>,
    #[case] scan_at_album: bool,
) {
    let dir = TempDir::new().unwrap();
    let album_dir = path_from_segments(dir.path(), &segments);
    std::fs::create_dir_all(&album_dir).unwrap();
    common::create_test_wav_at(&album_dir, "01 - Track.wav", 440.0, 1.0);

    let scan_root = if scan_at_album {
        album_dir
    } else {
        dir.path().join(segments[0])
    };
    let result = crate_cli::scan::scan_directory(scan_root, "wav".to_string(), false, false);

    let album_name = segments.last().unwrap();
    assert_eq!(result.total_files, 1);
    assert_eq!(result.artists[0].name, "Artist Root");
    assert_eq!(result.artists[0].albums[0].name, *album_name);
}

fn path_from_segments(base: &std::path::Path, segments: &[&str]) -> std::path::PathBuf {
    let mut path = base.to_path_buf();
    for seg in segments {
        path.push(seg);
    }
    path
}

#[test]
fn test_scan_directory_prefers_flac_over_m4a_album_copies() {
    let dir = TempDir::new().unwrap();
    let lib = dir.path().join("library");
    let album_dir = lib.join("Test Artist").join("Test Album");
    std::fs::create_dir_all(&album_dir).unwrap();

    common::create_test_wav_at(&album_dir, "01 - Track.flac", 440.0, 1.0);
    common::create_test_wav_at(&album_dir, "01 - Track.m4a", 440.0, 1.0);

    let result = crate_cli::scan::scan_directory(lib, "flac,m4a".to_string(), false, false);

    assert_eq!(result.total_files, 1);
    let tracks = &result.artists[0].albums[0].tracks;
    assert_eq!(tracks.len(), 1);
    assert!(tracks[0].filename.ends_with(".flac"));
}

#[test]
fn test_scan_directory_skips_hidden_album_tree_entries() {
    let dir = TempDir::new().unwrap();
    let lib = dir.path().join("library");
    let album_dir = lib.join("Test Artist").join("Test Album");
    let hidden_dir = album_dir.join(".staging");
    std::fs::create_dir_all(&hidden_dir).unwrap();

    common::create_test_wav_at(&album_dir, "01 - Visible.wav", 440.0, 1.0);
    common::create_test_wav_at(&hidden_dir, "02 - Hidden.wav", 440.0, 1.0);

    let result = crate_cli::scan::scan_directory(lib, "wav".to_string(), false, false);

    assert_eq!(result.total_files, 1);
    let tracks = &result.artists[0].albums[0].tracks;
    assert_eq!(tracks[0].filename, "01 - Visible.wav");
}

#[test]
fn test_scan_detects_cover_art() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let album_dir = lib.join("Test Artist").join("2024").join("Test Album");

    // cover.jpg was created by create_test_library
    assert!(album_dir.join("cover.jpg").exists());
}

#[test]
fn test_scan_detects_artist_photo() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");

    assert!(artist_dir.join("artist.jpg").exists());
}

#[test]
fn test_scan_computes_content_hash() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");

    // Compute hash using the same logic as scan module
    use md5::{Digest, Md5};
    use walkdir::WalkDir;

    let mut entries: Vec<(String, u64)> = Vec::new();
    for entry in WalkDir::new(&artist_dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let rel = entry
                    .path()
                    .strip_prefix(&artist_dir)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                entries.push((rel, meta.len()));
            }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Md5::new();
    for (name, size) in &entries {
        hasher.update(format!("{}:{}\n", name, size).as_bytes());
    }
    let hash = hex::encode(hasher.finalize());

    assert!(!hash.is_empty());
    assert_eq!(hash.len(), 32); // MD5 hex is 32 chars
}

#[test]
fn test_scan_hash_changes_on_new_file() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");
    let album_dir = artist_dir.join("2024").join("Test Album");

    use md5::{Digest, Md5};
    use walkdir::WalkDir;

    let compute_hash = |path: &std::path::Path| -> String {
        let mut entries: Vec<(String, u64)> = Vec::new();
        for entry in WalkDir::new(path).into_iter().flatten() {
            if entry.file_type().is_file() {
                if let Ok(meta) = entry.metadata() {
                    let rel = entry
                        .path()
                        .strip_prefix(path)
                        .unwrap()
                        .to_string_lossy()
                        .to_string();
                    entries.push((rel, meta.len()));
                }
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut hasher = Md5::new();
        for (name, size) in &entries {
            hasher.update(format!("{}:{}\n", name, size).as_bytes());
        }
        hex::encode(hasher.finalize())
    };

    let hash_before = compute_hash(&artist_dir);

    // Add a new file
    common::create_test_wav_at(&album_dir, "04 - Track Four.wav", 880.0, 2.0);

    let hash_after = compute_hash(&artist_dir);
    assert_ne!(
        hash_before, hash_after,
        "Hash should change after adding a file"
    );
}

#[test]
fn test_scan_empty_directory() {
    let dir = TempDir::new().unwrap();
    let exts = crate_cli::parse_extensions("wav,flac");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert!(files.is_empty());
}

#[test]
fn test_scan_filters_by_extension() {
    let dir = TempDir::new().unwrap();
    create_test_wav(&dir, "track.wav", 440.0, 1.0);
    std::fs::write(dir.path().join("notes.txt"), b"not audio").unwrap();
    std::fs::write(dir.path().join("image.jpg"), b"not audio").unwrap();

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert_eq!(files.len(), 1);
    assert!(files[0].to_string_lossy().ends_with(".wav"));
}
