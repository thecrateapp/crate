#include "crate_vdj/connection_settings.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <system_error>

namespace crate::vdj {
namespace {

constexpr std::string_view kScheme = "https://";

std::string_view trim(std::string_view value)
{
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) {
        value.remove_prefix(1);
    }
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) {
        value.remove_suffix(1);
    }
    return value;
}

std::string lowercase(std::string_view value)
{
    std::string result(value);
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char character) {
        return static_cast<char>(std::tolower(character));
    });
    return result;
}

bool valid_host(std::string_view host)
{
    if (host.empty() || host.front() == '.' || host.back() == '.' || host.front() == '-') {
        return false;
    }
    return std::all_of(host.begin(), host.end(), [](char character) {
        return std::isalnum(static_cast<unsigned char>(character)) || character == '.' ||
            character == '-';
    });
}

bool valid_port(std::string_view port)
{
    if (port.empty() || port.size() > 5 ||
        !std::all_of(port.begin(), port.end(), [](char character) {
            return std::isdigit(static_cast<unsigned char>(character));
        })) {
        return false;
    }
    const auto value = std::stoi(std::string(port));
    return value > 0 && value <= 65535;
}

} // namespace

std::optional<std::string> normalize_origin(std::string_view input)
{
    const auto value = lowercase(trim(input));
    if (!value.starts_with(kScheme)) {
        return std::nullopt;
    }
    std::string_view authority(value);
    authority.remove_prefix(kScheme.size());
    if (authority.ends_with('/')) {
        authority.remove_suffix(1);
    }
    if (authority.find_first_of("/?#@\\ ") != std::string_view::npos) {
        return std::nullopt;
    }
    const auto colon = authority.find(':');
    const auto host = authority.substr(0, colon);
    if (!valid_host(host)) {
        return std::nullopt;
    }
    if (colon != std::string_view::npos && !valid_port(authority.substr(colon + 1))) {
        return std::nullopt;
    }
    return std::string(kScheme) + std::string(authority);
}

FileConnectionSettingsStore::FileConnectionSettingsStore(std::filesystem::path path)
    : path_(std::move(path))
{
}

std::optional<std::string> FileConnectionSettingsStore::load_origin()
{
    std::ifstream input(path_);
    if (!input) {
        return std::nullopt;
    }
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto document = nlohmann::json::parse(buffer.str(), nullptr, false);
    if (!document.is_object() || !document.contains("origin") ||
        !document["origin"].is_string()) {
        return std::nullopt;
    }
    const auto stored = document["origin"].get<std::string>();
    const auto normalized = normalize_origin(stored);
    if (!normalized.has_value() || *normalized != stored) {
        return std::nullopt;
    }
    return normalized;
}

bool FileConnectionSettingsStore::save_origin(std::string_view origin)
{
    const auto normalized = normalize_origin(origin);
    if (!normalized.has_value()) {
        return false;
    }
    std::error_code error;
    std::filesystem::create_directories(path_.parent_path(), error);
    if (error) {
        return false;
    }
    auto temporary = path_;
    temporary += ".tmp";
    {
        std::ofstream output(temporary, std::ios::trunc);
        output << nlohmann::json{{"origin", *normalized}}.dump();
        if (!output) {
            return false;
        }
    }
    std::filesystem::rename(temporary, path_, error);
    return !error;
}

bool FileConnectionSettingsStore::clear()
{
    std::error_code error;
    std::filesystem::remove(path_, error);
    return !error;
}

std::filesystem::path default_connection_settings_path()
{
#if defined(_WIN32)
    if (const char* app_data = std::getenv("APPDATA"); app_data != nullptr && app_data[0] != '\0') {
        return std::filesystem::path(app_data) / "Crate" / "VirtualDJ" / "connection.json";
    }
#else
    if (const char* home = std::getenv("HOME"); home != nullptr && home[0] != '\0') {
        return std::filesystem::path(home) / "Library" / "Application Support" / "Crate" /
            "VirtualDJ" / "connection.json";
    }
#endif
    return std::filesystem::temp_directory_path() / "crate-vdj-connection.json";
}

} // namespace crate::vdj
