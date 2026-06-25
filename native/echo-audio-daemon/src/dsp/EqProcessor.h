#pragma once

#include "src/dsp/BiquadFilter.h"

#include <array>

namespace echo_audio_daemon {

// ── EqProcessor ─────────────────────────────────────────────────────────────
// 10-band parametric equalizer.  Each band is an independent BiquadFilter.
// No JUCE dependencies — pure C++ DSP.
class EqProcessor {
public:
    EqProcessor();

    // Prepare processor with sample rate, block size, and channel count.
    void prepare(double sampleRate, int blockSize, int channels);

    // Set a band's parameters.
    void setBand(int bandIndex,
                 FilterType type,
                 double frequency,
                 double gainDb,
                 double q,
                 bool enabled);

    // Set band gain (for real-time slider changes).  Fast path.
    void setBandGain(int bandIndex, double gainDb);

    // Set preamp gain (dB).
    void setPreamp(double preampDb);

    // Enable / disable the entire EQ.
    void setEnabled(bool enabled);

    // Process an interleaved audio block in-place.
    void processBlock(float* samples, int frameCount, int channels);

    // Reset all filter states.
    void reset();

    // ── State queries ──────────────────────────────────────────────────────
    bool isEnabled() const { return enabled_; }
    double getPreamp() const { return preampDb_; }

    static constexpr int kMaxBands = 10;

private:
    std::array<BiquadFilter, kMaxBands> bands_;
    std::array<bool, kMaxBands> bandEnabled_{};
    bool enabled_ = false;
    double preampDb_ = 0.0;
    double sampleRate_ = 0.0;
    int blockSize_ = 0;
    int channels_ = 0;

    // Pre-allocated working buffer for per-channel deinterleaving if needed
    // (single sample buffer — processBlock handles in-place interleaved directly)
};

} // namespace echo_audio_daemon
