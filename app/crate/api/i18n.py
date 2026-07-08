import os
from typing import Any
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request, status

from crate.api.auth import _require_admin
from crate.api.schemas.i18n import (
    I18nBundleExportResponse,
    I18nBundleImportRequest,
    I18nBundleMessagePatchRequest,
    I18nBundleResponse,
    I18nDraftMissingRequest,
    I18nManifestBundle,
    I18nManifestResponse,
    I18nQualityIssueResponse,
    I18nQualityReportResponse,
    I18nTranslationRequestCreate,
    I18nTranslationRequestResponse,
)
from crate.db.queries.i18n import (
    get_published_bundle,
    get_latest_reviewable_translation_bundle,
    get_translation_bundle,
    list_published_bundles,
    list_translation_bundles,
    list_translation_requests,
)
from crate.db.repositories.i18n import (
    insert_translation_bundle_draft,
    publish_translation_bundle,
    reject_translation_bundle,
    update_translation_bundle_message,
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


def _latest_translation_bundle_for_quality(
    *, locale: str, source_version: str
) -> dict | None:
    for status_filter in ("needs_review", None):
        for row in list_translation_bundles(
            app=_LISTEN_APP,
            status=status_filter,
        ):
            if row["locale"] != locale or row["source_version"] != source_version:
                continue
            return get_translation_bundle(str(row["id"]))
    return None


def _build_quality_report(
    *, locale: str, source_version: str, bundle: dict | None
) -> I18nQualityReportResponse:
    issues: list[I18nQualityIssueResponse] = []
    if bundle is None:
        issues.append(
            I18nQualityIssueResponse(
                severity="warning",
                code="missing_key",
                locale=locale,
                message=(
                    "No translation bundle exists for this locale and source version."
                ),
            )
        )
    else:
        for key, value in sorted((bundle.get("messages_json") or {}).items()):
            if not isinstance(value, str) or not value.strip():
                issues.append(
                    I18nQualityIssueResponse(
                        severity="error",
                        code="empty_value",
                        locale=locale,
                        key=key,
                        message="Translation value is empty.",
                        value=value if isinstance(value, str) else None,
                    )
                )

    return I18nQualityReportResponse(
        sourceVersion=source_version,
        generatedAt=datetime.now(UTC).isoformat(),
        locales=[locale],
        issueCount=len(issues),
        errorCount=sum(1 for issue in issues if issue.severity == "error"),
        warningCount=sum(1 for issue in issues if issue.severity == "warning"),
        issues=issues,
    )


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


def _queue_translation_draft_if_needed(
    request: dict, *, keys: list[str] | None = None
) -> dict:
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

    params: dict[str, Any] = {
        "app": app,
        "locale": locale,
        "source_version": source_version,
    }
    if keys:
        params["keys"] = keys
    task_id = create_task("draft_i18n_translation", params)
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
        "aiConfigured": listen_i18n_ai_is_configured(),
        "requests": [
            _serialize_translation_request(row)
            for row in list_translation_requests(app=_LISTEN_APP)
        ],
    }


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
    "/listen/bundles/import",
    status_code=status.HTTP_201_CREATED,
    summary="Import a Listen i18n JSON bundle as a review draft",
)
def admin_import_listen_i18n_bundle(
    request: Request,
    payload: I18nBundleImportRequest,
):
    _require_admin(request)
    bundle = insert_translation_bundle_draft(
        app=_LISTEN_APP,
        locale=payload.locale.strip().lower(),
        source_locale=payload.source_locale.strip().lower() or "en",
        source_version=payload.source_version,
        bundle_version=payload.bundle_version,
        messages=payload.messages,
    )
    return _serialize_translation_bundle(bundle, include_messages=True)


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
    "/listen/quality",
    response_model=I18nQualityReportResponse,
    summary="Get a Listen i18n bundle quality report",
)
def admin_get_listen_i18n_quality_report(
    request: Request,
    locale: str = Query(..., min_length=2, max_length=16),
    source_version: str = Query(..., min_length=1, max_length=128),
):
    _require_admin(request)
    normalized_locale = locale.strip().lower()
    bundle = _latest_translation_bundle_for_quality(
        locale=normalized_locale,
        source_version=source_version,
    )
    return _build_quality_report(
        locale=normalized_locale,
        source_version=source_version,
        bundle=bundle,
    )


