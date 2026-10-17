"""Structured candidates only: remote extraction is performed by the client."""

from datetime import date
from typing import Annotated
from pydantic import Field
from crate.api.schemas.show_imports import ShowImportSelection, ShowPlanApplyInput
from crate.mcp.schemas import ClosedInput, EntityUID


class ShowsSearch(ClosedInput):
    query: Annotated[str, Field(max_length=160)] = ""
    artist_uid: EntityUID | None = None
    show_id: Annotated[int, Field(strict=True, ge=1)] | None = None
    date_from: date | None = None
    date_to: date | None = None
    limit: Annotated[int, Field(strict=True, ge=1, le=50)] = 20
    offset: Annotated[int, Field(strict=True, ge=0, le=10000)] = 0


class ShowsPrepare(ShowImportSelection):
    pass


class ShowsApply(ShowPlanApplyInput):
    plan_id: EntityUID
