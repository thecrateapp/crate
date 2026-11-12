from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base
from crate.db.orm.bandcamp import CredentialSecret  # noqa: F401 - FK target


class BackupRun(Base):
    """One job of the backups engine (``schema_sections/backup_runs_v162.py``)."""

    __tablename__ = "backup_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="running")
    task_id: Mapped[str | None] = mapped_column(Text)
    # Since migration 164 (BK3): the policy and destination of the run, if any.
    policy_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("backup_policies.id", ondelete="SET NULL")
    )
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("backup_destinations.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    path: Mapped[str | None] = mapped_column(Text)
    bytes: Mapped[int | None] = mapped_column(BigInteger)
    checksum: Mapped[str | None] = mapped_column(Text)
    snapshot_id: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )


class BackupDestination(Base):
    """A restic repository (``schema_sections/backup_destinations_v163.py``).

    Only references to secrets: the secrets live in ``credential_secrets``.
    """

    __tablename__ = "backup_destinations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    config_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    secret_ref: Mapped[str | None] = mapped_column(
        Text, ForeignKey("credential_secrets.secret_ref", ondelete="RESTRICT")
    )
    repo_password_ref: Mapped[str] = mapped_column(
        Text,
        ForeignKey("credential_secrets.secret_ref", ondelete="RESTRICT"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    repository_initialized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    snapshot_count: Mapped[int | None] = mapped_column(Integer)
    repository_bytes: Mapped[int | None] = mapped_column(BigInteger)
    recovery_kit_downloaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    recovery_kit_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class BackupPolicy(Base):
    """When and where the engine copies (``schema_sections/backup_policies_v164.py``)."""

    __tablename__ = "backup_policies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    schedule_kind: Mapped[str] = mapped_column(Text, nullable=False)
    daily_at: Mapped[str | None] = mapped_column(Text)
    interval_hours: Mapped[int | None] = mapped_column(Integer)
    window_start: Mapped[str | None] = mapped_column(Text)
    window_end: Mapped[str | None] = mapped_column(Text)
    keep_daily: Mapped[int] = mapped_column(Integer, nullable=False)
    keep_weekly: Mapped[int] = mapped_column(Integer, nullable=False)
    keep_monthly: Mapped[int] = mapped_column(Integer, nullable=False)
    compression: Mapped[str] = mapped_column(Text, nullable=False)
    verify_every_days: Mapped[int] = mapped_column(Integer, nullable=False)
    verify_read_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    drill_every_days: Mapped[int] = mapped_column(Integer, nullable=False)
    drill_destination_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("backup_destinations.id", ondelete="SET NULL")
    )
    run_before_upgrade: Mapped[bool] = mapped_column(Boolean, nullable=False)
    last_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class BackupPolicyDestination(Base):
    """Which copies a policy sends to a destination."""

    __tablename__ = "backup_policy_destinations"

    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("backup_policies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    destination_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("backup_destinations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tiers: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)


__all__ = [
    "BackupDestination",
    "BackupPolicy",
    "BackupPolicyDestination",
    "BackupRun",
]
