"""Reusable genre facet values and taxonomy-node assignments."""


def create_genre_taxonomy_facets_v136_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_facet_values (
            id SERIAL PRIMARY KEY,
            dimension TEXT NOT NULL,
            slug TEXT NOT NULL,
            name TEXT NOT NULL,
            CONSTRAINT genre_taxonomy_facet_values_dimension_check
                CHECK (dimension IN (
                    'era', 'instrumentation', 'language', 'mood', 'origin',
                    'rhythm', 'scene', 'sound', 'vocals'
                )),
            CONSTRAINT genre_taxonomy_facet_values_slug_check
                CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
            CONSTRAINT genre_taxonomy_facet_values_dimension_slug_key
                UNIQUE (dimension, slug)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_node_facets (
            genre_id INTEGER NOT NULL
                REFERENCES genre_taxonomy_nodes(id) ON DELETE CASCADE,
            facet_id INTEGER NOT NULL
                REFERENCES genre_taxonomy_facet_values(id) ON DELETE CASCADE,
            PRIMARY KEY (genre_id, facet_id)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_node_facets_facet "
        "ON genre_taxonomy_node_facets(facet_id, genre_id)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_raw_tag_classifications (
            genre_id INTEGER PRIMARY KEY
                REFERENCES genres(id) ON DELETE CASCADE,
            classification TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT genre_taxonomy_raw_tag_classification_check
                CHECK (classification IN ('genre', 'facet', 'hybrid', 'ignore'))
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_raw_tag_facets (
            genre_id INTEGER NOT NULL
                REFERENCES genre_taxonomy_raw_tag_classifications(genre_id)
                ON DELETE CASCADE,
            facet_id INTEGER NOT NULL
                REFERENCES genre_taxonomy_facet_values(id) ON DELETE CASCADE,
            PRIMARY KEY (genre_id, facet_id)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_raw_tag_facets_facet "
        "ON genre_taxonomy_raw_tag_facets(facet_id, genre_id)"
    )


__all__ = ["create_genre_taxonomy_facets_v136_schema"]
