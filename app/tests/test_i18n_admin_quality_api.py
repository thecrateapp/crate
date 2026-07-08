def test_admin_i18n_quality_report_returns_common_shape(pg_db, test_app):
    response = test_app.get(
        "/api/admin/i18n/listen/quality?locale=es&source_version=sha256:test"
    )

    assert response.status_code == 200
    assert response.json()["schema"] == "crate.listen.i18n.quality.v1"
    assert response.json()["sourceVersion"] == "sha256:test"
    assert response.json()["locales"] == ["es"]
    assert response.json()["warningCount"] == 1


def test_admin_i18n_quality_report_flags_empty_bundle_values(pg_db, test_app):
    from crate.db.repositories.i18n import insert_translation_bundle_draft

    insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.07.1",
        messages={"player.play": ""},
    )

    response = test_app.get(
        "/api/admin/i18n/listen/quality?locale=es&source_version=sha256:test"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["errorCount"] == 1
    assert body["issues"] == [
        {
            "severity": "error",
            "code": "empty_value",
            "locale": "es",
            "key": "player.play",
            "message": "Translation value is empty.",
            "source": None,
            "value": "",
            "file": None,
        }
    ]
