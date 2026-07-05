from sqlalchemy import text


def test_i18n_translation_prompt_preserves_keys():
    from crate.llm.prompts.i18n_translation import build_i18n_translation_prompt

    prompt = build_i18n_translation_prompt(
        target_locale="es",
        messages=[
            {
                "key": "player.play",
                "source": "Play",
                "description": "Primary playback button",
            }
        ],
    )

    assert "player.play" in prompt
    assert "Do not add keys" in prompt


def test_i18n_translation_draft_rejects_extra_keys():
    from crate.llm.prompts.i18n_translation import (
        I18nTranslatedMessage,
        I18nTranslationDraft,
        validate_i18n_translation_draft,
    )

    draft = I18nTranslationDraft(
        locale="es",
        messages=[
            I18nTranslatedMessage(
                key="player.play",
                translation="Reproducir",
                confidence=0.9,
            ),
            I18nTranslatedMessage(
                key="player.pause",
                translation="Pausar",
                confidence=0.9,
            ),
        ],
    )

    try:
        validate_i18n_translation_draft(
            draft,
            expected_keys={"player.play"},
            target_locale="es",
        )
    except ValueError as exc:
        assert "extra keys" in str(exc)
    else:
        raise AssertionError("expected validation to reject extra keys")


def test_load_listen_source_messages_reads_local_catalog():
    from crate.llm.prompts.i18n_translation import load_listen_source_messages

    messages = load_listen_source_messages()

    assert messages["player.play"] == "Play"
    assert len(messages) > 50


def test_draft_i18n_translation_handler_stores_needs_review_bundle(pg_db, monkeypatch):
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
                    key="player.play",
                    translation="Reproducir",
                    confidence=0.95,
                ),
                I18nTranslatedMessage(
                    key="player.pause",
                    translation="Pausar",
                    confidence=0.95,
                ),
            ],
        ),
    )

    from crate.db.repositories.i18n import upsert_translation_request
    from crate.db.repositories.tasks import create_task

    upsert_translation_request(
        app="listen",
        locale="es",
        source_version="sha256:test",
        client="web",
        reason="unsupported-locale",
    )
    task_id = create_task(
        "draft_i18n_translation",
        {"app": "listen", "locale": "es", "source_version": "sha256:test"},
        dispatch=False,
    )

    result = _handle_draft_i18n_translation(
        task_id,
        {"app": "listen", "locale": "es", "source_version": "sha256:test"},
        {},
    )

    assert result["status"] == "needs_review"
    assert result["message_count"] == 2

    from crate.db.tx import read_scope

    with read_scope() as session:
        bundle = (
            session.execute(
                text(
                    """
                    SELECT status, messages_json
                    FROM i18n_bundles
                    WHERE app = 'listen'
                      AND locale = 'es'
                      AND source_version = 'sha256:test'
                    """
                )
            )
            .mappings()
            .one()
        )
        request = (
            session.execute(
                text(
                    """
                    SELECT status
                    FROM i18n_translation_requests
                    WHERE app = 'listen'
                      AND locale = 'es'
                      AND source_version = 'sha256:test'
                    """
                )
            )
            .mappings()
            .one()
        )

    assert bundle["status"] == "needs_review"
    assert bundle["messages_json"] == {
        "player.pause": "Pausar",
        "player.play": "Reproducir",
    }
    assert request["status"] == "needs_review"


def test_draft_i18n_translation_handler_marks_manual_required_on_llm_failure(
    pg_db,
    monkeypatch,
):
    from crate.worker_handlers.management import _handle_draft_i18n_translation

    monkeypatch.setattr(
        "crate.llm.prompts.i18n_translation.load_listen_source_messages",
        lambda: {"player.play": "Play"},
    )
    monkeypatch.setattr(
        "crate.llm.ask_structured",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("llm offline")),
    )

    from crate.db.repositories.i18n import upsert_translation_request
    from crate.db.repositories.tasks import create_task

    upsert_translation_request(
        app="listen",
        locale="es",
        source_version="sha256:test",
        client="web",
        reason="unsupported-locale",
    )
    task_id = create_task(
        "draft_i18n_translation",
        {"app": "listen", "locale": "es", "source_version": "sha256:test"},
        dispatch=False,
    )

    result = _handle_draft_i18n_translation(
        task_id,
        {"app": "listen", "locale": "es", "source_version": "sha256:test"},
        {},
    )

    assert result["status"] == "manual_required"

    from crate.db.tx import read_scope

    with read_scope() as session:
        request_status = session.execute(
            text(
                """
                SELECT status
                FROM i18n_translation_requests
                WHERE app = 'listen'
                  AND locale = 'es'
                  AND source_version = 'sha256:test'
                """
            )
        ).scalar_one()

    assert request_status == "manual_required"
