#pragma once

#include <functional>
#include <string>

void crate_probe_open_login_window(
    std::function<void(bool)> on_closed,
    std::function<void(const std::string&)> log
);
