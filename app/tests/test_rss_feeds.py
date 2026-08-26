from datetime import datetime, timezone
from pathlib import Path

import pytest

from crate.feeds.rss import (
    RSSFeedHTTPError,
    RSSFeedInvalidError,
    RSSFeedNotFoundError,
    build_conditional_headers,
    discover_feed_url,
    discover_rss_feed_from_page,
    fetch_rss_feed,
    parse_rss_payload,
)


FIXTURES = Path(__file__).parent / "fixtures" / "bandcamp"


RSS_PAYLOAD = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example artist</title>
    <item>
      <guid isPermaLink="false">release-1</guid>
      <title>New &amp; Loud</title>
      <link>https://example.bandcamp.com/album/new-loud</link>
      <pubDate>Sat, 22 Aug 2026 12:30:00 +0000</pubDate>
      <dc:creator>Example artist</dc:creator>
      <description><![CDATA[<p>A noisy <strong>release</strong>.</p>]]></description>
      <media:content url="https://example.bandcamp.com/img.jpg" />
    </item>
  </channel>
</rss>"""


ATOM_PAYLOAD = b"""<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example artist</title>
  <entry>
    <id>https://example.bandcamp.com/album/quiet</id>
    <title>Quiet</title>
    <link rel="alternate" href="https://example.bandcamp.com/album/quiet" />
    <published>2026-08-21T18:00:00Z</published>
    <author><name>Example artist</name></author>
    <content type="html">A quiet release.</content>
  </entry>
</feed>"""


def test_parse_rss_payload_normalizes_item_fields_and_hashes_content():
    items = parse_rss_payload(
        RSS_PAYLOAD, source_url="https://example.bandcamp.com/feed"
    )

    assert len(items) == 1
    item = items[0]
    assert item.external_guid == "release-1"
    assert item.title == "New & Loud"
    assert item.canonical_url == "https://example.bandcamp.com/album/new-loud"
    assert item.published_at == datetime(2026, 8, 22, 12, 30, tzinfo=timezone.utc)
    assert item.author == "Example artist"
    assert item.excerpt == "A noisy release."
    assert item.image_url == "https://example.bandcamp.com/img.jpg"
    assert len(item.content_hash) == 64


def test_parse_rss_payload_accepts_atom_and_uses_id_when_guid_is_missing():
    items = parse_rss_payload(
        ATOM_PAYLOAD,
        source_url="https://example.bandcamp.com/feed",
    )

    assert len(items) == 1
    assert items[0].external_guid == "https://example.bandcamp.com/album/quiet"
    assert items[0].published_at == datetime(2026, 8, 21, 18, 0, tzinfo=timezone.utc)


def test_discover_feed_url_only_accepts_bandcamp_hosts_and_xml_links():
    html = b"""<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" type="application/rss+xml" href="https://evil.example/feed.xml">
    </head></html>"""

    assert (
        discover_feed_url(
            "https://example.bandcamp.com/music",
            html,
        )
        == "https://example.bandcamp.com/feed.xml"
    )


def test_discover_feed_url_returns_none_without_autodiscovery():
    assert discover_feed_url("https://example.bandcamp.com/music", b"<html />") is None


def test_discover_rss_feed_from_page_fetches_public_html_without_cookies():
    session = _Session(
        _Response(
            200,
            content=b'<link rel="alternate" type="application/rss+xml" href="/feed">',
            headers={"Content-Type": "text/html"},
            url="https://example.bandcamp.com/",
        )
    )

    assert (
        discover_rss_feed_from_page(
            "https://example.bandcamp.com",
            session=session,
        )
        == "https://example.bandcamp.com/feed"
    )
    assert session.calls[0][1]["headers"]["Accept"].startswith("text/html")
    assert "cookies" not in session.calls[0][1]


def test_bandcamp_feed_urls_require_https():
    with pytest.raises(ValueError, match="HTTPS"):
        parse_rss_payload(RSS_PAYLOAD, source_url="http://example.bandcamp.com/feed")


def test_parse_rss_payload_rejects_html_and_unsafe_doctype():
    html = (FIXTURES / "unexpected-html.html").read_bytes()
    with pytest.raises(RSSFeedInvalidError, match="XML"):
        parse_rss_payload(html, source_url="https://example.bandcamp.com/feed")

    unsafe = b"<!DOCTYPE rss [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><rss />"
    with pytest.raises(RSSFeedInvalidError, match="DOCTYPE|ENTITY"):
        parse_rss_payload(unsafe, source_url="https://example.bandcamp.com/feed")


def test_parse_rss_payload_enforces_item_and_document_limits():
    with pytest.raises(RSSFeedInvalidError, match="maximum size"):
        parse_rss_payload(
            RSS_PAYLOAD,
            source_url="https://example.bandcamp.com/feed",
            max_bytes=10,
        )

    with pytest.raises(RSSFeedInvalidError, match="maximum number"):
        parse_rss_payload(
            RSS_PAYLOAD,
            source_url="https://example.bandcamp.com/feed",
            max_items=0,
        )


def test_build_conditional_headers_preserves_only_cache_validators():
    assert build_conditional_headers(
        etag='"abc"', last_modified="Sat, 22 Aug 2026"
    ) == {
        "If-None-Match": '"abc"',
        "If-Modified-Since": "Sat, 22 Aug 2026",
    }


class _Response:
    def __init__(self, status_code: int, content: bytes = b"", headers=None, url=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}
        self.url = url


class _Session:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


def test_fetch_rss_feed_handles_304_and_sends_validators():
    session = _Session(
        _Response(
            304,
            headers={"ETag": '"next"', "Last-Modified": "Sun, 23 Aug 2026"},
        )
    )

    result = fetch_rss_feed(
        "https://example.bandcamp.com/feed",
        session=session,
        etag='"old"',
        last_modified="Sat, 22 Aug 2026",
    )

    assert result.not_modified is True
    assert result.items == ()
    assert result.etag == '"next"'
    assert session.calls[0][1]["headers"] == {
        "If-None-Match": '"old"',
        "If-Modified-Since": "Sat, 22 Aug 2026",
    }


@pytest.mark.parametrize("status", [403, 429])
def test_fetch_rss_feed_exposes_rate_and_access_errors(status):
    session = _Session(_Response(status, headers={"Retry-After": "120"}))

    with pytest.raises(RSSFeedHTTPError) as error:
        fetch_rss_feed("https://example.bandcamp.com/feed", session=session)

    assert error.value.status_code == status
    assert error.value.retry_after_seconds == 120


def test_fetch_rss_feed_maps_404_to_not_found():
    with pytest.raises(RSSFeedNotFoundError):
        fetch_rss_feed(
            "https://example.bandcamp.com/feed",
            session=_Session(_Response(404)),
        )


def test_fetch_rss_feed_rejects_redirect_outside_bandcamp():
    with pytest.raises(RSSFeedInvalidError, match="redirected"):
        fetch_rss_feed(
            "https://example.bandcamp.com/feed",
            session=_Session(
                _Response(
                    200,
                    content=RSS_PAYLOAD,
                    headers={"Content-Type": "application/rss+xml"},
                    url="https://evil.example/feed",
                )
            ),
        )
