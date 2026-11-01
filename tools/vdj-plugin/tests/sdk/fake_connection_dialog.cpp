#include "crate_vdj/connection_dialog.hpp"

namespace crate::vdj {

ConnectionDialogResult show_connection_dialog(const ConnectionDialogRequest&)
{
    return {};
}

void show_connection_message(const std::string&, const std::string&) {}

bool open_in_browser(const std::string&)
{
    return true;
}

} // namespace crate::vdj
