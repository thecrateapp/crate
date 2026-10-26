#include "vdjOnlineSource.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <functional>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#if defined(__APPLE__)
#include <pthread.h>
#endif

#ifndef E_FAIL
#define E_FAIL ((HRESULT)0x80004005L)
#endif

#include "probe_platform.hpp"

namespace {

constexpr const char* kServerOrigin = "http://127.0.0.1:8765";
constexpr const char* kBundleName = "CrateProbe";
constexpr const char* kPluginName = "Crate Probe";
constexpr auto kHeartbeatInterval = std::chrono::seconds(30);

std::mutex g_log_mutex;
const auto g_started = std::chrono::steady_clock::now();

std::filesystem::path probe_directory()
{
#if defined(_WIN32)
    if (const char* local = std::getenv("LOCALAPPDATA"); local != nullptr) {
        return std::filesystem::path(local) / "VirtualDJ" / "CrateProbe";
    }
#else
    if (const char* home = std::getenv("HOME"); home != nullptr) {
        return std::filesystem::path(home) / "Library" / "Application Support" /
               "VirtualDJ" / "CrateProbe";
    }
#endif
    return std::filesystem::temp_directory_path() / "CrateProbe";
}

std::string json_escape(const std::string& value)
{
    std::string escaped;
    escaped.reserve(value.size() + 8);
    for (const unsigned char character : value) {
        switch (character) {
        case '"':
            escaped += "\\\"";
            break;
        case '\\':
            escaped += "\\\\";
            break;
        case '\n':
            escaped += "\\n";
            break;
        case '\r':
            escaped += "\\r";
            break;
        case '\t':
            escaped += "\\t";
            break;
        default:
            if (character < 0x20) {
                char buffer[8];
                std::snprintf(buffer, sizeof(buffer), "\\u%04x", character);
                escaped += buffer;
            } else {
                escaped += static_cast<char>(character);
            }
        }
    }
    return escaped;
}

std::string thread_label()
{
    std::ostringstream stream;
    stream << std::this_thread::get_id();
    return stream.str();
}

const char* main_thread_flag()
{
#if defined(__APPLE__)
    return pthread_main_np() != 0 ? "true" : "false";
#else
    return "null";
#endif
}

class Event {
public:
    explicit Event(std::string name) : name_(std::move(name)) {}

    Event& text(const char* key, const std::string& value)
    {
        fields_ += ",\"" + std::string(key) + "\":\"" + json_escape(value) + "\"";
        return *this;
    }

    Event& number(const char* key, double value)
    {
        std::ostringstream stream;
        stream << value;
        fields_ += ",\"" + std::string(key) + "\":" + stream.str();
        return *this;
    }

    Event& flag(const char* key, bool value)
    {
        fields_ += ",\"" + std::string(key) + "\":" + (value ? "true" : "false");
        return *this;
    }

    void write() const
    {
        const auto now = std::chrono::system_clock::now();
        const auto epoch_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()
        ).count();
        const auto uptime_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - g_started
        ).count();
        std::ostringstream line;
        line << "{\"epoch_ms\":" << epoch_ms << ",\"uptime_ms\":" << uptime_ms
             << ",\"thread\":\"" << thread_label() << "\",\"main\":"
             << main_thread_flag() << ",\"event\":\"" << json_escape(name_) << "\""
             << fields_ << "}\n";
        std::lock_guard lock(g_log_mutex);
        std::error_code error;
        std::filesystem::create_directories(probe_directory(), error);
        std::ofstream output(probe_directory() / "probe.jsonl", std::ios::app);
        output << line.str();
    }

private:
    std::string name_;
    std::string fields_;
};

class CallbackTimer {
public:
    explicit CallbackTimer(const char* callback) : callback_(callback) {}

    void finish(Event event) const
    {
        const auto elapsed = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - started_
        ).count();
        event.text("callback", callback_).number("duration_ms", elapsed).write();
    }

private:
    const char* callback_;
    std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
};

std::string media_url(const std::string& file)
{
    return std::string(kServerOrigin) + "/media/" + file +
           "?ticket=" + std::to_string(std::time(nullptr));
}

std::string local_media_path(const std::string& file)
{
    return (probe_directory() / "media" / file).string();
}

struct ProbeTrack {
    const char* id;
    const char* title;
    const char* stream;
};

