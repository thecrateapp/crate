//! Square artwork for desktop launchers that show control-socket search
//! results (the Ryoku launcher, rofi).
//!
//! Listen tags each search item with an internal `art_key`
//! (`album:<server>:<id>` or `artist:<server>:<id>`); `desktop_control_reply`
//! swaps it for `art`, the absolute
//! path of a cached image, when that image is on disk, and reports the keys it
//! lacks. Listen then fetches those images with its own session, crops them to
//! 256 px squares and hands the bytes back through `store_launcher_art`, which
//! writes them here. A later search finds them.
//!
//! - Directory: `$XDG_CACHE_HOME/crate/launcher-art/` (or
//!   `~/.cache/crate/launcher-art/`), mode 0700.
//! - File name: the first 32 hex digits of SHA-256 over
//!   `crate-launcher-art/v1/<key>/<size>`, then `-<size>.<jpg|png|webp>`. The
//!   key is an entity id scoped by the Crate server (`<server>` is 16 hex
//!   digits Listen derives from the server URL), since two servers number their
//!   albums alike and must not share a cover. Image URLs carry the user's media
//!   ticket, so a URL, ticket or token never reaches a file name, the socket or
//!   a log.
//! - A file is published by renaming a fully written temp file, so a path in a
//!   reply always names a complete image.
//! - The cache is an LRU (mtime, touched on every hit) capped at
//!   `MAX_CACHE_BYTES`, pruned after writes, at most every `PRUNE_INTERVAL`.
//! - Listen also prewarms it with what the user plays: `launcher_art_missing`
//!   tells it which keys have no image yet (`partition_missing`).

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};

/// Edge of the square images, in pixels; part of the file name.
pub const ART_SIZE: u32 = 256;
/// One 256 px image is a few tens of KiB; anything near this is not one.
pub const MAX_ART_BYTES: usize = 1024 * 1024;
pub const MAX_CACHE_BYTES: u64 = 100 * 1024 * 1024;
const PRUNE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const TEMP_MAX_AGE: Duration = Duration::from_secs(60 * 60);
const MAX_KEY_CHARS: usize = 180;
/// Hex digits of the server scope in a key.
const SCOPE_HEX_DIGITS: usize = 16;
const EXTENSIONS: [&str; 3] = ["jpg", "png", "webp"];

/// `$XDG_CACHE_HOME/crate/launcher-art`, else `$HOME/.cache/crate/launcher-art`.
/// Relative values are ignored, as the XDG spec asks.
pub fn cache_root_from(xdg_cache_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    let base = match xdg_cache_home.filter(|path| path.is_absolute()) {
        Some(cache) => cache.to_path_buf(),
        None => home.filter(|path| path.is_absolute())?.join(".cache"),
    };
    Some(base.join("crate").join("launcher-art"))
}

/// The live cache directory. Linux only: other desktops have no launcher.
pub fn cache_root() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let var = |name: &str| {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    cache_root_from(var("XDG_CACHE_HOME").as_deref(), var("HOME").as_deref())
}

/// `album:<server>:<id>` or `artist:<server>:<id>`: `<server>` is 16 lowercase
/// hex digits and the id a plain identifier (no slashes, no query characters),
/// so no URL or ticket fits in a key. A key without a server is refused: it
/// could name another server's album.
pub fn valid_key(key: &str) -> bool {
    let Some((kind, rest)) = key.split_once(':') else {
        return false;
    };
    let Some((scope, id)) = rest.split_once(':') else {
        return false;
    };
    matches!(kind, "album" | "artist")
        && scope.len() == SCOPE_HEX_DIGITS
        && scope
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && !id.is_empty()
        && key.chars().count() <= MAX_KEY_CHARS
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

fn file_stem(key: &str) -> String {
    let digest = Sha256::digest(format!("crate-launcher-art/v1/{key}/{ART_SIZE}").as_bytes());
    let hex = format!("{digest:x}");
    format!("{}-{ART_SIZE}", &hex[..32])
}

/// The cached image for `key`, if one is on disk.
pub fn lookup(root: &Path, key: &str) -> Option<PathBuf> {
    if !valid_key(key) {
        return None;
    }
    let stem = file_stem(key);
    EXTENSIONS.iter().find_map(|ext| {
        let path = root.join(format!("{stem}.{ext}"));
        fs::symlink_metadata(&path)
            .is_ok_and(|meta| meta.file_type().is_file() && meta.len() > 0)
            .then_some(path)
    })
}

/// The image format, from the magic bytes; only formats Qt reads natively.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// Write one image atomically (temp file, fsync, rename) and return its path.
pub fn store(root: &Path, key: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err("invalid art key".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_ART_BYTES {
        return Err("art must be 1 byte to 1 MiB".into());
    }
    let ext = sniff(bytes).ok_or("art must be a JPEG, PNG or WebP image")?;
    ensure_dir(root).map_err(|err| format!("art cache unavailable: {}", err.kind()))?;
    let stem = file_stem(key);
    let destination = root.join(format!("{stem}.{ext}"));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(".{stem}.{}.{nonce}.tmp", std::process::id()));
    let written = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &destination)
    })();
    if let Err(err) = written {
        let _ = fs::remove_file(&temporary);
        return Err(format!("could not write art: {}", err.kind()));
    }
    // a re-encoded image may have changed format: drop the other variants
    for other in EXTENSIONS.iter().filter(|other| **other != ext) {
        let _ = fs::remove_file(root.join(format!("{stem}.{other}")));
    }
    Ok(destination)
}

