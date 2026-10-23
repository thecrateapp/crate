"""Retain exact operator authority for every generation and across ordinary resets."""


def create_operator_generations_v134_schema(cur):
    cur.execute(
        "ALTER TABLE IF EXISTS track_processing_state ADD COLUMN IF NOT EXISTS operator_authority JSONB"
    )


__all__ = ["create_operator_generations_v134_schema"]
