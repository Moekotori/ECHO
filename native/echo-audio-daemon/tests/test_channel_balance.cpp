// ── ChannelBalanceProcessor Unit Tests ──────────────────────────────────────
// Tests: left gain, balance/pan, mono sum mode.
//
// Build target: echo-daemon-channel-balance-tests

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

#include "src/dsp/ChannelBalanceProcessor.h"

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

// Generate a sine tone into a buffer (interleaved stereo).
static void generateSineStereo(std::vector<float>& buffer,
                                double frequency,
                                double amplitude = 1.0) {
    const int total = static_cast<int>(buffer.size());
    for (int i = 0; i < total; i += 2) {
        const double val = amplitude * std::sin(2.0 * kPi * frequency * (i / 2) / kSampleRate);
        buffer[static_cast<size_t>(i)]     = static_cast<float>(val);
        buffer[static_cast<size_t>(i + 1)] = static_cast<float>(val);
    }
}

// Compute RMS over a buffer (stereo interleaved, left channel only if ch=0,
// right channel only if ch=1).
static double computeRmsChannel(const std::vector<float>& data, int ch, int channels) {
    double sumSq = 0.0;
    size_t count = 0;
    for (size_t i = static_cast<size_t>(ch); i < data.size(); i += static_cast<size_t>(channels)) {
        sumSq += static_cast<double>(data[i]) * static_cast<double>(data[i]);
        ++count;
    }
    return (count > 0) ? std::sqrt(sumSq / static_cast<double>(count)) : 0.0;
}

// ── Test 1: Left channel gain ───────────────────────────────────────────────
// L = 0.5 (-6 dB), R = 1.0 (0 dB) → left output should be half amplitude
// of right output when both receive the same signal.
static int test_left_gain() {
    std::cout << "  test_left_gain...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;
    std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));

    generateSineStereo(buffer, 440.0, 0.5);

    ead::ChannelBalanceProcessor proc;
    proc.setChannelGain(0, -6.0);  // -6 dB ≈ 0.5× amplitude
    proc.setChannelGain(1, 0.0);   // 0 dB = unity

    proc.processBlock(buffer.data(), kFrames, kChannels);

    const double leftRms  = computeRmsChannel(buffer, 0, kChannels);
    const double rightRms = computeRmsChannel(buffer, 1, kChannels);

    // Left should be about half of right (ratio ≈ 0.5)
    // Allow some tolerance for floating-point
    std::cerr << "    leftRms=" << leftRms << " rightRms=" << rightRms
              << " ratio=" << (rightRms > 0.0 ? leftRms / rightRms : -1.0) << "\n";

    CHECK(rightRms > 0.0);
    const double ratio = leftRms / rightRms;
    CHECK(ratio > 0.35 && ratio < 0.65);  // expect ~0.5

    return 0;
}

// ── Test 2: Balance / pan ───────────────────────────────────────────────────
// pan=-1.0 → only left channel output, pan=+1.0 → only right channel output.
static int test_balance_pan() {
    std::cout << "  test_balance_pan...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;

    // ── pan = -1.0 (full left) ─────────────────────────────────────────
    {
        std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));
        generateSineStereo(buffer, 440.0, 0.5);

        ead::ChannelBalanceProcessor proc;
        proc.setBalance(-1.0);
        proc.processBlock(buffer.data(), kFrames, kChannels);

        const double leftRms  = computeRmsChannel(buffer, 0, kChannels);
        const double rightRms = computeRmsChannel(buffer, 1, kChannels);

        std::cerr << "    pan=-1 leftRms=" << leftRms << " rightRms=" << rightRms << "\n";
        CHECK(leftRms > 0.0);
        CHECK(rightRms < 0.001);  // right should be nearly silent
    }

    // ── pan = +1.0 (full right) ────────────────────────────────────────
    {
        std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));
        generateSineStereo(buffer, 440.0, 0.5);

        ead::ChannelBalanceProcessor proc;
        proc.setBalance(1.0);
        proc.processBlock(buffer.data(), kFrames, kChannels);

        const double leftRms  = computeRmsChannel(buffer, 0, kChannels);
        const double rightRms = computeRmsChannel(buffer, 1, kChannels);

        std::cerr << "    pan=+1 leftRms=" << leftRms << " rightRms=" << rightRms << "\n";
        CHECK(rightRms > 0.0);
        CHECK(leftRms < 0.001);  // left should be nearly silent
    }

    return 0;
}

// ── Test 3: Mono Sum mode ───────────────────────────────────────────────────
// Mono mode Sum → both channels identical and equal to (L + R) / 2.
static int test_mono_sum() {
    std::cout << "  test_mono_sum...\n";

    constexpr int kFrames = 2048;
    constexpr int kChannels = 2;
    std::vector<float> buffer(static_cast<size_t>(kFrames * kChannels));

    // Fill with different L/R content: L=440Hz, R=880Hz
    for (int i = 0; i < kFrames; ++i) {
        const double t = static_cast<double>(i) / kSampleRate;
        buffer[static_cast<size_t>(i * 2)]     = static_cast<float>(std::sin(2.0 * kPi * 440.0 * t));
        buffer[static_cast<size_t>(i * 2 + 1)] = static_cast<float>(std::sin(2.0 * kPi * 880.0 * t));
    }

    ead::ChannelBalanceProcessor proc;
    proc.setMonoMode(ead::ChannelBalanceMonoMode::Sum);
    proc.processBlock(buffer.data(), kFrames, kChannels);

    // Both channels should be identical
    double maxDiff = 0.0;
    for (int i = 0; i < kFrames; ++i) {
        const double l = buffer[static_cast<size_t>(i * 2)];
        const double r = buffer[static_cast<size_t>(i * 2 + 1)];
        const double diff = std::abs(l - r);
        if (diff > maxDiff)
            maxDiff = diff;
    }

    std::cerr << "    maxDiff=" << maxDiff << "\n";
    CHECK(maxDiff < 0.001);  // channels must be identical

    // Also verify it's truly the sum
    // With L=sin(440) and R=sin(880), the output should be (sin440 + sin880)/2
    // Re-generate and compare
    std::vector<float> ref(static_cast<size_t>(kFrames * kChannels));
    for (int i = 0; i < kFrames; ++i) {
        const double t = static_cast<double>(i) / kSampleRate;
        const double expected = 0.5 * (std::sin(2.0 * kPi * 440.0 * t) + std::sin(2.0 * kPi * 880.0 * t));
        ref[static_cast<size_t>(i * 2)]     = static_cast<float>(expected);
        ref[static_cast<size_t>(i * 2 + 1)] = static_cast<float>(expected);
    }

    double maxDiffRef = 0.0;
    for (size_t i = 0; i < buffer.size(); ++i) {
        const double diff = std::abs(static_cast<double>(buffer[i]) - static_cast<double>(ref[i]));
        if (diff > maxDiffRef)
            maxDiffRef = diff;
    }

    std::cerr << "    maxDiffRef=" << maxDiffRef << "\n";
    CHECK(maxDiffRef < 0.001);  // must match (L+R)/2

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

int main() {
    int failures = 0;

    std::cout << "test_left_gain...\n";
    failures += test_left_gain();

    std::cout << "test_balance_pan...\n";
    failures += test_balance_pan();

    std::cout << "test_mono_sum...\n";
    failures += test_mono_sum();

    if (failures == 0) {
        std::cout << "All tests PASSED.\n";
    } else {
        std::cerr << failures << " test(s) FAILED.\n";
    }
    return failures;
}
