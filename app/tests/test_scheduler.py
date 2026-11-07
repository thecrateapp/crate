"""Tests for crate.scheduler — schedule logic."""

from datetime import datetime, timezone, timedelta
from unittest.mock import patch


class TestShouldRun:
    def test_should_run_no_previous_run(self):
        schedules = {"library_sync": 1800}
        with (
            patch("crate.scheduler.get_setting", return_value=None),
            patch("crate.scheduler.list_tasks", return_value=[]),
        ):
            from crate.scheduler import should_run

            assert should_run("library_sync", schedules) is True

    def test_should_not_run_interval_not_elapsed(self):
        schedules = {"library_sync": 1800}
        recent = datetime.now(timezone.utc).isoformat()
        with (
            patch("crate.scheduler.get_setting", return_value=recent),
            patch("crate.scheduler.list_tasks", return_value=[]),
        ):
            from crate.scheduler import should_run

            assert should_run("library_sync", schedules) is False

    def test_should_run_interval_elapsed(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with (
            patch("crate.scheduler.get_setting", return_value=old),
            patch("crate.scheduler.list_tasks", return_value=[]),
        ):
            from crate.scheduler import should_run

            assert should_run("library_sync", schedules) is True

    def test_should_not_run_disabled(self):
        schedules = {"library_sync": 0}
        from crate.scheduler import should_run

        assert should_run("library_sync", schedules) is False

    def test_should_not_run_negative_interval(self):
        schedules = {"library_sync": -1}
        from crate.scheduler import should_run

        assert should_run("library_sync", schedules) is False

    def test_should_not_run_task_pending(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with (
            patch("crate.scheduler.get_setting", return_value=old),
            patch(
                "crate.scheduler.list_tasks",
                side_effect=[
                    [{"id": "pending_task"}],  # pending tasks
                    [],  # running tasks
                ],
            ),
        ):
            from crate.scheduler import should_run

            assert should_run("library_sync", schedules) is False

    def test_should_not_run_task_running(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with (
            patch("crate.scheduler.get_setting", return_value=old),
            patch(
                "crate.scheduler.list_tasks",
                side_effect=[
                    [],  # pending
                    [{"id": "running_task"}],  # running
                ],
            ),
        ):
            from crate.scheduler import should_run

            assert should_run("library_sync", schedules) is False

    def test_should_not_run_unknown_task(self):
        schedules = {"library_sync": 1800}
        from crate.scheduler import should_run

        assert should_run("nonexistent_task", schedules) is False


class TestGetSetSchedules:
    def test_get_schedules_default(self):
        with patch("crate.scheduler.get_setting", return_value=None):
            from crate.scheduler import get_schedules, DEFAULT_SCHEDULES

            schedules = get_schedules()
            assert schedules == DEFAULT_SCHEDULES

    def test_default_schedules_include_duplicate_track_repair_twice_daily(self):
        from crate.scheduler import DEFAULT_SCHEDULES

        assert DEFAULT_SCHEDULES["repair_duplicate_tracks"] == 43200

    def test_default_schedules_include_global_catalog_reconciliation(self):
        from crate.scheduler import DEFAULT_SCHEDULES

        assert DEFAULT_SCHEDULES["global_catalog_reconcile_incremental"] == 300
        assert DEFAULT_SCHEDULES["global_catalog_reconcile_full"] == 43200

    def test_get_schedules_custom(self):
        import json

        custom = {"library_pipeline": 3600, "enrich_artists": 0}
        with (
            patch("crate.scheduler.get_setting", return_value=json.dumps(custom)),
            patch("crate.scheduler.set_setting"),
        ):
            from crate.scheduler import get_schedules

            schedules = get_schedules()
            assert schedules["library_pipeline"] == 3600
            assert schedules["enrich_artists"] == 0

    def test_get_schedules_merges_defaults_without_persisting_them(self):
        import json

        custom = {"library_pipeline": 3600, "enrich_artists": 0}
        with (
            patch("crate.scheduler.get_setting", return_value=json.dumps(custom)),
            patch("crate.scheduler.set_setting") as set_setting,
        ):
            from crate.scheduler import get_schedules

            schedules = get_schedules()

        assert schedules["library_pipeline"] == 3600
        assert schedules["enrich_artists"] == 0
        assert schedules["cleanup_stream_variants"] == 3600
        set_setting.assert_not_called()

    def test_set_schedules(self):
        with (
            patch(
                "crate.db.repositories.runtime_policy.read_schedules_state",
                return_value={"revision": "current"},
            ),
            patch("crate.db.repositories.runtime_policy.update_schedules") as update,
        ):
            from crate.scheduler import set_schedules

            set_schedules({"library_pipeline": 900})
            update.assert_called_once_with(
                {"library_pipeline": 900}, expected_revision="current"
            )


class TestMarkRun:
    def test_mark_run(self):
        with patch("crate.scheduler.set_setting") as mock_set:
            from crate.scheduler import mark_run

            mark_run("library_sync")
            mock_set.assert_called_once()
            args = mock_set.call_args[0]
            assert args[0] == "schedule:last_run:library_sync"
            # Should be a valid ISO datetime
            datetime.fromisoformat(args[1])


def test_enqueue_scheduled_task_preserves_guarded_result():
    from crate import scheduler

    with (
        patch.object(
            scheduler,
            "guarded_run_schedule",
            return_value={"status": "queued", "task_id": "t1"},
        ) as run,
    ):
        assert scheduler.enqueue_scheduled_task("repair_duplicate_tracks") == "t1"
    run.assert_called_once_with("repair_duplicate_tracks")

    with (
        patch.object(
            scheduler,
            "guarded_run_schedule",
            return_value={"status": "deferred", "task_id": None},
        ),
    ):
        assert scheduler.enqueue_scheduled_task("repair_duplicate_tracks") is None


class TestErrorTrackingSchedule:
    """`sync_error_issues` only runs once `error_tracking` is configured."""

    @staticmethod
    def _config(**overrides):
        from crate.error_inbox.config import parse_config

        return parse_config({"organization": "ninja-development", **overrides})

    def test_default_interval_is_five_minutes(self):
        from crate.scheduler import DEFAULT_SCHEDULES, ERROR_TRACKING_SCHEDULED_TASKS

        assert DEFAULT_SCHEDULES["sync_error_issues"] == 300
        assert ERROR_TRACKING_SCHEDULED_TASKS == {"sync_error_issues"}

    def test_error_sync_not_scheduled_without_config(self):
        from crate.error_inbox.config import ErrorTrackingConfigError
        from crate.scheduler import _scheduled_task_enabled, should_run

        schedules = {"sync_error_issues": 300}
        with (
            patch("crate.scheduler.get_setting", return_value=None),
            patch("crate.scheduler.list_tasks", return_value=[]),
            patch("crate.error_inbox.config.load_config", return_value=None),
        ):
            assert _scheduled_task_enabled("sync_error_issues") is False
            assert should_run("sync_error_issues", schedules) is False

        # Settings without a token, or unreadable settings, do not schedule either.
        with patch("crate.error_inbox.config.load_config", return_value=self._config()):
            assert _scheduled_task_enabled("sync_error_issues") is False
        with patch(
            "crate.error_inbox.config.load_config",
            side_effect=ErrorTrackingConfigError("ERROR_TRACKING_INVALID", "corrupt"),
        ):
            assert _scheduled_task_enabled("sync_error_issues") is False

    def test_error_sync_scheduled_with_config(self):
        from crate.scheduler import _scheduled_task_enabled, should_run

        configured = self._config(secret_ref="error_tracking_sentry:abc")
        schedules = {"sync_error_issues": 300}
        with (
            patch("crate.scheduler.get_setting", return_value=None),
            patch("crate.scheduler.list_tasks", return_value=[]),
            patch("crate.error_inbox.config.load_config", return_value=configured),
        ):
            assert _scheduled_task_enabled("sync_error_issues") is True
            assert should_run("sync_error_issues", schedules) is True

    def test_other_schedules_do_not_read_error_tracking_settings(self):
        from crate.scheduler import _scheduled_task_enabled

        with patch(
            "crate.error_inbox.config.load_config",
            side_effect=AssertionError("not consulted"),
        ):
            assert _scheduled_task_enabled("compute_analytics") is True
