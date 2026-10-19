#include "crate_vdj/metadata_cache.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <limits>
#include <string>
#include <utility>

namespace crate::vdj {
namespace {

constexpr std::int64_t kSchemaVersion = 2;
constexpr std::uint32_t kPayloadVersion = 1;
constexpr std::size_t kMaximumCollectionSize = 100'000;

template <typename T>
ParseResult<T> invalid(std::string message)
{
    return ParseResult<T>{
        .value = std::nullopt,
        .error_code = ModelErrorCode::InvalidResponse,
        .error = std::move(message),
    };
}

class BinaryWriter final {
public:
    void put_u32(std::uint32_t value)
    {
        for (int shift = 0; shift < 32; shift += 8) {
            bytes_.push_back(static_cast<char>((value >> shift) & 0xff));
        }
    }

    void put_i32(std::int32_t value)
    {
        put_u32(static_cast<std::uint32_t>(value));
    }

    void put_i64(std::int64_t value)
    {
        const auto unsigned_value = static_cast<std::uint64_t>(value);
        for (int shift = 0; shift < 64; shift += 8) {
            bytes_.push_back(
                static_cast<char>((unsigned_value >> shift) & 0xff)
            );
        }
    }

    void put_double(double value)
    {
        std::uint64_t bits = 0;
        static_assert(sizeof(bits) == sizeof(value));
        std::memcpy(&bits, &value, sizeof(bits));
        for (int shift = 0; shift < 64; shift += 8) {
            bytes_.push_back(static_cast<char>((bits >> shift) & 0xff));
        }
    }

    void put_bool(bool value)
    {
        bytes_.push_back(value ? '\x01' : '\x00');
    }

    void put_string(std::string_view value)
    {
        if (value.size() > std::numeric_limits<std::uint32_t>::max()) {
            valid_ = false;
            return;
        }
        put_u32(static_cast<std::uint32_t>(value.size()));
        bytes_.append(value);
    }

    bool valid() const
    {
        return valid_;
    }

    std::string finish()
    {
        return std::move(bytes_);
    }

private:
    std::string bytes_;
    bool valid_ = true;
};

class BinaryReader final {
public:
    explicit BinaryReader(std::string_view bytes)
        : bytes_(bytes)
    {
    }

    bool read_u32(std::uint32_t& value)
    {
        if (remaining() < 4) {
            return fail("metadata cache payload ended while reading u32");
        }
        value = 0;
        for (int shift = 0; shift < 32; shift += 8) {
            value |= static_cast<std::uint32_t>(
                static_cast<unsigned char>(bytes_[offset_++])
            ) << shift;
        }
        return true;
    }

    bool read_i32(std::int32_t& value)
    {
        std::uint32_t raw = 0;
        if (!read_u32(raw)) {
            return false;
        }
        value = static_cast<std::int32_t>(raw);
        return true;
    }

    bool read_i64(std::int64_t& value)
    {
        if (remaining() < 8) {
            return fail("metadata cache payload ended while reading i64");
        }
        std::uint64_t raw = 0;
        for (int shift = 0; shift < 64; shift += 8) {
            raw |= static_cast<std::uint64_t>(
                static_cast<unsigned char>(bytes_[offset_++])
            ) << shift;
        }
        value = static_cast<std::int64_t>(raw);
        return true;
    }

    bool read_double(double& value)
    {
        std::int64_t bits = 0;
        if (!read_i64(bits)) {
            return false;
        }
        std::uint64_t unsigned_bits = static_cast<std::uint64_t>(bits);
        std::memcpy(&value, &unsigned_bits, sizeof(value));
        return true;
    }

    bool read_bool(bool& value)
    {
        if (remaining() < 1) {
            return fail("metadata cache payload ended while reading bool");
        }
        const auto raw = static_cast<unsigned char>(bytes_[offset_++]);
        if (raw > 1) {
            return fail("metadata cache payload contains invalid bool");
        }
        value = raw == 1;
        return true;
    }

    bool read_string(std::string& value)
    {
        std::uint32_t size = 0;
        if (!read_u32(size)) {
            return false;
        }
        if (remaining() < size) {
            return fail("metadata cache payload ended while reading string");
        }
        value.assign(bytes_.substr(offset_, size));
        offset_ += size;
        return true;
    }

    bool complete() const
    {
        return valid_ && offset_ == bytes_.size();
    }

