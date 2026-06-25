#include "src/dsp/Limiter.h"

#include <algorithm>
#include <cmath>

namespace echo_audio_daemon {

// ── Constructor ──────────────────────────────────────────────────────────────

Limiter::Limiter() {
    reset();
    updateCoeffs();
}

// ── Public API ───────────────────────────────────────────────────────────────

void Limiter::setEnabled(bool enabled) {
    enabled_ = enabled;
    if (!enabled_) {
        envelope_ = 0.0;
        protecting_ = false;
        clippingRisk_ = false;
    }
}

void Limiter::processBlock(float* samples, int frameCount, int channels) {
    if (!samples || frameCount <= 0 || channels <= 0)
        return;

    const int totalSamples = frameCount * channels;
    bool anyClippingRisk = false;
    bool anyProtecting = false;

    for (int i = 0; i < totalSamples; ++i) {
        const double input = static_cast<double>(samples[i]);
        const double absInput = std::abs(input);

        // Track clipping risk regardless of enabled state
        if (absInput > kClippingRiskLevel)
            anyClippingRisk = true;

        if (!enabled_) {
            // When disabled, slowly reset the envelope to 0.
            envelope_ *= (1.0 - releaseCoeff_);
            continue;
        }

        // ── Envelope tracking (peak detector with attack/release) ───────────
        // The envelope follows the peak level of the signal.
        // Attack  (~1 ms):  fast response to increasing peaks
        // Release (~50 ms): slow decay when signal drops
        if (absInput > envelope_) {
            // Attack phase: follow the peak upward quickly
            envelope_ += attackCoeff_ * (absInput - envelope_);
        } else {
            // Release phase: decay slowly toward the signal level
            envelope_ += releaseCoeff_ * (absInput - envelope_);
        }

        // Safety clamp
        if (envelope_ < 0.0)
            envelope_ = 0.0;

        // ── Gain computer ───────────────────────────────────────────────────
        // When the envelope exceeds the 0 dBFS threshold, compute gain
        // reduction.  Otherwise unity gain (no limiting).
        double gain = 1.0;
        if (envelope_ > kThreshold) {
            gain = kThreshold / envelope_;
            anyProtecting = true;
        }

        // ── Apply gain ──────────────────────────────────────────────────────
        samples[i] = static_cast<float>(input * gain);
    }

    // ── Update state flags ───────────────────────────────────────────────────
    protecting_ = anyProtecting;
    clippingRisk_ = anyClippingRisk;
}

bool Limiter::isProtecting() const {
    return protecting_;
}

bool Limiter::hasClippingRisk() const {
    return clippingRisk_;
}

void Limiter::reset() {
    envelope_ = 0.0;
    protecting_ = false;
    clippingRisk_ = false;
}

// ── Private ──────────────────────────────────────────────────────────────────

void Limiter::updateCoeffs() {
    // First-order IIR coefficient from time constant:
    //   alpha = 1 - exp(-1 / (tau * sampleRate))
    const double attackSamples = kAttackMs * 0.001 * sampleRate_;
    const double releaseSamples = kReleaseMs * 0.001 * sampleRate_;

    attackCoeff_ = (attackSamples > 0.0)
        ? 1.0 - std::exp(-1.0 / attackSamples)
        : 1.0;

    releaseCoeff_ = (releaseSamples > 0.0)
        ? 1.0 - std::exp(-1.0 / releaseSamples)
        : 1.0;

    // Guard against numerical edge cases
    attackCoeff_ = std::max(0.0, std::min(1.0, attackCoeff_));
    releaseCoeff_ = std::max(0.0, std::min(1.0, releaseCoeff_));
}

} // namespace echo_audio_daemon
