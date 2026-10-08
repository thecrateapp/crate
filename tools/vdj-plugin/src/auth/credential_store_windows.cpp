#include "crate_vdj/credential_store.hpp"

#include <windows.h>
#include <wincred.h>

#include <string>

namespace crate::vdj {
namespace {

std::wstring to_wide(const std::string& value)
{
    if (value.empty()) {
        return {};
    }
    const auto length = MultiByteToWideChar(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0
    );
    std::wstring result(length, L'\0');
    MultiByteToWideChar(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        result.data(),
        length
    );
    return result;
}

} // namespace

SystemCredentialStore::SystemCredentialStore(
    std::string service,
    std::string account
)
    : service_(std::move(service)), account_(std::move(account))
{
}

std::optional<std::string> SystemCredentialStore::load_token()
{
    const auto target = to_wide(service_ + ":" + account_);
    PCREDENTIALW credential = nullptr;
    if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
        return std::nullopt;
    }
    std::string token(
        reinterpret_cast<const char*>(credential->CredentialBlob),
        credential->CredentialBlobSize
    );
    CredFree(credential);
    return token;
}

void SystemCredentialStore::save_token(std::string token)
{
    const auto target = to_wide(service_ + ":" + account_);
    CREDENTIALW credential{};
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = const_cast<LPWSTR>(target.c_str());
    credential.CredentialBlobSize = static_cast<DWORD>(token.size());
    credential.CredentialBlob = reinterpret_cast<LPBYTE>(token.data());
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    CredWriteW(&credential, 0);
}

void SystemCredentialStore::clear_token()
{
    const auto target = to_wide(service_ + ":" + account_);
    CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0);
}

} // namespace crate::vdj
