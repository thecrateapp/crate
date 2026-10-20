#pragma once

#include "crate_vdj/mix_profile.hpp"
#include "crate_vdj/models.hpp"
#include "crate_vdj/version.hpp"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace crate::vdj {

enum class NegotiationErrorCode {
    IntegrationUnavailable,
    PluginVersionOutOfRange,
    ContractMismatch,
    ProfileSchemaMismatch,
    PlannerMismatch,
    RequiredFeatureUnavailable,
};

struct NegotiationRequirements {
    std::string plugin_version = std::string(kPluginVersion);
    std::vector<std::string> supported_contract_versions = {"2026-08"};
    bool require_online_source = false;
    bool require_smart_mix_assistant = false;
    bool require_automation = false;
    int profile_schema_version = 1;
    std::string planner_version = std::string(kSmartMixPlannerVersion);
};

struct NegotiationResult {
    std::optional<Capabilities> value;
    NegotiationErrorCode error_code = NegotiationErrorCode::ContractMismatch;
    std::string error;

    bool ok() const
    {
        return value.has_value();
    }
};

NegotiationResult negotiate_capabilities(
    const Capabilities& capabilities,
    const NegotiationRequirements& requirements
);

} // namespace crate::vdj
