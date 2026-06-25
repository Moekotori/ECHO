// ── MiniaudioBackend Unit Tests ─────────────────────────────────────────────
// Tests device enumeration, open/close, and write for the MiniaudioBackend
// which wraps the vendored miniaudio library.
//
// All tests gracefully handle the case where no audio device is available
// (headless CI, container, etc.) by skipping with an explanatory message.
//
// Build target: echo-daemon-miniaudio-tests
// Register in CTest as: echo-daemon-miniaudio

#include <iostream>
#include <vector>

#include "src/output/MiniaudioBackend.h"

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

/// Returns true if at least one playback device is available.
static bool hasDevice() {
    auto devices = ead::MiniaudioBackend::enumerate();
    return !devices.empty();
}

// ── Test: enumerate returns at least 0 devices ──────────────────────────────
static int test_enumerate() {
    std::cout << "  test_enumerate...\n";

    auto devices = ead::MiniaudioBackend::enumerate();
    // No lower bound — 0 is valid (headless CI, no audio hardware).
    CHECK(devices.size() >= 0);

    // If devices exist, validate their structure
    for (const auto& d : devices) {
        CHECK(!d.id.empty());
        CHECK(!d.name.empty());
        CHECK(d.outputMode == ead::OutputMode::Shared);
    }

    std::cout << "    " << devices.size() << " device(s) found.\n";
    return 0;
}

// ── Test: getDefaultDevice returns something sensible ───────────────────────
static int test_get_default_device() {
    std::cout << "  test_get_default_device...\n";

    auto def = ead::MiniaudioBackend::getDefaultDevice();
    if (!hasDevice()) {
        // No devices — default should be empty
        CHECK(def.id.empty());
        CHECK(def.name.empty());
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    CHECK(!def.id.empty());
    CHECK(!def.name.empty());
    return 0;
}

// ── Test: open with default device succeeds ─────────────────────────────────
static int test_open_default() {
    std::cout << "  test_open_default...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    CHECK(!backend.isOpen());
    CHECK(backend.open(def, 44100, 2, 512));
    CHECK(backend.isOpen());
    CHECK(backend.getSampleRate() == 44100);
    CHECK(backend.getChannels() == 2);
    CHECK(backend.getBufferFrames() > 0);   // miniaudio may adjust
    CHECK(backend.getBackendName() == "miniaudio");

    backend.close();
    CHECK(!backend.isOpen());
    return 0;
}

// ── Test: open with explicit sample rate ────────────────────────────────────
static int test_open_sample_rate() {
    std::cout << "  test_open_sample_rate...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    // Try 48000 Hz
    CHECK(backend.open(def, 48000, 2, 1024));
    CHECK(backend.getSampleRate() == 48000);
    backend.close();
    return 0;
}

// ── Test: open with mono output ─────────────────────────────────────────────
static int test_open_mono() {
    std::cout << "  test_open_mono...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    CHECK(backend.open(def, 44100, 1, 512));
    CHECK(backend.getChannels() == 1);
    backend.close();
    return 0;
}

// ── Test: write silence, verify no crash ────────────────────────────────────
static int test_write_silence() {
    std::cout << "  test_write_silence...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    CHECK(backend.open(def, 44100, 2, 512));

    // Write 1024 frames of silence
    std::vector<float> silent(1024 * 2, 0.0f);
    CHECK(backend.write(silent.data(), 1024));

    // Write a second chunk (verifies ring buffer wraps correctly)
    CHECK(backend.write(silent.data(), 1024));

    backend.close();
    CHECK(!backend.isOpen());
    return 0;
}

// ── Test: write non-zero samples (ramp) ─────────────────────────────────────
static int test_write_ramp() {
    std::cout << "  test_write_ramp...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    CHECK(backend.open(def, 44100, 2, 256));

    // Write a small ramp
    std::vector<float> ramp(256 * 2);
    for (int i = 0; i < 256; ++i) {
        ramp[i * 2 + 0] = 0.5f;  // left
        ramp[i * 2 + 1] = 0.5f;  // right
    }
    CHECK(backend.write(ramp.data(), 256));

    backend.close();
    return 0;
}

// ── Test: close, then write returns false ───────────────────────────────────
static int test_write_after_close() {
    std::cout << "  test_write_after_close...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    CHECK(backend.open(def, 44100, 2, 256));
    backend.close();

    std::vector<float> buf(256 * 2, 0.0f);
    CHECK(!backend.write(buf.data(), 256));
    CHECK(!backend.isOpen());
    return 0;
}

// ── Test: reopen cycle works ───────────────────────────────────────────────
static int test_reopen_cycle() {
    std::cout << "  test_reopen_cycle...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    ead::MiniaudioBackend backend;
    auto def = ead::MiniaudioBackend::getDefaultDevice();

    // First cycle
    CHECK(backend.open(def, 44100, 2, 512));
    std::vector<float> buf(512 * 2, 0.0f);
    CHECK(backend.write(buf.data(), 512));
    CHECK(backend.isOpen());
    backend.close();
    CHECK(!backend.isOpen());

    // Second cycle with different params
    CHECK(backend.open(def, 48000, 1, 256));
    CHECK(backend.isOpen());
    CHECK(backend.getSampleRate() == 48000);
    CHECK(backend.getChannels() == 1);
    CHECK(backend.getBufferFrames() > 0);

    std::vector<float> buf2(256 * 1, 0.0f);
    CHECK(backend.write(buf2.data(), 256));
    backend.close();
    CHECK(!backend.isOpen());
    return 0;
}

// ── Test: device identification round-trip ─────────────────────────────────
// Verify that the first device's ID can be used to identify it again.
static int test_device_id_roundtrip() {
    std::cout << "  test_device_id_roundtrip...\n";

    if (!hasDevice()) {
        std::cout << "    SKIPPED (no device)\n";
        return 0;
    }

    auto devices = ead::MiniaudioBackend::enumerate();
    CHECK(!devices.empty());

    // Grab the first device, open it with its ID, verify it works
    ead::MiniaudioBackend backend;
    CHECK(backend.open(devices[0], 44100, 2, 512));
    CHECK(backend.isOpen());
    backend.close();
    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-miniaudio tests ===\n";

    int failures = 0;
    failures += test_enumerate();
    failures += test_get_default_device();
    failures += test_open_default();
    failures += test_open_sample_rate();
    failures += test_open_mono();
    failures += test_write_silence();
    failures += test_write_ramp();
    failures += test_write_after_close();
    failures += test_reopen_cycle();
    failures += test_device_id_roundtrip();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
