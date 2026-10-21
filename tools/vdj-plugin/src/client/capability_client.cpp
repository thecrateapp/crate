#include "crate_vdj/capability_client.hpp"

#include "crate_vdj/contract_negotiator.hpp"
#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/models.hpp"

#include <algorithm>
#include <optional>
#include <utility>
#include <variant>

namespace crate::vdj {
namespace {

constexpr std::string_view kCatalogScope = "vdj.catalog.read";
constexpr std::string_view kMediaScope = "vdj.media.read";
constexpr std::string_view kSmartMixScope = "vdj.smart_mix.read";

ConnectionStatus status_of(ConnectionState state, std::string message)
{
    ConnectionStatus status;
    status.state = state;
    status.message = std::move(message);
    return status;
}

bool has_scope(const std::vector<std::string>& scopes, std::string_view scope)
{
    return std::find(scopes.begin(), scopes.end(), scope) != scopes.end();
}

struct Fetched {
    std::optional<std::string> body;
    ConnectionStatus failure;
};

Fetched fetch(
    HttpClient& http,
    const std::string& origin,
    std::string_view path,
    std::string_view token,
    const CancellationToken& cancellation
)
{
    const auto response = http.request(HttpRequest{
        .method = "GET",
        .url = origin + std::string(path),
        .allowed_origin = origin,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + std::string(token)},
        },
        .cancellation = cancellation,
    });
    if (const auto* error = std::get_if<HttpError>(&response)) {
        if (error->code == HttpErrorCode::HttpStatus &&
            (error->status_code == 401 || error->status_code == 403)) {
            return {std::nullopt, status_of(ConnectionState::Unauthorized, "token rejected")};
        }
        if (error->code == HttpErrorCode::HttpStatus && error->status_code == 404) {
            return {std::nullopt, status_of(ConnectionState::Incompatible, "server lacks the plugin API")};
        }
        return {std::nullopt, status_of(ConnectionState::Unreachable, error->message)};
    }
    return {std::get<HttpResponse>(response).body, {}};
}

std::optional<ConnectionIdentity> parse_identity(std::string_view body)
{
    const auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return std::nullopt;
    }
    const auto& root = *parsed.value;
    std::string auth_type;
    if (!json::optional_string(root, "auth_type", auth_type) || auth_type != "access_token") {
        return std::nullopt;
    }
    ConnectionIdentity identity;
    if (!json::optional_string(root, "username", identity.username) ||
        !json::optional_string(root, "name", identity.name) ||
        !json::optional_string(root, "email", identity.email)) {
        return std::nullopt;
    }
    const auto* scopes = json::member(root, "scopes");
    if (scopes == nullptr || !scopes->is_array()) {
        return std::nullopt;
    }
    for (const auto& scope : *scopes) {
        if (!scope.is_string()) {
            return std::nullopt;
        }
        identity.scopes.push_back(scope.get<std::string>());
    }
    return identity;
}

bool token_automation_granted(std::string_view body)
{
    const auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return false;
    }
    const auto* section = json::member(*parsed.value, "access_token");
    bool automation = false;
    return section != nullptr && section->is_object() &&
        json::optional_boolean(*section, "automation", automation) && automation;
}

} // namespace

CapabilityClient::CapabilityClient(HttpClient& http, std::string origin)
    : http_(http), origin_(std::move(origin))
{
}

ConnectionStatus CapabilityClient::check(
    std::string_view token,
    const CancellationToken& cancellation
)
{
    auto me = fetch(http_, origin_, "/api/auth/me", token, cancellation);
    if (!me.body.has_value()) {
        return me.failure;
    }
    auto identity = parse_identity(*me.body);
    if (!identity.has_value()) {
        return status_of(ConnectionState::Unauthorized, "not a VirtualDJ access token");
    }

    auto capabilities_body =
        fetch(http_, origin_, "/api/capabilities", token, cancellation);
    if (!capabilities_body.body.has_value()) {
        return capabilities_body.failure;
    }
    const auto capabilities = parse_capabilities_json(*capabilities_body.body);
    if (!capabilities.ok()) {
        return status_of(ConnectionState::Incompatible, capabilities.error);
    }
    if (!capabilities.value->available) {
        return status_of(ConnectionState::ServerDisabled, "VirtualDJ is disabled on this server");
    }
    const auto negotiated = negotiate_capabilities(*capabilities.value, NegotiationRequirements{});
    if (!negotiated.ok()) {
        return status_of(
            negotiated.error_code == NegotiationErrorCode::IntegrationUnavailable
                ? ConnectionState::ServerDisabled
                : ConnectionState::Incompatible,
            negotiated.error
        );
    }

    ConnectionStatus status;
    status.identity = std::move(*identity);
    const auto& scopes = status.identity.scopes;
    const auto& effective = *negotiated.value;
    status.features.online_source = effective.online_source &&
        has_scope(scopes, kCatalogScope) && has_scope(scopes, kMediaScope);
    status.features.smart_mix_assistant =
        effective.smart_mix_assistant && has_scope(scopes, kSmartMixScope);
    status.features.automation =
        effective.automation && token_automation_granted(*capabilities_body.body);
    if (!effective.online_source) {
        status.state = ConnectionState::ServerDisabled;
        status.message = "the server does not offer the Online Source";
    } else if (!status.features.online_source) {
        status.state = ConnectionState::MissingScopes;
        status.message = "the token cannot browse or play the library";
    } else {
        status.state = ConnectionState::Connected;
    }
    return status;
}

} // namespace crate::vdj
