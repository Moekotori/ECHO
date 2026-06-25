# ── Type Definition Tests ────────────────────────────────────────────────────
# Header-only types; no external linkage required beyond the standard library.
add_executable(echo-daemon-tests
    test_types.cpp
)

target_compile_features(echo-daemon-tests PRIVATE cxx_std_17)

target_include_directories(echo-daemon-tests PRIVATE
    ${CMAKE_SOURCE_DIR}   # for `#include "src/common/..."`
)

set_target_properties(echo-daemon-tests PROPERTIES
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

add_test(NAME echo-daemon-types COMMAND echo-daemon-tests)
