#include "src/dsp/DspPipeline.h"

namespace echo_audio_daemon {

// ── Lifecycle ────────────────────────────────────────────────────────────────

void DspPipeline::prepare(double sampleRate, int blockSize, int channels) {
    eq_.prepare(sampleRate, blockSize, channels);
    conv_.prepare(blockSize, channels);
    // ChannelBalanceProcessor and Limiter adapt dynamically and do not
    // require upfront preparation beyond their default-constructed state.
}

void DspPipeline::processBlock(float* samples, int frameCount, int channels) {
    if (!samples || frameCount <= 0 || channels <= 0)
        return;

    // Run the modifying processors (EQ, Conv) only when the chain is
    // meaningfully active. The safety processors (Balance, Limiter) always
    // process — the limiter must be able to prevent clipping at all times.
    //
    // Each processor handles its own internal bypass/pass-through:
    //   - EqProcessor: returns immediately when disabled.
    //   - ConvolutionProcessor: copies input to output when disabled or no
    //     IR is loaded; passes through when given same input/output pointer.
    //   - ChannelBalanceProcessor: unity gain and zero delay at defaults.
    //   - Limiter: unity gain when envelope is below threshold (1.0).
    if (isActive()) {
        eq_.processBlock(samples, frameCount, channels);
        conv_.processBlock(samples, samples, frameCount, channels);
    }

    balance_.processBlock(samples, frameCount, channels);
    limiter_.processBlock(samples, frameCount, channels);
}

void DspPipeline::reset() {
    eq_.reset();
    conv_.reset();
    balance_.reset();
    limiter_.reset();
}

// ── Queries ──────────────────────────────────────────────────────────────────

bool DspPipeline::isActive() const {
    // Conv::isEnabled() returns true only when enabled_ AND irLoaded_ AND
    // irLength_ > 0, so a default-constructed Conv with no IR is inactive.
    return eq_.isEnabled() || conv_.isEnabled();
}

bool DspPipeline::hasClippingRisk() const {
    return limiter_.hasClippingRisk();
}

bool DspPipeline::isLimiterProtecting() const {
    return limiter_.isProtecting();
}

} // namespace echo_audio_daemon
