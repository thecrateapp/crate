#include "vdjPlugin8.h"
#include "vdjOnlineSource.h"

#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

extern "C" HRESULT VDJ_API DllGetClassObject(
    const GUID& class_id,
    const GUID& interface_id,
    void** object
);

class TrackListProbe final : public IVdjTracksList {
public:
    void VDJ_API add(
        const char* unique_id,
        const char* title,
        const char* artist,
        const char*,
        const char* genre,
        const char*,
        const char* comment,
        const char* cover_url,
        const char*,
        float length,
        float bpm,
        int key,
        int year,
        bool,
        bool
    ) override
    {
        ++add_calls;
        last_unique_id = unique_id == nullptr ? "" : unique_id;
        last_title = title == nullptr ? "" : title;
        last_artist = artist == nullptr ? "" : artist;
        last_genre = genre == nullptr ? "" : genre;
        last_comment = comment == nullptr ? "" : comment;
        last_cover_url = cover_url == nullptr ? "" : cover_url;
        last_length = length;
        last_bpm = bpm;
        last_key = key;
        last_year = year;
    }

    void VDJ_API finish() override
    {
        ++finish_calls;
    }

    int add_calls = 0;
    int finish_calls = 0;
    std::string last_unique_id;
    std::string last_title;
    std::string last_artist;
    std::string last_genre;
    std::string last_comment;
    std::string last_cover_url;
    float last_length = 0;
    float last_bpm = 0;
    int last_key = 0;
    int last_year = 0;
};

class SubfoldersProbe final : public IVdjSubfoldersList {
public:
    void VDJ_API add(const char* folder_unique_id, const char* folder_name) override
    {
        ids.emplace_back(folder_unique_id == nullptr ? "" : folder_unique_id);
        names.emplace_back(folder_name == nullptr ? "" : folder_name);
    }

    std::vector<std::string> ids;
    std::vector<std::string> names;
};

class ContextMenuProbe final : public IVdjContextMenu {
public:
    void VDJ_API add(const char* menu_entry) override
    {
        entries.emplace_back(menu_entry == nullptr ? "" : menu_entry);
    }

    std::vector<std::string> entries;
};

class CallbackProbe final : public IVdjCallbacks8 {
public:
    HRESULT SendCommand(const char* command) override
    {
        last_command = command == nullptr ? "" : command;
        return S_OK;
    }

    HRESULT GetInfo(const char*, double* result) override
    {
        if (result != nullptr) {
            *result = 0;
        }
        return S_OK;
    }

    HRESULT GetStringInfo(const char* command, void* result, int size) override
    {
        if (result == nullptr || size <= 0) {
            return static_cast<HRESULT>(-1);
        }
        const std::string value =
            command != nullptr && std::strcmp(command, "get_filepath") == 0
                ? current_filepath
                : command != nullptr &&
                        std::strcmp(command, "setting 'language'") == 0
                    ? language
                    : vdj_folder.string();
        std::strncpy(
            static_cast<char*>(result),
            value.c_str(),
            static_cast<std::size_t>(size - 1)
        );
        static_cast<char*>(result)[size - 1] = '\0';
        return S_OK;
    }

    HRESULT DeclareParameter(
        void*, int, int, const char*, const char*, float
    ) override
    {
        return S_OK;
    }

    HRESULT GetSongBuffer(int, int, short**) override
    {
        return E_NOTIMPL;
    }

    std::filesystem::path vdj_folder;
    std::string current_filepath;
    std::string language = "Spanish";
    std::string last_command;
};

