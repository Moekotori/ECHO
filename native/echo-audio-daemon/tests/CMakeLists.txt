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

target_compile_features(echo-daemon-null-output-tests PRIVATE cxx_std_17)

target_include_directories(echo-daemon-null-output-tests PRIVATE
    ${CMAKE_SOURCE_DIR}   # for `#include "src/output/..."`
)

set_target_properties(echo-daemon-null-output-tests PROPERTIES
    EXCLUDE_FROM_ALL TRUE
)

add_test(NAME echo-daemon-types COMMAND echo-daemon-tests)
add_test(NAME echo-daemon-ipc COMMAND echo-daemon-ipc-tests)
add_test(NAME echo-daemon-null-output COMMAND echo-daemon-null-output-tests)
