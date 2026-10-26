from crate.agent_library_operations import execute_operation_job
from crate.agent_operation_catalog import public_operation_result
from crate.mcp.telemetry import record_job_result


def _handle_agent_maintenance(task_id: str, params: dict, config: dict) -> dict:
    result = execute_operation_job(task_id, config)
    record_job_result(result)
    return public_operation_result(result)


def _handle_agent_control(task_id: str, params: dict, config: dict) -> dict:
    from crate.agent_diagnostics import DiagnosticError
    from crate.db.repositories.agent_operation_jobs import load_operation_job

    job = load_operation_job(task_id)
    if job["payload"].get("domain_operation") != "job_cancel":
        raise DiagnosticError(
            "FORBIDDEN", "Control worker accepts only job cancellation"
        )
    result = execute_operation_job(task_id, config)
    record_job_result(result)
    return public_operation_result(result)


AGENT_LIBRARY_TASK_HANDLERS = {
    "agent_maintenance": _handle_agent_maintenance,
    "agent_tidal_download": _handle_agent_maintenance,
    "agent_control": _handle_agent_control,
}
