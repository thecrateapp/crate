from fastapi import APIRouter, HTTPException, Query, Request, Response

from crate.api.auth import _require_admin
from crate.api.schemas.i18n import (
    I18nAdminBundleResponse,
    I18nAdminRequestsResponse,
    I18nBundleResponse,
    I18nManifestResponse,
    I18nTranslationRequestPayload,
    I18nTranslationRequestResponse,
)
from crate.db.repositories.i18n import (
    get_bundle_for_review,
    get_published_bundle,
    list_published_bundles,
    list_translation_requests,
    set_bundle_status,
    upsert_translation_request,
)

LISTEN_APP = "listen"
LISTEN_FALLBACK_LOCALE = "en"

router = APIRouter(prefix="/api/i18n/listen", tags=["i18n"])
admin_router = APIRouter(prefix="/api/admin/i18n/listen", tags=["admin"])


@router.get("/manifest", response_model=I18nManifestResponse)
def get_listen_i18n_manifest(
    source_version: str = Query(..., min_length=1, max_length=128),
):
    return {
        "app": LISTEN_APP,
        "fallbackLocale": LISTEN_FALLBACK_LOCALE,
        "sourceVersion": source_version,
        "bundles": list_published_bundles(LISTEN_APP, source_version),
    }


@router.get("/bundles/{locale}", response_model=I18nBundleResponse)
def get_listen_i18n_bundle(
    locale: str,
    source_version: str = Query(..., min_length=1, max_length=128),
):
    bundle = get_published_bundle(LISTEN_APP, locale.strip().lower(), source_version)
    if not bundle:
        raise HTTPException(status_code=404, detail="Translation bundle not found")
    return bundle


@router.post(
    "/translation-requests",
    response_model=I18nTranslationRequestResponse,
)
def create_listen_translation_request(
    body: I18nTranslationRequestPayload,
    response: Response,
):
    request, inserted = upsert_translation_request(
        app=LISTEN_APP,
        locale=body.normalizedLocale.lower(),
        source_version=body.sourceVersion,
        client=body.client,
        reason=body.reason,
        status="manual_required",
    )
    response.status_code = 202 if inserted else 200
    return {"requestId": request["id"], "status": request["status"]}


@admin_router.get("/requests", response_model=I18nAdminRequestsResponse)
def list_listen_i18n_requests(request: Request):
    _require_admin(request)
    return {"requests": list_translation_requests(LISTEN_APP)}


@admin_router.get("/bundles/{bundle_id}", response_model=I18nAdminBundleResponse)
def get_listen_i18n_review_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = get_bundle_for_review(LISTEN_APP, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Translation bundle not found")
    return bundle


@admin_router.post(
    "/bundles/{bundle_id}/publish",
    response_model=I18nAdminBundleResponse,
)
def publish_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = set_bundle_status(LISTEN_APP, bundle_id, "published")
    if not bundle:
        raise HTTPException(status_code=404, detail="Translation bundle not found")
    return bundle


@admin_router.post(
    "/bundles/{bundle_id}/reject",
    response_model=I18nAdminBundleResponse,
)
def reject_listen_i18n_bundle(request: Request, bundle_id: str):
    _require_admin(request)
    bundle = set_bundle_status(LISTEN_APP, bundle_id, "rejected")
    if not bundle:
        raise HTTPException(status_code=404, detail="Translation bundle not found")
    return bundle
