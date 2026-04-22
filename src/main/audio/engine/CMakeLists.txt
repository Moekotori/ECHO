cmake_minimum_required(VERSION 3.10)
project(echo-audio-host C)

set(CMAKE_C_STANDARD 11)

add_executable(echo-audio-host echo_out.cpp)

if(WIN32)
    target_link_libraries(echo-audio-host PRIVATE ole32 user32 winmm propsys)
    target_compile_definitions(echo-audio-host PRIVATE _CRT_SECURE_NO_WARNINGS)
elseif(APPLE)
    find_library(COREAUDIO_LIB CoreAudio)
    find_library(AUDIOUNIT_LIB AudioUnit)
    find_library(COREFOUNDATION_LIB CoreFoundation)
    target_link_libraries(echo-audio-host PRIVATE ${COREAUDIO_LIB} ${AUDIOUNIT_LIB} ${COREFOUNDATION_LIB} pthread)
else()
    target_link_libraries(echo-audio-host PRIVATE pthread dl m)
endif()
