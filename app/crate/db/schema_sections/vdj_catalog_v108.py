from __future__ import annotations

from typing import Any

VDJ_MOOD_INDEX_MOODS = ("aggressive", "dark", "happy", "party", "relaxed", "sad")


def vdj_mood_index_statements(*, concurrently: bool) -> list[str]:
    keyword = "CONCURRENTLY " if concurrently else ""
    return [
        f"CREATE INDEX {keyword}IF NOT EXISTS idx_library_tracks_mood_{mood} "
        "ON library_tracks ("
        f"(CASE WHEN jsonb_typeof(mood_json -> '{mood}') = 'number' "
        f"THEN (mood_json ->> '{mood}')::double precision END) DESC NULLS LAST, id"
        ") WHERE mood_json IS NOT NULL"
        for mood in VDJ_MOOD_INDEX_MOODS
    ]


def create_vdj_mood_indexes_v108_schema(cur: Any) -> None:
    for statement in vdj_mood_index_statements(concurrently=False):
        cur.execute(statement)
