find_package(VirtualDJSDK REQUIRED)

set(CRATE_PROBE_SOURCES crate_probe.cpp)
if(APPLE)
    enable_language(OBJCXX)
    list(APPEND CRATE_PROBE_SOURCES login_window_mac.mm)
else()
    list(APPEND CRATE_PROBE_SOURCES login_window_stub.cpp)
endif()

add_library(crate_vdj_probe MODULE ${CRATE_PROBE_SOURCES})
target_compile_features(crate_vdj_probe PRIVATE cxx_std_20)
target_include_directories(crate_vdj_probe PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(crate_vdj_probe PRIVATE VirtualDJSDK::Headers)
target_compile_options(crate_vdj_probe PRIVATE
    $<$<CXX_COMPILER_ID:AppleClang,Clang>:-Wall -Wextra>
    $<$<CXX_COMPILER_ID:MSVC>:/W4>
)
set_target_properties(crate_vdj_probe PROPERTIES OUTPUT_NAME "CrateProbe" PREFIX "")

if(APPLE)
    set_source_files_properties(login_window_mac.mm PROPERTIES COMPILE_FLAGS "-fobjc-arc")
    target_link_libraries(crate_vdj_probe PRIVATE
        "-framework CoreFoundation"
        "-framework AppKit"
    )
    set_target_properties(crate_vdj_probe PROPERTIES
        BUNDLE TRUE
        BUNDLE_EXTENSION "bundle"
        MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
    )
endif()