    const std::string& error() const
    {
        return error_;
    }

private:
    std::size_t remaining() const
    {
        return bytes_.size() - offset_;
    }

    bool fail(std::string message)
    {
        valid_ = false;
        error_ = std::move(message);
        return false;
    }

    std::string_view bytes_;
    std::size_t offset_ = 0;
    bool valid_ = true;
    std::string error_;
};

std::string cacheable_cover_url(std::string_view cover_url)
{
    if (cover_url.empty() || cover_url.front() != '/') {
        return {};
    }

    std::string lower(cover_url);
    std::transform(
        lower.begin(),
        lower.end(),
        lower.begin(),
        [](unsigned char character) {
            return static_cast<char>(std::tolower(character));
        }
    );
    for (const std::string_view marker : {
             "token", "ticket", "signature", "expires", "secret"
         }) {
        if (lower.find(marker) != std::string::npos) {
            return {};
        }
    }
    return std::string(cover_url);
}

void serialize_track(BinaryWriter& writer, const SearchTrack& track)
{
    writer.put_string(track.entity_uid);
    writer.put_string(track.title);
    writer.put_string(track.artist);
    writer.put_string(track.album);
    writer.put_double(track.duration_seconds);
    writer.put_i32(track.year);
    writer.put_string(track.genre);
    writer.put_double(track.bpm);
    writer.put_string(track.audio_key);
    writer.put_string(track.audio_scale);
    writer.put_bool(track.has_cover);
    writer.put_string(cacheable_cover_url(track.cover_url));
}

bool deserialize_track(BinaryReader& reader, SearchTrack& track)
{
    return reader.read_string(track.entity_uid) &&
        reader.read_string(track.title) &&
        reader.read_string(track.artist) &&
        reader.read_string(track.album) &&
        reader.read_double(track.duration_seconds) &&
        reader.read_i32(track.year) &&
        reader.read_string(track.genre) &&
        reader.read_double(track.bpm) &&
        reader.read_string(track.audio_key) &&
        reader.read_string(track.audio_scale) &&
        reader.read_bool(track.has_cover) &&
        reader.read_string(track.cover_url);
}

void serialize_search_results(BinaryWriter& writer, const SearchResults& results)
{
    writer.put_u32(kPayloadVersion);
    writer.put_u32(static_cast<std::uint32_t>(results.artists.size()));
    for (const auto& artist : results.artists) {
        writer.put_string(artist.entity_uid);
        writer.put_string(artist.name);
        writer.put_string(artist.slug);
    }
    writer.put_u32(static_cast<std::uint32_t>(results.albums.size()));
    for (const auto& album : results.albums) {
        writer.put_string(album.entity_uid);
        writer.put_string(album.name);
        writer.put_string(album.artist);
    }
    writer.put_u32(static_cast<std::uint32_t>(results.tracks.size()));
    for (const auto& track : results.tracks) {
        serialize_track(writer, track);
    }
}

void serialize_catalog_results(BinaryWriter& writer, const CatalogResults& results)
{
    writer.put_u32(kPayloadVersion);
    writer.put_u32(static_cast<std::uint32_t>(results.folders.size()));
    for (const auto& folder : results.folders) {
        writer.put_string(folder.id);
        writer.put_string(folder.name);
    }
    writer.put_u32(static_cast<std::uint32_t>(results.tracks.size()));
    for (const auto& track : results.tracks) {
        serialize_track(writer, track);
    }
    writer.put_bool(results.next_cursor.has_value());
    if (results.next_cursor.has_value()) {
        writer.put_string(*results.next_cursor);
    }
}

bool read_count(BinaryReader& reader, std::uint32_t& count)
{
    return reader.read_u32(count) && count <= kMaximumCollectionSize;
}

ParseResult<SearchResults> deserialize_search_results(std::string_view payload)
{
    BinaryReader reader(payload);
    std::uint32_t version = 0;
    std::uint32_t count = 0;
    SearchResults results;
    if (!reader.read_u32(version) || version != kPayloadVersion ||
        !read_count(reader, count)) {
        return invalid<SearchResults>("invalid cached search header");
    }
    results.artists.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
        SearchArtist artist;
        if (!reader.read_string(artist.entity_uid) ||
            !reader.read_string(artist.name) ||
            !reader.read_string(artist.slug)) {
            return invalid<SearchResults>(reader.error());
        }
        results.artists.push_back(std::move(artist));
    }
    if (!read_count(reader, count)) {
        return invalid<SearchResults>("invalid cached album count");
    }
    results.albums.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
        SearchAlbum album;
        if (!reader.read_string(album.entity_uid) ||
            !reader.read_string(album.name) ||
            !reader.read_string(album.artist)) {
            return invalid<SearchResults>(reader.error());
        }
        results.albums.push_back(std::move(album));
    }
    if (!read_count(reader, count)) {
        return invalid<SearchResults>("invalid cached track count");
    }
    results.tracks.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
        SearchTrack track;
        if (!deserialize_track(reader, track)) {
            return invalid<SearchResults>(reader.error());
        }
        results.tracks.push_back(std::move(track));
    }
    if (!reader.complete()) {
        return invalid<SearchResults>("trailing data in cached search");
    }
    return ParseResult<SearchResults>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

