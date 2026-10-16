#include "crate_vdj/connection_session.hpp"

#include "../support/check.hpp"
#include "../support/connection_fakes.hpp"
#include "../support/scripted_http.hpp"

#include <chrono>
#include <future>
#include <thread>
#include <map>
#include <memory>
#include <optional>
#include <string>

using namespace crate::vdj;
using namespace crate::vdj::testing;
using namespace std::chrono_literals;

namespace {

struct Harness {
    std::shared_ptr<SharedVault> vault = std::make_shared<SharedVault>();
    MemorySettingsStore settings;
    ScriptedHttpClient http;

    ConnectionSession session(std::chrono::seconds refresh = 600s)
    {
        return ConnectionSession(
            settings,
            [vault = vault](const std::string& account) {
                return std::make_unique<VaultCredentialStore>(vault, account);
            },
            http,
            refresh
        );
    }
};

const auto kStart = std::chrono::steady_clock::time_point{} + 1h;

void unconfigured_install_stays_offline()
{
    Harness harness;
    auto session = harness.session();

    const auto status = session.restore(kStart, CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Disconnected);
    CRATE_CHECK(harness.http.requests.empty());
    CRATE_CHECK(harness.vault->loads == 0);
    CRATE_CHECK(!session.logged_in());
    CRATE_CHECK(session.credentials() == nullptr);
}

void invalid_origin_is_rejected_without_network()
{
    Harness harness;
    auto session = harness.session();

    const auto result = session.connect("http://api.example.org", "crv_valid", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::InvalidOrigin);
    CRATE_CHECK(harness.http.requests.empty());
    CRATE_CHECK(!harness.settings.origin.has_value());
}

void empty_token_is_rejected_without_network()
{
    Harness harness;
    auto session = harness.session();

    CRATE_CHECK(session.connect(kOrigin, "  ", kStart, CancellationToken{}).error == ConnectError::MissingToken);
    CRATE_CHECK(harness.http.requests.empty());
}

void rejected_token_is_not_saved()
{
    Harness harness;
    harness.http.fail("/api/auth/me", 401);
    auto session = harness.session();

    const auto result = session.connect(kOrigin, "crv_revoked", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::Rejected);
    CRATE_CHECK(result.status.state == ConnectionState::Unauthorized);
    CRATE_CHECK(harness.vault->tokens.empty());
    CRATE_CHECK(!harness.settings.origin.has_value());
    CRATE_CHECK(!session.logged_in());
}

void verified_token_is_saved_per_origin()
{
    Harness harness;
    harness.http.serve_connected();
    auto session = harness.session();

    const auto result = session.connect("https://API.example.org/", "crv_valid", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::None);
    CRATE_CHECK(session.logged_in());
    CRATE_CHECK(harness.settings.origin == kOrigin);
    CRATE_CHECK(harness.vault->tokens.at(credential_account_for_origin(kOrigin)) == "crv_valid");
    CRATE_CHECK(session.origin() == kOrigin);
    CRATE_CHECK(session.credentials() != nullptr);
    CRATE_CHECK(session.credentials()->load_token() == "crv_valid");
}

void credential_write_failure_is_surfaced()
{
    Harness harness;
    harness.http.serve_connected();
    harness.vault->fail_writes = true;
    auto session = harness.session();

    const auto result = session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::CredentialWriteFailed);
    CRATE_CHECK(!session.logged_in());
    CRATE_CHECK(!harness.settings.origin.has_value());
}

void settings_write_failure_removes_the_saved_token()
{
    Harness harness;
    harness.http.serve_connected();
    harness.settings.fail_writes = true;
    auto session = harness.session();

    const auto result = session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::SettingsWriteFailed);
    CRATE_CHECK(harness.vault->tokens.empty());
    CRATE_CHECK(!session.logged_in());
}

void rotation_replaces_the_token()
{
    Harness harness;
    harness.http.serve_connected();
    auto session = harness.session();
    session.connect(kOrigin, "crv_old", kStart, CancellationToken{});

    const auto result = session.connect(kOrigin, "crv_new", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::None);
    CRATE_CHECK(harness.vault->tokens.at(credential_account_for_origin(kOrigin)) == "crv_new");
    CRATE_CHECK(session.credentials()->load_token() == "crv_new");
}

void changing_server_clears_the_previous_credential()
{
    Harness harness;
    harness.http.serve_connected();
    const std::string other = "https://other.example.org";
    harness.http.responses[other + "/api/auth/me"] = HttpResponse{.status_code = 200, .body = me_json()};
    harness.http.responses[other + "/api/capabilities"] =
        HttpResponse{.status_code = 200, .body = capabilities_json()};
    auto session = harness.session();
    session.connect(kOrigin, "crv_first", kStart, CancellationToken{});

    const auto result = session.connect(other, "crv_second", kStart, CancellationToken{});

    CRATE_CHECK(result.error == ConnectError::None);
    CRATE_CHECK(harness.settings.origin == other);
    CRATE_CHECK(!harness.vault->tokens.contains(credential_account_for_origin(kOrigin)));
    CRATE_CHECK(harness.vault->tokens.at(credential_account_for_origin(other)) == "crv_second");
}

void restore_reads_the_vault_once()
{
    Harness harness;
    harness.http.serve_connected();
    harness.settings.origin = kOrigin;
    harness.vault->tokens[credential_account_for_origin(kOrigin)] = "crv_saved";
    auto session = harness.session();

    const auto status = session.restore(kStart, CancellationToken{});
    session.credentials()->load_token();
    session.credentials()->load_token();

    CRATE_CHECK(status.state == ConnectionState::Connected);
    CRATE_CHECK(harness.vault->loads == 1);
}

