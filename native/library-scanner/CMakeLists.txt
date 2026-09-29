cmake_minimum_required(VERSION 3.20)

project(echo_native_scanner LANGUAGES CXX)

add_executable(echo-native-scanner
  src/main.cpp
)

target_compile_features(echo-native-scanner PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(echo-native-scanner PRIVATE /W4 /permissive- /EHsc /MP)
else()
  target_compile_options(echo-native-scanner PRIVATE -Wall -Wextra -Wpedantic)
endif()
