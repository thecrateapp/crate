"""Queue placement contracts for TASK_POOL_CONFIG."""

from crate.actors import TASK_POOL_CONFIG
from tests.ai_model_calls import model_calling_task_types

AI_QUEUES = {"ai", "ai_bulk"}


def test_ai_tasks_only_in_ai_queues():
    ai_tasks = model_calling_task_types()

    # The static map must still see the AI work; an empty set would pass vacuously.
    assert {"show_extract", "research_artist_bio", "infer_genre_taxonomy"} <= ai_tasks
    misplaced = {
        task_type: TASK_POOL_CONFIG[task_type].queue
        for task_type in ai_tasks
        if TASK_POOL_CONFIG[task_type].queue not in AI_QUEUES
    }
    assert misplaced == {}
    # The lanes are sized for provider latency; other work must not occupy them.
    intruders = sorted(
        task_type
        for task_type, config in TASK_POOL_CONFIG.items()
        if config.queue in AI_QUEUES and task_type not in ai_tasks
    )
    assert intruders == []


def test_ai_interactive_time_limit_cap():
    from crate.ai.queues import AI_INTERACTIVE_TIME_LIMIT_SECONDS

    assert AI_INTERACTIVE_TIME_LIMIT_SECONDS == 300
    interactive = {
        task_type: config.time_limit_seconds
        for task_type, config in TASK_POOL_CONFIG.items()
        if config.queue == "ai"
    }
    assert interactive
    assert {
        task_type: limit
        for task_type, limit in interactive.items()
        if limit > AI_INTERACTIVE_TIME_LIMIT_SECONDS
    } == {}


def test_ai_tasks_never_retry_paid_work():
    retried = {
        task_type: config.max_retries
        for task_type, config in TASK_POOL_CONFIG.items()
        if config.queue in AI_QUEUES and config.max_retries
    }
    assert retried == {}


def test_ai_lane_destinations_follow_sm3_d8():
    expected = {
        "infer_genre_taxonomy": "ai_bulk",
        "rebuild_genre_taxonomy_proposals": "ai_bulk",
        # An admin-triggered refresh must not wait behind a taxonomy batch.
        "ai_catalog_refresh": "ai",
        "research_artist_bio": "ai",
        "draft_i18n_translation": "ai",
        "show_extract": "ai",
        "ai_profile_test": "ai",
    }
    assert {task: TASK_POOL_CONFIG[task].queue for task in expected} == expected
    # Wikidata/Wikipedia only: no provider call, so it keeps its batch queue.
    assert TASK_POOL_CONFIG["enrich_genre_descriptions"].queue == "maintenance"


def test_queue_lookup_reports_ai_lanes():
    from crate.actors import get_queue_for_task

    assert get_queue_for_task("show_extract") == "ai"
    assert get_queue_for_task("rebuild_genre_taxonomy_proposals") == "ai_bulk"


def test_ai_queue_task_registered():
    from crate.worker import TASK_HANDLERS

    config = TASK_POOL_CONFIG["smart_mix_refine_transition"]
    assert config.queue == "ai"
    # Top priority within the lane: a transition is about to play.
    assert config.priority == 0
    assert config.max_retries == 0
    # The longest action (90 s) plus the 30 s call margin (test_ai_task_deadline).
    assert config.time_limit_seconds == 120
    assert "smart_mix_refine_transition" in TASK_HANDLERS
    assert "smart_mix_refine_transition" in model_calling_task_types()
