#include "crate_vdj/play_events.hpp"

#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/vdj_track_path.hpp"

#include <algorithm>
#include <cstdint>
#include <ctime>
#include <fstream>
#include <system_error>
#include <utility>

namespace crate::vdj {
namespace {

constexpr double kCompletionMarginMs = 5'000;

json::Value to_json(const PlayEvent& event)
{
    return json::Value{
        {"client_event_id", event.client_event_id},
        {"track_entity_uid", event.track_entity_uid},
        {"title", event.title},
        {"artist", event.artist},
        {"album", event.album},
        {"started_at", event.started_at},
        {"ended_at", event.ended_at},
        {"played_seconds", event.played_seconds},
        {"track_duration_seconds", event.track_duration_seconds},
        {"was_completed", event.was_completed},
    };
}

std::optional<PlayEvent> from_json(const std::string& line)
{
    const auto parsed = json::parse_object(line);
    if (!parsed.ok()) {
        return std::nullopt;
    }
    const auto& value = *parsed.value;
    PlayEvent event;
    if (!json::required_string(value, "client_event_id", event.client_event_id) ||
        !json::required_string(value, "track_entity_uid", event.track_entity_uid) ||
        !json::optional_string(value, "title", event.title) ||
        !json::optional_string(value, "artist", event.artist) ||
        !json::optional_string(value, "album", event.album) ||
        !json::required_string(value, "started_at", event.started_at) ||
        !json::required_string(value, "ended_at", event.ended_at) ||
        !json::optional_number(value, "played_seconds", event.played_seconds) ||
        !json::optional_number(value, "track_duration_seconds", event.track_duration_seconds) ||
        !json::optional_boolean(value, "was_completed", event.was_completed)) {
        return std::nullopt;
    }
    return event;
}

std::int64_t epoch_ms(std::chrono::system_clock::time_point time)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch()).count();
}

} // namespace

std::string iso8601_utc(std::chrono::system_clock::time_point time)
{
    const auto seconds = std::chrono::system_clock::to_time_t(time);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &seconds);
#else
    gmtime_r(&seconds, &utc);
#endif
    char buffer[32] = {};
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
    return buffer;
}

std::vector<PlayEvent> PlayTracker::observe(
    int deck,
    const std::optional<DeckReading>& reading,
    Clock::time_point now
)
{
    std::vector<PlayEvent> events;
    const auto track_uid = reading.has_value()
        ? crate_uid_from_vdj_filepath(reading->filepath)
        : std::nullopt;
    const auto existing = sessions_.find(deck);

    if (existing != sessions_.end()) {
        auto& session = existing->second;
        if (session.audible) {
            session.audible_seconds +=
                std::chrono::duration<double>(now - session.last_seen).count();
        }
        session.last_seen = now;
        if (track_uid == session.track_entity_uid) {
            session.audible = reading->audible;
            session.elapsed_ms = reading->elapsed_ms;
            session.total_ms = reading->total_ms;
            return events;
        }
        if (auto event = close(session, now)) {
            events.push_back(std::move(*event));
        }
        sessions_.erase(existing);
    }

    if (track_uid.has_value()) {
        sessions_[deck] = Session{
            .track_entity_uid = *track_uid,
            .started_at = now,
            .last_seen = now,
            .audible_seconds = 0,
            .audible = reading->audible,
            .elapsed_ms = reading->elapsed_ms,
            .total_ms = reading->total_ms,
        };
    }
    return events;
}

std::optional<PlayEvent> PlayTracker::close(const Session& session, Clock::time_point ended_at)
{
    const bool completed =
        session.total_ms > 0 && session.elapsed_ms >= session.total_ms - kCompletionMarginMs;
    if (session.audible_seconds < kMinimumAudibleSeconds &&
        !(completed && session.audible_seconds >= 2)) {
        return std::nullopt;
    }
    PlayEvent event;
    event.client_event_id =
        "vdj:" + session.track_entity_uid + ":" + std::to_string(epoch_ms(session.started_at));
    event.track_entity_uid = session.track_entity_uid;
    event.started_at = iso8601_utc(session.started_at);
    event.ended_at = iso8601_utc(ended_at);
    event.played_seconds = session.audible_seconds;
    event.track_duration_seconds = session.total_ms / 1000.0;
    event.was_completed = completed;
    return event;
}

PlayEventSpool::PlayEventSpool(std::filesystem::path path, std::size_t capacity)
    : path_(std::move(path))
    , capacity_(std::max<std::size_t>(capacity, 1))
{
}

bool PlayEventSpool::append(const PlayEvent& event)
{
    auto events = pending();
    events.push_back(event);
    if (events.size() > capacity_) {
        events.erase(events.begin(), events.end() - static_cast<std::ptrdiff_t>(capacity_));
    }
    return replace(events);
}

std::vector<PlayEvent> PlayEventSpool::pending() const
{
    std::vector<PlayEvent> events;
    std::ifstream input(path_);
    std::string line;
    while (std::getline(input, line)) {
        if (auto event = from_json(line)) {
            events.push_back(std::move(*event));
        }
    }
    return events;
}

bool PlayEventSpool::replace(const std::vector<PlayEvent>& events)
{
    std::error_code error;
    std::filesystem::create_directories(path_.parent_path(), error);
    auto temporary = path_;
    temporary += ".tmp";
    {
        std::ofstream output(temporary, std::ios::trunc);
        if (!output.is_open()) {
            return false;
        }
        for (const auto& event : events) {
            output << to_json(event).dump() << '\n';
        }
        if (!output.good()) {
            return false;
        }
    }
    std::filesystem::rename(temporary, path_, error);
    return !error;
}

PlayEventClient::PlayEventClient(HttpClient& http, CredentialStore& credentials, std::string origin)
    : http_(http)
    , credentials_(credentials)
    , origin_(std::move(origin))
{
}

PlayEventDelivery PlayEventClient::send(const PlayEvent& event, const CancellationToken& cancellation)
{
    const auto token = credentials_.load_token();
    if (!token.has_value() || token->empty()) {
        return PlayEventDelivery::Retry;
    }
    auto body = to_json(event);
    body["completion_ratio"] = event.track_duration_seconds > 0
        ? json::Value(std::min(1.0, event.played_seconds / event.track_duration_seconds))
        : json::Value(nullptr);
    if (event.track_duration_seconds <= 0) {
        body["track_duration_seconds"] = nullptr;
    }
    body["was_skipped"] = false;
    body["play_source_type"] = "virtualdj";
    body["device_type"] = "desktop";
    body["app_platform"] = "virtualdj";

    const auto response = http_.request(HttpRequest{
        .method = "POST",
        .url = origin_ + "/api/me/play-events",
        .allowed_origin = origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + *token},
            {"Content-Type", "application/json"},
        },
        .body = body.dump(),
        .cancellation = cancellation,
    });
    if (const auto* error = std::get_if<HttpError>(&response)) {
        const bool rejected = error->code == HttpErrorCode::HttpStatus &&
            error->status_code >= 400 && error->status_code < 500 && error->status_code != 401 &&
            error->status_code != 403 && error->status_code != 429;
        return rejected ? PlayEventDelivery::Rejected : PlayEventDelivery::Retry;
    }
    return PlayEventDelivery::Sent;
}

} // namespace crate::vdj
