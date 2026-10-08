#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/models.hpp"

#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

struct CommandResult {
    bool ok;
    std::string error;
};

struct DeckState {
    int deck;
    double bpm;
    double beat_position;
    double elapsed_time_ms;
};

class MetadataCache {
public:
    virtual ~MetadataCache() = default;
    virtual std::optional<std::string> get(std::string_view key) = 0;
    virtual void put(std::string key, std::string value) = 0;
};

class Clock {
public:
    virtual ~Clock() = default;
    virtual std::chrono::steady_clock::time_point now() const = 0;
};

using CapabilityCallback = std::function<void(ParseResult<Capabilities>)>;
using CapabilityResult = ParseResult<Capabilities>;

class CapabilityClient {
public:
    virtual ~CapabilityClient() = default;
    virtual void fetch(
        CancellationToken token,
        CapabilityCallback callback
    ) = 0;
};

class VirtualDJCommandPort {
public:
    virtual ~VirtualDJCommandPort() = default;
    virtual CommandResult send_command(std::string_view command) = 0;
};

class VirtualDJStatePort {
public:
    virtual ~VirtualDJStatePort() = default;
    virtual std::optional<DeckState> read_state(int deck) = 0;
};

class CompletionOnce {
public:
    bool try_complete();

private:
    std::atomic_bool completed_ = false;
};

} // namespace crate::vdj
