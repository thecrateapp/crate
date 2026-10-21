"""Closed native transport inputs; none of these are model decision tools."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TelegramBindingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    principal_id: UUID
    telegram_user_id: Annotated[int, Field(strict=True, gt=0)]


class NativePoll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["pending"]
    instance_id: Annotated[str, Field(min_length=1, max_length=128)]


class NativeDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["delivered"]
    instance_id: Annotated[str, Field(min_length=1, max_length=128)]
    confirmation_id: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
    chat_id: Annotated[int, Field(strict=True, gt=0)]
    message_id: Annotated[int, Field(strict=True, gt=0)]
    page_index: Annotated[int, Field(strict=True, ge=0, le=59)]


class NativeCallback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["callback"]
    instance_id: Annotated[str, Field(min_length=1, max_length=128)]
    confirmation_id: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
    chat_id: Annotated[int, Field(strict=True, gt=0)]
    message_id: Annotated[int, Field(strict=True, gt=0)]
    user_id: Annotated[int, Field(strict=True, gt=0)]
    update_id: Annotated[int, Field(strict=True, ge=0)]
    query_id: Annotated[str, Field(min_length=1, max_length=128)]
    chat_type: Literal["private"]
    action: Literal["next", "approve", "reject"]


class NativeOutcomeDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["outcome_delivered"]
    instance_id: Annotated[str, Field(min_length=1, max_length=128)]
    confirmation_id: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
    chat_id: Annotated[int, Field(strict=True, gt=0)]
    message_id: Annotated[int, Field(strict=True, gt=0)]


NativeEvent = Annotated[
    NativePoll | NativeDelivery | NativeCallback | NativeOutcomeDelivery,
    Field(discriminator="kind"),
]
