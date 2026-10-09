#include "probe_platform.hpp"

void crate_probe_open_login_window(
    std::function<void(bool)> on_closed,
    std::function<void(const std::string&)> log
)
{
    log("native login window not implemented on this platform");
    on_closed(false);
}
