# ── Type Definition Tests ────────────────────────────────────────────────────
# Header-only types; no external linkage required beyond the standard library.
add_executable(echo-daemon-tests
    test_types.cpp
)

# ── NullBackend Output Tests ─────────────────────────────────────────────────
add_executable(echo-daemon-null-output-tests
    test_null_output.cpp
    ../src/output/NullBackend.cpp
)

target_compile_features(echo-daemon-tests PRIVATE cxx_std_17)

target_include_directories(echo-daemon-tests PRIVATE
    ${CMAKE_SOURCE_DIR}   # for `#include "src/common/..."`
)

set_target_properties(echo-daemon-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── IPC Module Tests ───────────────────────────────────────────────────────────
add_executable(echo-daemon-ipc-tests
    test_ipc.cpp
    ../src/ipc/JsonRpcServer.cpp
)
target_compile_features(echo-daemon-ipc-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-ipc-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-ipc-tests PRIVATE pthread)
set_target_properties(echo-daemon-ipc-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── Audio Daemon Integration Tests ──────────────────────────────────────────
# Placeholder for future tests that link against the daemon library.
# add_executable(echo-audio-daemon-tests
#     placeholder_test.cpp
# )
#
# target_link_libraries(echo-audio-daemon-tests
#     PRIVATE
#         echo-audio-daemon
#         ${FFMPEG_LIBRARIES}
# )
#
# target_include_directories(echo-audio-daemon-tests
#     PRIVATE
#         ${FFMPEG_INCLUDE_DIRS}
#         ${CMAKE_SOURCE_DIR}/third_party
# )

# ── WASAPI Exclusive Backend Tests ───────────────────────────────────────────
add_executable(echo-daemon-wasapi-exclusive-tests
    test_wasapi_exclusive_backend.cpp
    ../src/output/WasapiExclusiveBackend.cpp
)
target_compile_features(echo-daemon-wasapi-exclusive-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-wasapi-exclusive-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
)
target_link_libraries(echo-daemon-wasapi-exclusive-tests PRIVATE
    $<$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>:ole32>
    $<$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>:oleaut32>
)
set_target_properties(echo-daemon-wasapi-exclusive-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

target_compile_features(echo-daemon-null-output-tests PRIVATE cxx_std_17)

target_include_directories(echo-daemon-null-output-tests PRIVATE
    ${CMAKE_SOURCE_DIR}   # for `#include "src/output/..."`
)

set_target_properties(echo-daemon-null-output-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── Integration Test Harness (C++ in-process) ─────────────────────────────────
add_executable(echo-daemon-harness
    test_harness.cpp
    ../src/ipc/JsonRpcServer.cpp
    ../src/output/NullBackend.cpp
)
target_compile_features(echo-daemon-harness PRIVATE cxx_std_17)
target_include_directories(echo-daemon-harness PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-harness PRIVATE pthread)
set_target_properties(echo-daemon-harness PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── MiniaudioBackend Tests ────────────────────────────────────────────────
add_executable(echo-daemon-miniaudio-tests
    test_miniaudio_backend.cpp
    ../src/output/MiniaudioBackend.cpp
    ../third_party/miniaudio/miniaudio.c
)
target_compile_features(echo-daemon-miniaudio-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-miniaudio-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
    ${CMAKE_SOURCE_DIR}/third_party/miniaudio
)
target_link_libraries(echo-daemon-miniaudio-tests PRIVATE
    pthread
    dl
)
set_target_properties(echo-daemon-miniaudio-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── Device Enumerator Tests ─────────────────────────────────────────────────
add_executable(echo-daemon-device-enumerator-tests
    test_device_enumerator.cpp
    ../src/device/DeviceEnumerator.cpp
    ${CMAKE_SOURCE_DIR}/third_party/miniaudio/miniaudio.c
)
target_compile_features(echo-daemon-device-enumerator-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-device-enumerator-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-device-enumerator-tests PRIVATE pthread)
set_target_properties(echo-daemon-device-enumerator-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

# ── Device Watcher Tests ────────────────────────────────────────────────────
add_executable(echo-daemon-device-watcher-tests
    test_device_watcher.cpp
    ../src/device/DeviceWatcher.cpp
)
target_compile_features(echo-daemon-device-watcher-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-device-watcher-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-device-watcher-tests PRIVATE pthread)
set_target_properties(echo-daemon-device-watcher-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

add_test(NAME echo-daemon-miniaudio COMMAND echo-daemon-miniaudio-tests)

add_test(NAME echo-daemon-types COMMAND echo-daemon-tests)
add_test(NAME echo-daemon-ipc COMMAND echo-daemon-ipc-tests)
add_test(NAME echo-daemon-null-output COMMAND echo-daemon-null-output-tests)
add_test(NAME echo-daemon-harness COMMAND echo-daemon-harness)
add_test(NAME echo-daemon-device-enumerator COMMAND echo-daemon-device-enumerator-tests)
add_test(NAME echo-daemon-device-watcher COMMAND echo-daemon-device-watcher-tests)
add_test(NAME echo-daemon-harness-runner
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/harness_runner.sh
            $<TARGET_FILE:echo-audio-daemon>
)

# ── ASIO Backend Tests ───────────────────────────────────────────────────────
if(ECHO_ENABLE_ASIO AND WIN32)
    add_executable(echo-daemon-asio-tests
        test_asio_backend.cpp
        ../src/output/AsioBackend.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/common/asio.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/asiodrivers.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/pc/asiolist.cpp
    )

    target_compile_features(echo-daemon-asio-tests PRIVATE cxx_std_17)

    target_include_directories(echo-daemon-asio-tests PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${CMAKE_SOURCE_DIR}/third_party
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/common
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/pc
    )

    target_compile_definitions(echo-daemon-asio-tests PRIVATE
        ECHO_ENABLE_ASIO=1
        _CRT_SECURE_NO_WARNINGS
    )

    target_link_libraries(echo-daemon-asio-tests PRIVATE
        shell32
        ole32
        uuid
    )

    set_target_properties(echo-daemon-asio-tests PROPERTIES
        EXCLUDE_FROM_ALL TRUE
    )

    add_test(NAME echo-daemon-asio
        COMMAND echo-daemon-asio-tests
    )
endif()

add_test(NAME echo-daemon-wasapi-exclusive
    COMMAND echo-daemon-wasapi-exclusive-tests
)

# ── Decoder Module Tests ─────────────────────────────────────────────────────
# Find ebur128 first (pkg-config inherited from root CMakeLists.txt)
if(PkgConfig_FOUND)
    pkg_check_modules(EBUR128 libebur128)
endif()

add_executable(echo-daemon-decoder-tests
    test_decoder.cpp
    ../src/decoder/AvDecoder.cpp
    ../src/decoder/ReplayGain.cpp
)
target_compile_features(echo-daemon-decoder-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-decoder-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${FFMPEG_INCLUDE_DIRS}
    ${EBUR128_INCLUDE_DIRS}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-decoder-tests PRIVATE
    ${FFMPEG_LIBRARIES}
    ${EBUR128_LIBRARIES}
    pthread
)
set_target_properties(echo-daemon-decoder-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

add_test(NAME echo-daemon-decoder COMMAND echo-daemon-decoder-tests)

# ── BiquadFilter Tests ─────────────────────────────────────────────────────
add_executable(echo-daemon-biquad-tests
    test_biquad.cpp
    ../src/dsp/BiquadFilter.cpp
)
target_compile_features(echo-daemon-biquad-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-biquad-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
)
set_target_properties(echo-daemon-biquad-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-biquad COMMAND echo-daemon-biquad-tests)

# ── EqProcessor Tests ──────────────────────────────────────────────────────
add_executable(echo-daemon-eq-tests
    test_eq_processor.cpp
    ../src/dsp/BiquadFilter.cpp
    ../src/dsp/EqProcessor.cpp
)
target_compile_features(echo-daemon-eq-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-eq-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
)
set_target_properties(echo-daemon-eq-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-eq COMMAND echo-daemon-eq-tests)

# ── Session Manager Tests ──────────────────────────────────────────────────
# Tests the playback state machine with real AvDecoder (needs FFmpeg) and
# NullBackend via pipe-based IPC.
if(PkgConfig_FOUND)
    pkg_check_modules(FFMPEG_SESSION libavformat libavcodec libavutil libswresample)
endif()

add_executable(echo-daemon-session-manager-tests
    test_session_manager.cpp
    ../src/session/SessionManager.cpp
    ../src/decoder/AvDecoder.cpp
    ../src/output/NullBackend.cpp
    ../src/ipc/JsonRpcServer.cpp
    ../src/dsp/BiquadFilter.cpp
    ../src/dsp/EqProcessor.cpp
    ../src/dsp/ConvolutionProcessor.cpp
    ../src/dsp/ChannelBalanceProcessor.cpp
    ../src/dsp/Limiter.cpp
    ../src/dsp/DspPipeline.cpp
    ../third_party/kissfft/kiss_fft.c
)
target_compile_features(echo-daemon-session-manager-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-session-manager-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
    ${FFMPEG_INCLUDE_DIRS}
)
target_link_libraries(echo-daemon-session-manager-tests PRIVATE
    ${FFMPEG_LIBRARIES}
    pthread
    m
)
set_target_properties(echo-daemon-session-manager-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-session-manager
    COMMAND echo-daemon-session-manager-tests
)

# ── ConvolutionProcessor Tests ────────────────────────────────────────────
add_executable(echo-daemon-convolution-tests
    test_convolution.cpp
    ../src/dsp/ConvolutionProcessor.cpp
    ../third_party/kissfft/kiss_fft.c
)
target_compile_features(echo-daemon-convolution-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-convolution-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-convolution-tests PRIVATE m)
set_target_properties(echo-daemon-convolution-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-convolution COMMAND echo-daemon-convolution-tests)

# ── ChannelBalanceProcessor Tests ──────────────────────────────────────────
add_executable(echo-daemon-channel-balance-tests
    test_channel_balance.cpp
    ../src/dsp/ChannelBalanceProcessor.cpp
)
target_compile_features(echo-daemon-channel-balance-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-channel-balance-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
)
set_target_properties(echo-daemon-channel-balance-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-channel-balance COMMAND echo-daemon-channel-balance-tests)

# ── Limiter Tests ──────────────────────────────────────────────────────────
add_executable(echo-daemon-limiter-tests
    test_limiter.cpp
    ../src/dsp/Limiter.cpp
)
target_compile_features(echo-daemon-limiter-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-limiter-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
)
set_target_properties(echo-daemon-limiter-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-limiter COMMAND echo-daemon-limiter-tests)

# ── DspPipeline Tests ─────────────────────────────────────────────────────
add_executable(echo-daemon-dsp-pipeline-tests
    test_dsp_pipeline.cpp
    ../src/dsp/BiquadFilter.cpp
    ../src/dsp/ChannelBalanceProcessor.cpp
    ../src/dsp/ConvolutionProcessor.cpp
    ../src/dsp/DspPipeline.cpp
    ../src/dsp/EqProcessor.cpp
    ../src/dsp/Limiter.cpp
    ../third_party/kissfft/kiss_fft.c
)
target_compile_features(echo-daemon-dsp-pipeline-tests PRIVATE cxx_std_17)
target_include_directories(echo-daemon-dsp-pipeline-tests PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)
target_link_libraries(echo-daemon-dsp-pipeline-tests PRIVATE m)
set_target_properties(echo-daemon-dsp-pipeline-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)
add_test(NAME echo-daemon-dsp-pipeline COMMAND echo-daemon-dsp-pipeline-tests)
