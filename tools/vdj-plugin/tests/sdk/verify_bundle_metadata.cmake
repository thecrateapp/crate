foreach(bundle IN ITEMS
    "${CRATE_VDJ_CONTROL_BUNDLE}"
    "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}"
)
    if(NOT EXISTS "${bundle}/Contents/Info.plist")
        message(FATAL_ERROR "Missing Info.plist in ${bundle}")
    endif()
    if(NOT EXISTS "${bundle}/Contents/Resources/crate-icon.png")
        message(FATAL_ERROR "Missing Crate icon in ${bundle}")
    endif()
    if(NOT EXISTS "${bundle}/Contents/Resources/crate-icon.bmp")
        message(FATAL_ERROR "Missing VirtualDJ bitmap in ${bundle}")
    endif()

    file(GLOB executables RELATIVE "${bundle}/Contents/MacOS"
        "${bundle}/Contents/MacOS/*"
    )
    list(LENGTH executables executable_count)
    if(NOT executable_count EQUAL 1)
        message(FATAL_ERROR
            "Expected one executable in ${bundle}, found ${executable_count}"
        )
    endif()

    execute_process(
        COMMAND /usr/libexec/PlistBuddy
            -c "Print :CFBundleExecutable"
            "${bundle}/Contents/Info.plist"
        OUTPUT_VARIABLE plist_executable
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE plist_result
    )
if(NOT plist_result EQUAL 0)
        message(FATAL_ERROR "Cannot read CFBundleExecutable in ${bundle}")
    endif()

    if(bundle STREQUAL "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}" AND
       NOT plist_executable STREQUAL "Crate")
        message(FATAL_ERROR
            "Online Source executable must be Crate, found ${plist_executable}"
        )
    endif()

    list(GET executables 0 bundle_executable)
    if(NOT bundle_executable STREQUAL plist_executable)
        message(FATAL_ERROR
            "${bundle} declares ${plist_executable} but contains ${bundle_executable}"
        )
    endif()
endforeach()

execute_process(
    COMMAND /usr/libexec/PlistBuddy
        -c "Print :CFBundleIconFile"
        "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}/Contents/Info.plist"
    OUTPUT_VARIABLE online_source_icon
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE online_source_icon_result
)
if(NOT online_source_icon_result EQUAL 0 OR
   NOT online_source_icon STREQUAL "crate-icon.png")
    message(FATAL_ERROR "Online Source bundle does not declare the Crate icon")
endif()

execute_process(
    COMMAND /usr/libexec/PlistBuddy
        -c "Print :CFBundleIconName"
        "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}/Contents/Info.plist"
    OUTPUT_VARIABLE online_source_icon_name
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE online_source_icon_name_result
)
if(NOT online_source_icon_name_result EQUAL 0 OR
   NOT online_source_icon_name STREQUAL "crate-icon")
    message(FATAL_ERROR "Online Source bundle does not declare the Crate icon name")
endif()

execute_process(
    COMMAND /usr/libexec/PlistBuddy
        -c "Print :CFBundleName"
        "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}/Contents/Info.plist"
    OUTPUT_VARIABLE online_source_name
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE online_source_name_result
)
if(NOT online_source_name_result EQUAL 0 OR
   NOT online_source_name STREQUAL "Crate")
    message(FATAL_ERROR "Online Source bundle does not declare the Crate display name")
endif()

execute_process(
    COMMAND /usr/libexec/PlistBuddy
        -c "Print :CFBundleIdentifier"
        "${CRATE_VDJ_CONTROL_BUNDLE}/Contents/Info.plist"
    OUTPUT_VARIABLE control_identifier
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
execute_process(
    COMMAND /usr/libexec/PlistBuddy
        -c "Print :CFBundleIdentifier"
        "${CRATE_VDJ_ONLINE_SOURCE_BUNDLE}/Contents/Info.plist"
    OUTPUT_VARIABLE online_source_identifier
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
if(control_identifier STREQUAL online_source_identifier)
    message(FATAL_ERROR
        "The plugin bundles must have unique CFBundleIdentifier values"
    )
endif()
