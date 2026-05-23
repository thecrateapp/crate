from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Mapping
from urllib.parse import urlencode, urlparse, urlunparse

import requests

from crate.bandcamp.client import assert_bandcamp_url, is_bandcamp_host
from crate.utils import normalize_key


class BandcampSearchError(RuntimeError):
    pass


@dataclass(frozen=True)
class BandcampSearchResult:
    item_type: str
    title: str
    artist: str
    url: str


class _BandcampSearchParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[BandcampSearchResult] = []
        self._result: dict[str, str] | None = None
        self._field: str | None = None
        self._field_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        classes = set(attr.get("class", "").split())
        if tag == "li" and "searchresult" in classes:
            self._result = {"item_type": "", "title": "", "artist": "", "url": ""}
            self._field = None
            self._field_depth = 0
            return
        if self._result is None:
            return
        if tag == "div" and "itemtype" in classes:
            self._field = "item_type"
            self._field_depth = 1
            return
        if tag == "div" and "heading" in classes:
            self._field = "title"
            self._field_depth = 1
            return
        if tag == "div" and "subhead" in classes:
            self._field = "artist"
            self._field_depth = 1
            return
        if self._field:
            self._field_depth += 1
        if tag == "a" and self._field == "title" and attr.get("href"):
            self._result["url"] = attr["href"]

    def handle_endtag(self, tag: str) -> None:
        if self._result is None:
            return
        if tag == "li":
            result = _search_result_from_payload(self._result)
            if result:
                self.results.append(result)
            self._result = None
            self._field = None
            self._field_depth = 0
            return
        if self._field:
            self._field_depth -= 1
            if self._field_depth <= 0:
                self._field = None
                self._field_depth = 0

    def handle_data(self, data: str) -> None:
        if self._result is None or not self._field:
            return
        current = self._result.get(self._field, "")
        self._result[self._field] = f"{current} {data}".strip()


class _BandcampPageMetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        key = attr.get("property") or attr.get("name")
        content = attr.get("content")
        if key and content:
            self.meta[key.lower()] = " ".join(content.split())

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title = " ".join(f"{self.title} {data}".split())


def search_bandcamp(
    query: str,
    *,
    item_type: str = "",
    timeout: float = 12.0,
) -> list[BandcampSearchResult]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return []
    params: dict[str, Any] = {"q": normalized_query}
    if item_type:
        params["item_type"] = item_type
    url = f"https://bandcamp.com/search?{urlencode(params)}"
    try:
        response = requests.get(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise BandcampSearchError("Bandcamp search request failed") from exc
    if response.status_code >= 400:
        raise BandcampSearchError(f"Bandcamp search failed with {response.status_code}")
    if _is_client_challenge(response.text):
        raise BandcampSearchError("Bandcamp search returned a client challenge")
    return parse_bandcamp_search_results(response.text)


def parse_bandcamp_search_results(html_text: str) -> list[BandcampSearchResult]:
    parser = _BandcampSearchParser()
    parser.feed(html_text)
    return parser.results


def find_exact_artist_url(
    artist_name: str,
    *,
    search_fn=search_bandcamp,
    allow_search: bool = True,
) -> str | None:
    target = normalize_key(artist_name)
    if search_fn is search_bandcamp:
        direct_url = _find_exact_artist_url_by_direct_probe(artist_name)
        if direct_url:
            return direct_url
    if allow_search:
        for result in search_fn(artist_name, item_type="b"):
            if result.item_type not in {"artist", "band"}:
                continue
            if normalize_key(result.title) == target:
                return result.url
    return None


def find_exact_album_url(
    artist_name: str,
    album_title: str,
    *,
    search_fn=search_bandcamp,
    artist_url: str | None = None,
    allow_search: bool = True,
) -> str | None:
    artist_target = normalize_key(artist_name)
    album_target = normalize_key(album_title)
    if not artist_target or not album_target:
        return None
    if search_fn is search_bandcamp:
        direct_url = _find_exact_album_url_by_direct_probe(
            artist_name,
            album_title,
            artist_url=artist_url,
        )
        if direct_url:
            return direct_url
    if allow_search:
        query = f"{artist_name} {album_title}"
        for result in search_fn(query, item_type="a"):
            if result.item_type != "album":
                continue
            if normalize_key(result.title) != album_target:
                continue
            if normalize_key(_strip_bandcamp_by_prefix(result.artist)) != artist_target:
                continue
            return result.url
    return None


def find_bandcamp_url_in_metadata(
    metadata: Any,
    *,
    entity_type: str,
) -> str | None:
    keep_path = entity_type == "album"
    for value in _iter_metadata_values(metadata):
        url = _clean_bandcamp_url(value, keep_path=keep_path)
        if url:
            return url
    return None


def _find_exact_artist_url_by_direct_probe(artist_name: str) -> str | None:
    target = normalize_key(artist_name)
    if not target:
        return None
    for url in _candidate_artist_urls(artist_name):
        try:
            response = _request_bandcamp_page(url)
        except BandcampSearchError:
            raise
        except Exception:
            continue
        if response.status_code == 404:
            continue
        if response.status_code >= 400:
            continue
        meta = _parse_page_meta(response.text)
        if normalize_key(meta.meta.get("og:site_name", "")) == target:
            return _clean_bandcamp_url(response.url, keep_path=False)
        title_artist = _title_artist(meta.title)
        if title_artist and normalize_key(title_artist) == target:
            return _clean_bandcamp_url(response.url, keep_path=False)
    return None


def _find_exact_album_url_by_direct_probe(
    artist_name: str,
    album_title: str,
    *,
    artist_url: str | None,
) -> str | None:
    artist_target = normalize_key(artist_name)
    album_target = normalize_key(album_title)
    if not artist_target or not album_target:
        return None
    artist_urls = []
    cleaned_artist_url = _clean_bandcamp_url(artist_url, keep_path=False)
    if cleaned_artist_url:
        artist_urls.append(cleaned_artist_url)
    artist_urls.extend(
        url for url in _candidate_artist_urls(artist_name) if url not in artist_urls
    )
    for root_url in artist_urls:
        for album_slug in _candidate_slugs(album_title):
            url = f"{root_url}/album/{album_slug}"
            try:
                response = _request_bandcamp_page(url)
            except BandcampSearchError:
                raise
            except Exception:
                continue
            if response.status_code == 404:
                continue
            if response.status_code >= 400:
                continue
            meta = _parse_page_meta(response.text)
            page_album, page_artist = _album_artist_from_meta(meta)
            if (
                normalize_key(page_album) == album_target
                and normalize_key(page_artist) == artist_target
            ):
                return _clean_bandcamp_url(response.url, keep_path=True)
    return None


def _search_result_from_payload(payload: dict[str, str]) -> BandcampSearchResult | None:
    url = payload.get("url", "").strip()
    if not url:
        return None
    try:
        assert_bandcamp_url(url)
    except Exception:
        return None
    return BandcampSearchResult(
        item_type=payload.get("item_type", "").strip().lower(),
        title=" ".join(payload.get("title", "").split()),
        artist=" ".join(payload.get("artist", "").split()),
        url=url,
    )


def _strip_bandcamp_by_prefix(value: str) -> str:
    normalized = value.strip()
    if normalized.lower().startswith("by "):
        return normalized[3:].strip()
    return normalized


def _request_bandcamp_page(url: str):
    try:
        response = requests.get(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
            },
            timeout=12.0,
            allow_redirects=True,
        )
    except requests.RequestException as exc:
        raise BandcampSearchError("Bandcamp direct page request failed") from exc
    if _is_client_challenge(response.text):
        raise BandcampSearchError("Bandcamp direct page returned a client challenge")
    return response


