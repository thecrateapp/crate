"""Scene-aware Music Paths planner."""

from __future__ import annotations

import heapq
import hashlib
import math
import re
import uuid
from collections import defaultdict, deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypedDict

from crate.db.home_taste_guardrails import track_version_penalty
from crate.db.queries.paths import load_artist_radio_graphs
from crate.genre_taxonomy import get_genre_catalog, resolve_genre_slug, slugify_genre
from crate.track_versions import track_song_identity
from crate.recommendation_policy import fresh_path_candidates, path_artist_key
from crate.config import transition_fit_enabled
from crate.smart_mix.transition_fit import RowTransitionScorer

_MIN_MEMBERSHIP_SCORE = 0.60
_ANCHOR_MEMBERSHIP_FLOOR = 0.70
_MAX_REPEAT_PER_ARTIST = 2
_ARTIST_PATH_REPEAT_PER_ARTIST = 1
_MAX_TRACKS_PER_ALBUM = 2
_ARTIST_PROFILE_GENRE_LIMIT = 5
_LONG_ARTIST_ROUTE_STEP_COUNT = 32
_TRACK_VARIETY_POOL_SIZE = 10
_TRACK_VARIETY_SCORE_FLOOR_RATIO = 0.72
_TRACK_VARIETY_SCORE_FLOOR_DROP = 0.18
_STRONG_USER_AFFINITY_THRESHOLD = 0.85
_LOCAL_SCENE_SLUG_PARTS = {
    "argentine",
    "australian",
    "brazilian",
    "canadian",
    "french",
    "german",
    "italian",
    "japanese",
    "portuguese",
    "spanish",
    "swedish",
    "transgresivo",
    "urbano",
}
_BROAD_SCENE_SLUGS = {
    "alternative",
    "hard-rock",
    "indie",
    "metal",
    "pop",
    "punk",
    "rock",
}


class ArtistProfileGenre(TypedDict):
    slug: str
    weight: float


