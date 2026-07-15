from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class FederationLocalKey(Base):
    __tablename__ = "federation_local_keys"
    __table_args__ = (UniqueConstraint("node_uid", "key_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_id: Mapped[str] = mapped_column(Text, nullable=False)
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    private_key_ref: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    not_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationPeerKey(Base):
    __tablename__ = "federation_peer_keys"
    __table_args__ = (UniqueConstraint("node_uid", "key_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    key_id: Mapped[str] = mapped_column(Text, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    not_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationPairing(Base):
    __tablename__ = "federation_pairings"
    __table_args__ = (CheckConstraint("direction IN ('inbound', 'outbound')"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pairing_uid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    remote_node_uid: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    remote_base_url: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default="created")
    local_challenge: Mapped[str] = mapped_column(Text, nullable=False)
    remote_challenge: Mapped[str | None] = mapped_column(Text)
    negotiated_protocol: Mapped[str | None] = mapped_column(Text)
    signature_profile: Mapped[str | None] = mapped_column(Text)
    descriptor_digest: Mapped[str | None] = mapped_column(Text)
    offer_json: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    acceptance_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationKeyRotation(Base):
    __tablename__ = "federation_key_rotations"
    __table_args__ = (
        CheckConstraint("old_key_id <> new_key_id"),
        CheckConstraint("grace_until > activate_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rotation_uid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    old_key_id: Mapped[str] = mapped_column(Text, nullable=False)
    new_key_id: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default="prepared")
    activate_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    grace_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationPeerGrant(Base):
    __tablename__ = "federation_peer_grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    grant_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    principal_selector: Mapped[str] = mapped_column(Text, nullable=False)
    subject_selector: Mapped[str] = mapped_column(Text, nullable=False)
    preset: Mapped[str] = mapped_column(Text, nullable=False)
    capabilities_json: Mapped[list] = mapped_column(JSONB, nullable=False)
    constraints_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    resource_policy_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    policy_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    constraints_version: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationCatalogChange(Base):
    __tablename__ = "federation_catalog_changes"
    __table_args__ = (
        UniqueConstraint(
            "entity_type",
            "entity_uid",
            "payload_revision",
            "operation",
        ),
        CheckConstraint("operation IN ('upsert', 'delete', 'hide', 'restore')"),
    )

    sequence: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_uid: Mapped[str] = mapped_column(Text, nullable=False)
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    payload_revision: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    retention_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationImportRequest(Base):
    __tablename__ = "federation_import_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    remote_entity_uid: Mapped[str] = mapped_column(Text, nullable=False)
    global_album_uid: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    requested_by_user_id: Mapped[int | None] = mapped_column(Integer)
    approved_by_user_id: Mapped[int | None] = mapped_column(Integer)
    expected_bytes: Mapped[int | None] = mapped_column(BigInteger)
    reserved_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    received_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    manifest_digest: Mapped[str | None] = mapped_column(Text)
    approval_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False)
    staging_relative_path: Mapped[str | None] = mapped_column(Text)
    cleanup_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FederationDirectorySubscription(Base):
    __tablename__ = "federation_directory_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    subscription_uid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    trusted_keys_json: Mapped[list] = mapped_column(JSONB, nullable=False)
    refresh_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    etag: Mapped[str | None] = mapped_column(Text)
    last_modified: Mapped[str | None] = mapped_column(Text)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False)
    retry_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(Text)
    last_error_detail: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class FederationDirectoryRefreshRun(Base):
    __tablename__ = "federation_directory_refresh_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_uid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    subscription_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("federation_directory_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer)
    signing_key_id: Mapped[str | None] = mapped_column(Text)
    candidates_seen: Mapped[int] = mapped_column(Integer, nullable=False)
    candidates_changed: Mapped[int] = mapped_column(Integer, nullable=False)
    error_code: Mapped[str | None] = mapped_column(Text)
    error_detail: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FederationDirectoryCandidate(Base):
    __tablename__ = "federation_directory_candidates"
    __table_args__ = (UniqueConstraint("subscription_id", "node_uid"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    subscription_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("federation_directory_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    node_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    descriptor_url: Mapped[str] = mapped_column(Text, nullable=False)
    descriptor_digest: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text)
    advertised_key_id: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    stale_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