def _is_client_challenge(html_text: str) -> bool:
    head = html_text[:5000].lower()
    return "client challenge" in head or "/_fs-ch-" in head


def _parse_page_meta(html_text: str) -> _BandcampPageMetaParser:
    parser = _BandcampPageMetaParser()
    parser.feed(html_text)
    return parser


def _album_artist_from_meta(meta: _BandcampPageMetaParser) -> tuple[str, str]:
    og_title = meta.meta.get("og:title", "")
    if ", by " in og_title:
        album, artist = og_title.rsplit(", by ", 1)
        return album.strip(), artist.strip()
    if " | " in meta.title:
        album, artist = meta.title.rsplit(" | ", 1)
        return album.strip(), artist.strip()
    return og_title.strip(), meta.meta.get("og:site_name", "").strip()


def _title_artist(title: str) -> str:
    if " | " in title:
        return title.rsplit(" | ", 1)[1].strip()
    return ""


def _candidate_artist_urls(artist_name: str) -> list[str]:
    return [f"https://{slug}.bandcamp.com" for slug in _candidate_slugs(artist_name)]


def _candidate_slugs(value: str) -> list[str]:
    ascii_value = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    )
    ascii_value = ascii_value.lower().replace("&", " and ")
    ascii_value = ascii_value.replace("'", "")
    words = re.findall(r"[a-z0-9]+", ascii_value)
    if not words:
        return []
    candidates = [
        "".join(words),
        "-".join(words),
    ]
    if words and words[0] == "the":
        candidates.extend(["".join(words[1:]), "-".join(words[1:])])
    return list(dict.fromkeys(slug for slug in candidates if slug))


def _iter_metadata_values(value: Any):
    if value is None:
        return
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                yield from _iter_metadata_values(json.loads(stripped))
                return
            except json.JSONDecodeError:
                pass
        yield value
        return
    if isinstance(value, Mapping):
        for nested in value.values():
            yield from _iter_metadata_values(nested)
        return
    if isinstance(value, list | tuple | set):
        for nested in value:
            yield from _iter_metadata_values(nested)


def _clean_bandcamp_url(url: Any, *, keep_path: bool) -> str | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not is_bandcamp_host(parsed.hostname):
        return None
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/") if keep_path else ""
    return urlunparse(("https", host, path, "", "", ""))
