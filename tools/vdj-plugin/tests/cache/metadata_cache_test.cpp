#include "crate_vdj/metadata_cache.hpp"

#include <cassert>
#include <filesystem>
#include <fstream>
#include <string>

namespace {

crate::vdj::SearchResults sample_search_results(
    std::string cover_url = "/api/vdj/albums/42/cover?size=512"
)
{
    crate::vdj::SearchResults results;
    results.tracks.push_back({
        .entity_uid = "track:high-vis:talk-for-hours",
        .title = "Talk For Hours",
        .artist = "High Vis",
        .album = "Guided Tour",
        .path = "/music/High Vis/Guided Tour/01 Talk For Hours.flac",
        .duration_seconds = 299,
        .year = 2022,
        .genre = "post-punk",
        .bpm = 95,
        .audio_key = "F#",
        .audio_scale = "m",
        .has_cover = true,
        .cover_url = std::move(cover_url),
    });
    return results;
}

crate::vdj::CatalogResults sample_catalog_results()
{
    crate::vdj::CatalogResults results;
    results.folders.push_back({"crate:genres", "Genres"});
    results.tracks = sample_search_results().tracks;
    results.next_cursor = "cursor-2";
    return results;
}

} // namespace

int main()
{
    const auto database_path =
        std::filesystem::temp_directory_path() / "crate-vdj-metadata-cache-test.sqlite";
    std::filesystem::remove(database_path);

    crate::vdj::MetadataCacheStore cache(
        database_path.string(),
        {
            .fresh_ttl_seconds = 100,
            .stale_ttl_seconds = 100,
            .max_entries = 2,
        }
    );
    assert(cache.ready());

    const crate::vdj::MetadataCacheScope scope{
        .origin = "https://api.dev.lespedants.org",
        .account_key = "account-a",
    };
    const auto results = sample_search_results();
    assert(cache.put_search(scope, "high vis", results, 1));

    auto lookup = cache.get_search(scope, "high vis", 50);
    assert(lookup.ok());
    assert(lookup.state == crate::vdj::CacheState::Fresh);
    assert(lookup.value->tracks.size() == 1);
    assert(lookup.value->tracks[0].path.empty());
    assert(lookup.value->tracks[0].cover_url == results.tracks[0].cover_url);

    lookup = cache.get_search(scope, "high vis", 101);
    assert(lookup.ok());
    assert(lookup.state == crate::vdj::CacheState::Stale);

    lookup = cache.get_search(scope, "high vis", 202);
    assert(lookup.ok());
    assert(lookup.state == crate::vdj::CacheState::Miss);
    assert(!lookup.value.has_value());

    assert(cache.put_catalog(scope, "folder:genres", sample_catalog_results(), 300));
    auto catalog = cache.get_catalog(scope, "folder:genres", 301);
    assert(catalog.ok());
    assert(catalog.state == crate::vdj::CacheState::Fresh);
    assert(catalog.value->folders.size() == 1);
    assert(catalog.value->next_cursor == "cursor-2");

    const crate::vdj::MetadataCacheScope other_account{
        .origin = scope.origin,
        .account_key = "account-b",
    };
    assert(cache.get_catalog(other_account, "folder:genres", 301).state ==
           crate::vdj::CacheState::Miss);
    const crate::vdj::MetadataCacheScope other_origin{
        .origin = "https://api.example.test",
        .account_key = scope.account_key,
    };
    assert(cache.get_search(other_origin, "high vis", 50).state ==
           crate::vdj::CacheState::Miss);

    assert(cache.put_search(scope, "first", sample_search_results(), 400));
    assert(cache.put_search(scope, "second", sample_search_results(), 401));
    assert(cache.put_search(scope, "third", sample_search_results(), 402));
    assert(cache.get_search(scope, "first", 403).state ==
           crate::vdj::CacheState::Miss);
    assert(cache.get_search(scope, "second", 403).state ==
           crate::vdj::CacheState::Fresh);
    assert(cache.get_search(scope, "third", 403).state ==
           crate::vdj::CacheState::Fresh);

    const auto unsafe_path = database_path.string() + ".unsafe";
    std::filesystem::remove(unsafe_path);
    crate::vdj::MetadataCacheStore unsafe_cache(unsafe_path);
    assert(unsafe_cache.ready());
    assert(unsafe_cache.put_search(
        scope,
        "unsafe",
        sample_search_results(
            "https://cdn.example.test/cover.jpg?media_ticket=secret"
        ),
        500
    ));
    std::ifstream raw_database(unsafe_path, std::ios::binary);
    const std::string raw_content{
        std::istreambuf_iterator<char>(raw_database),
        std::istreambuf_iterator<char>()
    };
    assert(raw_content.find("media_ticket=secret") == std::string::npos);
    assert(raw_content.find("/music/High Vis") == std::string::npos);

    std::filesystem::remove(database_path);
    std::filesystem::remove(unsafe_path);
    return 0;
}
