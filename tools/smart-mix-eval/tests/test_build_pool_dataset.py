from __future__ import annotations

from build_dataset import dataset_row
from build_pool_dataset import pool_edges, read_uids
from crate.smart_mix.planner import score_compatibility

from tests.smart_mix_candidate_cases import INCOMING_LAYOUT, profile


def _uid(index: int) -> str:
    return f"00000000-0000-4000-8000-{index:012d}"


def _pool():
    structured = [
        profile(_uid(1), layout=INCOMING_LAYOUT, bpm=125.0),
        profile(_uid(2), layout=INCOMING_LAYOUT, bpm=127.0, camelot="9A"),
        profile(_uid(3), layout=INCOMING_LAYOUT, bpm=126.0, camelot="2B"),
        profile(_uid(4), layout=INCOMING_LAYOUT, bpm=129.5),
        profile(_uid(5), layout=INCOMING_LAYOUT, bpm=131.0),
        profile(_uid(6), layout=INCOMING_LAYOUT, bpm=140.0),
    ]
    return structured, profile(_uid(7), bpm=125.0)


def test_pool_edges_take_the_best_partner_per_tempo_band() -> None:
    structured, unsegmented = _pool()

    edges = pool_edges([*structured, unsegmented])

    by_seed: dict[str, list[str]] = {}
    for edge in edges:
        by_seed.setdefault(edge.outgoing.track_entity_uid, []).append(edge.tempo_band)
        assert edge.outgoing.phrases and edge.incoming.phrases
        assert edge.outgoing.track_entity_uid != edge.incoming.track_entity_uid
        assert edge.tempo_delta < 0.06
    assert all(len(bands) == len(set(bands)) for bands in by_seed.values())
    assert _uid(7) not in by_seed
    # 125 BPM's closest partners: 126 and 127 BPM in 0-2 %, 129.5 in 2-4 %, 131 in
    # 4-6 %; 140 BPM is beyond 6 %. In 0-2 % the better-scoring one wins.
    seed = {
        edge.tempo_band: edge
        for edge in edges
        if edge.outgoing.track_entity_uid == _uid(1)
    }
    assert set(seed) == {"0-2", "2-4", "4-6"}
    best = max(
        (structured[1], structured[2]),
        key=lambda other: score_compatibility(structured[0], other).overall,
    )
    assert seed["0-2"].incoming.track_entity_uid == best.track_entity_uid
    assert seed["2-4"].incoming.track_entity_uid == _uid(4)
    assert seed["4-6"].incoming.track_entity_uid == _uid(5)
    assert pool_edges([*structured, unsegmented], require_phrases=False) != edges


def test_pool_rows_keep_only_uids_and_revisions(tmp_path) -> None:
    structured, _unsegmented = _pool()
    uids = tmp_path / "uids.txt"
    uids.write_text(f"{_uid(2)}\n\n{_uid(1)}\n{_uid(2)}\n")

    row = dataset_row(1, pool_edges(structured)[0])

    assert read_uids(uids) == [_uid(1), _uid(2)]
    assert row["rootGenre"] == row["incomingRootGenre"] == "pool"
    assert row["stratum"] == f"pool/{row['tempoBand']}"
    assert not {"title", "artist", "album", "path"} & set(row)


def test_grouped_pool_pairs_within_groups_and_adds_a_few_crossings() -> None:
    from dataclasses import replace

    from build_pool_dataset import grouped_pool_edges

    base = profile("00000000-0000-4000-8000-000000000000", layout=INCOMING_LAYOUT)
    tracks = {}
    for index, (group, bpm) in enumerate(
        [
            ("house", 124.0),
            ("house", 125.0),
            ("house", 126.0),
            ("techno", 128.0),
            ("techno", 130.0),
            ("techno", 131.0),
            ("dnb", 172.0),
            ("dnb", 174.0),
        ]
    ):
        uid = f"00000000-0000-4000-8000-0000000000{index:02d}"
        tracks[uid] = (
            group,
            replace(base, track_entity_uid=uid, profile_revision=f"r{index}", bpm=bpm),
        )
    groups = {uid: group for uid, (group, _profile) in tracks.items()}
    profiles = [item for _group, item in tracks.values()]

    edges = grouped_pool_edges(profiles, groups, per_group=2, cross_group=2)

    within = [edge for edge in edges if edge.root_genre != "cross"]
    cross = [edge for edge in edges if edge.root_genre == "cross"]
    for edge in within:
        assert groups[edge.outgoing.track_entity_uid] == edge.root_genre
        assert groups[edge.incoming.track_entity_uid] == edge.root_genre
        assert edge.tempo_band in {"0-2", "2-4", "4-6"}
    assert {edge.root_genre for edge in within} == {"house", "techno", "dnb"}
    assert all(
        sum(1 for edge in within if edge.root_genre == group) <= 2
        for group in ("house", "techno", "dnb")
    )
    assert 1 <= len(cross) <= 2
    for edge in cross:
        assert (
            groups[edge.outgoing.track_entity_uid]
            != groups[edge.incoming.track_entity_uid]
        )
        assert edge.incoming_root_genre == groups[edge.incoming.track_entity_uid]
    # Deterministic.
    assert edges == grouped_pool_edges(profiles, groups, per_group=2, cross_group=2)
