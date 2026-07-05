import os

from fastapi import APIRouter, HTTPException, Query, Request, status

from crate.api.auth import _require_admin
from crate.api.schemas.i18n import (
    I18nBundleResponse,
    I18nManifestBundle,
    I18nManifestResponse,
    I18nTranslationRequestCreate,
    I18nTranslationRequestResponse,
)
from crate.db.queries.i18n import (
    get_published_bundle,
    get_translation_bundle,
    list_published_bundles,
    list_translation_bundles,
    list_translation_requests,
)
from crate.db.repositories.i18n import (
    publish_translation_bundle,
    reject_translation_bundle,
    update_translation_request_status,
    upsert_translation_request,
)
from crate.db.repositories.tasks import create_task


router = APIRouter(prefix="/api/i18n", tags=["i18n"])
admin_router = APIRouter(prefix="/api/admin/i18n", tags=["admin-i18n"])

_LISTEN_APP = "listen"
_LISTEN_FALLBACK_LOCALE = "en"
_BUNDLE_STATUSES = {"needs_review", "published", "rejected", "superseded"}


def _require_supported_app(app: str) -> None:
    if app != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="unsupported i18n app")


def _serialize_translation_request(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "app": row["app"],
        "locale": row["locale"],
        "sourceVersion": row["source_version"],
        "client": row.get("client"),
        "reason": row["reason"],
        "status": row["status"],
        "taskId": str(row["task_id"]) if row.get("task_id") else None,
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
    }


def _serialize_translation_bundle(row: dict, *, include_messages: bool) -> dict:
    data = {
        "id": str(row["id"]),
        "app": row["app"],
        "locale": row["locale"],
        "sourceLocale": row["source_locale"],
        "sourceVersion": row["source_version"],
        "bundleVersion": row["bundle_version"],
        "status": row["status"],
        "messageCount": row.get("message_count")
        if row.get("message_count") is not None
        else len(row.get("messages_json") or {}),
        "createdAt": row["created_at"].isoformat(),
        "publishedAt": row["published_at"].isoformat()
        if row.get("published_at")
        else None,
    }
    if include_messages:
        data["messages"] = row["messages_json"]
    return data


def listen_i18n_ai_is_configured() -> bool:
    try:
        from crate.llm import get_config, get_provider_api_key

        config = get_config()
    except Exception:
        return False

    provider = str(config.get("provider") or "").strip()
    if not provider:
        return False
    if provider == "ollama":
        return _ollama_i18n_ai_is_explicitly_enabled()
    return bool(get_provider_api_key(provider))


def _ollama_i18n_ai_is_explicitly_enabled() -> bool:
    if os.environ.get("CRATE_ENABLE_LISTEN_I18N_AI_DRAFTS", "").strip() == "1":
        return True
    if os.environ.get("LLM_PROVIDER", "").strip().startswith("ollama/"):
        return True
    try:
        from crate.db.cache_settings import get_setting

        return bool(str(get_setting("llm_model", "") or "").strip())
    except Exception:
        return False


def _queue_translation_draft_if_needed(request: dict) -> dict:
    current_status = str(request.get("status") or "").strip()
    if current_status in {"drafting_ai", "needs_review", "published"}:
        return request

    app = str(request["app"])
    locale = str(request["locale"])
    source_version = str(request["source_version"])

    if not listen_i18n_ai_is_configured():
        return (
            update_translation_request_status(
                app=app,
                locale=locale,
                source_version=source_version,
                status="manual_required",
            )
            or request
        )

    task_id = create_task(
        "draft_i18n_translation",
        {"app": app, "locale": locale, "source_version": source_version},
    )
    return (
        update_translation_request_status(
            app=app,
            locale=locale,
            source_version=source_version,
            status="drafting_ai",
            task_id=task_id,
        )
        or request
    )


