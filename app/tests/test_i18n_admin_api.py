import json
from uuid import uuid4

from sqlalchemy import text

from crate.db.tx import transaction_scope


def _insert_review_bundle() -> str:
    bundle_id = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO i18n_bundles (
                  id, app, locale, source_locale, source_version,
                  bundle_version, status, messages_json
                )
                VALUES (
                  :id, 'listen', 'pl', 'en', 'sha256:test',
                  'sha256:draft', 'needs_review', CAST(:messages AS jsonb)
                )
                """
            ),
            {
                "id": bundle_id,
                "messages": json.dumps({"player.play": "Odtwórz"}),
            },
        )
    return bundle_id


def test_admin_i18n_requests_lists_translation_requests(pg_db, test_app):
    payload = {
        "detectedLocale": "pl-PL",
        "normalizedLocale": "pl",
        "sourceVersion": "sha256:test",
        "client": "web",
        "reason": "unsupported-locale",
    }
    created = test_app.post("/api/i18n/listen/translation-requests", json=payload)
    assert created.status_code == 202

    response = test_app.get("/api/admin/i18n/listen/requests")

    assert response.status_code == 200
    assert response.json()["requests"] == [
        {
            "id": created.json()["requestId"],
            "app": "listen",
            "locale": "pl",
            "sourceVersion": "sha256:test",
            "client": "web",
            "reason": "unsupported-locale",
            "status": "manual_required",
            "taskId": None,
            "createdAt": response.json()["requests"][0]["createdAt"],
            "updatedAt": response.json()["requests"][0]["updatedAt"],
        }
    ]


def test_admin_i18n_bundle_detail_returns_messages(pg_db, test_app):
    bundle_id = _insert_review_bundle()

    response = test_app.get(f"/api/admin/i18n/listen/bundles/{bundle_id}")

    assert response.status_code == 200
    assert response.json() == {
        "id": bundle_id,
        "app": "listen",
        "locale": "pl",
        "sourceLocale": "en",
        "sourceVersion": "sha256:test",
        "bundleVersion": "sha256:draft",
        "status": "needs_review",
        "messages": {"player.play": "Odtwórz"},
        "createdAt": response.json()["createdAt"],
        "publishedAt": None,
    }


def test_admin_i18n_publish_exposes_bundle_to_public_manifest(pg_db, test_app):
    bundle_id = _insert_review_bundle()

    publish = test_app.post(f"/api/admin/i18n/listen/bundles/{bundle_id}/publish")

    assert publish.status_code == 200
    assert publish.json()["status"] == "published"
    assert publish.json()["publishedAt"] is not None

    manifest = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")
    assert manifest.json()["bundles"][0]["id"] == bundle_id


def test_admin_i18n_reject_hides_bundle_from_public_manifest(pg_db, test_app):
    bundle_id = _insert_review_bundle()

    reject = test_app.post(f"/api/admin/i18n/listen/bundles/{bundle_id}/reject")

    assert reject.status_code == 200
    assert reject.json()["status"] == "rejected"

    manifest = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")
    assert manifest.json()["bundles"] == []
