#include "crate_vdj/online_source.hpp"
#include "crate_vdj/play_events.hpp"
#include "crate_vdj/translations.hpp"

#include "../support/check.hpp"
#include "../support/connection_fakes.hpp"
#include "../support/scripted_http.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <exception>
#include <filesystem>
#include <functional>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace crate::vdj;
using namespace crate::vdj::testing;
using namespace std::chrono_literals;

namespace {

constexpr const char* kSearchJson = R"json({
    "artists": [],
    "albums": [],
    "tracks": [{
        "entity_uid": "track-1",
        "title": "Noah",
        "artist": "Birds In Row",
        "album": "Gris Klein",
        "duration": 193.5,
        "cover_url": "/api/vdj/albums/3/cover?size=512"
    }]
})json";

constexpr const char* kProfiledSearchJson = R"json({
    "artists": [],
    "albums": [],
    "tracks": [{
        "entity_uid": "track-1",
        "title": "Noah",
        "artist": "Birds In Row",
        "album": "Gris Klein",
        "duration": 193.5,
        "bpm": 121.0,
        "audio_key": "C",
        "audio_scale": "major",
        "camelot": "8A",
        "energy": 0.72,
        "album_id": 31
    }]
})json";

constexpr const char* kCompatibleJson = R"json({
    "seedTrackEntityUid": "seed-1",
    "scope": "local",
    "plannerVersion": "smart-mix-v2",
    "context": "auto",
    "items": [{
        "trackId": 8,
        "trackEntityUid": "track-2",
        "title": "Torches",
        "artist": "Birds In Row",
        "album": "Gris Klein",
        "score": 0.91,
        "confidence": 0.9,
        "scoreBreakdown": {
            "plannerVersion": 2, "overall": 0.91, "signalConfidence": 0.9, "tempo": 1.0,
            "harmonic": 1.0, "harmonicRelationship": "same", "energy": 0.9,
            "danceability": 0.9, "valence": 0.9, "bliss": 0.8, "genre": 1.0
        },
        "fallbackReasons": [],
        "duration": 201.5,
        "bpm": 122.0,
        "camelot": "9B",
        "energy": 0.64,
        "year": "2022",
        "genre": "Post-hardcore",
        "coverUrl": "/api/vdj/albums/3/cover?size=512"
    }]
})json";

std::string folder_page_json(const std::string& uid, const std::string& next_cursor)
{
    return R"json({"folders": [], "tracks": [{"entity_uid": ")json" + uid +
        R"json(", "title": "Song", "artist": "Band", "album": "Record", "duration": 120}],)json" +
        R"json( "next_cursor": )json" + (next_cursor.empty() ? "null" : "\"" + next_cursor + "\"") +
        "}";
}

class RoutedHttp final : public HttpClient {
public:
    std::string gated_prefix;
    std::function<void()> before_response;

    void route(const std::string& prefix, std::string body)
    {
        set(prefix, HttpResponse{.status_code = 200, .body = std::move(body)});
    }

    void fail(const std::string& prefix, int status)
    {
        set(prefix, HttpError{.code = HttpErrorCode::HttpStatus, .status_code = status, .message = "HTTP " + std::to_string(status)});
    }

    std::vector<std::string> bodies_sent_to(const std::string& prefix)
    {
        std::lock_guard lock(mutex_);
        std::vector<std::string> bodies;
        for (const auto& [path, body] : sent_) {
            if (path.starts_with(prefix)) {
                bodies.push_back(body);
            }
        }
        return bodies;
    }

    HttpResult request(const HttpRequest& request) override
    {
        const std::string path = request.url.substr(std::string(kOrigin).size());
        {
            std::lock_guard lock(mutex_);
            sent_.emplace_back(path, request.body);
        }
        if (!gated_prefix.empty() && path.starts_with(gated_prefix)) {
            ++gated_;
            while (!request.cancellation.cancelled()) {
                std::this_thread::sleep_for(1ms);
            }
            return HttpError{.code = HttpErrorCode::Cancelled, .status_code = 0, .message = "cancelled"};
        }
        std::optional<HttpResult> result;
        {
            std::lock_guard lock(mutex_);
            std::size_t longest = 0;
            for (const auto& [prefix, response] : routes_) {
                if (path.starts_with(prefix) && prefix.size() > longest) {
                    result = response;
                    longest = prefix.size();
                }
            }
        }
        if (!result.has_value()) {
            return HttpError{.code = HttpErrorCode::Network, .status_code = 0, .message = "no route"};
        }
        if (before_response) {
            before_response();
        }
        return *result;
    }

    bool wait_until_gated()
    {
        const auto deadline = std::chrono::steady_clock::now() + 2s;
        while (gated_ == 0 && std::chrono::steady_clock::now() < deadline) {
            std::this_thread::sleep_for(1ms);
        }
        return gated_ > 0;
    }

private:
    void set(const std::string& prefix, HttpResult result)
    {
        std::lock_guard lock(mutex_);
        for (auto& [existing, response] : routes_) {
            if (existing == prefix) {
                response = std::move(result);
                return;
            }
        }
        routes_.emplace_back(prefix, std::move(result));
    }

