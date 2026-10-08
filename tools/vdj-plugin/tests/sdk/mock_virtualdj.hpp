#pragma once

#include "crate_vdj/core.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

namespace crate::vdj::test {

class MockVirtualDJ final : public VirtualDJCommandPort, public VirtualDJStatePort {
public:
    CommandResult send_command(std::string_view command) override
    {
        std::lock_guard lock(mutex_);
        last_command_ = std::string(command);
        ++command_count_;
        return CommandResult{true, {}};
    }

    std::optional<DeckState> read_state(int deck) override
    {
        if (deck != 1) {
            return std::nullopt;
        }

        return DeckState{1, 128.0, 16.0, 1234.0};
    }

    std::string last_command() const
    {
        std::lock_guard lock(mutex_);
        return last_command_;
    }

    int command_count() const
    {
        std::lock_guard lock(mutex_);
        return command_count_;
    }

private:
    mutable std::mutex mutex_;
    std::string last_command_;
    int command_count_ = 0;
};

class InFlightCapabilityClient final : public CapabilityClient {
public:
    ~InFlightCapabilityClient() override
    {
        cancellation_.cancel();
        if (worker_.joinable()) {
            worker_.join();
        }
    }

    void fetch(CancellationToken token, CapabilityCallback callback) override
    {
        worker_ = std::thread(
            [this, token, callback = std::move(callback)]() mutable {
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
                if (token.cancelled() || cancellation_.token().cancelled()) {
                    return;
                }
                callback(CapabilityResult{});
            }
        );
    }

private:
    CancellationSource cancellation_;
    std::thread worker_;
};

} // namespace crate::vdj::test
