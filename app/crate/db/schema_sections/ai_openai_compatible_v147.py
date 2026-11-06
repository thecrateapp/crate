"""Admit openai_compatible provider connections (revision 147, section id v147).

Revision 130 (section v120) wrote the closed provider list into an unnamed CHECK
on `ai_provider_connections` and froze it. This section replaces every CHECK of
that table that mentions `provider` with two named ones, so it is idempotent and
also runs on bootstrap:

- the provider list of v120 plus `openai_compatible`;
- the shape of an openai_compatible connection. Only that provider has a
  template, a path prefix and a model manifest, it always has an origin and its
  key is never read from the environment. A predefined template pins its origin
  and path prefix here as well as in the application, and a custom origin may
  only use one of the prefixes the predefined templates use.

The downgrade restores the v120 list. Connections of the new provider that no
profile version, invocation or usage day refers to are configuration the older
code does not know, so they are deleted with their stored keys. A connection
with history cannot be deleted (profile versions are immutable) and the older
code cannot read it, so the downgrade stops instead of leaving it behind.
"""

V120_PROVIDERS_SQL = "'gemini','deepseek','ollama'"
V147_PROVIDERS_SQL = V120_PROVIDERS_SQL + ",'openai_compatible'"

# template -> (origin, path prefix); "custom" has neither fixed.
V147_TEMPLATE_ORIGINS = {
    "moonshot": ("https://api.moonshot.ai", "/v1"),
    "dashscope_intl": ("https://dashscope-intl.aliyuncs.com", "/compatible-mode/v1"),
    "openrouter": ("https://openrouter.ai", "/api/v1"),
}
V147_TEMPLATES = (*V147_TEMPLATE_ORIGINS, "custom")
V147_PATH_PREFIXES = tuple(
    dict.fromkeys(prefix for _, prefix in V147_TEMPLATE_ORIGINS.values())
)
V147_MAX_MANIFEST_ENTRIES = 50

_TABLE = "ai_provider_connections"
_PROVIDER_CHECK = "ai_provider_connections_provider_check"
_SHAPE_CHECK = "ai_provider_connections_openai_compatible_check"


def _quoted(values) -> str:
    return ",".join(f"'{value}'" for value in values)


def _shape_expression() -> str:
    pinned = " AND ".join(
        f"(template IS DISTINCT FROM '{template}' OR "
        f"(endpoint = '{origin}' AND path_prefix = '{prefix}'))"
        for template, (origin, prefix) in V147_TEMPLATE_ORIGINS.items()
    )
    return (
        "(provider = 'openai_compatible') = (template IS NOT NULL)"
        " AND (provider = 'openai_compatible') = (path_prefix IS NOT NULL)"
        f" AND (template IS NULL OR template IN ({_quoted(V147_TEMPLATES)}))"
        f" AND (path_prefix IS NULL OR path_prefix IN ({_quoted(V147_PATH_PREFIXES)}))"
        " AND (provider <> 'openai_compatible'"
        " OR (endpoint IS NOT NULL AND secret_source <> 'environment'))"
        " AND jsonb_typeof(model_manifest) = 'array'"
        f" AND jsonb_array_length(model_manifest) <= {V147_MAX_MANIFEST_ENTRIES}"
        " AND (provider = 'openai_compatible' OR model_manifest = '[]'::jsonb)"
        f" AND {pinned}"
    )


def _drop_provider_checks(cur) -> None:
    """Drop every CHECK of the table that mentions provider, whatever its name."""
    cur.execute(f"""DO $$ DECLARE c record; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = '{_TABLE}'::regclass AND contype = 'c'
              AND position('provider' in pg_get_constraintdef(oid)) > 0
        LOOP
            EXECUTE 'ALTER TABLE {_TABLE} DROP CONSTRAINT ' || quote_ident(c.conname);
        END LOOP; END $$""")


def create_ai_openai_compatible_v147_schema(cur) -> None:
    cur.execute(f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS template TEXT")
    cur.execute(f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS path_prefix TEXT")
    cur.execute(
        f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS "
        "model_manifest JSONB NOT NULL DEFAULT '[]'::jsonb"
    )
    _drop_provider_checks(cur)
    cur.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_PROVIDER_CHECK} "
        f"CHECK (provider IN ({V147_PROVIDERS_SQL}))"
    )
    cur.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_SHAPE_CHECK} "
        f"CHECK ({_shape_expression()})"
    )


def drop_ai_openai_compatible_v147_schema(cur) -> None:
    """Restore v120; delete unused new connections and refuse ones with history."""
    cur.execute(f"""WITH removed AS (
        DELETE FROM {_TABLE} c WHERE c.provider = 'openai_compatible'
          AND NOT EXISTS (SELECT 1 FROM ai_profile_versions v WHERE v.connection_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM ai_invocations i WHERE i.connection_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM ai_usage_daily u WHERE u.connection_id = c.id)
        RETURNING c.secret_ref)
        DELETE FROM credential_secrets
        WHERE secret_ref IN (SELECT secret_ref FROM removed WHERE secret_ref IS NOT NULL)""")
    cur.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM {_TABLE} WHERE provider = 'openai_compatible') THEN
            RAISE EXCEPTION 'openai_compatible connections with profiles or usage history remain; revision 146 cannot read them';
        END IF; END $$""")
    _drop_provider_checks(cur)
    cur.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_PROVIDER_CHECK} "
        f"CHECK (provider IN ({V120_PROVIDERS_SQL}))"
    )
    for column in ("model_manifest", "path_prefix", "template"):
        cur.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")


__all__ = [
    "V120_PROVIDERS_SQL",
    "V147_MAX_MANIFEST_ENTRIES",
    "V147_PATH_PREFIXES",
    "V147_PROVIDERS_SQL",
    "V147_TEMPLATE_ORIGINS",
    "V147_TEMPLATES",
    "create_ai_openai_compatible_v147_schema",
    "drop_ai_openai_compatible_v147_schema",
]