    std::mutex mutex_;
    std::vector<std::pair<std::string, HttpResult>> routes_;
    std::vector<std::pair<std::string, std::string>> sent_;
    std::atomic<int> gated_ = 0;
};

class FakeHost final : public HostPort {
public:
    std::optional<std::string> track_path;
    std::vector<std::string> commands;
    std::vector<std::string> opened;
    std::map<int, DeckReading> decks;
    int layout_decks = 2;
    bool automix = true;
    std::vector<QueuedSong> queue;
    std::string browsed_folder = "onlinemusic:/Crate/Genres";

    std::string language() override
    {
        return "English";
    }

    std::optional<std::string> loaded_track_path() override
    {
        return track_path;
    }

    bool send_command(const std::string& command) override
    {
        commands.push_back(command);
        return true;
    }

    bool open_url(const std::string& url) override
    {
        opened.push_back(url);
        return true;
    }

    int deck_count() override
    {
        return layout_decks;
    }

    bool automix_active() override
    {
        return automix;
    }

    std::string browsed_folder_path() override
    {
        return browsed_folder;
    }

    std::vector<QueuedSong> automix_queue(int count) override
    {
        std::vector<QueuedSong> songs;
        for (int index = 0; index < count && index < static_cast<int>(queue.size()); ++index) {
            songs.push_back(queue[static_cast<std::size_t>(index)]);
        }
        return songs;
    }

    std::optional<DeckReading> read_deck(int deck) override
    {
        const auto found = decks.find(deck);
        return found == decks.end() ? std::nullopt : std::optional<DeckReading>(found->second);
    }
};

class FakeUi final : public ConnectionUi {
public:
    ConnectionDialogResult ask(const ConnectionDialogRequest&) override
    {
        return {};
    }

    void notify(const std::string&, const std::string&) override {}
};

class RecordingSink final : public TrackSink {
public:
    std::vector<TrackEntry> tracks;
    int finishes = 0;

    void add(const TrackEntry& track) override
    {
        tracks.push_back(track);
    }

    void finish() override
    {
        ++finishes;
    }

    bool untouched() const
    {
        return tracks.empty() && finishes == 0;
    }
};

class RecordingFolders final : public FolderSink {
public:
    std::vector<std::pair<std::string, std::string>> folders;

    void add(const std::string& id, const std::string& name) override
    {
        folders.emplace_back(id, name);
    }
};

int next_harness_instance()
{
    static std::atomic<int> instances = 0;
    return ++instances;
}

struct Harness {
    std::shared_ptr<SharedVault> vault = std::make_shared<SharedVault>();
    MemorySettingsStore settings;
    RoutedHttp http;
    FakeHost host;
    FakeUi ui;
    int instance = next_harness_instance();
    std::filesystem::path cache_path = std::filesystem::temp_directory_path() /
        ("crate-vdj-online-source-test-" + std::to_string(instance) + ".sqlite");
    std::filesystem::path spool_path = std::filesystem::temp_directory_path() /
        ("crate-vdj-online-source-plays-" + std::to_string(instance) + ".jsonl");
    std::unique_ptr<OnlineSource> source;

    explicit Harness(bool connected = true, std::string capabilities = capabilities_json())
    {
        std::filesystem::remove(cache_path);
        std::filesystem::remove(spool_path);
        http.route("/api/auth/me", me_json());
        http.route("/api/capabilities", std::move(capabilities));
        if (connected) {
            settings.origin = kOrigin;
            vault->tokens[credential_account_for_origin(kOrigin)] = "crv_saved";
        }
        source = std::make_unique<OnlineSource>(OnlineSourceDependencies{
            .http = http,
            .settings = settings,
            .credentials =
                [vault = vault](const std::string& account) {
                    return std::make_unique<VaultCredentialStore>(vault, account);
                },
            .metadata_cache_path = utf8_path(cache_path),
            .play_events_path = spool_path,
            .host = host,
            .ui = ui,
            .log = {},
            .run_automix_worker = false,
        });
        source->start();
        if (connected) {
            const auto deadline = std::chrono::steady_clock::now() + 2s;
            while (!source->logged_in() && std::chrono::steady_clock::now() < deadline) {
                std::this_thread::sleep_for(1ms);
            }
            std::this_thread::sleep_for(20ms);
        }
    }

    ~Harness()
    {
        source.reset();
        std::error_code cache_error;
        std::filesystem::remove(cache_path, cache_error);
        CRATE_CHECK(!cache_error);
        std::error_code spool_error;
        std::filesystem::remove(spool_path, spool_error);
        CRATE_CHECK(!spool_error);
    }
};

