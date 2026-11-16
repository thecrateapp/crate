"""Crate Decks synchronised cues and corrections (S7) contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from crate.db.queries.decks_cues import (
    DECKS_BPM_MAX,
    DECKS_BPM_MIN,
    DECKS_CLIENT_ID_MAX,
    DECKS_CUE_LABEL_MAX,
    DECKS_CUE_MAX_MS,
    DECKS_CUE_SET_LIMIT,
    DECKS_CUES_BATCH_LIMIT,
    DECKS_HOTCUE_SLOTS,
    DECKS_SLOTTED_CUE_TYPES,
)
from crate.smart_mix.beat_grid import (
    MAX_BEAT_COUNT,
    BeatGridCodecError,
    encode_beat_grid,
)

DecksCueType = Literal["hotcue", "loop", "main", "intro", "outro", "jump"]
_MS_DIGITS = 3

_ENTITY_UIDS = Field(
    min_length=1,
    max_length=DECKS_CUES_BATCH_LIMIT,
    description="Track entity UIDs, 1 to 200. Repeated UIDs are answered once.",
)
_BASE_REVISION = Field(
    ge=0,
    description=(
        "The revision the client last read or wrote for this track; 0 when it "
        "has seen none. A different stored revision answers 409."
    ),
)
_CLIENT_ID = Field(
    default=None,
    min_length=1,
    max_length=DECKS_CLIENT_ID_MAX,
    description=(
        "The writing installation (Decks sends its X-Device-Fingerprint value), "
        "stored with the write and echoed back."
    ),
)


class DecksCue(BaseModel):
    """One cue. Times are milliseconds from the start of the audio file."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    cue_type: DecksCueType
    slot: int = Field(
        default=0,
        ge=0,
        lt=DECKS_HOTCUE_SLOTS,
        description=(
            "Mixxx hot cue index 0-35 for hotcue, loop and jump (they share the "
            "slots); always 0 for main, intro and outro."
        ),
    )
    start_ms: float | None = Field(
        default=None,
        ge=0,
        le=DECKS_CUE_MAX_MS,
        description=(
            "Cue position, loop start, or jump target. Required except for "
            "intro and outro, which need at least one of start_ms and end_ms. "
            "Rounded to 0.001 ms."
        ),
    )
    end_ms: float | None = Field(
        default=None,
        ge=0,
        le=DECKS_CUE_MAX_MS,
        description=(
            "Loop end (> start_ms), the position a jump jumps from (!= start_ms), "
            "or the end of an intro or outro (> start_ms when both are set). "
            "Null for hotcue and main. Rounded to 0.001 ms."
        ),
    )
    label: str | None = Field(default=None, max_length=DECKS_CUE_LABEL_MAX)
    color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="24-bit RGB as #rrggbb; stored and returned in lowercase.",
    )

    @field_validator("start_ms", "end_ms")
    @classmethod
    def _round_ms(cls, value: float | None) -> float | None:
        return None if value is None else round(float(value), _MS_DIGITS)

    @field_validator("label")
    @classmethod
    def _blank_label(cls, value: str | None) -> str | None:
        return value if value and value.strip() else None

    @field_validator("color")
    @classmethod
    def _lowercase_color(cls, value: str | None) -> str | None:
        return None if value is None else value.lower()

    @model_validator(mode="after")
    def _check_type_rules(self) -> DecksCue:
        kind, start, end = self.cue_type, self.start_ms, self.end_ms
        if kind not in DECKS_SLOTTED_CUE_TYPES and self.slot != 0:
            raise ValueError(f"A {kind} cue uses slot 0")
        if kind in ("hotcue", "main"):
            if start is None or end is not None:
                raise ValueError(f"A {kind} cue has start_ms and no end_ms")
        elif kind == "loop":
            if start is None or end is None or end <= start:
                raise ValueError("A loop needs start_ms < end_ms")
        elif kind == "jump":
            if start is None or end is None or end == start:
                raise ValueError("A jump needs start_ms and a different end_ms")
        elif start is None and end is None:
            raise ValueError(f"An {kind} cue needs start_ms or end_ms")
        elif start is not None and end is not None and end <= start:
            raise ValueError(f"An {kind} cue needs start_ms < end_ms")
        return self


class DecksCuesQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_uids: list[UUID] = _ENTITY_UIDS


class DecksCueSetResponse(BaseModel):
    entity_uid: UUID
    revision: int = Field(
        ge=0, description="Revision of the whole set; 0 when nothing is stored."
    )
    updated_at: datetime | None = Field(
        description="When the set last changed; null when nothing is stored."
    )
    client_id: str | None = Field(
        description="client_id of the write that last changed the set."
    )
    cues: list[DecksCue] = Field(
        description=(
            "The whole set: main, intro, outro, then hotcue, loop and jump by "
            "slot. An empty list is a cleared set."
        )
    )


