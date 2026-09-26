mod common;

use std::process::Command;

use tempfile::TempDir;

#[test]
fn test_quality_file_reads_technical_metadata() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let result = crate_cli::quality::quality_file(track);

    assert_eq!(result.total_files, 1);
    assert_eq!(result.error_count, 0);
    let quality = &result.tracks[0];
    assert!(quality.ok);
    assert_eq!(quality.format, "wav");
    assert_eq!(quality.sample_rate, Some(22050));
    assert_eq!(quality.bit_depth, Some(16));
    assert!(quality.duration_ms.unwrap_or_default() > 900);
    assert!(quality.bitrate.unwrap_or_default() > 0);
}

#[test]
fn test_quality_directory_reports_errors() {
    let dir = TempDir::new().unwrap();
    let valid = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);
    let invalid = dir.path().join("broken.flac");
    std::fs::write(&invalid, b"not audio").unwrap();

    let result =
        crate_cli::quality::quality_directory(dir.path().to_path_buf(), "wav,flac".to_string());

    assert_eq!(result.total_files, 2);
    assert_eq!(result.error_count, 1);
    assert!(result
        .tracks
        .iter()
        .any(|track| track.path == valid.to_string_lossy() && track.ok));
    assert!(result
        .tracks
        .iter()
        .any(|track| track.path == invalid.to_string_lossy() && !track.ok));
}

#[test]
fn test_quality_cli_accepts_multiple_target_directories_without_scanning_siblings() {
    let root = TempDir::new().unwrap();
    let album_one = root.path().join("Album One");
    let album_two = root.path().join("Album Two");
    let unrelated_album = root.path().join("Unrelated Album");
    std::fs::create_dir_all(&album_one).unwrap();
    std::fs::create_dir_all(&album_two).unwrap();
    std::fs::create_dir_all(&unrelated_album).unwrap();
    common::create_test_wav_at(&album_one, "one.wav", 440.0, 1.0);
    common::create_test_wav_at(&album_two, "two.wav", 440.0, 1.0);
    common::create_test_wav_at(&unrelated_album, "unrelated.wav", 440.0, 1.0);

    let output = Command::new(env!("CARGO_BIN_EXE_crate-cli"))
        .args(["quality", "--dir"])
        .arg(&album_one)
        .arg(&album_two)
        .args(["--extensions", "wav"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["total_files"], 2);
    let tracks = result["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 2);
    assert!(tracks
        .iter()
        .all(|track| !track["path"].as_str().unwrap().contains("Unrelated Album")));
}
