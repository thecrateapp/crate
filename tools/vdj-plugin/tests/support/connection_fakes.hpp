#pragma once

#include "crate_vdj/connection_session.hpp"
#include "scripted_http.hpp"

#include <chrono>
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace crate::vdj::testing {

struct SharedVault {
    std::mutex mutex;
    std::map<std::string, std::string> tokens;
    int loads = 0;
    bool fail_writes = false;
};

class VaultCredentialStore final : public CredentialStore {
public:
    VaultCredentialStore(std::shared_ptr<SharedVault> vault, std::string account)
        : vault_(std::move(vault)), account_(std::move(account))
    {
    }

    std::optional<std::string> load_token() override
    {
        std::lock_guard lock(vault_->mutex);
        ++vault_->loads;
        const auto found = vault_->tokens.find(account_);
        if (found == vault_->tokens.end()) {
            return std::nullopt;
        }
        return found->second;
    }

    bool save_token(std::string token) override
    {
        std::lock_guard lock(vault_->mutex);
        if (vault_->fail_writes) {
            return false;
        }
        vault_->tokens[account_] = std::move(token);
        return true;
    }

    bool clear_token() override
    {
        std::lock_guard lock(vault_->mutex);
        if (vault_->fail_writes) {
            return false;
        }
        vault_->tokens.erase(account_);
        return true;
    }

private:
    std::shared_ptr<SharedVault> vault_;
    std::string account_;
};

class MemorySettingsStore final : public ConnectionSettingsStore {
public:
    std::optional<std::string> origin;
    bool fail_writes = false;

    std::optional<std::string> load_origin() override
    {
        return origin;
    }

    bool save_origin(std::string_view value) override
    {
        if (fail_writes) {
            return false;
        }
        origin = std::string(value);
        return true;
    }

    bool clear() override
    {
        origin.reset();
        return true;
    }
};

class GatedHttpClient final : public HttpClient {
public:
    ScriptedHttpClient scripted;
    std::string blocked_prefix;

    HttpResult request(const HttpRequest& request) override
    {
        if (!blocked_prefix.empty() && request.url.starts_with(blocked_prefix)) {
            {
                std::lock_guard lock(mutex_);
                ++blocked_;
            }
            blocked_changed_.notify_all();
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
            while (!request.cancellation.cancelled() &&
                   std::chrono::steady_clock::now() < deadline) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            return HttpError{
                .code = request.cancellation.cancelled() ? HttpErrorCode::Cancelled
                                                         : HttpErrorCode::Timeout,
                .status_code = 0,
                .message = "gated request ended",
            };
        }
        std::lock_guard lock(mutex_);
        return scripted.request(request);
    }

    bool wait_until_blocked(int count = 1)
    {
        std::unique_lock lock(mutex_);
        return blocked_changed_.wait_for(lock, std::chrono::seconds(2), [&] {
            return blocked_ >= count;
        });
    }

private:
    std::mutex mutex_;
    std::condition_variable blocked_changed_;
    int blocked_ = 0;
};

} // namespace crate::vdj::testing
