#include "crate_vdj/request_coordinator.hpp"

#include "../support/check.hpp"

#include <atomic>
#include <chrono>
#include <future>
#include <thread>

using namespace crate::vdj;
using namespace std::chrono_literals;

namespace {

void a_new_request_supersedes_the_previous_one()
{
    RequestCoordinator coordinator;
    const auto first = coordinator.begin();
    const auto second = coordinator.begin();

    CRATE_CHECK(first.has_value() && second.has_value());
    CRATE_CHECK(first->cancellation.cancelled());
    CRATE_CHECK(!second->cancellation.cancelled());

    int published = 0;
    CRATE_CHECK(!coordinator.publish(*first, [&] { ++published; }));
    CRATE_CHECK(coordinator.publish(*second, [&] { ++published; }));
    CRATE_CHECK(published == 1);
}

void a_cancelled_request_never_publishes()
{
    RequestCoordinator coordinator;
    const auto request = coordinator.begin();

    coordinator.cancel_all();

    bool published = false;
    CRATE_CHECK(request->cancellation.cancelled());
    CRATE_CHECK(!coordinator.publish(*request, [&] { published = true; }));
    CRATE_CHECK(!published);
}

void a_request_publishes_only_once()
{
    RequestCoordinator coordinator;
    const auto request = coordinator.begin();

    int published = 0;
    CRATE_CHECK(coordinator.publish(*request, [&] { ++published; }));
    CRATE_CHECK(!coordinator.publish(*request, [&] { ++published; }));
    CRATE_CHECK(published == 1);
}

void cancel_waits_for_a_publication_in_progress()
{
    RequestCoordinator coordinator;
    const auto request = coordinator.begin();
    std::promise<void> publishing;
    std::atomic<bool> release = false;
    std::atomic<bool> finished = false;

    auto publisher = std::async(std::launch::async, [&] {
        return coordinator.publish(*request, [&] {
            publishing.set_value();
            while (!release) {
                std::this_thread::sleep_for(1ms);
            }
            finished = true;
        });
    });
    publishing.get_future().wait();

    auto canceller = std::async(std::launch::async, [&] { coordinator.cancel_all(); });
    CRATE_CHECK(canceller.wait_for(50ms) == std::future_status::timeout);
    release = true;
    canceller.get();

    CRATE_CHECK(finished);
    CRATE_CHECK(publisher.get());
}

void shutdown_refuses_new_requests_and_cancels_the_rest()
{
    RequestCoordinator coordinator;
    const auto request = coordinator.begin();

    coordinator.shutdown();

    CRATE_CHECK(request->cancellation.cancelled());
    CRATE_CHECK(!coordinator.begin().has_value());
    CRATE_CHECK(!coordinator.publish(*request, [] {}));
}

} // namespace

int main()
{
    a_new_request_supersedes_the_previous_one();
    a_cancelled_request_never_publishes();
    a_request_publishes_only_once();
    cancel_waits_for_a_publication_in_progress();
    shutdown_refuses_new_requests_and_cancels_the_rest();
}
