// ── NullBackend Unit Tests ───────────────────────────────────────────────────
// Verifies that NullBackend correctly implements the OutputDevice interface:
// open/close bookkeeping, frame counting across multiple write calls, rejection
// of writes after close, and proper state reset across reopen cycles.

#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

#include "src/output/NullBackend.h"

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

// ── Test: open and close ─────────────────────────────────────────────────────
static int test_open_and_close() {
    std::cout << "  test_open_and_close...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    CHECK(!backend.isOpen());
    CHECK(backend.getSampleRate() == 0);
    CHECK(backend.getChannels() == 0);
    CHECK(backend.getBackendName() == "null");

    CHECK(backend.open(dev, 44100, 2, 512));
    CHECK(backend.isOpen());
    CHECK(backend.getSampleRate() == 44100);
    CHECK(backend.getChannels() == 2);
    CHECK(backend.getBufferFrames() == 512);

    backend.close();
    CHECK(!backend.isOpen());
    CHECK(backend.getSampleRate() == 0);
    CHECK(backend.getChannels() == 0);
    CHECK(backend.getBufferFrames() == 0);

    return 0;
}

// ── Test: write counts frames ─────────────────────────────────────────────────
static int test_write_counts_frames() {
    std::cout << "  test_write_counts_frames...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    backend.open(dev, 48000, 2, 1024);

    // Write 1024 frames of silent samples
    std::vector<float> silent(1024 * 2, 0.0f);
    CHECK(backend.write(silent.data(), 1024));
    CHECK(backend.totalFramesWritten() == 1024);
    CHECK(backend.writeCount() == 1);

    backend.close();
    return 0;
}

// ── Test: write multiple calls accumulates ────────────────────────────────────
static int test_write_multiple_calls() {
    std::cout << "  test_write_multiple_calls...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    backend.open(dev, 44100, 2, 512);

    std::vector<float> buf(512 * 2, 0.0f);

    CHECK(backend.write(buf.data(), 512));
    CHECK(backend.totalFramesWritten() == 512);
    CHECK(backend.writeCount() == 1);

    CHECK(backend.write(buf.data(), 512));
    CHECK(backend.totalFramesWritten() == 1024);
    CHECK(backend.writeCount() == 2);

    CHECK(backend.write(buf.data(), 512));
    CHECK(backend.totalFramesWritten() == 1536);
    CHECK(backend.writeCount() == 3);

    backend.close();
    return 0;
}

// ── Test: write after close returns false ─────────────────────────────────────
static int test_write_after_close() {
    std::cout << "  test_write_after_close...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    backend.open(dev, 44100, 2, 256);
    backend.close();

    std::vector<float> buf(256 * 2, 0.0f);
    CHECK(!backend.write(buf.data(), 256));

    return 0;
}

// ── Test: reopen cycle resets counters ────────────────────────────────────────
static int test_reopen_cycle() {
    std::cout << "  test_reopen_cycle...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    // First cycle: open → write → close
    backend.open(dev, 44100, 2, 512);
    std::vector<float> buf(512 * 2, 0.0f);

    CHECK(backend.write(buf.data(), 512));
    CHECK(backend.totalFramesWritten() == 512);
    CHECK(backend.writeCount() == 1);

    backend.close();
    CHECK(backend.totalFramesWritten() == 0);   // reset
    CHECK(backend.writeCount() == 0);

    // Second cycle: reopen → write → verify fresh counter
    backend.open(dev, 48000, 1, 256);
    CHECK(backend.isOpen());
    CHECK(backend.getSampleRate() == 48000);
    CHECK(backend.getChannels() == 1);
    CHECK(backend.getBufferFrames() == 256);

    std::vector<float> buf2(256 * 1, 0.0f);
    CHECK(backend.write(buf2.data(), 256));
    CHECK(backend.totalFramesWritten() == 256);
    CHECK(backend.writeCount() == 1);

    backend.close();
    return 0;
}

// ── Test: lastSamples stores correct data ─────────────────────────────────────
static int test_last_samples() {
    std::cout << "  test_last_samples...\n";

    ead::NullBackend backend;
    ead::DeviceInfo dev;

    backend.open(dev, 44100, 2, 128);

    // Write a ramp: L=0.0, R=0.5, L=1.0, R=1.5, ...
    std::vector<float> ramp(128 * 2);
    for (int i = 0; i < 128; ++i) {
        ramp[i * 2 + 0] = static_cast<float>(i);       // left
        ramp[i * 2 + 1] = static_cast<float>(i) + 0.5f; // right
    }

    CHECK(backend.write(ramp.data(), 128));
    CHECK(backend.lastSamples().size() == static_cast<size_t>(128 * 2));

    // Spot-check a few values
    CHECK(std::fabs(backend.lastSamples()[0] - 0.0f) < 1e-6f);
    CHECK(std::fabs(backend.lastSamples()[1] - 0.5f) < 1e-6f);
    CHECK(std::fabs(backend.lastSamples()[10] - 5.0f) < 1e-6f);
    CHECK(std::fabs(backend.lastSamples()[11] - 5.5f) < 1e-6f);

    backend.close();
    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-null-output tests ===\n";

    int failures = 0;
    failures += test_open_and_close();
    failures += test_write_counts_frames();
    failures += test_write_multiple_calls();
    failures += test_write_after_close();
    failures += test_reopen_cycle();
    failures += test_last_samples();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
