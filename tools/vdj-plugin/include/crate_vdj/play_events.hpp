#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"

#include <chrono>
#include <cstddef>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace crate::vdj {

struct DeckReading {
    std::string filepath;
    bool audible = false;
    double elapsed_ms = 0;
    double total_ms = 0;
};

struct PlayEvent {
    std::string client_event_id;
    std::string track_entity_uid;
    std::string title;
    std::string artist;
    std::string album;
    std::string started_at;
    std::string ended_at;
    double played_seconds = 0;
    double track_duration_seconds = 0;
    bool was_completed = false;
};

inline constexpr double kMinimumAudibleSeconds = 30.0;

std::string iso8601_utc(std::chrono::system_clock::time_point time);

class PlayTracker {
public:
    using Clock = std::chrono::system_clock;

    std::vector<PlayEvent> observe(
        int deck,
        const std::optional<DeckReading>& reading,
        Clock::time_point now
    );

private:
    struct Session {
        std::string track_entity_uid;
        Clock::time_point started_at;
        Clock::time_point last_seen;
        double audible_seconds = 0;
        bool audible = false;
        double elapsed_ms = 0;
        double total_ms = 0;
    };

    static std::optional<PlayEvent> close(const Session& session, Clock::time_point ended_at);

    std::map<int, Session> sessions_;
};

class PlayEventSpool {
public:
    explicit PlayEventSpool(std::filesystem::path path, std::size_t capacity = 500);

    bool append(const PlayEvent& event);
    std::vector<PlayEvent> pending() const;
    bool replace(const std::vector<PlayEvent>& events);

private:
    std::filesystem::path path_;
    std::size_t capacity_;
};

enum class PlayEventDelivery {
    Sent,
    Rejected,
    Retry,
};

class PlayEventClient {
public:
    PlayEventClient(HttpClient& http, CredentialStore& credentials, std::string origin);

    PlayEventDelivery send(const PlayEvent& event, const CancellationToken& cancellation);

private:
    HttpClient& http_;
    CredentialStore& credentials_;
    std::string origin_;
};

} // namespace crate::vdj
