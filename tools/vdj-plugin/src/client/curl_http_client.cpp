#include "crate_vdj/http_client.hpp"

#include <curl/curl.h>

#include <chrono>
#include <mutex>
#include <string_view>
#include <cstdlib>
#include <string>

namespace crate::vdj {
namespace {

struct BodySink {
    std::string body;
    std::size_t limit = 0;
    bool overflowed = false;
};

size_t write_body(char* data, size_t size, size_t count, void* user_data)
{
    auto* sink = static_cast<BodySink*>(user_data);
    if (!append_bounded_body(sink->body, std::string_view(data, size * count), sink->limit)) {
        sink->overflowed = true;
        return 0;
    }
    return size * count;
}

void initialize_curl_once()
{
    static std::once_flag initialized;
    std::call_once(initialized, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

struct ThreadHandles {
    CURLM* multi = nullptr;
    CURL* easy = nullptr;

    ~ThreadHandles()
    {
        if (easy != nullptr) {
            curl_easy_cleanup(easy);
        }
        if (multi != nullptr) {
            curl_multi_cleanup(multi);
        }
    }
};

ThreadHandles* thread_handles()
{
    thread_local ThreadHandles handles;
    if (handles.multi == nullptr) {
        handles.multi = curl_multi_init();
    }
    if (handles.easy == nullptr) {
        handles.easy = curl_easy_init();
    } else {
        curl_easy_reset(handles.easy);
    }
    if (handles.multi == nullptr || handles.easy == nullptr) {
        return nullptr;
    }
    return &handles;
}

CURLcode perform_cancellable(
    CURLM* multi,
    CURL* easy,
    const CancellationToken& cancellation
)
{
    constexpr int kCancellationPollMs = 50;
    if (curl_multi_add_handle(multi, easy) != CURLM_OK) {
        return CURLE_FAILED_INIT;
    }
    CURLcode result = CURLE_ABORTED_BY_CALLBACK;
    int running = 1;
    while (running > 0 && !cancellation.cancelled()) {
        if (curl_multi_perform(multi, &running) != CURLM_OK) {
            result = CURLE_FAILED_INIT;
            break;
        }
        if (running > 0 &&
            curl_multi_poll(multi, nullptr, 0, kCancellationPollMs, nullptr) != CURLM_OK) {
            result = CURLE_FAILED_INIT;
            break;
        }
    }
    int queued = 0;
    while (CURLMsg* message = curl_multi_info_read(multi, &queued)) {
        if (message->msg == CURLMSG_DONE && message->easy_handle == easy) {
            result = message->data.result;
        }
    }
    curl_multi_remove_handle(multi, easy);
    return result;
}

HttpError cancelled_error()
{
    return {
        .code = HttpErrorCode::Cancelled,
        .status_code = 0,
        .message = "request cancelled",
    };
}

int progress(
    void* user_data,
    curl_off_t,
    curl_off_t,
    curl_off_t,
    curl_off_t
)
{
    const auto* cancellation = static_cast<const CancellationToken*>(user_data);
    return cancellation != nullptr && cancellation->cancelled() ? 1 : 0;
}

HttpError error_from_curl(
    CURLcode code,
    const HttpRequest& request,
    const char* error_buffer
)
{
    if (code == CURLE_ABORTED_BY_CALLBACK && request.cancellation.cancelled()) {
        return cancelled_error();
    }
    if (code == CURLE_OPERATION_TIMEDOUT) {
        return {
            .code = HttpErrorCode::Timeout,
            .status_code = 0,
            .message = "request timed out",
        };
    }
    return {
        .code = HttpErrorCode::Network,
        .status_code = 0,
        .message = error_buffer != nullptr && error_buffer[0] != '\0'
            ? error_buffer
            : "network request failed",
    };
}

} // namespace

HttpResult CurlHttpClient::request(const HttpRequest& request)
{
    if (!is_allowed_origin(request.url, request.allowed_origin)) {
        return HttpError{
            .code = HttpErrorCode::InvalidResponse,
            .status_code = 0,
            .message = "request URL must use a valid HTTPS origin",
        };
    }

    if (request.cancellation.cancelled()) {
        return cancelled_error();
    }

    initialize_curl_once();
    auto* handles = thread_handles();
    if (handles == nullptr) {
        return HttpError{
            .code = HttpErrorCode::Network,
            .status_code = 0,
            .message = "could not initialize HTTP client",
        };
    }

    auto* handle = handles->easy;
    BodySink sink{.body = {}, .limit = request.max_body_bytes, .overflowed = false};
    char error_buffer[CURL_ERROR_SIZE] = {};
    curl_slist* headers = nullptr;
    for (const auto& [name, value] : request.headers) {
        headers = curl_slist_append(
            headers,
            (name + ": " + value).c_str()
        );
    }

    curl_easy_setopt(handle, CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(handle, CURLOPT_CUSTOMREQUEST, request.method.c_str());
    curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, write_body);
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 0L);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(handle, CURLOPT_PROTOCOLS_STR, "https");
#else
    curl_easy_setopt(handle, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
#endif
    curl_easy_setopt(handle, CURLOPT_ERRORBUFFER, error_buffer);
    if (const char* ca_bundle = std::getenv("CRATE_VDJ_CA_BUNDLE");
        ca_bundle != nullptr && ca_bundle[0] != '\0') {
        // The local pilot uses Caddy's development CA. Keep certificate
        // verification enabled and opt into that CA only when configured.
        curl_easy_setopt(handle, CURLOPT_CAINFO, ca_bundle);
    }
    curl_easy_setopt(
        handle,
        CURLOPT_TIMEOUT_MS,
        static_cast<long>(request.timeout.count())
    );
    curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT_MS, 3000L);
    curl_easy_setopt(handle, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(handle, CURLOPT_XFERINFOFUNCTION, progress);
    curl_easy_setopt(handle, CURLOPT_XFERINFODATA, &request.cancellation);
    if (!request.body.empty()) {
        curl_easy_setopt(handle, CURLOPT_POSTFIELDS, request.body.c_str());
    }

    const auto result = perform_cancellable(handles->multi, handle, request.cancellation);
    long status_code = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status_code);
    curl_slist_free_all(headers);

    if (sink.overflowed) {
        return HttpError{
            .code = HttpErrorCode::InvalidResponse,
            .status_code = static_cast<int>(status_code),
            .message = "response body too large",
        };
    }
    if (request.cancellation.cancelled()) {
        return cancelled_error();
    }
    if (result != CURLE_OK) {
        return error_from_curl(result, request, error_buffer);
    }
    if (status_code < 200 || status_code >= 300) {
        return HttpError{
            .code = HttpErrorCode::HttpStatus,
            .status_code = static_cast<int>(status_code),
            .message = "HTTP request returned status " +
                std::to_string(status_code),
        };
    }
    return HttpResponse{
        .status_code = static_cast<int>(status_code),
        .body = std::move(sink.body),
    };
}

} // namespace crate::vdj