ParseResult<CatalogResults> deserialize_catalog_results(std::string_view payload)
{
    BinaryReader reader(payload);
    std::uint32_t version = 0;
    std::uint32_t count = 0;
    CatalogResults results;
    if (!reader.read_u32(version) || version != kPayloadVersion ||
        !read_count(reader, count)) {
        return invalid<CatalogResults>("invalid cached catalog header");
    }
    results.folders.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
        CatalogFolder folder;
        if (!reader.read_string(folder.id) ||
            !reader.read_string(folder.name)) {
            return invalid<CatalogResults>(reader.error());
        }
        results.folders.push_back(std::move(folder));
    }
    if (!read_count(reader, count)) {
        return invalid<CatalogResults>("invalid cached catalog track count");
    }
    results.tracks.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
        SearchTrack track;
        if (!deserialize_track(reader, track)) {
            return invalid<CatalogResults>(reader.error());
        }
        results.tracks.push_back(std::move(track));
    }
    bool has_next_cursor = false;
    if (!reader.read_bool(has_next_cursor)) {
        return invalid<CatalogResults>(reader.error());
    }
    if (has_next_cursor) {
        std::string next_cursor;
        if (!reader.read_string(next_cursor)) {
            return invalid<CatalogResults>(reader.error());
        }
        results.next_cursor = std::move(next_cursor);
    }
    if (!reader.complete()) {
        return invalid<CatalogResults>("trailing data in cached catalog");
    }
    return ParseResult<CatalogResults>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

struct Statement final {
    sqlite3_stmt* value = nullptr;

    ~Statement()
    {
        if (value != nullptr) {
            sqlite3_finalize(value);
        }
    }
};

bool bind_text(sqlite3_stmt* statement, int index, std::string_view value)
{
    return sqlite3_bind_text(
               statement,
               index,
               value.data(),
               static_cast<int>(value.size()),
               SQLITE_TRANSIENT
           ) == SQLITE_OK;
}

bool valid_key(
    const MetadataCacheScope& scope,
    std::string_view request_key
)
{
    return !scope.origin.empty() && !scope.account_key.empty() &&
        !request_key.empty();
}

} // namespace

std::string metadata_cache_account_key(std::string_view credential)
{
    constexpr std::uint64_t offset = 14695981039346656037ULL;
    constexpr std::uint64_t prime = 1099511628211ULL;
    std::uint64_t hash = offset;
    for (const unsigned char character : credential) {
        hash ^= character;
        hash *= prime;
    }

    std::array<char, 16> encoded{};
    const auto [end, error] = std::to_chars(
        encoded.data(),
        encoded.data() + encoded.size(),
        hash,
        16
    );
    if (error != std::errc{}) {
        return {};
    }
    return "token:" + std::string(encoded.data(), end);
}

MetadataCacheStore::MetadataCacheStore(
    std::string database_path,
    MetadataCacheOptions options
)
    : options_(options)
{
    options_.fresh_ttl_seconds = std::max<std::int64_t>(
        options_.fresh_ttl_seconds,
        1
    );
    options_.stale_ttl_seconds = std::max<std::int64_t>(
        options_.stale_ttl_seconds,
        0
    );
    options_.max_entries = std::max<std::size_t>(options_.max_entries, 1);

    if (database_path != ":memory:") {
        try {
            const auto parent = std::filesystem::path(database_path).parent_path();
            if (!parent.empty()) {
                std::filesystem::create_directories(parent);
            }
        } catch (const std::filesystem::filesystem_error& exception) {
            set_error(exception.what());
            return;
        }
    }

    if (sqlite3_open_v2(
            database_path.c_str(),
            &database_,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
            nullptr
        ) != SQLITE_OK) {
        set_error(
            database_ == nullptr
                ? "unable to open metadata cache"
                : sqlite3_errmsg(database_)
        );
        if (database_ != nullptr) {
            sqlite3_close(database_);
            database_ = nullptr;
        }
        return;
    }
    if (!initialize()) {
        sqlite3_close(database_);
        database_ = nullptr;
    }
}