@admin_router.get(
    "/listen/requests",
    summary="List Listen i18n translation requests",
)
def admin_list_listen_i18n_requests(request: Request):
    _require_admin(request)
    return {
        "requests": [
            _serialize_translation_request(row)
            for row in list_translation_requests(app=_LISTEN_APP)
        ]
    }


@admin_router.get(
    "/listen/bundles/{bundle_id}",
    summary="Get a Listen i18n translation bundle",
)
def admin_get_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = get_translation_bundle(bundle_id)
    if bundle is None or bundle["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    return _serialize_translation_bundle(bundle, include_messages=True)


@admin_router.get(
    "/listen/bundles",
    summary="List Listen i18n translation bundles",
)
def admin_list_listen_i18n_bundles(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status"),
):
    _require_admin(request)
    if status_filter is not None and status_filter not in _BUNDLE_STATUSES:
        raise HTTPException(status_code=400, detail="unsupported i18n bundle status")
    return {
        "bundles": [
            _serialize_translation_bundle(row, include_messages=False)
            for row in list_translation_bundles(
                app=_LISTEN_APP,
                status=status_filter,
            )
        ]
    }


@admin_router.post(
    "/listen/bundles/{bundle_id}/publish",
    summary="Publish a reviewed Listen i18n translation bundle",
)
def admin_publish_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = publish_translation_bundle(bundle_id)
    if bundle is None or bundle["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    return _serialize_translation_bundle(bundle, include_messages=True)


@admin_router.post(
    "/listen/bundles/{bundle_id}/reject",
    summary="Reject a Listen i18n translation bundle",
)
def admin_reject_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = reject_translation_bundle(bundle_id)
    if bundle is None or bundle["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    return _serialize_translation_bundle(bundle, include_messages=True)


@router.get(
    "/{app}/manifest",
    response_model=I18nManifestResponse,
    summary="Get the published i18n bundle manifest for Listen",
)
def get_i18n_manifest(
    app: str,
    source_version: str = Query(..., min_length=1, max_length=128),
):
    _require_supported_app(app)
    bundles = [
        I18nManifestBundle(
            locale=row["locale"],
            sourceVersion=row["source_version"],
            bundleVersion=row["bundle_version"],
            publishedAt=(
                row["published_at"].isoformat() if row.get("published_at") else None
            ),
        )
        for row in list_published_bundles(app=app, source_version=source_version)
    ]
    return I18nManifestResponse(
        app=app,
        fallbackLocale=_LISTEN_FALLBACK_LOCALE,
        sourceVersion=source_version,
        bundles=bundles,
    )


@router.get(
    "/{app}/bundles/{locale}",
    response_model=I18nBundleResponse,
    summary="Get a published i18n bundle for Listen",
)
def get_i18n_bundle(
    app: str,
    locale: str,
    source_version: str = Query(..., min_length=1, max_length=128),
):
    _require_supported_app(app)
    bundle = get_published_bundle(
        app=app,
        locale=locale.strip().lower(),
        source_version=source_version,
    )
    if bundle is None:
        raise HTTPException(status_code=404, detail="i18n bundle not found")

    return I18nBundleResponse(
        app=bundle["app"],
        locale=bundle["locale"],
        sourceLocale=bundle["source_locale"],
        sourceVersion=bundle["source_version"],
        bundleVersion=bundle["bundle_version"],
        messages=bundle["messages_json"],
    )


@router.post(
    "/{app}/translation-requests",
    response_model=I18nTranslationRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a draft translation for an unsupported Listen locale",
)
def create_i18n_translation_request(
    app: str,
    payload: I18nTranslationRequestCreate,
):
    _require_supported_app(app)
    request = upsert_translation_request(
        app=app,
        locale=payload.normalized_locale.strip().lower(),
        source_version=payload.source_version,
        client=payload.client,
        reason=payload.reason,
    )
    request = _queue_translation_draft_if_needed(request)
    return I18nTranslationRequestResponse(
        requestId=str(request["id"]),
        status=request["status"],
    )
