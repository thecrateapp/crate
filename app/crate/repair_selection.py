"""Selection rules shared by repair acceptance and worker execution."""


class RepairSelectionError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def select_repair_items(
    preview: dict,
    plan_item_ids: list[str],
    *,
    expected_version: str | None,
    confirm_risky: bool = False,
) -> list[dict]:
    if expected_version and preview.get("plan_version") != expected_version:
        raise RepairSelectionError(
            "PLAN_STALE", "Repair plan is stale; refresh its preview"
        )
    if not plan_item_ids:
        raise RepairSelectionError("EMPTY_SELECTION", "Select at least one repair item")
    if len(set(plan_item_ids)) != len(plan_item_ids):
        raise RepairSelectionError("INVALID_SELECTION", "Duplicate repair item IDs")
    items = preview.get("items") or []
    by_id = {item.get("plan_item_id"): item for item in items}
    if len(by_id) != len(items) or not set(plan_item_ids) <= by_id.keys():
        raise RepairSelectionError(
            "PLAN_STALE", "Repair selection does not match the plan"
        )
    selected = [by_id[item_id] for item_id in plan_item_ids]
    if any(not item.get("executable") for item in selected):
        raise RepairSelectionError(
            "NOT_EXECUTABLE", "A selected repair requires manual intervention"
        )
    if not confirm_risky and any(
        item.get("requires_confirmation") for item in selected
    ):
        raise RepairSelectionError(
            "CONFIRMATION_REQUIRED",
            "Repair execution requires explicit confirmation for risky fixes",
        )
    if len(selected) > 1 and any(
        item.get("supports_batch") is False for item in selected
    ):
        raise RepairSelectionError(
            "BATCH_NOT_SUPPORTED", "Selected fixes must be run one by one"
        )
    return selected
