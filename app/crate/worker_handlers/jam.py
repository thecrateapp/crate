"""Durable worker tasks for Jam Room state."""

from crate.worker_handlers import TaskHandler


def _handle_prime_jam_auto_dj(task_id: str, params: dict, config: dict) -> dict:
    """Fill one Auto DJ room after its settings transaction has committed."""

    del task_id, config
    room_id = str(params.get("room_id") or "").strip()
    if not room_id:
        return {"status": "skipped", "reason": "room_id_required"}

    from crate.db.jam import get_jam_room

    room = get_jam_room(room_id)
    if room is None:
        return {"status": "skipped", "reason": "room_not_found"}
    if room.get("queue_mode") != "auto_dj":
        return {"status": "skipped", "reason": "not_auto_dj"}

    from crate.jam_auto_dj import ensure_auto_dj_room

    return {
        "status": "completed",
        "room_id": room_id,
        "changed": bool(ensure_auto_dj_room(room)),
    }


JAM_TASK_HANDLERS: dict[str, TaskHandler] = {
    "prime_jam_auto_dj": _handle_prime_jam_auto_dj,
}


__all__ = ["JAM_TASK_HANDLERS", "_handle_prime_jam_auto_dj"]
