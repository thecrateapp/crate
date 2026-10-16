#include "crate_vdj/models.hpp"

#include "../support/check.hpp"

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
    CRATE_CHECK(parsed.ok());
    CRATE_CHECK(parsed.value->artists.size() == 1);
    CRATE_CHECK(parsed.value->albums.size() == 1);
    CRATE_CHECK(parsed.value->tracks.size() == 1);
    CRATE_CHECK(parsed.value->tracks[0].entity_uid == "track-1");
    CRATE_CHECK(parsed.value->tracks[0].title == "Noah");
    CRATE_CHECK(parsed.value->tracks[0].duration_seconds == 193.5);
    CRATE_CHECK(parsed.value->tracks[0].year == 2022);
    CRATE_CHECK(parsed.value->tracks[0].genre == "post-punk");
    CRATE_CHECK(parsed.value->tracks[0].bpm == 95.0);
    CRATE_CHECK(parsed.value->tracks[0].audio_key == "F#");
    CRATE_CHECK(parsed.value->tracks[0].audio_scale == "minor");
    CRATE_CHECK(parsed.value->tracks[0].has_cover);
    CRATE_CHECK(parsed.value->tracks[0].cover_url == "/api/vdj/albums/album-1/cover?size=512");

    const auto empty = parse_search_json(
        R"json({"artists": [], "albums": [], "tracks": []})json"
    );
    CRATE_CHECK(empty.ok());
    CRATE_CHECK(empty.value->tracks.empty());

    const auto missing_identity = parse_search_json(
        R"json({"artists": [], "albums": [], "tracks": [{"title": "Noah"}]})json"
    );
    CRATE_CHECK(!missing_identity.ok());
    CRATE_CHECK(missing_identity.error_code == ModelErrorCode::InvalidField);

    const auto malformed = parse_search_json(
        R"json({"artists": [})json"
    );
    CRATE_CHECK(!malformed.ok());
    CRATE_CHECK(malformed.error_code == ModelErrorCode::InvalidJson);
}
