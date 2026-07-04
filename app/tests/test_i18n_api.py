import json
from uuid import uuid4

from sqlalchemy import text

from crate.db.tx import transaction_scope


def test_i18n_manifest_returns_fallback(pg_db, test_app):
    response = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")

    assert response.status_code == 200
    body = response.json()
    assert body["app"] == "listen"
    assert body["fallbackLocale"] == "en"
    assert body["sourceVersion"] == "sha256:test"
    assert body["bundles"] == []


def test_i18n_manifest_exposes_latest_published_bundle(pg_db, test_app):
    older_id = str(uuid4())
    latest_id = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO i18n_bundles (
                  id, app, locale, source_locale, source_version,
                  bundle_version, status, messages_json, published_at
                )
                VALUES
                  (:older_id, 'listen', 'es', 'en', 'sha256:test',
                   'sha256:old', 'published', CAST(:old_messages AS jsonb), NOW() - INTERVAL '1 hour'),
                  (:latest_id, 'listen', 'es', 'en', 'sha256:test',
                   'sha256:new', 'published', CAST(:new_messages AS jsonb), NOW())
                """
            ),
            {
                "older_id": older_id,
                "latest_id": latest_id,
                "old_messages": json.dumps({"player.play": "Reproducir"}),
                "new_messages": json.dumps({"player.play": "Dale"}),
            },
        )

    response = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")

    assert response.status_code == 200
    assert response.json()["bundles"] == [
        {
            "id": latest_id,
            "locale": "es",
            "bundleVersion": "sha256:new",
            "publishedAt": response.json()["bundles"][0]["publishedAt"],
        }
    ]


def test_i18n_bundle_returns_published_messages(pg_db, test_app):
    bundle_id = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO i18n_bundles (
                  id, app, locale, source_locale, source_version,
                  bundle_version, status, messages_json, published_at
                )
                VALUES (
                  :id, 'listen', 'es', 'en', 'sha256:test',
                  'sha256:bundle', 'published', CAST(:messages AS jsonb), NOW()
                )
                """
            ),
            {
                "id": bundle_id,
                "messages": json.dumps({"player.play": "Reproducir"}),
            },
        )

    response = test_app.get(
        "/api/i18n/listen/bundles/es?source_version=sha256:test"
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": bundle_id,
        "app": "listen",
        "locale": "es",
        "sourceLocale": "en",
        "sourceVersion": "sha256:test",
        "bundleVersion": "sha256:bundle",
        "messages": {"player.play": "Reproducir"},
    }


def test_i18n_bundle_returns_404_without_published_bundle(pg_db, test_app):
    response = test_app.get(
        "/api/i18n/listen/bundles/es?source_version=sha256:test"
    )

    assert response.status_code == 404


def test_translation_request_is_deduped(pg_db, test_app):
    payload = {
        "detectedLocale": "pl-PL",
        "normalizedLocale": "pl",
        "sourceVersion": "sha256:test",
        "client": "web",
        "reason": "unsupported-locale",
    }

    first = test_app.post("/api/i18n/listen/translation-requests", json=payload)
    second = test_app.post("/api/i18n/listen/translation-requests", json=payload)

    assert first.status_code == 202
    assert second.status_code == 200
    assert first.json()["requestId"] == second.json()["requestId"]
    assert first.json()["status"] == "manual_required"
    assert second.json()["status"] == "manual_required"
