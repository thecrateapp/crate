import itertools
import random
import re
import time

import pytest

from crate.federation.summary_bloom import (
    MIN_PREFIX,
    TOKENIZER,
    BloomFilter,
    artist_key,
    name_tokens,
    query_probe_terms,
    summary_terms,
)

_SPECIAL = [
    ("Björk", "Homogenic", "Jóga"),
    ("AC/DC", "Back in Black", "Hells Bells"),
    ("Sigur Rós", "Ágætis byrjun", "Svefn-g-englar"),
    ("坂本龍一", "async", "andata"),
    ("!!!", "Louden Up Now", "Me and Giuliani"),
    ("U2", "War", "Sunday Bloody Sunday"),
    ("Joy Division", "Unknown Pleasures", "Disorder"),
]


def _fixture_triples():
    rng = random.Random(7)
    syll = ["ka", "lo", "mi", "ra", "zen", "tu", "vel", "dor", "an", "ex", "ys", "ob"]
    triples = list(_SPECIAL)
    while len(triples) < 2000:

        def word():
            return "".join(rng.choice(syll) for _ in range(rng.randint(1, 3)))

        triples.append(
            (
                " ".join(word() for _ in range(rng.randint(1, 3))),
                " ".join(word() for _ in range(rng.randint(1, 4))),
                " ".join(word() for _ in range(rng.randint(1, 4))),
            )
        )
    return triples


def _fixture_names():
    return [n for t in _fixture_triples() for n in t]


def _build(names):
    terms = summary_terms(*names)
    f = BloomFilter.sized(len(terms))
    for t in terms:
        f.add(t)
    return f, terms


def test_no_false_negatives_on_fixture():
    names = _fixture_names()
    f, terms = _build(names)
    assert all(t in f for t in terms)
    for name in names:
        words = re.findall(r"\w+", name, re.UNICODE)
        for i in range(1, len(words) + 1):
            for cut in range(1, len(words[i - 1]) + 1):
                q = " ".join(words[: i - 1] + [words[i - 1][:cut]])
                probes = query_probe_terms(q)
                if probes is not None:
                    assert all(p in f for p in probes), q
    for q in ("sigur r", "bjö", "坂本", "ac", "hells b"):
        probes = query_probe_terms(q)
        if probes is not None:
            assert all(p in f for p in probes), q


def test_measured_false_positive_rate():
    rng = random.Random(1234)
    members = {f"m{rng.getrandbits(48):012x}" for _ in range(50_000)}
    f = BloomFilter.sized(len(members))
    for t in members:
        f.add(t)
    assert all(t in f for t in list(members)[:1000])
    probes = [f"x{rng.getrandbits(48):012x}" for _ in range(20_000)]
    rate = sum(1 for p in probes if p in f) / len(probes)
    print(f"measured fp rate: {rate:.5f}")
    assert rate <= 0.015


def test_round_trip_bytes():
    f, terms = _build(_fixture_names()[:300])
    g = BloomFilter.from_bytes(f.to_bytes(), m=f.params["m"], k=f.params["k"])
    assert g.to_bytes() == f.to_bytes()
    for t in list(terms)[:200] + ["zzzzqq", "nothere", "qqqq1"]:
        assert (t in g) == (t in f)


def test_tokens_split_on_underscores_like_postgres():
    assert TOKENIZER == "fts-simple-v2"
    assert name_tokens("my_song_title") == ["my", "song", "title"]
    assert name_tokens("__init__") == ["init"]
    assert name_tokens("AC/DC") == ["ac", "dc"]
    assert name_tokens("Sigur Rós") == ["sigur", "rós"]
    assert name_tokens(None) == [] and name_tokens("!!!") == []
    assert query_probe_terms("song_title") == ["song", "title"]


# Names whose Python tokens the owner's FTS (PostgreSQL 'simple' parser) also
# finds. Left out on purpose, as known gaps documented in federation-protocol.md:
# - "AC/DC", "R.E.M.": the parser keeps them as one file/host lexeme ('ac/dc',
#   'r.e.m'), so a later word ("dc", "m") is not a lexeme prefix there either.
# - "İstanbul": Python lowercases İ to "i" + U+0307 (a combining mark that splits
#   the word), PostgreSQL to a plain "i" ('istanbul'); locale casing, not fixable
#   in the tokenizer without diverging elsewhere.
_PG_AGREEMENT_NAMES = [
    "my_song_title",
    "hip-hop",
    "Sigur Rós",
    "Björk",
    "坂本龍一",
    "don't",
    "Joy Division",
    "Ágætis byrjun",
    "Svefn-g-englar",
    "Me and Giuliani",
    "U2",
    "snake_case_band feat. Someone",
]


