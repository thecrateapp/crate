#include "crate_vdj/http_client.hpp"

#include <curl/curl.h>

#include <chrono>
#include <cstdlib>
#include <string>

namespace crate::vdj {
namespace {

size_t write_body(char* data, size_t size, size_t count, void* user_data)
{
    auto* body = static_cast<std::string*>(user_data);
    body->append(data, size * count);
    return size * count;
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
        return {
            .code = HttpErrorCode::Cancelled,
            .status_code = 0,
            .message = "request cancelled",
        };
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

    auto* handle = curl_easy_init();
    if (handle == nullptr) {
        return HttpError{
            .code = HttpErrorCode::Network,
            .status_code = 0,
            .message = "could not initialize HTTP client",
        };
    }

    std::string response_body;
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
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &response_body);
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

    const auto result = curl_easy_perform(handle);
    long status_code = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status_code);
    curl_slist_free_all(headers);
    curl_easy_cleanup(handle);

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
        .body = std::move(response_body),
    };
}

} // namespace crate::vdj
