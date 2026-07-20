from __future__ import annotations

import warnings
from collections.abc import Iterable
from typing import cast

from sqlalchemy import (
    ARRAY,
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy.exc import SAWarning

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.orm.playlist import (
    Playlist,
    PlaylistMember,
    PlaylistTrack,
    UserFollowedPlaylist,
)
from crate.db.orm.releases import NewRelease
from crate.db.orm.user import AuthInvite, Session, User, UserExternalIdentity


ACTIVE_ORM_MODELS = (
    AuthInvite,
    LibraryAlbum,
    LibraryArtist,
    LibraryTrack,
    NewRelease,
    Playlist,
    PlaylistMember,
    PlaylistTrack,
    Session,
    UserExternalIdentity,
    UserFollowedPlaylist,
    User,
)


def _type_family(value) -> str:
    if isinstance(value, ARRAY):
        return "array"
    if isinstance(value, UUID):
        return "uuid"
    if isinstance(value, JSON):
        return "json"
    if isinstance(value, BigInteger):
        return "bigint"
    if isinstance(value, Integer):
        return "integer"
    if isinstance(value, Boolean):
        return "boolean"
    if isinstance(value, DateTime):
        return "timestamp"
    if isinstance(value, Date):
        return "date"
    if isinstance(value, Float):
        return "float"
    if isinstance(value, String):
        return "text"
    return type(value).__name__.lower()


def _normalized_ondelete(value: str | None) -> str | None:
    return value.upper() if value else None


def _named_column_set(
    column_names: Iterable[str | None] | None,
) -> frozenset[str] | None:
    if column_names is None:
        return None
    names = tuple(column_names)
    if not names or any(name is None for name in names):
        return None
    return frozenset(name for name in names if name is not None)


def _database_unique_sets(inspector: Inspector, table_name: str) -> set[frozenset[str]]:
    unique_sets: set[frozenset[str]] = set()
    for constraint in inspector.get_unique_constraints(table_name):
        column_set = _named_column_set(constraint.get("column_names"))
        if column_set is not None:
            unique_sets.add(column_set)
    for index in inspector.get_indexes(table_name):
        column_set = _named_column_set(index.get("column_names"))
        if index.get("unique") and column_set is not None:
            unique_sets.add(column_set)
    primary_key = _named_column_set(
        inspector.get_pk_constraint(table_name).get("constrained_columns")
    )
    if primary_key is not None:
        unique_sets.add(primary_key)
    return unique_sets


def _model_unique_sets(table: Table) -> Iterable[frozenset[str]]:
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint):
            yield frozenset(column.name for column in constraint.columns)
    for column in table.columns:
        if column.unique:
            yield frozenset((column.name,))


def find_active_orm_schema_drift(inspector: Inspector) -> list[str]:
    drift: list[str] = []

    for model in ACTIVE_ORM_MODELS:
        table = cast(Table, model.__table__)
        table_name = table.name
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="Did not recognize type 'vector'.*",
                category=SAWarning,
            )
            reflected_columns = inspector.get_columns(table_name)
        db_columns = {column["name"]: column for column in reflected_columns}
        orm_pk = {column.name for column in table.primary_key}
        db_pk = set(
            inspector.get_pk_constraint(table_name).get("constrained_columns", [])
        )
        if orm_pk != db_pk:
            drift.append(f"{table_name}: primary key ORM={orm_pk} DB={db_pk}")

        for column in table.columns:
            db_column = db_columns.get(column.name)
            if db_column is None:
                drift.append(f"{table_name}.{column.name}: missing from database")
                continue
            if column.nullable != db_column["nullable"]:
                drift.append(
                    f"{table_name}.{column.name}: nullable "
                    f"ORM={column.nullable} DB={db_column['nullable']}"
                )
            orm_type = _type_family(column.type)
            db_type = _type_family(db_column["type"])
            if orm_type != db_type:
                drift.append(
                    f"{table_name}.{column.name}: type ORM={orm_type} DB={db_type}"
                )

        orm_fks = {
            (
                foreign_key.parent.name,
                foreign_key.column.table.name,
                foreign_key.column.name,
                _normalized_ondelete(foreign_key.ondelete),
            )
            for column in table.columns
            for foreign_key in column.foreign_keys
        }
        db_fks = {
            (
                foreign_key["constrained_columns"][0],
                foreign_key["referred_table"],
                foreign_key["referred_columns"][0],
                _normalized_ondelete(foreign_key.get("options", {}).get("ondelete")),
            )
            for foreign_key in inspector.get_foreign_keys(table_name)
            if len(foreign_key.get("constrained_columns", [])) == 1
        }
        if orm_fks != db_fks:
            drift.append(f"{table_name}: foreign keys ORM={orm_fks} DB={db_fks}")

        db_unique_sets = _database_unique_sets(inspector, table_name)
        for unique_set in _model_unique_sets(table):
            if unique_set not in db_unique_sets:
                drift.append(
                    f"{table_name}: ORM uniqueness {set(unique_set)} is not enforced"
                )

    return drift


__all__ = ["ACTIVE_ORM_MODELS", "find_active_orm_schema_drift"]
