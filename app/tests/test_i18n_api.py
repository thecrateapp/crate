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
    with patch(
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
    ) as upsert:
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
