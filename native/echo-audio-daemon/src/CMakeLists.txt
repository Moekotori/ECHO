set(ECHO_AUDIO_DAEMON_SOURCES
    main.cpp
)

add_executable(echo-audio-daemon
    ${ECHO_AUDIO_DAEMON_SOURCES}
)

target_link_libraries(echo-audio-daemon
    PRIVATE
        ${FFMPEG_LIBRARIES}
)

target_include_directories(echo-audio-daemon
    PRIVATE
        ${FFMPEG_INCLUDE_DIRS}
        ${CMAKE_SOURCE_DIR}/third_party
)

target_compile_definitions(echo-audio-daemon
    PRIVATE
        $<$<BOOL:${ECHO_ENABLE_ASIO}>:ECHO_ENABLE_ASIO>
        $<$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>:ECHO_ENABLE_WASAPI_EXCLUSIVE>
)
