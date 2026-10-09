#include "crate_vdj/contract_negotiator.hpp"
#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/version.hpp"

#include "../support/check.hpp"

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
    CRATE_CHECK(accepted.ok());
    CRATE_CHECK(accepted.value->online_source);
    CRATE_CHECK(accepted.value->smart_mix_assistant);
    CRATE_CHECK(!accepted.value->automation);

    const auto incompatible_plugin = negotiate_capabilities(
        supported_capabilities(),
        NegotiationRequirements{
            .plugin_version = "2.0.0",
        }
    );
    CRATE_CHECK(!incompatible_plugin.ok());
    CRATE_CHECK(
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
    CRATE_CHECK(!missing_feature.ok());
    CRATE_CHECK(
        missing_feature.error_code ==
        NegotiationErrorCode::RequiredFeatureUnavailable
    );

    const auto source_only = negotiate_capabilities(
        supported_capabilities(),
        NegotiationRequirements{
            .plugin_version = "1.0.0",
            .profile_schema_version = 2,
        }
    );
    CRATE_CHECK(source_only.ok());
    CRATE_CHECK(source_only.value->online_source);
    CRATE_CHECK(!source_only.value->smart_mix_assistant);
    CRATE_CHECK(!source_only.value->automation);

    const auto profile_mismatch = negotiate_capabilities(
        supported_capabilities(),
        NegotiationRequirements{
            .plugin_version = "1.0.0",
            .require_smart_mix_assistant = true,
            .profile_schema_version = 2,
        }
    );
    CRATE_CHECK(!profile_mismatch.ok());
    CRATE_CHECK(
        profile_mismatch.error_code ==
        NegotiationErrorCode::ProfileSchemaMismatch
    );

    auto planner_changed = supported_capabilities();
    planner_changed.planner_version = "smart-mix-v9";
    const auto planner_source_only = negotiate_capabilities(
        planner_changed,
        NegotiationRequirements{.plugin_version = "1.0.0"}
    );
    CRATE_CHECK(planner_source_only.ok());
    CRATE_CHECK(!planner_source_only.value->smart_mix_assistant);

    auto unknown_contract = supported_capabilities();
    unknown_contract.contract_version = "2099-01";
    const auto contract_mismatch = negotiate_capabilities(
        unknown_contract,
        NegotiationRequirements{.plugin_version = "1.0.0"}
    );
    CRATE_CHECK(!contract_mismatch.ok());
    CRATE_CHECK(contract_mismatch.error_code == NegotiationErrorCode::ContractMismatch);

    auto disabled = supported_capabilities();
    disabled.available = false;
    const auto integration_off = negotiate_capabilities(
        disabled,
        NegotiationRequirements{.plugin_version = "1.0.0"}
    );
    CRATE_CHECK(!integration_off.ok());
    CRATE_CHECK(integration_off.error_code == NegotiationErrorCode::IntegrationUnavailable);

    CRATE_CHECK(NegotiationRequirements{}.plugin_version == kPluginVersion);
    CRATE_CHECK(!kPluginVersion.empty());

    const std::string diagnostic = redact_sensitive(
        "Authorization: Bearer crv_super-secret media_ticket=mt_secret "
        "url=https://api.example/media?media_ticket=mt_secret",
        "crv_super-secret",
        "mt_secret"
    );
    CRATE_CHECK(diagnostic.find("crv_super-secret") == std::string::npos);
    CRATE_CHECK(diagnostic.find("mt_secret") == std::string::npos);
    CRATE_CHECK(diagnostic.find("[REDACTED]") != std::string::npos);
}