fn ensure_dir(root: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(root)
    }
}

/// Mark cache hits as recently used (LRU by mtime).
pub fn touch(paths: &[PathBuf]) {
    for path in paths {
        if let Ok(file) = OpenOptions::new().write(true).open(path) {
            let _ = file.set_modified(SystemTime::now());
        }
    }
}

/// Delete the least recently used images until the cache fits `max_bytes`,
/// and temp files a crashed writer left behind. Returns the removed images.
pub fn prune(root: &Path, max_bytes: u64) -> io::Result<Vec<PathBuf>> {
    let mut images = Vec::new();
    for entry in fs::read_dir(root)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let modified = meta.modified().unwrap_or(UNIX_EPOCH);
        if name.starts_with('.') && name.ends_with(".tmp") {
            if modified.elapsed().is_ok_and(|age| age > TEMP_MAX_AGE) {
                let _ = fs::remove_file(&path);
            }
            continue;
        }
        images.push((path, modified, meta.len()));
    }
    let mut total: u64 = images.iter().map(|(_, _, len)| len).sum();
    images.sort_by_key(|(_, modified, _)| *modified);
    let mut removed = Vec::new();
    for (path, _, len) in images {
        if total <= max_bytes {
            break;
        }
        match fs::remove_file(&path) {
            Ok(()) => removed.push(path),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
        total = total.saturating_sub(len);
    }
    Ok(removed)
}

/// Prune unless that happened less than `PRUNE_INTERVAL` ago.
pub fn prune_if_due(root: &Path) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap_or_else(|p| p.into_inner());
        if last.is_some_and(|at| at.elapsed() < PRUNE_INTERVAL) {
            return;
        }
        *last = Some(Instant::now());
    }
    let _ = prune(root, MAX_CACHE_BYTES);
}

/// At most this many keys are checked per call (prewarm sends ~300).
pub const MAX_CHECK_KEYS: usize = 1000;

/// Split `keys` into cached images (to touch) and valid keys with no image
/// yet, without duplicates, in order. Invalid keys are dropped.
pub fn partition_missing(root: &Path, keys: &[String]) -> (Vec<PathBuf>, Vec<String>) {
    let mut hits = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for key in keys.iter().take(MAX_CHECK_KEYS) {
        if !valid_key(key) || !seen.insert(key.as_str()) {
            continue;
        }
        match lookup(root, key) {
            Some(path) => hits.push(path),
            None => missing.push(key.clone()),
        }
    }
    (hits, missing)
}

