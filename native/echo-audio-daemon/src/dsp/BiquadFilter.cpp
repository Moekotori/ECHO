#include "src/dsp/BiquadFilter.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace echo_audio_daemon {

// ── Helpers ─────────────────────────────────────────────────────────────────
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kMinQ = 0.1;
constexpr double kMinFrequency = 1.0;
constexpr double kMaxNyquistRatio = 0.47;  // slightly below Nyquist for safety
constexpr double kEpsilonA0 = 1.0e-12;

// Clamp frequency to safe range relative to sample rate.
inline double clampFrequency(double freq, double sampleRate) {
    return std::max(kMinFrequency, std::min(freq, sampleRate * kMaxNyquistRatio));
}

// Clamp Q to a positive safe minimum.
inline double clampQ(double q) {
    return std::max(kMinQ, q);
}

// Convert dB to linear gain: A = 10^(gain / 40)  [for shelving/peaking amplitude]
inline double dbToA(double gainDb) {
    return std::pow(10.0, gainDb / 40.0);
}

} // anonymous namespace

// ── Constructor ─────────────────────────────────────────────────────────────

BiquadFilter::BiquadFilter() {
    reset();
}

// ── Public API ──────────────────────────────────────────────────────────────

void BiquadFilter::setParameters(FilterType type,
                                  double frequency,
                                  double gainDb,
                                  double q,
                                  double sampleRate) {
    calculateCoefficients(type, frequency, gainDb, q, sampleRate);
    coefficientsChanged_ = true;
}

float BiquadFilter::process(float input) {
    if (bypassed_)
        return input;

    // Normalise coefficients: divide everything by a0
    const double invA0 = 1.0 / a0_;
    const double b0n = b0_ * invA0;
    const double b1n = b1_ * invA0;
    const double b2n = b2_ * invA0;
    const double a1n = a1_ * invA0;
    const double a2n = a2_ * invA0;

    // Direct Form I
    const double xn = static_cast<double>(input);
    const double yn = b0n * xn + b1n * x1_ + b2n * x2_
                      - a1n * y1_ - a2n * y2_;

    // Update state
    x2_ = x1_;
    x1_ = xn;
    y2_ = y1_;
    y1_ = std::isfinite(yn) ? yn : 0.0;

    return static_cast<float>(y1_);
}

void BiquadFilter::processBlock(const float* input,
                                 float* output,
                                 int frameCount,
                                 int channels) {
    if (!input || !output || frameCount <= 0 || channels <= 0)
        return;

    if (bypassed_) {
        if (output != input)
            std::memcpy(output, input, static_cast<size_t>(frameCount) * static_cast<size_t>(channels) * sizeof(float));
        return;
    }

    // Pre-compute normalised coefficients for the whole block
    const double invA0 = 1.0 / a0_;
    const double b0n = b0_ * invA0;
    const double b1n = b1_ * invA0;
    const double b2n = b2_ * invA0;
    const double a1n = a1_ * invA0;
    const double a2n = a2_ * invA0;

    // Process per-channel (interleaved block)
    for (int ch = 0; ch < channels; ++ch) {
        // Load per-channel state (all channels share one set of filter state per BiquadFilter
        // instance for linear-phase behaviour; if per-channel processing is desired,
        // use one BiquadFilter per channel.  Here we use a single shared state.)
        double lx1 = x1_, lx2 = x2_;
        double ly1 = y1_, ly2 = y2_;

        const int stride = channels;
        int idx = ch;

        for (int frame = 0; frame < frameCount; ++frame) {
            const double xn = static_cast<double>(input[idx]);
            const double yn = b0n * xn + b1n * lx1 + b2n * lx2
                              - a1n * ly1 - a2n * ly2;
            lx2 = lx1;
            lx1 = xn;
            ly2 = ly1;
            ly1 = std::isfinite(yn) ? yn : 0.0;

            output[idx] = static_cast<float>(ly1);
            idx += stride;
        }

        // Write back state (last channel's state is stored; for true per-channel
        // operation the user should instantiate one BiquadFilter per channel)
        x1_ = lx1;
        x2_ = lx2;
        y1_ = ly1;
        y2_ = ly2;
    }
}

void BiquadFilter::reset() {
    x1_ = 0.0;
    x2_ = 0.0;
    y1_ = 0.0;
    y2_ = 0.0;
}

