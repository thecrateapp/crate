"""Closed, receipt-based acquisition inputs. No caller supplied files or URLs."""

from typing import Annotated, Literal

from pydantic import Field

from crate.mcp.schemas import ClosedInput, EntityUID, IdempotencyKey, Identifier

Provider = Literal["soulseek", "tidal", "bandcamp"]


class AcquisitionReadiness(ClosedInput):
    provider: Provider


class AcquisitionSearch(ClosedInput):
    provider: Provider
    query: Annotated[
        str, Field(min_length=2, max_length=160, pattern=r"^[^\x00-\x1f\x7f]+$")
    ]
    limit: Annotated[int, Field(strict=True, ge=1, le=5)] = 5


class AcquisitionPreview(ClosedInput):
    receipt_id: EntityUID
    artist_uid: EntityUID
    max_items: Annotated[int, Field(strict=True, ge=1, le=50)]
    max_bytes: Annotated[int, Field(strict=True, ge=1, le=2147483648)]
    max_cost_minor: Literal[0]
    destination_policy: Literal["provider_staging_only"]
    idempotency_key: IdempotencyKey


class AcquisitionPublication(ClosedInput):
    source_job_id: Identifier
    idempotency_key: IdempotencyKey
