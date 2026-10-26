from sqlalchemy import text

from crate.db.tx import read_scope


def _key(name: str) -> str:
    return name.lower()


def _link_key(a: str, b: str) -> tuple[str, str]:
    left, right = _key(a), _key(b)
    return (min(left, right), max(left, right))


def _append_unique_link(
    *,
    links: list[dict],
    seen_links: set[tuple[str, str]],
    source: str,
    target: str,
    score: float,
) -> None:
    key = _link_key(source, target)
    if key in seen_links:
        return
    seen_links.add(key)
    links.append({"source": source, "target": target, "value": score})


def _lookup_artist_refs(nodes: dict[str, dict]) -> dict[str, dict]:
    all_node_names = [node["id"].lower() for node in nodes.values()]
    if not all_node_names:
        return {}

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT id, slug, name
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                """
                ),
                {"names": all_node_names},
            )
            .mappings()
            .all()
        )
    return {
        row["name"].lower(): {"artist_id": row["id"], "artist_slug": row["slug"]}
        for row in rows
    }


# Similarities are stored per library artist (its Last.fm neighbours). Reading
# both directions lets an artist outside the library reach the library artists
# that list it, so every node can be expanded.
_RELATIONS_SQL = """
    SELECT LOWER(artist_name) AS parent_key, similar_name AS other,
           score, in_library
    FROM artist_similarities
    WHERE LOWER(artist_name) = ANY(:keys)
    UNION ALL
    SELECT LOWER(similar_name) AS parent_key, artist_name AS other,
           score, TRUE AS in_library
    FROM artist_similarities
    WHERE LOWER(similar_name) = ANY(:keys)
"""


def _ranked_relations(session, keys: list[str], per_parent: int) -> list[dict]:
    return [
        dict(row)
        for row in session.execute(
            text(
                f"""
                WITH relations AS ({_RELATIONS_SQL}),
                deduped AS (
                    SELECT DISTINCT ON (parent_key, LOWER(other))
                           parent_key, other, score, in_library
                    FROM relations
                    WHERE LOWER(other) <> parent_key
                    ORDER BY parent_key, LOWER(other), score DESC
                ),
                ranked AS (
                    SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY parent_key ORDER BY score DESC
                    ) AS rank
                    FROM deduped
                )
                SELECT parent_key, other, score, in_library
                FROM ranked
                WHERE rank <= :per_parent
                ORDER BY score DESC
                """
            ),
            {"keys": keys, "per_parent": per_parent},
        )
        .mappings()
        .all()
    ]


def get_artist_network(
    artist_name: str, depth: int = 2, limit_per_level: int = 15
) -> dict:
    """Return {nodes, links} for ForceGraph2D.

    depth=1: center + direct similar
    depth=2: center + direct similar + similar-of-similar
    """
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    seen_links: set[tuple[str, str]] = set()

    center_key = _key(artist_name)
    nodes[center_key] = {
        "id": artist_name,
        "group": 0,
        "in_library": True,
        "score": 1.0,
    }

    with read_scope() as session:
        level1 = _ranked_relations(session, [center_key], limit_per_level)
        level1_keys: list[str] = []
        for row in level1:
            name = row["other"]
            node_key = _key(name)
            if node_key not in nodes:
                nodes[node_key] = {
                    "id": name,
                    "group": 1,
                    "in_library": bool(row["in_library"]),
                    "score": float(row["score"]),
                }
                level1_keys.append(node_key)
            _append_unique_link(
                links=links,
                seen_links=seen_links,
                source=artist_name,
                target=nodes[node_key]["id"],
                score=float(row["score"]),
            )

        # Over-fetch per parent so links between existing nodes survive the cap.
        level2 = (
            _ranked_relations(session, level1_keys, limit_per_level * 2)
            if depth >= 2 and level1_keys
            else []
        )

    per_parent: dict[str, int] = {}
    for row in level2:
        parent_key = row["parent_key"]
        other = row["other"]
        other_key = _key(other)
        score = float(row["score"])
        if parent_key not in nodes:
            continue
        if other_key in nodes:
            _append_unique_link(
                links=links,
                seen_links=seen_links,
                source=nodes[parent_key]["id"],
                target=nodes[other_key]["id"],
                score=score,
            )
            continue
        count = per_parent.get(parent_key, 0)
        if count >= limit_per_level:
            continue
        per_parent[parent_key] = count + 1
        nodes[other_key] = {
            "id": other,
            "group": 2,
            "in_library": bool(row["in_library"]),
            "score": score,
        }
        _append_unique_link(
            links=links,
            seen_links=seen_links,
            source=nodes[parent_key]["id"],
            target=other,
            score=score,
        )

    refs_by_name = _lookup_artist_refs(nodes)
    for node in nodes.values():
        if node["id"].lower() in refs_by_name:
            node["in_library"] = True
        ref = refs_by_name.get(node["id"].lower())
        if ref:
            node.update(ref)

    return {"nodes": list(nodes.values()), "links": links}


__all__ = [
    "get_artist_network",
]
