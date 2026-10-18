"""Committed show invalidations share the outbox and live cache dispatcher."""

from sqlalchemy import text
from crate.db.tx import optional_scope
from crate.db.domain_events import append_domain_event


def invalidate_show_views(artist_names: list[str | None], *, session=None) -> None:
    with optional_scope(session) as current:
        names = list({" ".join(name.lower().split()) for name in artist_names if name})
        existing = (
            current.execute(
                text("""SELECT name FROM library_artists
                    WHERE lower(btrim(regexp_replace(name,'\\s+',' ','g')))=ANY(:names)"""),
                {"names": names},
            )
            .scalars()
            .all()
        )
        scopes = ["shows", "upcoming", "home", *["artist:" + name for name in existing]]
        for scope in dict.fromkeys(scopes):
            append_domain_event(
                "ui.invalidate",
                {"scope": scope, "source": "show_write"},
                scope="ui.invalidate",
                subject_key=scope,
                session=current,
            )


__all__ = ["invalidate_show_views"]
