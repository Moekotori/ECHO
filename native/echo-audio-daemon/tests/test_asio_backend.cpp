// ── ASIO Backend Tests ──────────────────────────────────────────────────────
//
// These tests verify that the AsioBackend compiles and that the device
// enumeration logic runs without crashing.  Because ASIO drivers are not
// guaranteed to be present on every machine, the open/close tests are
// conditionally skipped when no ASIO driver is found.
//
// Compile with: -DECHO_ENABLE_ASIO=1

#ifdef ECHO_ENABLE_ASIO

#include "../src/output/AsioBackend.h"
#include "../src/output/OutputDevice.h"
#include "../src/common/AudioTypes.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

// ==========================================================================
// Test utilities
// ==========================================================================

static int  g_testsPassed = 0;
static int  g_testsFailed = 0;
static int  g_testsSkipped = 0;

#define TEST(name)                                                      \
    do {                                                                \
        fprintf(stderr, "  " name "... ");                              \
        bool _ok = true;

#define END_TEST(name)                                                  \
        if (_ok) {                                                      \
            fprintf(stderr, "PASS\n");                                  \
            ++g_testsPassed;                                            \
        } else {                                                        \
            fprintf(stderr, "FAIL\n");                                  \
            ++g_testsFailed;                                            \
        }                                                               \
    } while(0)

#define SKIP(reason)                                                    \
    do {                                                                \
        fprintf(stderr, "SKIP (%s)\n", reason);                         \
        ++g_testsSkipped;                                               \
    } while(0)

#define CHECK(cond)                                                     \
    do {                                                                \
        if (!(cond)) {                                                  \
            fprintf(stderr, "\n    FAIL at %s:%d: %s\n",                \
                    __FILE__, __LINE__, #cond);                         \
            _ok = false;                                                \
        }                                                               \
    } while(0)

// ==========================================================================
// test_compile — just instantiate and verify the backend type name
// ==========================================================================

static void test_compile() {
    TEST("AsioBackend compiles and reports backend name")
        echo_audio_daemon::AsioBackend backend;
        CHECK(backend.getBackendName() == "asio" ||
              backend.getBackendName() == "asio (stub)");
        CHECK(!backend.isOpen());
        CHECK(backend.getSampleRate() == 0);
        CHECK(backend.getChannels() == 0);
        CHECK(backend.getBufferFrames() == 0);
    END_TEST("AsioBackend compiles and reports backend name");
}

// ==========================================================================
// test_enumerate — list available ASIO drivers
// ==========================================================================

static void test_enumerate() {
    TEST("AsioBackend::enumerateDevices returns without crash")
        std::vector<echo_audio_daemon::DeviceInfo> devices;
        bool anyFound = echo_audio_daemon::AsioBackend::enumerateDevices(devices);
        // It's OK if no drivers are found — the test just checks it doesn't crash.
        CHECK(devices.empty() || anyFound);
        if (!devices.empty()) {
            fprintf(stderr, "\n    Found %zu ASIO driver(s):\n", devices.size());
            for (size_t i = 0; i < devices.size(); ++i) {
                fprintf(stderr, "      [%zu] %s (outputMode=%d, channels=%d)\n",
                        i, devices[i].name.c_str(),
                        static_cast<int>(devices[i].outputMode),
                        devices[i].asioOutputChannels);
            }
        }
    END_TEST("AsioBackend::enumerateDevices returns without crash");
}

// ==========================================================================
// test_open_close — open the first available driver (if any) and close it
// ==========================================================================

static void test_open_close() {
    // First, enumerate to see if any drivers exist
    std::vector<echo_audio_daemon::DeviceInfo> devices;
    if (!echo_audio_daemon::AsioBackend::enumerateDevices(devices) || devices.empty()) {
        SKIP("no ASIO driver available");
        return;
    }

    const echo_audio_daemon::DeviceInfo& first = devices[0];
    fprintf(stderr, "\n    Attempting open/close for: %s\n", first.name.c_str());

    TEST("AsioBackend open + close with first available driver")
        echo_audio_daemon::AsioBackend backend;
        // open() may still fail if the driver can't be initialised (e.g. in use).
        // We just verify that if open succeeds, the state is consistent.
        bool opened = backend.open(first, 44100, 2, 1024);
        if (opened) {
            CHECK(backend.isOpen());
            CHECK(backend.getSampleRate() == 44100);
            CHECK(backend.getChannels() > 0);
            CHECK(backend.getBufferFrames() > 0);
            backend.close();
            CHECK(!backend.isOpen());
        } else {
            fprintf(stderr, "\n    open() returned false (driver may be busy or unavailable) — not a failure\n");
        }
    END_TEST("AsioBackend open + close with first available driver");
}

// ==========================================================================
// main
// ==========================================================================

int main() {
    fprintf(stderr, "=== ASIO Backend Tests ===\n\n");

    test_compile();
    test_enumerate();
    test_open_close();

    fprintf(stderr, "\n=== Results: %d passed, %d failed, %d skipped ===\n",
            g_testsPassed, g_testsFailed, g_testsSkipped);

    return g_testsFailed > 0 ? 1 : 0;
}

#else // !ECHO_ENABLE_ASIO

#include <cstdio>

int main() {
    fprintf(stderr, "=== ASIO Backend Tests ===\n\n");
    fprintf(stderr, "  ECHO_ENABLE_ASIO is not defined — all tests SKIPPED.\n");
    fprintf(stderr, "  Rebuild with -DECHO_ENABLE_ASIO=ON on Windows to run.\n\n");
    fprintf(stderr, "=== Results: 0 passed, 0 failed, 3 skipped ===\n");
    return 0;
}

#endif // ECHO_ENABLE_ASIO
