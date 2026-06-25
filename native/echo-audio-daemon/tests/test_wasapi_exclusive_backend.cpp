// ── WASAPI Exclusive Backend Unit Tests ─────────────────────────────────────
// Verifies that WasapiExclusiveBackend compiles and correctly implements the
// OutputDevice interface.
//
// Platform behaviour:
//   Windows:   Full tests — device enumeration + open/close + write.
//   Non-Windows: Stub — prints SKIP and returns 0 (exit code is the only
//               assertion: the test must compile and run cleanly).

#include "src/output/WasapiExclusiveBackend.h"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>

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

// ── Test: device enumeration ─────────────────────────────────────────────────
// On Windows this returns the list of WASAPI render devices; on other platforms
// the stub returns an empty list.  The test checks that the call succeeds in
// both cases (always compiles, never crashes).
static int test_device_enumeration() {
    std::cout << "  test_device_enumeration...\n";

    auto devices = ead::WasapiExclusiveBackend::listAvailableDevices();
    std::cout << "    Found " << devices.size() << " device(s).\n";

    for (const auto& d : devices) {
        std::cout << "      - " << d.name
                  << " (rate=" << d.sampleRate
                  << " sharedRate=" << d.sharedSampleRate
                  << " default=" << (d.isDefault ? "yes" : "no")
                  << ")\n";
    }

    return 0;  // enumeration itself must never crash
}

// ── Test: open and close ─────────────────────────────────────────────────────
static int test_open_and_close() {
    std::cout << "  test_open_and_close...\n";

    ead::WasapiExclusiveBackend backend;

    // Initial state
    CHECK(!backend.isOpen());
    CHECK(backend.getSampleRate() == 0);
    CHECK(backend.getChannels() == 0);
    CHECK(backend.getBufferFrames() == 0);
    CHECK(backend.getBackendName() == "wasapi_exclusive");

    // Attempt open with default device (empty name → default endpoint)
    ead::DeviceInfo dev;
    dev.outputMode = ead::OutputMode::Exclusive;

    bool opened = backend.open(dev, 44100, 2, 512);
    if (!opened) {
        std::cout << "    Skipped — default WASAPI exclusive device not available "
                     "(expected on CI / non-Windows / headless).\n";
        return 0;
    }

    // Post-open state
    CHECK(backend.isOpen());
    CHECK(backend.getSampleRate() > 0);
    CHECK(backend.getChannels() > 0);
    CHECK(backend.getBufferFrames() > 0);
    std::cout << "    Opened: " << backend.getSampleRate() << " Hz, "
              << backend.getChannels() << " ch, "
              << backend.getBufferFrames() << " frames\n";

    // Write silence
    std::vector<float> silence(static_cast<size_t>(backend.getBufferFrames() * backend.getChannels()), 0.0f);
    CHECK(backend.write(silence.data(), backend.getBufferFrames()));

    backend.close();
    CHECK(!backend.isOpen());

    std::cout << "    Close OK.\n";
    return 0;
}

// ── Test: write after close returns false ─────────────────────────────────────
static int test_write_after_close() {
    std::cout << "  test_write_after_close...\n";

    ead::WasapiExclusiveBackend backend;
    ead::DeviceInfo dev;
    dev.outputMode = ead::OutputMode::Exclusive;

    bool opened = backend.open(dev, 44100, 2, 512);
    if (!opened) {
        std::cout << "    Skipped.\n";
        return 0;
    }

    backend.close();
    CHECK(!backend.isOpen());

    std::vector<float> buf(512 * 2, 0.0f);
    CHECK(!backend.write(buf.data(), 512));   // must reject

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
#ifndef _WIN32
    std::cout << "SKIP: WASAPI exclusive tests are Windows-only.\n";
    return 0;
#else
    std::cout << "=== WasapiExclusiveBackend Tests ===\n";

    int failures = 0;
    failures += test_device_enumeration();
    failures += test_open_and_close();
    failures += test_write_after_close();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
#endif
}
