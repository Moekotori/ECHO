cmake_minimum_required(VERSION 3.22)

project(echo_smtc_host VERSION 0.1.0 LANGUAGES CXX)

add_executable(echo-smtc-host
  src/main.cpp
)

target_compile_features(echo-smtc-host PRIVATE cxx_std_20)

target_compile_definitions(echo-smtc-host PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
  UNICODE
  _UNICODE
)

if (MSVC)
  target_compile_options(echo-smtc-host PRIVATE /permissive- /W4)
endif()

target_link_libraries(echo-smtc-host PRIVATE
  runtimeobject
  shell32
  user32
  windowsapp
)