void search_publishes_tracks_once_with_absolute_covers()
{
    Harness harness;
    CRATE_CHECK(harness.source->logged_in());
    harness.http.route("/api/search?q=noah", kSearchJson);
    RecordingSink sink;

    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    CRATE_CHECK(sink.finishes == 1);
    CRATE_CHECK(sink.tracks.size() == 1);
    CRATE_CHECK(sink.tracks[0].unique_id == "track-1");
    CRATE_CHECK(sink.tracks[0].comment == "Gris Klein");
    CRATE_CHECK(sink.tracks[0].cover_url == std::string(kOrigin) + "/api/vdj/albums/3/cover?size=512");
}

void a_new_search_supersedes_one_in_flight()
{
    Harness harness;
    harness.http.gated_prefix = "/api/search?q=slow";
    harness.http.route("/api/search?q=fast", kSearchJson);
    RecordingSink slow_sink;
    auto slow = std::async(std::launch::async, [&] {
        return harness.source->search("slow", slow_sink);
    });
    CRATE_CHECK(harness.http.wait_until_gated());

    RecordingSink fast_sink;
    CRATE_CHECK(harness.source->search("fast", fast_sink) == CallbackStatus::Done);

    CRATE_CHECK(slow.get() == CallbackStatus::Cancelled);
    CRATE_CHECK(slow_sink.untouched());
    CRATE_CHECK(fast_sink.finishes == 1);
}

void cancel_search_leaves_the_list_untouched()
{
    Harness harness;
    harness.http.gated_prefix = "/api/search";
    RecordingSink sink;
    auto search = std::async(std::launch::async, [&] {
        return harness.source->search("anything", sink);
    });
    CRATE_CHECK(harness.http.wait_until_gated());

    harness.source->cancel_search();

    CRATE_CHECK(search.get() == CallbackStatus::Cancelled);
    CRATE_CHECK(sink.untouched());
}

void a_cancel_after_the_response_does_not_publish()
{
    Harness harness;
    harness.http.route("/api/search?q=late", kSearchJson);
    harness.http.before_response = [&] { harness.source->cancel_search(); };
    RecordingSink sink;

    CRATE_CHECK(harness.source->search("late", sink) == CallbackStatus::Cancelled);
    CRATE_CHECK(sink.untouched());
}

void a_disconnected_source_finishes_empty_lists()
{
    Harness harness(false);
    RecordingSink sink;

    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);
    CRATE_CHECK(sink.finishes == 1);
    CRATE_CHECK(sink.tracks.empty());
}

void folder_pages_are_published_together()
{
    Harness harness;
    harness.http.route("/api/vdj/catalog/folders/crate%3Agenre%3A1?cursor=", folder_page_json("track-2", ""));
    harness.http.route("/api/vdj/catalog/folders/crate%3Agenre%3A1?limit", folder_page_json("track-1", "next"));
    RecordingSink sink;

    CRATE_CHECK(harness.source->folder("crate:genre:1", sink) == CallbackStatus::Done);

    CRATE_CHECK(sink.finishes == 1);
    CRATE_CHECK(sink.tracks.size() == 2);
    CRATE_CHECK(sink.tracks[0].unique_id == "track-1");
    CRATE_CHECK(sink.tracks[1].unique_id == "track-2");
}

void a_new_folder_cancels_one_still_paging()
{
    Harness harness;
    harness.http.route("/api/vdj/catalog/folders/crate%3Agenre%3A1?limit", folder_page_json("track-1", "next"));
    harness.http.gated_prefix = "/api/vdj/catalog/folders/crate%3Agenre%3A1?cursor=";
    harness.http.route("/api/vdj/catalog/folders/crate%3Agenre%3A2", folder_page_json("track-9", ""));
    RecordingSink slow_sink;
    auto slow = std::async(std::launch::async, [&] {
        return harness.source->folder("crate:genre:1", slow_sink);
    });
    CRATE_CHECK(harness.http.wait_until_gated());

    RecordingSink other_sink;
    CRATE_CHECK(harness.source->folder("crate:genre:2", other_sink) == CallbackStatus::Done);

    CRATE_CHECK(slow.get() == CallbackStatus::Cancelled);
    CRATE_CHECK(slow_sink.untouched());
    CRATE_CHECK(other_sink.tracks.size() == 1);
}

void folder_list_adds_the_compatible_folder()
{
    Harness harness;
    harness.http.route(
        "/api/vdj/catalog/folders",
        R"json({"folders": [{"id": "crate:playlists", "name": "Playlists"}], "tracks": [], "next_cursor": null})json"
    );
    RecordingFolders folders;

    CRATE_CHECK(harness.source->folder_list(folders) == CallbackStatus::Done);

    CRATE_CHECK(folders.folders.size() == 2);
    CRATE_CHECK(folders.folders[0].first == "crate:playlists");
    CRATE_CHECK(folders.folders[1].first == kCurrentCompatibleFolderId);
}

