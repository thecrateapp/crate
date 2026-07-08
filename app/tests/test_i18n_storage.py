from sqlalchemy import text


def test_i18n_orm_models_are_registered():
    from crate.db.engine import Base
    from crate.db.orm import I18nBundle, I18nTranslationRequest

    assert I18nBundle.__tablename__ == "i18n_bundles"
    assert I18nTranslationRequest.__tablename__ == "i18n_translation_requests"
    assert "i18n_bundles" in Base.metadata.tables
    assert "i18n_translation_requests" in Base.metadata.tables

    bundle_columns = Base.metadata.tables["i18n_bundles"].columns
    request_columns = Base.metadata.tables["i18n_translation_requests"].columns

    assert {
        "app",
        "locale",
        "source_version",
        "bundle_version",
        "messages_json",
    }.issubset(bundle_columns.keys())
    assert {"app", "locale", "source_version", "reason", "status"}.issubset(
        request_columns.keys()
    )


def test_i18n_tables_exist_after_init_db(pg_db):
    from crate.db.tx import read_scope

    with read_scope() as session:
        tables = dict(
            session.execute(
                text(
                    """
                    SELECT
                      to_regclass('public.i18n_bundles') AS bundles,
                      to_regclass('public.i18n_translation_requests') AS requests
                    """
                )
            )
            .mappings()
            .one()
        )
        indexes = {
            row["indexname"]
            for row in session.execute(
                text(
                    """
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND tablename IN ('i18n_bundles', 'i18n_translation_requests')
                    """
                )
            )
            .mappings()
            .all()
        }

    assert tables == {
        "bundles": "i18n_bundles",
        "requests": "i18n_translation_requests",
    }
    assert "idx_i18n_bundles_published" in indexes
