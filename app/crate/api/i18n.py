from fastapi import APIRouter, HTTPException, Query, status

from crate.api.schemas.i18n import (
    I18nBundleResponse,
    I18nManifestBundle,
    I18nManifestResponse,
    I18nTranslationRequestCreate,
    I18nTranslationRequestResponse,
)
from crate.db.queries.i18n import get_published_bundle, list_published_bundles
from crate.db.repositories.i18n import upsert_translation_request


router = APIRouter(prefix="/api/i18n", tags=["i18n"])

_LISTEN_APP = "listen"
_LISTEN_FALLBACK_LOCALE = "en"


def _require_supported_app(app: str) -> None:
    if app != _LISTEN_APP:
        raise HTTPException(status_code=404, detail="unsupported i18n app")


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
    return I18nTranslationRequestResponse(
        requestId=str(request["id"]),
        status=request["status"],
    )
