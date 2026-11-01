#include "crate_vdj/request_coordinator.hpp"

namespace crate::vdj {

std::optional<RequestCoordinator::Request> RequestCoordinator::begin()
{
    std::lock_guard lock(mutex_);
    if (stopped_) {
        return std::nullopt;
    }
    for (auto& entry : in_flight_) {
        entry.second.cancel();
    }
    const auto generation = ++generation_;
    const auto entry = in_flight_.emplace(generation, CancellationSource{}).first;
    return Request{generation, entry->second.token()};
}

void RequestCoordinator::complete(const Request& request)
{
    std::lock_guard lock(mutex_);
    in_flight_.erase(request.generation);
}

void RequestCoordinator::cancel_all()
{
    std::lock_guard lock(mutex_);
    for (auto& entry : in_flight_) {
        entry.second.cancel();
    }
}

void RequestCoordinator::shutdown()
{
    std::lock_guard lock(mutex_);
    stopped_ = true;
    for (auto& entry : in_flight_) {
        entry.second.cancel();
    }
}

} // namespace crate::vdj
