use std::{
    collections::HashMap,
    fs as std_fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Deserialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_http::reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
    Client, Url,
};
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::watch,
    task::JoinSet,
    time::{self, Instant},
};

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);
static OFFLINE_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const RESPONSE_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const DOWNLOAD_DEADLINE: Duration = Duration::from_secs(2 * 60 * 60);

struct TemporaryFileGuard {
    path: PathBuf,
    cleanup_on_drop: bool,
}

impl TemporaryFileGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            cleanup_on_drop: true,
        }
    }

    fn preserve(&mut self) {
        self.cleanup_on_drop = false;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            let _ = std_fs::remove_file(&self.path);
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineTransferScope {
    server_id: String,
    server_url: String,
    user_id: u64,
    profile_key: String,
    generation: u64,
    asset_key: String,
}

impl OfflineTransferScope {
    fn validate(&self) -> Result<(), String> {
        if self.server_id.trim().is_empty()
            || self.server_id.len() > 256
            || self.user_id == 0
            || self.generation == 0
            || !is_safe_path_segment(&self.profile_key)
            || self.asset_key.trim().is_empty()
            || self.asset_key.len() > 512
        {
            return Err("Invalid offline transfer scope".to_string());
        }
        let server = Url::parse(&self.server_url)
            .map_err(|_| "Invalid offline transfer server URL".to_string())?;
        if !matches!(server.scheme(), "http" | "https")
            || server.host_str().is_none()
            || !server.username().is_empty()
            || server.password().is_some()
            || server.query().is_some()
            || server.fragment().is_some()
        {
            return Err("Invalid offline transfer server URL".to_string());
        }
        Ok(())
    }
}

fn is_safe_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

struct OfflineTransfer {
    scope: OfflineTransferScope,
    window_label: String,
    started: AtomicBool,
    cancelled: watch::Sender<bool>,
    completed: watch::Sender<bool>,
}

impl OfflineTransfer {
    fn new(scope: OfflineTransferScope, window_label: String) -> Self {
        let (cancelled, _) = watch::channel(false);
        let (completed, _) = watch::channel(false);
        Self {
            scope,
            window_label,
            started: AtomicBool::new(false),
            cancelled,
            completed,
        }
    }

    fn is_complete(&self) -> bool {
        *self.completed.borrow()
    }

    fn finish(&self) {
        self.completed.send_replace(true);
    }
}

pub struct OfflineTransferRegistry {
    transfers: Mutex<HashMap<String, Arc<OfflineTransfer>>>,
    verification_semaphore: Arc<tokio::sync::Semaphore>,
}

impl Default for OfflineTransferRegistry {
    fn default() -> Self {
        Self {
            transfers: Mutex::new(HashMap::new()),
            verification_semaphore: Arc::new(tokio::sync::Semaphore::new(8)),
        }
    }
}

impl OfflineTransferRegistry {
    fn get_for_window(
        &self,
        transfer_id: &str,
        scope: &OfflineTransferScope,
        window_label: &str,
    ) -> Result<Arc<OfflineTransfer>, String> {
        let transfers = self
            .transfers
            .lock()
            .map_err(|_| "Offline transfer registry is unavailable".to_string())?;
        let transfer = transfers
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| "Offline transfer is not registered".to_string())?;
        if transfer.window_label != window_label || transfer.scope != *scope {
            return Err("Offline transfer scope does not match".to_string());
        }
        Ok(transfer)
    }

    fn remove_if_matches(&self, transfer_id: &str, transfer: &Arc<OfflineTransfer>) {
        if let Ok(mut transfers) = self.transfers.lock() {
            if transfers
                .get(transfer_id)
                .is_some_and(|current| Arc::ptr_eq(current, transfer))
            {
                transfers.remove(transfer_id);
            }
        }
    }

    fn has_profile_transfer(&self, profile_key: &str) -> bool {
        self.transfers.lock().is_ok_and(|transfers| {
            transfers
                .values()
                .any(|transfer| transfer.scope.profile_key == profile_key)
        })
    }
}