constexpr ProbeTrack kSyncTracks[] = {
    {"http-short", "HTTP short 30s", "http:probe-short.wav"},
    {"http-long-throttled", "HTTP long throttled 6min", "http:probe-long-throttled.wav"},
    {"local-path", "Local absolute path", "path:probe-local.wav"},
    {"local-file-url", "Local file:// URL", "fileurl:probe-local.wav"},
};

constexpr ProbeTrack kAsyncTracks[] = {
    {"async-1", "Async folder track 1", "http:probe-short.wav"},
    {"async-2", "Async folder track 2", "http:probe-short.wav"},
};

std::string resolve_stream(const char* stream)
{
    const std::string value(stream);
    const auto colon = value.find(':');
    const std::string kind = value.substr(0, colon);
    const std::string file = value.substr(colon + 1);
    if (kind == "path") {
        return local_media_path(file);
    }
    if (kind == "fileurl") {
        return "file://" + local_media_path(file);
    }
    return media_url(file);
}

const ProbeTrack* find_track(const std::string& unique_id)
{
    for (const auto& track : kSyncTracks) {
        if (unique_id == track.id) {
            return &track;
        }
    }
    for (const auto& track : kAsyncTracks) {
        if (unique_id == track.id) {
            return &track;
        }
    }
    return nullptr;
}

void add_track(IVdjTracksList* list, const ProbeTrack& track)
{
    list->add(
        track.id,
        track.title,
        "Crate Probe",
        nullptr,
        "Probe",
        "Crate",
        "VH01 host probe",
        nullptr,
        nullptr,
        track.id == std::string("http-long-throttled") ? 360.0f : 30.0f,
        120.0f,
        0,
        2026
    );
}

class CrateProbe final : public IVdjPluginOnlineSource {
public:
    CrateProbe()
    {
        Event("constructed").write();
    }

    HRESULT VDJ_API OnLoad() override
    {
        CallbackTimer timer("OnLoad");
        heartbeat_ = std::thread([this] { heartbeat_loop(); });
        timer.finish(Event("callback"));
        return S_OK;
    }

    HRESULT VDJ_API OnGetPluginInfo(TVdjPluginInfo8* info) override
    {
        if (info == nullptr) {
            return E_FAIL;
        }
        info->PluginName = kPluginName;
        info->Author = "Crate";
        info->Description = "VH01 host probe; talks only to 127.0.0.1";
        info->Version = "0.1.0";
        info->Bitmap = nullptr;
        info->Flags = 0;
        return S_OK;
    }

