import random
import re

from crate.db.queries.browse_media_search import build_fts_query
from crate.federation.summary_bloom import (
    MIN_PREFIX,
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


def test_tokens_agree_with_fts_query():
    for n in _fixture_names() + ["!!!", "", "  ", "AC/DC"]:
        fts = build_fts_query(n)
        expected = (
            [] if fts is None else [p.removesuffix(":*") for p in fts.split(" & ")]
        )
        assert name_tokens(n) == expected, n
    assert name_tokens(None) == []


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
