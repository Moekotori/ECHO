#pragma once

#include "ChannelBalanceProcessor.h"
#include "ConvolutionProcessor.h"
#include "DspHeadroomProcessor.h"
#include "EqProcessor.h"
#include "UzumeGpuBackend.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>

namespace echo
{
struct UzumeRuntimeStatus
{
    bool active = false;
    bool clippingRisk = false;
    bool limiterProtecting = false;
    bool fallbackActive = false;
    const char* backend = "cpu-reference";
    const char* profile = "legacy-dsp-compat";
    const char* runtimeModel = "uzume-native-engine";
    bool gpuCompiled = false;
    bool gpuAvailable = false;
    bool gpuCufftAvailable = false;
    bool gpuLimiterPlaybackActive = false;
    bool gpuMatrixPlaybackActive = false;
    bool gpuFftConvolutionPrepared = false;
    const char* gpuDeviceName = nullptr;
    const char* fallbackReason = nullptr;
    const char* cufftFallbackReason = nullptr;
    int cudaRuntimeVersion = 0;
    int cufftVersion = 0;
};

class UzumeEngine
{
public:
    UzumeEngine(
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
    UzumeRuntimeStatus getRuntimeStatus() const;

private:
    static constexpr int bypassTailBlocks = 16;

    void processSafetyLimiter(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);
    void resetGpuLimiterPlaybackStatus();

    EqProcessor& eqProcessor;
    ConvolutionProcessor& convolutionProcessor;
    ChannelBalanceProcessor& channelBalanceProcessor;
    DspHeadroomProcessor& headroomProcessor;
    bool wasActive = false;
    int bypassTailBlocksRemaining = 0;
    std::atomic<bool> safetyLimiterClippingRisk { false };
    std::atomic<bool> gpuLimiterPlaybackProcessed { false };
    std::atomic<bool> gpuLimiterPlaybackFallback { false };
    std::atomic<const char*> gpuLimiterPlaybackFallbackReason { nullptr };
    std::atomic<bool> gpuFftConvolutionPrepared { false };
};
} // namespace echo
