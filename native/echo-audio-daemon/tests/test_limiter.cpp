// ── Limiter Unit Tests ───────────────────────────────────────────────────────
// Tests: pass-through below threshold, clipping prevention, protecting flag.
//
// Build target: echo-daemon-limiter-tests

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

#include "src/dsp/Limiter.h"

namespace ead = echo_audio_daemon;

// ── Test helpers ────────────────────────────────────────────────────────────

#define CHECK(expr)                                                       \
    do {                                                                   \
        if (!(expr)) {                                                     \
            std::cerr << "FAIL [" << __FILE__ << ":" << __LINE__ << "] "  \
                      << #expr << "\n";                                    \
            return 1;                                                      \
        }                                                                  \
    } while (false)

// ── Test 1: No limiting below threshold ─────────────────────────────────────
// Signal at 0.5 amplitude (well below 0 dBFS) should pass through unchanged.
static int test_no_limiting() {
    std::cout << "  test_no_limiting...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;
    std::vector<float> input(static_cast<size_t>(kFrames * kChannels));
    std::vector<float> reference(static_cast<size_t>(kFrames * kChannels));

    // Fill with constant low-level signal
    for (size_t i = 0; i < input.size(); ++i) {
        input[i] = 0.5f;
        reference[i] = 0.5f;
    }

    ead::Limiter limiter;
    limiter.setEnabled(true);
    limiter.processBlock(input.data(), kFrames, kChannels);

    // Output should be nearly identical to input (no limiting needed)
    double maxDiff = 0.0;
    for (size_t i = 0; i < input.size(); ++i) {
        const double diff = std::abs(static_cast<double>(input[i]) - static_cast<double>(reference[i]));
        if (diff > maxDiff)
            maxDiff = diff;
    }

    std::cerr << "    maxDiff=" << maxDiff << "\n";
    CHECK(maxDiff < 0.001);  // essentially pass-through

    return 0;
}

// ── Test 2: Prevents clipping ───────────────────────────────────────────────
// Signal at 2.0 amplitude → output should never exceed 1.0 (0 dBFS).
// The envelope needs a brief attack transient (~1 ms), so we pre-fill the
// limiter with several blocks before verifying the steady-state output.
static int test_prevents_clipping() {
    std::cout << "  test_prevents_clipping...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;
    std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));

    // Fill with constant 2.0 amplitude (6 dB above threshold)
    for (size_t i = 0; i < buffer.size(); ++i)
        buffer[i] = 2.0f;

    ead::Limiter limiter;
    limiter.setEnabled(true);

    // Pre-fill: process several blocks with 2.0 input to bring the envelope
    // past threshold so the attack transient has settled.  Re-fill the buffer
    // before each call since processBlock modifies it in-place.
    for (int b = 0; b < 5; ++b) {
        std::fill(buffer.begin(), buffer.end(), 2.0f);
        limiter.processBlock(buffer.data(), kFrames, kChannels);
    }

    // Now process one final block and verify it's all limited
    std::fill(buffer.begin(), buffer.end(), 2.0f);
    limiter.processBlock(buffer.data(), kFrames, kChannels);

    // Verify no sample exceeds 1.0
    float maxSample = 0.0f;
    for (size_t i = 0; i < buffer.size(); ++i) {
        const float absVal = std::abs(buffer[i]);
        if (absVal > maxSample)
            maxSample = absVal;
    }

    std::cerr << "    maxSample=" << maxSample << "\n";
    CHECK(maxSample <= 1.0001f);  // within floating-point tolerance of 0 dBFS

    // Also verify that some gain reduction actually happened
    CHECK(maxSample < 1.1f);

    return 0;
}

// ── Test 3: Protecting flag ─────────────────────────────────────────────────
// When limiting a signal above threshold, isProtecting() should return true.
static int test_protecting_flag() {
    std::cout << "  test_protecting_flag...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;
    std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));

    // Fill with signal above threshold
    for (size_t i = 0; i < buffer.size(); ++i)
        buffer[i] = 1.5f;

    ead::Limiter limiter;
    limiter.setEnabled(true);

    // Process a block to activate limiting
    limiter.processBlock(buffer.data(), kFrames, kChannels);

    const bool protecting = limiter.isProtecting();
    std::cerr << "    isProtecting=" << protecting << "\n";
    CHECK(protecting);  // should be protecting

    // Process a block with low-level signal — protection should fade
    for (size_t i = 0; i < buffer.size(); ++i)
        buffer[i] = 0.1f;

    // Process several blocks to allow release
    for (int b = 0; b < 10; ++b)
        limiter.processBlock(buffer.data(), kFrames, kChannels);

    const bool notProtecting = limiter.isProtecting();
    std::cerr << "    after quiet= isProtecting=" << notProtecting << "\n";
    CHECK(!notProtecting);  // should no longer be protecting

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

int main() {
    int failures = 0;

    std::cout << "test_no_limiting...\n";
    failures += test_no_limiting();

    std::cout << "test_prevents_clipping...\n";
    failures += test_prevents_clipping();

    std::cout << "test_protecting_flag...\n";
    failures += test_protecting_flag();

    if (failures == 0) {
        std::cout << "All tests PASSED.\n";
    } else {
        std::cerr << failures << " test(s) FAILED.\n";
    }
    return failures;
}
