#include "crate_vdj/online_source.hpp"

#include "crate_vdj/catalog_client.hpp"
#include "crate_vdj/compatible_tracks.hpp"
#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/search_client.hpp"
#include "crate_vdj/stream_resolver.hpp"
#include "crate_vdj/translations.hpp"
#include "crate_vdj/vdj_track_path.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <chrono>
#include <cmath>
#include <optional>
#include <utility>
#include <vector>

namespace crate::vdj {
namespace {

constexpr std::string_view kOnlineSourceFolderId = "Crate";
constexpr int kMaxFolderPages = 5;
constexpr std::size_t kMaxRememberedTracks = 5000;

std::string percent(double value)
{
    return std::to_string(static_cast<int>(std::lround(std::clamp(value, 0.0, 1.0) * 100))) + "%";
}

std::string track_comment(
    const SearchTrack& track,
    std::string_view language,
    std::optional<double> match
)
{
    std::vector<std::string> parts;
    if (!track.album.empty()) {
        parts.push_back(track.album);
    }
    if (!track.camelot.empty()) {
        parts.push_back(track.camelot);
    }
    if (track.energy.has_value()) {
        parts.push_back(std::string(energy_label(language)) + " " + percent(*track.energy));
    }
    if (match.has_value()) {
        parts.push_back(std::string(match_label(language)) + " " + percent(*match));
    }
    std::string comment;
    for (const auto& part : parts) {
        if (!comment.empty()) {
            comment += " \u00b7 ";
        }
        comment += part;
    }
    return comment;
}

TrackEntry track_entry(
    const std::string& origin,
    const SearchTrack& track,
    std::string_view language,
    std::optional<double> match = std::nullopt
)
{
    const int camelot_key = vdj_key_from_camelot(track.camelot);
    return TrackEntry{
        .unique_id = track.entity_uid,
        .title = track.title,
        .artist = track.artist,
        .genre = track.genre,
        .comment = track_comment(track, language, match),
        .cover_url = track.cover_url.empty() ? "" : api_asset_url(origin, track.cover_url),
        .duration_seconds = static_cast<float>(track.duration_seconds),
        .bpm = static_cast<float>(track.bpm),
        .key = camelot_key != 0 ? camelot_key : vdj_key_number(track.audio_key, track.audio_scale),
        .year = track.year,
    };
}

std::string connect_message(const ConnectResult& result)
{
    switch (result.error) {
    case ConnectError::None: {
        const auto& identity = result.status.identity;
        const auto& name = identity.username.empty() ? identity.name : identity.username;
        return "Connected to Crate as " + name + ".";
    }
    case ConnectError::InvalidOrigin:
        return "Enter the HTTPS address of your Crate server, for example https://api.example.org.";
    case ConnectError::MissingToken:
        return "Paste an access token created in Crate Listen, Settings, Access tokens.";
    case ConnectError::CredentialWriteFailed:
        return "The token could not be saved in the system keychain.";
    case ConnectError::SettingsWriteFailed:
        return "The connection settings could not be saved.";
    case ConnectError::Cancelled:
    case ConnectError::Rejected:
        break;
    }
    switch (result.status.state) {
    case ConnectionState::Unauthorized:
        return "Crate rejected this token. Create a new one in Crate Listen, Settings, Access tokens.";
    case ConnectionState::MissingScopes:
        return "This token cannot browse or play your library. Create one with the VirtualDJ permissions.";
    case ConnectionState::Incompatible:
        return "This Crate server is not compatible with this plugin version.";
    case ConnectionState::ServerDisabled:
        return "VirtualDJ is disabled on this Crate server.";
    case ConnectionState::Unreachable:
        return "Crate could not be reached. Check the address and your connection.";
    default:
        return "Crate could not be connected.";
    }
}

} // namespace

std::string_view stream_failure_message(StreamFailure failure)
{
    switch (failure) {
    case StreamFailure::TimedOut:
        return "Crate took too long to answer. Load the track again.";
    case StreamFailure::Unreachable:
        return "Crate could not be reached. Check your connection and the Crate server.";
    case StreamFailure::Unauthorized:
        return "Crate rejected the access token. Log in to Crate again.";
    case StreamFailure::NotFound:
        return "This track is no longer in your Crate library.";
    case StreamFailure::NotReady:
        return "Crate is still preparing this track. Try again in a moment.";
    case StreamFailure::None:
    case StreamFailure::Cancelled:
    case StreamFailure::Invalid:
        break;
    }
    return "Crate could not load this track.";
}

struct OnlineSource::ServerClients {
    ServerClients(
        HttpClient& http,
        std::shared_ptr<CredentialStore> store,
        std::string server_origin,
        MetadataCacheStore* cache
    )
        : credentials(std::move(store))
        , origin(std::move(server_origin))
        , search(http, *credentials, origin, cache)
        , stream(http, *credentials, origin)
        , catalog(http, *credentials, origin, cache)
        , compatible(http, *credentials, origin)
    {
    }