#[tauri::command]
pub fn register_offline_transfer(
    window: WebviewWindow,
    state: State<'_, OfflineTransferRegistry>,
    transfer_id: String,
    scope: OfflineTransferScope,
) -> Result<(), String> {
    if transfer_id.len() < 8
        || transfer_id.len() > 128
        || !transfer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid offline transfer identifier".to_string());
    }
    scope.validate()?;
    let mut transfers = state
        .transfers
        .lock()
        .map_err(|_| "Offline transfer registry is unavailable".to_string())?;
    if transfers.contains_key(&transfer_id) {
        return Err("Offline transfer identifier is already in use".to_string());
    }
    transfers.insert(
        transfer_id,
        Arc::new(OfflineTransfer::new(scope, window.label().to_string())),
    );
    Ok(())
}

#[tauri::command]
pub async fn cancel_offline_transfer(
    window: WebviewWindow,
    state: State<'_, OfflineTransferRegistry>,
    transfer_id: String,
    scope: OfflineTransferScope,
) -> Result<(), String> {
    let transfer = match state.get_for_window(&transfer_id, &scope, window.label()) {
        Ok(transfer) => transfer,
        Err(error) if error == "Offline transfer is not registered" => return Ok(()),
        Err(error) => return Err(error),
    };
    transfer.cancelled.send_replace(true);
    if !transfer.started.load(Ordering::Acquire) || transfer.is_complete() {
        return Ok(());
    }
    let mut completed = transfer.completed.subscribe();
    while !*completed.borrow() {
        if completed.changed().await.is_err() {
            return Ok(());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn unregister_offline_transfer(
    window: WebviewWindow,
    state: State<'_, OfflineTransferRegistry>,
    transfer_id: String,
    scope: OfflineTransferScope,
) -> Result<(), String> {
    let transfer = state.get_for_window(&transfer_id, &scope, window.label())?;
    if transfer.started.load(Ordering::Acquire) && !transfer.is_complete() {
        return Err("Cannot unregister an active offline transfer".to_string());
    }
    state.remove_if_matches(&transfer_id, &transfer);
    Ok(())
}

#[tauri::command]
pub async fn reconcile_offline_media(
    app: AppHandle,
    state: State<'_, OfflineTransferRegistry>,
    profile_key: String,
    referenced_paths: Vec<String>,
) -> Result<usize, String> {
    if !is_safe_path_segment(&profile_key) {
        return Err("Invalid offline profile key".to_string());
    }
    if state.has_profile_transfer(&profile_key) {
        return Ok(0);
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve app-local storage: {error}"))?;
    let sentinel = format!("offline-media/{profile_key}/.reconcile");
    let sentinel_path = resolve_target_path(&root, &sentinel).await?;
    let directory = sentinel_path
        .parent()
        .ok_or_else(|| "Invalid offline media directory".to_string())?;
    let mut referenced_files = std::collections::HashSet::new();
    for path in referenced_paths {
        let Ok(relative) = validate_offline_media_path(&path) else {
            continue;
        };
        if relative.components().count() == 3
            && relative.components().nth(1).map(|part| part.as_os_str())
                == Some(std::ffi::OsStr::new(&profile_key))
        {
            if let Some(file_name) = relative.file_name() {
                referenced_files.insert(file_name.to_os_string());
            }
        }
    }

    cleanup_unreferenced_media_files(directory, &referenced_files)
        .await
        .map_err(|error| format!("Could not reconcile offline media: {}", error.kind()))
}

async fn cleanup_unreferenced_media_files(
    directory: &Path,
    referenced_files: &std::collections::HashSet<std::ffi::OsString>,
) -> io::Result<usize> {
    let mut entries = fs::read_dir(directory).await?;
    let mut removed = 0;
    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_file() {
            continue;
        }
        if referenced_files.contains(&entry.file_name()) {
            continue;
        }
        fs::remove_file(entry.path()).await?;
        removed += 1;
    }
    Ok(removed)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMediaExpectation {
    path: String,
    expected_bytes: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMediaVerification {
    path: String,
    exists: bool,
    size: u64,
    valid: bool,
}

async fn inspect_offline_media_file(
    root: &Path,
    profile_key: &str,
    expectation: OfflineMediaExpectation,
) -> Result<OfflineMediaVerification, String> {
    let relative = validate_offline_media_path(&expectation.path)?;
    if !is_safe_path_segment(profile_key)
        || relative.components().count() != 3
        || relative.components().nth(1).map(|part| part.as_os_str())
            != Some(std::ffi::OsStr::new(profile_key))
    {
        return Err("Offline verification path does not match its profile".to_string());
    }
    let canonical_root = fs::canonicalize(root)
        .await
        .map_err(|_| "Could not resolve app-local storage".to_string())?;
    let media_root = canonical_root.join("offline-media");
    let canonical_media_root = match fs::canonicalize(&media_root).await {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(missing_verification(expectation.path));
        }
        Err(_) => return Err("Could not resolve offline media root".to_string()),
    };
    if canonical_media_root != media_root {
        return Err("Offline media root cannot be a symbolic link".to_string());
    }
    let profile_dir = media_root.join(profile_key);
    let canonical_profile_dir = match fs::canonicalize(&profile_dir).await {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(missing_verification(expectation.path));
        }
        Err(_) => return Err("Could not resolve offline profile directory".to_string()),
    };
    if canonical_profile_dir != profile_dir {
        return Err("Offline profile directory cannot be a symbolic link".to_string());
    }
    let file_path = profile_dir.join(relative.file_name().unwrap());
    let metadata = match fs::symlink_metadata(&file_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(missing_verification(expectation.path));
        }
        Err(_) => return Err("Could not inspect offline media file".to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Offline media entry must be a regular file".to_string());
    }
    if fs::canonicalize(&file_path).await.ok().as_deref() != Some(file_path.as_path()) {
        return Err("Offline media path cannot contain symbolic links".to_string());
    }
    let size = metadata.len();
    let valid = size > 0
        && expectation
            .expected_bytes
            .is_none_or(|expected| expected == 0 || expected == size);
    Ok(OfflineMediaVerification {
        path: expectation.path,
        exists: true,
        size,
        valid,
    })
}

fn missing_verification(path: String) -> OfflineMediaVerification {
    OfflineMediaVerification {
        path,
        exists: false,
        size: 0,
        valid: false,
    }
}

#[tauri::command]
pub async fn verify_offline_media_assets(
    app: AppHandle,
    state: State<'_, OfflineTransferRegistry>,
    profile_key: String,
    assets: Vec<OfflineMediaExpectation>,
) -> Result<Vec<OfflineMediaVerification>, String> {
    if !is_safe_path_segment(&profile_key) || assets.len() > 500 {
        return Err("Invalid offline media verification request".to_string());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not resolve app-local storage".to_string())?;
    let semaphore = state.verification_semaphore.clone();
    let result_count = assets.len();
    let mut tasks = JoinSet::new();
    for (index, expectation) in assets.into_iter().enumerate() {
        let root = root.clone();
        let profile_key = profile_key.clone();
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .map_err(|_| "Offline verification is unavailable".to_string())?;
            Ok::<_, String>((
                index,
                inspect_offline_media_file(&root, &profile_key, expectation).await?,
            ))
        });
    }
    let mut results: Vec<Option<OfflineMediaVerification>> =
        (0..result_count).map(|_| None).collect();
    while let Some(joined) = tasks.join_next().await {
        let (index, result) =
            joined.map_err(|_| "Offline verification task failed".to_string())??;
        results[index] = Some(result);
    }
    results
        .into_iter()
        .map(|result| result.ok_or_else(|| "Offline verification result is missing".to_string()))
        .collect()
}

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
    let media_root = canonical_root.join("offline-media");
    match fs::create_dir(&media_root).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!("Could not create offline media root: {error}"));
        }
    }
    let canonical_media_root = fs::canonicalize(&media_root)
        .await
        .map_err(|error| format!("Could not resolve offline media root: {error}"))?;
    if canonical_media_root != media_root {
        return Err("Offline media root cannot be a symbolic link".to_string());
    }

    let segments = relative_path
        .components()
        .skip(1)
        .map(|component| component.as_os_str().to_owned())
        .collect::<Vec<_>>();
    let (file_name, directories) = segments
        .split_last()
        .ok_or_else(|| "Invalid Tauri offline media path".to_string())?;
    let mut canonical_parent = canonical_media_root;
    for segment in directories {
        let directory = canonical_parent.join(segment);
        match fs::create_dir(&directory).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!("Could not create offline media directory: {error}"));
            }
        }
        let resolved = fs::canonicalize(&directory)
            .await
            .map_err(|error| format!("Could not resolve offline media directory: {error}"))?;
        if resolved != directory {
            return Err("Offline media path cannot contain symbolic links".to_string());
        }
        canonical_parent = resolved;
    }
    Ok(canonical_parent.join(file_name))
}

