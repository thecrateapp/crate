"""Admit the error inbox AI actions in the four action CHECKs of revision 130.

Revision 130 (section v120) wrote the closed action list into four unnamed CHECKs
and froze it. This section replaces every CHECK of those tables that mentions
`action_id` with a named one over the v120 list plus `ops.error.triage` and
`ops.error.investigate`, so it is idempotent and also runs on bootstrap.

The downgrade restores the v120 list. Bindings of the two actions are configuration
for features the older code does not know, so they are deleted. Invocation history
and daily usage keep their rows: the restored CHECKs on those tables are `NOT VALID`,
which applies the old list to new rows only and keeps spent budgets counted.
"""

from crate.db.schema_sections.ai_configuration_v120 import ACTIONS_SQL

V120_ACTIONS_SQL = ACTIONS_SQL
V145_NEW_ACTIONS = ("ops.error.triage", "ops.error.investigate")
V145_ACTIONS_SQL = V120_ACTIONS_SQL + "".join(
    f",'{action_id}'" for action_id in V145_NEW_ACTIONS
)

# table -> (constraint name, CHECK expression over {actions})
_ACTION_CHECKS = {
    "ai_action_bindings": (
        "ai_action_bindings_action_id_check",
        "action_id IN ({actions})",
    ),
    "ai_invocations": (
        "ai_invocations_action_id_check",
        "(invocation_kind='action' AND action_id IS NOT NULL AND action_id IN ({actions}))"
        " OR (invocation_kind='probe' AND action_id IS NULL)",
    ),
    "ai_usage_daily": (
        "ai_usage_daily_action_id_check",
        "(invocation_kind='action' AND action_id IN ({actions}))"
        " OR (invocation_kind='probe' AND action_id='')",
    ),
    "ai_legacy_invocation_receipts": (
        "ai_legacy_invocation_receipts_action_id_check",
        "action_id IN ({actions})",
    ),
}
# Tables whose rows are history: a downgrade keeps them instead of failing.
_HISTORY_TABLES = frozenset(
    {"ai_invocations", "ai_usage_daily", "ai_legacy_invocation_receipts"}
)


def _drop_action_checks(cur, table: str) -> None:
    """Drop every CHECK of the table that mentions action_id, whatever its name."""
    cur.execute(f"""DO $$ DECLARE c record; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = '{table}'::regclass AND contype = 'c'
              AND position('action_id' in pg_get_constraintdef(oid)) > 0
        LOOP
            EXECUTE 'ALTER TABLE {table} DROP CONSTRAINT ' || quote_ident(c.conname);
        END LOOP; END $$""")


def _action_checks(cur, actions_sql: str, *, keep_history: bool) -> None:
    for table, (name, expression) in _ACTION_CHECKS.items():
        _drop_action_checks(cur, table)
        not_valid = " NOT VALID" if keep_history and table in _HISTORY_TABLES else ""
        cur.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} "
            f"CHECK ({expression.format(actions=actions_sql)}){not_valid}"
        )


def create_ai_action_error_inbox_v145_schema(cur) -> None:
    _action_checks(cur, V145_ACTIONS_SQL, keep_history=False)


def drop_ai_action_error_inbox_v145_schema(cur) -> None:
    """Restore the v120 list; delete the new actions' bindings, keep their history."""
    new_actions = ",".join(f"'{action_id}'" for action_id in V145_NEW_ACTIONS)
    cur.execute(f"DELETE FROM ai_action_bindings WHERE action_id IN ({new_actions})")
    _action_checks(cur, V120_ACTIONS_SQL, keep_history=True)


__all__ = [
    "V120_ACTIONS_SQL",
    "V145_ACTIONS_SQL",
    "V145_NEW_ACTIONS",
    "create_ai_action_error_inbox_v145_schema",
    "drop_ai_action_error_inbox_v145_schema",
]
