"""Interactive AI proposals that used to run inside HTTP requests (SMQ, SM3-D8).

Each handler resumes the configuration accepted by the API, makes one model
call on the ``ai`` queue and returns the validated proposal as the task result,
which the admin reads through the task events. Applying a proposal rechecks the
actor and the accepted configuration first. Raw prompts and responses are never
stored.
"""

from __future__ import annotations

import logging

from crate.ai.contracts import AIConfigurationError
from crate.db.repositories.genres_taxonomy_metadata import set_genre_eq_gains
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)

_EQ_GAIN_LIMIT = 12.0


def _failed(error: AIConfigurationError) -> dict:
    return {"status": "failed", "error": error.message, "error_code": error.code}


def _handle_propose_genre_eq(task_id: str, params: dict, config: dict) -> dict:
    del config
    from crate.ai.consumers import resume_action, revalidate_call
    from crate.db.queries.genres import get_genre_detail, get_genre_taxonomy_node_id
    from crate.llm.prompts.eq_preset import generate_eq_preset

    slug = str(params.get("slug") or "").strip().lower()
    if not slug or not get_genre_taxonomy_node_id(slug):
        return {"status": "failed", "error": "Genre not found in taxonomy"}
    try:
        ai_call = resume_action(
            "genres.eq.propose",
            params.get("ai_acceptance"),
            actor_id=params.get("actor_user_id"),
            job_id=task_id,
        )
        detail = get_genre_detail(slug) or {}
        parent_slugs = detail.get("parent_slugs") or []
        result = generate_eq_preset(
            genre_name=slug.replace("-", " ").title(),
            description=detail.get("description"),
            parent_genres=[s.replace("-", " ").title() for s in parent_slugs[:3]],
            ai_call=ai_call,
        )
        gains = [
            max(-_EQ_GAIN_LIMIT, min(_EQ_GAIN_LIMIT, round(float(gain), 1)))
            for gain in result.gains
        ]
        applied = False
        if params.get("apply"):
            revalidate_call(ai_call)
            set_genre_eq_gains(slug, gains, reasoning=result.reasoning)
            applied = True
    except AIConfigurationError as error:
        return _failed(error)
    if applied:
        from crate.api.cache_events import broadcast_invalidation
        from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache

        invalidate_runtime_taxonomy_cache(broadcast=True)
        try:
            broadcast_invalidation("library", "home", "curation", f"genre:{slug}")
        except Exception:
            log.debug("Genre EQ invalidation broadcast failed", exc_info=True)
    return {
        "slug": slug,
        "gains": gains,
        "reasoning": result.reasoning,
        "applied": applied,
    }


def _handle_generate_playlist_description(
    task_id: str, params: dict, config: dict
) -> dict:
    del config
    from crate.ai.consumers import resume_action, revalidate_call
    from crate.db.repositories.playlists import (
        get_playlist,
        get_playlist_tracks,
        update_playlist,
    )
    from crate.llm.prompts.playlist_description import generate_playlist_description

    try:
        playlist_id = int(params["playlist_id"])
    except (KeyError, TypeError, ValueError):
        return {"status": "failed", "error": "Playlist is required"}
    playlist = get_playlist(playlist_id)
    if not playlist or playlist.get("scope") != "system":
        return {"status": "failed", "error": "System playlist not found"}
    rules = params.get("smart_rules")
    if rules is None:
        rules = playlist.get("smart_rules")
    try:
        ai_call = resume_action(
            "playlists.description.generate",
            params.get("ai_acceptance"),
            actor_id=params.get("actor_user_id"),
            job_id=task_id,
        )
        response = generate_playlist_description(
            name=playlist.get("name") or "Untitled playlist",
            category=playlist.get("category"),
            smart_rules=rules,
            tracks=get_playlist_tracks(playlist_id)[:60],
            ai_call=ai_call,
        )
        applied = False
        if params.get("apply"):
            revalidate_call(ai_call)
            update_playlist(playlist_id, description=response.description)
            applied = True
    except AIConfigurationError as error:
        return _failed(error)
    return {
        "playlist_id": playlist_id,
        "description": response.description,
        "applied": applied,
    }


def _handle_propose_genre_taxonomy_node(
    task_id: str, params: dict, config: dict
) -> dict:
    del config
    from crate.ai.consumers import resume_action
    from crate.genre_taxonomy_proposals import build_genre_taxonomy_node_proposal

    slug = str(params.get("slug") or "").strip().lower()
    if not slug:
        return {"status": "failed", "error": "Genre not found"}
    try:
        ai_call = resume_action(
            "genres.taxonomy.propose",
            params.get("ai_acceptance"),
            actor_id=params.get("actor_user_id"),
            job_id=task_id,
        )
        # The builder revalidates the accepted call before returning.
        proposal = build_genre_taxonomy_node_proposal(slug, ai_call=ai_call)
    except AIConfigurationError as error:
        return _failed(error)
    if not proposal.get("ok"):
        return {
            "status": "failed",
            "error": "Genre not found",
            "reason": proposal.get("reason"),
        }
    return proposal


AI_PROPOSAL_TASK_HANDLERS: dict[str, TaskHandler] = {
    "propose_genre_eq": _handle_propose_genre_eq,
    "generate_playlist_description": _handle_generate_playlist_description,
    "propose_genre_taxonomy_node": _handle_propose_genre_taxonomy_node,
}
