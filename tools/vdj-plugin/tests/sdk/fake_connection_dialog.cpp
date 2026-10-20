#include "../../src/platform/connection_dialog.hpp"

namespace crate::vdj {

ConnectionDialogResult show_connection_dialog(const ConnectionDialogRequest&)
{
    return {};
}

void show_connection_message(const std::string&, const std::string&) {}

} // namespace crate::vdj
