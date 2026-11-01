#include "crate_vdj/online_source.hpp"

#include "../support/check.hpp"
#include "../support/connection_fakes.hpp"
#include "../support/scripted_http.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <functional>
#include <future>
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
        std::lock_guard lock(mutex_);
        routes_.emplace_back(prefix, HttpResponse{.status_code = 200, .body = std::move(body)});
    }

    HttpResult request(const HttpRequest& request) override
    {
        const std::string path = request.url.substr(std::string(kOrigin).size());
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
            for (const auto& [prefix, response] : routes_) {
                if (path.starts_with(prefix)) {
                    result = response;
                    break;
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
    std::mutex mutex_;
    std::vector<std::pair<std::string, HttpResult>> routes_;
    std::atomic<int> gated_ = 0;
};

class FakeHost final : public HostPort {
public:
    std::optional<std::string> track_path;
    std::vector<std::string> commands;

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

struct Harness {
    std::shared_ptr<SharedVault> vault = std::make_shared<SharedVault>();
    MemorySettingsStore settings;
    RoutedHttp http;
    FakeHost host;
    FakeUi ui;
    std::filesystem::path cache_path =
        std::filesystem::temp_directory_path() / "crate-vdj-online-source-test.sqlite";
    std::unique_ptr<OnlineSource> source;

    explicit Harness(bool connected = true)
    {
        std::filesystem::remove(cache_path);
        http.route("/api/auth/me", me_json());
        http.route("/api/capabilities", capabilities_json());
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
            .host = host,
            .ui = ui,
            .log = {},
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
        std::filesystem::remove(cache_path);
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

void the_menu_offers_compatible_tracks_only()
{
    Harness harness;

    const auto entries = harness.source->context_menu();
    CRATE_CHECK(entries.size() == 1);
    CRATE_CHECK(harness.source->select_context_menu("track-1", 1) == CallbackStatus::NotImplemented);
    CRATE_CHECK(harness.source->select_context_menu("track-1", 0) == CallbackStatus::Done);
    CRATE_CHECK(harness.host.commands.size() == 1);
    CRATE_CHECK(harness.host.commands[0] == compatible_folder_navigation_command("English"));
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

int main()
{
    search_publishes_tracks_once_with_absolute_covers();
    a_new_search_supersedes_one_in_flight();
    cancel_search_leaves_the_list_untouched();
    a_cancel_after_the_response_does_not_publish();
    a_disconnected_source_finishes_empty_lists();
    folder_pages_are_published_together();
    a_new_folder_cancels_one_still_paging();
    folder_list_adds_the_compatible_folder();
    current_compatible_folder_without_a_crate_track_is_empty();
    the_menu_offers_compatible_tracks_only();
    keys_and_cover_urls_map_to_virtualdj();
}
