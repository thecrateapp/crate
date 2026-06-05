"""Genre taxonomy node description generation via LLM."""

from pydantic import BaseModel, Field


class GenreNodeDescriptionResponse(BaseModel):
    """Concise editorial description for a genre taxonomy node."""

    description: str = Field(
        min_length=24,
        max_length=320,
        description="A concise, factual genre description with no markdown.",
    )


GENRE_NODE_DESCRIPTION_SYSTEM_PROMPT = """You write concise music taxonomy notes for a self-hosted music library.
Be specific, useful and grounded in musical traits: sound, scene, instrumentation, rhythm, energy, production or lineage.
Do not mention streaming platforms. Do not use markdown. Do not invent fake facts about a specific artist.
Return one sentence only."""


def build_genre_node_description_prompt(
    *,
    genre_name: str,
    slug: str,
    parent_genres: list[str] | None = None,
    related_genres: list[str] | None = None,
    aliases: list[str] | None = None,
    seed_artists: list[str] | None = None,
) -> str:
    """Build a compact prompt for a taxonomy node description."""
    parts = [
        f'Write a concise description for the music genre "{genre_name}".',
        f"Taxonomy slug: {slug}.",
    ]
    if parent_genres:
        parts.append(f"Parent genres: {', '.join(parent_genres[:6])}.")
    if related_genres:
        parts.append(f"Related genres: {', '.join(related_genres[:8])}.")
    if aliases:
        parts.append(f"Known aliases/tags: {', '.join(aliases[:8])}.")
    if seed_artists:
        parts.append(f"Local library artist examples: {', '.join(seed_artists[:8])}.")
    parts.append(
        "Focus on what the genre sounds like and where it sits in the taxonomy."
    )
    return "\n".join(parts)


def generate_genre_node_description(
    *,
    genre_name: str,
    slug: str,
    parent_genres: list[str] | None = None,
    related_genres: list[str] | None = None,
    aliases: list[str] | None = None,
    seed_artists: list[str] | None = None,
) -> GenreNodeDescriptionResponse:
    """Generate a genre node description using the configured LLM."""
    from crate.llm import ask_structured

    prompt = build_genre_node_description_prompt(
        genre_name=genre_name,
        slug=slug,
        parent_genres=parent_genres,
        related_genres=related_genres,
        aliases=aliases,
        seed_artists=seed_artists,
    )
    return ask_structured(
        GenreNodeDescriptionResponse,
        prompt,
        system=GENRE_NODE_DESCRIPTION_SYSTEM_PROMPT,
    )
