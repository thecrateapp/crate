#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace crate::vdj {

class CancellationState {
public:
    void cancel();
    bool cancelled() const;

private:
    std::atomic_bool cancelled_ = false;
};

class CancellationToken {
public:
    CancellationToken() = default;

    bool cancelled() const;

private:
    friend class CancellationSource;
    explicit CancellationToken(std::shared_ptr<CancellationState> state);

    std::shared_ptr<CancellationState> state_;
};

class CancellationSource {
public:
    CancellationSource();

    CancellationToken token() const;
    void cancel();

private:
    std::shared_ptr<CancellationState> state_;
};

enum class HttpFailureCode {
    Cancelled,
    Timeout,
    Network,
    HttpStatus,
    InvalidResponse,
};

struct HttpFailure {
    HttpFailureCode code;
    int status_code;
    std::string message;
};

enum class HttpErrorCode {
    Cancelled,
    Timeout,
    Network,
    HttpStatus,
    InvalidResponse,
};

struct HttpError {
    HttpErrorCode code;
    int status_code;
    std::string message;
};

struct HttpRequest {
    std::string method = "GET";
    std::string url;
    std::string allowed_origin;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    std::chrono::milliseconds timeout = std::chrono::seconds(15);
    CancellationToken cancellation;
};

struct HttpResponse {
    int status_code = 0;
    std::string body;
};

using HttpResult = std::variant<HttpResponse, HttpError>;

class HttpClient {
public:
    virtual ~HttpClient() = default;
    virtual HttpResult request(const HttpRequest& request) = 0;
};

class CurlHttpClient final : public HttpClient {
public:
    HttpResult request(const HttpRequest& request) override;
};

bool is_allowed_origin(std::string_view url, std::string_view allowed_origin);

bool should_abort(
    const CancellationToken& token,
    std::chrono::steady_clock::time_point deadline
);

HttpError normalize_http_failure(const HttpFailure& failure);

} // namespace crate::vdj
