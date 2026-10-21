"""The eleven registered operations, independent of provider and persistence."""

from crate.ai.contracts import AIAction, AIConfigurationError, ActionMaxima


def _action(
    action_id,
    label,
    group,
    modality,
    permission,
    location,
    timeout,
    output,
    description,
):
    shows = action_id.startswith("shows.")
    return AIAction(
        id=action_id,
        label=label,
        group=group,
        input=modality,
        permission=permission,
        location=location,
        description=description,
        maxima=ActionMaxima(
            timeout_seconds=timeout,
            max_output_tokens=output,
            max_image_pixels=20000000 if modality == "image" else None,
            max_proposals=200 if shows else None,
            max_selected=50 if shows else None,
        ),
    )


ACTIONS: dict[str, AIAction] = {
    action.id: action
    for action in (
        _action(
            "shows.extract.vision",
            "Extract shows from image",
            "shows",
            "image",
            "curation.shows.write",
            "/upcoming",
            90,
            16000,
            "Extract tour rows from a poster or screenshot into show proposals.",
        ),
        _action(
            "shows.extract.text",
            "Extract shows from text",
            "shows",
            "text",
            "curation.shows.write",
            "/upcoming",
            45,
            16000,
            "Extract show proposals from pasted text or a public page read by a worker.",
        ),
        _action(
            "shows.extract.ocr_text",
            "Extract shows from OCR",
            "shows",
            "text",
            "curation.shows.write",
            "/upcoming",
            45,
            16000,
            "Extract shows from local OCR text, preserving uncertainty about missing years.",
        ),
        _action(
            "artwork.hero.analyze",
            "Analyze artist hero",
            "artwork",
            "image",
            "library.metadata.write",
            "/browse",
            90,
            4096,
            "Assess framing, faces and focal points of an artist photograph.",
        ),
        _action(
            "artists.bio.research",
            "Research artist biography",
            "editorial",
            "text",
            "library.metadata.write",
            "/browse",
            90,
            8192,
            "Consolidate an artist biography from sources and evidence.",
        ),
        _action(
            "genres.description.generate",
            "Generate genre description",
            "genres",
            "text",
            "curation.genres.write",
            "/genres",
            60,
            4096,
            "Describe a genre using context and seed artists.",
        ),
        _action(
            "genres.taxonomy.propose",
            "Propose genre taxonomy",
            "genres",
            "text",
            "curation.genres.write",
            "/genres",
            90,
            8192,
            "Propose taxonomy relationships and descriptions.",
        ),
        _action(
            "genres.eq.propose",
            "Propose genre EQ",
            "genres",
            "text",
            "curation.genres.write",
            "/genres",
            45,
            2048,
            "Propose a validated ten-band EQ preset and explanation.",
        ),
        _action(
            "playlists.description.generate",
            "Generate playlist description",
            "editorial",
            "text",
            "curation.playlists.write",
            "/playlists",
            45,
            2048,
            "Write a playlist description from rules and up to sixty tracks.",
        ),
        _action(
            "music_paths.refine",
            "Refine Music Path",
            "discovery",
            "text",
            "library.view",
            "/settings",
            8,
            4096,
            "Refine a deterministic route using only the permitted IDs.",
        ),
        _action(
            "i18n.listen.draft",
            "Draft Listen translations",
            "translation",
            "text",
            "settings.manage",
            "/i18n",
            90,
            16000,
            "Draft translations while preserving keys and placeholders for review.",
        ),
    )
}


def list_actions() -> list[dict]:
    return [action.model_dump(mode="json") for action in ACTIONS.values()]


def get_action(action_id: str) -> AIAction:
    try:
        return ACTIONS[action_id]
    except KeyError:
        raise AIConfigurationError("AI_ACTION_UNKNOWN", "Unknown action") from None
