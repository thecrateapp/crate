use std::env;
use std::error::Error;
use std::sync::Arc;

use serde_json::Value;

const DEFAULT_TRACE_SAMPLE_RATE: f32 = 0.1;
const FILTERED: &str = "[Filtered]";

#[derive(Debug, Clone)]
pub struct SentrySettings {
    service: String,
    dsn: Option<String>,
    environment: String,
    release: Option<String>,
    trace_sample_rate: f32,
}

impl SentrySettings {
    pub fn from_values(
        service: &str,
        dsn: Option<&str>,
        enabled: bool,
        environment: Option<&str>,
        release: Option<&str>,
    ) -> Self {
        Self {
            service: service.to_string(),
            dsn: enabled.then(|| dsn.map(str::to_string)).flatten(),
            environment: environment
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("development")
                .to_string(),
            release: release
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
            trace_sample_rate: DEFAULT_TRACE_SAMPLE_RATE,
        }
    }

    pub fn with_trace_sample_rate(mut self, value: f32) -> Self {
        self.trace_sample_rate = value.clamp(0.0, 1.0);
        self
    }

    pub fn enabled(&self) -> bool {
        self.dsn.is_some()
    }

    pub fn service(&self) -> &str {
        &self.service
    }

    pub fn environment(&self) -> &str {
        &self.environment
    }

    pub fn release(&self) -> Option<&str> {
        self.release.as_deref()
    }

    pub fn trace_sample_rate(&self) -> f32 {
        self.trace_sample_rate
    }
}

