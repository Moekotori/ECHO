#pragma once

#include "src/dsp/ConvolutionProcessor.h"
#include "src/dsp/EqProcessor.h"
#include "src/dsp/ChannelBalanceProcessor.h"
#include "src/dsp/Limiter.h"

namespace echo_audio_daemon {

// ── DspPipeline ──────────────────────────────────────────────────────────────
// Full DSP processing chain: EqProcessor → ConvolutionProcessor →
// ChannelBalanceProcessor → Limiter.
//
// Thread safety:
//   - processBlock() is callable from the audio thread
//   - Configuration (prepare, EQ bands, convolution IR, balance params,
//     limiter enable) is set from the control thread
//   - Each sub-processor handles its own atomic/synchronized parameter
//     updates; DspPipeline is a stateless orchestrator.
class DspPipeline {
public:
    DspPipeline() = default;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /// Prepare all processors for the given audio context.
    void prepare(double sampleRate, int blockSize, int channels);

    /// Process an interleaved float32 block through the entire DSP chain:
    /// EqProcessor → ConvolutionProcessor → ChannelBalanceProcessor → Limiter.
    /// Operates in-place on samples.
    void processBlock(float* samples, int frameCount, int channels);

    /// Reset all processor states (filter memories, delay lines, limiter envelope).
    void reset();

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Returns true when any processor that can modify the signal is active.
    ///   - EqProcessor: enabled via setEnabled(true)
    ///   - ConvolutionProcessor: enabled AND IR loaded
    ///   - Limiter / ChannelBalanceProcessor: always process but are transparent
    ///     when at default settings; they do not contribute to this flag.
    bool isActive() const;

    /// Delegates to Limiter::hasClippingRisk().
    bool hasClippingRisk() const;

    /// Delegates to Limiter::isProtecting().
    bool isLimiterProtecting() const;

    // ── Processor accessors ──────────────────────────────────────────────────

    EqProcessor& eq() { return eq_; }
    const EqProcessor& eq() const { return eq_; }

    ConvolutionProcessor& conv() { return conv_; }
    const ConvolutionProcessor& conv() const { return conv_; }

    ChannelBalanceProcessor& balance() { return balance_; }
    const ChannelBalanceProcessor& balance() const { return balance_; }

    Limiter& limiter() { return limiter_; }
    const Limiter& limiter() const { return limiter_; }

private:
    EqProcessor eq_;
    ConvolutionProcessor conv_;
    ChannelBalanceProcessor balance_;
    Limiter limiter_;
};

} // namespace echo_audio_daemon