def test_tokens_agree_with_postgres_simple_parser(pg_db):
    from sqlalchemy import text

    from crate.db.tx import read_scope

    with read_scope() as session:
        for name in _PG_AGREEMENT_NAMES:
            tokens = name_tokens(name)
            assert tokens, name
            for token in tokens:
                matched = session.execute(
                    text(
                        "SELECT to_tsvector('simple', :name) "
                        "@@ to_tsquery('simple', :token || ':*')"
                    ),
                    {"name": name, "token": token},
                ).scalar_one()
                assert matched, (name, token)
            # The other direction is the one that prevents false negatives: a
            # word the owner's FTS indexes must be a token the filter holds.
            # Hyphenated compounds ('hip-hop') are skipped: their parts are
            # indexed too, and a query for the compound probes those parts.
            lexemes = session.execute(
                text(
                    "SELECT unnest(lexemes) FROM ts_debug('simple', :name) "
                    "WHERE alias NOT IN ('asciihword', 'hword', 'numhword')"
                ),
                {"name": name},
            ).scalars()
            for lexeme in lexemes:
                assert lexeme in tokens, (name, lexeme)


def test_unroutable_queries_return_none():
    for q in ("u2", "!!!", "a b", "", "  "):
        assert query_probe_terms(q) is None, q
    assert query_probe_terms("joy di") == ["joy"]
    assert query_probe_terms("joy division") == ["joy", "division"]


def test_empty_filter_matches_nothing():
    f = BloomFilter.sized(0)
    assert f.params["m"] == 64 and f.params["k"] >= 1
    assert not any(t in f for t in ("a", "joy", "björk", ""))


def test_summary_terms_prefixes_and_artist_key():
    assert summary_terms("U2", None) == {"u2"}
    assert summary_terms("Joy") == {"joy"}
    assert summary_terms("Bjork") == {"bjork", "bjo", "bjor"}
    assert MIN_PREFIX == 3
    assert artist_key(None) is None and artist_key("!!!") is None
    assert artist_key("AC/DC") == artist_key("ac dc")
    assert len(artist_key("AC/DC")) == 16


@pytest.mark.slow
def test_reference_catalog_size():
    """Production-sized catalogue: 1,050 artists, 10,900 albums, 138,000 tracks."""
    rng = random.Random(20261118)
    syll = [
        a + b
        for a in ("b", "c", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v")
        for b in ("a", "e", "i", "o", "u", "ar", "en", "il", "or", "un")
    ]
    vocab = sorted(
        {
            "".join(rng.choice(syll) for _ in range(rng.randint(1, 4)))
            for _ in range(90_000)
        }
    )
    # Zipf-like word choice: a few common words, a long tail of rare ones.
    cum_weights = list(itertools.accumulate(1.0 / (i + 10) for i in range(len(vocab))))

    def title(lo: int, hi: int) -> str:
        words = rng.choices(vocab, cum_weights=cum_weights, k=rng.randint(lo, hi))
        return " ".join(words)

    artists = [title(1, 3) for _ in range(1_050)]
    albums = [(title(1, 4), rng.choice(artists)) for _ in range(10_900)]
    tracks = []
    for _ in range(138_000):
        album, artist = rng.choice(albums)
        tracks.append((title(1, 5), artist, album))

    started = time.perf_counter()
    terms: set[str] = set()
    for name in artists:
        terms |= summary_terms(name)
    for album, artist in albums:
        terms |= summary_terms(album, artist)
    for track, artist, album in tracks:
        terms |= summary_terms(track, artist, album)
    bloom = BloomFilter.sized(len(terms))
    for term in sorted(terms):
        bloom.add(term)
    elapsed = time.perf_counter() - started
    size = len(bloom.to_bytes())

    assert all(t in bloom for t in rng.sample(sorted(terms), 5_000))
    probes = [f"zz{rng.getrandbits(48):012x}" for _ in range(100_000)]
    assert not terms.intersection(probes)
    rate = sum(1 for p in probes if p in bloom) / len(probes)
    print(
        f"reference catalogue: terms={len(terms)} bytes={size} "
        f"m={bloom.params['m']} k={bloom.params['k']} "
        f"fp={rate:.5f} build_seconds={elapsed:.2f}"
    )
    assert rate <= 0.015