void current_compatible_folder_without_a_crate_track_is_empty()
{
    Harness harness;
    RecordingSink sink;

    CRATE_CHECK(harness.source->folder(std::string(kCurrentCompatibleFolderId), sink) == CallbackStatus::Done);
    CRATE_CHECK(sink.finishes == 1);
    CRATE_CHECK(sink.tracks.empty());
}

void an_unknown_track_only_offers_compatible_tracks()
{
    Harness harness;

    CRATE_CHECK(harness.source->context_menu("unknown").size() == 1);
    CRATE_CHECK(harness.source->select_context_menu("unknown", 1) == CallbackStatus::NotImplemented);
    CRATE_CHECK(harness.source->select_context_menu("unknown", 0) == CallbackStatus::Done);
    CRATE_CHECK(harness.host.commands.size() == 1);
    CRATE_CHECK(harness.host.commands[0] == compatible_folder_navigation_command("English"));
}

void a_listed_track_offers_its_artist_and_album()
{
    Harness harness;
    harness.http.route("/api/search?q=noah", kSearchJson);
    RecordingSink sink;
    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    const auto entries = harness.source->context_menu("track-1");

    CRATE_CHECK(entries.size() == 3);
    CRATE_CHECK(entries[1] == "More from this artist");
    CRATE_CHECK(entries[2] == "This album");
    CRATE_CHECK(harness.source->select_context_menu("track-1", 1) == CallbackStatus::Done);
    CRATE_CHECK(harness.source->select_context_menu("track-1", 2) == CallbackStatus::Done);
    CRATE_CHECK(harness.host.commands.size() == 2);
    CRATE_CHECK(harness.host.commands[0] == "search 'artist:\"Birds In Row\"'");
    CRATE_CHECK(harness.host.commands[1] == "search 'album:\"Gris Klein\"'");
}

void names_with_quotes_fall_back_to_a_text_search()
{
    CRATE_CHECK(vdj_search_command("artist", "Guns N' Roses") == "search \"Guns N' Roses\"");
    CRATE_CHECK(vdj_search_command("album", "12\" Mixes") == "search \"12 Mixes\"");
}

void a_track_that_cannot_load_says_why()
{
    Harness harness;
    harness.http.fail("/api/vdj/tracks/by-entity/gone/playback", 404);

    const auto missing = harness.source->stream_url("gone");

    CRATE_CHECK(!missing.url.has_value());
    CRATE_CHECK(missing.error == stream_failure_message(StreamFailure::NotFound));
}

void a_ready_track_resolves_to_a_ticketed_stream()
{
    Harness harness;
    harness.http.route(
        "/api/vdj/tracks/by-entity/track-1/playback",
        R"json({"entity_uid":"track-1","content_origin":"local","preparing":false,"delivery":{"format":"flac"}})json"
    );
    harness.http.route(
        "/api/auth/media-access",
        R"json({"tickets":[{"audience":"stream","path":"/api/vdj/tracks/by-entity/track-1/stream","ticket":"t1"}]})json"
    );

    const auto resolved = harness.source->stream_url("track-1");

    CRATE_CHECK(resolved.url == std::string(kOrigin) + "/api/vdj/tracks/by-entity/track-1/stream?media_ticket=t1");
    CRATE_CHECK(resolved.error.empty());
}

void search_tracks_show_camelot_and_energy()
{
    Harness harness;
    harness.http.route("/api/search?q=noah", kProfiledSearchJson);
    RecordingSink sink;

    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    CRATE_CHECK(sink.tracks.size() == 1);
    CRATE_CHECK(sink.tracks[0].bpm == 121.0f);
    CRATE_CHECK(sink.tracks[0].key == vdj_key_from_camelot("8A"));
    CRATE_CHECK(sink.tracks[0].comment == "Gris Klein \u00b7 8A \u00b7 Energy 72%");
}

void compatible_tracks_show_crate_fields()
{
    Harness harness;
    harness.http.route("/api/tracks/by-entity/seed-1/compatible", kCompatibleJson);
    RecordingSink sink;

    CRATE_CHECK(harness.source->folder("crate:compatible:seed-1", sink) == CallbackStatus::Done);

    CRATE_CHECK(sink.tracks.size() == 1);
    const auto& track = sink.tracks[0];
    CRATE_CHECK(track.unique_id == "track-2");
    CRATE_CHECK(track.duration_seconds == 201.5f);
    CRATE_CHECK(track.bpm == 122.0f);
    CRATE_CHECK(track.key == vdj_key_from_camelot("9B"));
    CRATE_CHECK(track.year == 2022);
    CRATE_CHECK(track.genre == "Post-hardcore");
    CRATE_CHECK(track.cover_url == std::string(kOrigin) + "/api/vdj/albums/3/cover?size=512");
    CRATE_CHECK(track.comment == "Gris Klein \u00b7 9B \u00b7 Energy 64% \u00b7 Match 91%");
}

