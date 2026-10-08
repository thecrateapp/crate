#include "crate_vdj/contract_negotiator.hpp"

#include <charconv>
#include <string>
#include <string_view>

namespace crate::vdj {
namespace {

struct Version {
    int major = 0;
    int minor = 0;
    int patch = 0;
};

bool parse_version(std::string_view input, Version& output)
{
    const auto first_dot = input.find('.');
    if (first_dot == std::string_view::npos) {
        return false;
    }
    const auto second_dot = input.find('.', first_dot + 1);
    const auto major_part = input.substr(0, first_dot);
    const auto minor_part = input.substr(
        first_dot + 1,
        second_dot == std::string_view::npos
            ? std::string_view::npos
            : second_dot - first_dot - 1
    );
    const auto patch_part = second_dot == std::string_view::npos
        ? std::string_view("0")
        : input.substr(second_dot + 1);

    const auto parse_number = [](std::string_view part, int& value) {
        if (part.empty() || part == "x") {
            return false;
        }
        const auto parsed = std::from_chars(
            part.data(),
            part.data() + part.size(),
            value
        );
        return parsed.ec == std::errc{} && parsed.ptr == part.data() + part.size();
    };

    return parse_number(major_part, output.major) &&
           parse_number(minor_part, output.minor) &&
           parse_number(patch_part, output.patch);
}

bool is_within_range(
    std::string_view plugin_version,
    std::string_view minimum,
    std::string_view maximum
)
{
    Version plugin;
    Version lower;
    if (!parse_version(plugin_version, plugin) ||
        !parse_version(minimum, lower)) {
        return false;
    }
    if (plugin.major < lower.major ||
        (plugin.major == lower.major && plugin.minor < lower.minor) ||
        (plugin.major == lower.major && plugin.minor == lower.minor &&
         plugin.patch < lower.patch)) {
        return false;
    }

    if (maximum == "1.x") {
        return plugin.major == 1;
    }

    Version upper;
    if (!parse_version(maximum, upper)) {
        return false;
    }
    return plugin.major < upper.major ||
           (plugin.major == upper.major && plugin.minor < upper.minor) ||
           (plugin.major == upper.major && plugin.minor == upper.minor &&
            plugin.patch <= upper.patch);
}

NegotiationResult failure(NegotiationErrorCode code, std::string message)
{
    return NegotiationResult{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
    };
}

} // namespace

NegotiationResult negotiate_capabilities(
    const Capabilities& capabilities,
    const NegotiationRequirements& requirements
)
{
    if (!is_within_range(
            requirements.plugin_version,
            capabilities.min_plugin_version,
            capabilities.max_plugin_version
        )) {
        return failure(
            NegotiationErrorCode::PluginVersionOutOfRange,
            "plugin version is outside the server compatibility range"
        );
    }
    if (capabilities.contract_version.empty()) {
        return failure(
            NegotiationErrorCode::ContractMismatch,
            "server contract version is missing"
        );
    }
    if (capabilities.profile_schema_version != requirements.profile_schema_version) {
        return failure(
            NegotiationErrorCode::ProfileSchemaMismatch,
            "profile schema is incompatible"
        );
    }
    if (capabilities.planner_version != requirements.planner_version) {
        return failure(
            NegotiationErrorCode::PlannerMismatch,
            "planner version is incompatible"
        );
    }
    if ((requirements.require_online_source && !capabilities.online_source) ||
        (requirements.require_smart_mix_assistant &&
         !capabilities.smart_mix_assistant) ||
        (requirements.require_automation && !capabilities.automation)) {
        return failure(
            NegotiationErrorCode::RequiredFeatureUnavailable,
            "a required VirtualDJ feature is unavailable"
        );
    }
    return NegotiationResult{
        .value = capabilities,
        .error_code = NegotiationErrorCode::ContractMismatch,
        .error = {},
    };
}

} // namespace crate::vdj
