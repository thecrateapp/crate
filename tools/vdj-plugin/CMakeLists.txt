cmake_minimum_required(VERSION 3.24)

project(CrateVirtualDJPlugin VERSION 1.0.0 LANGUAGES CXX)

include(FetchContent)
set(JSON_BuildTests OFF CACHE INTERNAL "")
set(JSON_Install OFF CACHE INTERNAL "")
FetchContent_Declare(
    nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
)
FetchContent_MakeAvailable(nlohmann_json)

find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)
if(NOT TARGET SQLite3::SQLite3)
    add_library(SQLite3::SQLite3 ALIAS SQLite::SQLite3)
endif()

option(
    CRATE_VDJ_BUILD_REAL_PLUGIN
    "Build the VirtualDJ SDK plugin target"
    OFF
)
option(
    CRATE_VDJ_BUILD_TESTS
    "Build the SDK-independent plugin tests"
    OFF
)
option(
    CRATE_VDJ_ENABLE_SANITIZERS
    "Enable AddressSanitizer and UndefinedBehaviorSanitizer"
    OFF
)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

add_custom_target(crate_vdj_headless ALL
    COMMAND ${CMAKE_COMMAND} -E echo
        "Crate VirtualDJ headless target: SDK-independent core"
)

add_library(crate_vdj_core STATIC
    src/core/contract_negotiator.cpp
    src/core/credential_store.cpp
    src/core/http_client.cpp
    src/core/json_mapping.cpp
    src/core/catalog_results.cpp
    src/core/models.cpp
    src/core/search_results.cpp
    src/cache/sqlite_metadata_cache.cpp
    src/client/curl_http_client.cpp
    src/client/catalog_client.cpp
    src/client/media_access_client.cpp
    src/client/search_client.cpp
    src/client/smart_mix_client.cpp
    src/online_source/compatible_tracks.cpp
    src/online_source/translations.cpp
    src/online_source/vdj_track_path.cpp
    src/mapping/compatible_tracks.cpp
    src/client/stream_resolver.cpp
    src/mapping/mix_profile.cpp
)

if(APPLE)
    enable_language(OBJCXX)
    target_sources(crate_vdj_core PRIVATE src/auth/credential_store_macos.mm)
    target_link_libraries(crate_vdj_core PRIVATE "-framework Security")
elseif(WIN32)
    target_sources(crate_vdj_core PRIVATE src/auth/credential_store_windows.cpp)
    target_link_libraries(crate_vdj_core PRIVATE Advapi32)
endif()
target_compile_features(crate_vdj_core PUBLIC cxx_std_20)
configure_file(
    cmake/version.hpp.in
    "${CMAKE_CURRENT_BINARY_DIR}/generated/crate_vdj/version.hpp"
    @ONLY
)
target_include_directories(crate_vdj_core PUBLIC
    include
    "${CMAKE_CURRENT_BINARY_DIR}/generated"
)
target_link_libraries(crate_vdj_core PUBLIC
    CURL::libcurl
    SQLite3::SQLite3
    nlohmann_json::nlohmann_json
)
target_compile_options(crate_vdj_core PRIVATE
    $<$<CXX_COMPILER_ID:AppleClang,Clang,GNU>:-Wall -Wextra -Wpedantic>
    $<$<CXX_COMPILER_ID:MSVC>:/W4>
)

if(CRATE_VDJ_ENABLE_SANITIZERS AND
   CMAKE_CXX_COMPILER_ID MATCHES "AppleClang|Clang|GNU")
    target_compile_options(crate_vdj_core PUBLIC
        -fsanitize=address,undefined
        -fno-sanitize-recover=undefined
        -fno-omit-frame-pointer
    )
    target_link_options(crate_vdj_core PUBLIC
        -fsanitize=address,undefined
    )
endif()

