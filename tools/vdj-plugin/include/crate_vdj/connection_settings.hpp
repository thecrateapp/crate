#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

std::optional<std::string> normalize_origin(std::string_view input);

class ConnectionSettingsStore {
public:
    virtual ~ConnectionSettingsStore() = default;
    virtual std::optional<std::string> load_origin() = 0;
    virtual bool save_origin(std::string_view origin) = 0;
    virtual bool clear() = 0;
};

class FileConnectionSettingsStore final : public ConnectionSettingsStore {
public:
    explicit FileConnectionSettingsStore(std::filesystem::path path);

    std::optional<std::string> load_origin() override;
    bool save_origin(std::string_view origin) override;
    bool clear() override;

private:
    std::filesystem::path path_;
};

std::filesystem::path default_connection_settings_path();

} // namespace crate::vdj
