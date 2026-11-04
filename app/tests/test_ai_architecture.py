"""No AI-provider call in an HTTP request or outside an AI-lane task (SM3-D8).

The call graph comes from tests/ai_model_calls.py: a function calls a model when
any chain of calls reaches the provider transport. Roots of those chains must be
handlers of tasks on the ai/ai_bulk queues.
"""

from crate.actors import TASK_POOL_CONFIG
from tests.ai_model_calls import (
    api_modules,
    imports_by_function,
    model_call_roots,
    model_calling,
    task_handler_nodes,
)

AI_QUEUES = {"ai", "ai_bulk"}

# HTTP routes that still call a model inside the request. Each entry names the
# SMQ PR that moves it to an AI-lane task, and that PR deletes the entry; a
# stale entry fails test_exceptions_are_still_needed. New entries need an
# approved plan change first.
HTTP_MODEL_CALL_EXCEPTIONS: dict[tuple[str, str], str] = {
    ("crate.api.artwork", "api_analyze_artist_hero_candidate"): "SMQ.PR5",
}

FACADE_SHIM_EXCEPTIONS: dict[tuple[str, str], str] = {}


def _forbidden_import(source: str, name: str) -> bool:
    """Imports that only make sense for calling a model synchronously."""
    if source.startswith("crate.llm.prompts.") and name.startswith(
        ("generate_", "consolidate_")
    ):
        return True
    if source in {"crate.llm", "crate.llm.provider"} and name in {
        "ask",
        "ask_structured",
        "ask_image_structured",
        "provider",
    }:
        return True
    if source == "crate.ai.runtime" and name in {"execute_structured", "execute_probe"}:
        return True
    if source == "crate.ai" and name in {"transport", "discovery"}:
        return True
    if source in {"crate.ai.transport", "crate.ai.discovery"}:
        return True
    if source == "crate.ai.operations" and name == "run_probe":
        return True
    # resolve_call pins a context for an immediate call; queued work accepts
    # with accept_action and resumes in the worker.
    return source == "crate.ai.consumers" and name in {"resolve_call", "resume_action"}


def test_the_call_graph_sees_known_model_calls():
    calling = model_calling()
    assert ("crate.ai.runtime", "execute_structured") in calling
    assert ("crate.llm.prompts.eq_preset", "generate_eq_preset") in calling
    assert ("crate.worker_handlers.enrichment", "_handle_research_artist_bio") in (
        calling
    )
    assert ("crate.worker_handlers.ai_configuration", "handle_refresh") in calling


def test_no_model_calls_in_api_modules():
    calling = model_calling()
    offenders: dict[tuple[str, str], list[str]] = {}
    for module in api_modules():
        for scope, names in imports_by_function(module).items():
            forbidden = sorted(
                f"{source}.{name}"
                for source, name in names
                if _forbidden_import(source, name)
            )
            if forbidden:
                offenders.setdefault((module, scope), []).extend(forbidden)
            if scope != "<module>" and (module, scope) in calling:
                offenders.setdefault((module, scope), []).append("reaches a model")
    unexpected = {
        node: reasons
        for node, reasons in offenders.items()
        if node not in HTTP_MODEL_CALL_EXCEPTIONS
    }
    assert unexpected == {}


def test_model_calls_only_in_ai_handlers():
    handlers = task_handler_nodes()
    calling = model_calling()
    misplaced = sorted(
        task_type
        for task_type, node in handlers.items()
        if node in calling and TASK_POOL_CONFIG[task_type].queue not in AI_QUEUES
    )
    assert misplaced == []

    ai_handlers = {
        node
        for task_type, node in handlers.items()
        if TASK_POOL_CONFIG[task_type].queue in AI_QUEUES
    }
    allowed = (
        ai_handlers | set(HTTP_MODEL_CALL_EXCEPTIONS) | set(FACADE_SHIM_EXCEPTIONS)
    )
    assert sorted(model_call_roots() - allowed) == []


def test_exceptions_are_still_needed():
    roots = model_call_roots()
    stale = sorted(
        node
        for node in {**HTTP_MODEL_CALL_EXCEPTIONS, **FACADE_SHIM_EXCEPTIONS}
        if node not in roots
    )
    assert stale == []
    assert set(HTTP_MODEL_CALL_EXCEPTIONS.values()) <= {
        "SMQ.PR2",
        "SMQ.PR3",
        "SMQ.PR4",
        "SMQ.PR5",
        "unassigned",
    }