if(CRATE_VDJ_BUILD_REAL_PLUGIN)
    if(NOT APPLE AND NOT WIN32)
        message(FATAL_ERROR
            "The real VirtualDJ plugin is supported only on macOS and Windows"
        )
    endif()

    find_package(VirtualDJSDK REQUIRED)

    if(APPLE)
        set(CRATE_VDJ_ICON_SOURCE
            "${CMAKE_CURRENT_BINARY_DIR}/crate-icon.png"
        )
        set(CRATE_VDJ_BITMAP_SOURCE
            "${CMAKE_CURRENT_BINARY_DIR}/crate-icon.bmp"
        )
        configure_file(
            "${CMAKE_CURRENT_SOURCE_DIR}/../../app/listen/public/icons/icon-192.png"
            "${CRATE_VDJ_ICON_SOURCE}"
            COPYONLY
        )
        add_custom_command(
            OUTPUT "${CRATE_VDJ_BITMAP_SOURCE}"
            COMMAND /usr/bin/sips
                -s format bmp
                "${CRATE_VDJ_ICON_SOURCE}"
                --out "${CRATE_VDJ_BITMAP_SOURCE}"
            DEPENDS "${CRATE_VDJ_ICON_SOURCE}"
            VERBATIM
        )
        add_custom_target(crate_vdj_bitmap ALL
            DEPENDS "${CRATE_VDJ_BITMAP_SOURCE}"
        )
    endif()

    function(configure_vdj_plugin_target target output_name)
        add_library(${target} MODULE spike/control_spike.cpp)
        target_compile_features(${target} PRIVATE cxx_std_20)
        target_link_libraries(
            ${target}
            PRIVATE
                VirtualDJSDK::Headers
                crate_vdj_core
        )
        target_compile_definitions(${target} PRIVATE CRATE_VDJ_REAL_PLUGIN=1)
        target_compile_options(${target} PRIVATE
            $<$<CXX_COMPILER_ID:AppleClang,Clang>:-Wall -Wextra -Wpedantic>
            $<$<CXX_COMPILER_ID:MSVC>:/W4>
        )
        set_target_properties(${target} PROPERTIES OUTPUT_NAME "${output_name}")

        if(APPLE)
            set_source_files_properties(
                "${CRATE_VDJ_ICON_SOURCE}"
                PROPERTIES
                    MACOSX_PACKAGE_LOCATION Resources
            )
            set_source_files_properties(
                "${CRATE_VDJ_BITMAP_SOURCE}"
                PROPERTIES
                    MACOSX_PACKAGE_LOCATION Resources
            )
            target_sources(
                ${target}
                PRIVATE
                    "${CRATE_VDJ_ICON_SOURCE}"
                    "${CRATE_VDJ_BITMAP_SOURCE}"
            )
            add_dependencies(${target} crate_vdj_bitmap)
            target_link_libraries(
                ${target}
                PRIVATE
                    "-framework CoreFoundation"
                    "-framework Security"
            )
            set(CRATE_VDJ_BUNDLE_EXECUTABLE "${output_name}")
            set(CRATE_VDJ_BUNDLE_IDENTIFIER
                "org.cratemusic.virtualdj.${target}"
            )
            set(CRATE_VDJ_BUNDLE_NAME "Crate")
            configure_file(
                "${CMAKE_CURRENT_SOURCE_DIR}/spike/Info.plist.in"
                "${CMAKE_CURRENT_BINARY_DIR}/${target}-Info.plist"
                @ONLY
            )
            set_target_properties(${target} PROPERTIES
                PREFIX ""
                BUNDLE TRUE
                BUNDLE_EXTENSION "bundle"
                MACOSX_BUNDLE_INFO_PLIST
                    "${CMAKE_CURRENT_BINARY_DIR}/${target}-Info.plist"
            )
        elseif(WIN32)
            set_target_properties(${target} PROPERTIES PREFIX "")
        endif()
    endfunction()

    configure_vdj_plugin_target(crate_vdj_control_plugin crate_vdj_control)

    configure_vdj_plugin_target(
        crate_vdj_online_source_plugin
        Crate
    )
    target_compile_definitions(
        crate_vdj_online_source_plugin
        PRIVATE CRATE_VDJ_ONLINE_SOURCE_PLUGIN=1
    )

    if(APPLE AND CRATE_VDJ_BUILD_TESTS)
        add_test(
            NAME crate_vdj_bundle_metadata
            COMMAND ${CMAKE_COMMAND}
                -DCRATE_VDJ_CONTROL_BUNDLE=$<TARGET_BUNDLE_DIR:crate_vdj_control_plugin>
                -DCRATE_VDJ_ONLINE_SOURCE_BUNDLE=$<TARGET_BUNDLE_DIR:crate_vdj_online_source_plugin>
                -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/sdk/verify_bundle_metadata.cmake"
        )
    endif()
endif()

