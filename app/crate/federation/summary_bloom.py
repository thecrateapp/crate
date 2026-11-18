"""Tokenizer and Bloom filter shared by the summary owner and receiver.

The owner builds a Bloom filter of word tokens (and their prefixes) of the
names a peer may search; the receiver probes it with a search query to decide
whether the peer is worth asking. Byte layout and hashing are deterministic
across processes and machines. Stdlib only.
"""

from __future__ import annotations

import math
import re
from hashlib import blake2b

SUMMARY_CONTRACT = "crate.federation.summary/1"
TOKENIZER = "fts-simple-v2"
MIN_PREFIX = 3
FP_TARGET = 0.01

_PERSON = b"crate-sum-v1"
# Letters and digits only: PostgreSQL's 'simple' parser splits on "_" too
# ('my_song_title' -> my, song, title), so the filter must hold those words.
_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def name_tokens(text: str | None) -> list[str]:
    """Lowercased word tokens as PostgreSQL's 'simple' FTS parser splits them."""
    if not text:
        return []
    return _TOKEN_RE.findall(text.strip().lower())


def summary_terms(*texts: str | None) -> set[str]:
    """Every token whole, plus its prefixes of length MIN_PREFIX..len-1."""
    terms: set[str] = set()
    for text in texts:
        for token in name_tokens(text):
            terms.add(token)
            for end in range(MIN_PREFIX, len(token)):
                terms.add(token[:end])
    return terms


def query_probe_terms(query: str) -> list[str] | None:
    """Terms a query must find in a summary, or None when it is unroutable.

    Tokens shorter than MIN_PREFIX are dropped; the last token is probed as is
    (it matches either a whole token or an inserted prefix).
    """
    probes = [t for t in name_tokens(query) if len(t) >= MIN_PREFIX]
    return probes or None


def artist_key(name: str | None) -> str | None:
    tokens = name_tokens(name)
    if not tokens:
        return None
    return blake2b(" ".join(tokens).encode(), digest_size=8).hexdigest()


class BloomFilter:
    def __init__(self, m: int, k: int, bits: bytearray | None = None, n: int = 0):
        self._m = m
        self._k = k
        self._bits = bits if bits is not None else bytearray((m + 7) // 8)
        self._n = n
        self._fp_target = FP_TARGET

    @classmethod
    def sized(cls, n: int, fp_rate: float = FP_TARGET) -> BloomFilter:
        if n <= 0:
            m, k = 64, 1
        else:
            m = max(64, math.ceil(-n * math.log(fp_rate) / math.log(2) ** 2))
            k = max(1, round(m / n * math.log(2)))
        f = cls(m, k)
        f._fp_target = fp_rate
        return f

    @classmethod
    def from_bytes(cls, data: bytes, *, m: int, k: int) -> BloomFilter:
        if m <= 0 or k <= 0 or len(data) != (m + 7) // 8:
            raise ValueError("bloom bytes do not match m/k")
        return cls(m, k, bytearray(data))

    def _positions(self, term: str):
        d = blake2b(term.encode(), digest_size=16, person=_PERSON).digest()
        h1 = int.from_bytes(d[:8], "little")
        h2 = int.from_bytes(d[8:], "little") | 1
        return ((h1 + i * h2) % self._m for i in range(self._k))

    def add(self, term: str) -> None:
        for pos in self._positions(term):
            self._bits[pos >> 3] |= 1 << (pos & 7)
        self._n += 1

    def __contains__(self, term: str) -> bool:
        return all(
            self._bits[pos >> 3] & (1 << (pos & 7)) for pos in self._positions(term)
        )

    def to_bytes(self) -> bytes:
        return bytes(self._bits)

    @property
    def params(self) -> dict:
        return {
            "m": self._m,
            "k": self._k,
            "n": self._n,
            "fp_target": self._fp_target,
            "hash": "blake2b-128-km",
            "tokenizer": TOKENIZER,
            "min_prefix": MIN_PREFIX,
        }