/// Swap each item's internal `art_key` for `art` (an absolute path) when the
/// image is cached. Any `art` the caller sent is dropped first, so the value on
/// the wire only ever comes from here. Returns the cache hits (to touch) and
/// the keys to fetch, without duplicates.
pub fn resolve_items(
    root: Option<&Path>,
    items: &mut serde_json::Value,
) -> (Vec<PathBuf>, Vec<String>) {
    let mut hits = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for item in items.as_array_mut().into_iter().flatten() {
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        object.remove("art");
        let key = match object.remove("art_key") {
            Some(serde_json::Value::String(key)) if valid_key(&key) => key,
            _ => continue,
        };
        let Some(root) = root else { continue };
        let found = lookup(root, &key).and_then(|path| {
            let text = path.to_str()?.to_string();
            Some((path, text))
        });
        match found {
            Some((path, text)) => {
                object.insert("art".into(), text.into());
                if !hits.contains(&path) {
                    hits.push(path);
                }
            }
            None => {
                if !missing.contains(&key) {
                    missing.push(key);
                }
            }
        }
    }
    (hits, missing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "crate-launcher-art-test-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    /// Two servers' scopes (Listen derives them from the server URL).
    const S: &str = "0123456789abcdef";
    const T: &str = "fedcba9876543210";

    fn k(kind_and_id: &str) -> String {
        let (kind, id) = kind_and_id.split_once(':').unwrap();
        format!("{kind}:{S}:{id}")
    }

    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F'];
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn cache_root_follows_xdg_then_home() {
        // absolute on every OS (`/x` has no drive letter on Windows, where
        // this module also builds)
        let base = std::env::temp_dir();
        let cache = base.join("x").join("cache");
        let home = base.join("home").join("u");
        let under = |root: &Path| root.join("crate").join("launcher-art");
        assert_eq!(
            cache_root_from(Some(&cache), Some(&home)),
            Some(under(&cache))
        );
        assert_eq!(
            cache_root_from(Some(Path::new("relative")), Some(&home)),
            Some(under(&home.join(".cache")))
        );
        assert_eq!(
            cache_root_from(None, Some(&home)),
            Some(under(&home.join(".cache")))
        );
        assert_eq!(cache_root_from(None, Some(Path::new("relative"))), None);
        assert_eq!(cache_root_from(None, None), None);
    }

    #[test]
    fn keys_are_server_scoped_entity_ids_never_urls() {
        for key in [
            "album:11",
            "artist:3",
            "album:g:7f3a-b2",
            "artist:e:abc_DEF.9",
        ] {
            assert!(valid_key(&k(key)), "{key}");
        }
        for key in [
            "album:",
            "track:9",
            "album:https://x/cover?media_ticket=s3cret",
            "album:../../etc",
            "album:1?ticket=x",
            "album:1&token=x",
            "album:a b",
        ] {
            assert!(!valid_key(&k(key)), "{key}");
        }
        for key in [
            "",
            "album",
            // no server: could be any server's album 11
            "album:11",
            "artist:g:7f3a-b2",
            // the scope is 16 lowercase hex digits, nothing else
            "album:0123456789ABCDEF:11",
            "album:0123456789abcde:11",
            "album:0123456789abcdef0:11",
            "album:https//x.example:11",
        ] {
            assert!(!valid_key(key), "{key}");
        }
        assert!(valid_key(&format!("album:{S}:{}", "a".repeat(150))));
        assert!(!valid_key(&format!(
            "album:{S}:{}",
            "a".repeat(MAX_KEY_CHARS)
        )));
    }

    #[test]
    fn the_same_album_on_two_servers_has_two_images() {
        let root = temp_root("servers");
        let ours = store(&root, &format!("album:{S}:11"), JPEG).unwrap();
        assert_eq!(lookup(&root, &format!("album:{T}:11")), None);
        let theirs = store(&root, &format!("album:{T}:11"), PNG).unwrap();
        assert_ne!(ours, theirs);
        assert_eq!(fs::read(&ours).unwrap(), JPEG);
        assert_eq!(lookup(&root, &format!("album:{T}:11")), Some(theirs));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn file_names_are_a_stable_hash_of_key_and_size() {
        let stem = file_stem(&k("album:11"));
        assert_eq!(stem, file_stem(&k("album:11")));
        assert_ne!(stem, file_stem(&k("artist:11")));
        assert_ne!(stem, file_stem(&format!("album:{T}:11")));
        assert!(stem.ends_with("-256"));
        assert_eq!(stem.len(), 32 + 4);
        assert!(stem[..32].bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn sniffs_only_qt_native_formats() {
        assert_eq!(sniff(JPEG), Some("jpg"));
        assert_eq!(sniff(PNG), Some("png"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"<svg xmlns=..."), None);
        assert_eq!(sniff(b"GIF89a"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn stores_atomically_and_looks_up_by_key() {
        let root = temp_root("store");
        let key = k("album:11");
        assert_eq!(lookup(&root, &key), None);
        let path = store(&root, &key, JPEG).unwrap();
        assert_eq!(path.parent(), Some(root.as_path()));
        assert!(path.to_str().unwrap().ends_with("-256.jpg"));
        assert_eq!(fs::read(&path).unwrap(), JPEG);
        assert_eq!(lookup(&root, &key), Some(path.clone()));
        // no temp file left behind
        let names: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&root).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
        // a new format replaces the old file
        let png = store(&root, &key, PNG).unwrap();
        assert!(png.to_str().unwrap().ends_with("-256.png"));
        assert!(!path.exists());
        assert_eq!(lookup(&root, &key), Some(png));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_bad_art() {
        let root = temp_root("reject");
        assert!(store(&root, &k("album:https://x?ticket=1"), JPEG).is_err());
        assert!(store(&root, "album:1", JPEG).is_err(), "unscoped key");
        assert!(store(&root, &k("album:1"), b"<html>").is_err());
        assert!(store(&root, &k("album:1"), b"").is_err());
        let mut huge = JPEG.to_vec();
        huge.resize(MAX_ART_BYTES + 1, 0);
        assert!(store(&root, &k("album:1"), &huge).is_err());
        assert!(!root.exists() || fs::read_dir(&root).unwrap().next().is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prunes_least_recently_used_first() {
        let root = temp_root("prune");
        let mut paths = Vec::new();
        for (index, key) in ["album:1", "album:2", "album:3"].iter().enumerate() {
            let mut bytes = JPEG.to_vec();
            bytes.resize(1000, 0);
            let path = store(&root, &k(key), &bytes).unwrap();
            let at = SystemTime::now() - Duration::from_secs(100 - index as u64 * 10);
            OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(at)
                .unwrap();
            paths.push(path);
        }
        // album:1 was used most recently, so album:2 and then album:3 go first
        touch(&paths[..1]);
        let stale_tmp = root.join(".x.tmp");
        fs::write(&stale_tmp, b"partial").unwrap();
        OpenOptions::new()
            .write(true)
            .open(&stale_tmp)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(2 * 60 * 60))
            .unwrap();

        let removed = prune(&root, 1500).unwrap();
        assert_eq!(removed, vec![paths[1].clone(), paths[2].clone()]);
        assert!(paths[0].exists());
        assert!(!stale_tmp.exists());
        assert!(prune(&root, 1500).unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn partitions_keys_into_cache_hits_and_misses() {
        let root = temp_root("partition");
        let cached = store(&root, &k("album:1"), JPEG).unwrap();
        let mut keys: Vec<String> = [
            "album:1",
            "album:2",
            "artist:3",
            "album:2",
            "album:https://x?ticket=1",
            "track:4",
        ]
        .iter()
        .map(|key| k(key))
        .collect();
        keys.push("album:5".into());
        let (hits, missing) = partition_missing(&root, &keys);
        assert_eq!(hits, vec![cached]);
        assert_eq!(missing, vec![k("album:2"), k("artist:3")]);

        let many: Vec<String> = (0..MAX_CHECK_KEYS + 50)
            .map(|i| k(&format!("album:{i}")))
            .collect();
        let (_, missing) = partition_missing(&root, &many);
        assert_eq!(missing.len(), MAX_CHECK_KEYS - 1, "album:1 is cached");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_cached_art_and_reports_missing_keys() {
        let root = temp_root("resolve");
        let cached = store(&root, &k("artist:3"), PNG).unwrap();
        let mut items = json!([
            {"kind": "artist", "title": "Repion", "art_key": k("artist:3")},
            {"kind": "album", "title": "Pronto", "art_key": k("album:11"), "art": "https://x/c?media_ticket=s"},
            {"kind": "track", "title": "Barrio", "art_key": k("album:11"), "duration": 201},
            {"kind": "track", "title": "Bad", "art_key": k("album:https://x?ticket=1")},
            "not an object"
        ]);
        let (hits, missing) = resolve_items(Some(&root), &mut items);
        assert_eq!(hits, vec![cached.clone()]);
        assert_eq!(missing, vec![k("album:11")]);
        assert_eq!(items[0]["art"], cached.to_str().unwrap());
        assert!(items[0].get("art_key").is_none());
        // a caller-supplied value never survives, and a miss sends no art
        assert!(items[1].get("art").is_none());
        assert!(items[2].get("art").is_none());
        assert_eq!(items[2]["duration"], 201);
        assert!(items[3].get("art_key").is_none());
        assert!(!items.to_string().contains("ticket"));
        assert!(Path::new(items[0]["art"].as_str().unwrap()).is_absolute());

        // without a cache directory nothing resolves and nothing is fetched
        let mut items = json!([{"kind": "album", "art_key": k("album:11")}]);
        assert_eq!(resolve_items(None, &mut items), (vec![], vec![]));
        assert!(items[0].get("art_key").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
