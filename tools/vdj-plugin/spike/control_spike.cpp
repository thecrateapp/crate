#include "vdjOnlineSource.h"
#include "vdjPlugin8.h"

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/catalog_client.hpp"
#include "crate_vdj/compatible_tracks.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/metadata_cache.hpp"
#include "crate_vdj/search_client.hpp"
#include "crate_vdj/stream_resolver.hpp"
#include "crate_vdj/translations.hpp"
#include "crate_vdj/vdj_track_path.hpp"
#include "crate_vdj/version.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#ifndef E_FAIL
#define E_FAIL ((HRESULT)0x80004005L)
#endif

namespace {

using namespace crate::vdj;

constexpr int kPlayCommand = 1;
constexpr int kSyncCommand = 2;
constexpr int kAutoBpmTransitionCommand = 3;
constexpr int kAutoCrossfadeCommand = 4;
constexpr std::string_view kCompatibleFolderPrefix = "crate:compatible:";
constexpr std::string_view kCurrentCompatibleFolderId =
    "crate:compatible:current";
constexpr std::string_view kOnlineSourceFolderId = "Crate";

std::mutex g_log_mutex;

std::filesystem::path log_path()
{
    if (const char* configured = std::getenv("CRATE_VDJ_SPIKE_LOG");
        configured != nullptr && configured[0] != '\0') {
        return configured;
    }

    return std::filesystem::temp_directory_path() /
           "crate-vdj-control-spike.log";
}

void trace(const std::string& message)
{
    std::lock_guard lock(g_log_mutex);
    std::ofstream output(log_path(), std::ios::app);
    if (output.is_open()) {
        output << crate::vdj::redact_secrets(message) << '\n';
    }
}

std::string guid_string(const GUID& guid)
{
    char formatted[64] = {};
    std::snprintf(
        formatted,
        sizeof(formatted),
        "%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x",
        static_cast<unsigned int>(guid.Data1),
        static_cast<unsigned int>(guid.Data2),
        static_cast<unsigned int>(guid.Data3),
        static_cast<unsigned int>(guid.Data4[0]),
        static_cast<unsigned int>(guid.Data4[1]),
        static_cast<unsigned int>(guid.Data4[2]),
        static_cast<unsigned int>(guid.Data4[3]),
        static_cast<unsigned int>(guid.Data4[4]),
        static_cast<unsigned int>(guid.Data4[5]),
        static_cast<unsigned int>(guid.Data4[6]),
        static_cast<unsigned int>(guid.Data4[7])
    );
    return formatted;
}

std::string result_message(const char* operation, HRESULT result)
{
    return std::string(operation) + " result=" +
           std::to_string(static_cast<long>(result));
}

std::string language_from_vdj(IVdjPlugin8* plugin)
{
    if (plugin == nullptr || plugin->cb == nullptr) {
        return "English";
    }

    std::array<char, 128> language = {};
    const HRESULT result = plugin->GetStringInfo(
        "setting 'language'",
        language.data(),
        static_cast<int>(language.size())
    );
    trace(
        "vdj language query result=" +
        std::to_string(static_cast<long>(result)) +
        " value=" + language.data()
    );
    if (result != S_OK || language[0] == '\0') {
        return "English";
    }
    return language.data();
}

std::string compatible_folder_navigation_command(std::string_view language)
{
    return "browser_gotofolder \"onlinemusic:/" +
        std::string(kOnlineSourceFolderId) + "/" +
        std::string(crate::vdj::compatible_folder_label(language)) + "\"";
}

#if defined(VDJ_MAC)
char* crate_bitmap(CFBundleRef bundle)
{
    static std::string path;
    if (path.empty() && bundle != nullptr) {
        auto* resource_url = CFBundleCopyResourceURL(
            bundle,
            CFSTR("crate-icon.bmp"),
            nullptr,
            nullptr
        );
        if (resource_url != nullptr) {
            char buffer[4096] = {};
            if (CFURLGetFileSystemRepresentation(
                    resource_url,
                    true,
                    reinterpret_cast<UInt8*>(buffer),
                    sizeof(buffer)
                )) {
                path = buffer;
            }
            CFRelease(resource_url);
        }
    }
    return path.empty() ? nullptr : path.data();
}
#endif

int vdj_key_number(const crate::vdj::SearchTrack& track)
{
    std::string key = track.audio_key;
    std::transform(
        key.begin(),
        key.end(),
        key.begin(),
        [](unsigned char character) {
            return static_cast<char>(std::toupper(character));
        }
    );
    if (key == "BB") {
        key = "A#";
    } else if (key == "DB") {
        key = "C#";
    } else if (key == "EB") {
        key = "D#";
    } else if (key == "GB") {
        key = "F#";
    } else if (key == "AB") {
        key = "G#";
    }

    const bool minor = track.audio_scale == "minor" ||
        track.audio_scale == "Minor" || track.audio_scale == "m";
    static constexpr std::array<std::string_view, 12> keys = {
        "A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#",
    };
    for (std::size_t index = 0; index < keys.size(); ++index) {
        if (keys[index] == key) {
            return static_cast<int>(index + 1 + (minor ? 0 : 12));
        }
    }
    return 0;
}

class ControlSpike final : public IVdjPluginStartStop8 {
public:
    HRESULT VDJ_API OnLoad() override
    {
        trace("control factory plugin loaded");
        if (cb == nullptr) {
            return E_FAIL;
        }

        DeclareParameterCommand(
            play_command_, kPlayCommand, "Play deck 1", "Play", sizeof(play_command_)
        );
        DeclareParameterCommand(
            sync_command_, kSyncCommand, "Sync deck 1", "Sync", sizeof(sync_command_)
        );
        DeclareParameterCommand(
            auto_bpm_transition_command_,
            kAutoBpmTransitionCommand,
            "Auto BPM transition",
            "Auto BPM",
            sizeof(auto_bpm_transition_command_)
        );
        DeclareParameterCommand(
            auto_crossfade_command_,
            kAutoCrossfadeCommand,
            "Auto crossfade",
            "Crossfade",
            sizeof(auto_crossfade_command_)
        );

        return S_OK;
    }

