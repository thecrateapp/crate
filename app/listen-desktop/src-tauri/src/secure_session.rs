use keyring::v1::{Entry, Error as KeyringError};

const MAX_KEY_BYTES: usize = 255;
const MAX_VALUE_BYTES: usize = 64 * 1024;

fn keyring_service_name(identifier: &str, is_dev: bool) -> String {
    if is_dev {
        format!("{identifier}.dev")
    } else {
        identifier.to_owned()
    }
}

fn validate_secure_session_key(key: &str) -> Result<(), String> {
    let Some(suffix) = key
        .strip_prefix("crate.session.")
        .or_else(|| key.strip_prefix("crate.oauth."))
    else {
        return Err("invalid secure session key".into());
    };
    if key.len() > MAX_KEY_BYTES
        || suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
    {
        return Err("invalid secure session key".into());
    }
    Ok(())
}

fn validate_secure_session_value(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES || serde_json::from_str::<serde_json::Value>(value).is_err() {
        return Err("invalid secure session value".into());
    }
    Ok(())
}

fn secure_entry(service: &str, key: &str) -> Result<Entry, String> {
    validate_secure_session_key(key)?;
    Entry::new(service, key).map_err(|_| "secure session store unavailable".into())
}

fn read_secure_session(service: &str, key: &str) -> Result<Option<String>, String> {
    let entry = secure_entry(service, key)?;
    match entry.get_password() {
        Ok(value) if value.len() <= MAX_VALUE_BYTES => Ok(Some(value)),
        Ok(_) => Err("invalid secure session value".into()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("secure session store unavailable".into()),
    }
}

fn write_secure_session(service: &str, key: &str, value: &str) -> Result<(), String> {
    validate_secure_session_value(value)?;
    secure_entry(service, key)?
        .set_password(value)
        .map_err(|_| "secure session store unavailable".into())
}

fn remove_secure_session(service: &str, key: &str) -> Result<(), String> {
    match secure_entry(service, key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("secure session store unavailable".into()),
    }
}

#[tauri::command]
pub async fn secure_session_get(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let service = keyring_service_name(&app.config().identifier, cfg!(debug_assertions));
    tauri::async_runtime::spawn_blocking(move || read_secure_session(&service, &key))
        .await
        .map_err(|_| "secure session command failed".to_string())?
}

#[tauri::command]
pub async fn secure_session_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let service = keyring_service_name(&app.config().identifier, cfg!(debug_assertions));
    tauri::async_runtime::spawn_blocking(move || write_secure_session(&service, &key, &value))
        .await
        .map_err(|_| "secure session command failed".to_string())?
}

#[tauri::command]
pub async fn secure_session_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let service = keyring_service_name(&app.config().identifier, cfg!(debug_assertions));
    tauri::async_runtime::spawn_blocking(move || remove_secure_session(&service, &key))
        .await
        .map_err(|_| "secure session command failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{keyring_service_name, validate_secure_session_key, validate_secure_session_value};

    #[test]
    fn isolates_development_keyring_entries_from_release_entries() {
        assert_eq!(
            keyring_service_name("app.cratemusic.crate.desktop", true),
            "app.cratemusic.crate.desktop.dev"
        );
        assert_eq!(
            keyring_service_name("app.cratemusic.crate.desktop", false),
            "app.cratemusic.crate.desktop"
        );
    }

    #[test]
    fn accepts_only_namespaced_session_and_oauth_keys() {
        assert!(validate_secure_session_key("crate.session.server-1").is_ok());
        assert!(validate_secure_session_key("crate.oauth.link.pending-callback").is_ok());
        assert!(validate_secure_session_key("crate.oauth.abc_123~-xyz").is_ok());
        assert!(validate_secure_session_key("server-1").is_err());
        assert!(validate_secure_session_key("crate.session.").is_err());
        assert!(validate_secure_session_key("crate.session.one/other").is_err());
        assert!(validate_secure_session_key(&format!("crate.oauth.{}", "a".repeat(256))).is_err());
    }

    #[test]
    fn accepts_bounded_json_values_only() {
        assert!(validate_secure_session_value("{\"token\":\"secret\"}").is_ok());
        assert!(validate_secure_session_value("not-json").is_err());
        assert!(validate_secure_session_value(&" ".repeat(64 * 1024 + 1)).is_err());
    }
}
