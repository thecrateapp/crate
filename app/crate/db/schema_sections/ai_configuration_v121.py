"""Immutable additive default-model column for AI configuration (revision 131, section id v121)."""


def create_ai_default_model_v121_schema(cur):
    cur.execute(
        "ALTER TABLE ai_configuration_state ADD COLUMN IF NOT EXISTS default_model JSONB"
    )
    cur.execute("""DO $$ BEGIN IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ai_configuration_state_default_model_object'
    ) THEN
        ALTER TABLE ai_configuration_state ADD CONSTRAINT ai_configuration_state_default_model_object
        CHECK (default_model IS NULL OR jsonb_typeof(default_model)='object');
    END IF; END $$""")


__all__ = ["create_ai_default_model_v121_schema"]