    HRESULT VDJ_API OnGetPluginInfo(TVdjPluginInfo8* info) override
    {
        trace("control plugin info callback");
        if (info == nullptr) {
            return E_FAIL;
        }

        info->PluginName = "Crate Control Spike";
        info->Author = "Crate";
        info->Description = "VirtualDJ command and state boundary probe";
        info->Version = crate::vdj::kPluginVersion.data();
        info->Bitmap = nullptr;
        info->Flags = 0;
        return S_OK;
    }

    HRESULT VDJ_API OnStart() override
    {
        trace("control spike started");
        return observe_state();
    }

    HRESULT VDJ_API OnStop() override
    {
        trace("control spike stopped");
        return S_OK;
    }

    HRESULT VDJ_API OnParameter(int id) override
    {
        switch (id) {
        case kPlayCommand:
            return execute("deck 1 play", "play");
        case kSyncCommand:
            return execute("deck 1 sync", "sync");
        case kAutoBpmTransitionCommand:
            return execute("deck 1 auto_bpm_transition", "auto_bpm_transition");
        case kAutoCrossfadeCommand:
            return execute("deck 1 auto_crossfade", "auto_crossfade");
        default:
            return E_NOTIMPL;
        }
    }

private:
    HRESULT observe_state()
    {
        if (cb == nullptr) {
            return E_FAIL;
        }

        double current_deck = 0;
        double bpm = 0;
        double beat_position = 0;
        double elapsed_time_ms = 0;

        const HRESULT deck_result = GetInfo("get_deck", &current_deck);
        const HRESULT bpm_result = GetInfo("deck 1 get_bpm", &bpm);
        const HRESULT beat_result = GetInfo("deck 1 get_beatpos", &beat_position);
        const HRESULT time_result = GetInfo("deck 1 get_time_ms", &elapsed_time_ms);

        trace(
            "state deck=" + std::to_string(current_deck) +
            " bpm=" + std::to_string(bpm) +
            " beat_position=" + std::to_string(beat_position) +
            " elapsed_time_ms=" + std::to_string(elapsed_time_ms) +
            " results=" + std::to_string(static_cast<long>(deck_result)) + "," +
            std::to_string(static_cast<long>(bpm_result)) + "," +
            std::to_string(static_cast<long>(beat_result)) + "," +
            std::to_string(static_cast<long>(time_result))
        );

        return deck_result == S_OK && bpm_result == S_OK &&
                       beat_result == S_OK && time_result == S_OK
                   ? S_OK
                   : S_FALSE;
    }

