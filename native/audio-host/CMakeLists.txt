cmake_minimum_required(VERSION 3.24)

project(echo_audio_host VERSION 0.1.0 LANGUAGES CXX)

include(FetchContent)
include(CheckLanguage)

set(JUCE_VERSION "8.0.12" CACHE STRING "JUCE version to fetch")
set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_HELPER_TOOLS OFF CACHE BOOL "" FORCE)

if(WIN32)
  option(ECHO_ENABLE_ASIO "Enable JUCE ASIO support in echo-audio-host" ON)
else()
  option(ECHO_ENABLE_ASIO "Enable JUCE ASIO support in echo-audio-host" OFF)
endif()
option(ECHO_UZUME_ENABLE_CUDA "Enable the experimental UZUME CUDA GPU MVP probe, limiter, and cuFFT backend" OFF)

FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG ${JUCE_VERSION}
  GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(JUCE)

set(ECHO_AUDIO_ENGINE_SOURCES
  ../audio-engine/ChannelBalanceProcessor.cpp
  ../audio-engine/ConvolutionProcessor.cpp
  ../audio-engine/DspChain.cpp
  ../audio-engine/DspHeadroomProcessor.cpp
  ../audio-engine/EqMessageProtocol.cpp
  ../audio-engine/EqPresetStore.cpp
  ../audio-engine/EqProcessor.cpp
  ../audio-engine/UzumeEngine.cpp
  ../audio-engine/UzumeCudaProbe.cpp
)
set(ECHO_UZUME_LIBRARIES)

set(ECHO_JUCE_DEFINITIONS
  JUCE_DISPLAY_SPLASH_SCREEN=0
  JUCE_REPORT_APP_USAGE=0
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
  JUCE_USE_MP3AUDIOFORMAT=0
  JUCE_USE_WINDOWS_MEDIA_FORMAT=1
  JUCE_ASIO=$<BOOL:${ECHO_ENABLE_ASIO}>
  ECHO_ENABLE_ASIO=$<BOOL:${ECHO_ENABLE_ASIO}>
  ECHO_UZUME_ENABLE_CUDA=0
)

if(ECHO_UZUME_ENABLE_CUDA)
  check_language(CUDA)
  if(NOT CMAKE_CUDA_COMPILER)
    message(FATAL_ERROR "ECHO_UZUME_ENABLE_CUDA=ON requires an nvcc-compatible CUDA compiler.")
  endif()

  enable_language(CUDA)
  find_package(CUDAToolkit REQUIRED)
  set(CMAKE_CUDA_STANDARD 17)
  set(CMAKE_CUDA_STANDARD_REQUIRED ON)

  list(REMOVE_ITEM ECHO_AUDIO_ENGINE_SOURCES ../audio-engine/UzumeCudaProbe.cpp)
  add_library(echo-uzume-cuda-probe STATIC ../audio-engine/UzumeCudaProbe.cu)
  set_target_properties(echo-uzume-cuda-probe PROPERTIES
    CUDA_STANDARD 17
    CUDA_STANDARD_REQUIRED ON
  )
  target_link_libraries(echo-uzume-cuda-probe PUBLIC CUDA::cudart CUDA::cufft)

  list(REMOVE_ITEM ECHO_JUCE_DEFINITIONS ECHO_UZUME_ENABLE_CUDA=0)
  list(APPEND ECHO_JUCE_DEFINITIONS ECHO_UZUME_ENABLE_CUDA=1)
  list(APPEND ECHO_UZUME_LIBRARIES echo-uzume-cuda-probe)
endif()

if(UNIX AND NOT APPLE)
  find_package(ALSA REQUIRED)
  list(APPEND ECHO_JUCE_DEFINITIONS
    JUCE_ALSA=1
    JUCE_JACK=0
  )
endif()

set(ECHO_JUCE_LIBRARIES
  juce::juce_audio_basics
  juce::juce_audio_devices
  juce::juce_audio_formats
  juce::juce_core
  juce::juce_gui_basics
  juce::juce_recommended_config_flags
  juce::juce_recommended_lto_flags
  juce::juce_recommended_warning_flags
)

