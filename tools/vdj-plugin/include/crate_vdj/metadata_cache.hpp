#pragma once

#include "crate_vdj/models.hpp"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

struct sqlite3;

namespace crate::vdj {

struct MetadataCacheScope {
    std::string origin;
    std::string account_key;
};

std::string metadata_cache_account_key(std::string_view credential);

enum class CacheState {
    Miss,
    Fresh,
    Stale,
};

struct MetadataCacheOptions {
    std::int64_t fresh_ttl_seconds = 24 * 60 * 60;
    std::int64_t stale_ttl_seconds = 24 * 60 * 60;
    std::size_t max_entries = 256;
};

template <typename T>
struct CacheLookup {
    std::optional<T> value;
    CacheState state = CacheState::Miss;
    std::string error;

    bool ok() const
    {
        return error.empty();
    }
};

class MetadataCacheStore final {
public:
    explicit MetadataCacheStore(
        std::string database_path,
        MetadataCacheOptions options = {}
    );
    ~MetadataCacheStore();

    MetadataCacheStore(const MetadataCacheStore&) = delete;
    MetadataCacheStore& operator=(const MetadataCacheStore&) = delete;

    bool ready() const;
    const std::string& error() const;

    bool put_search(
        const MetadataCacheScope& scope,
        std::string_view request_key,
        const SearchResults& results,
        std::int64_t now_seconds
    );
    CacheLookup<SearchResults> get_search(
        const MetadataCacheScope& scope,
        std::string_view request_key,
        std::int64_t now_seconds
    );

    bool put_catalog(
        const MetadataCacheScope& scope,
        std::string_view request_key,
        const CatalogResults& results,
        std::int64_t now_seconds
    );
    CacheLookup<CatalogResults> get_catalog(
        const MetadataCacheScope& scope,
        std::string_view request_key,
        std::int64_t now_seconds
    );

private:
    bool initialize();
    bool migrate(std::int64_t schema_version);
    bool put(
        std::string_view kind,
        const MetadataCacheScope& scope,
        std::string_view request_key,
        std::string payload,
        std::int64_t now_seconds
    );

    template <typename T>
    CacheLookup<T> get(
        std::string_view kind,
        const MetadataCacheScope& scope,
        std::string_view request_key,
        std::int64_t now_seconds,
        ParseResult<T> (*deserialize)(std::string_view)
    );

    bool execute(std::string_view sql);
    bool set_error(std::string message);
    bool enforce_lru();

    sqlite3* database_ = nullptr;
    MetadataCacheOptions options_;
    std::string error_;
};

} // namespace crate::vdj
