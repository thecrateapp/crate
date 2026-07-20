from __future__ import annotations

from collections.abc import Callable
import itertools
import os
import re
import uuid

import psycopg2
from psycopg2 import sql


_SAFE_DATABASE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


class PostgresTestDatabaseFactory:
    """Create isolated test databases from one migrated template database."""

    def __init__(self, *, base_dsn: str, database_prefix: str) -> None:
        if not _SAFE_DATABASE_NAME.fullmatch(database_prefix):
            raise ValueError(f"Unsafe test database prefix: {database_prefix!r}")
        self._base_dsn = base_dsn
        self._database_prefix = database_prefix
        self._run_token = f"{os.getpid()}_{uuid.uuid4().hex[:8]}"
        self._counter = itertools.count(1)
        self._template_ready = False
        self.template_database_name = self._database_name("template")

    def create_template_database(self, initializer: Callable[[str], None]) -> str:
        self.drop_database(self.template_database_name)
        self._execute_admin(
            sql.SQL("CREATE DATABASE {}").format(
                sql.Identifier(self.template_database_name)
            )
        )
        try:
            initializer(self.template_database_name)
        except Exception:
            self.drop_database(self.template_database_name)
            raise
        self._template_ready = True
        return self.template_database_name

    def create_clone(self) -> str:
        if not self._template_ready:
            raise RuntimeError("PostgreSQL test template has not been initialized")
        database_name = self._database_name("case", next(self._counter))
        self._execute_admin(
            sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(
                sql.Identifier(database_name),
                sql.Identifier(self.template_database_name),
            )
        )
        return database_name

    def drop_database(self, database_name: str) -> None:
        self._validate_managed_name(database_name)
        connection = psycopg2.connect(self._base_dsn)
        connection.autocommit = True
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE datname = %s
                      AND pid <> pg_backend_pid()
                    """,
                    (database_name,),
                )
                cursor.execute(
                    sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                        sql.Identifier(database_name)
                    )
                )
        finally:
            connection.close()
        if database_name == self.template_database_name:
            self._template_ready = False

    def close(self) -> None:
        self.drop_database(self.template_database_name)

    def _database_name(self, kind: str, index: int | None = None) -> str:
        suffix = f"_{index}" if index is not None else ""
        name = f"{self._database_prefix}_{kind}_{self._run_token}{suffix}"
        if len(name) > 63:
            raise ValueError("Generated PostgreSQL test database name is too long")
        return name

    def _validate_managed_name(self, database_name: str) -> None:
        managed_prefixes = (
            f"{self._database_prefix}_template_",
            f"{self._database_prefix}_case_",
        )
        if not _SAFE_DATABASE_NAME.fullmatch(
            database_name
        ) or not database_name.startswith(managed_prefixes):
            raise ValueError(f"Refusing to manage unsafe database {database_name!r}")

    def _execute_admin(self, statement: sql.Composed) -> None:
        connection = psycopg2.connect(self._base_dsn)
        connection.autocommit = True
        try:
            with connection.cursor() as cursor:
                cursor.execute(statement)
        finally:
            connection.close()
