from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


def test_sentry_is_disabled_without_dsn(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.delenv("SENTRY_DSN", raising=False)

    settings = load_settings("api")

    assert settings.enabled is False
    assert settings.service == "api"


def test_sentry_settings_read_release_environment_and_sample_rate(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging")
    monkeypatch.setenv("SENTRY_RELEASE", "crate-abc123")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")
    monkeypatch.setenv("SENTRY_PROFILES_SAMPLE_RATE", "0.05")

    settings = load_settings("readplane")

    assert settings.enabled is True
    assert settings.service == "readplane"
    assert settings.environment == "staging"
    assert settings.release == "crate-abc123"
    assert settings.traces_sample_rate == 0.25
    assert settings.profiles_sample_rate == 0.05


def test_sentry_settings_clamp_invalid_sample_rates(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "not-a-rate")
    monkeypatch.setenv("SENTRY_PROFILES_SAMPLE_RATE", "2")

    settings = load_settings("workers")

    assert settings.traces_sample_rate == 0.1
    assert settings.profiles_sample_rate == 1.0


def test_sentry_scrubber_redacts_credentials_and_sensitive_query_values():
    from crate.observability.sentry import scrub_sentry_event

    event = {
        "request": {
            "url": (
                "https://api.example.test/api/cast/sessions/opaque-lease/"
                "items/item-1/stream?media_ticket=secret"
                "&artist=birds-in-row"
            ),
            "path": "/api/cast/sessions/opaque-lease/items/item-1/stream",
            "headers": {
                "Authorization": "Bearer secret",
                "Content-Type": "application/json",
            },
            "cookies": {"session": "secret"},
        },
        "user": {"id": 42, "email": "user@example.test"},
        "extra": {"refresh_token": "secret", "safe": "kept"},
    }

    scrubbed = scrub_sentry_event(event)

    assert scrubbed["request"]["url"] == (
        "https://api.example.test/api/cast/sessions/[Filtered]/items/item-1/stream"
        "?media_ticket=[Filtered]"
        "&artist=birds-in-row"
    )
    assert scrubbed["request"]["path"] == (
        "/api/cast/sessions/[Filtered]/items/item-1/stream"
    )
    assert scrubbed["request"]["headers"]["Authorization"] == "[Filtered]"
    assert scrubbed["request"]["headers"]["Content-Type"] == "application/json"
    assert scrubbed["request"]["cookies"] == "[Filtered]"
    assert scrubbed["user"] == {"id": "42"}
    assert scrubbed["extra"]["refresh_token"] == "[Filtered]"
    assert scrubbed["extra"]["safe"] == "kept"
    assert event["request"]["headers"]["Authorization"] == "Bearer secret"


def test_sentry_scrubber_redacts_bare_key_fields():
    # A provider API key once reached Sentry as the frame local `key` of
    # `setlistfm._api_get`; a field named exactly `key` is a credential.
    from crate.observability.sentry import scrub_sentry_event

    event = {
        "exception": {
            "values": [
                {
                    "stacktrace": {
                        "frames": [
                            {"vars": {"key": "provider-api-key", "endpoint": "x"}}
                        ]
                    }
                }
            ]
        },
        "extra": {"key": "provider-api-key", "cache_key": "kept"},
    }

    scrubbed = scrub_sentry_event(event)

    frame_vars = scrubbed["exception"]["values"][0]["stacktrace"]["frames"][0]["vars"]
    assert frame_vars == {"key": "[Filtered]", "endpoint": "x"}
    assert scrubbed["extra"] == {"key": "[Filtered]", "cache_key": "kept"}


def test_real_sentry_sdk_delivers_and_scrubs_events_through_before_send():
    import sentry_sdk
    from sentry_sdk.transport import Transport

    from crate.observability.sentry import filter_sentry_event

    delivered = []

    class InMemoryTransport(Transport):
        def capture_envelope(self, envelope):
            event = envelope.get_event()
            if event is not None:
                delivered.append(event)

    client = sentry_sdk.Client(
        dsn="https://public@example.invalid/1",
        transport=InMemoryTransport,
        default_integrations=False,
        auto_enabling_integrations=False,
        send_default_pii=False,
        before_send=filter_sentry_event,
    )
    try:
        with sentry_sdk.isolation_scope() as scope:
            scope.set_client(client)
            scope.set_user({"id": "42", "email": "private@example.invalid"})
            scope.set_extra("refresh_token", "private-refresh-token")
            scope.set_extra("operation", "observability-regression")
            event_id = sentry_sdk.capture_message(
                "Crate SDK delivery regression", level="info"
            )

        assert event_id is not None, "before_send must accept the SDK's event and hint"
        assert len(delivered) == 1
        assert delivered[0]["event_id"] == event_id
        assert delivered[0]["level"] == "info"
        assert delivered[0]["user"] == {"id": "42"}
        assert delivered[0]["extra"]["refresh_token"] == "[Filtered]"
        assert delivered[0]["extra"]["operation"] == "observability-regression"
    finally:
        client.close()


def _setlist_rate_limit_exc_info():
    from crate.setlistfm import SetlistProviderRateLimited

    try:
        raise SetlistProviderRateLimited(30.0)
    except SetlistProviderRateLimited:
        return sys.exc_info()


def test_filter_sentry_event_drops_provider_rate_limits():
    from crate.observability.sentry import filter_sentry_event

    exc_info = _setlist_rate_limit_exc_info()
    record = logging.LogRecord(
        "dramatiq.worker.WorkerThread",
        logging.ERROR,
        __file__,
        1,
        "Failed to process message %s with unhandled exception.",
        ("refresh_probable_setlist",),
        exc_info,
    )

    assert filter_sentry_event({"level": "error"}, {"exc_info": exc_info}) is None
    assert (
        filter_sentry_event(
            {"level": "error"}, {"exc_info": exc_info, "log_record": record}
        )
        is None
    )


def test_filter_sentry_event_scrubs_and_keeps_other_errors():
    from crate.observability.sentry import filter_sentry_event
    from crate.setlistfm import SetlistProviderUnavailable

    try:
        raise SetlistProviderUnavailable("Setlist.fm returned HTTP 503")
    except SetlistProviderUnavailable:
        exc_info = sys.exc_info()

    event = {"level": "error", "extra": {"refresh_token": "secret"}}

    assert filter_sentry_event(event, {"exc_info": exc_info}) == {
        "level": "error",
        "extra": {"refresh_token": "[Filtered]"},
    }
    assert filter_sentry_event(event, None) == {
        "level": "error",
        "extra": {"refresh_token": "[Filtered]"},
    }


def test_real_sentry_sdk_never_sends_provider_rate_limits_from_any_capture_path():
    """The task helper and Dramatiq's own error log of the same exception."""
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.transport import Transport

    from crate.observability.sentry import filter_sentry_event
    from crate.setlistfm import SetlistProviderRateLimited

    delivered = []

    class InMemoryTransport(Transport):
        def capture_envelope(self, envelope):
            event = envelope.get_event()
            if event is not None:
                delivered.append(event)

    client = sentry_sdk.Client(
        dsn="https://public@example.invalid/1",
        transport=InMemoryTransport,
        default_integrations=False,
        auto_enabling_integrations=False,
        integrations=[LoggingIntegration(level=None, event_level=logging.ERROR)],
        before_send=filter_sentry_event,
    )
    dramatiq_log = logging.getLogger("dramatiq.worker.WorkerThread")
    try:
        with sentry_sdk.isolation_scope() as scope:
            scope.set_client(client)
            for error in (SetlistProviderRateLimited(60.0), RuntimeError("boom")):
                try:
                    raise error
                except Exception as exc:
                    sentry_sdk.capture_exception(exc)
                    dramatiq_log.error(
                        "Failed to process message %s with unhandled exception.",
                        "refresh_probable_setlist('task-1')",
                        exc_info=True,
                    )

        assert [event["exception"]["values"][-1]["type"] for event in delivered] == [
            "RuntimeError",
            "RuntimeError",
        ]
    finally:
        client.close()


def test_sentry_scrubber_redacts_opensubsonic_query_and_form_credentials():
    from crate.observability.sentry import scrub_sentry_event

    event = {
        "request": {
            "url": (
                "https://api.example.test/rest/ping?u=listener&p=plain"
                "&T=challenge&S=salt&APIKEY=secret&c=feishin"
            ),
            "headers": {"Content-Type": "application/x-www-form-urlencoded"},
            "data": "u=listener&p=plain&T=challenge&S=salt&APIKEY=secret&f=json",
        }
    }

    scrubbed = scrub_sentry_event(event)

    assert scrubbed["request"]["url"] == (
        "https://api.example.test/rest/ping?u=listener&p=[Filtered]"
        "&T=[Filtered]&S=[Filtered]&APIKEY=[Filtered]&c=feishin"
    )
    assert scrubbed["request"]["data"] == (
        "u=listener&p=[Filtered]&T=[Filtered]&S=[Filtered]&APIKEY=[Filtered]&f=json"
    )


def test_sentry_scrubber_drops_multipart_form_body():
    from crate.observability.sentry import scrub_sentry_event

    scrubbed = scrub_sentry_event(
        {
            "request": {
                "headers": {"content-type": "multipart/form-data; boundary=abc"},
                "data": '--abc\r\nname="p"\r\n\r\nsecret\r\n--abc--',
            }
        }
    )

    assert scrubbed["request"]["data"] == "[Filtered]"


def test_sentry_scrubber_detects_urlencoded_credentials_without_content_type():
    from crate.observability.sentry import scrub_sentry_event

    scrubbed = scrub_sentry_event(
        {"request": {"data": "u=listener&p=plain&apiKey=secret"}}
    )

    assert scrubbed["request"]["data"] == ("u=listener&p=[Filtered]&apiKey=[Filtered]")


def test_sentry_scrubber_redacts_embedded_subsonic_urls_in_breadcrumbs_and_exceptions():
    from crate.observability.sentry import scrub_sentry_event

    scrubbed = scrub_sentry_event(
        {
            "breadcrumbs": {
                "values": [
                    {
                        "message": (
                            "Request failed: https://api.example.test/rest/ping"
                            "?u=listener&p=plain&apiKey=secret"
                        )
                    }
                ]
            },
            "exception": {
                "values": [
                    {
                        "value": (
                            "GET /rest/ping?u=listener&T=challenge&S=salt returned 500"
                        )
                    }
                ]
            },
        }
    )

    breadcrumb = scrubbed["breadcrumbs"]["values"][0]["message"]
    exception = scrubbed["exception"]["values"][0]["value"]
    assert "p=[Filtered]" in breadcrumb
    assert "apiKey=[Filtered]" in breadcrumb
    assert "plain" not in breadcrumb
    assert "T=[Filtered]" in exception
    assert "S=[Filtered]" in exception
    assert "challenge" not in exception
    assert "salt" not in exception


def test_sentry_scrubber_preserves_short_non_subsonic_query_parameters():
    from crate.observability.sentry import scrub_sentry_event

    scrubbed = scrub_sentry_event(
        {
            "request": {
                "url": "https://api.example.test/api/catalog?p=2&s=similarity&t=recent"
            }
        }
    )

    assert scrubbed["request"]["url"] == (
        "https://api.example.test/api/catalog?p=2&s=similarity&t=recent"
    )


def test_init_sentry_configures_sdk_once(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "development")

    init_calls: list[dict] = []
    tags: list[tuple[str, str]] = []
    monkeypatch.setattr(sentry, "_entry_point_service", None)
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: False)
    monkeypatch.setattr(
        sentry.sentry_sdk, "init", lambda **kwargs: init_calls.append(kwargs)
    )
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "set_tag",
        lambda key, value: tags.append((key, value)),
    )

    assert sentry.init_sentry("api") is True

    assert len(init_calls) == 1
    assert init_calls[0]["dsn"] == "https://public@example.ingest.sentry.io/1"
    assert init_calls[0]["send_default_pii"] is False
    assert init_calls[0]["before_send"] is sentry.filter_sentry_event
    assert tags == [("service", "api")]