void a_seed_without_profile_shows_a_notice()
{
    Harness harness;
    harness.http.fail("/api/tracks/by-entity/seed-1/compatible", 404);
    RecordingSink sink;

    CRATE_CHECK(harness.source->folder("crate:compatible:seed-1", sink) == CallbackStatus::Done);

    CRATE_CHECK(sink.finishes == 1);
    CRATE_CHECK(sink.tracks.size() == 1);
    CRATE_CHECK(sink.tracks[0].unique_id == kNoProfileNoticeId);
    CRATE_CHECK(sink.tracks[0].title == no_profile_notice_label("English"));

    const auto notice = harness.source->stream_url(std::string(kNoProfileNoticeId));
    CRATE_CHECK(!notice.url.has_value());
    CRATE_CHECK(notice.error == no_profile_notice_label("English"));
}

std::string capabilities_with_listen()
{
    auto capabilities = capabilities_json();
    capabilities.insert(capabilities.find("\"vdj\":{") + 7, R"("listen_url":"https://listen.example.org",)");
    return capabilities;
}

void a_track_opens_its_album_in_listen()
{
    Harness harness(true, capabilities_with_listen());
    harness.http.route("/api/search?q=noah", kProfiledSearchJson);
    RecordingSink sink;
    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    const auto entries = harness.source->context_menu("track-1");

    CRATE_CHECK(entries.size() == 4);
    CRATE_CHECK(entries[3] == "Open in Crate");
    CRATE_CHECK(harness.source->select_context_menu("track-1", 3) == CallbackStatus::Done);
    CRATE_CHECK(harness.host.opened.size() == 1);
    CRATE_CHECK(harness.host.opened[0] == "https://listen.example.org/albums/31/album?track=track-1");
}

void open_in_crate_needs_a_listen_url()
{
    Harness harness;
    harness.http.route("/api/search?q=noah", kProfiledSearchJson);
    RecordingSink sink;
    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    CRATE_CHECK(harness.source->context_menu("track-1").size() == 3);
}

const auto kPlayStart = std::chrono::system_clock::time_point{} + std::chrono::hours(24 * 20000);

void plays_are_reported_with_the_track_names()
{
    Harness harness;
    harness.http.route("/api/search?q=noah", kProfiledSearchJson);
    harness.http.route("/api/me/play-events", R"({"id":1})");
    RecordingSink sink;
    CRATE_CHECK(harness.source->search("noah", sink) == CallbackStatus::Done);

    harness.host.decks[1] = DeckReading{"netsearch://plugin-Crate/track-1", true, 0, 193'500};
    harness.source->tick(kPlayStart);
    harness.source->tick(kPlayStart + 40s);
    harness.host.decks.erase(1);
    harness.source->tick(kPlayStart + 41s);

    const auto sent = harness.http.bodies_sent_to("/api/me/play-events");
    CRATE_CHECK(sent.size() == 1);
    CRATE_CHECK(sent[0].find("\"title\":\"Noah\"") != std::string::npos);
    CRATE_CHECK(sent[0].find("\"artist\":\"Birds In Row\"") != std::string::npos);
    CRATE_CHECK(PlayEventSpool(harness.spool_path).pending().empty());
}

void plays_wait_in_the_spool_until_crate_answers()
{
    Harness harness;
    harness.http.fail("/api/me/play-events", 503);
    harness.host.decks[1] = DeckReading{"netsearch://plugin-Crate/track-1", true, 0, 193'500};
    harness.source->tick(kPlayStart);
    harness.host.decks.erase(1);
    harness.source->tick(kPlayStart + 40s);

    CRATE_CHECK(PlayEventSpool(harness.spool_path).pending().size() == 1);

    harness.http.route("/api/me/play-events", R"({"id":1})");
    harness.source->tick(kPlayStart + 50s);
    CRATE_CHECK(PlayEventSpool(harness.spool_path).pending().size() == 1);
    harness.source->tick(kPlayStart + 75s);

    CRATE_CHECK(PlayEventSpool(harness.spool_path).pending().empty());
}

void decks_beyond_the_layout_are_not_read()
{
    Harness harness;
    harness.http.route("/api/me/play-events", R"({"id":1})");
    harness.host.decks[3] = DeckReading{"netsearch://plugin-Crate/track-1", true, 0, 193'500};
    harness.source->tick(kPlayStart);
    harness.host.decks.erase(3);
    harness.source->tick(kPlayStart + 40s);

    CRATE_CHECK(harness.http.bodies_sent_to("/api/me/play-events").empty());
}

struct Candidate {
    std::string uid;
    std::string artist;
    std::string album;
};

std::string compatible_json(const std::string& seed, const std::vector<Candidate>& candidates)
{
    std::string items;
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        const auto& candidate = candidates[index];
        if (!items.empty()) {
            items += ",";
        }
        items += R"({"trackId":)" + std::to_string(100 + index) + R"(,"trackEntityUid":")" + candidate.uid +
            R"(","title":"Song )" + candidate.uid + R"(","artist":")" + candidate.artist +
            R"(","album":")" + candidate.album + R"(","score":0.9,"confidence":0.9,"scoreBreakdown":{"plannerVersion":2,"overall":0.9,"signalConfidence":0.9,"tempo":1.0,"harmonic":1.0,"harmonicRelationship":"same","energy":0.9,"danceability":0.9,"valence":0.9,"bliss":0.8,"genre":1.0},"fallbackReasons":[]})";
    }
    return R"({"seedTrackEntityUid":")" + seed + R"(","scope":"local","plannerVersion":"smart-mix-v2","context":"auto","items":[)" + items + "]}";
}

