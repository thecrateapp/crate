from contextlib import contextmanager


class _Result:
    def __init__(self, *, scalar_value=None, rows=None):
        self.scalar_value = scalar_value
        self.rows = rows or []

    def scalar(self):
        return self.scalar_value

    def mappings(self):
        return self

    def all(self):
        return self.rows


def test_local_catalog_genres_aggregate_aliases(monkeypatch):
    from crate.db.queries import catalog_local_browse

    monkeypatch.setattr(
        catalog_local_browse,
        "get_all_genres",
        lambda: [
            {
                "slug": "post-punk",
                "name": "Post-punk",
                "canonical_slug": "post-punk",
                "canonical_name": "post-punk",
                "artist_count": 2,
                "album_count": 3,
            },
            {
                "slug": "postpunk",
                "name": "Postpunk",
                "canonical_slug": "post-punk",
                "canonical_name": "post-punk",
                "artist_count": 1,
                "album_count": 4,
            },
        ],
    )

    assert catalog_local_browse.list_local_catalog_genres() == [
        {
            "global_genre_uid": None,
            "canonical_slug": "post-punk",
            "canonical_name": "post-punk",
            "entity_count": 10,
            "artist_count": 3,
            "album_count": 7,
            "track_count": 0,
        }
    ]


def test_local_genre_detail_keeps_catalog_contract(monkeypatch):
    from crate.db.queries import catalog_local_browse

    calls: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        catalog_local_browse,
        "get_genre_detail",
        lambda slug, include_global_entities: (
            calls.append((slug, include_global_entities))
            or {"id": 4, "name": "Post-punk", "slug": "post-punk"}
        ),
    )
    monkeypatch.setattr(
        catalog_local_browse,
        "get_core_taxonomy_descriptor",
        lambda: {
            "taxonomy_id": "crate-core",
            "version": "1.0.0",
            "digest": "sha256:test",
        },
    )

    detail = catalog_local_browse.get_local_catalog_genre_detail("post-punk")

    assert detail is not None
    assert detail["taxonomy"] == {
        "id": "crate-core",
        "version": "1.0.0",
        "digest": "sha256:test",
    }
    assert detail["artists"] == []
    assert detail["albums"] == []
    assert detail["shows"] == []
    assert calls == [("post-punk", False)]


def test_local_decade_artists_serializes_canonical_page(monkeypatch):
    from crate.db.queries import catalog_local_browse

    class _Session:
        def __init__(self):
            self.results = iter(
                [
                    _Result(scalar_value=1),
                    _Result(
                        rows=[
                            {
                                "id": 7,
                                "entity_uid": "local-high-vis",
                                "slug": "high-vis",
                                "name": "High Vis",
                                "album_count": 2,
                                "track_count": 20,
                                "total_size": 1024,
                                "formats_json": ["flac"],
                                "primary_format": "flac",
                                "has_photo": True,
                            }
                        ]
                    ),
                ]
            )

        def execute(self, *_args, **_kwargs):
            return next(self.results)

    @contextmanager
    def fake_read_scope():
        yield _Session()

    monkeypatch.setattr(catalog_local_browse, "read_scope", fake_read_scope)

    page = catalog_local_browse.get_local_decade_artists(
        decade_start=2020,
        decade_end=2029,
        page=1,
        per_page=50,
    )

    assert page["total"] == 1
    assert page["items"][0] == {
        "id": 7,
        "entity_uid": "local-high-vis",
        "local_artist_entity_uid": "local-high-vis",
        "global_uid": None,
        "global_artist_uid": None,
        "slug": "high-vis",
        "name": "High Vis",
        "albums": 2,
        "tracks": 20,
        "total_size_mb": 0,
        "formats": ["flac"],
        "primary_format": "flac",
        "has_photo": True,
        "has_issues": False,
        "popularity": None,
        "popularity_score": None,
        "popularity_confidence": None,
        "availability": {
            "catalog": True,
            "stream": True,
            "import": False,
            "local": True,
            "remote": False,
            "healthy": True,
        },
    }
