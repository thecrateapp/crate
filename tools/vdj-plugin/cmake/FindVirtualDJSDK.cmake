include(FindPackageHandleStandardArgs)

set(_VirtualDJSDK_ROOT "")
if(VirtualDJSDK_ROOT)
    set(_VirtualDJSDK_ROOT "${VirtualDJSDK_ROOT}")
elseif(DEFINED ENV{VIRTUALDJ_SDK_ROOT})
    set(_VirtualDJSDK_ROOT "$ENV{VIRTUALDJ_SDK_ROOT}")
endif()

find_path(
    VirtualDJSDK_INCLUDE_DIR
    NAMES vdjPlugin8.h
    HINTS "${_VirtualDJSDK_ROOT}"
    PATH_SUFFIXES include
)

find_file(
    VirtualDJSDK_ONLINE_SOURCE_HEADER
    NAMES vdjOnlineSource.h
    HINTS "${_VirtualDJSDK_ROOT}" "${VirtualDJSDK_INCLUDE_DIR}"
)

find_package_handle_standard_args(
    VirtualDJSDK
    REQUIRED_VARS
        VirtualDJSDK_INCLUDE_DIR
        VirtualDJSDK_ONLINE_SOURCE_HEADER
)

if(VirtualDJSDK_FOUND AND NOT TARGET VirtualDJSDK::Headers)
    add_library(VirtualDJSDK::Headers INTERFACE IMPORTED)
    set_target_properties(VirtualDJSDK::Headers PROPERTIES
        INTERFACE_INCLUDE_DIRECTORIES "${VirtualDJSDK_INCLUDE_DIR}"
    )
endif()

mark_as_advanced(
    VirtualDJSDK_INCLUDE_DIR
    VirtualDJSDK_ONLINE_SOURCE_HEADER
)
