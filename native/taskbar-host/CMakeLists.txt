cmake_minimum_required(VERSION 3.20)

project(echo_taskbar_host LANGUAGES CXX)

add_executable(echo-taskbar-host
  src/main.cpp
)

target_compile_features(echo-taskbar-host PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(echo-taskbar-host PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(echo-taskbar-host PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(WIN32)
  target_link_libraries(echo-taskbar-host PRIVATE
    dwmapi
    d2d1
    dwrite
    gdiplus
    windowscodecs
    shell32
    shcore
    oleacc
    advapi32
  )
endif()