def _normalized_unique_keys(keys: list[str]) -> list[str]:
    normalized = [str(key).strip() for key in keys if str(key).strip()]
    return sorted(set(normalized), key=normalized.index)


def _draftable_i18n_keys(
    *, locale: str, source_version: str, report: I18nQualityReportResponse
) -> set[str]:
    draftable = {
        issue.key
        for issue in report.issues
        if issue.key and issue.code in {"missing_key", "stale_translation"}
    }

    try:
        from crate.llm.prompts.i18n_translation import load_listen_source_messages

        source_keys = set(load_listen_source_messages())
    except Exception:
        source_keys = set()

    if source_keys:
        latest = get_latest_reviewable_translation_bundle(
            app=_LISTEN_APP,
            locale=locale,
            source_version=source_version,
        )
        existing_keys = set((latest or {}).get("messages_json") or {})
        draftable.update(source_keys - existing_keys)

    return draftable


@admin_router.post(
    "/listen/locales/{locale}/draft-missing",
    response_model=I18nTranslationRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Draft missing or stale Listen i18n keys with AI",
)
def admin_draft_missing_listen_i18n_keys(
    request: Request,
    locale: str,
    payload: I18nDraftMissingRequest,
):
    _require_admin(request)
    normalized_locale = locale.strip().lower()
    latest = _latest_translation_bundle_for_quality(
        locale=normalized_locale,
        source_version=payload.source_version,
    )
    report = _build_quality_report(
        locale=normalized_locale,
        source_version=payload.source_version,
        bundle=latest,
    )
    draftable_keys = _draftable_i18n_keys(
        locale=normalized_locale,
        source_version=payload.source_version,
        report=report,
    )
    requested_keys = _normalized_unique_keys(payload.keys or sorted(draftable_keys))
    if not requested_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="no missing or stale keys to draft",
        )

    invalid_keys = sorted(set(requested_keys) - draftable_keys)
    if invalid_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="keys are not missing or stale",
        )

    translation_request = upsert_translation_request(
        app=_LISTEN_APP,
        locale=normalized_locale,
        source_version=payload.source_version,
        client="admin",
        reason="missing-stale-keys",
    )
    translation_request = _queue_translation_draft_if_needed(
        translation_request,
        keys=requested_keys,
    )
    return I18nTranslationRequestResponse(
        requestId=str(translation_request["id"]),
        status=translation_request["status"],
    )


@admin_router.post(
    "/listen/bundles/{bundle_id}/publish",
    summary="Publish a reviewed Listen i18n translation bundle",
)
def admin_publish_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    current = get_translation_bundle(bundle_id)
    if current is None or current["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    report = _build_quality_report(
        locale=current["locale"],
        source_version=current["source_version"],
        bundle=current,
    )
    if report.error_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="i18n bundle has quality errors",
        )
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


@admin_router.patch(
    "/listen/bundles/{bundle_id}/messages/{key:path}",
    summary="Update a single Listen i18n bundle message",
)
def admin_patch_listen_i18n_bundle_message(
    request: Request,
    bundle_id: str,
    key: str,
    payload: I18nBundleMessagePatchRequest,
):
    _require_admin(request)
    bundle = update_translation_bundle_message(
        bundle_id=bundle_id,
        key=key,
        value=payload.value,
    )
    if bundle is None or bundle["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    return _serialize_translation_bundle(bundle, include_messages=True)


@admin_router.get(
    "/listen/bundles/{bundle_id}/export",
    response_model=I18nBundleExportResponse,
    summary="Export Listen i18n bundle messages as JSON",
)
def admin_export_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = get_translation_bundle(bundle_id)
    if bundle is None or bundle["app"] != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="i18n bundle not found")
    return I18nBundleExportResponse(
        locale=bundle["locale"],
        sourceVersion=bundle["source_version"],
        bundleVersion=bundle["bundle_version"],
        messages=bundle["messages_json"],
    )


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
