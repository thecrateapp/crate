#include "crate_vdj/connection_worker.hpp"

#include <utility>

namespace crate::vdj {

ConnectionWorker::ConnectionWorker(
    ConnectionSession& session,
    ChangeListener on_change,
    ConnectListener on_connect,
    std::chrono::milliseconds wake_interval
)
    : session_(session)
    , on_change_(std::move(on_change))
    , on_connect_(std::move(on_connect))
    , wake_interval_(wake_interval)
{
}

ConnectionWorker::~ConnectionWorker()
{
    {
        std::lock_guard lock(mutex_);
        stopping_ = true;
        pending_.reset();
        if (active_.has_value()) {
            active_->cancel();
        }
    }
    wakeup_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
}

void ConnectionWorker::start()
{
    thread_ = std::thread([this] { run(); });
}

void ConnectionWorker::connect(std::string origin, std::string token)
{
    {
        std::lock_guard lock(mutex_);
        pending_ = PendingConnect{std::move(origin), std::move(token)};
        if (active_.has_value()) {
            active_->cancel();
        }
    }
    wakeup_.notify_all();
}

bool ConnectionWorker::disconnect()
{
    {
        std::lock_guard lock(mutex_);
        pending_.reset();
        if (active_.has_value()) {
            active_->cancel();
        }
    }
    const bool cleared = session_.disconnect();
    on_change_();
    return cleared;
}

std::optional<CancellationToken> ConnectionWorker::begin_operation_locked()
{
    if (stopping_) {
        return std::nullopt;
    }
    active_.emplace();
    return active_->token();
}

void ConnectionWorker::run()
{
    std::unique_lock lock(mutex_);
    if (const auto cancellation = begin_operation_locked()) {
        lock.unlock();
        session_.restore(ConnectionSession::Clock::now(), *cancellation);
        on_change_();
        lock.lock();
        active_.reset();
    }
    while (!stopping_) {
        wakeup_.wait_for(lock, wake_interval_, [this] {
            return stopping_ || pending_.has_value();
        });
        const auto cancellation = begin_operation_locked();
        if (!cancellation.has_value()) {
            break;
        }
        auto request = std::exchange(pending_, std::nullopt);
        lock.unlock();
        if (request.has_value()) {
            const auto result = session_.connect(
                request->origin,
                request->token,
                ConnectionSession::Clock::now(),
                *cancellation
            );
            on_change_();
            if (result.error != ConnectError::Cancelled) {
                on_connect_(result);
            }
        } else {
            session_.refresh_if_due(ConnectionSession::Clock::now(), *cancellation);
            on_change_();
        }
        lock.lock();
        active_.reset();
    }
}

} // namespace crate::vdj
