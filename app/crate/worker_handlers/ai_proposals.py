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


AI_PROPOSAL_TASK_HANDLERS: dict[str, TaskHandler] = {
    "propose_genre_eq": _handle_propose_genre_eq,
}
