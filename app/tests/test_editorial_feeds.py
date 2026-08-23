from datetime import datetime, timezone

import pytest

from crate.feeds.editorial import (
    EDITORIAL_SOURCE_KINDS,
    EditorialFeedHTTPError,
    EditorialFeedInvalidError,
    can_fetch_editorial_source,
    fetch_editorial_feed,
    parse_editorial_feed_payload,
    register_editorial_feed_source,
    validate_editorial_feed_url,
)


RSS_PAYLOAD = b"""<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Artist news</title>
    <item>
      <guid>news-1</guid>
      <title>Tour announcement</title>
      <link>https://artist.example/news/tour</link>
      <pubDate>Sun, 23 Aug 2026 10:00:00 +0000</pubDate>
      <description><![CDATA[<p>New dates announced.</p>]]></description>
    </item>
  </channel>
</rss>"""


class _Response:
    def __init__(self, status_code, content=b"", headers=None, url=None):
        self.status_code = status_code
        self.content = content
        self.text = content.decode("utf-8", errors="replace")
        self.headers = headers or {}
        self.url = url


class _Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return next(self.responses)


def test_register_editorial_feed_source_requires_allowlisted_association(monkeypatch):
    captured = []
    monkeypatch.setattr(
        "crate.feeds.editorial.upsert_external_feed_source",
        lambda **kwargs: captured.append(kwargs) or {"id": 7},
    )

    result = register_editorial_feed_source(
        source_kind="artist_site",
        source_url="https://news.artist.example/feed.xml",
        canonical_url="https://artist.example/news",
        artist_id=42,
        association_method="artist_official",
        allowed_hosts=["news.artist.example"],
    )

    assert result == {"id": 7}
    assert captured == [
        {
            "source_kind": "artist_site",
            "source_url": "https://news.artist.example/feed.xml",
            "canonical_url": "https://artist.example/news",
            "artist_id": 42,
            "association_method": "artist_official",
            "parser_version": "editorial-feed-v1",
            "refresh_interval_seconds": 21600,
        }
    ]

    with pytest.raises(ValueError, match="allowlist"):
        register_editorial_feed_source(
            source_kind="artist_site",
            source_url="https://evil.example/feed.xml",
            canonical_url="https://artist.example/news",
            artist_id=42,
            association_method="artist_official",
            allowed_hosts=["news.artist.example"],
        )


def test_register_editorial_feed_source_rejects_unknown_kind_or_association():
    assert "artist_site" in EDITORIAL_SOURCE_KINDS
    with pytest.raises(ValueError, match="source kind"):
        register_editorial_feed_source(
            source_kind="bandcamp_rss",
            source_url="https://artist.example/feed.xml",
            canonical_url="https://artist.example/news",
            artist_id=42,
            association_method="artist_official",
            allowed_hosts=["artist.example"],
        )
    with pytest.raises(ValueError, match="association"):
        register_editorial_feed_source(
            source_kind="artist_site",
            source_url="https://artist.example/feed.xml",
            canonical_url="https://artist.example/news",
            artist_id=42,
            association_method="guessed",
            allowed_hosts=["artist.example"],
        )


def test_validate_editorial_feed_url_requires_https_without_credentials():
    assert validate_editorial_feed_url("https://artist.example/feed.xml") == (
        "https://artist.example/feed.xml"
    )
    with pytest.raises(ValueError, match="HTTPS"):
        validate_editorial_feed_url("http://artist.example/feed.xml")
    with pytest.raises(ValueError, match="credentials"):
        validate_editorial_feed_url("https://user:pass@artist.example/feed.xml")


def test_parse_editorial_feed_payload_normalizes_generic_rss():
    items = parse_editorial_feed_payload(
        RSS_PAYLOAD,
        source_url="https://artist.example/feed.xml",
    )

    assert len(items) == 1
    assert items[0].external_guid == "news-1"
    assert items[0].title == "Tour announcement"
    assert items[0].canonical_url == "https://artist.example/news/tour"
    assert items[0].published_at == datetime(2026, 8, 23, 10, 0, tzinfo=timezone.utc)
    assert items[0].item_kind == "release"
    assert items[0].excerpt == "New dates announced."
    assert items[0].payload["parser_version"] == "editorial-feed-v1"


def test_fetch_editorial_feed_supports_304_and_rejects_cross_host_redirect():
    session = _Session(
        [
            _Response(
                304,
                headers={"ETag": '"new"', "Last-Modified": "Sun, 23 Aug 2026"},
                url="https://artist.example/feed.xml",
            )
        ]
    )
    result = fetch_editorial_feed(
        "https://artist.example/feed.xml",
        session=session,
        etag='"old"',
        last_modified="Sat, 22 Aug 2026",
    )
    assert result.not_modified is True
    assert result.etag == '"new"'
    assert session.calls[0][1]["headers"]["If-None-Match"] == '"old"'
    assert session.calls[0][1]["headers"]["If-Modified-Since"] == "Sat, 22 Aug 2026"

    with pytest.raises(EditorialFeedInvalidError, match="allowlist"):
        fetch_editorial_feed(
            "https://artist.example/feed.xml",
            session=_Session(
                [
                    _Response(
                        200,
                        content=RSS_PAYLOAD,
                        headers={"Content-Type": "application/rss+xml"},
                        url="https://cdn.example/feed.xml",
                    )
                ]
            ),
        )


def test_fetch_editorial_feed_maps_http_errors_and_robots_policy():
    with pytest.raises(EditorialFeedHTTPError) as error:
        fetch_editorial_feed(
            "https://artist.example/feed.xml",
            session=_Session([_Response(429, headers={"Retry-After": "90"})]),
        )
    assert error.value.status_code == 429
    assert error.value.retry_after_seconds == 90

    disallowed = can_fetch_editorial_source(
        "https://artist.example/feed.xml",
        session=_Session(
            [
                _Response(
                    200,
                    content=b"User-agent: *\nDisallow: /feed.xml\n",
                    url="https://artist.example/robots.txt",
                )
            ]
        ),
    )
    assert disallowed is False

    allowed_when_missing = can_fetch_editorial_source(
        "https://artist.example/feed.xml",
        session=_Session([_Response(404, url="https://artist.example/robots.txt")]),
    )
    assert allowed_when_missing is True
