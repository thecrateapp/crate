#include "crate_vdj/contract_negotiator.hpp"
#include "crate_vdj/credential_store.hpp"

#include <cassert>

using namespace crate::vdj;

namespace {

Capabilities supported_capabilities()
{
    return Capabilities{
        .min_plugin_version = "1.0.0",
        .max_plugin_version = "1.x",
        .contract_version = "2026-08",
        .profile_schema_version = 1,
        .planner_version = "smart-mix-v2",
        .online_source = true,
        .smart_mix_assistant = true,
        .automation = false,
    };
}

} // namespace

int main()
{
    const auto accepted = negotiate_capabilities(
        supported_capabilities(),
        NegotiationRequirements{
            .plugin_version = "1.2.0",
            .require_online_source = true,
            .require_smart_mix_assistant = true,
            .require_automation = false,
            .profile_schema_version = 1,
            .planner_version = "smart-mix-v2",
        }
    );
    assert(accepted.ok());
    assert(accepted.value->online_source);
    assert(accepted.value->smart_mix_assistant);
    assert(!accepted.value->automation);

    const auto incompatible_plugin = negotiate_capabilities(
        supported_capabilities(),
        NegotiationRequirements{
            .plugin_version = "2.0.0",
        }
    );
    assert(!incompatible_plugin.ok());
    assert(
        incompatible_plugin.error_code ==
        NegotiationErrorCode::PluginVersionOutOfRange
    );

    auto unsupported_automation = supported_capabilities();
    const auto missing_feature = negotiate_capabilities(
        unsupported_automation,
        NegotiationRequirements{
            .plugin_version = "1.0.0",
            .require_automation = true,
        }
    );
    assert(!missing_feature.ok());
    assert(
        missing_feature.error_code ==
        NegotiationErrorCode::RequiredFeatureUnavailable
    );

    auto wrong_profile = supported_capabilities();
    const auto profile_mismatch = negotiate_capabilities(
        wrong_profile,
        NegotiationRequirements{
            .plugin_version = "1.0.0",
            .profile_schema_version = 2,
        }
    );
    assert(!profile_mismatch.ok());
    assert(
        profile_mismatch.error_code ==
        NegotiationErrorCode::ProfileSchemaMismatch
    );

    const std::string diagnostic = redact_sensitive(
        "Authorization: Bearer crv_super-secret media_ticket=mt_secret "
        "url=https://api.example/media?media_ticket=mt_secret",
        "crv_super-secret",
        "mt_secret"
    );
    assert(diagnostic.find("crv_super-secret") == std::string::npos);
    assert(diagnostic.find("mt_secret") == std::string::npos);
    assert(diagnostic.find("[REDACTED]") != std::string::npos);
}
