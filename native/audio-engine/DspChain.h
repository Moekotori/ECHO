#pragma once

#include "ChannelBalanceProcessor.h"
#include "ConvolutionProcessor.h"
#include "DspHeadroomProcessor.h"
#include "EqProcessor.h"
#include "LevelMeterProcessor.h"
#include "PlaybackRateProcessor.h"
#include "ReplayGainProcessor.h"

#include "buffer.h"

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
        DspHeadroomProcessor& headroomProcessorToUse,
        ReplayGainProcessor& replayGainProcessorToUse,
        PlaybackRateProcessor& rateProcessorToUse,
        LevelMeterProcessor& meterProcessorToUse);

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    bool isActive() const;
    bool hasClippingRisk() const;
    bool isSafetyLimiterProtecting() const;
    static void setSafetyLimiterEnabled(bool enabled);
    static bool isSafetyLimiterEnabled();

private:
    static constexpr int bypassTailBlocks = 16;

    void processSafetyLimiter(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    EqProcessor& eqProcessor;
    ConvolutionProcessor& convolutionProcessor;
    ChannelBalanceProcessor& channelBalanceProcessor;
    DspHeadroomProcessor& headroomProcessor;
    ReplayGainProcessor& replayGainProcessor;
    PlaybackRateProcessor& rateProcessor;
    LevelMeterProcessor& meterProcessor;

    bool wasActive = false;
    int bypassTailBlocksRemaining = 0;
    std::atomic<bool> safetyLimiterClippingRisk { false };
};
} // namespace echo
