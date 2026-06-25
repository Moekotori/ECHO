// ── EqProcessor Unit Tests ──────────────────────────────────────────────────
// Tests: flat response, single-band boost, preamp, enable/disable, stability.
//
// Build target: echo-daemon-eq-tests

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

#include "src/dsp/EqProcessor.h"

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

// Generate sine tone
static void generateSine(std::vector<float>& buffer,
                          double frequency,
                          double amplitude = 1.0) {
    for (size_t i = 0; i < buffer.size(); ++i) {
        buffer[i] = static_cast<float>(
            amplitude * std::sin(2.0 * kPi * frequency * static_cast<double>(i) / kSampleRate));
    }
}

// Compute RMS over a buffer
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

// ── Test 1: Flat response ───────────────────────────────────────────────────
// All bands at 0 dB, process 1000 samples — output should match input.
static int test_flat_response() {
    std::cout << "  test_flat_response...\n";

    constexpr int kFrames = 1000;
    constexpr int kChannels = 2;

    ead::EqProcessor eq;
    eq.prepare(kSampleRate, kFrames, kChannels);
    eq.setEnabled(true);

    // All bands default to 0 dB peaking, which with 0 dB gain should be transparent
    // We'll explicitly set them flat
    for (int b = 0; b < ead::EqProcessor::kMaxBands; ++b) {
        eq.setBand(b, ead::FilterType::Peaking, 1000.0, 0.0, 1.0, true);
    }

    std::vector<float> input(kFrames * kChannels);
    generateSine(input, 440.0, 0.5);

    std::vector<float> output = input;
    eq.processBlock(output.data(), kFrames, kChannels);

    double sumSqDiff = 0.0;
    for (size_t i = 0; i < input.size(); ++i) {
        const double diff = static_cast<double>(output[i]) - static_cast<double>(input[i]);
        sumSqDiff += diff * diff;
    }
    const double rmsDiff = std::sqrt(sumSqDiff / static_cast<double>(input.size()));
    std::cout << "    Flat RMS diff: " << rmsDiff << "\n";

    CHECK(rmsDiff < 0.0001);

    return 0;
}

// ── Test 2: Single band boost ──────────────────────────────────────────────
// Boost band at 1 kHz, +6 dB, process 1 kHz tone — level should increase.
static int test_single_band_boost() {
    std::cout << "  test_single_band_boost...\n";

    constexpr int kFrames = 8192;
    constexpr int kChannels = 1;

    ead::EqProcessor eq;
    eq.prepare(kSampleRate, kFrames, kChannels);

    // Start with flat EQ
    for (int b = 0; b < ead::EqProcessor::kMaxBands; ++b) {
        eq.setBand(b, ead::FilterType::Peaking, 1000.0, 0.0, 1.0, true);
    }

    // Boost band 5 (1 kHz default) by +6 dB
    eq.setBand(5, ead::FilterType::Peaking, 1000.0, 6.0, 1.0, true);
    eq.setEnabled(true);

    std::vector<float> input(kFrames);
    generateSine(input, 1000.0, 0.5);

    std::vector<float> output = input;
    eq.processBlock(output.data(), kFrames, kChannels);

    const double rmsIn  = computeRms(input);
    const double rmsOut = computeRms(output);

    std::cout << "    Input RMS: " << rmsIn << "  Output RMS: " << rmsOut << "\n";
    CHECK(rmsOut > rmsIn * 1.5);  // output should be noticeably louder

    return 0;
}

// ── Test 3: Preamp ──────────────────────────────────────────────────────────
static int test_preamp() {
    std::cout << "  test_preamp...\n";

    constexpr int kFrames = 4096;
    constexpr int kChannels = 2;

    ead::EqProcessor eq;
    eq.prepare(kSampleRate, kFrames, kChannels);
    eq.setEnabled(true);
    eq.setPreamp(3.0);  // +3 dB

    std::vector<float> input(kFrames * kChannels);
    generateSine(input, 440.0, 0.5);

    std::vector<float> output = input;
    eq.processBlock(output.data(), kFrames, kChannels);

    const double rmsIn  = computeRms(input);
    const double rmsOut = computeRms(output);
    const double gainDb = 20.0 * std::log10(rmsOut / rmsIn);

    std::cout << "    Preamp gain: " << gainDb << " dB (expected ~+3 dB)\n";
    CHECK(std::abs(gainDb - 3.0) < 0.5);

    return 0;
}

