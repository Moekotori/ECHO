// ── DspPipeline Unit Tests ───────────────────────────────────────────────────
// Tests: empty pipeline pass-through, EQ chain, limiter chain, isActive, reset.
//
// Build target: echo-daemon-dsp-pipeline-tests

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

#include "src/dsp/DspPipeline.h"

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

constexpr double kSampleRate = 44100.0;
constexpr double kPi         = 3.14159265358979323846;

static void generateSine(std::vector<float>& buffer,
                          double frequency,
                          double amplitude = 1.0) {
    for (size_t i = 0; i < buffer.size(); ++i) {
        buffer[i] = static_cast<float>(
            amplitude * std::sin(2.0 * kPi * frequency * static_cast<double>(i) / kSampleRate));
    }
}

static double computeRms(const std::vector<float>& data, double skipRatio = 0.3) {
    const size_t start = static_cast<size_t>(static_cast<double>(data.size()) * skipRatio);
    if (start >= data.size())
        return 0.0;

    double sumSq = 0.0;
    size_t count = 0;
    for (size_t i = start; i < data.size(); ++i) {
        sumSq += static_cast<double>(data[i]) * static_cast<double>(data[i]);
        ++count;
    }
    return (count > 0) ? std::sqrt(sumSq / static_cast<double>(count)) : 0.0;
}

// ── Test 1: Empty pipeline (all defaults) ────────────────────────────────────
// All processors in their default state → the pipeline should be transparent.
static int test_empty_pipeline() {
    std::cout << "  test_empty_pipeline...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;

    ead::DspPipeline pipeline;
    pipeline.prepare(kSampleRate, kFrames, kChannels);

    std::vector<float> input(static_cast<size_t>(kFrames * kChannels));
    generateSine(input, 440.0, 0.5);

    std::vector<float> output = input;
    pipeline.processBlock(output.data(), kFrames, kChannels);

    // Compute RMS difference
    double sumSqDiff = 0.0;
    for (size_t i = 0; i < input.size(); ++i) {
        const double diff = static_cast<double>(output[i]) - static_cast<double>(input[i]);
        sumSqDiff += diff * diff;
    }
    const double rmsDiff = std::sqrt(sumSqDiff / static_cast<double>(input.size()));
    std::cout << "    RMS diff: " << rmsDiff << "\n";
    CHECK(rmsDiff < 0.00001);

    return 0;
}

// ── Test 2: EQ chain ─────────────────────────────────────────────────────────
// Enable EQ with a +6 dB boost at 1 kHz, process a 1 kHz sine → output
// RMS should be significantly higher than input RMS.
static int test_eq_chain() {
    std::cout << "  test_eq_chain...\n";

    constexpr int kFrames = 8192;
    constexpr int kChannels = 1;

    ead::DspPipeline pipeline;
    pipeline.prepare(kSampleRate, kFrames, kChannels);

    // Enable EQ with a +6 dB peaking boost at 1 kHz
    pipeline.eq().setEnabled(true);
    pipeline.eq().setBand(5, ead::FilterType::Peaking, 1000.0, 6.0, 1.0, true);

    std::vector<float> input(static_cast<size_t>(kFrames));
    generateSine(input, 1000.0, 0.5);

    std::vector<float> output = input;
    pipeline.processBlock(output.data(), kFrames, kChannels);

    const double rmsIn  = computeRms(input);
    const double rmsOut = computeRms(output);

    std::cout << "    Input RMS: " << rmsIn << "  Output RMS: " << rmsOut << "\n";

    // With +6 dB boost at the tone frequency, output should be significantly louder
    CHECK(rmsOut > rmsIn * 1.5);

    return 0;
}

