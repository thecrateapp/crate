"""Phase 4 tests — catalog sync, stale markers, indexed search logic."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch


from crate.federation.catalog import (
    is_catalog_stale,
    STALE_THRESHOLD_HOURS,
)


class TestStaleMarkers:
    @patch("crate.federation.catalog.get_cursor")
    def test_no_cursor_is_stale(self, mock_get_cursor):
        mock_get_cursor.return_value = None
        assert is_catalog_stale("node-1") is True

    @patch("crate.federation.catalog.get_cursor")
    def test_recent_cursor_is_fresh(self, mock_get_cursor):
        now = datetime.now(timezone.utc)
        mock_get_cursor.return_value = {"updated_at": now}
        assert is_catalog_stale("node-1") is False

    @patch("crate.federation.catalog.get_cursor")
    def test_old_cursor_is_stale(self, mock_get_cursor):
        old = datetime.now(timezone.utc) - timedelta(hours=STALE_THRESHOLD_HOURS + 1)
        mock_get_cursor.return_value = {"updated_at": old}
        assert is_catalog_stale("node-1") is True

    def test_stale_threshold_is_24_hours(self):
        assert STALE_THRESHOLD_HOURS == 24


class TestCatalogSearchSQL:
    def test_search_sql_has_expected_structure(self):
        from crate.federation.catalog import _FED_SEARCH_SQL

        assert "federation_catalog_items" in _FED_SEARCH_SQL
        assert "search_vector" in _FED_SEARCH_SQL
        assert "deleted_at IS NULL" in _FED_SEARCH_SQL
        assert "to_tsquery" in _FED_SEARCH_SQL
        assert "ts_rank" in _FED_SEARCH_SQL


class TestCatalogCount:
    @patch("crate.federation.catalog.read_scope")
    def test_count_catalog_items(self, mock_read_scope):
        from crate.federation.catalog import count_catalog_items

        mock_session = MagicMock()
        mock_session.execute.return_value.mappings.return_value.all.return_value = [
            {"entity_type": "album", "cnt": 5},
            {"entity_type": "track", "cnt": 42},
        ]
        mock_read_scope.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_read_scope.return_value.__exit__ = MagicMock(return_value=False)

        result = count_catalog_items("node-1")
        assert result == {"album": 5, "track": 42}