    HRESULT execute(const char* command, const char* operation)
    {
        if (cb == nullptr) {
            return E_FAIL;
        }

        const HRESULT result = SendCommand(command);
        trace(result_message(operation, result));
        observe_state();
        return result;
    }

    char play_command_[1] = {};
    char sync_command_[1] = {};
    char auto_bpm_transition_command_[1] = {};
    char auto_crossfade_command_[1] = {};
};

class OnlineSourceProbe final : public IVdjPluginOnlineSource {
public:
    OnlineSourceProbe()
        : credentials_(
              "org.cratemusic.virtualdj",
              "access-token"
          )
        , metadata_cache_(metadata_cache_path().string())
        , search_client_(
              http_,
              credentials_,
              api_origin(),
              &metadata_cache_
          )
        , stream_resolver_(
              http_,
              credentials_,
              api_origin()
          )
        , catalog_client_(
              http_,
              credentials_,
              api_origin(),
              &metadata_cache_
          )
        , compatible_tracks_client_(
              http_,
              credentials_,
              api_origin()
          )
    {
    }

    HRESULT VDJ_API OnLoad() override
    {
        trace("online source plugin loaded origin=" + api_origin());
        return S_OK;
    }

    HRESULT VDJ_API OnGetPluginInfo(TVdjPluginInfo8* info) override
    {
        if (info == nullptr) {
            return E_FAIL;
        }

        info->PluginName = "Crate";
        info->Author = "Crate";
        info->Description = "Crate catalog Online Source";
        info->Version = crate::vdj::kPluginVersion.data();
#if defined(VDJ_MAC)
        info->Bitmap = crate_bitmap(hInstance);
        trace(
            "online plugin info name=Crate bitmap=" +
            std::string(info->Bitmap == nullptr ? "" : info->Bitmap)
        );
#else
        info->Bitmap = nullptr;
#endif
        info->Flags = 0;
        return S_OK;
    }

    HRESULT VDJ_API IsLogged() override
    {
        trace("online login state callback");
        return E_NOTIMPL;
    }

    HRESULT VDJ_API OnLogin() override
    {
        trace("online login callback");
        return E_NOTIMPL;
    }

    HRESULT VDJ_API OnLogout() override
    {
        trace("online logout callback");
        return E_NOTIMPL;
    }

    HRESULT VDJ_API OnSearch(
        const char* search,
        IVdjTracksList* tracks_list
    ) override
    {
        trace(
            "online search callback query=" +
            std::string(search == nullptr ? "" : search)
        );
        if (tracks_list == nullptr) {
            trace("online search rejected: null tracks list");
            return E_FAIL;
        }

        const std::string query = search == nullptr ? "" : search;
        CancellationSource cancellation;
        {
            std::lock_guard lock(search_mutex_);
            active_search_ = cancellation;
        }

        const auto result = search_client_.search(query, cancellation.token());
        {
            std::lock_guard lock(search_mutex_);
            active_search_.reset();
        }

        if (cancellation.token().cancelled()) {
            trace("online search cancelled query=" + query);
            return S_FALSE;
        }
        if (!result.ok()) {
            trace("online search failed query=" + query + " error=" +
                  redact_sensitive(result.error));
            return E_FAIL;
        }

        for (const auto& track : result.value->tracks) {
            const char* artist = track.artist.empty()
                ? nullptr
                : track.artist.c_str();
            const char* genre = track.genre.empty()
                ? nullptr
                : track.genre.c_str();
            const char* album = track.album.empty()
                ? nullptr
                : track.album.c_str();
            const std::string cover_url = track.cover_url.empty()
                ? ""
                : api_asset_url(track.cover_url);
            tracks_list->add(
                track.entity_uid.c_str(),
                track.title.c_str(),
                artist,
                nullptr,
                genre,
                "Crate",
                album,
                cover_url.empty() ? nullptr : cover_url.c_str(),
                nullptr,
                static_cast<float>(track.duration_seconds),
                static_cast<float>(track.bpm),
                vdj_key_number(track),
                track.year,
                false,
                false
            );
        }
        tracks_list->finish();
        trace("online search finished query=" + query + " tracks=" +
              std::to_string(result.value->tracks.size()));
        return S_OK;
    }

    HRESULT VDJ_API OnSearchCancel() override
    {
        trace("online search cancel callback");
        std::lock_guard lock(search_mutex_);
        if (active_search_.has_value()) {
            active_search_->cancel();
        }
        return S_OK;
    }

