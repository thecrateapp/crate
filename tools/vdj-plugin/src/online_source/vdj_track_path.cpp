#include "crate_vdj/vdj_track_path.hpp"

#include <array>

namespace crate::vdj {

std::optional<std::string> crate_uid_from_vdj_filepath(
    std::string_view filepath
)
{
    constexpr std::array<std::string_view, 2> prefixes = {
        "netsearch://plugin-crate_vdj_online_source/",
        "netsearch://plugin-Crate/"
    };

    for (const auto prefix : prefixes) {
        if (filepath.starts_with(prefix) && filepath.size() > prefix.size()) {
            return std::string(filepath.substr(prefix.size()));
        }
    }

    return std::nullopt;
}

}
