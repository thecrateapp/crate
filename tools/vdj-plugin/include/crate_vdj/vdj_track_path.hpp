#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

std::optional<std::string> crate_uid_from_vdj_filepath(
    std::string_view filepath
);

}
