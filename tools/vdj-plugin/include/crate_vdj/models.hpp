#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace crate::vdj {

enum class ModelErrorCode {
    InvalidJson,
    InvalidResponse,
    MissingField,
    InvalidField,
    UnsupportedSchema,
    TransportError,
};

template <typename T>
struct ParseResult {
    std::optional<T> value;
    ModelErrorCode error_code = ModelErrorCode::InvalidJson;
    std::string error;

    bool ok() const
    {
        return value.has_value();
    }
};

struct Capabilities {
    std::string min_plugin_version;
    std::string max_plugin_version;
    std::string contract_version;
    int profile_schema_version = 0;
    std::string planner_version;
    bool online_source = false;
    bool smart_mix_assistant = false;
    bool automation = false;
};

ParseResult<Capabilities> parse_capabilities_json(std::string_view json);

struct SearchArtist {
    std::string entity_uid;
    std::string name;
    std::string slug;
};

struct SearchAlbum {
    std::string entity_uid;
    std::string name;
    std::string artist;
};

struct SearchTrack {
    std::string entity_uid;
    std::string title;
    std::string artist;
    std::string album;
    std::string path;
    double duration_seconds = 0;
    int year = 0;
    std::string genre;
    double bpm = 0;
    std::string audio_key;
    std::string audio_scale;
    bool has_cover = false;
    std::string cover_url;
};

struct SearchResults {
    std::vector<SearchArtist> artists;
    std::vector<SearchAlbum> albums;
    std::vector<SearchTrack> tracks;
};

ParseResult<SearchResults> parse_search_json(std::string_view json);

struct CatalogFolder {
    std::string id;
    std::string name;
};

struct CatalogResults {
    std::vector<CatalogFolder> folders;
    std::vector<SearchTrack> tracks;
    std::optional<std::string> next_cursor;
};

ParseResult<CatalogResults> parse_catalog_json(std::string_view json);

} // namespace crate::vdj
