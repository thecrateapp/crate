#include "crate_vdj/core.hpp"
#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/mix_profile.hpp"

#include <limits>
#include <set>
#include <string_view>

#include <utility>

namespace crate::vdj {
namespace {

bool read_capability_fields(
    const json::Value& object,
    Capabilities& result,
    std::set<std::string_view>& found
)
{
    const auto read_string = [&](std::string_view name, std::string& output, bool required) {
        const auto* value = json::member(object, name);
        if (value == nullptr) {
            return true;
        }
        if (!value->is_string()) {
            return false;
        }
        output = value->get<std::string>();
        if (required) {
            found.insert(name);
        }
        return true;
    };
    const auto read_bool = [&](std::string_view name, bool& output, bool required) {
        const auto* value = json::member(object, name);
        if (value == nullptr) {
            return true;
        }
        if (!value->is_boolean()) {
            return false;
        }
        output = value->get<bool>();
        if (required) {
            found.insert(name);
        }
        return true;
    };

    std::int64_t profile_schema_version = 0;
    if (json::member(object, "profile_schema_version") != nullptr) {
        if (!json::required_integer(
                object,
                "profile_schema_version",
                profile_schema_version,
                0,
                std::numeric_limits<int>::max()
            )) {
            return false;
        }
        result.profile_schema_version = static_cast<int>(profile_schema_version);
        found.insert("profile_schema_version");
    }
    return read_string("min_plugin_version", result.min_plugin_version, false) &&
        read_string("max_plugin_version", result.max_plugin_version, false) &&
        read_string("contract_version", result.contract_version, true) &&
        read_string("planner_version", result.planner_version, true) &&
        read_bool("available", result.available, false) &&
        read_bool("online_source", result.online_source, true) &&
        read_bool("smart_mix_assistant", result.smart_mix_assistant, true) &&
        read_bool("automation", result.automation, true);
}

} // namespace

ParseResult<Capabilities> parse_capabilities_json(std::string_view body)
{
    auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return json::failure<Capabilities>(parsed.error_code, parsed.error);
    }
    const auto& root = *parsed.value;

    Capabilities result;
    std::set<std::string_view> found;
    if (!read_capability_fields(root, result, found)) {
        return json::failure<Capabilities>(ModelErrorCode::InvalidField, "invalid capability field");
    }
    if (const auto* vdj = json::member(root, "vdj"); vdj != nullptr) {
        if (!vdj->is_object() || !read_capability_fields(*vdj, result, found)) {
            return json::failure<Capabilities>(ModelErrorCode::InvalidField, "invalid vdj capabilities");
        }
    }
    if (found.size() < 6) {
        return json::failure<Capabilities>(ModelErrorCode::MissingField, "required field missing");
    }
    if (result.profile_schema_version != kSmartMixProfileVersion) {
        return json::failure<Capabilities>(
            ModelErrorCode::UnsupportedSchema,
            "unsupported profile schema"
        );
    }
    if (result.contract_version.empty() || result.planner_version.empty()) {
        return json::failure<Capabilities>(ModelErrorCode::InvalidField, "empty version field");
    }
    return json::success(std::move(result));
}

bool CompletionOnce::try_complete()
{
    bool expected = false;
    return completed_.compare_exchange_strong(
        expected,
        true,
        std::memory_order_acq_rel
    );
}

} // namespace crate::vdj
