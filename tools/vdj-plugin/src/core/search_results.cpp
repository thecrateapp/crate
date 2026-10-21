#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/models.hpp"
#include "track_json.hpp"

#include <charconv>
#include <limits>

namespace crate::vdj {
namespace detail {
namespace {

bool year_field(const json::Value& item, int& output)
{
    const auto* value = json::member(item, "year");
    if (value == nullptr || value->is_null()) {
        return true;
    }
    if (value->is_string()) {
        const auto text = value->get<std::string>();
        if (text.empty()) {
            return false;
        }
        const auto parsed = std::from_chars(text.data(), text.data() + text.size(), output);
        return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size();
    }
    std::optional<std::int64_t> year;
    if (!json::optional_integer(
            item,
            "year",
            year,
            std::numeric_limits<int>::min(),
            std::numeric_limits<int>::max()
        )) {
        return false;
    }
    output = year.has_value() ? static_cast<int>(*year) : 0;
    return true;
}

} // namespace

bool parse_track_json(const json::Value& item, SearchTrack& track)
{
    return item.is_object() &&
        json::required_string(item, "entity_uid", track.entity_uid) &&
        json::required_string(item, "title", track.title) &&
        json::optional_string(item, "artist", track.artist) &&
        json::optional_string(item, "album", track.album) &&
        json::optional_string(item, "path", track.path) &&
        json::optional_number(item, "duration", track.duration_seconds) &&
        year_field(item, track.year) &&
        json::optional_string(item, "genre", track.genre) &&
        json::optional_number(item, "bpm", track.bpm) &&
        json::optional_string(item, "audio_key", track.audio_key) &&
        json::optional_string(item, "audio_scale", track.audio_scale) &&
        json::optional_boolean(item, "has_cover", track.has_cover) &&
        json::optional_string(item, "cover_url", track.cover_url);
}

} // namespace detail

namespace {

template <typename Item, typename Parse>
bool parse_array(
    const json::Value& root,
    std::string_view name,
    std::vector<Item>& output,
    Parse parse_item
)
{
    const auto* value = json::member(root, name);
    if (value == nullptr || value->is_null()) {
        return true;
    }
    if (!value->is_array()) {
        return false;
    }
    output.reserve(value->size());
    for (const auto& element : *value) {
        Item item;
        if (!parse_item(element, item)) {
            return false;
        }
        output.push_back(std::move(item));
    }
    return true;
}

} // namespace

ParseResult<SearchResults> parse_search_json(std::string_view body)
{
    auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return json::failure<SearchResults>(parsed.error_code, parsed.error);
    }
    const auto& root = *parsed.value;

    SearchResults results;
    const bool valid =
        parse_array(root, "artists", results.artists, [](const json::Value& item, SearchArtist& artist) {
            return json::required_string(item, "entity_uid", artist.entity_uid) &&
                json::required_string(item, "name", artist.name) &&
                json::optional_string(item, "slug", artist.slug);
        }) &&
        parse_array(root, "albums", results.albums, [](const json::Value& item, SearchAlbum& album) {
            return json::required_string(item, "entity_uid", album.entity_uid) &&
                json::required_string(item, "name", album.name) &&
                json::optional_string(item, "artist", album.artist);
        }) &&
        parse_array(root, "tracks", results.tracks, detail::parse_track_json);
    if (!valid) {
        return json::failure<SearchResults>(
            ModelErrorCode::InvalidField,
            "invalid search result field"
        );
    }
    return json::success(std::move(results));
}

} // namespace crate::vdj
