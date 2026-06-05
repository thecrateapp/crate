from __future__ import annotations

from crate.db.repositories.auth_user_accounts import (
    _seed_admin,
    count_users,
    create_user,
    get_user_by_email,
    get_user_by_external_identity,
    get_user_by_google_id,
    get_user_by_id,
    suggest_username,
)
from crate.db.repositories.auth_user_admin import (
    delete_user,
    get_user_presence,
    get_users_presence,
    list_users,
    list_users_map_rows,
    normalize_user_status,
    update_user,
    update_user_last_login,
    update_user_location,
    update_user_status,
    validate_user_status,
)
from crate.db.repositories.auth_user_roles import (
    get_user_roles,
    normalize_role_values,
    set_user_roles,
)


__all__ = [
    "_seed_admin",
    "count_users",
    "create_user",
    "delete_user",
    "get_user_by_email",
    "get_user_by_external_identity",
    "get_user_by_google_id",
    "get_user_by_id",
    "get_user_presence",
    "get_users_presence",
    "get_user_roles",
    "list_users",
    "list_users_map_rows",
    "normalize_user_status",
    "normalize_role_values",
    "suggest_username",
    "set_user_roles",
    "update_user",
    "update_user_last_login",
    "update_user_location",
    "update_user_status",
    "validate_user_status",
]
