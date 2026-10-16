#pragma once

#include <string>
#include <string_view>

namespace crate::vdj {

bool is_spanish_language(std::string_view language);

std::string_view compatible_folder_label(std::string_view language);
std::string_view compatible_menu_label(std::string_view language);
std::string_view open_in_crate_menu_label(std::string_view language);

std::string catalog_folder_label(
    std::string_view folder_id,
    std::string_view fallback_name,
    std::string_view language
);

} // namespace crate::vdj