_COUNTRY_ALIASES = {
    "america": "US",
    "england": "GB",
    "espana": "ES",
    "spain": "ES",
    "uk": "GB",
    "united kingdom": "GB",
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
}
_LOW_SIGNAL_TITLE_RE = re.compile(
    r"\b(intro|interlude|outro|reprise|skit|spoken word|voice memo|announcement|commentary)\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class _SceneTrackSignals:
    row: dict  # Retain the row so its identity cannot be reused during planning.
    membership: float
    artist_popularity: float
    track_popularity: float
    affinity: float
    catalog_depth: float
    relation: float
    curation: float
    audio_completeness: float
    energy: float | None
    bpm: float | None
    key: str
    scale: str
    vector: list[float]
    vector_norm: float


@dataclass(slots=True)
class _SceneDestinationSignals:
    row: dict
    connection: float
    genre_overlap: float
    local_penalty: float
    gravity: float


class _SceneScorer:
    """Reuse immutable candidate signals and transitions within one planning call."""

    def __init__(self):
        self._transition_fit = (
            RowTransitionScorer() if transition_fit_enabled() else None
        )
        self._signals: dict[int, _SceneTrackSignals] = {}
        self._previous_track: dict | None = None
        self._track_scores: dict[int, float] = {}
        self._transitions: dict[int, float] = {}
        self._connections: dict[int, tuple[dict, float]] = {}
        self._connection_graphs: tuple[Mapping, Mapping] | None = None
        self._row_slugs: dict[int, tuple[Mapping, set[str]]] = {}
        self._profile_slugs: dict[int, tuple[Mapping, set[str]]] = {}
        self._song_keys: dict[int, tuple[dict, tuple[str, str] | None]] = {}
        self._destination_context: tuple[object, ...] | None = None
        self._destination_scores: dict[int, _SceneDestinationSignals] = {}

    def _prepare_context(self, previous_track: dict | None) -> None:
        if previous_track is not self._previous_track:
            self._previous_track = previous_track
            self._track_scores.clear()
            self._transitions.clear()
            self._connections.clear()

    def row_genre_slugs(self, row: Mapping) -> set[str]:
        key = id(row)
        if key not in self._row_slugs:
            self._row_slugs[key] = (row, _row_genre_slugs(row))
        return self._row_slugs[key][1]

    def profile_genre_slugs(self, profile: Mapping | None) -> set[str]:
        if profile is None:
            return set()
        key = id(profile)
        if key not in self._profile_slugs:
            self._profile_slugs[key] = (profile, _profile_genre_slugs(profile))
        return self._profile_slugs[key][1]

    def song_key(self, row: dict) -> tuple[str, str] | None:
        key = id(row)
        if key not in self._song_keys:
            self._song_keys[key] = (row, track_song_identity(row))
        return self._song_keys[key][1]

    def artist_connection_score(
        self,
        row: dict,
        previous_track: dict | None,
        artist_similarity_graph: Mapping[str, Mapping[str, float]],
        shared_members_graph: Mapping[str, set[str]],
    ) -> float:
        self._prepare_context(previous_track)
        graphs = (artist_similarity_graph, shared_members_graph)
        if self._connection_graphs is None or any(
            old is not new for old, new in zip(self._connection_graphs, graphs)
        ):
            self._connection_graphs = graphs
            self._connections.clear()
        key = id(row)
        if key not in self._connections:
            self._connections[key] = (
                row,
                _artist_connection_score(
                    row, previous_track, artist_similarity_graph, shared_members_graph
                ),
            )
        return self._connections[key][1]

    def _destination_signals(
        self,
        row: dict,
        destination_track: dict,
        destination_profile: Mapping | None,
        artist_similarity_graph: Mapping[str, Mapping[str, float]],
        shared_members_graph: Mapping[str, set[str]],
    ) -> _SceneDestinationSignals:
        context = (
            destination_track,
            destination_profile,
            artist_similarity_graph,
            shared_members_graph,
        )
        if self._destination_context is None or any(
            old is not new for old, new in zip(self._destination_context, context)
        ):
            self._destination_context = context
            self._destination_scores.clear()
        key = id(row)
        if key not in self._destination_scores:
            connection = _artist_connection_score(
                row, destination_track, artist_similarity_graph, shared_members_graph
            )
            overlap = _destination_genre_overlap(
                row, destination_track, destination_profile, scorer=self
            )
            geography = _destination_geography_score(
                row, destination_track, destination_profile
            )
            era = _destination_era_score(row, destination_track, destination_profile)
            penalty = _local_scene_penalty(
                row,
                destination_track=destination_track,
                destination_profile=destination_profile,
                connection_score=connection,
                genre_overlap=overlap,
                scorer=self,
            )
            self._destination_scores[key] = _SceneDestinationSignals(
                row=row,
                connection=connection,
                genre_overlap=overlap,
                local_penalty=penalty,
                gravity=(
                    (0.48 * connection)
                    + (0.34 * overlap)
                    + (0.10 * geography)
                    + (0.08 * era)
                    - (0.38 * penalty)
                ),
            )
        return self._destination_scores[key]

    def destination_gravity_score(
        self,
        row: dict,
        *,
        destination_track: dict | None,
        destination_profile: Mapping | None,
        path_progress: float,
        artist_similarity_graph: Mapping[str, Mapping[str, float]],
        shared_members_graph: Mapping[str, set[str]],
    ) -> float:
        if not destination_track:
            return 0.0
        signals = self._destination_signals(
            row,
            destination_track,
            destination_profile,
            artist_similarity_graph,
            shared_members_graph,
        )
        progress_weight = 0.35 + (0.65 * (_bounded_float(path_progress) ** 1.25))
        return progress_weight * signals.gravity

    def should_skip_lateral_destination_candidate(
        self,
        row: dict,
        *,
        destination_track: dict | None,
        destination_profile: Mapping | None,
        path_progress: float,
        artist_similarity_graph: Mapping[str, Mapping[str, float]],
        shared_members_graph: Mapping[str, set[str]],
    ) -> bool:
        if not destination_track or path_progress < 0.30:
            return False
        signals = self._destination_signals(
            row,
            destination_track,
            destination_profile,
            artist_similarity_graph,
            shared_members_graph,
        )
        return (
            signals.local_penalty >= 1.0
            and signals.connection < 0.3
            and signals.genre_overlap <= 0.30
        )

    def signals(self, row: dict) -> _SceneTrackSignals:
        key = id(row)
        if key not in self._signals:
            vector = _coerce_vector(row.get("bliss_vector"))
            self._signals[key] = _SceneTrackSignals(
                row=row,
                membership=_membership_score(row),
                artist_popularity=_artist_popularity(row),
                track_popularity=_track_popularity(row),
                affinity=_user_affinity(row),
                catalog_depth=_catalog_depth_score(row),
                relation=_relation_score(row),
                curation=_curation_quality(row),
                audio_completeness=_audio_completeness(row),
                energy=_coerce_float(row.get("energy")),
                bpm=_coerce_float(row.get("bpm")),
                key=str(row.get("audio_key") or "").strip().casefold(),
                scale=str(row.get("audio_scale") or "").strip().casefold(),
                vector=vector,
                vector_norm=math.sqrt(sum(value * value for value in vector)),
            )
        return self._signals[key]

    def track_score(self, row: dict, previous_track: dict | None = None) -> float:
        self._prepare_context(previous_track)
        key = id(row)
        if key not in self._track_scores:
            signals = self.signals(row)
            self._track_scores[key] = (
                0.35 * signals.track_popularity
                + 0.30 * signals.affinity
                + 0.15 * signals.membership
                + 0.10 * signals.curation
                + 0.10 * signals.audio_completeness
                + 0.12 * self.audio_transition_score(row, previous_track)
            )
        return self._track_scores[key]

    def artist_score(self, row: dict) -> float:
        signals = self.signals(row)
        return (
            0.42 * signals.membership
            + 0.33 * signals.artist_popularity
            + 0.12 * signals.catalog_depth
            + 0.08 * signals.relation
            + 0.05 * signals.affinity
        )

    def user_affinity(self, row: dict) -> float:
        return self.signals(row).affinity

    def track_popularity(self, row: dict) -> float:
        return self.signals(row).track_popularity

    def audio_transition_score(self, row: dict, previous_track: dict | None) -> float:
        self._prepare_context(previous_track)
        if not previous_track:
            return 0.0
        key = id(row)
        if key in self._transitions:
            return self._transitions[key]
        current, previous = self.signals(row), self.signals(previous_track)
        scores: list[float] = []
        fit = (
            self._transition_fit.fit(previous_track, row)
            if self._transition_fit is not None
            else None
        )
        if fit is not None:
            scores.append(fit)
        for left, right, scale in (
            ()
            if fit is not None
            else (
                (current.energy, previous.energy, 1.0),
                (current.bpm, previous.bpm, 60.0),
            )
        ):
            if left is not None and right is not None:
                scores.append(max(0.0, min(1.0, 1.0 - (abs(left - right) / scale))))
        if fit is None and current.key and previous.key:
            if current.key == previous.key and current.scale == previous.scale:
                scores.append(1.0)
            elif current.key == previous.key:
                scores.append(0.82)
            elif current.scale and current.scale == previous.scale:
                scores.append(0.62)
            else:
                scores.append(0.45)
        if (
            current.vector
            and previous.vector
            and len(current.vector) == len(previous.vector)
            and not (current.vector_norm <= 0 or previous.vector_norm <= 0)
        ):
            dot = sum(
                left * right for left, right in zip(current.vector, previous.vector)
            )
            cosine = dot / (current.vector_norm * previous.vector_norm)
            scores.append(max(0.0, min(1.0, (cosine + 1.0) / 2.0)))
        self._transitions[key] = sum(scores) / len(scores) if scores else 0.0
        return self._transitions[key]


def _canonical_slug(value: str) -> str:
    return resolve_genre_slug(value) or slugify_genre(value)


def _genre_depths(
    catalog: Mapping[str, Mapping], children: Mapping[str, set[str]]
) -> dict[str, int]:
    depths = {
        slug: 0
        for slug, meta in catalog.items()
        if not any(parent in catalog for parent in meta.get("parents", []) or [])
    }
    pending = deque(depths)
    while pending:
        parent = pending.popleft()
        for child in children.get(parent, set()):
            if child not in depths:
                depths[child] = depths[parent] + 1
                pending.append(child)
    return depths


def _specificity_jump(left: str, right: str, depths: Mapping[str, int]) -> int:
    return max(0, abs(depths.get(left, 0) - depths.get(right, 0)) - 1)


def _genre_neighbors(
    slug: str,
    catalog: Mapping[str, Mapping],
    influenced_genres: Mapping[str, set[str]],
    children: Mapping[str, set[str]],
    depths: Mapping[str, int],
) -> list[tuple[str, float]]:
    meta = catalog.get(slug) or {}
    neighbors: dict[str, float] = {}

    def add(candidate: str, cost: float) -> None:
        if not candidate or candidate == slug or candidate not in catalog:
            return
        neighbors[candidate] = min(neighbors.get(candidate, cost), cost)

    for parent in meta.get("parents", []) or []:
        add(parent, 1.0)
    for child in children.get(slug, set()):
        add(child, 1.0)
    for influence in meta.get("influenced_by", []) or []:
        add(influence, 1.0 + _specificity_jump(slug, influence, depths))
    for influenced in influenced_genres.get(slug, set()):
        add(influenced, 1.0 + _specificity_jump(slug, influenced, depths))
    for fusion in meta.get("fusion_of", []) or []:
        add(fusion, 1.6 + _specificity_jump(slug, fusion, depths))
    for related in meta.get("related", []) or []:
        add(related, 2.5 + _specificity_jump(slug, related, depths))

    return sorted(neighbors.items(), key=lambda item: (item[1], item[0]))


def build_scene_genre_route(origin_slug: str, dest_slug: str) -> list[str]:
    """Find a directed scene route between two canonical genre slugs."""
    origin = _canonical_slug(origin_slug)
    destination = _canonical_slug(dest_slug)
    if not origin or not destination:
        return []
    if origin == destination:
        return [origin]

    catalog = get_genre_catalog()
    if origin not in catalog or destination not in catalog:
        return [origin, destination]

    children: dict[str, set[str]] = defaultdict(set)
    influenced_genres: dict[str, set[str]] = defaultdict(set)
    for slug, meta in catalog.items():
        for parent in meta.get("parents", []) or []:
            children[parent].add(slug)
        for influence in meta.get("influenced_by", []) or []:
            influenced_genres[influence].add(slug)

    depths = _genre_depths(catalog, children)
    queue: list[tuple[float, str]] = [(0.0, origin)]
    distances: dict[str, float] = {origin: 0.0}
    previous: dict[str, str] = {}

    while queue:
        distance, slug = heapq.heappop(queue)
        if slug == destination:
            break
        if distance > distances.get(slug, float("inf")):
            continue

        for neighbor, edge_cost in _genre_neighbors(
            slug, catalog, influenced_genres, children, depths
        ):
            candidate_distance = distance + edge_cost
            if candidate_distance >= distances.get(neighbor, float("inf")):
                continue
            distances[neighbor] = candidate_distance
            previous[neighbor] = slug
            heapq.heappush(queue, (candidate_distance, neighbor))

    if destination not in distances:
        return [origin, destination]

    route = [destination]
    current = destination
    while current != origin:
        current = previous[current]
        route.append(current)
    route.reverse()
    return _insert_direct_scene_bridge(
        route,
        catalog,
        influenced_genres=influenced_genres,
        children=children,
        depths=depths,
    )


def _insert_direct_scene_bridge(
    route: list[str],
    catalog: Mapping[str, Mapping],
    *,
    influenced_genres: Mapping[str, set[str]],
    children: Mapping[str, set[str]],
    depths: Mapping[str, int],
) -> list[str]:
    if len(route) != 2:
        return route

    origin, destination = route
    origin_links = _bridge_links(origin, catalog, influenced_genres, children)
    dest_links = _bridge_links(destination, catalog, influenced_genres, children)
    candidates = [
        slug
        for slug in sorted(origin_links & dest_links)
        if slug in catalog and slug not in {origin, destination}
    ]
    if not candidates:
        return route

    bridge = max(
        candidates,
        key=lambda slug: (
            -_specificity_jump(origin, slug, depths)
            - _specificity_jump(slug, destination, depths),
            *_bridge_score(slug, origin, destination, catalog),
        ),
    )
    return [origin, bridge, destination]


def _bridge_links(
    slug: str,
    catalog: Mapping[str, Mapping],
    influenced_genres: Mapping[str, set[str]],
    children: Mapping[str, set[str]],
) -> set[str]:
    meta = catalog.get(slug) or {}
    return {
        *(meta.get("parents", []) or []),
        *(meta.get("related", []) or []),
        *(meta.get("influenced_by", []) or []),
        *(meta.get("fusion_of", []) or []),
        *children.get(slug, set()),
        *influenced_genres.get(slug, set()),
    }


def _bridge_score(
    slug: str,
    origin: str,
    destination: str,
    catalog: Mapping[str, Mapping],
) -> tuple[int, str]:
    meta = catalog.get(slug) or {}
    origin_meta = catalog.get(origin) or {}
    destination_meta = catalog.get(destination) or {}
    score = 0
    if origin in (meta.get("parents", []) or []):
        score += 4
    if destination in (meta.get("parents", []) or []):
        score += 4
    if origin in (meta.get("influenced_by", []) or []):
        score += 3
    if destination in (meta.get("influenced_by", []) or []):
        score += 3
    if origin in (meta.get("related", []) or []):
        score += 2
    if destination in (meta.get("related", []) or []):
        score += 2
    if slug in (origin_meta.get("influenced_by", []) or []):
        score += 6
    if slug in (destination_meta.get("influenced_by", []) or []):
        score += 6
    if slug in (origin_meta.get("related", []) or []):
        score += 3
    if slug in (destination_meta.get("related", []) or []):
        score += 3
    score += 2 * _slug_token_overlap(slug, origin, destination)
    return score, slug


def _slug_token_overlap(slug: str, origin: str, destination: str) -> int:
    slug_tokens = set(slug.split("-"))
    endpoint_tokens = set(origin.split("-")) | set(destination.split("-"))
    return len(slug_tokens & endpoint_tokens)


def build_scene_path_from_candidates(
    route: list[str],
    candidates_by_genre: Mapping[str, list[dict]],
    *,
    step_count: int,
    artist_similarity_graph: Mapping[str, Mapping[str, float]] | None = None,
    shared_members_graph: Mapping[str, set[str]] | None = None,
    max_repeat_per_artist: int = _MAX_REPEAT_PER_ARTIST,
    selection_seed: str | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
) -> list[dict]:
    """Build a culturally coherent path from genre-scoped track candidates."""
    if not route:
        return []

    slot_genres = _expand_route_slots(route, step_count)
    used_ids: set[int] = set()
    used_song_keys: set[tuple[str, str]] = set()
    used_artists: dict[str, int] = {}
    used_albums: dict[str, int] = {}
    path: list[dict] = []
    scorer = _SceneScorer()
    similarity_graph = artist_similarity_graph or {}
    member_graph = shared_members_graph or {}

    for index, genre_slug in enumerate(slot_genres):
        previous_track = path[-1] if path else None
        track = _select_track_for_genre(
            genre_slug,
            candidates_by_genre.get(genre_slug, []),
            used_ids=used_ids,
            used_song_keys=used_song_keys,
            used_artists=used_artists,
            used_albums=used_albums,
            is_anchor=index == 0 or index == len(slot_genres) - 1,
            previous_track=previous_track,
            artist_similarity_graph=similarity_graph,
            shared_members_graph=member_graph,
            max_repeat_per_artist=max_repeat_per_artist,
            selection_seed=_slot_seed(selection_seed, index, genre_slug),
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            scorer=scorer,
        )
        if track is None:
            track = _select_track_for_genre(
                genre_slug,
                candidates_by_genre.get(genre_slug, []),
                used_ids=used_ids,
                used_song_keys=used_song_keys,
                used_artists=used_artists,
                used_albums=None,
                is_anchor=index == 0 or index == len(slot_genres) - 1,
                previous_track=previous_track,
                artist_similarity_graph=similarity_graph,
                shared_members_graph=member_graph,
                max_repeat_per_artist=max_repeat_per_artist,
                selection_seed=_slot_seed(selection_seed, index, genre_slug),
                recent_song_keys=recent_song_keys,
                previous_song_keys=previous_song_keys,
                previous_track_ids=previous_track_ids,
                scorer=scorer,
            )
        if track is None:
            continue
        _mark_used(track, used_ids, used_artists, used_song_keys, used_albums)
        path.append(track)

    return path


def build_artist_scene_path_from_candidates(
    route: list[str],
    endpoint_candidates: Mapping[str, list[dict]],
    candidates_by_genre: Mapping[str, list[dict]],
    *,
    step_count: int,
    artist_similarity_graph: Mapping[str, Mapping[str, float]] | None = None,
    shared_members_graph: Mapping[str, set[str]] | None = None,
    destination_profile: Mapping | None = None,
    selection_seed: str | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
) -> list[dict]:
    """Build an artist-to-artist scene path with fixed endpoint anchors."""
    if len(route) < 2:
        return []

    scorer = _SceneScorer()
    similarity_graph = artist_similarity_graph or {}
    member_graph = shared_members_graph or {}
    used_ids: set[int] = set()
    used_song_keys: set[tuple[str, str]] = set()
    used_artists: dict[str, int] = {}
    used_albums: dict[str, int] = {}

    origin_track = _select_track_for_genre(
        route[0],
        list(endpoint_candidates.get("origin", [])),
        used_ids=used_ids,
        used_song_keys=used_song_keys,
        used_artists=used_artists,
        used_albums=used_albums,
        is_anchor=True,
        max_repeat_per_artist=_ARTIST_PATH_REPEAT_PER_ARTIST,
        selection_seed=_slot_seed(selection_seed, 0, route[0]),
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        scorer=scorer,
    )
    if origin_track is None:
        return []
    _mark_used(origin_track, used_ids, used_artists, used_song_keys, used_albums)

    destination_track = _select_track_for_genre(
        route[-1],
        list(endpoint_candidates.get("destination", [])),
        used_ids=used_ids,
        used_song_keys=used_song_keys,
        used_artists=used_artists,
        used_albums=used_albums,
        is_anchor=True,
        previous_track=origin_track,
        artist_similarity_graph=similarity_graph,
        shared_members_graph=member_graph,
        max_repeat_per_artist=_ARTIST_PATH_REPEAT_PER_ARTIST,
        selection_seed=_slot_seed(selection_seed, len(route) - 1, route[-1]),
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        scorer=scorer,
    )
    if destination_track is None:
        return []
    _mark_used(destination_track, used_ids, used_artists, used_song_keys, used_albums)

    middle_tracks: list[dict] = []
    previous_track = origin_track
    endpoint_artist_keys = {_artist_key(origin_track), _artist_key(destination_track)}
    selection_route = _route_with_selectable_genres(route, candidates_by_genre)
    middle_slots = _expand_route_slots(selection_route, step_count)[1:-1]
    for slot_index, genre_slug in enumerate(middle_slots):
        path_progress = (slot_index + 1) / max(1, len(middle_slots) + 1)
        track = _select_track_for_genre(
            genre_slug,
            candidates_by_genre.get(genre_slug, []),
            used_ids=used_ids,
            used_song_keys=used_song_keys,
            used_artists=used_artists,
            used_albums=used_albums,
            is_anchor=False,
            previous_track=previous_track,
            artist_similarity_graph=similarity_graph,
            shared_members_graph=member_graph,
            max_repeat_per_artist=_ARTIST_PATH_REPEAT_PER_ARTIST,
            excluded_artist_keys=endpoint_artist_keys,
            destination_track=destination_track,
            destination_profile=destination_profile,
            path_progress=path_progress,
            selection_seed=_slot_seed(selection_seed, slot_index + 1, genre_slug),
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            scorer=scorer,
        )
        if track is None and len(middle_tracks) + 2 < step_count:
            track = _select_track_for_genre(
                genre_slug,
                candidates_by_genre.get(genre_slug, []),
                used_ids=used_ids,
                used_song_keys=used_song_keys,
                used_artists=used_artists,
                used_albums=used_albums,
                is_anchor=False,
                previous_track=previous_track,
                artist_similarity_graph=similarity_graph,
                shared_members_graph=member_graph,
                max_repeat_per_artist=_MAX_REPEAT_PER_ARTIST,
                excluded_artist_keys=endpoint_artist_keys,
                destination_track=destination_track,
                destination_profile=destination_profile,
                path_progress=path_progress,
                selection_seed=_slot_seed(selection_seed, slot_index + 1, genre_slug),
                recent_song_keys=recent_song_keys,
                previous_song_keys=previous_song_keys,
                previous_track_ids=previous_track_ids,
                scorer=scorer,
            )
        for fallback_genre in (
            genre_slug,
            _previous_route_genre(selection_route, genre_slug),
        ):
            if track is not None or not fallback_genre:
                break
            if len(middle_tracks) + 2 >= step_count:
                break
            track = _select_track_for_genre(
                fallback_genre,
                candidates_by_genre.get(fallback_genre, []),
                used_ids=used_ids,
                used_song_keys=used_song_keys,
                used_artists=used_artists,
                used_albums=None,
                is_anchor=False,
                previous_track=previous_track,
                artist_similarity_graph=similarity_graph,
                shared_members_graph=member_graph,
                max_repeat_per_artist=_MAX_REPEAT_PER_ARTIST,
                excluded_artist_keys=endpoint_artist_keys,
                destination_track=destination_track,
                destination_profile=destination_profile,
                path_progress=path_progress,
                selection_seed=_slot_seed(
                    selection_seed, slot_index + 1, fallback_genre
                ),
                recent_song_keys=recent_song_keys,
                previous_song_keys=previous_song_keys,
                previous_track_ids=previous_track_ids,
                scorer=scorer,
            )
        if track is None:
            continue
        _mark_used(track, used_ids, used_artists, used_song_keys, used_albums)
        middle_tracks.append(track)
        previous_track = track

    return [origin_track, *middle_tracks, destination_track]


def _route_with_selectable_genres(
    route: list[str],
    candidates_by_genre: Mapping[str, list[dict]],
) -> list[str]:
    if len(route) <= 2:
        return route

    selectable = [
        slug
        for index, slug in enumerate(route)
        if index == 0
        or index == len(route) - 1
        or _has_selectable_candidates(candidates_by_genre.get(slug, []))
    ]
    if len(selectable) < 2:
        return [route[0], route[-1]]
    return selectable


def _has_selectable_candidates(rows: list[dict]) -> bool:
    return any(
        not _is_blocked_variant(row) and _membership_score(row) >= _MIN_MEMBERSHIP_SCORE
        for row in rows
    )


def compute_scene_path(
    *,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    step_count: int = 20,
    user_id: int | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
) -> list[dict] | None:
    """Compatibility entry point for the service orchestration."""
    from crate.music_paths import compute_scene_path as implementation

    return implementation(
        origin_type=origin_type,
        origin_value=origin_value,
        dest_type=dest_type,
        dest_value=dest_value,
        step_count=step_count,
        user_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        selection_seed=selection_seed,
    )


def prepare_scene_path(
    *,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    step_count: int = 20,
    user_id: int | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
) -> dict | None:
    """Load and compute deterministic scene candidates without invoking AI."""
    if origin_type == "artist" and dest_type == "artist":
        return _prepare_artist_scene_path(
            origin_value=origin_value,
            dest_value=dest_value,
            step_count=step_count,
            user_id=user_id,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            selection_seed=selection_seed,
        )

    if origin_type != "genre" or dest_type != "genre":
        return None

    route = build_scene_genre_route(origin_value, dest_value)
    if len(route) < 2:
        return None
    selection_route = _expand_genre_scene_route(route, step_count=step_count)

    from crate.db.queries.paths_scene_queries import list_scene_path_candidates

    candidates = list_scene_path_candidates(
        selection_route,
        user_id=user_id,
        limit_per_genre=max(80, step_count * 8),
    )
    artist_similarity_graph, _artist_genres, shared_members_graph = (
        load_artist_radio_graphs()
    )
    tracks = build_scene_path_from_candidates(
        selection_route,
        candidates,
        step_count=step_count,
        artist_similarity_graph=artist_similarity_graph,
        shared_members_graph=shared_members_graph,
        selection_seed=selection_seed
        if selection_seed is not None
        else uuid.uuid4().hex,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    if len(tracks) < 2:
        return None
    return dict(
        origin_label=origin_value,
        dest_label=dest_value,
        origin_type=origin_type,
        dest_type=dest_type,
        tracks=tracks,
        candidates_by_genre=candidates,
        validation_context={
            "artist_similarity_graph": artist_similarity_graph,
            "shared_members_graph": shared_members_graph,
            "origin_genre_slug": route[0],
            "destination_genre_slug": route[-1],
            "max_repeat_per_artist": _MAX_REPEAT_PER_ARTIST,
        },
    )


def _prepare_artist_scene_path(
    *,
    origin_value: str,
    dest_value: str,
    step_count: int,
    user_id: int | None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
) -> dict | None:
    from crate.db.queries.paths_scene_queries import (
        get_artist_scene_profile,
        list_artist_scene_anchor_candidates,
        list_scene_path_candidates,
    )

    origin_profile = get_artist_scene_profile(origin_value)
    dest_profile = get_artist_scene_profile(dest_value)
    if not origin_profile or not dest_profile:
        return None

    route = _select_artist_scene_route(origin_profile, dest_profile)
    if len(route) < 2:
        return None
    selection_route = _expand_artist_scene_route(
        route,
        origin_profile=origin_profile,
        dest_profile=dest_profile,
        step_count=step_count,
    )

    origin_candidates = list_artist_scene_anchor_candidates(
        origin_value,
        user_id=user_id,
        limit=24,
    )
    dest_candidates = list_artist_scene_anchor_candidates(
        dest_value,
        user_id=user_id,
        limit=24,
    )
    if not origin_candidates or not dest_candidates:
        return None

    candidates = list_scene_path_candidates(
        selection_route,
        user_id=user_id,
        limit_per_genre=max(120, step_count * 10),
    )
    artist_similarity_graph, _artist_genres, shared_members_graph = (
        load_artist_radio_graphs()
    )
    tracks = build_artist_scene_path_from_candidates(
        selection_route,
        {"origin": origin_candidates, "destination": dest_candidates},
        candidates,
        step_count=step_count,
        artist_similarity_graph=artist_similarity_graph,
        shared_members_graph=shared_members_graph,
        destination_profile=dest_profile,
        selection_seed=selection_seed
        if selection_seed is not None
        else uuid.uuid4().hex,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    if len(tracks) < 2:
        return None
    return dict(
        origin_label=str(origin_profile.get("name") or origin_value),
        dest_label=str(dest_profile.get("name") or dest_value),
        origin_type="artist",
        dest_type="artist",
        tracks=tracks,
        candidates_by_genre=candidates,
        validation_context={
            "artist_similarity_graph": artist_similarity_graph,
            "shared_members_graph": shared_members_graph,
            "max_repeat_per_artist": _MAX_REPEAT_PER_ARTIST,
        },
    )


def _select_artist_scene_route(
    origin_profile: Mapping, dest_profile: Mapping
) -> list[str]:
    origin_genres = _profile_genres(origin_profile)
    dest_genres = _profile_genres(dest_profile)
    best: tuple[float, list[str]] | None = None

    for origin_index, origin_genre in enumerate(origin_genres):
        for dest_index, dest_genre in enumerate(dest_genres):
            route = build_scene_genre_route(origin_genre["slug"], dest_genre["slug"])
            if len(route) < 2:
                continue
            score = _artist_route_score(
                route,
                origin_weight=origin_genre["weight"],
                dest_weight=dest_genre["weight"],
                origin_index=origin_index,
                dest_index=dest_index,
            )
            if best is None or score > best[0]:
                best = (score, route)

    return best[1] if best else []


def _profile_genres(profile: Mapping) -> list[ArtistProfileGenre]:
    genres: list[ArtistProfileGenre] = []
    for item in list(profile.get("genres") or [])[:_ARTIST_PROFILE_GENRE_LIMIT]:
        slug = _canonical_slug(str(item.get("slug") or item.get("name") or ""))
        if not slug:
            continue
        genres.append(
            {
                "slug": slug,
                "weight": _bounded_float(item.get("weight")),
            }
        )
    return genres


def _expand_artist_scene_route(
    route: list[str],
    *,
    origin_profile: Mapping,
    dest_profile: Mapping,
    step_count: int,
) -> list[str]:
    expanded = _dedupe_route(route)
    if step_count < _LONG_ARTIST_ROUTE_STEP_COUNT or len(expanded) >= 5:
        return expanded

    target_len = min(8, max(len(expanded) + 2, step_count // 10))
    for item in _profile_specific_genres(origin_profile):
        if len(expanded) >= target_len:
            return expanded
        expanded = _insert_origin_scene(expanded, item)

    for item in _profile_specific_genres(dest_profile):
        if len(expanded) >= target_len:
            return expanded
        expanded = _insert_destination_scene(expanded, item)

    return expanded


def _expand_genre_scene_route(route: list[str], *, step_count: int) -> list[str]:
    base_route = _dedupe_route(route)
    if step_count < _LONG_ARTIST_ROUTE_STEP_COUNT or len(base_route) < 3:
        return base_route

    destination = base_route[-1]
    adjacent = _destination_adjacent_genres(destination, previous_slug=base_route[-2])
    adjacent = [slug for slug in adjacent if slug not in set(base_route)]
    if not adjacent:
        return base_route

    extra_count = min(3, max(1, step_count // 16))
    extras = adjacent[:extra_count]
    return [*base_route, *extras, destination]


def _destination_adjacent_genres(destination: str, *, previous_slug: str) -> list[str]:
    catalog = get_genre_catalog()
    if destination not in catalog:
        return []

    children: dict[str, set[str]] = defaultdict(set)
    influenced_genres: dict[str, set[str]] = defaultdict(set)
    for slug, meta in catalog.items():
        for parent in meta.get("parents", []) or []:
            children[parent].add(slug)
        for influence in meta.get("influenced_by", []) or []:
            influenced_genres[influence].add(slug)

    destination_meta = catalog.get(destination) or {}
    related_order = {
        slug: index
        for index, slug in enumerate(destination_meta.get("related", []) or [])
    }
    candidates = {
        *(destination_meta.get("related", []) or []),
        *children.get(destination, set()),
        *influenced_genres.get(destination, set()),
    }
    if not candidates:
        return []

    depths = _genre_depths(catalog, children)
    return sorted(
        [
            slug
            for slug in candidates
            if slug in catalog
            and slug != destination
            and not _specificity_jump(destination, slug, depths)
        ],
        key=lambda slug: (
            -_destination_adjacent_score(slug, destination, previous_slug, catalog),
            related_order.get(slug, 999),
            slug,
        ),
    )


def _destination_adjacent_score(
    slug: str,
    destination: str,
    previous_slug: str,
    catalog: Mapping[str, Mapping],
) -> float:
    meta = catalog.get(slug) or {}
    destination_meta = catalog.get(destination) or {}
    previous_meta = catalog.get(previous_slug) or {}
    score = 0.0
    if slug in (destination_meta.get("related", []) or []):
        score += 5.0
    if destination in (meta.get("related", []) or []):
        score += 3.0
    if previous_slug in (meta.get("related", []) or []):
        score += 2.0
    if slug in (previous_meta.get("related", []) or []):
        score += 2.0
    if set(meta.get("parents", []) or []) & set(
        destination_meta.get("parents", []) or []
    ):
        score += 4.0
    if previous_slug in (meta.get("parents", []) or []):
        score += 1.0
    return score


def _profile_specific_genres(profile: Mapping) -> list[dict[str, str]]:
    artist_slug = _plain_slug(profile.get("name"))
    genres: list[dict[str, str]] = []
    for item in list(profile.get("genres") or [])[:_ARTIST_PROFILE_GENRE_LIMIT]:
        canonical = _canonical_slug(str(item.get("slug") or ""))
        raw = _plain_slug(item.get("raw_slug") or item.get("slug") or item.get("name"))
        if not raw or raw == artist_slug:
            continue
        if raw == canonical:
            continue
        genres.append({"slug": canonical, "raw_slug": raw})
    return genres


def _insert_origin_scene(route: list[str], item: Mapping[str, str]) -> list[str]:
    raw = item.get("raw_slug") or ""
    if not raw or raw in route:
        return route
    canonical = item.get("slug") or ""
    insert_at = 1
    if canonical in route:
        insert_at = min(route.index(canonical) + 1, len(route) - 1)
    return _dedupe_route([*route[:insert_at], raw, *route[insert_at:]])


def _insert_destination_scene(route: list[str], item: Mapping[str, str]) -> list[str]:
    raw = item.get("raw_slug") or ""
    if not raw or raw in route:
        return route
    canonical = item.get("slug") or ""
    insert_at = len(route) - 1
    if canonical in route:
        insert_at = route.index(canonical)
    return _dedupe_route([*route[:insert_at], raw, *route[insert_at:]])


def _dedupe_route(route: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for slug in route:
        normalized = _plain_slug(slug)
        if not normalized or normalized in seen:
            continue
        deduped.append(normalized)
        seen.add(normalized)
    return deduped


def _artist_route_score(
    route: list[str],
    *,
    origin_weight: float,
    dest_weight: float,
    origin_index: int,
    dest_index: int,
) -> float:
    route_depth_bonus = 1.5 if len(route) > 2 else 0.0
    route_length_penalty = max(0, len(route) - 2) * 0.18
    profile_rank_penalty = (origin_index + dest_index) * 0.05
    endpoint_weight = (origin_weight * 0.55) + (dest_weight * 0.45)
    return (
        endpoint_weight * 2.0
        + route_depth_bonus
        - route_length_penalty
        - profile_rank_penalty
    )


def _expand_route_slots(route: list[str], step_count: int) -> list[str]:
    if not route:
        return []
    target_count = max(1, step_count)
    if target_count <= 1:
        return route[:1]
    if len(route) == 1:
        return [route[0]] * target_count
    slots: list[str] = []
    for index in range(target_count):
        route_index = round(index * (len(route) - 1) / (target_count - 1))
        slots.append(route[route_index])
    return slots


def _make_path_entry(track: dict, index: int, total: int, requested_steps: int) -> dict:
    progress = index / max(1, total - 1)
    step = round(progress * max(1, requested_steps - 1))
    entity_uid = str(track["entity_uid"]) if track.get("entity_uid") else None
    return {
        "step": step,
        "progress": round(progress, 4),
        "track_id": track["id"],
        "entity_uid": entity_uid,
        "title": track["title"],
        "artist": track["artist"],
        "album_artist": track.get("album_artist"),
        "principal_artist": track.get("principal_artist"),
        "artist_entity_uid": track.get("artist_entity_uid"),
        "album": track.get("album"),
        "album_id": track.get("album_id"),
        "album_entity_uid": track.get("album_entity_uid"),
        "format": track.get("format"),
        "bitrate": track.get("bitrate"),
        "sample_rate": track.get("sample_rate"),
        "bit_depth": track.get("bit_depth"),
        "duration": track.get("duration"),
        "path": track.get("path"),
        "bpm": track.get("bpm"),
        "audio_key": track.get("audio_key"),
        "audio_scale": track.get("audio_scale"),
        "energy": track.get("energy"),
        "danceability": track.get("danceability"),
        "valence": track.get("valence"),
        "bliss_vector": (
            list(track["bliss_vector"]) if track.get("bliss_vector") else None
        ),
        "distance": round(float(track.get("distance") or 0.0), 6),
        "path_genre": track.get("genre_slug"),
    }


def _select_track_for_genre(
    genre_slug: str,
    rows: list[dict],
    *,
    used_ids: set[int],
    used_song_keys: set[tuple[str, str]] | None = None,
    used_artists: dict[str, int],
    used_albums: dict[str, int] | None = None,
    is_anchor: bool,
    previous_track: dict | None = None,
    artist_similarity_graph: Mapping[str, Mapping[str, float]] | None = None,
    shared_members_graph: Mapping[str, set[str]] | None = None,
    max_repeat_per_artist: int = _MAX_REPEAT_PER_ARTIST,
    excluded_artist_keys: set[str] | None = None,
    destination_track: dict | None = None,
    destination_profile: Mapping | None = None,
    path_progress: float = 0.0,
    selection_seed: str | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    scorer: _SceneScorer | None = None,
) -> dict | None:
    scorer = scorer or _SceneScorer()
    similarity_graph = (
        artist_similarity_graph if artist_similarity_graph is not None else {}
    )
    member_graph = shared_members_graph if shared_members_graph is not None else {}
    artist_groups: dict[str, list[dict]] = defaultdict(list)
    excluded_keys = excluded_artist_keys or set()
    previous_artist_key = _artist_key(previous_track) if previous_track else ""
    for row in rows:
        if int(row.get("id") or 0) in used_ids:
            continue
        song_key = scorer.song_key(row)
        if (
            used_song_keys is not None
            and song_key is not None
            and song_key in used_song_keys
        ):
            continue
        if _is_blocked_variant(row):
            continue
        membership = _membership_score(row)
        membership_floor = (
            _ANCHOR_MEMBERSHIP_FLOOR if is_anchor else _MIN_MEMBERSHIP_SCORE
        )
        if membership < membership_floor:
            continue
        artist_key = _artist_key(row)
        if artist_key in excluded_keys:
            continue
        if artist_key and artist_key == previous_artist_key:
            continue
        if used_artists.get(artist_key, 0) >= max_repeat_per_artist:
            continue
        if used_albums is not None and _album_blocked(row, previous_track, used_albums):
            continue
        if scorer.should_skip_lateral_destination_candidate(
            row,
            destination_track=destination_track,
            destination_profile=destination_profile,
            path_progress=path_progress,
            artist_similarity_graph=similarity_graph,
            shared_members_graph=member_graph,
        ):
            continue
        artist_groups[artist_key].append(row)

    best: tuple[float, dict] | None = None
    ranked: list[tuple[dict, float, float]] = []
    for artist_key, artist_rows in artist_groups.items():
        track = _select_artist_track(
            artist_rows,
            previous_track=previous_track,
            selection_seed=selection_seed,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            scorer=scorer,
        )
        artist_score = scorer.artist_score(track)
        score = artist_score
        repeat_count = used_artists.get(artist_key, 0)
        repeat_penalty = 0.0
        if repeat_count:
            repeat_penalty = 0.18 if artist_score >= 0.75 else 0.45
            score -= repeat_penalty
        score += scorer.track_score(track, previous_track) * 0.18
        score += 0.18 * scorer.artist_connection_score(
            track,
            previous_track,
            similarity_graph,
            member_graph,
        )
        score += 0.65 * scorer.destination_gravity_score(
            track,
            destination_track=destination_track,
            destination_profile=destination_profile,
            path_progress=path_progress,
            artist_similarity_graph=similarity_graph,
            shared_members_graph=member_graph,
        )
        affinity = scorer.user_affinity(track)
        quality = score - (0.05 + 0.18 * 0.30) * affinity
        if repeat_count:
            musical_artist_score = artist_score - 0.05 * affinity
            quality += repeat_penalty - (0.18 if musical_artist_score >= 0.75 else 0.45)
        ranked.append((track, score, quality))
        if best is None or score > best[0]:
            best = (score, track)

    if best is None:
        return None
    pool = fresh_path_candidates(
        [(row, quality) for row, _score, quality in ranked],
        preferred=best[1],
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    scores = {row["id"]: score for row, score, _quality in ranked}
    return dict(max(pool, key=lambda row: scores[row["id"]]))


def _select_artist_track(
    rows: list[dict],
    *,
    previous_track: dict | None,
    selection_seed: str | None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    scorer: _SceneScorer | None = None,
) -> dict:
    scorer = scorer or _SceneScorer()
    ranked = sorted(
        rows,
        key=lambda row: scorer.track_score(row, previous_track),
        reverse=True,
    )
    strongest_user_track = max(ranked, key=scorer.user_affinity)
    strong_affinity = (
        scorer.user_affinity(strongest_user_track) >= _STRONG_USER_AFFINITY_THRESHOLD
    )
    fatigued = (recent_song_keys or set()) | (previous_song_keys or set())
    if (
        strong_affinity
        and scorer.song_key(strongest_user_track) not in fatigued
        and strongest_user_track["id"] not in (previous_track_ids or set())
    ):
        return strongest_user_track
    preferred = strongest_user_track if strong_affinity else ranked[0]
    pool = fresh_path_candidates(
        [
            (
                row,
                scorer.track_score(row, previous_track)
                - 0.30 * scorer.user_affinity(row),
            )
            for row in ranked
        ],
        preferred=preferred,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    ranked = sorted(
        pool, key=lambda row: scorer.track_score(row, previous_track), reverse=True
    )
    if not selection_seed:
        return ranked[0]

    top_score = scorer.track_score(ranked[0], previous_track)
    score_floor = max(
        top_score * _TRACK_VARIETY_SCORE_FLOOR_RATIO,
        top_score - _TRACK_VARIETY_SCORE_FLOOR_DROP,
    )
    pool = [
        row
        for row in ranked[:_TRACK_VARIETY_POOL_SIZE]
        if scorer.track_score(row, previous_track) >= score_floor
    ]
    if not pool:
        pool = ranked[:1]

    fresh = [
        row
        for row in pool
        if scorer.song_key(row) not in fatigued
        and row["id"] not in (previous_track_ids or set())
    ]
    pool = fresh or pool

    return max(
        pool,
        key=lambda row: _seeded_track_choice_score(
            row,
            previous_track=previous_track,
            selection_seed=selection_seed,
            scorer=scorer,
        ),
    )


def _seeded_track_choice_score(
    row: dict,
    *,
    previous_track: dict | None,
    selection_seed: str,
    scorer: _SceneScorer | None = None,
) -> float:
    scorer = scorer or _SceneScorer()
    return (
        0.72 * scorer.track_score(row, previous_track)
        + 0.12 * scorer.track_popularity(row)
        + 0.08 * scorer.audio_transition_score(row, previous_track)
        + 0.16 * _stable_track_jitter(row, selection_seed)
    )


def _slot_seed(
    selection_seed: str | None, slot_index: int, genre_slug: str
) -> str | None:
    if not selection_seed:
        return None
    return f"{selection_seed}:{slot_index}:{genre_slug}"


def _stable_track_jitter(row: dict, selection_seed: str) -> float:
    payload = "|".join(
        [
            selection_seed,
            str(row.get("id") or ""),
            str(row.get("artist") or ""),
            str(row.get("title") or ""),
        ]
    )
    digest = hashlib.sha256(payload.encode()).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64 - 1)


def _mark_used(
    track: dict,
    used_ids: set[int],
    used_artists: dict[str, int],
    used_song_keys: set[tuple[str, str]] | None = None,
    used_albums: dict[str, int] | None = None,
) -> None:
    used_ids.add(int(track["id"]))
    song_key = track_song_identity(track)
    if used_song_keys is not None and song_key is not None:
        used_song_keys.add(song_key)
    artist_key = _artist_key(track)
    used_artists[artist_key] = used_artists.get(artist_key, 0) + 1
    album_key = _album_key(track)
    if album_key and used_albums is not None:
        used_albums[album_key] = used_albums.get(album_key, 0) + 1


def _previous_route_genre(route: list[str], genre_slug: str) -> str | None:
    index = route.index(genre_slug) if genre_slug in route else 0
    return route[index - 1] if index > 0 else None


def _album_blocked(
    row: dict, previous_track: dict | None, used_albums: dict[str, int]
) -> bool:
    album_key = _album_key(row)
    if not album_key:
        return False
    if previous_track and album_key == _album_key(previous_track):
        return True
    return used_albums.get(album_key, 0) >= _MAX_TRACKS_PER_ALBUM


def _album_key(row: dict) -> str:
    album_id = row.get("album_id")
    if album_id is not None:
        return f"id:{album_id}"
    album = str(row.get("album") or "").strip().casefold()
    return (
        f"name:{str(row.get('album_artist') or '').strip().casefold()}::{album}"
        if album
        else ""
    )


def _artist_score(row: dict) -> float:
    return (
        0.42 * _membership_score(row)
        + 0.33 * _artist_popularity(row)
        + 0.12 * _catalog_depth_score(row)
        + 0.08 * _relation_score(row)
        + 0.05 * _user_affinity(row)
    )


def _track_score(row: dict, previous_track: dict | None = None) -> float:
    return (
        0.35 * _track_popularity(row)
        + 0.30 * _user_affinity(row)
        + 0.15 * _membership_score(row)
        + 0.10 * _curation_quality(row)
        + 0.10 * _audio_completeness(row)
        + 0.12 * _audio_transition_score(row, previous_track)
    )


def _artist_key(row: dict) -> str:
    return path_artist_key(row)


def _membership_score(row: dict) -> float:
    return _bounded_float(row.get("membership_score") or row.get("weight"))


def _artist_popularity(row: dict) -> float:
    explicit = _bounded_float(row.get("artist_popularity_score"))
    if explicit > 0:
        return explicit
    spotify = _bounded_float(row.get("artist_spotify_popularity"), scale=100)
    listeners = _log_score(
        row.get("artist_listeners") or row.get("listeners"), 10_000_000
    )
    return max(spotify, listeners)


def _track_popularity(row: dict) -> float:
    explicit = _bounded_float(
        row.get("track_popularity_score") or row.get("popularity_score")
    )
    if explicit > 0:
        return explicit
    spotify = _bounded_float(row.get("spotify_track_popularity"), scale=100)
    popularity = _bounded_float(row.get("popularity"), scale=100)
    playcount = _log_score(row.get("lastfm_playcount"), 5_000_000)
    top_rank = _rank_score(row.get("lastfm_top_rank") or row.get("spotify_top_rank"))
    return max(spotify, popularity, playcount, top_rank)


def _user_affinity(row: dict) -> float:
    play_count = _log_score(row.get("user_play_count"), 20)
    liked_bonus = 0.25 if row.get("is_liked") else 0.0
    return min(1.0, play_count + liked_bonus)


def _catalog_depth_score(row: dict) -> float:
    albums = _log_score(row.get("artist_album_count") or row.get("album_count"), 20)
    tracks = _log_score(row.get("artist_track_count") or row.get("track_count"), 100)
    return max(albums, tracks)


def _relation_score(row: dict) -> float:
    return _bounded_float(row.get("artist_relation_score"))


def _artist_connection_score(
    row: dict,
    previous_track: dict | None,
    artist_similarity_graph: Mapping[str, Mapping[str, float]],
    shared_members_graph: Mapping[str, set[str]],
) -> float:
    if not previous_track:
        return 0.0

    candidate_key = _artist_key(row)
    previous_key = _artist_key(previous_track)
    if not candidate_key or not previous_key or candidate_key == previous_key:
        return 0.0

    if candidate_key in shared_members_graph.get(previous_key, set()):
        return 0.95

    direct = max(
        _bounded_float(
            artist_similarity_graph.get(previous_key, {}).get(candidate_key)
        ),
        _bounded_float(
            artist_similarity_graph.get(candidate_key, {}).get(previous_key)
        ),
    )
    if direct > 0:
        return direct

    previous_links = artist_similarity_graph.get(previous_key, {})
    candidate_links = artist_similarity_graph.get(candidate_key, {})
    shared = set(previous_links) & set(candidate_links)
    if not shared:
        return 0.0
    return (
        max(
            min(
                _bounded_float(previous_links[artist]),
                _bounded_float(candidate_links[artist]),
            )
            for artist in shared
        )
        * 0.5
    )


def _destination_gravity_score(
    row: dict,
    *,
    destination_track: dict | None,
    destination_profile: Mapping | None,
    path_progress: float,
    artist_similarity_graph: Mapping[str, Mapping[str, float]],
    shared_members_graph: Mapping[str, set[str]],
) -> float:
    if not destination_track:
        return 0.0

    progress_weight = 0.35 + (0.65 * (_bounded_float(path_progress) ** 1.25))
    connection = _artist_connection_score(
        row,
        destination_track,
        artist_similarity_graph,
        shared_members_graph,
    )
    genre_overlap = _destination_genre_overlap(
        row, destination_track, destination_profile
    )
    geography = _destination_geography_score(
        row, destination_track, destination_profile
    )
    era = _destination_era_score(row, destination_track, destination_profile)
    local_penalty = _local_scene_penalty(
        row,
        destination_track=destination_track,
        destination_profile=destination_profile,
        connection_score=connection,
        genre_overlap=genre_overlap,
    )
    return progress_weight * (
        (0.48 * connection)
        + (0.34 * genre_overlap)
        + (0.10 * geography)
        + (0.08 * era)
        - (0.38 * local_penalty)
    )


def _should_skip_lateral_destination_candidate(
    row: dict,
    *,
    destination_track: dict | None,
    destination_profile: Mapping | None,
    path_progress: float,
    artist_similarity_graph: Mapping[str, Mapping[str, float]],
    shared_members_graph: Mapping[str, set[str]],
) -> bool:
    if not destination_track or path_progress < 0.30:
        return False
    connection = _artist_connection_score(
        row,
        destination_track,
        artist_similarity_graph,
        shared_members_graph,
    )
    genre_overlap = _destination_genre_overlap(
        row, destination_track, destination_profile
    )
    penalty = _local_scene_penalty(
        row,
        destination_track=destination_track,
        destination_profile=destination_profile,
        connection_score=connection,
        genre_overlap=genre_overlap,
    )
    return penalty >= 1.0 and connection < 0.3 and genre_overlap <= 0.30


def _destination_genre_overlap(
    row: dict,
    destination_track: dict,
    destination_profile: Mapping | None,
    *,
    scorer: _SceneScorer | None = None,
) -> float:
    row_slugs = scorer.row_genre_slugs(row) if scorer else _row_genre_slugs(row)
    destination_slugs = (
        scorer.profile_genre_slugs(destination_profile)
        | scorer.row_genre_slugs(destination_track)
        if scorer
        else _profile_genre_slugs(destination_profile)
        | _row_genre_slugs(destination_track)
    )
    if not row_slugs or not destination_slugs:
        return 0.0
    exact_overlap = row_slugs & destination_slugs
    if not exact_overlap:
        return 0.0
    specific_overlap = exact_overlap - _BROAD_SCENE_SLUGS
    if specific_overlap:
        return min(
            1.0,
            0.45 + (len(specific_overlap) / max(1, len(destination_slugs))),
        )
    return min(0.28, len(exact_overlap) / max(1, len(destination_slugs)))


def _destination_geography_score(
    row: dict,
    destination_track: dict,
    destination_profile: Mapping | None,
) -> float:
    row_country = _country_code(row.get("artist_country") or row.get("country"))
    dest_country = _country_code(
        _mapping_value(destination_profile, "country")
        or destination_track.get("artist_country")
        or destination_track.get("country")
    )
    if row_country and dest_country and row_country == dest_country:
        return 1.0

    row_area = _plain_slug(row.get("artist_area") or row.get("area"))
    dest_area = _plain_slug(
        _mapping_value(destination_profile, "area")
        or destination_track.get("artist_area")
        or destination_track.get("area")
    )
    if row_area and dest_area and (row_area in dest_area or dest_area in row_area):
        return 0.75
    return 0.0


def _destination_era_score(
    row: dict,
    destination_track: dict,
    destination_profile: Mapping | None,
) -> float:
    row_year = _formed_year(
        row.get("artist_formed") or row.get("formed") or row.get("year")
    )
    dest_year = _formed_year(
        _mapping_value(destination_profile, "formed")
        or destination_track.get("artist_formed")
        or destination_track.get("formed")
        or destination_track.get("year")
    )
    if row_year is None or dest_year is None:
        return 0.0
    distance = abs(row_year - dest_year)
    if distance <= 5:
        return 1.0
    if distance <= 12:
        return 0.72
    if distance <= 20:
        return 0.35
    return 0.0


def _local_scene_penalty(
    row: dict,
    *,
    destination_track: dict,
    destination_profile: Mapping | None,
    connection_score: float,
    genre_overlap: float,
    scorer: _SceneScorer | None = None,
) -> float:
    if connection_score >= 0.3 or genre_overlap >= 0.55:
        return 0.0

    endpoint_countries = {
        country
        for country in {
            _country_code(
                destination_track.get("artist_country")
                or destination_track.get("country")
            ),
            _country_code(_mapping_value(destination_profile, "country")),
        }
        if country
    }
    row_country = _country_code(row.get("artist_country") or row.get("country"))
    slugs = scorer.row_genre_slugs(row) if scorer else _row_genre_slugs(row)
    has_local_slug = any(
        part in _LOCAL_SCENE_SLUG_PARTS for slug in slugs for part in slug.split("-")
    )
    if has_local_slug and (not row_country or row_country not in endpoint_countries):
        return 1.0
    if row_country and endpoint_countries and row_country not in endpoint_countries:
        return 0.25
    return 0.0


def _row_genre_slugs(row: Mapping) -> set[str]:
    values: list[object] = []
    raw_values = row.get("artist_genre_slugs")
    if isinstance(raw_values, list | tuple | set):
        values.extend(raw_values)
    values.extend(
        [
            row.get("genre_slug"),
            row.get("raw_genre_slug"),
        ]
    )
    return _slug_set(values)


def _profile_genre_slugs(profile: Mapping | None) -> set[str]:
    if not profile:
        return set()
    values: list[object] = []
    for item in profile.get("genres") or []:
        if isinstance(item, Mapping):
            values.extend([item.get("slug"), item.get("raw_slug"), item.get("name")])
    return _slug_set(values)


def _slug_set(values: list[object]) -> set[str]:
    slugs: set[str] = set()
    for value in values:
        plain = _plain_slug(value)
        if not plain:
            continue
        slugs.add(plain)
        canonical = _canonical_slug(plain)
        if canonical:
            slugs.add(canonical)
    return slugs


def _plain_slug(value: object) -> str:
    raw = str(value or "").strip()
    return slugify_genre(raw) if raw else ""


def _country_code(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    aliased = _COUNTRY_ALIASES.get(raw.casefold())
    if aliased:
        return aliased
    if len(raw) == 2:
        return raw.upper()
    return raw.upper()


def _formed_year(value: object) -> int | None:
    match = re.search(r"\b(18|19|20)\d{2}\b", str(value or ""))
    return int(match.group(0)) if match else None


def _mapping_value(mapping: Mapping | None, key: str) -> object:
    if not mapping:
        return None
    return mapping.get(key)


def _audio_completeness(row: dict) -> float:
    fields = ("bpm", "audio_key", "energy", "danceability", "valence", "bliss_vector")
    present = sum(1 for field in fields if row.get(field) not in (None, "", []))
    return present / len(fields)


def _audio_transition_score(row: dict, previous_track: dict | None) -> float:
    if not previous_track:
        return 0.0

    scores: list[float] = []
    energy = _close_float_score(
        row.get("energy"), previous_track.get("energy"), scale=1.0
    )
    if energy is not None:
        scores.append(energy)

    bpm = _close_float_score(row.get("bpm"), previous_track.get("bpm"), scale=60.0)
    if bpm is not None:
        scores.append(bpm)

    key = _key_transition_score(row, previous_track)
    if key is not None:
        scores.append(key)

    bliss = _bliss_transition_score(
        row.get("bliss_vector"), previous_track.get("bliss_vector")
    )
    if bliss is not None:
        scores.append(bliss)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _close_float_score(left: object, right: object, *, scale: float) -> float | None:
    left_float = _coerce_float(left)
    right_float = _coerce_float(right)
    if left_float is None or right_float is None:
        return None
    return max(0.0, min(1.0, 1.0 - (abs(left_float - right_float) / scale)))


def _key_transition_score(row: dict, previous_track: dict) -> float | None:
    current_key = str(row.get("audio_key") or "").strip().casefold()
    previous_key = str(previous_track.get("audio_key") or "").strip().casefold()
    if not current_key or not previous_key:
        return None
    current_scale = str(row.get("audio_scale") or "").strip().casefold()
    previous_scale = str(previous_track.get("audio_scale") or "").strip().casefold()
    if current_key == previous_key and current_scale == previous_scale:
        return 1.0
    if current_key == previous_key:
        return 0.82
    if current_scale and current_scale == previous_scale:
        return 0.62
    return 0.45


def _bliss_transition_score(left: object, right: object) -> float | None:
    left_vector = _coerce_vector(left)
    right_vector = _coerce_vector(right)
    if not left_vector or not right_vector or len(left_vector) != len(right_vector):
        return None

    dot = sum(
        left_value * right_value
        for left_value, right_value in zip(left_vector, right_vector)
    )
    left_norm = math.sqrt(sum(value * value for value in left_vector))
    right_norm = math.sqrt(sum(value * value for value in right_vector))
    if left_norm <= 0 or right_norm <= 0:
        return None
    cosine = dot / (left_norm * right_norm)
    return max(0.0, min(1.0, (cosine + 1.0) / 2.0))


def _coerce_vector(value: object) -> list[float]:
    if not isinstance(value, list | tuple):
        return []
    vector: list[float] = []
    for item in value:
        number = _coerce_float(item)
        if number is None:
            return []
        vector.append(number)
    return vector


def _curation_quality(row: dict) -> float:
    penalty = track_version_penalty(row) * 0.35
    if _LOW_SIGNAL_TITLE_RE.search(str(row.get("title") or "")):
        penalty += 0.35
    duration = _coerce_float(row.get("duration"))
    if duration is not None and 0 < duration < 75:
        penalty += 0.25
    return max(0.0, 1.0 - penalty)


def _is_blocked_variant(row: dict) -> bool:
    if track_version_penalty(row) >= 3:
        return True
    title = str(row.get("title") or "")
    return bool(_LOW_SIGNAL_TITLE_RE.search(title))


def _bounded_float(value: object, *, scale: float = 1.0) -> float:
    number = _coerce_float(value)
    if number is None:
        return 0.0
    return max(0.0, min(1.0, number / scale))


def _log_score(value: object, max_value: float) -> float:
    number = _coerce_float(value)
    if number is None or number <= 0:
        return 0.0
    return max(0.0, min(1.0, math.log1p(number) / math.log1p(max_value)))


def _rank_score(value: object) -> float:
    number = _coerce_float(value)
    if number is None or number <= 0:
        return 0.0
    return max(0.0, min(1.0, 1.0 - ((number - 1.0) / 50.0)))


def _coerce_float(value: object) -> float | None:
    if not isinstance(value, int | float | str):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


__all__ = [
    "build_artist_scene_path_from_candidates",
    "build_scene_genre_route",
    "build_scene_path_from_candidates",
    "compute_scene_path",
    "prepare_scene_path",
]
