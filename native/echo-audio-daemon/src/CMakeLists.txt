set(ECHO_AUDIO_DAEMON_SOURCES
    main.cpp
    decoder/AvDecoder.cpp
    decoder/ReplayGain.cpp
    dsp/BiquadFilter.cpp
    dsp/ChannelBalanceProcessor.cpp
    dsp/ConvolutionProcessor.cpp
    dsp/DspPipeline.cpp
    dsp/EqProcessor.cpp
    dsp/Limiter.cpp
    device/DeviceEnumerator.cpp
    device/DeviceWatcher.cpp
    ipc/JsonRpcServer.cpp
    output/MiniaudioBackend.cpp
    output/NullBackend.cpp
    output/WasapiExclusiveBackend.cpp
    session/SessionManager.cpp
)

add_executable(echo-audio-daemon
    ${ECHO_AUDIO_DAEMON_SOURCES}
    ${CMAKE_SOURCE_DIR}/third_party/kissfft/kiss_fft.c
    ${CMAKE_SOURCE_DIR}/third_party/miniaudio/miniaudio.c
)

# Find ebur128 for ReplayGain (check via pkg-config)
if(PkgConfig_FOUND)
    pkg_check_modules(EBUR128 libebur128)
endif()

target_link_libraries(echo-audio-daemon
    PRIVATE
        ${FFMPEG_LIBRARIES}
        ${EBUR128_LIBRARIES}
        dl
        m
        pthread
        $<$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>:ole32>
        $<$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>:oleaut32>
        $<$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>:avrt>
)

target_include_directories(echo-audio-daemon
    PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${FFMPEG_INCLUDE_DIRS}
        ${EBUR128_INCLUDE_DIRS}
        ${CMAKE_SOURCE_DIR}/third_party
        ${CMAKE_SOURCE_DIR}/third_party/miniaudio
)

target_compile_definitions(echo-audio-daemon
    PRIVATE
        $<$<BOOL:${ECHO_ENABLE_ASIO}>:ECHO_ENABLE_ASIO>
        $<$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>:ECHO_ENABLE_WASAPI_EXCLUSIVE>
)

# ── ASIO backend (Windows-only) ──────────────────────────────────────────
if(ECHO_ENABLE_ASIO AND WIN32)
    target_sources(echo-audio-daemon PRIVATE
        output/AsioBackend.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/common/asio.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/asiodrivers.cpp
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/pc/asiolist.cpp
    )

    target_include_directories(echo-audio-daemon PRIVATE
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/common
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host
        ${CMAKE_SOURCE_DIR}/third_party/asio-sdk/host/pc
    )

    target_compile_definitions(echo-audio-daemon PRIVATE _CRT_SECURE_NO_WARNINGS)

    target_link_libraries(echo-audio-daemon PRIVATE
        shell32
        ole32
        uuid
    )
endif()