juce_add_console_app(echo-audio-host
  PRODUCT_NAME "echo-audio-host"
)

target_sources(echo-audio-host
  PRIVATE
    ${ECHO_AUDIO_ENGINE_SOURCES}
    src/main.cpp
)

if(WIN32)
  target_sources(echo-audio-host PRIVATE src/wasapi_exclusive.cpp src/wasapi_shared.cpp)
  if(ECHO_ENABLE_ASIO)
    target_sources(echo-audio-host PRIVATE
      src/asio_host.cpp
      third_party/asio-sdk/common/asio.cpp
      third_party/asio-sdk/host/asiodrivers.cpp
      third_party/asio-sdk/host/pc/asiolist.cpp
    )
    target_include_directories(echo-audio-host PRIVATE
      third_party/asio-sdk/common
      third_party/asio-sdk/host
      third_party/asio-sdk/host/pc
    )
    target_compile_definitions(echo-audio-host PRIVATE _CRT_SECURE_NO_WARNINGS)
  endif()
endif()

target_compile_features(echo-audio-host PRIVATE cxx_std_17)

target_compile_definitions(echo-audio-host
  PRIVATE
    ${ECHO_JUCE_DEFINITIONS}
)

target_link_libraries(echo-audio-host
  PRIVATE
    ${ECHO_JUCE_LIBRARIES}
    ${ECHO_UZUME_LIBRARIES}
)

if(WIN32)
  target_link_libraries(echo-audio-host PRIVATE shell32 ole32 avrt winmm advapi32 uuid)
endif()

if(UNIX AND NOT APPLE)
  target_include_directories(echo-audio-host PRIVATE ${ALSA_INCLUDE_DIRS})
  target_link_libraries(echo-audio-host PRIVATE ${ALSA_LIBRARIES})
endif()

juce_add_console_app(echo-audio-engine-tests
  PRODUCT_NAME "echo-audio-engine-tests"
)

target_sources(echo-audio-engine-tests
  PRIVATE
    ${ECHO_AUDIO_ENGINE_SOURCES}
    tests/audio_engine_tests.cpp
)

if(WIN32)
  target_sources(echo-audio-engine-tests PRIVATE src/wasapi_exclusive.cpp src/wasapi_shared.cpp)
  if(ECHO_ENABLE_ASIO)
    target_sources(echo-audio-engine-tests PRIVATE
      src/asio_host.cpp
      third_party/asio-sdk/common/asio.cpp
      third_party/asio-sdk/host/asiodrivers.cpp
      third_party/asio-sdk/host/pc/asiolist.cpp
    )
    target_include_directories(echo-audio-engine-tests PRIVATE
      third_party/asio-sdk/common
      third_party/asio-sdk/host
      third_party/asio-sdk/host/pc
    )
    target_compile_definitions(echo-audio-engine-tests PRIVATE _CRT_SECURE_NO_WARNINGS)
  endif()
endif()

target_compile_features(echo-audio-engine-tests PRIVATE cxx_std_17)
set_target_properties(echo-audio-engine-tests PROPERTIES EXCLUDE_FROM_ALL TRUE)
target_compile_definitions(echo-audio-engine-tests
  PRIVATE
    ${ECHO_JUCE_DEFINITIONS}
    ECHO_AUDIO_ENGINE_TESTS=1
)

target_link_libraries(echo-audio-engine-tests
  PRIVATE
    ${ECHO_JUCE_LIBRARIES}
    ${ECHO_UZUME_LIBRARIES}
)

if(WIN32)
  target_link_libraries(echo-audio-engine-tests PRIVATE shell32 ole32 avrt winmm advapi32 uuid)
endif()

if(UNIX AND NOT APPLE)
  target_include_directories(echo-audio-engine-tests PRIVATE ${ALSA_INCLUDE_DIRS})
  target_link_libraries(echo-audio-engine-tests PRIVATE ${ALSA_LIBRARIES})
endif()

enable_testing()
add_test(NAME echo-audio-engine-tests COMMAND echo-audio-engine-tests)
