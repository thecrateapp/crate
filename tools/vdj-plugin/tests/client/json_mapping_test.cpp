#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/mix_profile.hpp"
#include "crate_vdj/models.hpp"

#include "../support/check.hpp"

#include <string>

using namespace crate::vdj;

namespace {

std::string nested_arrays(int depth)
{
    return std::string(static_cast<std::size_t>(depth), '[') +
        std::string(static_cast<std::size_t>(depth), ']');
}

std::string profile_with(std::string_view field, std::string_view value)
{
    return std::string(R"json({"trackEntityUid":"track-1","profileVersion":1,)json") +
        R"json("profileRevision":"rev","analyzer":"crate-rust",)json" +
        R"json("analyzerVersion":"smart-mix-audio-v2","sourceRevision":"src",)json" +
        R"json("durationMs":180000,"quality":"full","analyzedAt":"2026-10-09T00:00:00Z",)json" +
        "\"" + std::string(field) + "\":" + std::string(value) + "}";
}

} // namespace

int main()
{
    const auto unicode = parse_search_json(
        R"json({"tracks":[{"entity_uid":"t1","title":"Café 🎵","album":null,"genre":null,"futureField":{"nested":[1,2]}}]})json"
    );
    CRATE_CHECK(unicode.ok());
    CRATE_CHECK(unicode.value->tracks.size() == 1);
    CRATE_CHECK(unicode.value->tracks[0].title == "Caf\xc3\xa9 \xf0\x9f\x8e\xb5");
    CRATE_CHECK(unicode.value->tracks[0].album.empty());

    const auto lone_surrogate = parse_search_json(
        R"json({"tracks":[{"entity_uid":"t1","title":"\ud83c"}]})json"
    );
    CRATE_CHECK(!lone_surrogate.ok());
    CRATE_CHECK(lone_surrogate.error_code == ModelErrorCode::InvalidJson);

    const auto malformed = parse_catalog_json(R"json({"folders":[{"id":"a","name":"b"})json");
    CRATE_CHECK(!malformed.ok());
    CRATE_CHECK(malformed.error_code == ModelErrorCode::InvalidJson);

    const auto too_deep = json::parse_bounded(nested_arrays(json::kDefaultLimits.max_depth + 1));
    CRATE_CHECK(!too_deep.ok());
    CRATE_CHECK(json::parse_bounded(nested_arrays(json::kDefaultLimits.max_depth)).ok());

    const std::string oversized(json::kDefaultLimits.max_body_bytes + 1, ' ');
    const auto too_big = json::parse_bounded(oversized);
    CRATE_CHECK(!too_big.ok());
    CRATE_CHECK(too_big.error_code == ModelErrorCode::InvalidResponse);

    std::string many_items = "[";
    for (std::size_t index = 0; index <= json::kDefaultLimits.max_collection_items; ++index) {
        many_items += index == 0 ? "0" : ",0";
    }
    many_items += "]";
    CRATE_CHECK(!json::parse_bounded(many_items).ok());

    CRATE_CHECK(!parse_mix_profile_json(profile_with("bpm", "1e400")).ok());
    CRATE_CHECK(!parse_mix_profile_json(profile_with("introCueMs", "99999999999999999999")).ok());
    CRATE_CHECK(!parse_mix_profile_json(profile_with("bpmConfidence", "1.5")).ok());
    CRATE_CHECK(parse_mix_profile_json(profile_with("bpm", "null")).ok());
    CRATE_CHECK(parse_mix_profile_json(profile_with("integratedLufs", "-9.5")).ok());

    const auto newer_schema = parse_mix_profile_json(
        R"json({"trackEntityUid":"track-1","profileVersion":2,"profileRevision":"rev","analyzer":"crate-rust","analyzerVersion":"smart-mix-audio-v2","sourceRevision":"src","durationMs":1,"quality":"full","analyzedAt":"2026-10-09T00:00:00Z"})json"
    );
    CRATE_CHECK(!newer_schema.ok());
    CRATE_CHECK(newer_schema.error_code == ModelErrorCode::UnsupportedSchema);
}
