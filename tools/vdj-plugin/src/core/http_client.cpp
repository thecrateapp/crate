#include "crate_vdj/http_client.hpp"

#include <string>

namespace crate::vdj {

void CancellationState::cancel()
{
    cancelled_.store(true, std::memory_order_release);
}

bool CancellationState::cancelled() const
{
    return cancelled_.load(std::memory_order_acquire);
}

CancellationToken::CancellationToken(std::shared_ptr<CancellationState> state)
    : state_(std::move(state))
{
}

bool CancellationToken::cancelled() const
{
    return state_ != nullptr && state_->cancelled();
}

CancellationSource::CancellationSource()
    : state_(std::make_shared<CancellationState>())
{
}

CancellationToken CancellationSource::token() const
{
    return CancellationToken(state_);
}

void CancellationSource::cancel()
{
    state_->cancel();
}

bool is_allowed_origin(std::string_view url, std::string_view allowed_origin)
{
    constexpr std::string_view scheme = "https://";
    if (!url.starts_with(scheme) || !allowed_origin.starts_with(scheme)) {
        return false;
    }

    const auto url_end = url.find_first_of("/?#", scheme.size());
    const auto origin = url.substr(0, url_end);
    if (origin.size() <= scheme.size()) {
        return false;
    }

    if (allowed_origin.find_first_of("/?#", scheme.size()) !=
        std::string_view::npos) {
        return false;
    }

    return origin == allowed_origin;
}

bool should_abort(
    const CancellationToken& token,
    std::chrono::steady_clock::time_point deadline
)
{
    return token.cancelled() || std::chrono::steady_clock::now() >= deadline;
}

HttpError normalize_http_failure(const HttpFailure& failure)
{
    return HttpError{
        .code = static_cast<HttpErrorCode>(failure.code),
        .status_code = failure.status_code,
        .message = failure.message,
    };
}

bool append_bounded_body(std::string& body, std::string_view chunk, std::size_t limit)
{
    if (chunk.size() > limit || body.size() > limit - chunk.size()) {
        return false;
    }
    body.append(chunk);
    return true;
}

} // namespace crate::vdj
