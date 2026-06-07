#pragma once

#include "UzumeEngine.h"

namespace echo
{
class DspChain
{
public:
    DspChain(
        EqProcessor& eqProcessorToUse,
        ConvolutionProcessor& convolutionProcessorToUse,
        ChannelBalanceProcessor& channelBalanceProcessorToUse,
        DspHeadroomProcessor& headroomProcessorToUse);

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);

    bool isActive() const;
    bool hasClippingRisk() const;
    bool isSafetyLimiterProtecting() const;

private:
    UzumeEngine uzumeEngine;
};
} // namespace echo
