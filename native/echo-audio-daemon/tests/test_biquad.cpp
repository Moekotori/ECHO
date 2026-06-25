// ── BiquadFilter Unit Tests ─────────────────────────────────────────────────
// Tests: frequency response accuracy, stability under long runs, bypass, reset.
//
// Build target: echo-daemon-biquad-tests

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

#include "src/dsp/BiquadFilter.h"

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

// Generate a sine tone into a buffer
static void generateSine(std::vector<float>& buffer,
                          double frequency,
                          double sampleRate,
                          double amplitude = 1.0) {
    for (size_t i = 0; i < buffer.size(); ++i) {
        buffer[i] = static_cast<float>(
            amplitude * std::sin(2.0 * kPi * frequency * static_cast<double>(i) / sampleRate));
    }
}

// Compute RMS over the second half of a buffer (skip transient)
static double computeRms(const std::vector<float>& data, double skipRatio = 0.5) {
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

// Convert RMS ratio to dB
static double rmsDb(double rmsIn, double rmsOut) {
    if (rmsIn < 1e-15 || rmsOut < 1e-15)
        return 0.0;
    return 20.0 * std::log10(rmsOut / rmsIn);
}

// ── Test 1: Peaking boost accuracy ──────────────────────────────────────────
static int test_peaking_boost() {
    std::cout << "  test_peaking_boost...\n";

    constexpr int kFrames = 8192;
    std::vector<float> input(kFrames);
    std::vector<float> output(kFrames);

    // Generate 1 kHz sine
    generateSine(input, 1000.0, kSampleRate, 0.5);

    ead::BiquadFilter filter;
    filter.setParameters(ead::FilterType::Peaking, 1000.0, 6.0, 1.0, kSampleRate);

    for (int i = 0; i < kFrames; ++i)
        output[i] = filter.process(input[i]);

    const double rmsIn  = computeRms(input);
    const double rmsOut = computeRms(output);
    const double gain   = rmsDb(rmsIn, rmsOut);

    std::cout << "    Measured gain: " << gain << " dB (expected ~+6 dB)\n";

    // Peaking at centre frequency should be within ±0.5 dB of target
    CHECK(std::abs(gain - 6.0) < 0.5);

    return 0;
}

// ── Test 2: Low-shelf cut ────────────────────────────────────────────────────
static int test_lowshelf_cut() {
    std::cout << "  test_lowshelf_cut...\n";

    constexpr int kFrames = 8192;
    std::vector<float> lowInput(kFrames);
    std::vector<float> lowOutput(kFrames);
    std::vector<float> highInput(kFrames);

    // 50 Hz tone (should be cut by low-shelf at 200 Hz, -3 dB)
    generateSine(lowInput, 50.0, kSampleRate, 0.5);
    // 1 kHz tone (should be less affected)
    generateSine(highInput, 1000.0, kSampleRate, 0.5);

    ead::BiquadFilter filter;
    filter.setParameters(ead::FilterType::LowShelf, 200.0, -3.0, 0.707, kSampleRate);

    for (int i = 0; i < kFrames; ++i)
        lowOutput[i] = filter.process(lowInput[i]);

    // Re-process a fresh filter with high frequency
    filter.reset();
    std::vector<float> highOutput(kFrames);
    for (int i = 0; i < kFrames; ++i)
        highOutput[i] = filter.process(highInput[i]);

    const double lowRmsOut  = computeRms(lowOutput);
    const double highRmsOut = computeRms(highOutput);
    const double ratioDb    = 20.0 * std::log10(lowRmsOut / highRmsOut);

    std::cout << "    50 Hz RMS: " << lowRmsOut << "  1 kHz RMS: " << highRmsOut
              << "   ratio: " << ratioDb << " dB\n";

    // After a -3 dB low-shelf at 200 Hz, 50 Hz should be attenuated more than 1 kHz.
    // The ratio should be negative (50 Hz < 1 kHz).
    CHECK(ratioDb < -0.5);

    return 0;
}

// ── Test 3: Long-run stability ──────────────────────────────────────────────
static int test_stability() {
    std::cout << "  test_stability...\n";

    constexpr int kNumSamples = 1'000'000;
    constexpr int kNumTypes = 7;

    const ead::FilterType types[kNumTypes] = {
        ead::FilterType::Peaking,
        ead::FilterType::LowPass,
        ead::FilterType::HighPass,
        ead::FilterType::LowShelf,
        ead::FilterType::HighShelf,
        ead::FilterType::BandPass,
        ead::FilterType::Notch,
    };

    double frequencies[kNumTypes]  = {1000.0, 1000.0, 1000.0, 200.0, 2000.0, 1000.0, 1000.0};
    double gains[kNumTypes]        = {6.0,    0.0,    0.0,    -3.0,   3.0,    0.0,    0.0};
    double qValues[kNumTypes]      = {1.0,    0.707,  0.707,  0.707,  0.707,  1.0,    10.0};

    for (int t = 0; t < kNumTypes; ++t) {
        ead::BiquadFilter filter;
        filter.setParameters(types[t], frequencies[t], gains[t], qValues[t], kSampleRate);

        // Alternating input (+1, -1) to stress the filter
        float input = 1.0f;
        for (int i = 0; i < kNumSamples; ++i) {
            const float output = filter.process(input);
            CHECK(std::isfinite(output));
            input = -input;  // toggle polarity each sample
        }
    }

    return 0;
}

// ── Test 4: Bypass ──────────────────────────────────────────────────────────
static int test_bypass() {
    std::cout << "  test_bypass...\n";

    constexpr int kFrames = 4096;
    std::vector<float> input(kFrames);
    generateSine(input, 440.0, kSampleRate, 0.5);

    ead::BiquadFilter filter;
    filter.setParameters(ead::FilterType::Peaking, 1000.0, 12.0, 1.0, kSampleRate);
    filter.setBypassed(true);

    double sumSqDiff = 0.0;
    for (int i = 0; i < kFrames; ++i) {
        const float out = filter.process(input[i]);
        const double diff = static_cast<double>(out) - static_cast<double>(input[i]);
        sumSqDiff += diff * diff;
    }

    const double rmsDiff = std::sqrt(sumSqDiff / static_cast<double>(kFrames));
    std::cout << "    Bypass RMS diff: " << rmsDiff << "\n";

    CHECK(rmsDiff < 0.0001);

    return 0;
}

// ── Test 5: Reset ───────────────────────────────────────────────────────────
static int test_reset() {
    std::cout << "  test_reset...\n";

    constexpr int kFrames = 2048;

    ead::BiquadFilter filter;
    filter.setParameters(ead::FilterType::Peaking, 1000.0, 6.0, 1.0, kSampleRate);

    // Generate a known input
    std::vector<float> input(kFrames);
    generateSine(input, 500.0, kSampleRate, 0.5);

    // Find output after processing
    std::vector<float> output1(kFrames);
    for (int i = 0; i < kFrames; ++i)
        output1[i] = filter.process(input[i]);

    // Reset and re-process the same input
    filter.reset();
    std::vector<float> output2(kFrames);
    for (int i = 0; i < kFrames; ++i)
        output2[i] = filter.process(input[i]);

    // The two outputs should be identical
    for (int i = 0; i < kFrames; ++i) {
        const double diff = std::abs(static_cast<double>(output1[i]) - static_cast<double>(output2[i]));
        CHECK(diff < 1.0e-6);
    }

    return 0;
}

// ── Test 6: AllPass preserves magnitude ────────────────────────────────────
static int test_allpass_magnitude() {
    std::cout << "  test_allpass_magnitude...\n";

    constexpr int kFrames = 8192;
    std::vector<float> input(kFrames);
    generateSine(input, 1000.0, kSampleRate, 0.5);

    ead::BiquadFilter filter;
    filter.setParameters(ead::FilterType::AllPass, 1000.0, 0.0, 1.0, kSampleRate);

    std::vector<float> output(kFrames);
    for (int i = 0; i < kFrames; ++i)
        output[i] = filter.process(input[i]);

    const double rmsIn  = computeRms(input);
    const double rmsOut = computeRms(output);
    const double gain   = rmsDb(rmsIn, rmsOut);

    std::cout << "    AllPass gain: " << gain << " dB (expected ~0 dB)\n";
    CHECK(std::abs(gain) < 0.1);

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-biquad tests ===\n";

    int failures = 0;
    failures += test_peaking_boost();
    failures += test_lowshelf_cut();
    failures += test_stability();
    failures += test_bypass();
    failures += test_reset();
    failures += test_allpass_magnitude();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
