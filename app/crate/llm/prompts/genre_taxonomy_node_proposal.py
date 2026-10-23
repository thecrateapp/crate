"""Genre taxonomy node proposal generation via LLM."""

from typing import Literal

from pydantic import BaseModel, Field


RelationType = Literal["parent", "related", "influenced_by", "fusion_of"]
ProposalAction = Literal[
    "create_node",
    "alias_existing",
    "delete_marginal",
    "classify_facet",
    "needs_review",
]
GenreFacetDimension = Literal[
    "era",
    "instrumentation",
    "language",
    "mood",
    "origin",
    "rhythm",
    "scene",
    "sound",
    "vocals",
]


class GenreTaxonomyRelationSuggestion(BaseModel):
    relation_type: RelationType
    target_slugs: list[str] = Field(default_factory=list, max_length=8)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reasoning: str = Field(default="", max_length=220)


class GenreTaxonomyFacetSuggestion(BaseModel):
    dimension: GenreFacetDimension
    name: str = Field(min_length=1, max_length=64)


class GenreTaxonomyNodeProposalResponse(BaseModel):
    recommended_action: ProposalAction = Field(
        default="needs_review",
        description=(
            "Recommended editorial action for this genre/tag. Use create_node for "
            "strong standalone genres, alias_existing for tags that should map to "
            "an existing node, delete_marginal for noisy one-off tags already "
            "covered by stronger genres, and needs_review when uncertain."
        ),
    )
    recommended_target_slug: str | None = Field(
        default=None,
        max_length=120,
        description=(
            "Existing target slug for alias_existing/delete_marginal decisions. "
            "Must be one of the allowed target slugs."
        ),
    )
    description: str = Field(
        default="",
        max_length=320,
        description="Concise editorial description of the genre, no markdown.",
    )
    aliases: list[str] = Field(default_factory=list, max_length=12)
    relations: list[GenreTaxonomyRelationSuggestion] = Field(default_factory=list)
    facets: list[GenreTaxonomyFacetSuggestion] = Field(default_factory=list, max_length=32)
    eq_gains: list[float] = Field(
        default_factory=list,
        max_length=10,
        description=(
            "Suggested 10-band EQ gains in dB, ordered 32, 64, 125, 250, 500, "
            "1000, 2000, 4000, 8000, 16000 Hz. Each value must be between -12 and +12."
        ),
    )
    eq_reasoning: str = Field(
        default="",
        max_length=420,
        description="Brief explanation of the proposed tonal curve, no marketing language.",
    )
    reasoning: str = Field(default="", max_length=420)


GENRE_TAXONOMY_NODE_PROPOSAL_SYSTEM_PROMPT = """You are a precise music taxonomy editor for Crate.
You propose conservative, reviewable taxonomy changes for serious personal music libraries.
Use only target slugs explicitly listed by the user.
Do not invent slugs.
Prefer specific parent genres over broad top-level buckets.
Descriptions must be factual, concise, and useful inside a music app.
Propose a conservative EQ curve that suits the genre rather than mastering a specific album.
Return exactly ten EQ gains in dB, in this order: 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz.
Keep each gain within -12 to +12 dB, use small intentional adjustments, and explain the tonal intent briefly.
No markdown, no hype, no jokes."""