def test_init_sentry_never_sends_frame_local_variables(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    init_calls: list[dict] = []
    monkeypatch.setattr(sentry, "_entry_point_service", None)
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: False)
    monkeypatch.setattr(
        sentry.sentry_sdk, "init", lambda **kwargs: init_calls.append(kwargs)
    )
    monkeypatch.setattr(sentry.sentry_sdk, "set_tag", lambda key, value: None)

    assert sentry.init_sentry("workers") is True

    assert init_calls[0]["include_local_variables"] is False


def _fake_sentry_sdk_state(monkeypatch, sentry) -> dict:
    state: dict = {"initialized": False, "init_calls": 0, "service": None}

    def init(**_kwargs):
        state["initialized"] = True
        state["init_calls"] += 1

    def set_tag(key, value):
        if key == "service":
            state["service"] = value

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setattr(sentry, "_entry_point_service", None)
    monkeypatch.setattr(
        sentry.sentry_sdk, "is_initialized", lambda: state["initialized"]
    )
    monkeypatch.setattr(sentry.sentry_sdk, "init", init)
    monkeypatch.setattr(sentry.sentry_sdk, "set_tag", set_tag)
    return state


def test_module_init_after_entry_point_keeps_entry_point_service(monkeypatch):
    from crate.observability import sentry

    state = _fake_sentry_sdk_state(monkeypatch, sentry)

    assert sentry.init_sentry("api") is True
    assert sentry.init_sentry("workers", entry_point=False) is True

    assert state == {"initialized": True, "init_calls": 1, "service": "api"}