std::string crate_path(const std::string& uid)
{
    return "netsearch://plugin-Crate/" + uid;
}

struct AutomixHarness {
    Harness harness{true, capabilities_json(true, "2026-08", true)};

    AutomixHarness()
    {
        harness.http.route("/api/me/play-events", R"({"id":1})");
        harness.http.route(
            "/api/tracks/by-entity/seed/compatible",
            compatible_json("seed", {{"same-artist", "Seed Band", "Other"}, {"a", "Band A", "Album A"}, {"b", "Band B", "Album B"}})
        );
        harness.http.route(
            "/api/tracks/by-entity/a/compatible",
            compatible_json("a", {{"seed", "Seed Band", "Seed Album"}, {"a-album", "Band C", "Album A"}, {"c", "Band C", "Album C"}})
        );
        harness.http.route(
            "/api/tracks/by-entity/manual/compatible",
            compatible_json("manual", {{"m", "Band M", "Album M"}})
        );
        harness.http.route(
            "/api/vdj/catalog/folders/crate%3Agenre%3A7",
            R"json({"folders":[],"tracks":[{"entity_uid":"seed","title":"Seed","artist":"Seed Band","album":"Seed Album"}],"next_cursor":null})json"
        );
        RecordingSink listed;
        harness.source->folder("crate:genre:7", listed);
        harness.host.decks[1] = DeckReading{crate_path("seed"), true, 10'000, 200'000};
    }

    std::vector<std::string> commands_after(std::chrono::system_clock::time_point at)
    {
        harness.source->tick(at);
        return harness.host.commands;
    }
};

const std::string kGoToAutomix = "browser_gotofolder \"onlinemusic:/Crate/Crate Automix\"";
const std::string kBackToGenres = "browser_gotofolder \"onlinemusic:/Crate/Genres\"";

std::vector<std::string> list_automix_folder(AutomixHarness& automix)
{
    RecordingSink sink;
    automix.harness.source->folder(std::string(kAutomixFolderId), sink);
    std::vector<std::string> uids;
    for (const auto& track : sink.tracks) {
        uids.push_back(track.unique_id);
    }
    return uids;
}

void automix_lists_a_track_in_vdj_before_queueing_it()
{
    AutomixHarness automix;

    CRATE_CHECK(automix.commands_after(kPlayStart) == std::vector<std::string>{kGoToAutomix});
    CRATE_CHECK(list_automix_folder(automix) == std::vector<std::string>{"a"});

    const auto commands = automix.commands_after(kPlayStart + 1s);

    CRATE_CHECK(commands.size() == 3);
    CRATE_CHECK(commands[1] == kBackToGenres);
    CRATE_CHECK(commands[2] == "playlist_add \"netsearch://plugin-Crate/a\"");
}

void automix_chains_the_second_track_from_the_first_and_never_repeats_an_album()
{
    AutomixHarness automix;
    automix.commands_after(kPlayStart);
    list_automix_folder(automix);
    automix.commands_after(kPlayStart + 1s);
    automix.harness.host.queue = {{"Crate", ""}};

    automix.commands_after(kPlayStart + 10s);
    list_automix_folder(automix);
    const auto commands = automix.commands_after(kPlayStart + 11s);

    CRATE_CHECK(commands.back() == "playlist_add \"netsearch://plugin-Crate/c\"");
}

void automix_waits_while_two_tracks_are_queued()
{
    AutomixHarness automix;
    automix.harness.host.queue = {{"Crate", ""}, {"/Users/dj/Music/own.mp3", "Own Track"}};

    CRATE_CHECK(automix.commands_after(kPlayStart).empty());
}

void a_manual_change_puts_a_fitting_track_right_next()
{
    AutomixHarness automix;
    automix.harness.host.queue = {{"Crate", ""}, {"Crate", ""}};
    automix.commands_after(kPlayStart);
    automix.harness.host.decks[1] = DeckReading{crate_path("manual"), true, 1'000, 200'000};

    CRATE_CHECK(automix.commands_after(kPlayStart + 10s) == std::vector<std::string>{kGoToAutomix});
    list_automix_folder(automix);
    const auto commands = automix.commands_after(kPlayStart + 11s);

    CRATE_CHECK(commands.back() == "automix_add_next \"netsearch://plugin-Crate/m\"");
}