fn offline_http_client() -> Result<&'static Client, String> {
    match OFFLINE_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_DEADLINE)
            .redirect(Policy::none())
            .build()
            .map_err(|_| "Could not initialize offline HTTP client".to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(error.clone()),
    }
}

async fn download_to_temporary_file(
    client: &Client,
    url: Url,
    headers: HeaderMap,
    temporary: &Path,
    transfer: &OfflineTransfer,
    idle_timeout: Duration,
    total_timeout: Duration,
) -> Result<(), String> {
    let mut temporary_file_guard = TemporaryFileGuard::new(temporary.to_path_buf());
    let deadline = Instant::now() + total_timeout;
    let mut cancelled = transfer.cancelled.subscribe();
    if *cancelled.borrow() {
        return Err("Offline download cancelled".to_string());
    }
    let response_result = tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("Offline download cancelled".to_string()),
        _ = time::sleep_until(deadline) => return Err("Offline download timed out".to_string()),
        result = client.get(url).headers(headers).send() => result,
    };
    let mut response = response_result.map_err(|error| {
        if error.is_timeout() {
            "Offline download timed out".to_string()
        } else {
            "Offline download request failed".to_string()
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "Offline download failed with HTTP status {}",
            response.status().as_u16()
        ));
    }

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary)
        .await
        .map_err(|error| format!("Could not create offline media file: {}", error.kind()))?;
    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("Offline download cancelled".to_string()),
            _ = time::sleep_until(deadline) => return Err("Offline download timed out".to_string()),
            result = time::timeout(idle_timeout, response.chunk()) => result,
        };
        let chunk = match chunk_result {
            Err(_) => return Err("Offline download timed out waiting for data".to_string()),
            Ok(Err(_)) => return Err("Offline download response failed".to_string()),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => chunk,
        };
        let write_result = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("Offline download cancelled".to_string()),
            _ = time::sleep_until(deadline) => return Err("Offline download timed out".to_string()),
            result = file.write_all(&chunk) => result,
        };
        write_result
            .map_err(|error| format!("Could not write offline media file: {}", error.kind()))?;
    }
    tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("Offline download cancelled".to_string()),
        _ = time::sleep_until(deadline) => return Err("Offline download timed out".to_string()),
        result = file.flush() => result,
    }
    .map_err(|error| format!("Could not finish offline media file: {}", error.kind()))?;
    tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("Offline download cancelled".to_string()),
        _ = time::sleep_until(deadline) => return Err("Offline download timed out".to_string()),
        result = file.sync_all() => result,
    }
    .map_err(|error| {
        format!(
            "Could not make offline media file durable: {}",
            error.kind()
        )
    })?;
    drop(file);
    temporary_file_guard.preserve();
    Ok(())
}

