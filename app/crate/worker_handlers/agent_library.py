from crate.agent_library_operations import execute_operation_job
from crate.agent_operation_catalog import public_operation_result


def _handle_agent_maintenance(task_id: str, params: dict, config: dict) -> dict:
    return public_operation_result(execute_operation_job(task_id, config))


AGENT_LIBRARY_TASK_HANDLERS = {"agent_maintenance": _handle_agent_maintenance}