if(CRATE_VDJ_BUILD_TESTS)
    enable_testing()

    add_executable(crate_vdj_check_self_test
        tests/support/check_self_test.cpp
    )
    target_compile_features(crate_vdj_check_self_test PRIVATE cxx_std_20)
    add_test(NAME crate_vdj_check_self_test COMMAND crate_vdj_check_self_test)
    set_tests_properties(crate_vdj_check_self_test PROPERTIES WILL_FAIL TRUE)

    add_executable(crate_vdj_http_client_test
        tests/client/http_client_test.cpp
    )
    target_link_libraries(crate_vdj_http_client_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_http_client_test COMMAND crate_vdj_http_client_test)

    add_executable(crate_vdj_json_mapping_test
        tests/client/json_mapping_test.cpp
    )
    target_link_libraries(crate_vdj_json_mapping_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_json_mapping_test COMMAND crate_vdj_json_mapping_test)

    add_executable(crate_vdj_contract_negotiator_test
        tests/client/contract_negotiator_test.cpp
    )
    target_link_libraries(crate_vdj_contract_negotiator_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_contract_negotiator_test
        COMMAND crate_vdj_contract_negotiator_test
    )

    add_executable(crate_vdj_search_client_test
        tests/client/search_client_test.cpp
    )
    target_link_libraries(crate_vdj_search_client_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_search_client_test COMMAND crate_vdj_search_client_test)

    add_executable(crate_vdj_stream_resolver_test
        tests/client/stream_resolver_test.cpp
    )
    target_link_libraries(crate_vdj_stream_resolver_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_stream_resolver_test COMMAND crate_vdj_stream_resolver_test)

    add_executable(crate_vdj_catalog_client_test
        tests/client/catalog_client_test.cpp
    )
    target_link_libraries(crate_vdj_catalog_client_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_catalog_client_test COMMAND crate_vdj_catalog_client_test)

    add_executable(crate_vdj_smart_mix_client_test
        tests/client/smart_mix_client_test.cpp
    )
    target_link_libraries(crate_vdj_smart_mix_client_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_smart_mix_client_test
        COMMAND crate_vdj_smart_mix_client_test
    )

    add_executable(crate_vdj_compatible_tracks_test
        tests/online_source/compatible_tracks_test.cpp
    )
    target_link_libraries(crate_vdj_compatible_tracks_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_compatible_tracks_test
        COMMAND crate_vdj_compatible_tracks_test
    )

    add_executable(crate_vdj_credential_store_test
        tests/auth/credential_store_test.cpp
    )
    target_link_libraries(crate_vdj_credential_store_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_credential_store_test
        COMMAND crate_vdj_credential_store_test
    )

    add_executable(crate_vdj_search_mapping_test
        tests/online_source/search_mapping_test.cpp
    )
    target_link_libraries(crate_vdj_search_mapping_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_search_mapping_test
        COMMAND crate_vdj_search_mapping_test
    )

    add_executable(crate_vdj_translations_test
        tests/online_source/translations_test.cpp
    )
    target_link_libraries(crate_vdj_translations_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_translations_test
        COMMAND crate_vdj_translations_test
    )

    add_executable(crate_vdj_track_path_test
        tests/online_source/vdj_track_path_test.cpp
    )
    target_link_libraries(crate_vdj_track_path_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_track_path_test
        COMMAND crate_vdj_track_path_test
    )

    add_executable(crate_vdj_lifecycle_test
        tests/sdk/lifecycle_test.cpp
    )
    target_link_libraries(crate_vdj_lifecycle_test PRIVATE crate_vdj_core)
    add_test(NAME crate_vdj_lifecycle_test COMMAND crate_vdj_lifecycle_test)

    add_executable(crate_vdj_metadata_cache_test
        tests/cache/metadata_cache_test.cpp
    )
    target_link_libraries(crate_vdj_metadata_cache_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_metadata_cache_test
        COMMAND crate_vdj_metadata_cache_test
    )

    add_executable(crate_vdj_cache_migration_test
        tests/cache/cache_migration_test.cpp
    )
    target_link_libraries(crate_vdj_cache_migration_test PRIVATE crate_vdj_core)
    add_test(
        NAME crate_vdj_cache_migration_test
        COMMAND crate_vdj_cache_migration_test
    )

    if(CRATE_VDJ_BUILD_REAL_PLUGIN)
        add_executable(crate_vdj_factory_contract
            tests/sdk/factory_contract.cpp
            spike/control_spike.cpp
        )
        target_compile_features(crate_vdj_factory_contract PRIVATE cxx_std_20)
        target_compile_definitions(
            crate_vdj_factory_contract
            PRIVATE CRATE_VDJ_ONLINE_SOURCE_PLUGIN=1
        )
        target_include_directories(
            crate_vdj_factory_contract
            PRIVATE "${VirtualDJSDK_INCLUDE_DIR}"
                    "${CMAKE_CURRENT_SOURCE_DIR}/include"
        )
        target_link_libraries(crate_vdj_factory_contract PRIVATE crate_vdj_core)
        target_compile_options(crate_vdj_factory_contract PRIVATE
            $<$<CXX_COMPILER_ID:AppleClang,Clang>:-Wall -Wextra -Wpedantic>
            $<$<CXX_COMPILER_ID:MSVC>:/W4>
        )
        if(APPLE)
            target_link_libraries(crate_vdj_factory_contract PRIVATE
                "-framework CoreFoundation"
                "-framework Security"
            )
        endif()
        add_test(
            NAME crate_vdj_factory_contract
            COMMAND crate_vdj_factory_contract
        )
    endif()
endif()

option(
    CRATE_VDJ_BUILD_PROBE
    "Build the VH01 host probe Online Source (development only, never packaged)"
    OFF
)
if(CRATE_VDJ_BUILD_PROBE)
    add_subdirectory(probe)
endif()