// ── Coefficient Calculation (RBJ Cookbook) ──────────────────────────────────

void BiquadFilter::calculateCoefficients(FilterType type,
                                          double frequency,
                                          double gainDb,
                                          double q,
                                          double sampleRate) {
    // Safety defaults
    if (sampleRate <= 0.0) {
        b0_ = 1.0; b1_ = 0.0; b2_ = 0.0;
        a0_ = 1.0; a1_ = 0.0; a2_ = 0.0;
        return;
    }

    const double freq = clampFrequency(frequency, sampleRate);
    const double qq   = clampQ(q);

    const double w0      = 2.0 * kPi * freq / sampleRate;
    const double cosW0   = std::cos(w0);
    const double sinW0   = std::sin(w0);
    const double alpha   = sinW0 / (2.0 * qq);

    double b0, b1, b2, a0, a1, a2;

    switch (type) {
        case FilterType::Peaking: {
            const double A = dbToA(gainDb);
            b0 = 1.0 + alpha * A;
            b1 = -2.0 * cosW0;
            b2 = 1.0 - alpha * A;
            a0 = 1.0 + alpha / A;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha / A;
            break;
        }

        case FilterType::LowPass: {
            const double cosW0_1 = 1.0 - cosW0;
            b0 = cosW0_1 / 2.0;
            b1 = cosW0_1;
            b2 = cosW0_1 / 2.0;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha;
            break;
        }

        case FilterType::HighPass: {
            const double cosW0_1 = 1.0 + cosW0;
            b0 = cosW0_1 / 2.0;
            b1 = -cosW0_1;
            b2 = cosW0_1 / 2.0;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha;
            break;
        }

        case FilterType::LowShelf: {
            const double A = dbToA(gainDb);
            const double sqrtA = std::sqrt(A);
            // For shelf filters, Q acts as "slope" parameter: S = 1 -> Q = 1/sqrt(2)
            const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;
            b0 = A * ((A + 1.0) - (A - 1.0) * cosW0 + twoSqrtAAlpha);
            b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosW0);
            b2 = A * ((A + 1.0) - (A - 1.0) * cosW0 - twoSqrtAAlpha);
            a0 = (A + 1.0) + (A - 1.0) * cosW0 + twoSqrtAAlpha;
            a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosW0);
            a2 = (A + 1.0) + (A - 1.0) * cosW0 - twoSqrtAAlpha;
            break;
        }

        case FilterType::HighShelf: {
            const double A = dbToA(gainDb);
            const double sqrtA = std::sqrt(A);
            const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;
            b0 = A * ((A + 1.0) + (A - 1.0) * cosW0 + twoSqrtAAlpha);
            b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosW0);
            b2 = A * ((A + 1.0) + (A - 1.0) * cosW0 - twoSqrtAAlpha);
            a0 = (A + 1.0) - (A - 1.0) * cosW0 + twoSqrtAAlpha;
            a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosW0);
            a2 = (A + 1.0) - (A - 1.0) * cosW0 - twoSqrtAAlpha;
            break;
        }

        case FilterType::BandPass: {
            // 0 dB peak gain variant
            b0 = alpha;
            b1 = 0.0;
            b2 = -alpha;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha;
            break;
        }

        case FilterType::Notch: {
            b0 = 1.0;
            b1 = -2.0 * cosW0;
            b2 = 1.0;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha;
            break;
        }

        case FilterType::AllPass: {
            b0 = 1.0 - alpha;
            b1 = -2.0 * cosW0;
            b2 = 1.0 + alpha;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cosW0;
            a2 = 1.0 - alpha;
            break;
        }

        default:
            // Fallback: identity
            b0 = 1.0; b1 = 0.0; b2 = 0.0;
            a0 = 1.0; a1 = 0.0; a2 = 0.0;
            break;
    }

    // Protect against division by zero
    if (std::abs(a0) < kEpsilonA0) {
        b0_ = 1.0; b1_ = 0.0; b2_ = 0.0;
        a0_ = 1.0; a1_ = 0.0; a2_ = 0.0;
        return;
    }

    b0_ = b0;
    b1_ = b1;
    b2_ = b2;
    a0_ = a0;
    a1_ = a1;
    a2_ = a2;
}

} // namespace echo_audio_daemon
