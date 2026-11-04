#include "crate_vdj/play_events.hpp"

#include "../support/check.hpp"
#include "../support/scripted_http.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>

using namespace crate::vdj;
using namespace crate::vdj::testing;
using namespace std::chrono_literals;

namespace {

const auto kStart = std::chrono::system_clock::time_point{} + 24h * 20000;
constexpr const char* kTrackPath = "netsearch://plugin-Crate/track-1";

DeckReading reading(std::string path, bool audible, double elapsed_ms = 0, double total_ms = 200'000)
{
    return DeckReading{std::move(path), audible, elapsed_ms, total_ms};
}

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_private-token";
    }

    bool save_token(std::string) override
    {
        return true;
    }

    bool clear_token() override
    {
        return true;
    }
};

void an_audible_play_is_reported_when_the_track_changes()
{
    PlayTracker tracker;
    CRATE_CHECK(tracker.observe(1, reading(kTrackPath, true), kStart).empty());
    CRATE_CHECK(tracker.observe(1, reading(kTrackPath, true, 40'000), kStart + 40s).empty());

    const auto events = tracker.observe(1, reading("netsearch://plugin-Crate/track-2", true), kStart + 41s);

    CRATE_CHECK(events.size() == 1);
    CRATE_CHECK(events[0].track_entity_uid == "track-1");
    CRATE_CHECK(events[0].played_seconds == 41.0);
    CRATE_CHECK(events[0].track_duration_seconds == 200.0);
    CRATE_CHECK(!events[0].was_completed);
    CRATE_CHECK(events[0].started_at == iso8601_utc(kStart));
    CRATE_CHECK(events[0].ended_at == iso8601_utc(kStart + 41s));
    CRATE_CHECK(events[0].client_event_id.find("track-1") != std::string::npos);
}

void headphone_previews_and_short_plays_are_not_reported()
{
    PlayTracker tracker;
    tracker.observe(1, reading(kTrackPath, false), kStart);
    tracker.observe(1, reading(kTrackPath, false, 60'000), kStart + 60s);
    CRATE_CHECK(tracker.observe(1, std::nullopt, kStart + 61s).empty());

    tracker.observe(2, reading(kTrackPath, true), kStart);
    tracker.observe(2, reading(kTrackPath, true, 10'000), kStart + 10s);
    CRATE_CHECK(tracker.observe(2, std::nullopt, kStart + 11s).empty());
}

void a_track_played_to_its_end_is_completed()
{
    PlayTracker tracker;
    tracker.observe(1, reading(kTrackPath, true, 0, 60'000), kStart);
    tracker.observe(1, reading(kTrackPath, true, 58'000, 60'000), kStart + 58s);

    const auto events = tracker.observe(1, std::nullopt, kStart + 60s);

    CRATE_CHECK(events.size() == 1);
    CRATE_CHECK(events[0].was_completed);
}

void decks_are_tracked_independently_and_other_sources_ignored()
{
    PlayTracker tracker;
    tracker.observe(1, reading(kTrackPath, true), kStart);
    tracker.observe(3, reading("/Users/dj/Music/local.mp3", true), kStart);
    tracker.observe(1, reading(kTrackPath, true), kStart + 35s);

    CRATE_CHECK(tracker.observe(3, std::nullopt, kStart + 40s).empty());
    CRATE_CHECK(tracker.observe(1, std::nullopt, kStart + 40s).size() == 1);
}

void the_same_play_always_has_the_same_event_id()
{
    PlayTracker first;
    PlayTracker second;
    for (auto* tracker : {&first, &second}) {
        tracker->observe(1, reading(kTrackPath, true), kStart);
        tracker->observe(1, reading(kTrackPath, true), kStart + 31s);
    }

    CRATE_CHECK(
        first.observe(1, std::nullopt, kStart + 32s)[0].client_event_id ==
        second.observe(1, std::nullopt, kStart + 32s)[0].client_event_id
    );
}

PlayEvent sample_event(std::string id)
{
    PlayEvent event;
    event.client_event_id = std::move(id);
    event.track_entity_uid = "track-1";
    event.title = "Noah";
    event.artist = "Birds In Row";
    event.album = "Gris Klein";
    event.started_at = "2026-11-02T10:00:00Z";
    event.ended_at = "2026-11-02T10:03:00Z";
    event.played_seconds = 180;
    event.track_duration_seconds = 193.5;
    event.was_completed = true;
    return event;
}

void the_spool_survives_restarts_and_keeps_the_newest_events()
{
    const auto path = std::filesystem::temp_directory_path() / "crate-vdj-play-events-test.jsonl";
    std::filesystem::remove(path);
    {
        PlayEventSpool spool(path, 2);
        CRATE_CHECK(spool.append(sample_event("a")));
        CRATE_CHECK(spool.append(sample_event("b")));
        CRATE_CHECK(spool.append(sample_event("c")));
    }

    PlayEventSpool reopened(path, 2);
    auto pending = reopened.pending();
    CRATE_CHECK(pending.size() == 2);
    CRATE_CHECK(pending[0].client_event_id == "b");
    CRATE_CHECK(pending[1].client_event_id == "c");
    CRATE_CHECK(pending[1].played_seconds == 180);
    CRATE_CHECK(pending[1].album == "Gris Klein");
    CRATE_CHECK(pending[1].was_completed);

    CRATE_CHECK(reopened.replace({pending[1]}));
    CRATE_CHECK(reopened.pending().size() == 1);
    CRATE_CHECK(reopened.replace({}));
    CRATE_CHECK(reopened.pending().empty());
    std::filesystem::remove(path);
}

void the_spool_never_stores_credentials()
{
    const auto path = std::filesystem::temp_directory_path() / "crate-vdj-play-events-secret-test.jsonl";
    std::filesystem::remove(path);
    {
        PlayEventSpool spool(path);
        spool.append(sample_event("a"));
    }

    std::string content;
    {
        std::ifstream file(path);
        content.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    }

    CRATE_CHECK(content.find("crv_") == std::string::npos);
    std::filesystem::remove(path);
}

void the_client_posts_one_event_and_classifies_the_answer()
{
    ScriptedHttpClient http;
    MemoryCredentialStore credentials;
    PlayEventClient client(http, credentials, kOrigin);
    http.serve("/api/me/play-events", R"({"id":1})");

    CRATE_CHECK(client.send(sample_event("a"), CancellationToken{}) == PlayEventDelivery::Sent);
    const auto& request = http.requests.back();
    CRATE_CHECK(request.method == "POST");
    CRATE_CHECK(request.body.find("\"client_event_id\":\"a\"") != std::string::npos);
    CRATE_CHECK(request.body.find("\"track_entity_uid\":\"track-1\"") != std::string::npos);
    CRATE_CHECK(request.body.find("\"app_platform\":\"virtualdj\"") != std::string::npos);
    CRATE_CHECK(request.body.find("crv_") == std::string::npos);

    http.fail("/api/me/play-events", 422);
    CRATE_CHECK(client.send(sample_event("a"), CancellationToken{}) == PlayEventDelivery::Rejected);
    http.fail("/api/me/play-events", 503);
    CRATE_CHECK(client.send(sample_event("a"), CancellationToken{}) == PlayEventDelivery::Retry);
    http.fail("/api/me/play-events", 401);
    CRATE_CHECK(client.send(sample_event("a"), CancellationToken{}) == PlayEventDelivery::Retry);
    http.responses.clear();
    CRATE_CHECK(client.send(sample_event("a"), CancellationToken{}) == PlayEventDelivery::Retry);
}

} // namespace

int main()
{
    an_audible_play_is_reported_when_the_track_changes();
    headphone_previews_and_short_plays_are_not_reported();
    a_track_played_to_its_end_is_completed();
    decks_are_tracked_independently_and_other_sources_ignored();
    the_same_play_always_has_the_same_event_id();
    the_spool_survives_restarts_and_keeps_the_newest_events();
    the_spool_never_stores_credentials();
    the_client_posts_one_event_and_classifies_the_answer();
}