MetadataCacheStore::~MetadataCacheStore()
{
    if (database_ != nullptr) {
        sqlite3_close(database_);
    }
}

bool MetadataCacheStore::ready() const
{
    return database_ != nullptr && error_.empty();
}

const std::string& MetadataCacheStore::error() const
{
    return error_;
}

bool MetadataCacheStore::set_error(std::string message)
{
    error_ = std::move(message);
    return false;
}

bool MetadataCacheStore::execute(std::string_view sql)
{
    char* sqlite_error = nullptr;
    const int result = sqlite3_exec(
        database_,
        std::string(sql).c_str(),
        nullptr,
        nullptr,
        &sqlite_error
    );
    if (result == SQLITE_OK) {
        return true;
    }
    const std::string message = sqlite_error == nullptr
        ? sqlite3_errmsg(database_)
        : sqlite_error;
    sqlite3_free(sqlite_error);
    return set_error(message);
}

bool MetadataCacheStore::initialize()
{
    if (!execute("PRAGMA journal_mode = WAL")) {
        return false;
    }
    if (!execute("PRAGMA busy_timeout = 5000")) {
        return false;
    }
    if (!execute("BEGIN IMMEDIATE")) {
        return false;
    }

    bool migrated = false;
    {
        Statement statement;
        if (sqlite3_prepare_v2(
                database_,
                "PRAGMA user_version",
                -1,
                &statement.value,
                nullptr
            ) != SQLITE_OK ||
            sqlite3_step(statement.value) != SQLITE_ROW) {
            set_error(sqlite3_errmsg(database_));
        } else {
            migrated = migrate(sqlite3_column_int64(statement.value, 0));
        }
    }
    if (migrated && execute("COMMIT")) {
        return true;
    }
    const auto migration_error = error_;
    execute("ROLLBACK");
    return set_error(migration_error);
}

bool MetadataCacheStore::migrate(std::int64_t schema_version)
{
    if (schema_version > kSchemaVersion) {
        return set_error("metadata cache schema is newer than this plugin");
    }
    if (schema_version == 0) {
        if (!execute(
                "CREATE TABLE IF NOT EXISTS metadata_cache ("
                "id INTEGER PRIMARY KEY,"
                "scope_origin TEXT NOT NULL,"
                "account_key TEXT NOT NULL,"
                "kind TEXT NOT NULL,"
                "request_key TEXT NOT NULL,"
                "payload BLOB NOT NULL,"
                "stored_at INTEGER NOT NULL,"
                "last_accessed_at INTEGER NOT NULL,"
                "fresh_until INTEGER NOT NULL,"
                "stale_until INTEGER NOT NULL,"
                "payload_version INTEGER NOT NULL,"
                "UNIQUE(scope_origin, account_key, kind, request_key)"
                ")"
            ) ||
            !execute(
                "CREATE INDEX IF NOT EXISTS idx_metadata_cache_lru "
                "ON metadata_cache(last_accessed_at)"
            ) ||
            !execute("PRAGMA user_version = 2")) {
            return false;
        }
        return true;
    }
    if (schema_version == 1) {
        if (!execute(
                "ALTER TABLE metadata_cache ADD COLUMN "
                "stale_until INTEGER NOT NULL DEFAULT 0"
            ) ||
            !execute(
                "ALTER TABLE metadata_cache ADD COLUMN "
                "payload_version INTEGER NOT NULL DEFAULT 1"
            ) ||
            !execute(
                "UPDATE metadata_cache SET stale_until = fresh_until + 86400 "
                "WHERE stale_until = 0"
            ) ||
            !execute(
                "CREATE INDEX IF NOT EXISTS idx_metadata_cache_lru "
                "ON metadata_cache(last_accessed_at)"
            ) ||
            !execute("PRAGMA user_version = 2")) {
            return false;
        }
    }
    return true;
}