def build_genre_taxonomy_node_proposal_prompt(
    *,
    genre_name: str,
    slug: str,
    source_kind: str = "taxonomy_node",
    current_description: str | None = None,
    current_relations: dict[str, list[str]] | None = None,
    aliases: list[str] | None = None,
    seed_artists: list[str] | None = None,
    sample_albums: list[str] | None = None,
    cooccurring_genres: list[str] | None = None,
    artist_count: int | None = None,
    album_count: int | None = None,
    candidate_targets: list[dict] | None = None,
) -> str:
    relations = current_relations or {}
    targets = candidate_targets or []
    parts = [
        f'Infer a taxonomy proposal for genre "{genre_name}" ({slug}).',
        f"Source kind: {source_kind}.",
        "Return a full replacement suggestion for each relation type you are confident about.",
        "Relation types: parent, related, influenced_by, fusion_of.",
        "Set recommended_action to one of: create_node, alias_existing, delete_marginal, classify_facet, needs_review.",
    ]
    if source_kind != "raw_genre":
        parts.append(
            "This is an existing taxonomy node. Never use classify_facet; its "
            "facets are edited separately from the raw-tag classification flow."
        )
    if source_kind == "raw_genre":
        parts.append(
            "This is an unmapped raw library tag, not a curated taxonomy node yet. "
            "Use the local evidence to decide whether it is a musical genre, a "
            "non-genre descriptor that belongs in a facet, or should be merged away."
        )
        parts.append(
            "Use classify_facet for non-genre descriptors such as an era, "
            "instrumentation, language, mood, origin, rhythm, scene, sound, or vocal "
            "character. For this action return one or more facets as dimension/name "
            "pairs; do not return aliases, relations, a genre description, or EQ gains."
        )
        parts.append(
            "Prefer alias_existing when the tag is a spelling variant, overly broad, "
            "overly narrow, or already covered by an existing stronger node."
        )
        parts.append(
            "Use delete_marginal when the tag looks noisy or marginal and has little "
            "real library evidence; include the stronger existing target in "
            "recommended_target_slug when possible."
        )
        parts.append(
            "Only use create_node when the tag represents a meaningful musical "
            "genre with enough evidence to justify expanding the taxonomy. Do not "
            "classify a non-genre descriptor as a genre just because it co-occurs "
            "with genres."
        )
        parts.append(
            "For create_node proposals, include the genre description, aliases, "
            "genre relations, and exactly ten EQ gains. For classify_facet, omit "
            "those genre-only fields and leave EQ gains empty. Alias and marginal "
            "tag decisions do not need EQ gains."
        )
    parts.append(
        "For taxonomy_node proposals, return a complete EQ suggestion even when "
        "the node currently inherits its preset; it will be reviewed before "
        "saving. Return exactly ten gains in dB ordered 32, 64, 125, 250, 500, "
        "1000, 2000, 4000, 8000 and 16000 Hz."
    )
    if artist_count is not None or album_count is not None:
        parts.append(
            f"Local evidence size: {artist_count or 0} artists, {album_count or 0} albums."
        )
    if current_description:
        parts.append(f"Current description: {current_description}")
    if aliases:
        parts.append(f"Known aliases/raw tags: {', '.join(aliases[:24])}.")
    if seed_artists:
        parts.append(f"Representative artists: {', '.join(seed_artists[:16])}.")
    if sample_albums:
        parts.append(f"Representative albums: {', '.join(sample_albums[:10])}.")
    if cooccurring_genres:
        parts.append(
            f"Local co-occurring canonical genres: {', '.join(cooccurring_genres[:24])}."
        )
    for relation_type in ("parent", "related", "influenced_by", "fusion_of"):
        current = relations.get(relation_type) or []
        if current:
            parts.append(f"Current {relation_type}: {', '.join(current)}.")
    if targets:
        target_lines = [
            f"- {target['slug']}: {target['name']}"
            for target in targets[:220]
            if target.get("slug") and target.get("name")
        ]
        parts.append("Allowed target slugs:\n" + "\n".join(target_lines))
    parts.append(
        "If unsure, omit the relation instead of guessing. Include confidence and reasoning."
    )
    return "\n\n".join(parts)


def generate_genre_taxonomy_node_proposal(
    *,
    genre_name: str,
    slug: str,
    source_kind: str = "taxonomy_node",
    current_description: str | None = None,
    current_relations: dict[str, list[str]] | None = None,
    aliases: list[str] | None = None,
    seed_artists: list[str] | None = None,
    sample_albums: list[str] | None = None,
    cooccurring_genres: list[str] | None = None,
    artist_count: int | None = None,
    album_count: int | None = None,
    candidate_targets: list[dict] | None = None,
    ai_call: dict | None = None,
) -> GenreTaxonomyNodeProposalResponse:
    from crate.llm import ask_structured

    return ask_structured(
        GenreTaxonomyNodeProposalResponse,
        build_genre_taxonomy_node_proposal_prompt(
            genre_name=genre_name,
            slug=slug,
            source_kind=source_kind,
            current_description=current_description,
            current_relations=current_relations,
            aliases=aliases,
            seed_artists=seed_artists,
            sample_albums=sample_albums,
            cooccurring_genres=cooccurring_genres,
            artist_count=artist_count,
            album_count=album_count,
            candidate_targets=candidate_targets,
        ),
        system=GENRE_TAXONOMY_NODE_PROPOSAL_SYSTEM_PROMPT,
        action_id="genres.taxonomy.propose",
        private_response=True,
        **(ai_call or {}),
    )