fn recover_interrupted_file_promotion(target: &Path, backup: &Path) -> io::Result<()> {
    if target.try_exists()? {
        match std_fs::remove_file(backup) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    } else if backup.try_exists()? {
        std_fs::rename(backup, target)?;
    }
    sync_parent_directory(target)
}

fn promote_file_with<F>(
    temporary: &Path,
    target: &Path,
    backup: &Path,
    mut rename: F,
) -> io::Result<()>
where
    F: FnMut(&Path, &Path) -> io::Result<()>,
{
    recover_interrupted_file_promotion(target, backup)?;
    let had_target = target.try_exists()?;
    if had_target {
        rename(target, backup)?;
    }

    if let Err(error) = rename(temporary, target) {
        if had_target {
            if let Err(restore_error) = rename(backup, target) {
                return Err(io::Error::new(
                    restore_error.kind(),
                    format!("{error}; previous copy remains recoverable: {restore_error}"),
                ));
            }
        }
        return Err(error);
    }

    if let Err(sync_error) = sync_parent_directory(target) {
        if had_target {
            let rollback = std_fs::remove_file(target)
                .and_then(|()| std_fs::rename(backup, target))
                .and_then(|()| sync_parent_directory(target));
            if let Err(rollback_error) = rollback {
                return Err(io::Error::new(
                    rollback_error.kind(),
                    format!("{sync_error}; previous copy remains recoverable: {rollback_error}"),
                ));
            }
        }
        return Err(sync_error);
    }

    if had_target {
        let _ = std_fs::remove_file(backup);
        let _ = sync_parent_directory(target);
    }
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std_fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn temporary_path(target: &Path) -> Result<PathBuf, String> {
    let file_name = target
        .file_name()
        .ok_or_else(|| "Invalid Tauri offline media path".to_string())?
        .to_string_lossy();
    let id = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    Ok(target.with_file_name(format!(".{file_name}.part-{}-{id}", std::process::id())))
}

async fn download_offline_media_inner(
    app: AppHandle,
    transfer: Arc<OfflineTransfer>,
    url: String,
    path: String,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    if *transfer.cancelled.borrow() {
        return Err("Offline download cancelled".to_string());
    }
    let parsed_url = Url::parse(&url).map_err(|_| "Invalid download URL".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https")
        || parsed_url.host_str().is_none()
        || !parsed_url.username().is_empty()
        || parsed_url.password().is_some()
    {
        return Err("Offline downloads require an HTTP or HTTPS URL".to_string());
    }
    let server_url = Url::parse(&transfer.scope.server_url)
        .map_err(|_| "Invalid offline transfer server URL".to_string())?;
    if parsed_url.origin() != server_url.origin() {
        return Err("Offline download URL must match the configured server".to_string());
    }

    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "Invalid offline download header name".to_string())?;
        if name != reqwest_authorization_header() {
            return Err("Unsupported offline download header".to_string());
        }
        let value = HeaderValue::from_str(&value)
            .map_err(|_| "Invalid offline download authorization header".to_string())?;
        header_map.insert(name, value);
    }

    let relative_path = validate_offline_media_path(&path)?;
    if relative_path
        .components()
        .nth(1)
        .map(|part| part.as_os_str())
        != Some(std::ffi::OsStr::new(&transfer.scope.profile_key))
    {
        return Err("Offline download path does not match its profile".to_string());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve app-local storage: {error}"))?;
    let target = resolve_target_path(&root, &path).await?;
    let temporary = temporary_path(&target)?;
    if *transfer.cancelled.borrow() {
        return Err("Offline download cancelled".to_string());
    }
    let backup = target.with_file_name(format!(
        ".{}.backup",
        target
            .file_name()
            .ok_or_else(|| "Invalid Tauri offline media path".to_string())?
            .to_string_lossy()
    ));
    recover_interrupted_file_promotion(&target, &backup)
        .map_err(|error| format!("Could not recover offline media file: {error}"))?;

    let client = offline_http_client()?;
    download_to_temporary_file(
        client,
        parsed_url,
        header_map,
        &temporary,
        &transfer,
        RESPONSE_IDLE_TIMEOUT,
        DOWNLOAD_DEADLINE,
    )
    .await?;

    promote_file_with(&temporary, &target, &backup, |from, to| {
        std_fs::rename(from, to)
    })
    .map_err(|error| format!("Could not save offline media file: {}", error.kind()))?;

    target
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "Offline media path is not valid UTF-8".to_string())
}

