#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace echo_audio_daemon {

enum class FilterType {
    Peaking,
    LowPass,
    HighPass,
    LowShelf,
    HighShelf,
    BandPass,
    Notch,
    AllPass
};

// ── BiquadFilter ────────────────────────────────────────────────────────────
// Generic biquad filter using RBJ Audio EQ Cookbook formulas.
// Direct Form I implementation for numerical stability.
// Coefficient calculation in double precision, sample processing in float.
class BiquadFilter {
public:
    BiquadFilter();

    // Set filter parameters. sampleRate must be > 0.
    void setParameters(FilterType type, double frequency, double gainDb, double q, double sampleRate);

    // Process a single sample
    float process(float input);

    // Process a block of interleaved samples
    void processBlock(const float* input, float* output, int frameCount, int channels);

    // Reset filter state (z⁻¹ memories)
    void reset();

    // ── Coefficient accessors ──────────────────────────────────────────────
    double getB0() const { return b0_; }
    double getB1() const { return b1_; }
    double getB2() const { return b2_; }
    double getA0() const { return a0_; }
    double getA1() const { return a1_; }
    double getA2() const { return a2_; }

    // ── Bypass ─────────────────────────────────────────────────────────────
    void setBypassed(bool bypass) { bypassed_ = bypass; }
    bool isBypassed() const { return bypassed_; }

    // ── Coefficient caching ────────────────────────────────────────────────
    bool coefficientsChanged() const { return coefficientsChanged_; }
    void clearCoefficientsChanged() { coefficientsChanged_ = false; }

private:
    // RBJ coefficients (pre-normalization: a0_ holds the divisor)
    double b0_ = 1.0;
    double b1_ = 0.0;
    double b2_ = 0.0;
    double a0_ = 1.0;
    double a1_ = 0.0;
    double a2_ = 0.0;

    // Direct Form I state
    double x1_ = 0.0;
    double x2_ = 0.0;
    double y1_ = 0.0;
    double y2_ = 0.0;

    bool bypassed_ = false;
    bool coefficientsChanged_ = true;

    void calculateCoefficients(FilterType type,
                               double frequency,
                               double gainDb,
                               double q,
                               double sampleRate);
};

} // namespace echo_audio_daemon