void a_track_coming_from_the_queue_is_not_a_manual_change()
{
    AutomixHarness automix;
    automix.harness.http.route(
        "/api/vdj/catalog/folders/crate%3Agenre%3A8",
        R"json({"folders":[],"tracks":[{"entity_uid":"queued","title":"Queued Song","artist":"Queue Band","album":"Queue Album"}],"next_cursor":null})json"
    );
    automix.harness.http.route(
        "/api/tracks/by-entity/queued/compatible",
        compatible_json("queued", {{"q", "Band Q", "Album Q"}})
    );
    RecordingSink listed;
    automix.harness.source->folder("crate:genre:8", listed);
    automix.harness.host.queue = {{"Crate", "Queued Song"}, {"Crate", "Other Song"}};
    automix.commands_after(kPlayStart);

    automix.harness.host.decks[1] = DeckReading{crate_path("queued"), true, 1'000, 200'000};
    automix.harness.host.queue = {{"Crate", "Other Song"}};
    automix.commands_after(kPlayStart + 10s);
    list_automix_folder(automix);
    const auto commands = automix.commands_after(kPlayStart + 11s);

    CRATE_CHECK(commands.back() == "playlist_add \"netsearch://plugin-Crate/q\"");
}

void a_track_is_queued_anyway_if_vdj_never_lists_the_folder()
{
    AutomixHarness automix;
    automix.commands_after(kPlayStart);

    CRATE_CHECK(automix.commands_after(kPlayStart + 1s).size() == 1);
    const auto commands = automix.commands_after(kPlayStart + 3s);

    CRATE_CHECK(commands.size() == 3);
    CRATE_CHECK(commands[1] == kBackToGenres);
    CRATE_CHECK(commands[2] == "playlist_add \"netsearch://plugin-Crate/a\"");
}

void a_busy_browser_is_never_moved()
{
    AutomixHarness automix;
    automix.harness.source->cancel_search();

    CRATE_CHECK(automix.commands_after(std::chrono::system_clock::now()).empty());
}

void an_open_search_is_never_left()
{
    AutomixHarness automix;
    automix.harness.http.route("/api/search?q=kneecap", kSearchJson);
    RecordingSink results;
    automix.harness.source->search("kneecap", results);
    const auto later = std::chrono::system_clock::now() + 10s;

    CRATE_CHECK(automix.commands_after(later).empty());
    const auto queued = automix.commands_after(later + 31s);

    CRATE_CHECK(queued == std::vector<std::string>{"playlist_add \"netsearch://plugin-Crate/a\""});
}

void opening_a_folder_ends_the_search()
{
    AutomixHarness automix;
    automix.harness.http.route("/api/search?q=kneecap", kSearchJson);
    automix.harness.http.route("/api/vdj/catalog/folders/crate%3Agenre%3A1", folder_page_json("track-9", ""));
    RecordingSink results;
    automix.harness.source->search("kneecap", results);
    RecordingSink folder;
    automix.harness.source->folder("crate:genre:1", folder);

    CRATE_CHECK(automix.commands_after(std::chrono::system_clock::now() + 10s) == std::vector<std::string>{kGoToAutomix});
}

void an_unknown_browser_folder_is_never_left()
{
    AutomixHarness automix;
    automix.harness.host.browsed_folder.clear();

    const auto commands = automix.commands_after(kPlayStart);

    CRATE_CHECK(commands == std::vector<std::string>{"playlist_add \"netsearch://plugin-Crate/a\""});
}

void automix_does_nothing_without_permission_or_with_automix_off()
{
    Harness without_automation;
    without_automation.http.route("/api/tracks/by-entity/seed/compatible", compatible_json("seed", {{"a", "Band A", "Album A"}}));
    without_automation.host.decks[1] = DeckReading{crate_path("seed"), true, 10'000, 200'000};
    without_automation.source->tick(kPlayStart);
    CRATE_CHECK(without_automation.host.commands.empty());

    AutomixHarness stopped;
    stopped.harness.host.automix = false;
    CRATE_CHECK(stopped.commands_after(kPlayStart).empty());
}

void camelot_keys_map_to_virtualdj_keys()
{
    CRATE_CHECK(vdj_key_from_camelot("8A") == vdj_key_number("A", "minor"));
    CRATE_CHECK(vdj_key_from_camelot("8B") == vdj_key_number("C", "major"));
    CRATE_CHECK(vdj_key_from_camelot("1A") == vdj_key_number("G#", "minor"));
    CRATE_CHECK(vdj_key_from_camelot("12B") == vdj_key_number("E", "major"));
    CRATE_CHECK(vdj_key_from_camelot("13A") == 0);
    CRATE_CHECK(vdj_key_from_camelot("") == 0);
}

