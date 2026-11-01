#include "vdjOnlineSource.h"
#include "vdjPlugin8.h"

#include "crate_vdj/connection_dialog.hpp"
#include "crate_vdj/connection_settings.hpp"
#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/online_source.hpp"
#include "crate_vdj/version.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#ifndef E_FAIL
#define E_FAIL ((HRESULT)0x80004005L)
#endif

namespace {

using namespace crate::vdj;

std::mutex g_log_mutex;

std::filesystem::path log_path()
{
    if (const char* configured = std::getenv("CRATE_VDJ_LOG");
        configured != nullptr && configured[0] != '\0') {
        return configured;
    }
    return std::filesystem::temp_directory_path() / "crate-vdj.log";
}

void trace(const std::string& message)
{
    std::lock_guard lock(g_log_mutex);
    std::ofstream output(log_path(), std::ios::app);
    if (output.is_open()) {
        output << redact_secrets(message) << '\n';
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

#if defined(VDJ_MAC)
char* crate_bitmap(CFBundleRef bundle)
{
    static std::string path;
    if (path.empty() && bundle != nullptr) {
        auto* resource_url = CFBundleCopyResourceURL(bundle, CFSTR("crate-icon.bmp"), nullptr, nullptr);
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

const char* optional_text(const std::string& value)
{
    return value.empty() ? nullptr : value.c_str();
}

HRESULT to_hresult(CallbackStatus status)
{
    switch (status) {
    case CallbackStatus::Done:
        return S_OK;
    case CallbackStatus::Cancelled:
        return S_FALSE;
    case CallbackStatus::NotImplemented:
        return E_NOTIMPL;
    case CallbackStatus::Failed:
        break;
    }
    return E_FAIL;
}

class VdjTrackSink final : public TrackSink {
public:
    explicit VdjTrackSink(IVdjTracksList& list)
        : list_(list)
    {
    }

    void add(const TrackEntry& track) override
    {
        list_.add(
            track.unique_id.c_str(),
            track.title.c_str(),
            optional_text(track.artist),
            nullptr,
            optional_text(track.genre),
            "Crate",
            optional_text(track.comment),
            optional_text(track.cover_url),
            nullptr,
            track.duration_seconds,
            track.bpm,
            track.key,
            track.year,
            false,
            false
        );
    }

    void finish() override
    {
        list_.finish();
    }

private:
    IVdjTracksList& list_;
};

class VdjFolderSink final : public FolderSink {
public:
    explicit VdjFolderSink(IVdjSubfoldersList& list)
        : list_(list)
    {
    }

    void add(const std::string& id, const std::string& name) override
    {
        list_.add(id.c_str(), name.c_str());
    }

private:
    IVdjSubfoldersList& list_;
};

class VdjHost final : public HostPort {
public:
    explicit VdjHost(IVdjPlugin8& plugin)
        : plugin_(plugin)
    {
    }

    std::string language() override
    {
        std::array<char, 128> language = {};
        if (plugin_.cb == nullptr ||
            plugin_.GetStringInfo(
                "setting 'language'",
                language.data(),
                static_cast<int>(language.size())
            ) != S_OK ||
            language[0] == '\0') {
            return "English";
        }
        return language.data();
    }

    std::optional<std::string> loaded_track_path() override
    {
        std::array<char, 4096> filepath = {};
        if (plugin_.cb == nullptr ||
            plugin_.GetStringInfo("get_filepath", filepath.data(), static_cast<int>(filepath.size())) !=
                S_OK ||
            filepath[0] == '\0') {
            return std::nullopt;
        }
        return std::string(filepath.data());
    }

    bool send_command(const std::string& command) override
    {
        return plugin_.cb != nullptr && plugin_.SendCommand(command.c_str()) == S_OK;
    }

private:
    IVdjPlugin8& plugin_;
};

class PlatformConnectionUi final : public ConnectionUi {
public:
    ConnectionDialogResult ask(const ConnectionDialogRequest& request) override
    {
        return show_connection_dialog(request);
    }

    void notify(const std::string& title, const std::string& message) override
    {
        show_connection_message(title, message);
    }
};

class CrateOnlineSource final : public IVdjPluginOnlineSource {
public:
    CrateOnlineSource()
        : settings_(default_connection_settings_path())
        , host_(*this)
        , source_(OnlineSourceDependencies{
              .http = http_,
              .settings = settings_,
              .credentials =
                  [](const std::string& account) {
                      return std::make_unique<SystemCredentialStore>(std::string(kCredentialService), account);
                  },
              .metadata_cache_path = utf8_path(default_metadata_cache_path()),
              .host = host_,
              .ui = ui_,
              .log = trace,
          })
    {
    }

    HRESULT VDJ_API OnLoad() override
    {
        source_.start();
        return S_OK;
    }

    HRESULT VDJ_API OnGetPluginInfo(TVdjPluginInfo8* info) override
    {
        if (info == nullptr) {
            return E_FAIL;
        }
        info->PluginName = kPluginName.data();
        info->Author = "Crate";
        info->Description = "Crate catalog Online Source";
        info->Version = kPluginVersion.data();
#if defined(VDJ_MAC)
        info->Bitmap = crate_bitmap(hInstance);
#else
        info->Bitmap = nullptr;
#endif
        info->Flags = 0;
        return S_OK;
    }

    HRESULT VDJ_API IsLogged() override
    {
        return source_.logged_in() ? S_OK : S_FALSE;
    }

    HRESULT VDJ_API OnLogin() override
    {
        source_.login();
        return S_OK;
    }

    HRESULT VDJ_API OnLogout() override
    {
        source_.logout();
        return S_OK;
    }

    HRESULT VDJ_API OnSearch(const char* search, IVdjTracksList* tracks_list) override
    {
        if (tracks_list == nullptr) {
            return E_FAIL;
        }
        VdjTrackSink sink(*tracks_list);
        return to_hresult(source_.search(search == nullptr ? "" : search, sink));
    }

    HRESULT VDJ_API OnSearchCancel() override
    {
        source_.cancel_search();
        return S_OK;
    }

    HRESULT VDJ_API GetStreamUrl(
        const char* unique_id,
        IVdjString& url,
        IVdjString& error_message
    ) override
    {
        const auto result = source_.stream_url(unique_id == nullptr ? "" : unique_id);
        if (!result.url.has_value()) {
            url = "";
            error_message = result.error.c_str();
            return E_FAIL;
        }
        url = result.url->c_str();
        error_message = "";
        return S_OK;
    }

    HRESULT VDJ_API GetFolderList(IVdjSubfoldersList* subfolders_list) override
    {
        if (subfolders_list == nullptr) {
            return E_FAIL;
        }
        VdjFolderSink sink(*subfolders_list);
        return to_hresult(source_.folder_list(sink));
    }

    HRESULT VDJ_API GetFolder(const char* folder_unique_id, IVdjTracksList* tracks_list) override
    {
        if (folder_unique_id == nullptr || tracks_list == nullptr) {
            return E_FAIL;
        }
        VdjTrackSink sink(*tracks_list);
        return to_hresult(source_.folder(folder_unique_id, sink));
    }

    HRESULT VDJ_API GetContextMenu(const char* unique_id, IVdjContextMenu* context_menu) override
    {
        if (unique_id == nullptr || context_menu == nullptr) {
            return E_FAIL;
        }
        for (const auto label : source_.context_menu(unique_id)) {
            context_menu->add(label.data());
        }
        return S_OK;
    }

    HRESULT VDJ_API OnContextMenu(const char* unique_id, size_t menu_index) override
    {
        if (unique_id == nullptr) {
            return E_FAIL;
        }
        return to_hresult(source_.select_context_menu(unique_id, menu_index));
    }

private:
    CurlHttpClient http_;
    FileConnectionSettingsStore settings_;
    VdjHost host_;
    PlatformConnectionUi ui_;
    OnlineSource source_;
};

bool same_guid(const GUID& left, const GUID& right)
{
    return std::memcmp(&left, &right, sizeof(GUID)) == 0;
}

} // namespace

extern "C" VDJ_EXPORT HRESULT VDJ_API DllGetClassObject(
    const GUID& class_id,
    const GUID& interface_id,
    void** object
)
{
    if (object == nullptr || !same_guid(class_id, CLSID_VdjPlugin8)) {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    if (same_guid(interface_id, IID_IVdjPluginBasic8) ||
        same_guid(interface_id, IID_IVdjPluginOnlineSource)) {
        *object = static_cast<IVdjPluginOnlineSource*>(new CrateOnlineSource());
        return S_OK;
    }
    trace("factory request rejected guid=" + guid_string(interface_id));
    return CLASS_E_CLASSNOTAVAILABLE;
}
