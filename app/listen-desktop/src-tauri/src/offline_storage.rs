use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client, Url,
};
use tokio::{fs, io::AsyncWriteExt};

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);

fn validate_offline_media_path(path: &str) -> Result<PathBuf, String> {
    if path.contains(['\\', ':', '\0']) {
        return Err("Invalid Tauri offline media path".to_string());
    }

    let mut segments = path.split('/');
    if segments.next() != Some("offline-media") {
        return Err("Invalid Tauri offline media path".to_string());
    }

    let remaining = segments.collect::<Vec<_>>();
    if remaining.is_empty()
        || remaining
            .iter()
            .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err("Invalid Tauri offline media path".to_string());
    }

    Ok(PathBuf::from(path))
}

async fn resolve_target_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative_path = validate_offline_media_path(path)?;
    fs::create_dir_all(root)
        .await
        .map_err(|error| format!("Could not create offline storage: {error}"))?;
    let canonical_root = fs::canonicalize(root)
        .await
        .map_err(|error| format!("Could not resolve offline storage: {error}"))?;
    let requested_target = canonical_root.join(relative_path);
    let requested_parent = requested_target
        .parent()
        .ok_or_else(|| "Invalid Tauri offline media path".to_string())?;
    fs::create_dir_all(requested_parent)
        .await
        .map_err(|error| format!("Could not create offline media directory: {error}"))?;
    let canonical_parent = fs::canonicalize(requested_parent)
        .await
        .map_err(|error| format!("Could not resolve offline media directory: {error}"))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Offline media path escapes app-local storage".to_string());
    }

    let file_name = requested_target
        .file_name()
        .ok_or_else(|| "Invalid Tauri offline media path".to_string())?;
    Ok(canonical_parent.join(file_name))
}

fn temporary_path(target: &Path) -> Result<PathBuf, String> {
    let file_name = target
        .file_name()
        .ok_or_else(|| "Invalid Tauri offline media path".to_string())?
        .to_string_lossy();
    let id = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    Ok(target.with_file_name(format!(".{file_name}.part-{}-{id}", std::process::id())))
}

#[tauri::command]
pub async fn download_offline_media(
    app: AppHandle,
    url: String,
    path: String,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid download URL: {error}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https")
        || parsed_url.host_str().is_none()
        || !parsed_url.username().is_empty()
        || parsed_url.password().is_some()
    {
        return Err("Offline downloads require an HTTP or HTTPS URL".to_string());
    }

    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid download header name: {error}"))?;
        let value = HeaderValue::from_str(&value)
            .map_err(|error| format!("Invalid download header value: {error}"))?;
        header_map.insert(name, value);
    }

    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve app-local storage: {error}"))?;
    let target = resolve_target_path(&root, &path).await?;
    let temporary = temporary_path(&target)?;

    let result = async {
        let mut response = Client::new()
            .get(parsed_url)
            .headers(header_map)
            .send()
            .await
            .map_err(|error| format!("Offline download failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Offline download failed with HTTP status {}",
                response.status()
            ));
        }

        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(|error| format!("Could not create offline media file: {error}"))?;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Offline download failed: {error}"))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("Could not write offline media file: {error}"))?;
        }
        file.flush()
            .await
            .map_err(|error| format!("Could not finish offline media file: {error}"))?;
        drop(file);

        match fs::remove_file(&target).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("Could not replace offline media file: {error}"));
            }
        }
        fs::rename(&temporary, &target)
            .await
            .map_err(|error| format!("Could not save offline media file: {error}"))?;

        target
            .to_str()
            .map(str::to_string)
            .ok_or_else(|| "Offline media path is not valid UTF-8".to_string())
    }
    .await;

    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::validate_offline_media_path;
    use std::path::PathBuf;

    #[test]
    fn accepts_files_inside_offline_media() {
        assert_eq!(
            validate_offline_media_path("offline-media/profile/song.flac").unwrap(),
            PathBuf::from("offline-media/profile/song.flac")
        );
    }

    #[test]
    fn rejects_paths_outside_offline_media_and_traversal() {
        for path in [
            "offline-meta/index.json",
            "offline-media/../outside.flac",
            "/offline-media/song.flac",
            "offline-media\\outside.flac",
            "offline-media//song.flac",
            "offline-media/profile/song:stream.flac",
        ] {
            assert!(
                validate_offline_media_path(path).is_err(),
                "accepted invalid path: {path}"
            );
        }
    }
}
