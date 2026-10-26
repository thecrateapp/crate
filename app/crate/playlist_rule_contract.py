"""Closed input contract for new editorial smart rules.

Legacy stored rules remain readable; new requests cannot silently lose filters.
"""

import re

from crate.db.repositories.playlists_rule_engine_config import (
    FIELD_COLUMNS,
    SORT_MAP,
    TEXT_FIELDS,
)

_OPTIONS = {
    "match",
    "rules",
    "limit",
    "sort",
    "deduplicate_artist",
    "deduplicate_variants",
    "max_per_artist",
    "max_per_album",
    "expand_related_genres",
}
_TEXT_OPS = {"eq", "neq", "contains", "not_contains", "in"}
_NUMBER_OPS = {"eq", "neq", "gte", "lte", "between", "in"}


def validate_smart_rules(rules: dict) -> dict:
    if not isinstance(rules, dict) or set(rules) - _OPTIONS:
        raise ValueError("smart_rules contain unsupported keys")
    if rules.get("match", "all") not in {"all", "any"}:
        raise ValueError("Unsupported match mode")
    if rules.get("sort", "random") not in SORT_MAP:
        raise ValueError("Unsupported sort")
    for key, maximum in (("limit", 500), ("max_per_artist", 50), ("max_per_album", 50)):
        value = rules.get(key)
        if value is not None and (type(value) is not int or not 1 <= value <= maximum):
            raise ValueError(f"Invalid {key}")
    for key in ("deduplicate_artist", "deduplicate_variants", "expand_related_genres"):
        if key in rules and type(rules[key]) is not bool:
            raise ValueError(f"Invalid {key}")
    selection = rules.get("rules", [])
    if not isinstance(selection, list) or len(selection) > 12:
        raise ValueError("Invalid rules selection")
    for rule in selection:
        if not isinstance(rule, dict) or set(rule) != {"field", "op", "value"}:
            raise ValueError("Invalid rule shape")
        field, op, value = rule["field"], rule["op"], rule["value"]
        if field not in FIELD_COLUMNS:
            raise ValueError("Unsupported field")
        if op not in (_TEXT_OPS if field in TEXT_FIELDS else _NUMBER_OPS):
            raise ValueError("Unsupported operator")
        if op in {"in", "between"}:
            if not isinstance(value, list) or not 1 <= len(value) <= 16:
                raise ValueError("Invalid rule values")
            if op == "between" and len(value) != 2:
                raise ValueError("between requires two values")
        elif isinstance(value, (dict, list)) or value is None:
            raise ValueError("Invalid rule value")
        values = value if isinstance(value, list) else [value]
        if field in TEXT_FIELDS:
            if any(
                not isinstance(item, str) or not item or len(item) > 200
                for item in values
            ):
                raise ValueError("Invalid text rule value")
        elif field == "year":
            if any(
                not isinstance(item, str) or not re.fullmatch(r"\d{4}", item)
                for item in values
            ):
                raise ValueError("Year rules require four-digit text values")
        elif any(type(item) not in {int, float} for item in values):
            raise ValueError("Numeric rule values must be numbers")
        if op in {"contains", "not_contains"} and isinstance(value, list):
            raise ValueError("Contains rules require a single text value")
    return rules


__all__ = ["validate_smart_rules"]