// ── Test 4: Enable / Disable ────────────────────────────────────────────────
static int test_enable_disable() {
    std::cout << "  test_enable_disable...\n";

    constexpr int kFrames = 4096;
    constexpr int kChannels = 1;

    ead::EqProcessor eq;
    eq.prepare(kSampleRate, kFrames, kChannels);

    // Set a strong boost
    eq.setBand(5, ead::FilterType::Peaking, 1000.0, 12.0, 1.0, true);

    std::vector<float> input(kFrames);
    generateSine(input, 1000.0, 0.5);

    // Process with EQ disabled
    eq.setEnabled(false);
    std::vector<float> disabledOutput = input;
    eq.processBlock(disabledOutput.data(), kFrames, kChannels);

    // Process with EQ enabled
    eq.reset();
    eq.setEnabled(true);
    std::vector<float> enabledOutput = input;
    eq.processBlock(enabledOutput.data(), kFrames, kChannels);

    const double disabledRms = computeRms(disabledOutput);
    const double enabledRms  = computeRms(enabledOutput);

    std::cout << "    Disabled RMS: " << disabledRms << "  Enabled RMS: " << enabledRms << "\n";

    // Disabled should be close to input, enabled should be amplified
    const double inRms = computeRms(input);
    CHECK(std::abs(disabledRms - inRms) < 0.001);
    CHECK(enabledRms > disabledRms * 2.0);

    return 0;
}

// ── Test 5: All 10 bands configured, stability ─────────────────────────────
static int test_all_bands() {
    std::cout << "  test_all_bands...\n";

    constexpr int kFrames = 16384;
    constexpr int kChannels = 2;

    ead::EqProcessor eq;
    eq.prepare(kSampleRate, kFrames, kChannels);

    // Configure all 10 bands with different settings
    const double freqs[10] = {31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    const ead::FilterType types[10] = {
        ead::FilterType::LowShelf,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::Peaking,
        ead::FilterType::HighShelf,
        ead::FilterType::Notch,
    };
    const double gains[10]  = {-3.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.0};
    const double qs[10]     = {0.707, 1.0, 1.0, 1.5, 1.5, 1.0, 1.0, 1.0, 0.707, 10.0};
    const bool enabled[10]  = {true, true, true, true, true, true, true, true, true, true};

    for (int b = 0; b < 10; ++b) {
        eq.setBand(b, types[b], freqs[b], gains[b], qs[b], enabled[b]);
    }

    eq.setEnabled(true);

    // Process white noise through all bands (stability test)
    std::vector<float> buffer(kFrames * kChannels);
    for (auto& s : buffer)
        s = static_cast<float>(rand()) / static_cast<float>(RAND_MAX) * 2.0f - 1.0f;

    eq.processBlock(buffer.data(), kFrames, kChannels);

    // Check no NaN / inf
    for (const auto& s : buffer) {
        if (!std::isfinite(s)) {
            std::cerr << "    Non-finite sample detected!\n";
            return 1;
        }
    }

    // Verify processing changed the signal
    double sumAbs = 0.0;
    for (const auto& s : buffer)
        sumAbs += std::abs(static_cast<double>(s));
    const double avgLevel = sumAbs / static_cast<double>(buffer.size());

    std::cout << "    Avg level after processing: " << avgLevel << " (expected > 0)\n";
    CHECK(avgLevel > 0.001);

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-eq tests ===\n";

    int failures = 0;
    failures += test_flat_response();
    failures += test_single_band_boost();
    failures += test_preamp();
    failures += test_enable_disable();
    failures += test_all_bands();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
