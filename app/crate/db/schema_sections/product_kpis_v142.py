"""Daily product KPIs computed off-request, one row per KPI, day and dimension set."""


def create_product_kpi_daily_v142_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS product_kpi_daily (
            day DATE NOT NULL,
            kpi TEXT NOT NULL,
            dims JSONB NOT NULL DEFAULT '{}'::jsonb,
            value DOUBLE PRECISION NOT NULL,
            sample INTEGER,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (day, kpi, dims)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_product_kpi_daily_kpi_day
        ON product_kpi_daily (kpi, day DESC)
    """)


__all__ = ["create_product_kpi_daily_v142_schema"]
