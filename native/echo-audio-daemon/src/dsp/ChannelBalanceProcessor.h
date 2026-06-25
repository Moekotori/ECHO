#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace echo_audio_daemon {

// ── Mono Mode ────────────────────────────────────────────────────────────────
enum class ChannelBalanceMonoMode {
    Off = 0,   // Normal stereo
    Sum = 1,   // (L + R) / 2 to both channels
    Left = 2,  // Left only (right silent)
    Right = 3  // Right only (left silent)
};

// ── ChannelBalanceProcessor ──────────────────────────────────────────────────
// Per-channel gain, delay, balance, mono modes, phase invert, and channel swap.
// Pure C++, no JUCE. Interleaved float processing.
class ChannelBalanceProcessor {
public:
    ChannelBalanceProcessor();

    // ── Parameter setters ────────────────────────────────────────────────────

    // Set independent gain for a channel (0 = left, 1 = right). Range: -60..+24 dB.
    void setChannelGain(int channel, double gainDb);

    // Set delay for a channel in milliseconds (0..100 ms). sampleRate is cached for
    // converting ms to samples in the delay line.
    void setChannelDelay(int channel, double delayMs, double sampleRate);

    // Set stereo balance / pan. -1.0 = full left, 0.0 = center, +1.0 = full right.
    void setBalance(double pan);

    // Set mono mode.
    void setMonoMode(ChannelBalanceMonoMode mode);

    // Phase-invert a channel.
    void setPhaseInvert(int channel, bool invert);

    // Swap left and right channels before further processing.
    void setSwapChannels(bool swap);

    // ── Processing ───────────────────────────────────────────────────────────

    // Process an interleaved float block in-place.
    void processBlock(float* samples, int frameCount, int channels);

    // Clear delay lines and reset state.
    void reset();

private:
    // ── Constants ────────────────────────────────────────────────────────────
    static constexpr double kMaxDelayMs = 100.0;
    static constexpr double kDefaultSampleRate = 44100.0;
    static constexpr double kMinGainDb = -60.0;
    static constexpr double kMaxGainDb = 24.0;

    // ── Helpers ──────────────────────────────────────────────────────────────
    static double dbToGain(double db);
    static int wrapIndex(int index, int length);
    float readDelaySample(int channel, double delayMs, int bufLen) const;
    void pushDelaySample(int channel, float sample, int bufLen);

    // ── Parameters (directly settable) ───────────────────────────────────────
    double sampleRate_ = kDefaultSampleRate;
    int delayLen_ = 1;

    double leftGainDb_ = 0.0;
    double rightGainDb_ = 0.0;
    double leftDelayMs_ = 0.0;
    double rightDelayMs_ = 0.0;
    double balance_ = 0.0;
    ChannelBalanceMonoMode monoMode_ = ChannelBalanceMonoMode::Off;
    bool invertLeft_ = false;
    bool invertRight_ = false;
    bool swapChannels_ = false;

    // ── Delay line state ─────────────────────────────────────────────────────
    // Fixed-size circular buffer per channel (indexed by writeIndex_)
    std::vector<float> delayBuf_[2];
    int writeIndex_ = 0;
};

} // namespace echo_audio_daemon
