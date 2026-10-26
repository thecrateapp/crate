#include "crate_vdj/connection_worker.hpp"

#include "../support/check.hpp"
#include "../support/connection_fakes.hpp"
#include "../support/scripted_http.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

using namespace crate::vdj;
using namespace crate::vdj::testing;
using namespace std::chrono_literals;

namespace {

constexpr const char* kOtherOrigin = "https://other.example.org";

struct Harness {
    std::shared_ptr<SharedVault> vault = std::make_shared<SharedVault>();
    MemorySettingsStore settings;
    GatedHttpClient http;
    ConnectionSession session{
        settings,
        [vault = vault](const std::string& account) {
            return std::make_unique<VaultCredentialStore>(vault, account);
        },
        http,
    };
    std::mutex mutex;
    std::condition_variable changed;
    std::vector<ConnectResult> connects;
    std::atomic<int> changes = 0;

    std::unique_ptr<ConnectionWorker> worker()
    {
        return std::make_unique<ConnectionWorker>(
            session,
            [this] { ++changes; },
            [this](const ConnectResult& result) {
                {
                    std::lock_guard lock(mutex);
                    connects.push_back(result);
                }
                changed.notify_all();
            }
        );
    }

    bool wait_for_connects(std::size_t count)
    {
        std::unique_lock lock(mutex);
        return changed.wait_for(lock, 2s, [&] { return connects.size() >= count; });
    }

    void serve_other_origin()
    {
        http.scripted.responses[std::string(kOtherOrigin) + "/api/auth/me"] =
            HttpResponse{.status_code = 200, .body = me_json()};
        http.scripted.responses[std::string(kOtherOrigin) + "/api/capabilities"] =
            HttpResponse{.status_code = 200, .body = capabilities_json()};
    }
};

std::chrono::milliseconds elapsed_since(std::chrono::steady_clock::time_point start)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start
    );
}

void destructor_returns_quickly_with_a_request_in_flight()
{
    Harness harness;
    harness.settings.origin = kOrigin;
    harness.vault->tokens[credential_account_for_origin(kOrigin)] = "crv_saved";
    harness.http.blocked_prefix = kOrigin;
    auto worker = harness.worker();
    worker->start();
    CRATE_CHECK(harness.http.wait_until_blocked());

    const auto start = std::chrono::steady_clock::now();
    worker.reset();
    const auto elapsed = elapsed_since(start);
    std::cout << "worker destructor returned after " << elapsed.count() << " ms\n";

    CRATE_CHECK(elapsed < 250ms);
}

void unconfigured_worker_stays_offline()
{
    Harness harness;
    auto worker = harness.worker();
    worker->start();
    worker.reset();

    CRATE_CHECK(harness.http.scripted.requests.empty());
    CRATE_CHECK(!harness.session.logged_in());
}

void connect_reports_its_result()
{
    Harness harness;
    harness.http.scripted.serve_connected();
    auto worker = harness.worker();
    worker->start();

    worker->connect(kOrigin, "crv_valid");

    CRATE_CHECK(harness.wait_for_connects(1));
    CRATE_CHECK(harness.connects.front().error == ConnectError::None);
    CRATE_CHECK(harness.session.logged_in());
}

void disconnect_cancels_an_in_flight_connect()
{
    Harness harness;
    harness.http.blocked_prefix = kOrigin;
    auto worker = harness.worker();
    worker->start();
    worker->connect(kOrigin, "crv_valid");
    CRATE_CHECK(harness.http.wait_until_blocked());

    const auto start = std::chrono::steady_clock::now();
    CRATE_CHECK(worker->disconnect());
    const auto disconnect_elapsed = elapsed_since(start);
    worker.reset();
    std::cout << "disconnect returned after " << disconnect_elapsed.count() << " ms\n";

    CRATE_CHECK(disconnect_elapsed < 250ms);
    CRATE_CHECK(harness.connects.empty());
    CRATE_CHECK(!harness.session.logged_in());
    CRATE_CHECK(harness.vault->tokens.empty());
    CRATE_CHECK(!harness.settings.origin.has_value());
}

void a_new_server_supersedes_an_in_flight_connect()
{
    Harness harness;
    harness.http.blocked_prefix = kOrigin;
    harness.serve_other_origin();
    auto worker = harness.worker();
    worker->start();
    worker->connect(kOrigin, "crv_first");
    CRATE_CHECK(harness.http.wait_until_blocked());

    worker->connect(kOtherOrigin, "crv_second");

    CRATE_CHECK(harness.wait_for_connects(1));
    worker.reset();
    CRATE_CHECK(harness.connects.size() == 1);
    CRATE_CHECK(harness.connects.front().error == ConnectError::None);
    CRATE_CHECK(harness.session.origin() == kOtherOrigin);
    CRATE_CHECK(harness.settings.origin == kOtherOrigin);
    CRATE_CHECK(!harness.vault->tokens.contains(credential_account_for_origin(kOrigin)));
}

} // namespace

int main()
{
    destructor_returns_quickly_with_a_request_in_flight();
    unconfigured_worker_stays_offline();
    connect_reports_its_result();
    disconnect_cancels_an_in_flight_connect();
    a_new_server_supersedes_an_in_flight_connect();
}