    HRESULT VDJ_API GetStreamUrl(
        const char* unique_id,
        IVdjString& url,
        IVdjString& error_message
    ) override
    {
        const std::string id = unique_id == nullptr ? "" : unique_id;
        CancellationSource cancellation;
        const auto result = stream_resolver_.resolve(id, cancellation.token());
        if (!result.ok()) {
            const std::string error = redact_sensitive(result.error);
            url = "";
            error_message = error.c_str();
            trace(
                "stream URL resolution failed id=" + id + " error=" +
                error
            );
            return E_FAIL;
        }

        url = result.value->c_str();
        error_message = "";
        trace("stream URL resolved id=" + id);
        return S_OK;
    }

    HRESULT VDJ_API GetFolderList(IVdjSubfoldersList* subfolders_list) override
    {
        trace("online folder list callback");
        if (subfolders_list == nullptr) {
            trace("online folder list rejected: null subfolders list");
            return E_FAIL;
        }

        CancellationSource cancellation;
        const auto result = catalog_client_.list_folders(cancellation.token());
        if (!result.ok()) {
            trace(
                "online folder list failed error=" +
                redact_sensitive(result.error)
            );
            return E_FAIL;
        }
        const std::string language = language_from_vdj(this);
        for (const auto& folder : result.value->folders) {
            const std::string folder_label =
                crate::vdj::catalog_folder_label(
                    folder.id,
                    folder.name,
                    language
                );
            subfolders_list->add(folder.id.c_str(), folder_label.c_str());
        }
        const std::string_view folder_label =
            crate::vdj::compatible_folder_label(language);
        subfolders_list->add(
            std::string(kCurrentCompatibleFolderId).c_str(),
            folder_label.data()
        );
        return S_OK;
    }

    HRESULT VDJ_API GetFolder(
        const char* folder_unique_id,
        IVdjTracksList* tracks_list
    ) override
    {
        trace(
            "online folder callback id=" +
            std::string(folder_unique_id == nullptr ? "" : folder_unique_id)
        );
        if (folder_unique_id == nullptr || tracks_list == nullptr) {
            trace("online folder rejected: null argument");
            return E_FAIL;
        }

        const std::string folder_id = folder_unique_id;
        if (folder_id == kCurrentCompatibleFolderId) {
            std::string seed_uid;
            {
                std::lock_guard lock(compatible_mutex_);
                if (active_compatible_seed_.has_value()) {
                    seed_uid = std::move(*active_compatible_seed_);
                    active_compatible_seed_.reset();
                }
            }
            if (seed_uid.empty()) {
                const auto current_track = current_crate_track_uid();
                if (!current_track.has_value()) {
                    tracks_list->finish();
                    return S_OK;
                }
                seed_uid = *current_track;
            }
            return get_compatible_folder(std::move(seed_uid), tracks_list);
        }
        if (folder_id.starts_with(kCompatibleFolderPrefix)) {
            return get_compatible_folder(
                folder_id.substr(kCompatibleFolderPrefix.size()),
                tracks_list
            );
        }

        CancellationSource cancellation;
        std::string cursor;
        constexpr int kMaxFolderPages = 5;
        for (int page = 0; page < kMaxFolderPages; ++page) {
            const auto result = catalog_client_.get_folder(
                folder_unique_id,
                cursor,
                cancellation.token()
            );
            if (!result.ok()) {
                trace(
                    "online folder failed id=" + std::string(folder_unique_id) +
                    " error=" + redact_sensitive(result.error)
                );
                return E_FAIL;
            }
            for (const auto& track : result.value->tracks) {
                add_track(tracks_list, track);
            }
            if (!result.value->next_cursor.has_value()) {
                break;
            }
            cursor = *result.value->next_cursor;
        }
        tracks_list->finish();
        return S_OK;
    }

    HRESULT VDJ_API GetContextMenu(
        const char* unique_id,
        IVdjContextMenu* context_menu
    ) override
    {
        if (unique_id == nullptr || context_menu == nullptr) {
            return E_FAIL;
        }

        const std::string language = language_from_vdj(this);
        context_menu->add(crate::vdj::compatible_menu_label(language).data());
        context_menu->add(crate::vdj::open_in_crate_menu_label(language).data());
        return S_OK;
    }

