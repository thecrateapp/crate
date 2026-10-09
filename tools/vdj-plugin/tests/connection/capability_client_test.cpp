#include "crate_vdj/capability_client.hpp"

#include "../support/check.hpp"
#include "../support/scripted_http.hpp"

#include <string>

using namespace crate::vdj;
using namespace crate::vdj::testing;

namespace {

void connected_token_exposes_identity_and_features()
{
    ScriptedHttpClient http;
    http.serve_connected(true);
    CapabilityClient client(http, kOrigin);

    const auto status = client.check("crv_valid", CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Connected);
    CRATE_CHECK(status.identity.username == "dj");
    CRATE_CHECK(status.features.online_source);
    CRATE_CHECK(status.features.smart_mix_assistant);
    CRATE_CHECK(status.features.automation);
    CRATE_CHECK(http.requests.size() == 2);
    for (const auto& request : http.requests) {
        CRATE_CHECK(request.allowed_origin == kOrigin);
        bool bearer = false;
        for (const auto& [name, value] : request.headers) {
            bearer = bearer || (name == "Authorization" && value == "Bearer crv_valid");
        }
        CRATE_CHECK(bearer);
    }
}

void rejected_token_asks_for_reconnection()
{
    ScriptedHttpClient http;
    http.fail("/api/auth/me", 401);
    CapabilityClient client(http, kOrigin);

    const auto status = client.check("crv_revoked", CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Unauthorized);
    CRATE_CHECK(!status.features.online_source);
    CRATE_CHECK(http.requests.size() == 1);
}

void session_tokens_are_not_plugin_tokens()
{
    ScriptedHttpClient http;
    http.serve(
        "/api/auth/me",
        R"({"id":7,"email":"dj@example.org","name":"DJ","username":"dj","role":"user"})"
    );
    CapabilityClient client(http, kOrigin);

    CRATE_CHECK(client.check("jwt-session", CancellationToken{}).state == ConnectionState::Unauthorized);
}

void missing_catalog_scopes_disable_the_source()
{
    ScriptedHttpClient http;
    http.serve("/api/auth/me", me_json(R"(["vdj.smart_mix.read"])"));
    http.serve(
        "/api/capabilities",
        capabilities_json(true, "2026-08", false, R"(["vdj.smart_mix.read"])")
    );
    CapabilityClient client(http, kOrigin);

    const auto status = client.check("crv_limited", CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::MissingScopes);
    CRATE_CHECK(!status.features.online_source);
}

void incompatible_contract_is_reported()
{
    ScriptedHttpClient http;
    http.serve("/api/auth/me", me_json());
    http.serve("/api/capabilities", capabilities_json(true, "2099-01"));
    CapabilityClient client(http, kOrigin);

    CRATE_CHECK(client.check("crv_valid", CancellationToken{}).state == ConnectionState::Incompatible);
}

void disabled_integration_is_reported()
{
    ScriptedHttpClient http;
    http.serve("/api/auth/me", me_json());
    http.serve("/api/capabilities", capabilities_json(false));
    CapabilityClient client(http, kOrigin);

    CRATE_CHECK(client.check("crv_valid", CancellationToken{}).state == ConnectionState::ServerDisabled);
}

void transport_failures_are_unreachable()
{
    ScriptedHttpClient http;
    CapabilityClient client(http, kOrigin);

    CRATE_CHECK(client.check("crv_valid", CancellationToken{}).state == ConnectionState::Unreachable);
}

void automation_requires_the_token_grant()
{
    ScriptedHttpClient http;
    http.serve("/api/auth/me", me_json());
    http.serve("/api/capabilities", capabilities_json(true, "2026-08", false));
    CapabilityClient client(http, kOrigin);

    const auto status = client.check("crv_valid", CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Connected);
    CRATE_CHECK(!status.features.automation);
}

void null_profile_fields_are_accepted()
{
    ScriptedHttpClient http;
    http.serve(
        "/api/auth/me",
        R"({"id":7,"email":null,"name":null,"username":"dj","role":"user",)"
        R"("auth_type":"access_token","scopes":["vdj.catalog.read","vdj.media.read"],"capabilities":[]})"
    );
    http.serve("/api/capabilities", capabilities_json());
    CapabilityClient client(http, kOrigin);

    const auto status = client.check("crv_valid", CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Connected);
    CRATE_CHECK(!status.features.smart_mix_assistant);
}

void malformed_capabilities_are_incompatible()
{
    ScriptedHttpClient http;
    http.serve("/api/auth/me", me_json());
    http.serve("/api/capabilities", "{not json");
    CapabilityClient client(http, kOrigin);

    CRATE_CHECK(client.check("crv_valid", CancellationToken{}).state == ConnectionState::Incompatible);
}

} // namespace

int main()
{
    connected_token_exposes_identity_and_features();
    rejected_token_asks_for_reconnection();
    session_tokens_are_not_plugin_tokens();
    missing_catalog_scopes_disable_the_source();
    incompatible_contract_is_reported();
    disabled_integration_is_reported();
    transport_failures_are_unreachable();
    automation_requires_the_token_grant();
    null_profile_fields_are_accepted();
    malformed_capabilities_are_incompatible();
}
