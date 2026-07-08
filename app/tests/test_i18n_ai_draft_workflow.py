from uuid import UUID

from crate.api.schemas.i18n import I18nQualityIssueResponse, I18nQualityReportResponse


def _quality_report(*, issues: list[I18nQualityIssueResponse]):
    return I18nQualityReportResponse(
        sourceVersion="sha256:test",
        generatedAt="2026-07-08T10:00:00+00:00",
        locales=["es"],
        issueCount=len(issues),
        errorCount=sum(1 for issue in issues if issue.severity == "error"),
        warningCount=sum(1 for issue in issues if issue.severity == "warning"),
        issues=issues,
    )


def test_admin_can_queue_missing_and_stale_translation_draft(pg_db, test_app):
    from unittest.mock import patch

    request_id = "123e4567-e89b-12d3-a456-426614174000"
    created = []

    def fake_create_task(task_type, params):
        created.append((task_type, params))
        return "task-draft-1"

    with (
        patch(
            "crate.api.i18n._build_quality_report",
            return_value=_quality_report(
                issues=[
                    I18nQualityIssueResponse(
                        severity="error",
                        code="missing_key",
                        locale="es",
                        key="player.pause",
                        message="es.player.pause is missing",
                    ),
                    I18nQualityIssueResponse(
                        severity="error",
                        code="stale_translation",
                        locale="es",
                        key="settings.playback.title",
                        message="es.settings.playback.title is stale",
                    ),
                ],
            ),
        ),
        patch(
            "crate.api.i18n.upsert_translation_request",
            return_value={
                "id": UUID(request_id),
                "app": "listen",
                "locale": "es",
                "source_version": "sha256:test",
                "status": "pending",
            },
        ) as upsert,
        patch("crate.api.i18n.listen_i18n_ai_is_configured", return_value=True),
        patch("crate.api.i18n.create_task", fake_create_task),
        patch(
            "crate.api.i18n.update_translation_request_status",
            return_value={
                "id": UUID(request_id),
                "status": "drafting_ai",
                "task_id": "task-draft-1",
            },
        ),
    ):
        response = test_app.post(
            "/api/admin/i18n/listen/locales/es/draft-missing",
            json={
                "sourceVersion": "sha256:test",
                "keys": ["player.pause", "settings.playback.title"],
            },
        )

    assert response.status_code == 202
    assert response.json() == {
        "requestId": request_id,
        "status": "drafting_ai",
    }
    upsert.assert_called_once_with(
        app="listen",
        locale="es",
        source_version="sha256:test",
        client="admin",
        reason="missing-stale-keys",
    )
    assert created == [
        (
            "draft_i18n_translation",
            {
                "app": "listen",
                "locale": "es",
                "source_version": "sha256:test",
                "keys": ["player.pause", "settings.playback.title"],
            },
        )
    ]


def test_admin_rejects_draft_request_for_non_missing_or_stale_keys(pg_db, test_app):
    from unittest.mock import patch

    from crate.db.repositories.i18n import insert_translation_bundle_draft

    insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.08.base",
        messages={"player.play": "Reproducir"},
    )

    with (
        patch(
            "crate.api.i18n._build_quality_report",
            return_value=_quality_report(
                issues=[
                    I18nQualityIssueResponse(
                        severity="error",
                        code="empty_value",
                        locale="es",
                        key="player.play",
                        message="es.player.play is empty",
                    )
                ],
            ),
        ),
        patch("crate.api.i18n.create_task") as create_task,
    ):
        response = test_app.post(
            "/api/admin/i18n/listen/locales/es/draft-missing",
            json={
                "sourceVersion": "sha256:test",
                "keys": ["player.play"],
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "keys are not missing or stale"
    create_task.assert_not_called()


def test_admin_draft_request_dedupes_active_ai_draft(pg_db, test_app):
    from unittest.mock import patch

    request_id = "123e4567-e89b-12d3-a456-426614174000"

    with (
        patch(
            "crate.api.i18n._build_quality_report",
            return_value=_quality_report(
                issues=[
                    I18nQualityIssueResponse(
                        severity="error",
                        code="missing_key",
                        locale="es",
                        key="player.pause",
                        message="es.player.pause is missing",
                    )
                ],
            ),
        ),
        patch(
            "crate.api.i18n.upsert_translation_request",
            return_value={
                "id": UUID(request_id),
                "app": "listen",
                "locale": "es",
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
            "/api/admin/i18n/listen/locales/es/draft-missing",
            json={
                "sourceVersion": "sha256:test",
                "keys": ["player.pause"],
            },
        )

    assert response.status_code == 202
    assert response.json()["status"] == "drafting_ai"
    create_task.assert_not_called()
    update_status.assert_not_called()


def test_draft_i18n_translation_handler_merges_subset_keys(pg_db, monkeypatch):
    from crate.llm.prompts.i18n_translation import (
        I18nTranslatedMessage,
        I18nTranslationDraft,
    )
    from crate.worker_handlers.management import _handle_draft_i18n_translation

    monkeypatch.setattr(
        "crate.llm.prompts.i18n_translation.load_listen_source_messages",
        lambda: {"player.play": "Play", "player.pause": "Pause"},
    )
    monkeypatch.setattr(
        "crate.llm.ask_structured",
        lambda *_args, **_kwargs: I18nTranslationDraft(
            locale="es",
            messages=[
                I18nTranslatedMessage(
                    key="player.pause",
                    translation="Pausar",
                    confidence=0.95,
                )
            ],
        ),
    )

    from crate.db.queries.i18n import get_translation_bundle
    from crate.db.repositories.i18n import (
        insert_translation_bundle_draft,
        upsert_translation_request,
    )
    from crate.db.repositories.tasks import create_task

    insert_translation_bundle_draft(
        app="listen",
        locale="es",
        source_locale="en",
        source_version="sha256:test",
        bundle_version="2026.07.08.base",
        messages={"player.play": "Reproducir"},
    )
    upsert_translation_request(
        app="listen",
        locale="es",
        source_version="sha256:test",
        client="admin",
        reason="missing-stale-keys",
    )
    task_id = create_task(
        "draft_i18n_translation",
        {
            "app": "listen",
            "locale": "es",
            "source_version": "sha256:test",
            "keys": ["player.pause"],
        },
        dispatch=False,
    )

    result = _handle_draft_i18n_translation(
        task_id,
        {
            "app": "listen",
            "locale": "es",
            "source_version": "sha256:test",
            "keys": ["player.pause"],
        },
        {},
    )

    assert result["status"] == "needs_review"
    assert result["message_count"] == 2
    bundle = get_translation_bundle(result["bundle_id"])
    assert bundle is not None
    assert bundle["status"] == "needs_review"
    assert bundle["published_at"] is None
    assert bundle["messages_json"] == {
        "player.pause": "Pausar",
        "player.play": "Reproducir",
    }
