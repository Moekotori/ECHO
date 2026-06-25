#pragma once

#include <cmath>

namespace echo_audio_daemon {

// ── Limiter ──────────────────────────────────────────────────────────────────
// Peak limiter at 0 dBFS (threshold = 1.0) with ~1 ms attack and ~50 ms release.
// Pure C++, no JUCE. Interleaved float processing.
class Limiter {
public:
    Limiter();

    // Enable / disable limiting. When disabled, audio passes through unchanged.
    void setEnabled(bool enabled);

    // Process an interleaved float block in-place. Applies gain reduction to
    // prevent samples from exceeding 0 dBFS.
    void processBlock(float* samples, int frameCount, int channels);

    // Returns true when gain reduction is active (envelope < 0.999).
    bool isProtecting() const;

    // Returns true when any sample in the last processed block approached
    // the threshold (abs(sample) > 0.95).
    bool hasClippingRisk() const;

    // Reset envelope state.
    void reset();

    // ── State queries ────────────────────────────────────────────────────────
    bool isEnabled() const { return enabled_; }

private:
    // ── Constants ────────────────────────────────────────────────────────────
    static constexpr double kThreshold = 1.0;          // 0 dBFS
    static constexpr double kAttackMs = 1.0;           // ~1 ms
    static constexpr double kReleaseMs = 50.0;         // ~50 ms
    static constexpr double kClippingRiskLevel = 0.95; // -0.45 dBFS
    static constexpr double kDefaultSampleRate = 44100.0;

    // ── Helpers ──────────────────────────────────────────────────────────────
    void updateCoeffs();

    // ── State ────────────────────────────────────────────────────────────────
    bool enabled_ = true;
    double envelope_ = 0.0;       // Current gain reduction envelope [0..1]
    double sampleRate_ = kDefaultSampleRate;
    bool protecting_ = false;
    bool clippingRisk_ = false;

    // Attack/release time constants (computed from sample rate)
    double attackCoeff_ = 0.0;
    double releaseCoeff_ = 0.0;
};

} // namespace echo_audio_daemon