pub fn load_settings(service: &str) -> SentrySettings {
    let dsn = env::var("SENTRY_DSN").ok();
    let enabled = !matches!(
        env::var("SENTRY_ENABLED")
            .unwrap_or_else(|_| "true".to_string())
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "0" | "false" | "no" | "off"
    );
    let environment = first_non_empty(
        env::var("SENTRY_ENVIRONMENT").ok(),
        env::var("CRATE_ENV").ok(),
    );
    let release = first_non_empty(
        env::var("SENTRY_RELEASE").ok(),
        env::var("GITHUB_SHA")
            .ok()
            .map(|value| format!("crate-{value}")),
    );
    let trace_sample_rate = env::var("SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(DEFAULT_TRACE_SAMPLE_RATE);

    SentrySettings::from_values(
        service,
        dsn.as_deref().filter(|value| !value.trim().is_empty()),
        enabled,
        environment.as_deref(),
        release.as_deref(),
    )
    .with_trace_sample_rate(trace_sample_rate)
}

pub fn init_sentry(service: &str) -> Option<sentry::ClientInitGuard> {
    let settings = load_settings(service);
    let dsn = settings.dsn.as_deref()?.parse().ok()?;
    let before_send = Arc::new(|mut event| {
        scrub_event(&mut event);
        Some(event)
    });
    let guard = sentry::init(sentry::ClientOptions {
        dsn: Some(dsn),
        environment: Some(settings.environment.clone().into()),
        release: settings.release.clone().map(Into::into),
        send_default_pii: false,
        traces_sample_rate: settings.trace_sample_rate,
        before_send: Some(before_send),
        ..Default::default()
    });
    sentry::configure_scope(|scope| scope.set_tag("service", settings.service));
    Some(guard)
}

pub fn capture_operation_error<E>(error: &E, operation: &str, tags: &[(&str, &str)])
where
    E: Error + ?Sized,
{
    let operation = normalized_operation(operation);
    sentry::with_scope(
        |scope| {
            scope.set_level(Some(sentry::Level::Error));
            scope.set_fingerprint(Some(&["media-worker-operation-failure", operation]));
            scope.set_tag("operation", operation);
            for (key, value) in tags {
                scope.set_tag(key, value);
            }
        },
        || {
            sentry::capture_error(error);
        },
    );
}

pub fn capture_job_failure(operation: &str, job_id: Option<&str>, errors: &[String]) {
    let operation = normalized_operation(operation);
    sentry::with_scope(
        |scope| {
            scope.set_level(Some(sentry::Level::Error));
            scope.set_fingerprint(Some(&["media-worker-job-failure", operation]));
            scope.set_tag("operation", operation);
            if let Some(job_id) = job_id {
                scope.set_extra("job_id", Value::String(job_id.to_string()));
            }
            scope.set_extra(
                "errors",
                Value::Array(errors.iter().take(10).cloned().map(Value::String).collect()),
            );
        },
        || {
            sentry::capture_message(
                &format!("Media job failed: {operation}"),
                sentry::Level::Error,
            );
        },
    );
}

fn normalized_operation(operation: &str) -> &str {
    let operation = operation.trim();
    if operation.is_empty() {
        "unknown"
    } else {
        operation
    }
}

fn scrub_event(event: &mut sentry::protocol::Event) {
    if let Some(user) = event.user.as_mut() {
        user.email = None;
        user.username = None;
        user.ip_address = None;
        user.other.clear();
    }
    for (key, value) in &mut event.extra {
        *value = scrub_payload(value.clone());
        if is_sensitive_key(key) {
            *value = Value::String(FILTERED.to_string());
        }
    }
    for key in event.tags.keys().cloned().collect::<Vec<_>>() {
        if is_sensitive_key(&key) {
            event.tags.insert(key, FILTERED.to_string());
        }
    }
}

pub fn scrub_payload(payload: Value) -> Value {
    match payload {
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    let value = if is_sensitive_key(&key) {
                        Value::String(FILTERED.to_string())
                    } else {
                        scrub_payload(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(scrub_payload).collect()),
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace('-', "_");
    [
        "authorization",
        "cookie",
        "credential",
        "password",
        "secret",
        "token",
    ]
    .iter()
    .any(|part| key.contains(part))
}

fn first_non_empty(first: Option<String>, second: Option<String>) -> Option<String> {
    first
        .filter(|value| !value.trim().is_empty())
        .or_else(|| second.filter(|value| !value.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use std::io;

    use serde_json::json;

    use super::{capture_job_failure, capture_operation_error, scrub_payload, SentrySettings};

    #[test]
    fn settings_disable_without_a_dsn() {
        let settings = SentrySettings::from_values("media-worker", None, true, None, None);

        assert!(!settings.enabled());
    }

    #[test]
    fn settings_clamp_sample_rate_and_keep_service_metadata() {
        let settings = SentrySettings::from_values(
            "media-worker",
            Some("https://public@example.test/1"),
            true,
            Some("production"),
            Some("crate-test"),
        )
        .with_trace_sample_rate(2.0);

        assert!(settings.enabled());
        assert_eq!(settings.service(), "media-worker");
        assert_eq!(settings.environment(), "production");
        assert_eq!(settings.release(), Some("crate-test"));
        assert_eq!(settings.trace_sample_rate(), 1.0);
    }

    #[test]
    fn scrub_payload_filters_credentials_recursively() {
        let payload = json!({
            "job_id": "job-123",
            "token": "secret",
            "nested": {
                "authorization": "Bearer secret",
                "path": "/data/job-123"
            },
            "items": [{"password": "secret"}]
        });

        assert_eq!(
            scrub_payload(payload),
            json!({
                "job_id": "job-123",
                "token": "[Filtered]",
                "nested": {
                    "authorization": "[Filtered]",
                    "path": "/data/job-123"
                },
                "items": [{"password": "[Filtered]"}]
            })
        );
    }

    #[test]
    fn capture_operation_error_keeps_the_original_error_and_stable_grouping() {
        let events = sentry::test::with_captured_events(|| {
            let error = io::Error::new(io::ErrorKind::ConnectionRefused, "redis unavailable");
            capture_operation_error(&error, "server.accept", &[("error_source", "listener")]);
        });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].fingerprint,
            vec!["media-worker-operation-failure", "server.accept"]
        );
        assert_eq!(
            events[0].tags.get("operation").map(String::as_str),
            Some("server.accept")
        );
        assert_eq!(
            events[0].tags.get("error_source").map(String::as_str),
            Some("listener")
        );
        assert_eq!(
            events[0].exception[0].value.as_deref(),
            Some("redis unavailable")
        );
    }

    #[test]
    fn capture_job_failure_groups_by_job_kind_and_keeps_id_in_context() {
        let events = sentry::test::with_captured_events(|| {
            capture_job_failure(
                "package.track",
                Some("job-123"),
                &["source file missing".to_string()],
            );
        });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].fingerprint,
            vec!["media-worker-job-failure", "package.track"]
        );
        assert_eq!(
            events[0].message.as_deref(),
            Some("Media job failed: package.track")
        );
        assert_eq!(
            events[0].tags.get("operation").map(String::as_str),
            Some("package.track")
        );
        assert_eq!(events[0].extra.get("job_id"), Some(&json!("job-123")));
        assert_eq!(
            events[0].extra.get("errors"),
            Some(&json!(["source file missing"]))
        );
    }
}