    ULONG VDJ_API Release() override
    {
        Event("release_begin")
            .flag("search_in_flight", search_in_flight_.load())
            .number("workers", static_cast<double>(workers_.size()))
            .write();
        stopping_ = true;
        search_cancelled_ = true;
        const auto started = std::chrono::steady_clock::now();
        if (heartbeat_.joinable()) {
            heartbeat_.join();
        }
        {
            std::lock_guard lock(workers_mutex_);
            for (auto& worker : workers_) {
                if (worker.joinable()) {
                    worker.join();
                }
            }
        }
        Event("release_end")
            .number(
                "join_ms",
                std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - started
                ).count()
            )
            .write();
        delete this;
        return 0;
    }

    HRESULT VDJ_API IsLogged() override
    {
        CallbackTimer timer("IsLogged");
        timer.finish(Event("callback").flag("logged", logged_.load()));
        return logged_ ? S_OK : S_FALSE;
    }

    HRESULT VDJ_API OnLogin() override
    {
        CallbackTimer timer("OnLogin");
        crate_probe_open_login_window(
            [this](bool connected) {
                logged_ = connected;
                Event("login_window_closed").flag("connected", connected).write();
            },
            [](const std::string& message) {
                Event("login_window").text("detail", message).write();
            }
        );
        timer.finish(Event("callback"));
        return S_OK;
    }

    HRESULT VDJ_API OnLogout() override
    {
        CallbackTimer timer("OnLogout");
        logged_ = false;
        timer.finish(Event("callback"));
        return S_OK;
    }

    HRESULT VDJ_API OnSearch(const char* search, IVdjTracksList* tracks_list) override
    {
        CallbackTimer timer("OnSearch");
        const std::string query = search == nullptr ? "" : search;
        const auto generation = ++search_generation_;
        search_cancelled_ = false;
        if (query.rfind("async", 0) == 0) {
            spawn_worker([this, tracks_list, generation] {
                sleep_unless_stopping(std::chrono::seconds(1));
                const bool stale = generation != search_generation_.load() ||
                                   search_cancelled_.load() || stopping_.load();
                if (!stale) {
                    add_track(tracks_list, kSyncTracks[0]);
                    tracks_list->finish();
                }
                Event("search_async_finish")
                    .number("generation", static_cast<double>(generation))
                    .flag("finished", !stale)
                    .write();
            });
            timer.finish(Event("callback").text("query", query).text("mode", "async"));
            return S_FALSE;
        }
        if (query.rfind("slow", 0) == 0) {
            search_in_flight_ = true;
            int waited_ms = 0;
            while (waited_ms < 10'000 && !search_cancelled_.load() && !stopping_.load()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                waited_ms += 100;
            }
            search_in_flight_ = false;
            if (!search_cancelled_.load()) {
                add_track(tracks_list, kSyncTracks[0]);
            }
            timer.finish(
                Event("callback")
                    .text("query", query)
                    .text("mode", "slow")
                    .flag("cancelled", search_cancelled_.load())
                    .number("waited_ms", waited_ms)
            );
            return S_OK;
        }
        for (const auto& track : kSyncTracks) {
            add_track(tracks_list, track);
        }
        timer.finish(Event("callback").text("query", query).text("mode", "sync"));
        return S_OK;
    }

    HRESULT VDJ_API OnSearchCancel() override
    {
        CallbackTimer timer("OnSearchCancel");
        search_cancelled_ = true;
        timer.finish(Event("callback").flag("search_in_flight", search_in_flight_.load()));
        return S_OK;
    }

    HRESULT VDJ_API GetStreamUrl(
        const char* unique_id,
        IVdjString& url,
        IVdjString& error_message
    ) override
    {
        CallbackTimer timer("GetStreamUrl");
        const std::string id = unique_id == nullptr ? "" : unique_id;
        const ProbeTrack* track = find_track(id);
        if (track == nullptr) {
            error_message = "unknown probe track";
            timer.finish(Event("callback").text("unique_id", id).flag("resolved", false));
            return E_FAIL;
        }
        const std::string resolved = resolve_stream(track->stream);
        url = resolved.c_str();
        error_message = "";
        timer.finish(
            Event("callback")
                .text("unique_id", id)
                .text("url", resolved)
                .flag("resolved", true)
        );
        return S_OK;
    }

    HRESULT VDJ_API GetFolderList(IVdjSubfoldersList* subfolders) override
    {
        CallbackTimer timer("GetFolderList");
        subfolders->add("probe:sync", "1 Sync folder");
        subfolders->add("probe:async", "2 Async folder (finish after 1s)");
        subfolders->add("probe:tree/a/b", "3 Tree/a/b");
        subfolders->add("probe:tree>child", "4 Tree > child");
        timer.finish(Event("callback"));
        return S_OK;
    }

    HRESULT VDJ_API GetFolder(const char* folder_id, IVdjTracksList* tracks_list) override
    {
        CallbackTimer timer("GetFolder");
        const std::string id = folder_id == nullptr ? "" : folder_id;
        if (id == "probe:async") {
            const auto generation = ++folder_generation_;
            spawn_worker([this, tracks_list, generation] {
                sleep_unless_stopping(std::chrono::seconds(1));
                if (!stopping_.load()) {
                    for (const auto& track : kAsyncTracks) {
                        add_track(tracks_list, track);
                    }
                    tracks_list->finish();
                }
                Event("folder_async_finish")
                    .number("generation", static_cast<double>(generation))
                    .flag("finished", !stopping_.load())
                    .write();
            });
            timer.finish(Event("callback").text("folder_id", id).text("mode", "async"));
            return S_FALSE;
        }
        for (const auto& track : kSyncTracks) {
            add_track(tracks_list, track);
        }
        timer.finish(Event("callback").text("folder_id", id).text("mode", "sync"));
        return S_OK;
    }

    HRESULT VDJ_API GetContextMenu(const char* unique_id, IVdjContextMenu* menu) override
    {
        CallbackTimer timer("GetContextMenu");
        menu->add("Probe: log deck state (callback thread)");
        menu->add("Probe: start background queries");
        menu->add("Probe: SendCommand pitch_reset (callback thread)");
        menu->add("Probe: SendCommand pitch_reset (background thread)");
        menu->add("Probe: automix_add_next this track");
        menu->add("Probe: playlist_add this track");
        timer.finish(Event("callback").text("unique_id", unique_id == nullptr ? "" : unique_id));
        return S_OK;
    }

    HRESULT VDJ_API OnContextMenu(const char* unique_id, size_t menu_index) override
    {
        CallbackTimer timer("OnContextMenu");
        const std::string id = unique_id == nullptr ? "" : unique_id;
        switch (menu_index) {
        case 0:
            log_deck_state("callback");
            break;
        case 1:
            background_queries_ = true;
            break;
        case 2:
            send_command("deck 1 pitch_reset", "callback");
            break;
        case 3:
            spawn_worker([this] { send_command("deck 1 pitch_reset", "background"); });
            break;
        case 4:
            send_netsearch_command("automix_add_next", id);
            break;
        case 5:
            send_netsearch_command("playlist_add", id);
            break;
        default:
            break;
        }
        timer.finish(
            Event("callback")
                .text("unique_id", id)
                .number("menu_index", static_cast<double>(menu_index))
        );
        return S_OK;
    }