def test_entry_point_after_module_init_claims_the_service(monkeypatch):
    from crate.observability import sentry

    state = _fake_sentry_sdk_state(monkeypatch, sentry)

    assert sentry.init_sentry("workers", entry_point=False) is True
    assert sentry.init_sentry("api") is True

    assert state == {"initialized": True, "init_calls": 1, "service": "api"}


def test_module_init_tags_a_process_without_an_entry_point(monkeypatch):
    from crate.observability import sentry

    state = _fake_sentry_sdk_state(monkeypatch, sentry)
    monkeypatch.setenv("SENTRY_SERVICE", "worker-default")

    assert (
        sentry.init_sentry(sentry.resolve_service_name("workers"), entry_point=False)
        is True
    )

    assert state["service"] == "worker-default"


_SERVICE_TAG_PROBE = """
import json
import sys

import sentry_sdk
from sentry_sdk.transport import Transport

delivered = []


class InMemoryTransport(Transport):
    def capture_envelope(self, envelope):
        event = envelope.get_event()
        if event is not None:
            delivered.append(event)


real_init = sentry_sdk.init


def init(**kwargs):
    kwargs.update(
        transport=InMemoryTransport,
        default_integrations=False,
        auto_enabling_integrations=False,
    )
    return real_init(**kwargs)


sentry_sdk.init = init

from crate.observability import init_sentry, resolve_service_name

for step in sys.argv[1:]:
    if step == "import-broker":
        import crate.broker  # noqa: F401
    else:
        init_sentry(resolve_service_name("workers") if step == "worker" else step)

sentry_sdk.capture_message("service tag probe", level="info")
print(json.dumps(delivered[-1]["tags"].get("service")))
"""


