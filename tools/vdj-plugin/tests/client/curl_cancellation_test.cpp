#include "crate_vdj/http_client.hpp"

#include "../support/check.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <future>
#include <iostream>
#include <string>
#include <thread>
#include <variant>

using namespace crate::vdj;
using namespace std::chrono_literals;

namespace {

class SilentListener {
public:
    SilentListener()
    {
        fd_ = socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;
        CRATE_CHECK(bind(fd_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0);
        CRATE_CHECK(listen(fd_, 4) == 0);
        socklen_t length = sizeof(address);
        CRATE_CHECK(getsockname(fd_, reinterpret_cast<sockaddr*>(&address), &length) == 0);
        port_ = ntohs(address.sin_port);
    }

    ~SilentListener()
    {
        close(fd_);
    }

    std::string origin() const
    {
        return "https://127.0.0.1:" + std::to_string(port_);
    }

private:
    int fd_ = -1;
    int port_ = 0;
};

} // namespace

int main()
{
    SilentListener server;
    CurlHttpClient http;
    CancellationSource cancellation;

    auto pending = std::async(std::launch::async, [&] {
        return http.request(HttpRequest{
            .url = server.origin() + "/api/auth/me",
            .allowed_origin = server.origin(),
            .timeout = 10s,
            .cancellation = cancellation.token(),
        });
    });

    std::this_thread::sleep_for(150ms);
    CRATE_CHECK(pending.wait_for(0ms) == std::future_status::timeout);

    const auto cancelled_at = std::chrono::steady_clock::now();
    cancellation.cancel();
    const auto result = pending.get();
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - cancelled_at
    );
    std::cout << "cancellation interrupted the transfer after " << elapsed.count() << " ms\n";

    CRATE_CHECK(std::holds_alternative<HttpError>(result));
    CRATE_CHECK(std::get<HttpError>(result).code == HttpErrorCode::Cancelled);
    CRATE_CHECK(!allows_stale_fallback(std::get<HttpError>(result)));
    CRATE_CHECK(elapsed < 250ms);
}
