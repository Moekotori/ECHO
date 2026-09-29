#include "DspChain.h"
#include "DspSafetyLimiter.h"

namespace echo
{
DspChain::DspChain(
    EqProcessor& eqProcessorToUse,
    ConvolutionProcessor& convolutionProcessorToUse,
    ChannelBalanceProcessor& channelBalanceProcessorToUse,
    DspHeadroomProcessor& headroomProcessorToUse,
    ReplayGainProcessor& replayGainProcessorToUse,
    CompressorProcessor& compressorProcessorToUse,
    SpatialDspProcessor& spatialDspProcessorToUse,
    PlaybackRateProcessor& rateProcessorToUse,
    LevelMeterProcessor& meterProcessorToUse,
    DspRackOrder* rackOrderToUse)
    : eqProcessor(eqProcessorToUse),
      convolutionProcessor(convolutionProcessorToUse),
      channelBalanceProcessor(channelBalanceProcessorToUse),
      headroomProcessor(headroomProcessorToUse),
      replayGainProcessor(replayGainProcessorToUse),
      compressorProcessor(compressorProcessorToUse),
      spatialDspProcessor(spatialDspProcessorToUse),
      rateProcessor(rateProcessorToUse),
      meterProcessor(meterProcessorToUse),
      ownedRackOrder(rackOrderToUse == nullptr ? std::make_unique<DspRackOrder>() : nullptr),
      rackOrder(rackOrderToUse != nullptr ? rackOrderToUse : ownedRackOrder.get())
{
}

void DspChain::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    eqProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    convolutionProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    channelBalanceProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    headroomProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    replayGainProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    compressorProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    spatialDspProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    rateProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    meterProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    truePeakLimiter.prepare(sampleRate, channelCount);
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
    compressorProcessor.reset();
    spatialDspProcessor.reset();
    rateProcessor.reset();
    meterProcessor.reset();
    truePeakLimiter.reset();
    wasActive = false;
    bypassTailBlocksRemaining = 0;
}

void DspChain::processBlock(
    echo::FloatAudioBuffer& buffer,
    int startSample,
    int numSamples,
    bool processReplayGain)
{
    const bool active = isActive();

    if (! active && ! wasActive && bypassTailBlocksRemaining <= 0)
    {
        // Metering observes the native output even when every mutating DSP
        // stage is bypassed. Keep it out of isActive() so a read-only meter
        // does not make the signal path report DSP processing.
        meterProcessor.processBlock(buffer, startSample, numSamples);
        return;
    }

    const auto order = rackOrder->snapshot();
    for (const auto module : order)
    {
        switch (module)
        {
            case DspRackModuleId::Equalizer:
                eqProcessor.processBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::Convolution:
                convolutionProcessor.processBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::ReplayGain:
                if (processReplayGain)
                    replayGainProcessor.processBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::Compressor:
                compressorProcessor.processBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::Crossfeed:
                spatialDspProcessor.processCrossfeedBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::StereoField:
                spatialDspProcessor.processStereoFieldBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::ChannelMatrix:
                spatialDspProcessor.processChannelMatrixBlock(buffer, startSample, numSamples);
                break;
            case DspRackModuleId::ChannelBalance:
                channelBalanceProcessor.processBlock(buffer, startSample, numSamples);
                break;
        }
    }

    // Keep running the headroom stage while the chain tail is active so a
    // return to 0 dB completes its smoothing ramp instead of stepping.
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
        || headroomProcessor.isEnabled()
        || replayGainProcessor.isActive()
        || compressorProcessor.isEnabled()
        || spatialDspProcessor.isAnyEnabled()
        || rateProcessor.isActive()
        || upstreamPcmProcessingActive.load(std::memory_order_acquire);
}

bool DspChain::hasClippingRisk() const
{
    return eqProcessor.hasClippingRisk()
        || convolutionProcessor.hasClippingRisk()
        || channelBalanceProcessor.hasClippingRisk()
        || compressorProcessor.hasClippingRisk()
        || spatialDspProcessor.hasClippingRisk()
        || truePeakLimiter.isProtecting();
}

bool DspChain::isSafetyLimiterProtecting() const
{
    return truePeakLimiter.isProtecting();
}

float DspChain::safetyLimiterGainReductionDb() const
{
    return truePeakLimiter.gainReductionDb();
}

float DspChain::safetyLimiterCeilingDb() const
{
    return upstreamPcmProcessingActive.load(std::memory_order_acquire)
        ? upstreamTruePeakCeilingDb
        : 0.0f;
}

void DspChain::setUpstreamPcmProcessingActive(bool active)
{
    upstreamPcmProcessingActive.store(active, std::memory_order_release);
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
        truePeakLimiter.reset();
        return;
    }

    const float ceilingDb =
        upstreamPcmProcessingActive.load(std::memory_order_acquire)
        ? upstreamTruePeakCeilingDb
        : 0.0f;
    truePeakLimiter.processBlock(
        buffer,
        startSample,
        numSamples,
        ceilingDb);
}
} // namespace echo
