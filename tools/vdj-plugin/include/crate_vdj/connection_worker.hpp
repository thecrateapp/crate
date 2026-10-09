#pragma once

#include "crate_vdj/connection_session.hpp"
#include "crate_vdj/http_client.hpp"

#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace crate::vdj {

class ConnectionWorker {
public:
    using ChangeListener = std::function<void()>;
    using ConnectListener = std::function<void(const ConnectResult&)>;

    ConnectionWorker(
        ConnectionSession& session,
        ChangeListener on_change,
        ConnectListener on_connect,
        std::chrono::milliseconds wake_interval = std::chrono::seconds(30)
    );
    ~ConnectionWorker();

    ConnectionWorker(const ConnectionWorker&) = delete;
    ConnectionWorker& operator=(const ConnectionWorker&) = delete;

    void start();
    void connect(std::string origin, std::string token);
    bool disconnect();

private:
    struct PendingConnect {
        std::string origin;
        std::string token;
    };

    void run();
    std::optional<CancellationToken> begin_operation_locked();

    ConnectionSession& session_;
    ChangeListener on_change_;
    ConnectListener on_connect_;
    std::chrono::milliseconds wake_interval_;
    std::mutex mutex_;
    std::condition_variable wakeup_;
    std::optional<PendingConnect> pending_;
    std::optional<CancellationSource> active_;
    bool stopping_ = false;
    std::thread thread_;
};

} // namespace crate::vdj
