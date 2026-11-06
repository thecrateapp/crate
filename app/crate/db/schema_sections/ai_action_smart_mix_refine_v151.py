"""Admit the Smart Mix refinement AI action in the four action CHECKs (SM4.PR1).

Revision 145 rebuilt the action CHECKs of revision 130 as named constraints over
its list. This section rebuilds them the same way over that list plus
`smart_mix.transition.refine`, so it is idempotent and also runs on bootstrap.

The downgrade restores the revision 145 list. Bindings of the new action are
configuration the older code does not know, so they are deleted; invocation
history and daily usage keep their rows under `NOT VALID` CHECKs, as in 145.
"""

from crate.db.schema_sections.ai_action_error_inbox_v145 import (
    V145_ACTIONS_SQL,
    _action_checks,
)

V151_NEW_ACTIONS = ("smart_mix.transition.refine",)
V151_ACTIONS_SQL = V145_ACTIONS_SQL + "".join(
    f",'{action_id}'" for action_id in V151_NEW_ACTIONS
)


def create_ai_action_smart_mix_refine_v151_schema(cur) -> None:
    _action_checks(cur, V151_ACTIONS_SQL, keep_history=False)


def drop_ai_action_smart_mix_refine_v151_schema(cur) -> None:
    """Restore the 145 list; delete the new action's bindings, keep its history."""
    new_actions = ",".join(f"'{action_id}'" for action_id in V151_NEW_ACTIONS)
    cur.execute(f"DELETE FROM ai_action_bindings WHERE action_id IN ({new_actions})")
    _action_checks(cur, V145_ACTIONS_SQL, keep_history=True)


__all__ = [
    "V151_ACTIONS_SQL",
    "V151_NEW_ACTIONS",
    "create_ai_action_smart_mix_refine_v151_schema",
    "drop_ai_action_smart_mix_refine_v151_schema",
]