@pytest.mark.parametrize(
    ("steps", "sentry_service", "expected"),
    [
        (["api", "import-broker"], None, "api"),
        (["import-broker", "api"], None, "api"),
        (["import-broker"], "worker-default", "worker-default"),
        (["worker", "import-broker"], "worker-maintenance", "worker-maintenance"),
        (["projector", "import-broker"], None, "projector"),
    ],
)
def test_importing_the_broker_never_overwrites_the_process_service_tag(
    steps, sentry_service, expected
):
    """Real imports in a fresh interpreter: the API keeps service=api."""
    app_dir = Path(__file__).resolve().parents[1]
    env = {**os.environ, "SENTRY_DSN": "https://public@example.invalid/1"}
    env["PYTHONPATH"] = os.pathsep.join(
        filter(None, [str(app_dir), env.get("PYTHONPATH")])
    )
    env.pop("SENTRY_ENABLED", None)
    env.pop("SENTRY_SERVICE", None)
    if sentry_service:
        env["SENTRY_SERVICE"] = sentry_service

    result = subprocess.run(
        [sys.executable, "-c", _SERVICE_TAG_PROBE, *steps],
        cwd=app_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout.strip().splitlines()[-1]) == expected


def test_init_sentry_does_not_initialize_without_dsn(monkeypatch):
    from crate.observability import sentry

    monkeypatch.delenv("SENTRY_DSN", raising=False)

    with patch.object(sentry.sentry_sdk, "init") as init:
        assert sentry.init_sentry("workers") is False
        init.assert_not_called()