int main()
{
    void* raw_object = nullptr;
    const HRESULT result = DllGetClassObject(
        CLSID_VdjPlugin8,
        IID_IVdjPluginBasic8,
        &raw_object
    );

    if (result != S_OK || raw_object == nullptr) {
        std::cerr << "Online Source factory did not return a plugin\n";
        return 1;
    }

    auto* plugin = static_cast<IVdjPlugin8*>(raw_object);
    TVdjPluginInfo8 info{};
    if (plugin->OnGetPluginInfo(&info) != S_OK ||
        info.PluginName == nullptr ||
        std::strcmp(info.PluginName, "Crate") != 0 ||
        info.Description == nullptr ||
        std::strcmp(info.Description, "Crate catalog Online Source") != 0) {
        std::cerr << "Online Source factory returned the wrong plugin interface\n";
        plugin->Release();
        return 1;
    }

    const auto test_vdj_folder = std::filesystem::temp_directory_path() /
        "crate-vdj-factory-contract";
    std::filesystem::create_directories(test_vdj_folder);
    {
        std::ofstream settings(test_vdj_folder / "settings.xml");
        settings << "<settings><language>English</language></settings>";
    }

    auto* online_source = static_cast<IVdjPluginOnlineSource*>(raw_object);
    if (online_source->IsLogged() != S_FALSE) {
        std::cerr << "Online Source reported a login before connecting\n";
        online_source->Release();
        return 1;
    }

    CallbackProbe callbacks;
    callbacks.vdj_folder = test_vdj_folder;
    online_source->cb = &callbacks;

    TrackListProbe current_folder_without_track;
    if (online_source->GetFolder(
            "crate:compatible:current",
            &current_folder_without_track
        ) != S_OK || current_folder_without_track.finish_calls != 1 ||
        current_folder_without_track.add_calls != 0) {
        std::cerr << "Current compatible folder did not handle an empty deck\n";
        online_source->Release();
        return 1;
    }

    ContextMenuProbe context_menu;
    if (online_source->GetContextMenu("seed-track", &context_menu) != S_OK ||
        context_menu.entries.size() != 2 ||
        context_menu.entries[0] != "Mostrar pistas compatibles" ||
        context_menu.entries[1] != "Abrir en Crate") {
        std::cerr << "Online Source context menu was not localized\n";
        online_source->Release();
        return 1;
    }

    callbacks.language = "English";
    context_menu.entries.clear();
    if (online_source->GetContextMenu("seed-track", &context_menu) != S_OK ||
        context_menu.entries.size() != 2 ||
        context_menu.entries[0] != "Show compatible tracks" ||
        context_menu.entries[1] != "Open in Crate") {
        std::cerr << "Online Source English labels were not localized\n";
        online_source->Release();
        return 1;
    }

    callbacks.language = "Español";
    context_menu.entries.clear();
    if (online_source->GetContextMenu("seed-track", &context_menu) != S_OK ||
        context_menu.entries.size() != 2 ||
        context_menu.entries[0] != "Mostrar pistas compatibles" ||
        context_menu.entries[1] != "Abrir en Crate") {
        std::cerr << "Online Source Spanish locale alias was not localized\n";
        online_source->Release();
        return 1;
    }

#if defined(VDJ_MAC)
    const auto bundle_path = std::filesystem::current_path() / "Crate.bundle";
    auto* bundle_url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(bundle_path.c_str()),
        bundle_path.string().size(),
        true
    );
    auto* bundle = bundle_url == nullptr
        ? nullptr
        : CFBundleCreate(kCFAllocatorDefault, bundle_url);
    if (bundle_url != nullptr) {
        CFRelease(bundle_url);
    }
    if (bundle == nullptr) {
        std::cerr << "Could not load the Online Source bundle for icon testing\n";
        online_source->Release();
        return 1;
    }

    online_source->hInstance = bundle;
    TVdjPluginInfo8 bundle_info{};
    if (online_source->OnGetPluginInfo(&bundle_info) != S_OK ||
        bundle_info.Bitmap == nullptr ||
        !std::filesystem::exists(bundle_info.Bitmap) ||
        std::filesystem::path(bundle_info.Bitmap).extension() != ".bmp") {
        std::cerr << "Online Source did not expose an existing Crate icon\n";
        CFRelease(bundle);
        online_source->Release();
        return 1;
    }
    CFRelease(bundle);
#endif

    if (online_source->OnContextMenu("seed-track", 0) != S_OK ||
        callbacks.last_command !=
            "browser_gotofolder \"onlinemusic:/Crate/"
            "Pistas compatibles de Smart Mix\"") {
        std::cerr << "Online Source context menu did not open compatible tracks\n";
        online_source->Release();
        return 1;
    }

    if (std::getenv("CRATE_VDJ_LIVE_TEST") != nullptr) {
        TrackListProbe tracks;
        const HRESULT search_result = online_source->OnSearch("birds", &tracks);
        if (search_result != S_OK || tracks.add_calls == 0 ||
            tracks.last_title.empty() || tracks.last_artist.empty() ||
            tracks.last_comment.empty() || tracks.last_cover_url.empty() ||
            tracks.last_length <= 0 || tracks.last_bpm <= 0 ||
            tracks.last_year <= 0) {
            std::cerr << "Online Source live search did not return catalog tracks\n";
            online_source->Release();
            return 1;
        }

        SubfoldersProbe folders;
        if (online_source->GetFolderList(&folders) != S_OK ||
            folders.ids.empty() ||
            folders.names.front() != "Listas de reproducción") {
            std::cerr << "Online Source live folder list was empty\n";
            online_source->Release();
            return 1;
        }
        bool current_compatible_folder_found = false;
        for (const auto& folder_id : folders.ids) {
            if (folder_id == "crate:compatible:current") {
                current_compatible_folder_found = true;
                break;
            }
        }
        if (!current_compatible_folder_found) {
            std::cerr << "Online Source live compatible folder was missing\n";
            online_source->Release();
            return 1;
        }

        bool populated_folder_found = false;
        for (const auto& folder_id : folders.ids) {
            TrackListProbe folder_tracks;
            if (online_source->GetFolder(folder_id.c_str(), &folder_tracks) != S_OK ||
                folder_tracks.finish_calls != 1) {
                std::cerr << "Online Source live folder callback failed\n";
                online_source->Release();
                return 1;
            }
            if (folder_tracks.add_calls > 0) {
                populated_folder_found = true;
                break;
            }
        }
        if (!populated_folder_found) {
            std::cerr << "Online Source live folder did not return tracks\n";
            online_source->Release();
            return 1;
        }
    }

    std::filesystem::remove_all(test_vdj_folder);
    plugin->Release();
    return 0;
}
