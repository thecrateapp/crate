#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/models.hpp"
#include "track_json.hpp"

namespace crate::vdj {

ParseResult<CatalogResults> parse_catalog_json(std::string_view body)
{
    auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return json::failure<CatalogResults>(parsed.error_code, parsed.error);
    }
    const auto& root = *parsed.value;
    const auto invalid = [](std::string message) {
        return json::failure<CatalogResults>(ModelErrorCode::InvalidField, std::move(message));
    };

    CatalogResults results;
    if (const auto* folders = json::member(root, "folders");
        folders != nullptr && !folders->is_null()) {
        if (!folders->is_array()) {
            return invalid("catalog folders must be an array");
        }
        for (const auto& item : *folders) {
            CatalogFolder folder;
            if (!json::required_string(item, "id", folder.id) ||
                !json::required_string(item, "name", folder.name)) {
                return invalid("invalid catalog folder");
            }
            results.folders.push_back(std::move(folder));
        }
    }

    if (const auto* tracks = json::member(root, "tracks");
        tracks != nullptr && !tracks->is_null()) {
        if (!tracks->is_array()) {
            return invalid("catalog tracks must be an array");
        }
        for (const auto& item : *tracks) {
            SearchTrack track;
            if (!detail::parse_track_json(item, track)) {
                return invalid("invalid catalog track");
            }
            results.tracks.push_back(std::move(track));
        }
    }

    std::optional<std::string> next_cursor;
    if (!json::optional_string(root, "next_cursor", next_cursor)) {
        return invalid("invalid catalog cursor");
    }
    results.next_cursor = std::move(next_cursor);
    return json::success(std::move(results));
}

} // namespace crate::vdj
