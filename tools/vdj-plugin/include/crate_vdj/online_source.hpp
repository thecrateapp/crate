#pragma once

#include "crate_vdj/connection_dialog.hpp"
#include "crate_vdj/connection_session.hpp"
#include "crate_vdj/connection_settings.hpp"
#include "crate_vdj/connection_worker.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/media_access_client.hpp"
#include "crate_vdj/metadata_cache.hpp"
#include "crate_vdj/models.hpp"
#include "crate_vdj/request_coordinator.hpp"

#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace crate::vdj {

struct TrackEntry {
    std::string unique_id;
    std::string title;
    std::string artist;
    std::string genre;
    std::string comment;
    std::string cover_url;
    float duration_seconds = 0;
    float bpm = 0;
    int key = 0;
    int year = 0;
};

class TrackSink {
public:
    virtual ~TrackSink() = default;
    virtual void add(const TrackEntry& track) = 0;
    virtual void finish() = 0;
};

class FolderSink {
public:
    virtual ~FolderSink() = default;
    virtual void add(const std::string& id, const std::string& name) = 0;
};

class HostPort {
public:
    virtual ~HostPort() = default;
    virtual std::string language() = 0;
    virtual std::optional<std::string> loaded_track_path() = 0;
    virtual bool send_command(const std::string& command) = 0;
};

class ConnectionUi {
public:
    virtual ~ConnectionUi() = default;
    virtual ConnectionDialogResult ask(const ConnectionDialogRequest& request) = 0;
    virtual void notify(const std::string& title, const std::string& message) = 0;
};

enum class CallbackStatus {
    Done,
    Cancelled,
    Failed,
    NotImplemented,
};

struct StreamUrl {
    std::optional<std::string> url;
    std::string error;
};

struct OnlineSourceDependencies {
    HttpClient& http;
    ConnectionSettingsStore& settings;
    ConnectionSession::CredentialFactory credentials;
    std::string metadata_cache_path;
    HostPort& host;
    ConnectionUi& ui;
    std::function<void(const std::string&)> log;
};

inline constexpr std::string_view kCurrentCompatibleFolderId = "crate:compatible:current";
inline constexpr std::string_view kCompatibleFolderPrefix = "crate:compatible:";
inline constexpr std::string_view kNoticePrefix = "crate:notice:";
inline constexpr std::string_view kNoProfileNoticeId = "crate:notice:no-profile";

int vdj_key_number(std::string_view audio_key, std::string_view audio_scale);
int vdj_key_from_camelot(std::string_view camelot);
std::string api_asset_url(const std::string& origin, std::string_view path);
std::string compatible_folder_navigation_command(std::string_view language);
std::string vdj_search_command(std::string_view field, std::string_view value);
std::string_view stream_failure_message(StreamFailure failure);

class OnlineSource {
public:
    explicit OnlineSource(OnlineSourceDependencies dependencies);
    ~OnlineSource();

    OnlineSource(const OnlineSource&) = delete;
    OnlineSource& operator=(const OnlineSource&) = delete;

    void start();
    bool logged_in() const;
    void login();
    void logout();

    CallbackStatus search(const std::string& query, TrackSink& sink);
    void cancel_search();
    StreamUrl stream_url(const std::string& unique_id);
    CallbackStatus folder_list(FolderSink& sink);
    CallbackStatus folder(const std::string& folder_id, TrackSink& sink);
    std::vector<std::string_view> context_menu(const std::string& unique_id);
    CallbackStatus select_context_menu(const std::string& unique_id, std::size_t index);

private:
    struct ServerClients;
    struct TrackFacts {
        std::string artist;
        std::string album;
    };
    enum class MenuAction {
        Compatible,
        Artist,
        Album,
    };

    void remember(const std::vector<SearchTrack>& tracks);
    std::optional<TrackFacts> facts_for(const std::string& unique_id);
    std::vector<MenuAction> menu_actions(const std::string& unique_id);

    void sync_clients();
    std::shared_ptr<ServerClients> clients();
    CallbackStatus compatible_folder(const std::string& seed_uid, TrackSink& sink);
    std::optional<std::string> current_crate_track_uid();
    void log(const std::string& message) const;

    HostPort& host_;
    ConnectionUi& ui_;
    std::function<void(const std::string&)> log_;
    UnauthorizedObserverHttpClient server_http_;
    MetadataCacheStore metadata_cache_;
    ConnectionSession session_;
    std::mutex clients_mutex_;
    std::shared_ptr<ServerClients> clients_;
    RequestCoordinator searches_;
    RequestCoordinator folders_;
    std::mutex compatible_mutex_;
    std::optional<std::string> compatible_seed_;
    std::mutex facts_mutex_;
    std::unordered_map<std::string, TrackFacts> track_facts_;
    ConnectionWorker connection_;
};

} // namespace crate::vdj
