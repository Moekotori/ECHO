cmake_minimum_required(VERSION 3.10)
project(echo-audio-host CXX)

set(CMAKE_CXX_STANDARD 14)

add_executable(echo-audio-host
    echo_out.cpp
    wasapi_exclusive.cpp
    ../asio-sdk/common/asio.cpp
    ../asio-sdk/host/asiodrivers.cpp
    ../asio-sdk/host/pc/asiolist.cpp
)

if(WIN32)
    target_include_directories(echo-audio-host PRIVATE ../asio-sdk/common ../asio-sdk/host ../asio-sdk/host/pc)
    target_link_libraries(echo-audio-host PRIVATE ole32 user32 winmm propsys uuid avrt)
    target_compile_definitions(echo-audio-host PRIVATE _CRT_SECURE_NO_WARNINGS MA_ENABLE_ASIO)
elseif(APPLE)
    find_library(COREAUDIO_LIB CoreAudio)
    find_library(AUDIOUNIT_LIB AudioUnit)
    find_library(COREFOUNDATION_LIB CoreFoundation)
    target_link_libraries(echo-audio-host PRIVATE ${COREAUDIO_LIB} ${AUDIOUNIT_LIB} ${COREFOUNDATION_LIB} pthread)
else()
    target_link_libraries(echo-audio-host PRIVATE pthread dl m)
endif()
