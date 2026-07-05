from datetime import datetime, timezone
from uuid import UUID
from unittest.mock import patch


def test_i18n_manifest_returns_fallback(test_app):
    with patch("crate.api.i18n.list_published_bundles", return_value=[]):
        response = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")

    assert response.status_code == 200
    body = response.json()
    assert body["app"] == "listen"
    assert body["fallbackLocale"] == "en"
    assert body["sourceVersion"] == "sha256:test"
    assert body["bundles"] == []


def test_i18n_bundle_returns_404_when_missing(test_app):
    with patch("crate.api.i18n.get_published_bundle", return_value=None):
        response = test_app.get(
            "/api/i18n/listen/bundles/es?source_version=sha256:test"
        )

    assert response.status_code == 404


def test_i18n_bundle_returns_published_messages(test_app):
    with patch(
        "crate.api.i18n.get_published_bundle",
        return_value={
            "app": "listen",
            "locale": "es",
            "source_locale": "en",
            "source_version": "sha256:test",
            "bundle_version": "2026.07.05.1",
            "messages_json": {"player.play": "Reproducir"},
        },
    ):
        response = test_app.get(
            "/api/i18n/listen/bundles/es?source_version=sha256:test"
        )

    assert response.status_code == 200
    assert response.json() == {
        "schema": "crate.i18n.bundle.v1",
        "app": "listen",
        "locale": "es",
        "sourceLocale": "en",
        "sourceVersion": "sha256:test",
        "bundleVersion": "2026.07.05.1",
        "messages": {"player.play": "Reproducir"},
    }


def test_translation_request_route_returns_request_id(test_app):
    request_id = "123e4567-e89b-12d3-a456-426614174000"
    with (
        patch(
            "crate.api.i18n.upsert_translation_request",
            return_value={
                "id": UUID(request_id),
                "app": "listen",
                "locale": "pl",
                "source_version": "sha256:test",
                "status": "pending",
                "created_at": datetime(2026, 7, 5, tzinfo=timezone.utc),
                "updated_at": datetime(2026, 7, 5, tzinfo=timezone.utc),
            },
        ) as upsert,
        patch("crate.api.i18n.listen_i18n_ai_is_configured", return_value=False),
        patch(
            "crate.api.i18n.update_translation_request_status",
            return_value={
                "id": UUID(request_id),
                "status": "manual_required",
            },
        ),
    ):
        response = test_app.post(
            "/api/i18n/listen/translation-requests",
            json={
                "detectedLocale": "pl-PL",
                "normalizedLocale": "pl",
                "sourceVersion": "sha256:test",
                "client": "web",
                "reason": "unsupported-locale",
            },
        )

    assert response.status_code == 202
    assert response.json()["requestId"] == request_id
    assert response.json()["status"] == "manual_required"
    upsert.assert_called_once_with(
        app="listen",
        locale="pl",
        source_version="sha256:test",
        client="web",
        reason="unsupported-locale",
    )


def test_translation_request_is_deduped(pg_db):
    from crate.db.repositories.i18n import upsert_translation_request

    first = upsert_translation_request(
        app="listen",
        locale="pl",
        source_version="sha256:test",
        client="web",
        reason="unsupported-locale",
    )
    second = upsert_translation_request(
        app="listen",
        locale="pl",
        source_version="sha256:test",
        client="android",
        reason="unsupported-locale",
    )

    assert first["id"] == second["id"]
    assert second["client"] == "android"


def test_translation_request_queues_task_when_ai_enabled(test_app):
    request_id = "123e4567-e89b-12d3-a456-426614174000"
    created = []

    def fake_create_task(task_type, params):
        created.append((task_type, params))
        return "task-draft-1"

    with (
        patch(
            "crate.api.i18n.upsert_translation_request",
            return_value={
                "id": UUID(request_id),
                "app": "listen",
                "locale": "pl",
                "source_version": "sha256:test",
                "status": "pending",
            },
        ),
        patch("crate.api.i18n.listen_i18n_ai_is_configured", return_value=True),
        patch("crate.api.i18n.create_task", fake_create_task),
        patch(
            "crate.api.i18n.update_translation_request_status",
            return_value={
                "id": UUID(request_id),
                "status": "drafting_ai",
                "task_id": "task-draft-1",
            },
        ) as update_status,
    ):
        response = test_app.post(
            "/api/i18n/listen/translation-requests",
            json={
                "detectedLocale": "pl-PL",
                "normalizedLocale": "pl",
                "sourceVersion": "sha256:test",
                "client": "web",
                "reason": "unsupported-locale",
            },
        )

    assert response.status_code == 202
    assert response.json()["status"] == "drafting_ai"
    assert created == [
        (
            "draft_i18n_translation",
            {"app": "listen", "locale": "pl", "source_version": "sha256:test"},
        )
    ]
    update_status.assert_called_once_with(
        app="listen",
        locale="pl",
        source_version="sha256:test",
        status="drafting_ai",
        task_id="task-draft-1",
    )


def test_translation_request_does_not_requeue_active_ai_draft(test_app):
    request_id = "123e4567-e89b-12d3-a456-426614174000"
    with (
        patch(
            "crate.api.i18n.upsert_translation_request",
            return_value={
                "id": UUID(request_id),
                "app": "listen",
                "locale": "pl",
                "source_version": "sha256:test",
                "status": "drafting_ai",
                "task_id": "task-existing",
            },
        ),
        patch("crate.api.i18n.listen_i18n_ai_is_configured", return_value=True),
        patch("crate.api.i18n.create_task") as create_task,
        patch("crate.api.i18n.update_translation_request_status") as update_status,
    ):
        response = test_app.post(
            "/api/i18n/listen/translation-requests",
            json={
                "detectedLocale": "pl-PL",
                "normalizedLocale": "pl",
                "sourceVersion": "sha256:test",
                "client": "web",
                "reason": "unsupported-locale",
            },
        )

    assert response.status_code == 202
    assert response.json()["status"] == "drafting_ai"
    create_task.assert_not_called()
    update_status.assert_not_called()


def test_listen_i18n_ai_ignores_default_ollama_without_explicit_enable(monkeypatch):
    from crate.api import i18n

    monkeypatch.delenv("CRATE_ENABLE_LISTEN_I18N_AI_DRAFTS", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setattr(
        "crate.llm.get_config",
        lambda: {"provider": "ollama", "model": "ollama/llama3.1:8b"},
    )
    monkeypatch.setattr(
        "crate.db.cache_settings.get_setting",
        lambda key, default=None: "" if key == "llm_model" else default,
    )

    assert i18n.listen_i18n_ai_is_configured() is False


def test_listen_i18n_ai_allows_explicit_non_ollama_provider(monkeypatch):
    from crate.api import i18n

    monkeypatch.setattr(
        "crate.llm.get_config",
        lambda: {"provider": "gemini", "model": "gemini/gemini-2.5-flash"},
    )
    monkeypatch.setattr(
        "crate.llm.get_provider_api_key",
        lambda provider: "key" if provider == "gemini" else None,
    )

    assert i18n.listen_i18n_ai_is_configured() is True
