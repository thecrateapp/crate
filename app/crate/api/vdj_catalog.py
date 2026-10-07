from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_vdj_scope
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.vdj_catalog import VdjCatalogResponse
from crate.db.queries.vdj_catalog import (
    get_vdj_folder_page,
    list_vdj_folders,
)

router = APIRouter(prefix="/api/vdj/catalog", tags=["vdj"])


@router.get(
    "/folders",
    response_model=VdjCatalogResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List VirtualDJ catalog folders",
)
def vdj_catalog_folders(request: Request) -> dict:
    _require_vdj_scope(request, "vdj.catalog.read")
    return {"folders": list_vdj_folders(), "tracks": [], "next_cursor": None}


@router.get(
    "/folders/{folder_id:path}",
    response_model=VdjCatalogResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List tracks in a VirtualDJ catalog folder",
)
def vdj_catalog_folder(
    request: Request,
    folder_id: str,
    cursor: str | None = None,
    limit: int = Query(100, ge=1, le=100),
) -> dict:
    user = _require_vdj_scope(request, "vdj.catalog.read")
    try:
        return get_vdj_folder_page(
            folder_id,
            user_id=user.get("id"),
            cursor=cursor,
            limit=limit,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Catalog folder not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
