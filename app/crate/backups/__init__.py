"""The backups engine managed from Admin (docs/plans/2026-11-10-admin-backups-plan.md).

BK1: local `pg_dump` archives and their grandfather-father-son retention. The
worker tasks live in `crate.worker_handlers.backups`; their runs in `backup_runs`.
"""
