// ── Device Watcher Tests ────────────────────────────────────────────────────
// Verifies that DeviceWatcher can be constructed, started, stopped, and
// destroyed without crashes.  Hotplug-event testing requires physical device
// action and is left to integration / manual verification.
//
// Build target: echo-daemon-device-watcher-tests

#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#include "src/device/DeviceWatcher.h"

namespace ead = echo_audio_daemon;

// ── Helpers ─────────────────────────────────────────────────────────────────
#define CHECK(expr)                                                       \
    do {                                                                   \
        if (!(expr)) {                                                     \
            std::cerr << "FAIL [" << __FILE__ << ":" << __LINE__ << "] "  \
                      << #expr << "\n";                                    \
            return 1;                                                      \
        }                                                                  \
    } while (false)

// ── Test: create and immediately destroy (no start) ────────────────────────
static int test_create_destroy() {
    std::cout << "  test_create_destroy...\n";

    {
        ead::DeviceWatcher watcher;
        CHECK(!watcher.isRunning());
        // Destructor runs here — must not crash.
    }

    std::cout << "    OK.\n";
    return 0;
}

// ── Test: start and stop ────────────────────────────────────────────────────
static int test_start_stop() {
    std::cout << "  test_start_stop...\n";

    ead::DeviceWatcher watcher;
    watcher.setCallback([](const std::string& event, const std::string& id) {
        std::cout << "      [event] " << event << " : " << id << "\n";
    });

    CHECK(watcher.start());
    CHECK(watcher.isRunning());

    // Let it run briefly.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    watcher.stop();
    CHECK(!watcher.isRunning());

    std::cout << "    OK.\n";
    return 0;
}

// ── Test: double start returns false ────────────────────────────────────────
static int test_double_start() {
    std::cout << "  test_double_start...\n";

    ead::DeviceWatcher watcher;
    CHECK(watcher.start());
    CHECK(watcher.isRunning());

    // Second start should fail.
    CHECK(!watcher.start());

    watcher.stop();
    CHECK(!watcher.isRunning());

    std::cout << "    OK.\n";
    return 0;
}

// ── Test: stop without start (no-op, no crash) ──────────────────────────────
static int test_stop_without_start() {
    std::cout << "  test_stop_without_start...\n";

    ead::DeviceWatcher watcher;
    watcher.stop();  // should be a no-op
    CHECK(!watcher.isRunning());

    std::cout << "    OK.\n";
    return 0;
}

// ── Test: set callback after start ──────────────────────────────────────────
static int test_set_callback_after_start() {
    std::cout << "  test_set_callback_after_start...\n";

    ead::DeviceWatcher watcher;
    CHECK(watcher.start());

    int callCount = 0;
    watcher.setCallback([&callCount](const std::string&, const std::string&) {
        ++callCount;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    watcher.stop();

    // We don't assert callCount here — on a quiet system there may be
    // zero events, and that is fine.
    CHECK(!watcher.isRunning());

    std::cout << "    OK (callCount=" << callCount << ").\n";
    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-device-watcher tests ===\n";

    int failures = 0;
    failures += test_create_destroy();
    failures += test_start_stop();
    failures += test_double_start();
    failures += test_stop_without_start();
    failures += test_set_callback_after_start();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
