#pragma once

#include "ChannelBalanceProcessor.h"
#include "ConvolutionProcessor.h"
#include "DspHeadroomProcessor.h"
#include "EqProcessor.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>

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
    static void setSafetyLimiterEnabled(bool enabled);
    static bool isSafetyLimiterEnabled();

private:
    static constexpr int bypassTailBlocks = 16;

    void processSafetyLimiter(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);

    EqProcessor& eqProcessor;
    ConvolutionProcessor& convolutionProcessor;
    ChannelBalanceProcessor& channelBalanceProcessor;
    DspHeadroomProcessor& headroomProcessor;
    bool wasActive = false;
    int bypassTailBlocksRemaining = 0;
    std::atomic<bool> safetyLimiterClippingRisk { false };
};
} // namespace echo
