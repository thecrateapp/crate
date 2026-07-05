from fastapi import HTTPException


def test_admin_i18n_requests_requires_admin(test_app):
    from unittest.mock import patch

    with patch(
        "crate.api.i18n._require_admin",
        side_effect=HTTPException(status_code=403, detail="forbidden"),
    ):
        response = test_app.get("/api/admin/i18n/listen/requests")

    assert response.status_code == 403


def test_admin_i18n_lists_translation_requests(pg_db, test_app):
    from crate.db.repositories.i18n import upsert_translation_request

    request = upsert_translation_request(
        app="listen",
        locale="pl",
        source_version="sha256:test",
        client="web",
        reason="unsupported-locale",
    )

    response = test_app.get("/api/admin/i18n/listen/requests")

    assert response.status_code == 200
    assert response.json()["requests"] == [
        {
            "id": str(request["id"]),
            "app": "listen",
            "locale": "pl",
            "sourceVersion": "sha256:test",
            "client": "web",
            "reason": "unsupported-locale",
            "status": "pending",
            "taskId": None,
            "createdAt": request["created_at"].isoformat(),
            "updatedAt": request["updated_at"].isoformat(),
        }
    ]


def test_admin_i18n_gets_and_publishes_bundle(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    bundle = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.1",
        messages={"player.play": "Reproducir"},
    )

    detail = test_app.get(f"/api/admin/i18n/listen/bundles/{bundle['id']}")

    assert detail.status_code == 200
    assert detail.json()["messages"] == {"player.play": "Reproducir"}

    published = test_app.post(f"/api/admin/i18n/listen/bundles/{bundle['id']}/publish")

    assert published.status_code == 200
    body = published.json()
    assert body["status"] == "published"
    assert body["publishedAt"] is not None

    manifest = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")
    assert manifest.json()["bundles"] == [
        {
            "locale": "es",
            "sourceVersion": "sha256:test",
            "bundleVersion": "2026.07.05.1",
            "publishedAt": body["publishedAt"],
        }
    ]


def test_admin_i18n_lists_reviewable_bundles(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    draft = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.1",
        messages={"player.play": "Reproducir"},
    )
    published = insert_translation_bundle_draft(
        app="listen",
        locale="fr",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.2",
        messages={"player.play": "Lire"},
    )
    assert (
        test_app.post(
            f"/api/admin/i18n/listen/bundles/{published['id']}/publish"
        ).status_code
        == 200
    )

    response = test_app.get("/api/admin/i18n/listen/bundles?status=needs_review")

    assert response.status_code == 200
    assert response.json()["bundles"] == [
        {
            "id": str(draft["id"]),
            "app": "listen",
            "locale": "es",
            "sourceLocale": "en",
            "sourceVersion": "sha256:test",
            "bundleVersion": "2026.07.05.1",
            "status": "needs_review",
            "messageCount": 1,
            "createdAt": draft["created_at"].isoformat(),
            "publishedAt": None,
        }
    ]


def test_admin_i18n_publish_supersedes_previous_bundle(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    first = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.1",
        messages={"player.play": "Reproducir"},
    )
    second = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.2",
        messages={"player.play": "Dale"},
    )

    assert (
        test_app.post(
            f"/api/admin/i18n/listen/bundles/{first['id']}/publish"
        ).status_code
        == 200
    )
    assert (
        test_app.post(
            f"/api/admin/i18n/listen/bundles/{second['id']}/publish"
        ).status_code
        == 200
    )

    manifest = test_app.get("/api/i18n/listen/manifest?source_version=sha256:test")

    assert [bundle["bundleVersion"] for bundle in manifest.json()["bundles"]] == [
        "2026.07.05.2"
    ]


def test_admin_i18n_rejects_bundle(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    bundle = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.05.1",
        messages={"player.play": "Reproducir"},
    )

    response = test_app.post(f"/api/admin/i18n/listen/bundles/{bundle['id']}/reject")

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"

    public_bundle = test_app.get(
        "/api/i18n/listen/bundles/es?source_version=sha256:test"
    )
    assert public_bundle.status_code == 404