    std::shared_ptr<CredentialStore> credentials;
    std::string origin;
    SearchClient search;
    StreamResolver stream;
    CatalogClient catalog;
    CompatibleTracksClient compatible;
};

int vdj_key_number(std::string_view audio_key, std::string_view audio_scale)
{
    std::string key(audio_key);
    std::transform(key.begin(), key.end(), key.begin(), [](unsigned char character) {
        return static_cast<char>(std::toupper(character));
    });
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

    const bool minor = audio_scale == "minor" || audio_scale == "Minor" || audio_scale == "m";
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

int vdj_key_from_camelot(std::string_view camelot)
{
    if (camelot.size() < 2) {
        return 0;
    }
    const char mode = static_cast<char>(std::toupper(static_cast<unsigned char>(camelot.back())));
    const auto digits = camelot.substr(0, camelot.size() - 1);
    int number = 0;
    const auto parsed = std::from_chars(digits.data(), digits.data() + digits.size(), number);
    if (parsed.ec != std::errc{} || parsed.ptr != digits.data() + digits.size() || number < 1 ||
        number > 12 || (mode != 'A' && mode != 'B')) {
        return 0;
    }
    static constexpr std::array<std::string_view, 12> minor_keys = {
        "G#", "D#", "A#", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
    };
    static constexpr std::array<std::string_view, 12> major_keys = {
        "B", "F#", "C#", "G#", "D#", "A#", "F", "C", "G", "D", "A", "E",
    };
    const auto index = static_cast<std::size_t>(number - 1);
    return mode == 'A' ? vdj_key_number(minor_keys[index], "minor")
                       : vdj_key_number(major_keys[index], "major");
}

std::string api_asset_url(const std::string& origin, std::string_view path)
{
    if (path.starts_with("https://")) {
        return std::string(path);
    }
    if (path.starts_with("http://")) {
        return {};
    }
    return origin + (path.starts_with('/') ? std::string(path) : "/" + std::string(path));
}

std::string compatible_folder_navigation_command(std::string_view language)
{
    return "browser_gotofolder \"onlinemusic:/" + std::string(kOnlineSourceFolderId) + "/" +
        std::string(compatible_folder_label(language)) + "\"";
}

std::string vdj_search_command(std::string_view field, std::string_view value)
{
    if (value.find('\'') == std::string_view::npos && value.find('"') == std::string_view::npos) {
        return "search '" + std::string(field) + ":\"" + std::string(value) + "\"'";
    }
    std::string text(value);
    std::erase(text, '"');
    return "search \"" + text + "\"";
}

OnlineSource::OnlineSource(OnlineSourceDependencies dependencies)
    : host_(dependencies.host)
    , ui_(dependencies.ui)
    , log_(std::move(dependencies.log))
    , server_http_(
          dependencies.http,
          [this] {
              log("server rejected the access token; checking the session");
              connection_.request_check();
          }
      )
    , metadata_cache_(std::move(dependencies.metadata_cache_path))
    , session_(dependencies.settings, std::move(dependencies.credentials), dependencies.http)
    , connection_(
          session_,
          [this] { sync_clients(); },
          [this](const ConnectResult& result) {
              log("online source connect result=" +
                  std::to_string(static_cast<int>(result.error)));
              ui_.notify("Crate", connect_message(result));
          }
      )
{
}

OnlineSource::~OnlineSource()
{
    searches_.shutdown();
    folders_.shutdown();
}

void OnlineSource::start()
{
    log("online source plugin loaded");
    connection_.start();
}

bool OnlineSource::logged_in() const
{
    return session_.logged_in();
}

void OnlineSource::login()
{
    log("online login callback");
    const auto choice = ui_.ask(ConnectionDialogRequest{
        .current_origin = session_.origin().value_or(""),
    });
    if (choice.action == ConnectionDialogAction::Disconnect) {
        logout();
        return;
    }
    if (choice.action == ConnectionDialogAction::Connect) {
        connection_.connect(choice.origin, choice.token);
    }
}

void OnlineSource::logout()
{
    log("online logout callback");
    if (!connection_.disconnect()) {
        ui_.notify(
            "Crate",
            "Crate was disconnected, but the saved token could not be removed from the system keychain."
        );
    }
}

CallbackStatus OnlineSource::search(const std::string& query, TrackSink& sink)
{
    log("online search callback query=" + query);
    const auto request = searches_.begin();
    if (!request.has_value()) {
        return CallbackStatus::Cancelled;
    }
    const auto server = clients();
    if (server == nullptr) {
        const bool published = searches_.publish(*request, [&] { sink.finish(); });
        return published ? CallbackStatus::Done : CallbackStatus::Cancelled;
    }

    const auto result = server->search.search(query, request->cancellation);
    if (request->cancellation.cancelled()) {
        searches_.complete(*request);
        log("online search cancelled query=" + query);
        return CallbackStatus::Cancelled;
    }
    if (!result.ok()) {
        searches_.complete(*request);
        log("online search failed query=" + query + " error=" + redact_sensitive(result.error));
        return CallbackStatus::Failed;
    }

    remember(result.value->tracks);
    const std::string language = host_.language();
    const bool published = searches_.publish(*request, [&] {
        for (const auto& track : result.value->tracks) {
            sink.add(track_entry(server->origin, track, language));
        }
        sink.finish();
    });
    if (!published) {
        log("online search cancelled query=" + query);
        return CallbackStatus::Cancelled;
    }
    log("online search finished query=" + query + " tracks=" +
        std::to_string(result.value->tracks.size()));
    return CallbackStatus::Done;
}

void OnlineSource::cancel_search()
{
    log("online search cancel callback");
    searches_.cancel_all();
}

StreamUrl OnlineSource::stream_url(const std::string& unique_id)
{
    if (unique_id.starts_with(kNoticePrefix)) {
        return {std::nullopt, std::string(no_profile_notice_label(host_.language()))};
    }
    const auto server = clients();
    if (server == nullptr) {
        return {std::nullopt, "Connect Crate before loading tracks."};
    }
    const auto started = std::chrono::steady_clock::now();
    CancellationSource cancellation;
    const auto result = server->stream.resolve(unique_id, cancellation.token());
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started
    ).count();
    if (!result.ok()) {
        log("stream URL resolution failed id=" + unique_id + " ms=" + std::to_string(elapsed_ms) +
            " error=" + redact_sensitive(result.detail));
        return {std::nullopt, std::string(stream_failure_message(result.failure))};
    }
    log("stream URL resolved id=" + unique_id + " ms=" + std::to_string(elapsed_ms));
    return {*result.url, {}};
}

CallbackStatus OnlineSource::folder_list(FolderSink& sink)
{
    log("online folder list callback");
    const auto server = clients();
    if (server == nullptr) {
        return CallbackStatus::Done;
    }
    CancellationSource cancellation;
    const auto result = server->catalog.list_folders(cancellation.token());
    if (!result.ok()) {
        log("online folder list failed error=" + redact_sensitive(result.error));
        return CallbackStatus::Failed;
    }
    const std::string language = host_.language();
    for (const auto& folder : result.value->folders) {
        sink.add(folder.id, catalog_folder_label(folder.id, folder.name, language));
    }
    sink.add(std::string(kCurrentCompatibleFolderId), std::string(compatible_folder_label(language)));
    return CallbackStatus::Done;
}

CallbackStatus OnlineSource::folder(const std::string& folder_id, TrackSink& sink)
{
    log("online folder callback id=" + folder_id);
    if (folder_id == kCurrentCompatibleFolderId) {
        std::string seed_uid;
        {
            std::lock_guard lock(compatible_mutex_);
            if (compatible_seed_.has_value()) {
                seed_uid = std::move(*compatible_seed_);
                compatible_seed_.reset();
            }
        }
        if (seed_uid.empty()) {
            seed_uid = current_crate_track_uid().value_or("");
        }
        return compatible_folder(seed_uid, sink);
    }
    if (folder_id.starts_with(kCompatibleFolderPrefix)) {
        return compatible_folder(folder_id.substr(kCompatibleFolderPrefix.size()), sink);
    }

    const auto request = folders_.begin();
    if (!request.has_value()) {
        return CallbackStatus::Cancelled;
    }
    const auto server = clients();
    if (server == nullptr) {
        const bool published = folders_.publish(*request, [&] { sink.finish(); });
        return published ? CallbackStatus::Done : CallbackStatus::Cancelled;
    }

    std::vector<SearchTrack> tracks;
    std::string cursor;
    for (int page = 0; page < kMaxFolderPages; ++page) {
        const auto result = server->catalog.get_folder(folder_id, cursor, request->cancellation);
        if (request->cancellation.cancelled()) {
            folders_.complete(*request);
            return CallbackStatus::Cancelled;
        }
        if (!result.ok()) {
            folders_.complete(*request);
            log("online folder failed id=" + folder_id + " error=" +
                redact_sensitive(result.error));
            return CallbackStatus::Failed;
        }
        tracks.insert(tracks.end(), result.value->tracks.begin(), result.value->tracks.end());
        if (!result.value->next_cursor.has_value()) {
            break;
        }
        cursor = *result.value->next_cursor;
    }

    remember(tracks);
    const std::string language = host_.language();
    const bool published = folders_.publish(*request, [&] {
        for (const auto& track : tracks) {
            sink.add(track_entry(server->origin, track, language));
        }
        sink.finish();
    });
    return published ? CallbackStatus::Done : CallbackStatus::Cancelled;
}

std::vector<std::string_view> OnlineSource::context_menu(const std::string& unique_id)
{
    const std::string language = host_.language();
    std::vector<std::string_view> labels;
    for (const auto action : menu_actions(unique_id)) {
        switch (action) {
        case MenuAction::Compatible:
            labels.push_back(compatible_menu_label(language));
            break;
        case MenuAction::Artist:
            labels.push_back(artist_menu_label(language));
            break;
        case MenuAction::Album:
            labels.push_back(album_menu_label(language));
            break;
        case MenuAction::OpenInCrate:
            labels.push_back(open_in_crate_menu_label(language));
            break;
        }
    }
    return labels;
}

CallbackStatus OnlineSource::select_context_menu(const std::string& unique_id, std::size_t index)
{
    log("track context menu id=" + unique_id + " index=" + std::to_string(index));
    const auto actions = menu_actions(unique_id);
    if (index >= actions.size()) {
        return CallbackStatus::NotImplemented;
    }
    std::string command;
    switch (actions[index]) {
    case MenuAction::Compatible: {
        {
            std::lock_guard lock(compatible_mutex_);
            compatible_seed_ = unique_id;
        }
        folders_.cancel_all();
        log("compatible tracks folder selected seed=" + unique_id);
        command = compatible_folder_navigation_command(host_.language());
        break;
    }
    case MenuAction::OpenInCrate: {
        const auto facts = facts_for(unique_id);
        const auto listen_url = session_.status().listen_url;
        if (!facts.has_value() || facts->album_id <= 0 || listen_url.empty()) {
            return CallbackStatus::NotImplemented;
        }
        const bool opened = host_.open_url(
            listen_url + "/albums/" + std::to_string(facts->album_id) + "/album?track=" + unique_id
        );
        log(std::string("open in crate ") + (opened ? "opened" : "failed"));
        return opened ? CallbackStatus::Done : CallbackStatus::Failed;
    }
    case MenuAction::Artist:
    case MenuAction::Album: {
        const auto facts = facts_for(unique_id);
        if (!facts.has_value()) {
            return CallbackStatus::NotImplemented;
        }
        command = actions[index] == MenuAction::Artist
            ? vdj_search_command("artist", facts->artist)
            : vdj_search_command("album", facts->album);
        break;
    }
    }
    const bool sent = host_.send_command(command);
    log(std::string("track context menu command ") + (sent ? "sent" : "failed"));
    return sent ? CallbackStatus::Done : CallbackStatus::Failed;
}

void OnlineSource::remember(const std::vector<SearchTrack>& tracks)
{
    std::lock_guard lock(facts_mutex_);
    if (track_facts_.size() + tracks.size() > kMaxRememberedTracks) {
        track_facts_.clear();
    }
    for (const auto& track : tracks) {
        track_facts_[track.entity_uid] = TrackFacts{track.artist, track.album, track.album_id};
    }
}

std::optional<OnlineSource::TrackFacts> OnlineSource::facts_for(const std::string& unique_id)
{
    std::lock_guard lock(facts_mutex_);
    const auto found = track_facts_.find(unique_id);
    if (found == track_facts_.end()) {
        return std::nullopt;
    }
    return found->second;
}

std::vector<OnlineSource::MenuAction> OnlineSource::menu_actions(const std::string& unique_id)
{
    if (unique_id.starts_with(kNoticePrefix)) {
        return {};
    }
    std::vector<MenuAction> actions{MenuAction::Compatible};
    if (const auto facts = facts_for(unique_id)) {
        if (!facts->artist.empty()) {
            actions.push_back(MenuAction::Artist);
        }
        if (!facts->album.empty()) {
            actions.push_back(MenuAction::Album);
        }
        if (facts->album_id > 0 && !session_.status().listen_url.empty()) {
            actions.push_back(MenuAction::OpenInCrate);
        }
    }
    return actions;
}

void OnlineSource::sync_clients()
{
    if (session_.logged_in()) {
        const auto origin = session_.origin();
        const auto credentials = session_.credentials();
        std::lock_guard lock(clients_mutex_);
        if (clients_ != nullptr && clients_->origin == *origin &&
            clients_->credentials == credentials) {
            return;
        }
        clients_ = std::make_shared<ServerClients>(server_http_, credentials, *origin, &metadata_cache_);
        return;
    }
    std::lock_guard lock(clients_mutex_);
    clients_.reset();
}

std::shared_ptr<OnlineSource::ServerClients> OnlineSource::clients()
{
    std::lock_guard lock(clients_mutex_);
    return clients_;
}

CallbackStatus OnlineSource::compatible_folder(const std::string& seed_uid, TrackSink& sink)
{
    const auto request = folders_.begin();
    if (!request.has_value()) {
        return CallbackStatus::Cancelled;
    }
    const auto server = clients();
    if (seed_uid.empty() || server == nullptr) {
        const bool published = folders_.publish(*request, [&] { sink.finish(); });
        return published ? CallbackStatus::Done : CallbackStatus::Cancelled;
    }

    const auto result = server->compatible.fetch(seed_uid, request->cancellation);
    if (request->cancellation.cancelled()) {
        folders_.complete(*request);
        return CallbackStatus::Cancelled;
    }
    if (!result.ok()) {
        folders_.complete(*request);
        log("compatible tracks failed seed=" + seed_uid + " error=" +
            redact_sensitive(result.error));
        return CallbackStatus::Failed;
    }
    if (result.value->fallback_reason.has_value()) {
        log("compatible tracks unavailable seed=" + seed_uid + " reason=" +
            *result.value->fallback_reason);
    }

    const std::string language = host_.language();
    const bool missing_profile = result.value->items.empty() &&
        result.value->fallback_reason == std::optional<std::string>("missing_profile");
    std::vector<SearchTrack> compatible_tracks;
    for (const auto& compatible : result.value->items) {
        compatible_tracks.push_back(compatible_track_as_search_track(compatible));
    }
    remember(compatible_tracks);
    const bool published = folders_.publish(*request, [&] {
        if (missing_profile) {
            TrackEntry notice;
            notice.unique_id = kNoProfileNoticeId;
            notice.title = no_profile_notice_label(language);
            sink.add(notice);
        }
        for (std::size_t index = 0; index < compatible_tracks.size(); ++index) {
            sink.add(track_entry(
                server->origin,
                compatible_tracks[index],
                language,
                result.value->items[index].score
            ));
        }
        sink.finish();
    });
    return published ? CallbackStatus::Done : CallbackStatus::Cancelled;
}

std::optional<std::string> OnlineSource::current_crate_track_uid()
{
    const auto path = host_.loaded_track_path();
    if (!path.has_value() || path->empty()) {
        log("compatible tracks unavailable reason=no_playing_track");
        return std::nullopt;
    }
    const auto track_uid = crate_uid_from_vdj_filepath(*path);
    if (!track_uid.has_value()) {
        log("compatible tracks unavailable reason=playing_track_not_from_crate");
    }
    return track_uid;
}

void OnlineSource::log(const std::string& message) const
{
    if (log_) {
        log_(message);
    }
}

} // namespace crate::vdj