void keys_and_cover_urls_map_to_virtualdj()
{
    CRATE_CHECK(vdj_key_number("C", "major") == 16);
    CRATE_CHECK(vdj_key_number("Bb", "minor") == 2);
    CRATE_CHECK(vdj_key_number("H", "minor") == 0);
    CRATE_CHECK(api_asset_url(kOrigin, "/api/cover") == std::string(kOrigin) + "/api/cover");
    CRATE_CHECK(api_asset_url(kOrigin, "https://cdn.example.org/a.jpg") == "https://cdn.example.org/a.jpg");
    CRATE_CHECK(api_asset_url(kOrigin, "http://cdn.example.org/a.jpg").empty());
}

} // namespace

void run(const char* name, void (*test)())
{
    std::printf("%s\n", name);
    std::fflush(stdout);
    try {
        test();
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s threw: %s\n", name, error.what());
        std::exit(EXIT_FAILURE);
    }
}

int main()
{
    run("search_publishes_tracks_once_with_absolute_covers", search_publishes_tracks_once_with_absolute_covers);
    run("a_new_search_supersedes_one_in_flight", a_new_search_supersedes_one_in_flight);
    run("cancel_search_leaves_the_list_untouched", cancel_search_leaves_the_list_untouched);
    run("a_cancel_after_the_response_does_not_publish", a_cancel_after_the_response_does_not_publish);
    run("a_disconnected_source_finishes_empty_lists", a_disconnected_source_finishes_empty_lists);
    run("folder_pages_are_published_together", folder_pages_are_published_together);
    run("a_new_folder_cancels_one_still_paging", a_new_folder_cancels_one_still_paging);
    run("folder_list_adds_the_compatible_folder", folder_list_adds_the_compatible_folder);
    run("current_compatible_folder_without_a_crate_track_is_empty", current_compatible_folder_without_a_crate_track_is_empty);
    run("an_unknown_track_only_offers_compatible_tracks", an_unknown_track_only_offers_compatible_tracks);
    run("a_listed_track_offers_its_artist_and_album", a_listed_track_offers_its_artist_and_album);
    run("names_with_quotes_fall_back_to_a_text_search", names_with_quotes_fall_back_to_a_text_search);
    run("a_track_that_cannot_load_says_why", a_track_that_cannot_load_says_why);
    run("a_ready_track_resolves_to_a_ticketed_stream", a_ready_track_resolves_to_a_ticketed_stream);
    run("search_tracks_show_camelot_and_energy", search_tracks_show_camelot_and_energy);
    run("compatible_tracks_show_crate_fields", compatible_tracks_show_crate_fields);
    run("a_seed_without_profile_shows_a_notice", a_seed_without_profile_shows_a_notice);
    run("camelot_keys_map_to_virtualdj_keys", camelot_keys_map_to_virtualdj_keys);
    run("plays_are_reported_with_the_track_names", plays_are_reported_with_the_track_names);
    run("plays_wait_in_the_spool_until_crate_answers", plays_wait_in_the_spool_until_crate_answers);
    run("decks_beyond_the_layout_are_not_read", decks_beyond_the_layout_are_not_read);
    run("automix_lists_a_track_in_vdj_before_queueing_it", automix_lists_a_track_in_vdj_before_queueing_it);
    run("automix_chains_the_second_track_from_the_first_and_never_repeats_an_album", automix_chains_the_second_track_from_the_first_and_never_repeats_an_album);
    run("automix_waits_while_two_tracks_are_queued", automix_waits_while_two_tracks_are_queued);
    run("a_manual_change_puts_a_fitting_track_right_next", a_manual_change_puts_a_fitting_track_right_next);
    run("a_track_coming_from_the_queue_is_not_a_manual_change", a_track_coming_from_the_queue_is_not_a_manual_change);
    run("a_track_is_queued_anyway_if_vdj_never_lists_the_folder", a_track_is_queued_anyway_if_vdj_never_lists_the_folder);
    run("a_busy_browser_is_never_moved", a_busy_browser_is_never_moved);
    run("an_unknown_browser_folder_is_never_left", an_unknown_browser_folder_is_never_left);
    run("an_open_search_is_never_left", an_open_search_is_never_left);
    run("opening_a_folder_ends_the_search", opening_a_folder_ends_the_search);
    run("automix_does_nothing_without_permission_or_with_automix_off", automix_does_nothing_without_permission_or_with_automix_off);
    run("a_track_opens_its_album_in_listen", a_track_opens_its_album_in_listen);
    run("open_in_crate_needs_a_listen_url", open_in_crate_needs_a_listen_url);
    run("keys_and_cover_urls_map_to_virtualdj", keys_and_cover_urls_map_to_virtualdj);
}
