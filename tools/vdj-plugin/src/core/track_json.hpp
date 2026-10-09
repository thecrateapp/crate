#pragma once

#include "crate_vdj/json_mapping.hpp"
#include "crate_vdj/models.hpp"

namespace crate::vdj::detail {

bool parse_track_json(const json::Value& item, SearchTrack& track);

} // namespace crate::vdj::detail
