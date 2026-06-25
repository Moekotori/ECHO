cmake_minimum_required(VERSION 3.24)

project(echo_audio_daemon VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32)
  option(ECHO_ENABLE_ASIO "Enable ASIO support (Windows)" ON)
else()
  option(ECHO_ENABLE_ASIO "Enable ASIO support" OFF)
endif()
option(ECHO_ENABLE_WASAPI_EXCLUSIVE "Enable WASAPI exclusive support" ON)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED libavformat libavcodec libswresample libavutil)

# Include vendored headers
include_directories(third_party)

enable_testing()

add_subdirectory(src)
add_subdirectory(tests)
