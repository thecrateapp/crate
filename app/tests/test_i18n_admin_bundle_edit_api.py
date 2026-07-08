def test_admin_i18n_import_json_creates_review_bundle(pg_db, test_app):
    response = test_app.post(
        "/api/admin/i18n/listen/bundles/import",
        json={
            "locale": "es",
            "sourceVersion": "sha256:test",
            "bundleVersion": "2026.07.07.manual",
            "messages": {"player.play": "Reproducir"},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["locale"] == "es"
    assert body["sourceLocale"] == "en"
    assert body["sourceVersion"] == "sha256:test"
    assert body["bundleVersion"] == "2026.07.07.manual"
    assert body["status"] == "needs_review"
    assert body["messages"] == {"player.play": "Reproducir"}


def test_admin_i18n_patch_updates_one_bundle_message(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    bundle = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.07.manual",
        messages={"player.play": "Reproducir", "player.pause": "Pausar"},
    )

    response = test_app.patch(
        f"/api/admin/i18n/listen/bundles/{bundle['id']}/messages/player.play",
        json={"value": "Dale"},
    )

    assert response.status_code == 200
    assert response.json()["messages"] == {
        "player.play": "Dale",
        "player.pause": "Pausar",
    }


def test_admin_i18n_export_returns_bundle_messages(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    bundle = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.07.manual",
        messages={"player.play": "Reproducir"},
    )

    response = test_app.get(f"/api/admin/i18n/listen/bundles/{bundle['id']}/export")

    assert response.status_code == 200
    assert response.json() == {
        "schema": "crate.i18n.bundle.export.v1",
        "locale": "es",
        "sourceVersion": "sha256:test",
        "bundleVersion": "2026.07.07.manual",
        "messages": {"player.play": "Reproducir"},
    }


def test_admin_i18n_publish_rejects_quality_errors(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    bundle = insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.07.manual",
        messages={"player.play": ""},
    )

    response = test_app.post(f"/api/admin/i18n/listen/bundles/{bundle['id']}/publish")

    assert response.status_code == 409
    assert response.json()["detail"] == "i18n bundle has quality errors"
