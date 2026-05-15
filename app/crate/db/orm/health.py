from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class HealthIssue(Base):
    __tablename__ = "health_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    check_type: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False, server_default="medium")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    details_json: Mapped[dict | None] = mapped_column(JSON, server_default="{}")
    auto_fixable: Mapped[bool | None] = mapped_column(Boolean, server_default="false")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
