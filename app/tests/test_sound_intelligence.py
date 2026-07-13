from unittest.mock import MagicMock
from uuid import uuid4


class _Mappings:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, results):
        self._results = list(results)

    def execute(self, *_args, **_kwargs):
        rows = self._results.pop(0)
        return MagicMock(mappings=lambda: _Mappings(rows))


def test_sound_intelligence_health_reports_effective_eq_distribution():
    from crate.db.queries.sound_intelligence import get_sound_intelligence_health

    health = get_sound_intelligence_health(
        session=_Session(
            [
                [
                    {"source": "instance_album_preset", "count": 4},
                    {"source": "audio_analysis_preset", "count": 6},
                    {"source": "flat", "count": 0},
                ],
                [
                    {
                        "node_count": 10,
                        "top_level_count": 3,
                        "orphan_count": 1,
                        "missing_description_count": 2,
                        "missing_direct_eq_count": 5,
                        "unmapped_raw_count": 7,
                        "edge_count": 12,
                        "locked_edge_count": 4,
                        "manual_edge_count": 9,
                        "ai_edge_count": 1,
                    }
                ],
            ]
        )
    )

    assert health["eq"]["total_tracks"] == 10
    by_source = {item["source"]: item for item in health["eq"]["sources"]}
    assert by_source["instance_album_preset"]["percent"] == 40.0
    assert by_source["audio_analysis_preset"]["percent"] == 60.0
    assert by_source["flat"]["percent"] == 0.0
    assert health["taxonomy"]["unmapped_raw_count"] == 7
    assert health["taxonomy"]["locked_edge_count"] == 4


def test_sound_intelligence_health_reads_uuid_equalizer_targets(pg_db):
    from crate.db.queries.sound_intelligence import get_sound_intelligence_health
    from crate.db.repositories.equalizer_presets import upsert_equalizer_preset

    artist = "Sound Intelligence Artist"
    album = "Sound Intelligence Album"
    album_uid = str(uuid4())
    track_uid = str(uuid4())
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": album,
            "path": "/music/sound-intelligence/album",
            "entity_uid": album_uid,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": "01-track.flac",
            "title": "Track",
            "path": "/music/sound-intelligence/album/01-track.flac",
            "entity_uid": track_uid,
        }
    )
    upsert_equalizer_preset(
        scope="instance",
        target_type="track",
        target_entity_uid=track_uid,
        gains=[0.0] * 10,
    )

    health = get_sound_intelligence_health()

    assert health["eq"]["total_tracks"] == 1
    by_source = {item["source"]: item for item in health["eq"]["sources"]}
    assert by_source["instance_track_preset"]["count"] == 1
