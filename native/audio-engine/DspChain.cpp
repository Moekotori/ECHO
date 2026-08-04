#include "DspChain.h"
#include "DspSafetyLimiter.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
float sanitizeSample(float sample)
{
    return std::isfinite(sample) ? sample : 0.0f;
}

float softLimitSample(float sample, bool& risk)
{
    constexpr float limitThreshold = 1.0f;

    const float sanitized = sanitizeSample(sample);
    const float magnitude = std::abs(sanitized);
    if (magnitude <= limitThreshold)
        return sanitized;

    risk = true;
    return std::copysign(limitThreshold, sanitized);
}
} // namespace

DspChain::DspChain(
    EqProcessor& eqProcessorToUse,
    ConvolutionProcessor& convolutionProcessorToUse,
    ChannelBalanceProcessor& channelBalanceProcessorToUse,
    DspHeadroomProcessor& headroomProcessorToUse,
    ReplayGainProcessor& replayGainProcessorToUse,
    PlaybackRateProcessor& rateProcessorToUse,
    LevelMeterProcessor& meterProcessorToUse)
    : eqProcessor(eqProcessorToUse),
      convolutionProcessor(convolutionProcessorToUse),
      channelBalanceProcessor(channelBalanceProcessorToUse),
      headroomProcessor(headroomProcessorToUse),
      replayGainProcessor(replayGainProcessorToUse),
      rateProcessor(rateProcessorToUse),
      meterProcessor(meterProcessorToUse)
{
}

void DspChain::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    eqProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    convolutionProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    channelBalanceProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    headroomProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    replayGainProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    rateProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    meterProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    wasActive = isActive();
    bypassTailBlocksRemaining = wasActive ? bypassTailBlocks : 0;
}

void DspChain::reset()
{
    eqProcessor.reset();
    convolutionProcessor.reset();
    channelBalanceProcessor.reset();
    headroomProcessor.reset();
    replayGainProcessor.reset();
    rateProcessor.reset();
    meterProcessor.reset();
    wasActive = false;
    bypassTailBlocksRemaining = 0;
    safetyLimiterClippingRisk.store(false, std::memory_order_release);
}

void DspChain::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    const bool active = isActive();

    if (! active && ! wasActive && bypassTailBlocksRemaining <= 0)
        return;

    eqProcessor.processBlock(buffer, startSample, numSamples);
    convolutionProcessor.processBlock(buffer, startSample, numSamples);
    replayGainProcessor.processBlock(buffer, startSample, numSamples);
    channelBalanceProcessor.processBlock(buffer, startSample, numSamples);

    if (active)
        headroomProcessor.processBlock(buffer, startSample, numSamples);

    processSafetyLimiter(buffer, startSample, numSamples);
    rateProcessor.processBlock(buffer, startSample, numSamples);
    meterProcessor.processBlock(buffer, startSample, numSamples);

    if (active)
    {
        bypassTailBlocksRemaining = bypassTailBlocks;
    }
    else if (bypassTailBlocksRemaining > 0)
    {
        --bypassTailBlocksRemaining;
    }

    wasActive = active;
}

bool DspChain::isActive() const
{
    return eqProcessor.isEnabled()
        || convolutionProcessor.isEnabled()
        || channelBalanceProcessor.isEnabled()
        || replayGainProcessor.isActive()
        || rateProcessor.isActive();
}

bool DspChain::hasClippingRisk() const
{
    return eqProcessor.hasClippingRisk()
        || convolutionProcessor.hasClippingRisk()
        || channelBalanceProcessor.hasClippingRisk()
        || safetyLimiterClippingRisk.load(std::memory_order_acquire);
}

bool DspChain::isSafetyLimiterProtecting() const
{
    return safetyLimiterClippingRisk.load(std::memory_order_acquire);
}

void DspChain::setSafetyLimiterEnabled(bool enabled)
{
    setDspSafetyLimiterEnabled(enabled);
}

bool DspChain::isSafetyLimiterEnabled()
{
    return isDspSafetyLimiterEnabled();
}

void DspChain::processSafetyLimiter(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0 || ! isSafetyLimiterEnabled())
    {
        safetyLimiterClippingRisk.store(false, std::memory_order_release);
        return;
    }

    const int channelCount = buffer.getNumChannels();
    bool risk = false;

    for (int channel = 0; channel < channelCount; ++channel)
    {
        auto* samples = buffer.getWritePointer(channel, startSample);
        if (samples == nullptr)
            continue;

        for (int sample = 0; sample < numSamples; ++sample)
            samples[sample] = softLimitSample(samples[sample], risk);
    }

    safetyLimiterClippingRisk.store(risk, std::memory_order_release);
}
} // namespace echo