fn reqwest_authorization_header() -> HeaderName {
    HeaderName::from_static("authorization")
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_offline_media(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, OfflineTransferRegistry>,
    transfer_id: String,
    scope: OfflineTransferScope,
    url: String,
    path: String,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    let transfer = state.get_for_window(&transfer_id, &scope, window.label())?;
    if transfer
        .started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Offline transfer has already started".to_string());
    }
    let result = download_offline_media_inner(app, transfer.clone(), url, path, headers).await;
    transfer.finish();
    state.remove_if_matches(&transfer_id, &transfer);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_unreferenced_media_files, download_to_temporary_file, inspect_offline_media_file,
        promote_file_with, recover_interrupted_file_promotion, validate_offline_media_path,
        OfflineMediaExpectation, OfflineTransfer, OfflineTransferScope,
    };
    use std::{
        collections::HashSet,
        fs, io,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        sync::Arc,
        time::Duration,
    };
    use tauri_plugin_http::reqwest::{header::HeaderMap, redirect::Policy, Client, Url};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::oneshot,
        time,
    };

    static TEST_DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);

    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "crate-offline-storage-test-{}-{}",
            std::process::id(),
            TEST_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn test_scope(server_url: String) -> OfflineTransferScope {
        OfflineTransferScope {
            server_id: "server-a".to_string(),
            server_url,
            user_id: 42,
            profile_key: "profile-a".to_string(),
            generation: 7,
            asset_key: "entity:track-1".to_string(),
        }
    }

    async fn stalled_response_server() -> (Url, oneshot::Receiver<()>, tokio::task::JoinHandle<()>)
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (started_tx, started_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await;
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nhello")
                .await;
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
        });
        (
            Url::parse(&format!("http://{address}/stream")).unwrap(),
            started_rx,
            server,
        )
    }

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

    #[test]
    fn failed_promotion_restores_the_previous_copy() {
        let directory = test_directory();
        let target = directory.join("song.m4a");
        let temporary = directory.join(".song.m4a.part");
        let backup = directory.join(".song.m4a.backup");
        fs::write(&target, b"previous copy").unwrap();
        fs::write(&temporary, b"replacement").unwrap();
        let mut failed_new_target_rename = false;

        let result = promote_file_with(&temporary, &target, &backup, |from, to| {
            if from == temporary && to == target && !failed_new_target_rename {
                failed_new_target_rename = true;
                return Err(io::Error::other("simulated promotion failure"));
            }
            fs::rename(from, to)
        });

        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"previous copy");
        assert!(temporary.exists());
        assert!(!backup.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recovery_restores_backup_when_promotion_was_interrupted() {
        let directory = test_directory();
        let target = directory.join("song.m4a");
        let backup = directory.join(".song.m4a.backup");
        fs::write(&backup, b"previous copy").unwrap();

        recover_interrupted_file_promotion(&target, &backup).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"previous copy");
        assert!(!backup.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recovery_keeps_promoted_target_and_discards_old_backup() {
        let directory = test_directory();
        let target = directory.join("song.m4a");
        let backup = directory.join(".song.m4a.backup");
        fs::write(&target, b"replacement").unwrap();
        fs::write(&backup, b"previous copy").unwrap();

        recover_interrupted_file_promotion(&target, &backup).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"replacement");
        assert!(!backup.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn cancellation_closes_a_stalled_response_and_removes_partial_file() {
        let (url, response_started, server) = stalled_response_server().await;
        let directory = test_directory();
        let temporary = directory.join(".song.part");
        let client = Client::new();
        let transfer = Arc::new(OfflineTransfer::new(
            test_scope(url.origin().ascii_serialization()),
            "main".to_string(),
        ));
        transfer.started.store(true, Ordering::Release);
        let running_transfer = transfer.clone();
        let running_path = temporary.clone();
        let download = tokio::spawn(async move {
            download_to_temporary_file(
                &client,
                url,
                HeaderMap::new(),
                &running_path,
                &running_transfer,
                Duration::from_secs(30),
                Duration::from_secs(30),
            )
            .await
        });
        response_started.await.unwrap();
        time::timeout(Duration::from_secs(2), async {
            while !temporary.exists() || fs::metadata(&temporary).unwrap().len() < 5 {
                time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();

        transfer.cancelled.send_replace(true);
        let result = time::timeout(Duration::from_secs(2), download)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err(), "Offline download cancelled");
        assert!(!temporary.exists());
        server.abort();
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn total_deadline_cleans_a_stalled_response_partial_file() {
        let (url, response_started, server) = stalled_response_server().await;
        let directory = test_directory();
        let temporary = directory.join(".song.part");
        let client = Client::new();
        let transfer = OfflineTransfer::new(
            test_scope(url.origin().ascii_serialization()),
            "main".to_string(),
        );
        let download_path = temporary.clone();
        let download = tokio::spawn(async move {
            download_to_temporary_file(
                &client,
                url,
                HeaderMap::new(),
                &download_path,
                &transfer,
                Duration::from_secs(30),
                Duration::from_millis(75),
            )
            .await
        });
        response_started.await.unwrap();
        let result = time::timeout(Duration::from_secs(2), download)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err(), "Offline download timed out");
        assert!(!temporary.exists());
        server.abort();
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn body_idle_deadline_cleans_a_stalled_response_partial_file() {
        let (url, response_started, server) = stalled_response_server().await;
        let directory = test_directory();
        let temporary = directory.join(".song.part");
        let client = Client::new();
        let transfer = OfflineTransfer::new(
            test_scope(url.origin().ascii_serialization()),
            "main".to_string(),
        );
        let download_path = temporary.clone();
        let download = tokio::spawn(async move {
            download_to_temporary_file(
                &client,
                url,
                HeaderMap::new(),
                &download_path,
                &transfer,
                Duration::from_millis(75),
                Duration::from_secs(2),
            )
            .await
        });
        response_started.await.unwrap();

        let result = time::timeout(Duration::from_secs(2), download)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            result.unwrap_err(),
            "Offline download timed out waiting for data"
        );
        assert!(!temporary.exists());
        server.abort();
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn redirect_policy_does_not_follow_a_stream_redirect() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (request_seen_tx, request_seen_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return false;
            };
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await;
            let _ = stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: /redirect-target\r\nContent-Length: 0\r\n\r\n",
                )
                .await;
            let _ = request_seen_tx.send(());
            if let Ok(Ok((mut redirected, _))) =
                time::timeout(Duration::from_millis(150), listener.accept()).await
            {
                let _ = redirected.read(&mut request).await;
                return true;
            }
            false
        });
        let url = Url::parse(&format!("http://{address}/stream")).unwrap();
        let directory = test_directory();
        let temporary = directory.join(".song.part");
        let client = Client::builder().redirect(Policy::none()).build().unwrap();
        let transfer = OfflineTransfer::new(
            test_scope(url.origin().ascii_serialization()),
            "main".to_string(),
        );

        let result = download_to_temporary_file(
            &client,
            url,
            HeaderMap::new(),
            &temporary,
            &transfer,
            Duration::from_secs(1),
            Duration::from_secs(2),
        )
        .await;

        request_seen_rx.await.unwrap();
        assert_eq!(
            result.unwrap_err(),
            "Offline download failed with HTTP status 302"
        );
        assert!(!temporary.exists());
        assert!(!server.await.unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn reconciliation_removes_orphans_and_keeps_indexed_media() {
        let directory = test_directory();
        let indexed = directory.join("indexed.m4a");
        let orphaned = directory.join("orphaned.m4a");
        let partial = directory.join(".interrupted.part-123-4");
        fs::write(&indexed, b"cached").unwrap();
        fs::write(&orphaned, b"orphan").unwrap();
        fs::write(&partial, b"partial").unwrap();
        let referenced = HashSet::from([indexed.file_name().unwrap().to_os_string()]);

        let removed = cleanup_unreferenced_media_files(&directory, &referenced)
            .await
            .unwrap();

        assert_eq!(removed, 2);
        assert!(indexed.exists());
        assert!(!orphaned.exists());
        assert!(!partial.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn batched_file_inspection_checks_profile_and_delivered_size() {
        let directory = test_directory();
        let profile_dir = directory.join("offline-media/profile-a");
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(profile_dir.join("song.m4a"), b"cached").unwrap();

        let valid = inspect_offline_media_file(
            &directory,
            "profile-a",
            OfflineMediaExpectation {
                path: "offline-media/profile-a/song.m4a".to_string(),
                expected_bytes: Some(6),
            },
        )
        .await
        .unwrap();
        let stale_size = inspect_offline_media_file(
            &directory,
            "profile-a",
            OfflineMediaExpectation {
                path: "offline-media/profile-a/song.m4a".to_string(),
                expected_bytes: Some(9),
            },
        )
        .await
        .unwrap();
        let missing = inspect_offline_media_file(
            &directory,
            "profile-a",
            OfflineMediaExpectation {
                path: "offline-media/profile-a/missing.m4a".to_string(),
                expected_bytes: Some(9),
            },
        )
        .await
        .unwrap();

        assert!(valid.exists && valid.valid && valid.size == 6);
        assert!(stale_size.exists && !stale_size.valid && stale_size.size == 6);
        assert!(!missing.exists && !missing.valid);
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn batched_file_inspection_rejects_a_different_profile() {
        let directory = test_directory();
        let result = inspect_offline_media_file(
            &directory,
            "profile-a",
            OfflineMediaExpectation {
                path: "offline-media/profile-b/song.m4a".to_string(),
                expected_bytes: None,
            },
        )
        .await;

        assert!(result.is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
