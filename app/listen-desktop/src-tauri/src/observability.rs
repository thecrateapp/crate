use std::env;
use std::error::Error;
use std::sync::Arc;

const DEFAULT_TRACE_SAMPLE_RATE: f32 = 0.05;

#[derive(Debug, Clone)]
struct SentrySettings {
    service: String,
    dsn: Option<String>,
    environment: String,
    release: Option<String>,
    trace_sample_rate: f32,
}

impl SentrySettings {
    fn from_values(
        service: &str,
        dsn: Option<&str>,
        enabled: bool,
        environment: Option<&str>,
        release: Option<&str>,
        trace_sample_rate: f32,
    ) -> Self {
        Self {
            service: service.to_string(),
            dsn: enabled
                .then(|| dsn.map(str::trim).filter(|value| !value.is_empty()))
                .flatten()
                .map(str::to_string),
            environment: environment
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("development")
                .to_string(),
            release: release
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            trace_sample_rate: trace_sample_rate.clamp(0.0, 1.0),
        }
    }
}

fn load_settings(service: &str) -> SentrySettings {
    let dsn = first_non_empty(
        env::var("SENTRY_DSN").ok(),
        option_env!("SENTRY_DSN").map(str::to_string),
    );
    let environment = first_non_empty(
        env::var("SENTRY_ENVIRONMENT").ok(),
        option_env!("SENTRY_ENVIRONMENT").map(str::to_string),
    );
    let release = first_non_empty(
        env::var("SENTRY_RELEASE").ok(),
        option_env!("SENTRY_RELEASE").map(str::to_string),
    );
    let enabled = !matches!(
        env::var("SENTRY_ENABLED")
            .unwrap_or_else(|_| "true".to_string())
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "0" | "false" | "no" | "off"
    );
    let trace_sample_rate = env::var("SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .or_else(|| option_env!("SENTRY_TRACES_SAMPLE_RATE").map(str::to_string))
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(DEFAULT_TRACE_SAMPLE_RATE);

    SentrySettings::from_values(
        service,
        dsn.as_deref(),
        enabled,
        environment.as_deref(),
        release.as_deref(),
        trace_sample_rate,
    )
}

pub fn init_sentry(service: &str) -> Option<sentry::ClientInitGuard> {
    let settings = load_settings(service);
    let dsn = settings.dsn.as_deref()?.parse().ok()?;
    let before_send = Arc::new(|mut event: sentry::protocol::Event<'static>| {
        event.user = None;
        Some(event)
    });
    let guard = sentry::init(sentry::ClientOptions {
        dsn: Some(dsn),
        environment: Some(settings.environment.into()),
        release: settings.release.map(Into::into),
        send_default_pii: false,
        traces_sample_rate: settings.trace_sample_rate,
        before_send: Some(before_send),
        ..Default::default()
    });
    sentry::configure_scope(|scope| scope.set_tag("service", settings.service));
    Some(guard)
}

pub fn capture_operation_error<E>(error: &E, operation: &str)
where
    E: Error + ?Sized,
{
    let operation = operation.trim();
    let operation = if operation.is_empty() {
        "unknown"
    } else {
        operation
    };
    sentry::with_scope(
        |scope| {
            scope.set_level(Some(sentry::Level::Error));
            scope.set_fingerprint(Some(&["listen-tauri-native", operation]));
            scope.set_tag("operation", operation);
        },
        || {
            sentry::capture_error(error);
        },
    );
}

fn first_non_empty(first: Option<String>, second: Option<String>) -> Option<String> {
    first
        .filter(|value| !value.trim().is_empty())
        .or_else(|| second.filter(|value| !value.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::{capture_operation_error, SentrySettings};

    #[test]
    fn settings_disable_without_a_dsn() {
        let settings =
            SentrySettings::from_values("listen-tauri-native", None, true, None, None, 0.05);

        assert!(settings.dsn.is_none());
        assert_eq!(settings.environment, "development");
    }

    #[test]
    fn settings_clamp_sample_rate_and_keep_release_metadata() {
        let settings = SentrySettings::from_values(
            "listen-tauri-native",
            Some("https://public@example.test/1"),
            true,
            Some("production"),
            Some("crate-test"),
            2.0,
        );

        assert_eq!(settings.service, "listen-tauri-native");
        assert_eq!(settings.release.as_deref(), Some("crate-test"));
        assert_eq!(settings.trace_sample_rate, 1.0);
    }

    #[test]
    fn operation_errors_have_stable_grouping() {
        let events = sentry::test::with_captured_events(|| {
            let error = io::Error::new(io::ErrorKind::ConnectionRefused, "bridge unavailable");
            capture_operation_error(&error, "deep_link.register");
        });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].fingerprint,
            vec!["listen-tauri-native", "deep_link.register"]
        );
        assert_eq!(
            events[0].tags.get("operation").map(String::as_str),
            Some("deep_link.register")
        );
    }
}