bool MetadataCacheStore::put_search(
    const MetadataCacheScope& scope,
    std::string_view request_key,
    const SearchResults& results,
    std::int64_t now_seconds
)
{
    BinaryWriter writer;
    serialize_search_results(writer, results);
    if (!writer.valid()) {
        return set_error("search results are too large for metadata cache");
    }
    return put(
        "search",
        scope,
        request_key,
        writer.finish(),
        now_seconds
    );
}

CacheLookup<SearchResults> MetadataCacheStore::get_search(
    const MetadataCacheScope& scope,
    std::string_view request_key,
    std::int64_t now_seconds
)
{
    return get(
        "search",
        scope,
        request_key,
        now_seconds,
        deserialize_search_results
    );
}

bool MetadataCacheStore::put_catalog(
    const MetadataCacheScope& scope,
    std::string_view request_key,
    const CatalogResults& results,
    std::int64_t now_seconds
)
{
    BinaryWriter writer;
    serialize_catalog_results(writer, results);
    if (!writer.valid()) {
        return set_error("catalog results are too large for metadata cache");
    }
    return put(
        "catalog",
        scope,
        request_key,
        writer.finish(),
        now_seconds
    );
}

CacheLookup<CatalogResults> MetadataCacheStore::get_catalog(
    const MetadataCacheScope& scope,
    std::string_view request_key,
    std::int64_t now_seconds
)
{
    return get(
        "catalog",
        scope,
        request_key,
        now_seconds,
        deserialize_catalog_results
    );
}

bool MetadataCacheStore::put(
    std::string_view kind,
    const MetadataCacheScope& scope,
    std::string_view request_key,
    std::string payload,
    std::int64_t now_seconds
)
{
    if (!ready()) {
        return false;
    }
    if (!valid_key(scope, request_key)) {
        return set_error("metadata cache keys must be non-empty");
    }

    const auto fresh_until = now_seconds + options_.fresh_ttl_seconds;
    const auto stale_until = fresh_until + options_.stale_ttl_seconds;
    if (!execute("BEGIN IMMEDIATE")) {
        return false;
    }

    Statement statement;
    const bool prepared = sqlite3_prepare_v2(
        database_,
        "INSERT INTO metadata_cache ("
        "scope_origin, account_key, kind, request_key, payload, stored_at, "
        "last_accessed_at, fresh_until, stale_until, payload_version"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(scope_origin, account_key, kind, request_key) DO UPDATE SET "
        "payload = excluded.payload, stored_at = excluded.stored_at, "
        "last_accessed_at = excluded.last_accessed_at, "
        "fresh_until = excluded.fresh_until, stale_until = excluded.stale_until, "
        "payload_version = excluded.payload_version",
        -1,
        &statement.value,
        nullptr
    ) == SQLITE_OK;
    if (!prepared ||
        !bind_text(statement.value, 1, scope.origin) ||
        !bind_text(statement.value, 2, scope.account_key) ||
        !bind_text(statement.value, 3, kind) ||
        !bind_text(statement.value, 4, request_key) ||
        sqlite3_bind_blob(
            statement.value,
            5,
            payload.data(),
            static_cast<int>(payload.size()),
            SQLITE_TRANSIENT
        ) != SQLITE_OK ||
        sqlite3_bind_int64(statement.value, 6, now_seconds) != SQLITE_OK ||
        sqlite3_bind_int64(statement.value, 7, now_seconds) != SQLITE_OK ||
        sqlite3_bind_int64(statement.value, 8, fresh_until) != SQLITE_OK ||
        sqlite3_bind_int64(statement.value, 9, stale_until) != SQLITE_OK ||
        sqlite3_bind_int64(statement.value, 10, kPayloadVersion) != SQLITE_OK ||
        sqlite3_step(statement.value) != SQLITE_DONE) {
        execute("ROLLBACK");
        return set_error(sqlite3_errmsg(database_));
    }
    if (!enforce_lru() || !execute("COMMIT")) {
        execute("ROLLBACK");
        return false;
    }
    return true;
}