private:
    void heartbeat_loop()
    {
        while (!stopping_.load()) {
            Event("heartbeat").flag("background_queries", background_queries_.load()).write();
            if (background_queries_.load()) {
                log_deck_state("background");
            }
            sleep_unless_stopping(kHeartbeatInterval);
        }
    }

    void log_deck_state(const char* origin)
    {
        char version[256] = {};
        const HRESULT version_result = GetStringInfo("get_version", version, sizeof(version));
        Event event("deck_state");
        event.text("origin", origin)
            .text("version", version)
            .number("version_hr", version_result);
        for (int deck = 1; deck <= 4; ++deck) {
            char path[1024] = {};
            const std::string command = "deck " + std::to_string(deck) + " get_filepath";
            const HRESULT path_result = GetStringInfo(command.c_str(), path, sizeof(path));
            double audible = -1;
            const std::string audible_command =
                "deck " + std::to_string(deck) + " is_audible";
            const HRESULT audible_result = GetInfo(audible_command.c_str(), &audible);
            const std::string prefix = "deck" + std::to_string(deck);
            event.text((prefix + "_filepath").c_str(), path)
                .number((prefix + "_filepath_hr").c_str(), path_result)
                .number((prefix + "_audible").c_str(), audible)
                .number((prefix + "_audible_hr").c_str(), audible_result);
        }
        event.write();
    }

    void send_command(const std::string& command, const char* origin)
    {
        const HRESULT result = SendCommand(command.c_str());
        Event("send_command")
            .text("origin", origin)
            .text("command", command)
            .number("hr", result)
            .write();
    }

    void send_netsearch_command(const char* verb, const std::string& unique_id)
    {
        for (const char* name : {kBundleName, kPluginName}) {
            const std::string path =
                std::string("netsearch://plugin-") + name + "/" + unique_id;
            send_command(std::string(verb) + " \"" + path + "\"", "callback");
        }
    }

    void spawn_worker(std::function<void()> work)
    {
        std::lock_guard lock(workers_mutex_);
        workers_.emplace_back(std::move(work));
    }

    void sleep_unless_stopping(std::chrono::milliseconds duration)
    {
        const auto deadline = std::chrono::steady_clock::now() + duration;
        while (!stopping_.load() && std::chrono::steady_clock::now() < deadline) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }

    std::atomic<bool> stopping_ = false;
    std::atomic<bool> logged_ = false;
    std::atomic<bool> background_queries_ = false;
    std::atomic<bool> search_cancelled_ = false;
    std::atomic<bool> search_in_flight_ = false;
    std::atomic<unsigned> search_generation_ = 0;
    std::atomic<unsigned> folder_generation_ = 0;
    std::thread heartbeat_;
    std::mutex workers_mutex_;
    std::vector<std::thread> workers_;
};

const char* interface_name(const GUID& interface_id)
{
    if (std::memcmp(&interface_id, &IID_IVdjPluginOnlineSource, sizeof(GUID)) == 0) {
        return "online-source";
    }
    if (std::memcmp(&interface_id, &IID_IVdjPluginBasic8, sizeof(GUID)) == 0) {
        return "basic8";
    }
    return "other";
}

}  // namespace

extern "C" VDJ_EXPORT HRESULT VDJ_API DllGetClassObject(
    const GUID& class_id,
    const GUID& interface_id,
    void** object
)
{
    const std::string requested = interface_name(interface_id);
    Event("factory_request").text("interface", requested).write();
    if (object == nullptr ||
        std::memcmp(&class_id, &CLSID_VdjPlugin8, sizeof(GUID)) != 0 ||
        requested == "other") {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    *object = new CrateProbe();
    return S_OK;
}