def test_resolve_service_name_prefers_runtime_override(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setenv("SENTRY_SERVICE", "worker-maintenance")

    assert sentry.resolve_service_name("workers") == "worker-maintenance"


def test_resolve_service_name_falls_back_when_override_is_blank(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setenv("SENTRY_SERVICE", "  ")

    assert sentry.resolve_service_name("workers") == "workers"


def test_task_scope_adds_low_cardinality_tags_and_task_context(monkeypatch):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.contexts = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

        def set_context(self, key, value):
            self.contexts.append((key, value))

    class FakeSpan:
        def __init__(self):
            self.data = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_data(self, key, value):
            self.data.append((key, value))

    scope = FakeScope()
    span = FakeSpan()
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    transactions: list[dict] = []
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "start_transaction",
        lambda **kwargs: (transactions.append(kwargs), span)[1],
        raising=False,
    )

    with sentry.task_scope("bandcamp_radar_refresh", "task-123", "maintenance"):
        pass

    assert scope.tags == [
        ("task_type", "bandcamp_radar_refresh"),
        ("queue", "maintenance"),
    ]
    assert scope.contexts == [
        ("task", {"id": "task-123", "type": "bandcamp_radar_refresh"})
    ]
    assert transactions == [{"op": "queue.process", "name": "bandcamp_radar_refresh"}]
    assert span.data == [("task_id", "task-123"), ("queue", "maintenance")]


def test_task_scope_is_a_noop_when_sentry_is_disabled(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: False)

    with sentry.task_scope("scan", "task-123", "maintenance") as span:
        assert span is None


def test_capture_task_failure_groups_by_task_type_and_keeps_id_out_of_tags(
    monkeypatch,
):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.contexts = []
            self.fingerprint = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

        def set_context(self, key, value):
            self.contexts.append((key, value))

    scope = FakeScope()
    messages: list[tuple[str, str]] = []
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "capture_message",
        lambda message, level: messages.append((message, level)),
    )

    sentry.capture_task_failure(
        "tidal_download",
        "task-123",
        "default",
        "upstream rejected request",
        retry_count=2,
        max_retries=3,
    )

    assert messages == [("Worker task failed: tidal_download", "error")]
    assert scope.fingerprint == ["worker-task-failure", "tidal_download"]
    assert ("task_type", "tidal_download") in scope.tags
    assert ("queue", "default") in scope.tags
    assert all(key != "task_id" for key, _value in scope.tags)
    assert scope.contexts == [
        (
            "task",
            {
                "id": "task-123",
                "type": "tidal_download",
                "queue": "default",
                "reason": "upstream rejected request",
                "retry_count": 2,
                "max_retries": 3,
            },
        )
    ]


def test_capture_handled_http_error_groups_by_route_without_query_data(monkeypatch):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.contexts = []
            self.fingerprint = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

        def set_context(self, key, value):
            self.contexts.append((key, value))

    scope = FakeScope()
    messages: list[tuple[str, str]] = []
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "capture_message",
        lambda message, level: messages.append((message, level)),
    )

    sentry.capture_handled_http_error(
        method="GET",
        route="/rest/getAlbum.view",
        status_code=500,
    )

    assert messages == [("Handled HTTP 500: GET /rest/getAlbum.view", "error")]
    assert scope.fingerprint == [
        "handled-http-error",
        "GET",
        "/rest/getAlbum.view",
        "500",
    ]
    assert ("protocol", "opensubsonic") in scope.tags
    assert scope.contexts == [
        (
            "http_response",
            {"method": "GET", "route": "/rest/getAlbum.view", "status_code": 500},
        )
    ]


def test_capture_background_exception_groups_by_operation_and_error_type(monkeypatch):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.fingerprint = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

    scope = FakeScope()
    captured: list[Exception] = []
    error = RuntimeError("redis unavailable")
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    monkeypatch.setattr(
        sentry.sentry_sdk, "capture_exception", lambda exc: captured.append(exc)
    )

    sentry.capture_background_exception(error, "projector.iteration")

    assert captured == [error]
    assert scope.fingerprint == [
        "background-operation-failure",
        "projector.iteration",
        "RuntimeError",
    ]
    assert scope.tags == [
        ("operation", "projector.iteration"),
        ("error_type", "RuntimeError"),
    ]


def test_capture_task_exception_keeps_original_exception_and_task_context(monkeypatch):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.contexts = []
            self.fingerprint = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

        def set_context(self, key, value):
            self.contexts.append((key, value))

    scope = FakeScope()
    captured: list[BaseException] = []
    error = RuntimeError("database unavailable")
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    monkeypatch.setattr(
        sentry.sentry_sdk, "capture_exception", lambda exc: captured.append(exc)
    )

    sentry.capture_task_exception(
        error,
        task_type="library_sync",
        task_id="task-456",
        queue="maintenance",
        retry_count=1,
        max_retries=2,
    )

    assert captured == [error]
    assert scope.fingerprint == [
        "worker-task-exception",
        "library_sync",
        "RuntimeError",
    ]
    assert scope.contexts == [
        (
            "task",
            {
                "id": "task-456",
                "type": "library_sync",
                "queue": "maintenance",
                "retry_count": 1,
                "max_retries": 2,
            },
        )
    ]
