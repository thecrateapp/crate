"""Durable native identity, exact review progress and transport receipts."""


def create_agent_telegram_v133_schema(cur):
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_telegram_bindings (
        id UUID PRIMARY KEY, instance_id TEXT NOT NULL,
        principal_id UUID NOT NULL REFERENCES agent_principals(id),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
        chat_id BIGINT NOT NULL CHECK (chat_id = telegram_user_id),
        revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""")
    cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS agent_telegram_active_binding
        ON agent_telegram_bindings(instance_id,principal_id) WHERE revoked_at IS NULL""")
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_telegram_confirmations (
        id TEXT PRIMARY KEY, binding_id UUID NOT NULL REFERENCES agent_telegram_bindings(id),
        plan_id UUID NOT NULL REFERENCES agent_repair_plans(id),
        credential_id UUID NOT NULL REFERENCES agent_credentials(id),
        origin JSONB NOT NULL, identity JSONB NOT NULL, pages JSONB NOT NULL,
        apply_after_approval BOOLEAN NOT NULL, apply_key TEXT NOT NULL,
        page_index INTEGER NOT NULL DEFAULT 0, delivered_count INTEGER NOT NULL DEFAULT 0,
        message_id BIGINT, state TEXT NOT NULL DEFAULT 'pending', result JSONB,
        outcome_message_id BIGINT, delivery_attempts INTEGER NOT NULL DEFAULT 0,
        next_delivery_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id)
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_telegram_receipts (
        transport_nonce TEXT PRIMARY KEY, instance_id TEXT NOT NULL,
        update_id BIGINT, query_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(instance_id, update_id), UNIQUE(instance_id, query_id)
    )""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS agent_telegram_receipt_retention ON agent_telegram_receipts(created_at) WHERE update_id IS NULL AND query_id IS NULL"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS agent_telegram_delivery_due ON agent_telegram_confirmations(next_delivery_at) WHERE state='pending' OR (result IS NOT NULL AND outcome_message_id IS NULL)"
    )
    cur.execute("""ALTER TABLE agent_plan_approvals ADD COLUMN IF NOT EXISTS
        telegram_binding_id UUID REFERENCES agent_telegram_bindings(id)""")


__all__ = ["create_agent_telegram_v133_schema"]
