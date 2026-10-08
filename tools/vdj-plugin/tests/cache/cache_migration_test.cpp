#include "crate_vdj/metadata_cache.hpp"

#include <sqlite3.h>

#include <cassert>
#include <filesystem>

namespace {

void execute(sqlite3* database, const char* sql)
{
    assert(sqlite3_exec(database, sql, nullptr, nullptr, nullptr) == SQLITE_OK);
}

} // namespace

int main()
{
    const auto database_path =
        std::filesystem::temp_directory_path() / "crate-vdj-metadata-cache-migration-test.sqlite";
    std::filesystem::remove(database_path);

    sqlite3* legacy_database = nullptr;
    assert(
        sqlite3_open_v2(
            database_path.c_str(),
            &legacy_database,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
            nullptr
        ) == SQLITE_OK
    );
    execute(
        legacy_database,
        "CREATE TABLE metadata_cache ("
        "id INTEGER PRIMARY KEY,"
        "scope_origin TEXT NOT NULL,"
        "account_key TEXT NOT NULL,"
        "kind TEXT NOT NULL,"
        "request_key TEXT NOT NULL,"
        "payload BLOB NOT NULL,"
        "stored_at INTEGER NOT NULL,"
        "last_accessed_at INTEGER NOT NULL,"
        "fresh_until INTEGER NOT NULL,"
        "UNIQUE(scope_origin, account_key, kind, request_key)"
        ")"
    );
    execute(legacy_database, "PRAGMA user_version = 1");
    execute(
        legacy_database,
        "INSERT INTO metadata_cache ("
        "id, scope_origin, account_key, kind, request_key, payload, stored_at, "
        "last_accessed_at, fresh_until"
        ") VALUES (1, 'https://api.dev.lespedants.org', 'token:a', 'search', "
        "'high vis', X'01', 10, 10, 20)"
    );
    assert(sqlite3_close(legacy_database) == SQLITE_OK);

    {
        crate::vdj::MetadataCacheStore cache(database_path.string());
        assert(cache.ready());
    }

    sqlite3* migrated_database = nullptr;
    assert(
        sqlite3_open_v2(
            database_path.c_str(),
            &migrated_database,
            SQLITE_OPEN_READONLY,
            nullptr
        ) == SQLITE_OK
    );
    sqlite3_stmt* statement = nullptr;
    assert(
        sqlite3_prepare_v2(
            migrated_database,
            "PRAGMA user_version",
            -1,
            &statement,
            nullptr
        ) == SQLITE_OK
    );
    assert(sqlite3_step(statement) == SQLITE_ROW);
    assert(sqlite3_column_int64(statement, 0) == 2);
    sqlite3_finalize(statement);
    assert(
        sqlite3_prepare_v2(
            migrated_database,
            "SELECT COUNT(*), stale_until, payload_version "
            "FROM metadata_cache",
            -1,
            &statement,
            nullptr
        ) == SQLITE_OK
    );
    assert(sqlite3_step(statement) == SQLITE_ROW);
    assert(sqlite3_column_int64(statement, 0) == 1);
    assert(sqlite3_column_int64(statement, 1) == 86420);
    assert(sqlite3_column_int64(statement, 2) == 1);
    sqlite3_finalize(statement);
    assert(sqlite3_close(migrated_database) == SQLITE_OK);

    std::filesystem::remove(database_path);
    std::filesystem::remove(database_path.string() + "-wal");
    std::filesystem::remove(database_path.string() + "-shm");
    return 0;
}