void restore_without_a_saved_token_needs_login()
{
    Harness harness;
    harness.settings.origin = kOrigin;
    auto session = harness.session();

    const auto status = session.restore(kStart, CancellationToken{});

    CRATE_CHECK(status.state == ConnectionState::Unauthorized);
    CRATE_CHECK(harness.http.requests.empty());
}

void refresh_is_bounded_and_follows_flags()
{
    Harness harness;
    harness.http.serve_connected(true);
    auto session = harness.session(600s);
    session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});
    CRATE_CHECK(session.status().features.automation);
    const auto requests_after_connect = harness.http.requests.size();

    session.refresh_if_due(kStart + 60s, CancellationToken{});
    CRATE_CHECK(harness.http.requests.size() == requests_after_connect);

    harness.http.serve("/api/capabilities", capabilities_json(true, "2026-08", false));
    const auto refreshed = session.refresh_if_due(kStart + 601s, CancellationToken{});

    CRATE_CHECK(harness.http.requests.size() > requests_after_connect);
    CRATE_CHECK(refreshed.state == ConnectionState::Connected);
    CRATE_CHECK(!refreshed.features.automation);
}

void revoked_token_on_refresh_logs_out()
{
    Harness harness;
    harness.http.serve_connected();
    auto session = harness.session(600s);
    session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});

    harness.http.fail("/api/auth/me", 401);
    const auto refreshed = session.refresh_if_due(kStart + 601s, CancellationToken{});

    CRATE_CHECK(refreshed.state == ConnectionState::Unauthorized);
    CRATE_CHECK(!session.logged_in());
    CRATE_CHECK(session.origin() == kOrigin);
}

void transient_failure_on_refresh_keeps_the_session()
{
    Harness harness;
    harness.http.serve_connected();
    auto session = harness.session(600s);
    session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});

    harness.http.responses.clear();
    const auto refreshed = session.refresh_if_due(kStart + 601s, CancellationToken{});

    CRATE_CHECK(refreshed.state == ConnectionState::Connected);
    CRATE_CHECK(session.logged_in());
}

void disconnect_forgets_everything()
{
    Harness harness;
    harness.http.serve_connected();
    auto session = harness.session();
    session.connect(kOrigin, "crv_valid", kStart, CancellationToken{});

    CRATE_CHECK(session.disconnect());

    CRATE_CHECK(!session.logged_in());
    CRATE_CHECK(harness.vault->tokens.empty());
    CRATE_CHECK(!harness.settings.origin.has_value());
    CRATE_CHECK(session.credentials() == nullptr);
    CRATE_CHECK(session.status().state == ConnectionState::Disconnected);
}

void session_reads_stay_responsive_during_a_check()
{
    Harness harness;
    harness.settings.origin = kOrigin;
    harness.vault->tokens[credential_account_for_origin(kOrigin)] = "crv_saved";
    GatedHttpClient gated;
    gated.blocked_prefix = kOrigin;
    ConnectionSession session(
        harness.settings,
        [vault = harness.vault](const std::string& account) {
            return std::make_unique<VaultCredentialStore>(vault, account);
        },
        gated
    );
    CancellationSource cancellation;
    auto restoring = std::async(std::launch::async, [&] {
        return session.restore(kStart, cancellation.token());
    });
    CRATE_CHECK(gated.wait_until_blocked());

    auto reading = std::async(std::launch::async, [&] {
        return std::make_pair(session.logged_in(), session.origin());
    });
    const bool answered = reading.wait_for(200ms) == std::future_status::ready;
    cancellation.cancel();
    static_cast<void>(restoring.get());

    CRATE_CHECK(answered);
    const auto [logged_in, origin] = reading.get();
    CRATE_CHECK(!logged_in);
    CRATE_CHECK(origin == kOrigin);
}

void cancelled_connect_persists_nothing()
{
    Harness harness;
    harness.http.serve_connected();
    CancellationSource cancellation;

    class CancelAfterVerification final : public HttpClient {
    public:
        CancelAfterVerification(HttpClient& inner, CancellationSource& source)
            : inner_(inner), source_(source)
        {
        }

        HttpResult request(const HttpRequest& request) override
        {
            auto result = inner_.request(request);
            if (request.url.ends_with("/api/capabilities")) {
                source_.cancel();
            }
            return result;
        }

    private:
        HttpClient& inner_;
        CancellationSource& source_;
    } http(harness.http, cancellation);

    ConnectionSession session(
        harness.settings,
        [vault = harness.vault](const std::string& account) {
            return std::make_unique<VaultCredentialStore>(vault, account);
        },
        http
    );

    const auto result = session.connect(kOrigin, "crv_valid", kStart, cancellation.token());

    CRATE_CHECK(result.error == ConnectError::Cancelled);
    CRATE_CHECK(harness.vault->tokens.empty());
    CRATE_CHECK(!harness.settings.origin.has_value());
    CRATE_CHECK(!session.logged_in());
}

} // namespace

int main()
{
    unconfigured_install_stays_offline();
    invalid_origin_is_rejected_without_network();
    empty_token_is_rejected_without_network();
    rejected_token_is_not_saved();
    verified_token_is_saved_per_origin();
    credential_write_failure_is_surfaced();
    settings_write_failure_removes_the_saved_token();
    rotation_replaces_the_token();
    changing_server_clears_the_previous_credential();
    restore_reads_the_vault_once();
    restore_without_a_saved_token_needs_login();
    refresh_is_bounded_and_follows_flags();
    revoked_token_on_refresh_logs_out();
    transient_failure_on_refresh_keeps_the_session();
    disconnect_forgets_everything();
    session_reads_stay_responsive_during_a_check();
    cancelled_connect_persists_nothing();
}
