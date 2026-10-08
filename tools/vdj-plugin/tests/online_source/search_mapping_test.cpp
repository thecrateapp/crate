#include "crate_vdj/models.hpp"

#include <cassert>

using namespace crate::vdj;

int main()
{
    const auto parsed = parse_search_json(R"json(
        {
          "artists": [
            {"entity_uid": "artist-1", "name": "Birds In Row", "slug": "birds-in-row"}
          ],
          "albums": [
            {"entity_uid": "album-1", "name": "Gris Klein", "artist": "Birds In Row"}
          ],
          "tracks": [
            {
              "entity_uid": "track-1",
              "title": "Noah",
              "artist": "Birds In Row",
              "album": "Gris Klein",
              "path": "/music/track-1.flac",
              "duration": 193.5,
              "year": "2022",
              "genre": "post-punk",
              "bpm": 95.0,
              "audio_key": "F#",
              "audio_scale": "minor",
              "has_cover": true,
              "cover_url": "/api/vdj/albums/album-1/cover?size=512",
              "future": {"ignored": true}
            }
          ],
          "future_top_level": [1, true, null]
        }
    )json");
    assert(parsed.ok());
    assert(parsed.value->artists.size() == 1);
    assert(parsed.value->albums.size() == 1);
    assert(parsed.value->tracks.size() == 1);
    assert(parsed.value->tracks[0].entity_uid == "track-1");
    assert(parsed.value->tracks[0].title == "Noah");
    assert(parsed.value->tracks[0].duration_seconds == 193.5);
    assert(parsed.value->tracks[0].year == 2022);
    assert(parsed.value->tracks[0].genre == "post-punk");
    assert(parsed.value->tracks[0].bpm == 95.0);
    assert(parsed.value->tracks[0].audio_key == "F#");
    assert(parsed.value->tracks[0].audio_scale == "minor");
    assert(parsed.value->tracks[0].has_cover);
    assert(parsed.value->tracks[0].cover_url == "/api/vdj/albums/album-1/cover?size=512");

    const auto empty = parse_search_json(
        R"json({"artists": [], "albums": [], "tracks": []})json"
    );
    assert(empty.ok());
    assert(empty.value->tracks.empty());

    const auto missing_identity = parse_search_json(
        R"json({"artists": [], "albums": [], "tracks": [{"title": "Noah"}]})json"
    );
    assert(!missing_identity.ok());
    assert(missing_identity.error_code == ModelErrorCode::InvalidField);

    const auto malformed = parse_search_json(
        R"json({"artists": [})json"
    );
    assert(!malformed.ok());
    assert(malformed.error_code == ModelErrorCode::InvalidJson);
}
