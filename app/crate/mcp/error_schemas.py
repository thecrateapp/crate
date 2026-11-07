"""Closed inputs for the error inbox reads."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from crate.mcp.schemas import ClosedInput, Cursor, EntityUID, Limit

ShortId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")]


class ErrorIssuesInput(ClosedInput):
    status: Literal["unresolved", "resolved", "ignored", "all"] = "unresolved"
    lane: Literal["all", "critical"] = "all"
    service: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    classification: (
        Literal[
            "bug",
            "infrastructure",
            "external_dependency",
            "client_environment",
            "noise",
        ]
        | None
    ) = None
    release: Annotated[str, Field(min_length=1, max_length=300)] | None = None
    limit: Limit = 20
    cursor: Cursor | None = None


class ErrorIssueInput(ClosedInput):
    issue_id: EntityUID | None = None
    short_id: ShortId | None = None

    @model_validator(mode="after")
    def require_one_identity(self):
        if (self.issue_id is None) == (self.short_id is None):
            raise ValueError("Supply exactly one of issue_id or short_id")
        return self
