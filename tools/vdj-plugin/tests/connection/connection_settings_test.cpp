#include "crate_vdj/connection_settings.hpp"
#include "crate_vdj/credential_store.hpp"

#include "../support/check.hpp"

#include <filesystem>
#include <fstream>
#include <memory>
#include <random>
#include <optional>
#include <sstream>
#include <string>

using namespace crate::vdj;

namespace {

class CountingCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> token;
    int loads = 0;
    bool fail_writes = false;

    std::optional<std::string> load_token() override
    {
        ++loads;
        return token;
    }

    bool save_token(std::string value) override
    {
        if (fail_writes) {
            return false;
        }
        token = std::move(value);
        return true;
    }

    bool clear_token() override
    {
        if (fail_writes) {
            return false;
        }
        token.reset();
        return true;
    }
};

std::string read_file(const std::filesystem::path& path)
{
    std::ifstream input(path);
    std::stringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void normalizes_and_rejects_origins()
{
    CRATE_CHECK(normalize_origin("https://API.Example.org/") == "https://api.example.org");
    CRATE_CHECK(normalize_origin("  https://api.example.org  ") == "https://api.example.org");
    CRATE_CHECK(normalize_origin("https://api.example.org:8443") == "https://api.example.org:8443");
    CRATE_CHECK(!normalize_origin("").has_value());
    CRATE_CHECK(!normalize_origin("api.example.org").has_value());
    CRATE_CHECK(!normalize_origin("http://api.example.org").has_value());
    CRATE_CHECK(!normalize_origin("https://user:secret@api.example.org").has_value());
    CRATE_CHECK(!normalize_origin("https://api.example.org/api").has_value());
    CRATE_CHECK(!normalize_origin("https://api.example.org?token=x").has_value());
    CRATE_CHECK(!normalize_origin("https://api.example.org#fragment").has_value());
    CRATE_CHECK(!normalize_origin("https://api.example.org:notaport").has_value());
    CRATE_CHECK(!normalize_origin("https://").has_value());
    CRATE_CHECK(!normalize_origin("https://bad host").has_value());
}

void persists_only_the_origin()
{
    const auto directory = std::filesystem::temp_directory_path() /
        ("crate-vdj-settings-" + std::to_string(std::random_device{}()));
    const auto path = directory / "connection.json";
    FileConnectionSettingsStore store(path);

    CRATE_CHECK(!store.load_origin().has_value());
    CRATE_CHECK(store.save_origin("https://api.example.org"));
    CRATE_CHECK(store.load_origin() == "https://api.example.org");
    CRATE_CHECK(read_file(path).find("crv_") == std::string::npos);
    CRATE_CHECK(read_file(path).find("token") == std::string::npos);

    FileConnectionSettingsStore reopened(path);
    CRATE_CHECK(reopened.load_origin() == "https://api.example.org");
    CRATE_CHECK(reopened.clear());
    CRATE_CHECK(!reopened.load_origin().has_value());
    std::filesystem::remove_all(directory);
}

void ignores_invalid_persisted_origins()
{
    const auto directory = std::filesystem::temp_directory_path() /
        ("crate-vdj-settings-bad-" + std::to_string(std::random_device{}()));
    std::filesystem::create_directories(directory);
    const auto path = directory / "connection.json";
    std::ofstream(path) << R"({"origin":"http://plain.example.org"})";

    FileConnectionSettingsStore store(path);

    CRATE_CHECK(!store.load_origin().has_value());
    std::filesystem::remove_all(directory);
}

void reads_the_os_credential_once_per_session()
{
    auto backing = std::make_unique<CountingCredentialStore>();
    auto* raw = backing.get();
    raw->token = "crv_session";
    CachedCredentialStore cached(std::move(backing));

    CRATE_CHECK(cached.load_token() == "crv_session");
    CRATE_CHECK(cached.load_token() == "crv_session");
    CRATE_CHECK(raw->loads == 1);

    CRATE_CHECK(cached.save_token("crv_rotated"));
    CRATE_CHECK(cached.load_token() == "crv_rotated");
    CRATE_CHECK(raw->loads == 1);

    raw->fail_writes = true;
    CRATE_CHECK(!cached.save_token("crv_lost"));
    CRATE_CHECK(cached.load_token() == "crv_rotated");
    CRATE_CHECK(!cached.clear_token());
    CRATE_CHECK(cached.load_token() == "crv_rotated");
}

void credential_accounts_are_scoped_by_origin()
{
    CRATE_CHECK(credential_account_for_origin("https://a.example.org") !=
        credential_account_for_origin("https://b.example.org"));
    CRATE_CHECK(credential_account_for_origin("https://a.example.org").find("https://a.example.org") !=
        std::string::npos);
}

} // namespace

int main()
{
    normalizes_and_rejects_origins();
    persists_only_the_origin();
    ignores_invalid_persisted_origins();
    reads_the_os_credential_once_per_session();
    credential_accounts_are_scoped_by_origin();
}
