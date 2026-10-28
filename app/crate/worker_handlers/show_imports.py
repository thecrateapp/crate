"""Private OCR/vision drafts; this worker never publishes a show."""

from crate.agent_diagnostics import DiagnosticError
from crate.agent_operation_catalog import public_operation_result
from crate.db.repositories.agent_requests import fail_job
from crate.db.repositories.show_extraction_jobs import (
    load_show_extraction,
    check_show_extraction_authority,
    finish_show_extraction,
    save_show_extractor_readiness,
)
from crate.show_extraction import SHOW_ACTIONS, extract_show_candidates
from crate.show_location_enrichment import enrich_show_draft_locations
from crate.ai import consumers
from crate.ai.contracts import AIConfigurationError


def handle_show_extraction(task_id: str, params: dict, config: dict) -> dict:
    def cancelled():
        return check_show_extraction_authority(task_id)

    try:
        private = load_show_extraction(task_id)
        if private["job"]["result"] is not None:
            return public_operation_result(private["job"]["result"])
        ai_call = None
        action_id = SHOW_ACTIONS.get(private["input"]["mode"])
        try:
            if action_id:
                ai_call = consumers.resume_action(
                    action_id,
                    private["job"]["payload"].get("ai_acceptance"),
                    actor_id=private["human_actor_id"],
                    job_id=task_id,
                )
            draft = extract_show_candidates(
                private["input"],
                private["images"],
                cancelled=cancelled,
                ai_call=ai_call,
            )
            consumers.revalidate_call(ai_call)
        except AIConfigurationError as error:
            from crate.show_ocr import parse_show_text

            # Keep the owned text reviewable even when the queued provider was revoked.
            draft = parse_show_text(private["input"].get("raw_text") or "")
            draft["error_code"] = (
                "CONFIGURATION_CHANGED"
                if error.code == "AI_CONTEXT_STALE"
                else "LLM_UNAVAILABLE"
            )
            draft["warnings"].append(
                "The accepted model configuration changed or was revoked; accept a new extraction."
            )
        draft = enrich_show_draft_locations(draft, cancelled=cancelled)
        from crate.show_telemetry import record_show_metrics

        record_show_metrics(candidates=len(draft.get("candidates", [])))
        if "readiness" in draft:
            save_show_extractor_readiness(draft["readiness"])
        result = {
            "execution": {
                "status": "failed" if draft.get("error_code") else "extracted",
                **(
                    {
                        "error_code": draft["error_code"],
                        "error": "Model extraction failed; recognized text remains in the private draft",
                    }
                    if draft.get("error_code")
                    else {}
                ),
                "draft_id": private["draft_id"],
                "candidates": len(draft.get("candidates", [])),
            },
            "draft": draft,
            "verification": {"status": "not_required"},
            "projection": {"status": "not_required"},
        }
        return public_operation_result(finish_show_extraction(task_id, result))
    except DiagnosticError as error:
        return public_operation_result(
            fail_job(
                task_id,
                error.code,
                "Show extraction permission or private source is no longer available",
            )
        )
    except Exception as error:
        # Provider exceptions can contain a response, URL or key. Only closed error codes leave this boundary.
        code = str(error).split(":", 1)[0]
        allowed = {
            "CANCELLED",
            "OCR_TIMEOUT",
            "OCR_UNAVAILABLE",
            "OCR_FAILED",
            "INVALID_IMAGE",
            "LLM_UNAVAILABLE",
            "IMAGE_REQUIRED",
            "TEXT_REQUIRED",
            "IMAGE_BUDGET",
        }
        code = code if code in allowed else "EXTRACTION_FAILED"
        return public_operation_result(
            fail_job(
                task_id,
                code,
                "Extraction did not complete. Keep the draft and retry with local OCR, pasted text or manual entry.",
            )
        )


SHOW_IMPORT_TASK_HANDLERS = {"show_extract": handle_show_extraction}
