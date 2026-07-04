from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class I18nBundle(Base):
    __tablename__ = "i18n_bundles"
    __table_args__ = (
        UniqueConstraint("app", "locale", "source_version", "bundle_version"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    app: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(Text, nullable=False)
    source_locale: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="en"
    )
    source_version: Mapped[str] = mapped_column(Text, nullable=False)
    bundle_version: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    messages_json: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class I18nTranslationRequest(Base):
    __tablename__ = "i18n_translation_requests"
    __table_args__ = (UniqueConstraint("app", "locale", "source_version"),)

    id: Mapped[UUID] = mapped_column(primary_key=True)
    app: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(Text, nullable=False)
    source_version: Mapped[str] = mapped_column(Text, nullable=False)
    client: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    task_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
