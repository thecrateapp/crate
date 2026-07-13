"""Schema models for genre endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import IdentityFieldsMixin


class GenreArtistRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist_name: str
    artist_id: int | None = None
    artist_slug: str | None = None
    weight: float | None = None
    membership_score: float | None = None
    membership_tier: str | None = None
    source: str | None = None
    album_count: int | None = None
    track_count: int | None = None
    has_photo: bool | int | None = None
    spotify_popularity: int | None = None
    listeners: int | None = None


class GenreAlbumRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    album_id: int | None = None
    album_slug: str | None = None
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    name: str
    year: str | None = None
    track_count: int | None = None
    has_cover: bool | int | None = None
    weight: float | None = None
    membership_score: float | None = None
    membership_tier: str | None = None
    direct_genre_match: bool | None = None


class GenreShowRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    type: str = "show"
    date: str
    time: str | None = None
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    title: str
    subtitle: str
    cover_url: str | None = None
    status: str | None = None
    is_upcoming: bool = True
    url: str | None = None
    venue: str | None = None
    address_line1: str | None = None
    city: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    lineup: list[str] | None = None
    genres: list[str] = Field(default_factory=list)
    source: str | None = None
    lastfm_attendance: int | None = None
    lastfm_url: str | None = None
    tickets_url: str | None = None
    distance_km: float | None = None


class GenreRelatedRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    slug: str
    name: str
    page_slug: str | None = None
    relation_type: str
    relation_label: str
    description: str | None = None
    artist_count: int = 0
    album_count: int = 0
    content_score: int = 0
    cover_url: str | None = None
    top_artist_id: int | None = None
    top_artist_slug: str | None = None
    top_artist_name: str | None = None
    top_artist_photo_url: str | None = None


class GenreSummaryResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    name: str
    slug: str
    artist_count: int = 0
    album_count: int = 0
    track_count: int = 0
    mapped: bool = False
    canonical_slug: str | None = None
    canonical_name: str | None = None
    canonical_description: str | None = None
    top_level_slug: str | None = None
    top_level_name: str | None = None
    top_level_description: str | None = None
    description: str | None = None
    cover_url: str | None = None
    external_description: str | None = None
    external_description_source: str | None = None
    musicbrainz_mbid: str | None = None
    wikidata_entity_id: str | None = None
    wikidata_url: str | None = None
    eq_gains: list[float] | None = None
    eq_preset_resolved: dict[str, Any] | None = None


class GenreDetailResponse(GenreSummaryResponse):
    artists: list[GenreArtistRef] = Field(default_factory=list)
    albums: list[GenreAlbumRef] = Field(default_factory=list)
    shows: list[GenreShowRef] = Field(default_factory=list)
    related_genres: list[GenreRelatedRef] = Field(default_factory=list)


class GenreGraphNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    slug: str
    label: str
    kind: str
    mapped: bool
    artist_count: int = 0
    album_count: int = 0
    description: str | None = None
    page_slug: str | None = None
    is_center: bool = False
    is_top_level: bool = False
    canonical_slug: str | None = None


class GenreGraphLink(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    target: str
    relation_type: str
    weight: float | int | None = None


class GenreGraphResponse(BaseModel):
    nodes: list[GenreGraphNode]
    links: list[GenreGraphLink]
    mapping: GenreSummaryResponse


class EqPresetUpdateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    slug: str
    eq_gains: list[float] | None = None
    eq_preset_resolved: dict[str, Any] | None = None


class InvalidGenreTaxonomyNodeResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str
    name: str | None = None
    alias_count: int = 0
    edge_count: int = 0
    reason: str | None = None


class GenreTaxonomyInvalidStatusResponse(BaseModel):
    invalid_count: int = 0
    alias_count: int = 0
    edge_count: int = 0
    items: list[InvalidGenreTaxonomyNodeResponse] = Field(default_factory=list)


class GenreTaxonomyTreeNodeResponse(IdentityFieldsMixin):
    entity_uid: str | None = None
    slug: str
    name: str
    description: str | None = None
    musicbrainz_mbid: str | None = None
    wikidata_url: str | None = None
    top_level: bool = False
    parent_slugs: list[str] = Field(default_factory=list)
    children_slugs: list[str] = Field(default_factory=list)
    related_slugs: list[str] = Field(default_factory=list)
    influenced_by_slugs: list[str] = Field(default_factory=list)
    influences_slugs: list[str] = Field(default_factory=list)
    fusion_of_slugs: list[str] = Field(default_factory=list)
    fusion_genre_slugs: list[str] = Field(default_factory=list)
    alias_names: list[str] = Field(default_factory=list)
    artist_count: int = 0
    album_count: int = 0
    eq_gains: list[float] | None = None
    eq_preset_source: str | None = None
    eq_preset_inherited_from: str | None = None


class GenreTaxonomyTreeResponse(BaseModel):
    nodes: list[GenreTaxonomyTreeNodeResponse]
    top_level_slugs: list[str] = Field(default_factory=list)


class GenreTaxonomyNodeUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    top_level: bool | None = None


class GenreTaxonomyNodeUpdateResponse(BaseModel):
    ok: bool = True
    slug: str


class GenreTaxonomyCoverUpdateResponse(BaseModel):
    ok: bool = True
    slug: str
    cover_url: str


class GenreDeleteResponse(BaseModel):
    ok: bool = True
    slug: str
    name: str | None = None
    deleted_library_genres: int = 0
    deleted_taxonomy_nodes: int = 0
    removed_artist_assignments: int = 0
    removed_album_assignments: int = 0
    removed_raw_genres: list[str] = Field(default_factory=list)


class GenreTaxonomyRelationsUpdateRequest(BaseModel):
    relation_type: str
    target_slugs: list[str] = Field(default_factory=list)


class GenreTaxonomyRelationsUpdateResponse(BaseModel):
    ok: bool = True
    slug: str
    relation_type: str
    added: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)


class GenreTaxonomyAliasesUpdateRequest(BaseModel):
    alias_names: list[str] = Field(default_factory=list, max_length=24)


class GenreTaxonomyAliasesUpdateResponse(BaseModel):
    ok: bool = True
    slug: str
    applied: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


class GenreTaxonomyRelationProposalResponse(BaseModel):
    relation_type: str
    target_slugs: list[str] = Field(default_factory=list)
    confidence: float = 0.5
    reasoning: str = ""


class GenreTaxonomyNodeProposalResponse(BaseModel):
    ok: bool = True
    slug: str
    name: str | None = None
    source_kind: str = "taxonomy_node"
    recommended_action: str = "needs_review"
    recommended_target_slug: str | None = None
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    relations: list[GenreTaxonomyRelationProposalResponse] = Field(default_factory=list)
    reasoning: str = ""
    current_relations: dict[str, list[str]] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)


class GenreTaxonomyNodeProposalApplyRequest(BaseModel):
    source_kind: str = "raw_genre"
    recommended_action: str
    recommended_target_slug: str | None = None
    name: str | None = None
    description: str = ""
    aliases: list[str] = Field(default_factory=list, max_length=24)
    relations: list[GenreTaxonomyRelationProposalResponse] = Field(default_factory=list)
    reasoning: str = ""


class GenreTaxonomyNodeProposalApplyResponse(BaseModel):
    ok: bool = True
    slug: str
    action: str
    target_slug: str | None = None
    applied_aliases: list[str] = Field(default_factory=list)
    skipped_aliases: list[str] = Field(default_factory=list)
    relation_results: list[GenreTaxonomyRelationsUpdateResponse] = Field(
        default_factory=list
    )


class EqCoverageSourceResponse(BaseModel):
    source: str
    count: int = 0
    percent: float = 0.0


class EqCoverageResponse(BaseModel):
    total_tracks: int = 0
    sources: list[EqCoverageSourceResponse] = Field(default_factory=list)


class TaxonomyHealthResponse(BaseModel):
    node_count: int = 0
    top_level_count: int = 0
    orphan_count: int = 0
    missing_description_count: int = 0
    missing_direct_eq_count: int = 0
    unmapped_raw_count: int = 0
    edge_count: int = 0
    locked_edge_count: int = 0
    manual_edge_count: int = 0
    ai_edge_count: int = 0


class SoundIntelligenceHealthResponse(BaseModel):
    eq: EqCoverageResponse
    taxonomy: TaxonomyHealthResponse


class GenreTaxonomyRebuildProposalRequest(BaseModel):
    alias_limit: int = Field(80, ge=1, le=300)
    node_limit: int = Field(12, ge=0, le=50)
    include_external: bool = True
    aggressive: bool = True