class DecksCuesQueryResponse(BaseModel):
    cue_sets: dict[str, DecksCueSetResponse] = Field(
        description=(
            "By entity UID (lowercase, hyphenated), in request order: the "
            "caller's stored set of each track that has one."
        )
    )
    missing: list[UUID] = Field(
        description=(
            "Requested UIDs without a stored set, in request order. They read as "
            "revision 0 with no cues: PUT them with base_revision 0."
        )
    )


class DecksCueSetPutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: int = _BASE_REVISION
    client_id: str | None = _CLIENT_ID
    cues: list[DecksCue] = Field(
        max_length=DECKS_CUE_SET_LIMIT,
        description=(
            "The whole new set (it replaces the stored one; [] clears it): at most "
            "one cue per (cue_type, slot), one of hotcue/loop/jump per slot, so at "
            "most 39 cues."
        ),
    )

    @model_validator(mode="after")
    def _check_set_rules(self) -> DecksCueSetPutRequest:
        keys: set[tuple[str, int]] = set()
        hotcue_slots: set[int] = set()
        for cue in self.cues:
            key = (cue.cue_type, cue.slot)
            if key in keys:
                raise ValueError(f"Two {cue.cue_type} cues in slot {cue.slot}")
            keys.add(key)
            if cue.cue_type in DECKS_SLOTTED_CUE_TYPES:
                if cue.slot in hotcue_slots:
                    raise ValueError(
                        f"Hot cue slot {cue.slot} holds more than one hotcue, "
                        "loop or jump"
                    )
                hotcue_slots.add(cue.slot)
        return self


class DecksCueSetConflictResponse(BaseModel):
    detail: str
    current: DecksCueSetResponse = Field(
        description="The stored set and revision; merge and PUT on top of it."
    )


class DecksCorrectionsQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_uids: list[UUID] = _ENTITY_UIDS


class DecksCorrectionResponse(BaseModel):
    entity_uid: UUID
    revision: int = Field(ge=0, description="0 when nothing is stored.")
    updated_at: datetime | None
    client_id: str | None
    bpm: float | None
    beat_grid_format: Literal["delta-ms-v1"] | None
    beat_grid_ms: list[int] | None = Field(
        description="Absolute beat positions in ms, as the mix profiles serve them."
    )
    key: str | None = Field(description="Camelot key, 1A to 12B.")


class DecksCorrectionsQueryResponse(BaseModel):
    corrections: dict[str, DecksCorrectionResponse] = Field(
        description=(
            "By entity UID (lowercase, hyphenated), in request order: the "
            "caller's stored correction of each track that has one. A cleared "
            "correction (all values null) is still listed with its revision."
        )
    )
    missing: list[UUID] = Field(
        description=(
            "Requested UIDs without a stored correction, in request order: "
            "revision 0, PUT them with base_revision 0."
        )
    )


class DecksCorrectionPutRequest(BaseModel):
    """The whole correction; it replaces the stored one. All values null clears it."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    base_revision: int = _BASE_REVISION
    client_id: str | None = _CLIENT_ID
    bpm: float | None = Field(default=None, ge=DECKS_BPM_MIN, le=DECKS_BPM_MAX)
    beat_grid_format: Literal["delta-ms-v1"] | None = Field(
        default=None, description="Required with beat_grid_ms, null without it."
    )
    beat_grid_ms: list[int] | None = Field(
        default=None,
        min_length=2,
        max_length=MAX_BEAT_COUNT,
        description=(
            "Absolute beat positions in ms, strictly increasing, the first > 0 "
            "and none over 24 h (the delta-ms-v1 rules of the mix profiles)."
        ),
    )
    key: str | None = Field(
        default=None,
        pattern=r"^(1[0-2]|[1-9])[ABab]$",
        description="Camelot key, 1A to 12B; stored in uppercase.",
    )

    @field_validator("key")
    @classmethod
    def _uppercase_key(cls, value: str | None) -> str | None:
        return None if value is None else value.upper()

    @model_validator(mode="after")
    def _check_grid(self) -> DecksCorrectionPutRequest:
        if (self.beat_grid_format is None) != (self.beat_grid_ms is None):
            raise ValueError("beat_grid_format and beat_grid_ms go together")
        if self.beat_grid_ms is not None:
            try:
                encode_beat_grid(self.beat_grid_ms)
            except BeatGridCodecError as exc:
                raise ValueError(str(exc)) from exc
        return self


class DecksCorrectionConflictResponse(BaseModel):
    detail: str
    current: DecksCorrectionResponse = Field(
        description="The stored correction and revision."
    )
