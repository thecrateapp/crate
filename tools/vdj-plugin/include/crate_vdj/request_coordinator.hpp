#pragma once

#include "crate_vdj/http_client.hpp"

#include <cstdint>
#include <map>
#include <mutex>
#include <optional>

namespace crate::vdj {

class RequestCoordinator {
public:
    struct Request {
        std::uint64_t generation = 0;
        CancellationToken cancellation;
    };

    std::optional<Request> begin();
    void complete(const Request& request);
    void cancel_all();
    void shutdown();

    template <typename Publish>
    bool publish(const Request& request, Publish&& publish)
    {
        std::lock_guard lock(mutex_);
        const auto found = in_flight_.find(request.generation);
        if (found == in_flight_.end()) {
            return false;
        }
        const bool current = !stopped_ && request.generation == generation_ &&
            !request.cancellation.cancelled();
        in_flight_.erase(found);
        if (!current) {
            return false;
        }
        publish();
        return true;
    }

private:
    std::mutex mutex_;
    std::uint64_t generation_ = 0;
    std::map<std::uint64_t, CancellationSource> in_flight_;
    bool stopped_ = false;
};

} // namespace crate::vdj
