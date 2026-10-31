cmake_minimum_required(VERSION 3.24)

project(echo_audio_host VERSION 0.1.0 LANGUAGES C CXX)

if(APPLE)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(ECHO_FFMPEG REQUIRED IMPORTED_TARGET
    libavformat
    libavcodec
    libswresample
    libavutil)
  find_library(ECHO_COREAUDIO_FRAMEWORK CoreAudio REQUIRED)
  find_library(ECHO_AUDIOTOOLBOX_FRAMEWORK AudioToolbox REQUIRED)
  find_library(ECHO_COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
endif()

option(ECHO_ENABLE_CUDA_DSP "Enable in-process CUDA FIR acceleration when a CUDA toolkit is available" ON)
include(CheckLanguage)
if(ECHO_ENABLE_CUDA_DSP)
  check_language(CUDA)
endif()

if(ECHO_ENABLE_CUDA_DSP AND CMAKE_CUDA_COMPILER)
  enable_language(CUDA)
  find_package(CUDAToolkit REQUIRED)
  add_library(echo-cuda-dsp STATIC
    src/CudaFirProcessor.cu
    src/CudaSdmProcessor.cu)
  target_compile_definitions(echo-cuda-dsp PRIVATE ECHO_AUDIO_HOST_HAS_CUDA_DSP=1)
  target_link_libraries(echo-cuda-dsp PRIVATE CUDA::cudart_static)
  set_target_properties(echo-cuda-dsp PROPERTIES
    CUDA_STANDARD 17
    CUDA_STANDARD_REQUIRED ON
    CUDA_RUNTIME_LIBRARY Static
    CUDA_ARCHITECTURES "75;86;89;120"
    POSITION_INDEPENDENT_CODE ON
  )
  if(MSVC)
    target_compile_options(echo-cuda-dsp PRIVATE
      $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=/W3>)
  endif()
  message(STATUS "ECHO native CUDA DSP enabled: ${CMAKE_CUDA_COMPILER}")
else()
  add_library(echo-cuda-dsp STATIC
    src/CudaFirProcessorStub.cpp
    src/CudaSdmProcessorStub.cpp)
  message(WARNING "CUDA toolkit was not found; echo-audio-host will retain CPU fallback.")
endif()

target_compile_features(echo-cuda-dsp PRIVATE cxx_std_20)
target_include_directories(echo-cuda-dsp PRIVATE src ../audio-engine)
if(MSVC)
  set_property(TARGET echo-cuda-dsp PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

if(WIN32)
  option(ECHO_ENABLE_ASIO "Enable direct ASIO SDK support in echo-audio-host" ON)
else()
  option(ECHO_ENABLE_ASIO "Enable direct ASIO SDK support in echo-audio-host" OFF)
endif()

set(ECHO_AUDIO_ENGINE_SOURCES
  ../audio-engine/ChannelBalanceProcessor.cpp
  ../audio-engine/CompressorProcessor.cpp
  ../audio-engine/SpatialDspProcessor.cpp
  ../audio-engine/ConvolutionProcessor.cpp
  ../audio-engine/DspChain.cpp
  ../audio-engine/DspHeadroomProcessor.cpp
  ../audio-engine/DspRackOrder.cpp
  ../audio-engine/EqMessageProtocol.cpp
  ../audio-engine/EqPresetStore.cpp
  ../audio-engine/EqProcessor.cpp
  ../audio-engine/JsonRpcProtocol.cpp
  ../audio-engine/LevelMeterProcessor.cpp
  ../audio-engine/NativeFormatProcessor.cpp
  ../audio-engine/PlaybackRateProcessor.cpp
  ../audio-engine/ReplayGainProcessor.cpp
  ../audio-engine/TruePeakLimiterProcessor.cpp
)

set(ECHO_AUDIO_HOST_COMMON_SOURCES
  ${ECHO_AUDIO_ENGINE_SOURCES}
  src/AudioDaemon.cpp
  src/AutomixTempoProcessor.cpp
  src/CachePcmProducer.cpp
  src/DopRingSource.cpp
  src/HostUtils.cpp
  src/NativeDsdRingSource.cpp
  src/NativeFirProcessor.cpp
  src/NativePlaybackPipeline.cpp
  src/NativeSdmProcessor.cpp
  src/PcmDomainDspStage.cpp
  src/PcmRingAudioSource.cpp
  src/RawPcmInputReader.cpp
)

if(APPLE)
  list(APPEND ECHO_AUDIO_HOST_COMMON_SOURCES
    src/MacCoreAudioDeviceInfo.cpp
    src/MacCoreAudioDeviceWatcher.cpp
    src/MacCoreAudioHogMode.cpp)
endif()

function(configure_echo_audio_target target)
  target_compile_features(${target} PRIVATE cxx_std_20)
  target_include_directories(${target} PRIVATE src ../audio-engine)
  target_compile_definitions(${target} PRIVATE ECHO_ENABLE_ASIO=$<BOOL:${ECHO_ENABLE_ASIO}>)
  target_link_libraries(${target} PRIVATE echo-cuda-dsp)

  if(MSVC)
    # Keep the packaged host independent from a separately installed Visual C++
    # Redistributable. Clean Windows machines only need the DLLs we ship beside it.
    set_property(TARGET ${target} PROPERTY
      MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  endif()

  if(WIN32)
    target_compile_definitions(${target} PRIVATE NOMINMAX)
    set(ECHO_FFMPEG_ROOT "" CACHE PATH "Root of a Windows FFmpeg shared development build")
    if(NOT ECHO_FFMPEG_ROOT)
      message(FATAL_ERROR "ECHO_FFMPEG_ROOT is required on Windows")
    endif()
    target_include_directories(${target} PRIVATE "${ECHO_FFMPEG_ROOT}/include")
    target_link_directories(${target} PRIVATE "${ECHO_FFMPEG_ROOT}/lib")
    target_link_libraries(${target} PRIVATE avformat avcodec swresample avutil)
    file(GLOB ECHO_FFMPEG_RUNTIME_DLLS "${ECHO_FFMPEG_ROOT}/bin/*.dll")
    foreach(ECHO_FFMPEG_RUNTIME_DLL IN LISTS ECHO_FFMPEG_RUNTIME_DLLS)
      add_custom_command(TARGET ${target} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${ECHO_FFMPEG_RUNTIME_DLL}"
          "$<TARGET_FILE_DIR:${target}>")
    endforeach()
    target_sources(${target} PRIVATE src/wasapi_exclusive.cpp src/wasapi_shared.cpp)
    target_link_libraries(${target} PRIVATE shell32 ole32 avrt winmm advapi32 uuid cfgmgr32)
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
    target_link_libraries(${target} PRIVATE avformat avcodec swresample avutil)
    find_package(ALSA REQUIRED)
    target_include_directories(${target} PRIVATE ${ALSA_INCLUDE_DIRS})
    target_link_libraries(${target} PRIVATE ${ALSA_LIBRARIES} pthread dl)
  endif()

  if(APPLE)
    target_link_libraries(${target} PRIVATE
      PkgConfig::ECHO_FFMPEG
      ${ECHO_COREAUDIO_FRAMEWORK}
      ${ECHO_AUDIOTOOLBOX_FRAMEWORK}
      ${ECHO_COREFOUNDATION_FRAMEWORK})
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
  src/AutomixTempoProcessor.cpp
  src/CachePcmProducer.cpp
  src/DopRingSource.cpp
  src/HostUtils.cpp
  src/NativeDsdRingSource.cpp
  tests/dsd_ring_source_characterization.cpp
)
configure_echo_audio_target(echo-dsd-ring-source-characterization-tests)

add_executable(echo-native-playback-pipeline-tests EXCLUDE_FROM_ALL)
target_sources(echo-native-playback-pipeline-tests PRIVATE
  ${ECHO_AUDIO_HOST_COMMON_SOURCES}
  tests/native_playback_pipeline_tests.cpp)
configure_echo_audio_target(echo-native-playback-pipeline-tests)

add_executable(echo-cache-pcm-producer-tests EXCLUDE_FROM_ALL
  src/CachePcmProducer.cpp
  tests/cache_pcm_producer_tests.cpp)
configure_echo_audio_target(echo-cache-pcm-producer-tests)

foreach(_tgt echo-audio-host echo-audio-engine-tests
    echo-jsonrpc-protocol-characterization-tests
    echo-dsd-ring-source-characterization-tests
    echo-native-playback-pipeline-tests
    echo-cache-pcm-producer-tests)
  if(NOT MSVC)
    target_compile_options(${_tgt} PRIVATE
      -Wno-error=float-equal
      -Wno-error=sign-conversion)
  endif()
endforeach()

add_dependencies(echo-audio-engine-tests echo-jsonrpc-protocol-characterization-tests echo-dsd-ring-source-characterization-tests)
add_dependencies(echo-audio-engine-tests echo-cache-pcm-producer-tests)
add_dependencies(echo-audio-engine-tests echo-native-playback-pipeline-tests)

enable_testing()
add_test(NAME echo-audio-engine-tests COMMAND echo-audio-engine-tests)
add_test(NAME echo-jsonrpc-protocol-characterization-tests COMMAND echo-jsonrpc-protocol-characterization-tests)
add_test(NAME echo-dsd-ring-source-characterization-tests COMMAND echo-dsd-ring-source-characterization-tests)
add_test(NAME echo-native-playback-pipeline-tests COMMAND echo-native-playback-pipeline-tests)
add_test(NAME echo-cache-pcm-producer-tests COMMAND echo-cache-pcm-producer-tests)