// ── Test 3: Limiter chain ────────────────────────────────────────────────────
// Process a signal with amplitude 2.0 through the pipeline → output should
// never exceed 1.0 (0 dBFS).
static int test_limiter_chain() {
    std::cout << "  test_limiter_chain...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;

    ead::DspPipeline pipeline;
    pipeline.prepare(kSampleRate, kFrames, kChannels);

    std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));

    // Pre-fill: process several blocks with 2.0 input to settle the limiter
    // envelope past threshold.  Re-fill before each call since processBlock
    // modifies the buffer in-place.
    for (int b = 0; b < 5; ++b) {
        std::fill(buffer.begin(), buffer.end(), 2.0f);
        pipeline.processBlock(buffer.data(), kFrames, kChannels);
    }

    // Final block: fill again and verify limiting
    std::fill(buffer.begin(), buffer.end(), 2.0f);
    pipeline.processBlock(buffer.data(), kFrames, kChannels);

    float maxSample = 0.0f;
    for (size_t i = 0; i < buffer.size(); ++i) {
        const float absVal = std::abs(buffer[i]);
        if (absVal > maxSample)
            maxSample = absVal;
    }

    std::cout << "    Max sample: " << maxSample << " (expected <= 1.0)\n";
    CHECK(maxSample <= 1.0001f);

    // Also verify gain reduction actually happened
    CHECK(maxSample < 1.1f);

    return 0;
}

// ── Test 4: isActive ─────────────────────────────────────────────────────────
// With all processors default, isActive() should return false.
// After enabling a processor, isActive() should return true.
static int test_is_active() {
    std::cout << "  test_is_active...\n";

    ead::DspPipeline pipeline;
    pipeline.prepare(kSampleRate, 512, 2);

    // Default: EQ disabled, Conv has no IR → should be inactive
    CHECK(!pipeline.isActive());

    // Enable EQ → should become active
    pipeline.eq().setEnabled(true);
    CHECK(pipeline.isActive());

    // Disable EQ again → should become inactive (conv still has no IR)
    pipeline.eq().setEnabled(false);
    CHECK(!pipeline.isActive());

    // Enable Conv by loading an IR (impulse = single sample at 1.0)
    const float impulse[1] = {1.0f};
    pipeline.conv().loadIrFromSamples(impulse, 1, 1);
    pipeline.conv().setEnabled(true);
    // Conv isEnabled returns true only when enabled AND IR loaded AND length > 0
    CHECK(pipeline.conv().isEnabled());
    CHECK(pipeline.isActive());

    return 0;
}

// ── Test 5: Reset ────────────────────────────────────────────────────────────
// Process with EQ enabled, reset, then re-process the same input →
// both outputs should be identical (reset cleared all filter state).
static int test_reset() {
    std::cout << "  test_reset...\n";

    constexpr int kFrames = 4096;
    constexpr int kChannels = 1;

    ead::DspPipeline pipeline;
    pipeline.prepare(kSampleRate, kFrames, kChannels);

    // Enable EQ with a moderate boost
    pipeline.eq().setEnabled(true);
    pipeline.eq().setBand(5, ead::FilterType::Peaking, 1000.0, 6.0, 1.0, true);

    std::vector<float> input(static_cast<size_t>(kFrames));
    generateSine(input, 1000.0, 0.5);

    // First pass: process through the chain (filter state builds up)
    std::vector<float> output1 = input;
    pipeline.processBlock(output1.data(), kFrames, kChannels);

    // Reset all processor states
    pipeline.reset();

    // Second pass: process the same input from clean state
    // NOTE: after reset, the pipeline still has the same configuration
    // (EQ enabled, bands set), only the internal filter memories are cleared.
    // Re-process the same input → should produce identical output.
    std::vector<float> output2 = input;
    pipeline.processBlock(output2.data(), kFrames, kChannels);

    // Compare
    double maxDiff = 0.0;
    for (size_t i = 0; i < output1.size(); ++i) {
        const double diff = std::abs(static_cast<double>(output1[i]) - static_cast<double>(output2[i]));
        if (diff > maxDiff)
            maxDiff = diff;
    }

    std::cout << "    Max diff after reset: " << maxDiff << " (expected ~0)\n";
    CHECK(maxDiff < 1.0e-6);

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

int main() {
    std::cout << "=== echo-daemon-dsp-pipeline tests ===\n";

    int failures = 0;
    failures += test_empty_pipeline();
    failures += test_eq_chain();
    failures += test_limiter_chain();
    failures += test_is_active();
    failures += test_reset();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