    HRESULT VDJ_API OnContextMenu(
        const char* unique_id,
        size_t menu_index
    ) override
    {
        if (unique_id == nullptr) {
            return E_FAIL;
        }
        trace(
            "track context menu id=" + std::string(unique_id) +
            " index=" + std::to_string(menu_index)
        );
        if (menu_index == 0) {
            if (cb == nullptr) {
                trace("compatible tracks navigation failed: null callbacks");
                return E_FAIL;
            }
            const std::string command = compatible_folder_navigation_command(
                language_from_vdj(this)
            );
            {
                std::lock_guard lock(compatible_mutex_);
                active_compatible_seed_ = unique_id;
                if (active_compatible_request_.has_value()) {
                    active_compatible_request_->cancel();
                    active_compatible_request_.reset();
                }
                ++compatible_request_generation_;
            }
            trace("compatible tracks folder selected seed=" +
                  std::string(unique_id));
            const HRESULT result = SendCommand(command.c_str());
            trace(
                "compatible tracks navigation command result=" +
                std::to_string(static_cast<long>(result))
            );
            return result;
        }
        if (menu_index == 1) {
            return S_OK;
        }
        return E_NOTIMPL;
    }

private:
    std::optional<std::string> current_crate_track_uid()
    {
        if (cb == nullptr) {
            trace("compatible tracks unavailable reason=null callbacks");
            return std::nullopt;
        }

        std::array<char, 4096> filepath = {};
        if (GetStringInfo(
                "get_filepath",
                filepath.data(),
                static_cast<int>(filepath.size())
            ) != S_OK || filepath[0] == '\0') {
            trace("compatible tracks unavailable reason=no_playing_track");
            return std::nullopt;
        }

        const auto track_uid = crate_uid_from_vdj_filepath(filepath.data());
        if (!track_uid.has_value()) {
            trace(
                "compatible tracks unavailable reason=playing_track_not_from_crate"
            );
        }
        return track_uid;
    }

    HRESULT get_compatible_folder(
        std::string seed_uid,
        IVdjTracksList* tracks_list
    )
    {
        if (seed_uid.empty()) {
            tracks_list->finish();
            return S_OK;
        }

        CancellationSource cancellation;
        std::uint64_t request_generation = 0;
        {
            std::lock_guard lock(compatible_mutex_);
            if (active_compatible_request_.has_value()) {
                active_compatible_request_->cancel();
            }
            active_compatible_request_ = cancellation;
            request_generation = ++compatible_request_generation_;
        }

        const auto result = compatible_tracks_client_.fetch(
            seed_uid,
            cancellation.token()
        );
        {
            std::lock_guard lock(compatible_mutex_);
            if (request_generation != compatible_request_generation_ ||
                cancellation.token().cancelled()) {
                return S_FALSE;
            }
            active_compatible_request_.reset();
        }
        if (!result.ok()) {
            trace(
                "compatible tracks failed seed=" + seed_uid +
                " error=" + redact_sensitive(result.error)
            );
            return E_FAIL;
        }
        if (result.value->fallback_reason.has_value()) {
            trace(
                "compatible tracks unavailable seed=" + seed_uid +
                " reason=" + *result.value->fallback_reason
            );
        }
        for (const auto& compatible : result.value->items) {
            auto track = compatible_track_as_search_track(compatible);
            add_track(
                tracks_list,
                track,
                "Album: " + track.album + " | " +
                    compatible_track_comment(compatible)
            );
        }
        tracks_list->finish();
        return S_OK;
    }

    static void add_track(
        IVdjTracksList* tracks_list,
        const SearchTrack& track,
        std::string comment = {}
    )
    {
        const char* artist = track.artist.empty()
            ? nullptr
            : track.artist.c_str();
        const char* genre = track.genre.empty()
            ? nullptr
            : track.genre.c_str();
        const char* album = track.album.empty()
            ? nullptr
            : track.album.c_str();
        const char* cover = track.cover_url.empty()
            ? nullptr
            : track.cover_url.c_str();
        tracks_list->add(
            track.entity_uid.c_str(),
            track.title.c_str(),
            artist,
            nullptr,
            genre,
            "Crate",
            comment.empty() ? album : comment.c_str(),
            cover,
            nullptr,
            static_cast<float>(track.duration_seconds),
            static_cast<float>(track.bpm),
            vdj_key_number(track),
            track.year,
            false,
            false
        );
    }

