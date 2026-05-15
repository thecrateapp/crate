import datetime as dt
from datetime import datetime

from sqlalchemy import Date, DateTime, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class NewRelease(Base):
    __tablename__ = "new_releases"
    __table_args__ = (UniqueConstraint("artist_name", "album_title"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    artist_name: Mapped[str] = mapped_column(Text, nullable=False)
    album_title: Mapped[str] = mapped_column(Text, nullable=False)
    tidal_id: Mapped[str | None] = mapped_column(Text)
    tidal_url: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    year: Mapped[str | None] = mapped_column(Text)
    tracks: Mapped[int | None] = mapped_column(Integer)
    quality: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="detected")
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_date: Mapped[dt.date | None] = mapped_column(Date)
    release_type: Mapped[str | None] = mapped_column(Text, server_default="Album")
    mb_release_group_id: Mapped[str | None] = mapped_column(Text)
