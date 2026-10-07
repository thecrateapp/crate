#include "crate_vdj/vdj_track_path.hpp"

#include <iostream>
#include <string>

int main()
{
    const auto current_track = crate::vdj::crate_uid_from_vdj_filepath(
        "netsearch://plugin-crate_vdj_online_source/track-123"
    );
    if (!current_track.has_value() || *current_track != "track-123") {
        std::cerr << "Legacy Crate netsearch path was not parsed\n";
        return 1;
    }

    const auto renamed_track = crate::vdj::crate_uid_from_vdj_filepath(
        "netsearch://plugin-Crate/track-456"
    );
    if (!renamed_track.has_value() || *renamed_track != "track-456") {
        std::cerr << "Renamed Crate netsearch path was not parsed\n";
        return 1;
    }

    const auto other_provider = crate::vdj::crate_uid_from_vdj_filepath(
        "netsearch://plugin-SoundCloud/track-789"
    );
    if (other_provider.has_value()) {
        std::cerr << "Another provider was incorrectly accepted\n";
        return 1;
    }

    const auto empty_track = crate::vdj::crate_uid_from_vdj_filepath(
        "netsearch://plugin-Crate/"
    );
    if (empty_track.has_value()) {
        std::cerr << "An empty Crate track id was accepted\n";
        return 1;
    }

    return 0;
}
