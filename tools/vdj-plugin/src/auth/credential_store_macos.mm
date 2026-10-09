#include "crate_vdj/credential_store.hpp"

#include <Security/Security.h>

#include <string>

namespace crate::vdj {
namespace {

CFStringRef to_cf_string(const std::string& value)
{
    return CFStringCreateWithCString(
        kCFAllocatorDefault,
        value.c_str(),
        kCFStringEncodingUTF8
    );
}

CFMutableDictionaryRef base_query(
    const std::string& service,
    const std::string& account
)
{
    auto query = CFDictionaryCreateMutable(
        kCFAllocatorDefault,
        4,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    auto service_value = to_cf_string(service);
    auto account_value = to_cf_string(account);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, service_value);
    CFDictionarySetValue(query, kSecAttrAccount, account_value);
    CFRelease(service_value);
    CFRelease(account_value);
    return query;
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
    auto query = base_query(service_, account_);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDataRef data = nullptr;
    const auto status = SecItemCopyMatching(query, (CFTypeRef*)&data);
    CFRelease(query);
    if (status != errSecSuccess || data == nullptr) {
        if (data != nullptr) {
            CFRelease(data);
        }
        return std::nullopt;
    }

    const auto* bytes = reinterpret_cast<const char*>(CFDataGetBytePtr(data));
    const auto length = CFDataGetLength(data);
    std::string token(bytes, bytes + length);
    CFRelease(data);
    return token;
}

bool SystemCredentialStore::save_token(std::string token)
{
    auto query = base_query(service_, account_);
    auto data = CFDataCreate(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(token.data()),
        static_cast<CFIndex>(token.size())
    );
    const void* update_keys[] = {kSecValueData};
    const void* update_values[] = {data};
    auto attributes = CFDictionaryCreate(
        kCFAllocatorDefault,
        update_keys,
        update_values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    auto status = SecItemUpdate(query, attributes);
    CFRelease(attributes);

    if (status == errSecItemNotFound) {
        CFDictionarySetValue(query, kSecValueData, data);
        status = SecItemAdd(query, nullptr);
    }
    CFRelease(data);
    CFRelease(query);
    return status == errSecSuccess;
}

bool SystemCredentialStore::clear_token()
{
    auto query = base_query(service_, account_);
    const auto status = SecItemDelete(query);
    CFRelease(query);
    return status == errSecSuccess || status == errSecItemNotFound;
}

} // namespace crate::vdj