    static std::string api_asset_url(std::string_view path)
    {
        if (path.starts_with("http://") || path.starts_with("https://")) {
            return std::string(path);
        }
        return api_origin() +
            (path.starts_with('/') ? std::string(path) : "/" + std::string(path));
    }

    static std::string api_origin()
    {
        const char* configured = std::getenv("CRATE_VDJ_API_ORIGIN");
        if (configured != nullptr && configured[0] != '\0') {
            return configured;
        }
        return "https://api.lespedants.org";
    }

    static std::filesystem::path metadata_cache_path()
    {
        if (const char* configured = std::getenv("CRATE_VDJ_METADATA_CACHE");
            configured != nullptr && configured[0] != '\0') {
            return configured;
        }

#if defined(VDJ_WIN)
        if (const char* app_data = std::getenv("APPDATA");
            app_data != nullptr && app_data[0] != '\0') {
            return std::filesystem::path(app_data) /
                "VirtualDJ" / "Cache" / "crate-metadata.sqlite";
        }
#else
        if (const char* home = std::getenv("HOME");
            home != nullptr && home[0] != '\0') {
            return std::filesystem::path(home) /
                "Library/Application Support/VirtualDJ/Cache/"
                "crate-metadata.sqlite";
        }
#endif
        return std::filesystem::temp_directory_path() /
            "crate-vdj-metadata.sqlite";
    }

    CurlHttpClient http_;
    SystemCredentialStore credentials_;
    MetadataCacheStore metadata_cache_;
    SearchClient search_client_;
    StreamResolver stream_resolver_;
    CatalogClient catalog_client_;
    CompatibleTracksClient compatible_tracks_client_;
    std::mutex search_mutex_;
    std::optional<CancellationSource> active_search_;
    std::mutex compatible_mutex_;
    std::optional<std::string> active_compatible_seed_;
    std::optional<CancellationSource> active_compatible_request_;
    std::uint64_t compatible_request_generation_ = 0;

};

} // namespace

extern "C" VDJ_EXPORT HRESULT VDJ_API DllGetClassObject(
    const GUID& class_id,
    const GUID& interface_id,
    void** object
)
{
    if (object == nullptr ||
        std::memcmp(&class_id, &CLSID_VdjPlugin8, sizeof(GUID)) != 0) {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    const char* requested_interface = "unknown";
    if (std::memcmp(
            &interface_id,
            &IID_IVdjPluginBasic8,
            sizeof(GUID)
        ) == 0) {
        requested_interface = "basic8";
    } else if (std::memcmp(
                   &interface_id,
                   &IID_IVdjPluginOnlineSource,
                   sizeof(GUID)
               ) == 0) {
        requested_interface = "online-source";
    } else if (std::memcmp(
                   &interface_id,
                   &IID_IVdjPluginStartStop8,
                   sizeof(GUID)
               ) == 0) {
        requested_interface = "start-stop8";
    }
    trace(
        std::string("factory request plugin=") +
#if defined(CRATE_VDJ_ONLINE_SOURCE_PLUGIN)
        "online-source"
#else
        "control"
#endif
        + " interface=" + requested_interface +
        " guid=" + guid_string(interface_id)
    );

#if defined(CRATE_VDJ_ONLINE_SOURCE_PLUGIN)
    if (std::memcmp(
            &interface_id,
            &IID_IVdjPluginBasic8,
            sizeof(GUID)
        ) == 0 ||
        std::memcmp(
            &interface_id,
            &IID_IVdjPluginOnlineSource,
            sizeof(GUID)
        ) == 0) {
        *object = new OnlineSourceProbe();
        return S_OK;
    }
#else
    if (std::memcmp(
            &interface_id,
            &IID_IVdjPluginOnlineSource,
            sizeof(GUID)
        ) == 0) {
        *object = new OnlineSourceProbe();
        return S_OK;
    }

    if (std::memcmp(
            &interface_id,
            &IID_IVdjPluginBasic8,
            sizeof(GUID)
        ) == 0 ||
        std::memcmp(
            &interface_id,
            &IID_IVdjPluginStartStop8,
            sizeof(GUID)
        ) == 0) {
        *object = new ControlSpike();
        return S_OK;
    }
#endif

    trace("factory request rejected");
    return CLASS_E_CLASSNOTAVAILABLE;
}
