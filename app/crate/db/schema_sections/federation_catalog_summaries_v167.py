"""Federation FED2 per-peer summaries.

`federation_catalog_summaries` is the owner side: one Bloom summary per
permission scope, built by a worker and served by the API. `scope_digest`
identifies the scope; `bloom` holds hashed bits only and
`artist_album_counts_json` hashed artist keys only, never query or catalog text.

`federation_peer_summaries` is the receiver side: the summary fetched from each
peer, read on every federated search. Removing the peer removes its summary.
"""

FEDERATION_CATALOG_SUMMARIES_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS federation_catalog_summaries (
        scope_digest TEXT PRIMARY KEY,
        contract TEXT NOT NULL,
        params_json JSONB NOT NULL,
        bloom BYTEA NOT NULL,
        artist_album_counts_json JSONB NOT NULL DEFAULT '{}',
        entry_count INTEGER NOT NULL,
        source_sequence BIGINT NOT NULL,
        etag TEXT NOT NULL,
        built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS federation_peer_summaries (
        node_uid UUID PRIMARY KEY REFERENCES federation_nodes(node_uid) ON DELETE CASCADE,
        contract TEXT NOT NULL,
        params_json JSONB NOT NULL,
        bloom BYTEA NOT NULL,
        artist_album_counts_json JSONB NOT NULL DEFAULT '{}',
        source_sequence BIGINT NOT NULL,
        etag TEXT NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
)


def create_federation_catalog_summaries_v167_schema(cur) -> None:
    for statement in FEDERATION_CATALOG_SUMMARIES_STATEMENTS:
        cur.execute(statement)


def drop_federation_catalog_summaries_v167_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS federation_peer_summaries")
    cur.execute("DROP TABLE IF EXISTS federation_catalog_summaries")


__all__ = [
    "FEDERATION_CATALOG_SUMMARIES_STATEMENTS",
    "create_federation_catalog_summaries_v167_schema",
    "drop_federation_catalog_summaries_v167_schema",
]
