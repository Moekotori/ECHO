cmake_minimum_required(VERSION 3.24)

project(echo_audio_host VERSION 0.1.0 LANGUAGES C CXX)

if(WIN32)
  option(ECHO_ENABLE_ASIO "Enable direct ASIO SDK support in echo-audio-host" ON)
else()
  option(ECHO_ENABLE_ASIO "Enable direct ASIO SDK support in echo-audio-host" OFF)
endif()

set(ECHO_AUDIO_ENGINE_SOURCES
  ../audio-engine/ChannelBalanceProcessor.cpp
  ../audio-engine/ConvolutionProcessor.cpp
  ../audio-engine/DspChain.cpp
  ../audio-engine/DspHeadroomProcessor.cpp
  ../audio-engine/EqMessageProtocol.cpp
  ../audio-engine/EqPresetStore.cpp
  ../audio-engine/EqProcessor.cpp
  ../audio-engine/JsonRpcProtocol.cpp
  ../audio-engine/LevelMeterProcessor.cpp
  ../audio-engine/PlaybackRateProcessor.cpp
  ../audio-engine/ReplayGainProcessor.cpp
)

set(ECHO_AUDIO_HOST_COMMON_SOURCES
  ${ECHO_AUDIO_ENGINE_SOURCES}
  src/AudioDaemon.cpp
  src/DopRingSource.cpp
  src/HostUtils.cpp
  src/NativeDsdRingSource.cpp
  src/PcmRingAudioSource.cpp
)

function(configure_echo_audio_target target)
  target_compile_features(${target} PRIVATE cxx_std_17)
  target_include_directories(${target} PRIVATE src ../audio-engine)
  target_compile_definitions(${target} PRIVATE ECHO_ENABLE_ASIO=$<BOOL:${ECHO_ENABLE_ASIO}>)
  target_link_libraries(${target} PRIVATE avformat avcodec swresample avutil)

  if(WIN32)
    target_sources(${target} PRIVATE src/wasapi_exclusive.cpp src/wasapi_shared.cpp)
    target_link_libraries(${target} PRIVATE shell32 ole32 avrt winmm advapi32 uuid)
    if(ECHO_ENABLE_ASIO)
      target_sources(${target} PRIVATE
        src/asio_host.cpp
        third_party/asio-sdk/common/asio.cpp
        third_party/asio-sdk/host/asiodrivers.cpp
        third_party/asio-sdk/host/pc/asiolist.cpp
      )
      target_include_directories(${target} PRIVATE
        third_party/asio-sdk/common
        third_party/asio-sdk/host
        third_party/asio-sdk/host/pc
      )
      target_compile_definitions(${target} PRIVATE _CRT_SECURE_NO_WARNINGS)
    endif()
  endif()

  if(UNIX AND NOT APPLE)
    find_package(ALSA REQUIRED)
    target_include_directories(${target} PRIVATE ${ALSA_INCLUDE_DIRS})
    target_link_libraries(${target} PRIVATE ${ALSA_LIBRARIES} pthread dl)
  endif()
endfunction()

add_executable(echo-audio-host)
target_sources(echo-audio-host PRIVATE ${ECHO_AUDIO_HOST_COMMON_SOURCES} src/main.cpp)
configure_echo_audio_target(echo-audio-host)

add_executable(echo-audio-engine-tests EXCLUDE_FROM_ALL)
target_sources(echo-audio-engine-tests PRIVATE ${ECHO_AUDIO_HOST_COMMON_SOURCES} tests/audio_engine_tests.cpp)
target_compile_definitions(echo-audio-engine-tests PRIVATE ECHO_AUDIO_ENGINE_TESTS=1)
configure_echo_audio_target(echo-audio-engine-tests)

add_executable(echo-jsonrpc-protocol-characterization-tests EXCLUDE_FROM_ALL)
target_sources(echo-jsonrpc-protocol-characterization-tests PRIVATE ${ECHO_AUDIO_HOST_COMMON_SOURCES} tests/jsonrpc_protocol_characterization.cpp)
configure_echo_audio_target(echo-jsonrpc-protocol-characterization-tests)

add_executable(echo-dsd-ring-source-characterization-tests EXCLUDE_FROM_ALL)
target_sources(echo-dsd-ring-source-characterization-tests PRIVATE
  ${ECHO_AUDIO_ENGINE_SOURCES}
  src/AudioDaemon.cpp
  src/DopRingSource.cpp
  src/HostUtils.cpp
  src/NativeDsdRingSource.cpp
  tests/dsd_ring_source_characterization.cpp
)
configure_echo_audio_target(echo-dsd-ring-source-characterization-tests)

foreach(_tgt echo-audio-host echo-audio-engine-tests
    echo-jsonrpc-protocol-characterization-tests
    echo-dsd-ring-source-characterization-tests)
  if(NOT MSVC)
    target_compile_options(${_tgt} PRIVATE
      -Wno-error=float-equal
      -Wno-error=sign-conversion)
  endif()
endforeach()

add_dependencies(echo-audio-engine-tests echo-jsonrpc-protocol-characterization-tests echo-dsd-ring-source-characterization-tests)

enable_testing()
add_test(NAME echo-audio-engine-tests COMMAND echo-audio-engine-tests)
add_test(NAME echo-jsonrpc-protocol-characterization-tests COMMAND echo-jsonrpc-protocol-characterization-tests)
add_test(NAME echo-dsd-ring-source-characterization-tests COMMAND echo-dsd-ring-source-characterization-tests)
