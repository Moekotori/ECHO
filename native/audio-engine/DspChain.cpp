#include "DspChain.h"

namespace echo
{
DspChain::DspChain(
    EqProcessor& eqProcessorToUse,
    ConvolutionProcessor& convolutionProcessorToUse,
    ChannelBalanceProcessor& channelBalanceProcessorToUse,
    DspHeadroomProcessor& headroomProcessorToUse)
    : uzumeEngine(eqProcessorToUse, convolutionProcessorToUse, channelBalanceProcessorToUse, headroomProcessorToUse)
{
}

void DspChain::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    uzumeEngine.prepare(sampleRate, maximumBlockSize, channelCount);
}

void DspChain::reset()
{
    uzumeEngine.reset();
}

void DspChain::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    uzumeEngine.processBlock(buffer, startSample, numSamples);
}

bool DspChain::isActive() const
{
    return uzumeEngine.isActive();
}

bool DspChain::hasClippingRisk() const
{
    return uzumeEngine.hasClippingRisk();
}

bool DspChain::isSafetyLimiterProtecting() const
{
    return uzumeEngine.isSafetyLimiterProtecting();
}
} // namespace echo