template <typename T>
CacheLookup<T> MetadataCacheStore::get(
    std::string_view kind,
    const MetadataCacheScope& scope,
    std::string_view request_key,
    std::int64_t now_seconds,
    ParseResult<T> (*deserialize)(std::string_view)
)
{
    CacheLookup<T> lookup;
    if (!ready()) {
        lookup.error = error_;
        return lookup;
    }
    if (!valid_key(scope, request_key)) {
        lookup.error = "metadata cache keys must be non-empty";
        return lookup;
    }

    Statement statement;
    if (sqlite3_prepare_v2(
            database_,
            "SELECT id, payload, fresh_until, stale_until, payload_version "
            "FROM metadata_cache "
            "WHERE scope_origin = ? AND account_key = ? AND kind = ? "
            "AND request_key = ?",
            -1,
            &statement.value,
            nullptr
        ) != SQLITE_OK ||
        !bind_text(statement.value, 1, scope.origin) ||
        !bind_text(statement.value, 2, scope.account_key) ||
        !bind_text(statement.value, 3, kind) ||
        !bind_text(statement.value, 4, request_key)) {
        lookup.error = sqlite3_errmsg(database_);
        return lookup;
    }
    const int result = sqlite3_step(statement.value);
    if (result == SQLITE_DONE) {
        return lookup;
    }
    if (result != SQLITE_ROW) {
        lookup.error = sqlite3_errmsg(database_);
        return lookup;
    }

    const auto id = sqlite3_column_int64(statement.value, 0);
    const auto* blob = static_cast<const char*>(sqlite3_column_blob(statement.value, 1));
    const auto blob_size = sqlite3_column_bytes(statement.value, 1);
    const auto fresh_until = sqlite3_column_int64(statement.value, 2);
    const auto stale_until = sqlite3_column_int64(statement.value, 3);
    const auto payload_version = sqlite3_column_int64(statement.value, 4);
    if (now_seconds >= stale_until || payload_version != kPayloadVersion) {
        Statement delete_statement;
        if (sqlite3_prepare_v2(
                database_,
                "DELETE FROM metadata_cache WHERE id = ?",
                -1,
                &delete_statement.value,
                nullptr
            ) == SQLITE_OK) {
            sqlite3_bind_int64(delete_statement.value, 1, id);
            sqlite3_step(delete_statement.value);
        }
        return lookup;
    }

    const std::string_view payload(
        blob == nullptr ? "" : blob,
        blob_size < 0 ? 0 : static_cast<std::size_t>(blob_size)
    );
    const auto decoded = deserialize(payload);
    if (!decoded.ok() || !decoded.value.has_value()) {
        Statement delete_statement;
        if (sqlite3_prepare_v2(
                database_,
                "DELETE FROM metadata_cache WHERE id = ?",
                -1,
                &delete_statement.value,
                nullptr
            ) == SQLITE_OK) {
            sqlite3_bind_int64(delete_statement.value, 1, id);
            sqlite3_step(delete_statement.value);
        }
        return lookup;
    }

    Statement touch_statement;
    if (sqlite3_prepare_v2(
            database_,
            "UPDATE metadata_cache SET last_accessed_at = ? WHERE id = ?",
            -1,
            &touch_statement.value,
            nullptr
        ) != SQLITE_OK ||
        sqlite3_bind_int64(touch_statement.value, 1, now_seconds) != SQLITE_OK ||
        sqlite3_bind_int64(touch_statement.value, 2, id) != SQLITE_OK ||
        sqlite3_step(touch_statement.value) != SQLITE_DONE) {
        lookup.error = sqlite3_errmsg(database_);
        return lookup;
    }

    lookup.value = decoded.value;
    lookup.state = now_seconds < fresh_until
        ? CacheState::Fresh
        : CacheState::Stale;
    return lookup;
}

bool MetadataCacheStore::enforce_lru()
{
    Statement statement;
    if (sqlite3_prepare_v2(
            database_,
            "DELETE FROM metadata_cache WHERE id NOT IN ("
            "SELECT id FROM metadata_cache "
            "ORDER BY last_accessed_at DESC, id DESC LIMIT ?"
            ")",
            -1,
            &statement.value,
            nullptr
        ) != SQLITE_OK ||
        sqlite3_bind_int64(
            statement.value,
            1,
            static_cast<sqlite3_int64>(options_.max_entries)
        ) != SQLITE_OK ||
        sqlite3_step(statement.value) != SQLITE_DONE) {
        return set_error(sqlite3_errmsg(database_));
    }
    return true;
}

} // namespace crate::vdj
