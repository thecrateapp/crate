from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
)
from sqlalchemy import JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class CredentialSecret(Base):
    __tablename__ = "credential_secrets"

    secret_ref: Mapped[str] = mapped_column(Text, primary_key=True)
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BandcampConnection(Base):
    __tablename__ = "bandcamp_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    username: Mapped[str | None] = mapped_column(Text)
    fan_id: Mapped[int | None] = mapped_column(BigInteger)
    display_name: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="connected"
    )
    session_secret_ref: Mapped[str] = mapped_column(Text, nullable=False)
    session_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    password_secret_ref: Mapped[str | None] = mapped_column(Text)
    connection_method: Mapped[str] = mapped_column(Text, nullable=False)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    sync_cursor_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    settings_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BandcampItem(Base):
    __tablename__ = "bandcamp_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bandcamp_item_id: Mapped[int | None] = mapped_column(BigInteger)
    bandcamp_item_type: Mapped[str] = mapped_column(Text, nullable=False)
    band_id: Mapped[int | None] = mapped_column(BigInteger)
    album_id: Mapped[int | None] = mapped_column(BigInteger)
    track_id: Mapped[int | None] = mapped_column(BigInteger)
    art_id: Mapped[int | None] = mapped_column(BigInteger)
    artist_name: Mapped[str | None] = mapped_column(Text)
    album_title: Mapped[str | None] = mapped_column(Text)
    track_title: Mapped[str | None] = mapped_column(Text)
    label_name: Mapped[str | None] = mapped_column(Text)
    item_url: Mapped[str] = mapped_column(Text, nullable=False)
    artist_url: Mapped[str | None] = mapped_column(Text)
    album_url: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    release_date: Mapped[date | None] = mapped_column(Date)
    tags_json: Mapped[list | None] = mapped_column(JSON, server_default="[]")
    raw_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class UserBandcampItem(Base):
    __tablename__ = "user_bandcamp_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    connection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("bandcamp_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    bandcamp_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bandcamp_items.id", ondelete="CASCADE"), nullable=False
    )
    relation_type: Mapped[str] = mapped_column(Text, nullable=False)
    owned: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    downloadable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    purchase_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    added_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")


class BandcampLibraryMatch(Base):
    __tablename__ = "bandcamp_library_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bandcamp_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bandcamp_items.id", ondelete="CASCADE"), nullable=False
    )
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_uid: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="candidate"
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class BandcampImport(Base):
    __tablename__ = "bandcamp_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    connection_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bandcamp_connections.id", ondelete="SET NULL")
    )
    bandcamp_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bandcamp_items.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str | None] = mapped_column(Text)
    requested_format: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="flac"
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    imported_artist_uid: Mapped[str | None] = mapped_column(Text)
    imported_album_uid: Mapped[str | None] = mapped_column(Text)
    imported_track_uids: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    source_archive_url: Mapped[str | None] = mapped_column(Text)
    source_archive_sha256: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BandcampRadarItem(Base):
    __tablename__ = "bandcamp_radar_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE")
    )
    bandcamp_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bandcamp_items.id", ondelete="CASCADE")
    )
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="new")
    reason_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class BandcampPairingChallenge(Base):
    __tablename__ = "bandcamp_pairing_challenges"

    pairing_id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    connection_method: Mapped[str] = mapped_column(Text, nullable=False)
    task_id: Mapped[str | None] = mapped_column(Text)
    result_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
