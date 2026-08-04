#pragma once

#include "../../audio-engine/EqProcessor.h"
#include "../../audio-engine/ChannelBalanceProcessor.h"
#include "../../audio-engine/ConvolutionProcessor.h"
#include "../../audio-engine/DspHeadroomProcessor.h"
#include "../../audio-engine/ReplayGainProcessor.h"
#include "../../audio-engine/PlaybackRateProcessor.h"
#include "../../audio-engine/LevelMeterProcessor.h"
#include "../../audio-engine/DspChain.h"
#include "../../audio-engine/buffer.h"

#include "PlaybackSession.h"
#include "NativePrimitives.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

namespace pcm_detail {
void configureAudioCallbackThread();
}

struct AutomixNativePlan
{
    std::atomic<bool> enabled { false };
    std::atomic<bool> fadeActivated { false };
    std::atomic<uint64_t> fadeStartFrame { 0 };
    std::atomic<uint64_t> fadeEndFrame { 0 };
    std::atomic<uint64_t> gainReleaseEndFrame { 0 };
    std::atomic<uint64_t> overlapFrames { 1 };
    std::atomic<float> currentGain { 1.0f };
    std::atomic<float> nextGain { 1.0f };
};

class PcmRingAudioSource final
{
public:
    PcmRingAudioSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse,
        double gainToUse,
        echo::EqProcessor& eqProcessorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse);

    PcmRingAudioSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse,
        double gainToUse,
        echo::EqProcessor& eqProcessorToUse,
        echo::ConvolutionProcessor& convolutionProcessorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse,
        echo::DspHeadroomProcessor& headroomProcessorToUse,
        echo::ReplayGainProcessor& replayGainProcessorToUse,
        echo::PlaybackRateProcessor& rateProcessorToUse,
        echo::LevelMeterProcessor& meterProcessorToUse);

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate);
    void prepareForNativeRender(int maxFramesPerCallback, double sampleRate);
    void releaseResources();

    bool isDspActive() const;
    bool hasDspClippingRisk() const;
    bool isDspLimiterProtecting() const;

    uint32_t renderInterleaved(echo_audio_host::FloatInterleavedRenderTarget target);
    uint32_t renderInterleaved(float* output, uint32_t frameCount, uint32_t outputChannels);
    uint64_t renderPlanar(echo::FloatAudioBuffer& output, int startSample, int frameCount);

    bool push(const float* samples, int frameCount);
    int replaceBufferedAudio(const float* samples, int frameCount, bool pausedAfterReplace);
    bool pushAutomixNext(const float* samples, int frameCount);
    void prepareAutomix(double sampleRate, double fadeStartSeconds, double overlapSeconds, double currentGainDb, double nextGainDb);
    void markAutomixNextEnded();
    void cancelAutomix();

    void beginSession();
    void markInputEnded();
    void requestStop();
    void setPaused(bool paused);
    void setGain(float nextGain);

    bool isDrained() const;
    bool hasInputEnded() const;
    int getReadyFrames() const;
    uint64_t getFramesPlayed() const;
    uint64_t getUnderrunCallbacks() const;
    uint64_t getUnderrunFrames() const;

    echo::ReplayGainProcessor* getReplayGainProcessor();
    echo::PlaybackRateProcessor* getRateProcessor();
    echo::LevelMeterProcessor* getMeterProcessor();

    PlaybackSession session_;

private:
    void copyFromInput(const float* source, int startFrame, int frameCount);
    static float dbToGain(double db);
    void activateAutomixFadeIfReady(uint64_t absoluteStartFrame, int frameCount);
    void configureDeclickRamp(double sampleRate);
    void applyDeclickRamp(echo::FloatAudioBuffer& output, int startSample, int frameCount);
    float currentAutomixEnvelope(uint64_t absoluteFrame) const;
    float nextAutomixEnvelope(uint64_t absoluteFrame) const;
    void copyToOutput(
        int startFrame,
        int frameCount,
        echo::FloatAudioBuffer& output,
        int outputStart,
        uint64_t absoluteStartFrame);
    void copyToAutomixBuffer(const float* source, int startFrame, int frameCount);
    void addAutomixToOutput(
        int startFrame,
        int frameCount,
        echo::FloatAudioBuffer& output,
        int outputStart,
        uint64_t absoluteStartFrame);
    uint64_t mixAutomixNext(echo::FloatAudioBuffer& output, int startSample, int frameCount, uint64_t absoluteStartFrame);
    void resamplePlaybackRate(
        const echo::FloatAudioBuffer& source,
        echo::FloatAudioBuffer& output,
        int outputStart,
        int outputFrames,
        int sourceFrames,
        float playbackRate);
    void copyPlanarToInterleaved(
        const echo::FloatAudioBuffer& source,
        float* output,
        int frameCount,
        int outputChannels) const;
    bool shouldHoldForStartupPrebuffer();

    const int channels;
    std::atomic<float> gain;
    const int startupPrebufferFrames;
    const int startupPrebufferTimeoutMs;
    echo_audio_host::NativeFifo fifo;
    std::vector<float> buffer;
    echo_audio_host::NativeFifo automixFifo;
    std::vector<float> automixBuffer;
    echo::FloatAudioBuffer nativeRenderBuffer;
    echo::FloatAudioBuffer playbackRateInputBuffer;
    std::unique_ptr<echo::ConvolutionProcessor> ownedConvolutionProcessor;
    echo::ConvolutionProcessor* convolutionProcessor = nullptr;
    std::unique_ptr<echo::DspHeadroomProcessor> ownedHeadroomProcessor;
    echo::DspHeadroomProcessor* headroomProcessor = nullptr;
    std::unique_ptr<echo::ReplayGainProcessor> ownedReplayGainProcessor;
    echo::ReplayGainProcessor* replayGainProcessor = nullptr;
    std::unique_ptr<echo::PlaybackRateProcessor> ownedRateProcessor;
    echo::PlaybackRateProcessor* rateProcessor = nullptr;
    std::unique_ptr<echo::LevelMeterProcessor> ownedMeterProcessor;
    echo::LevelMeterProcessor* meterProcessor = nullptr;
    echo::DspChain dspChain;
    mutable std::mutex fifoMutex;
    mutable std::mutex automixMutex;
    AutomixNativePlan automixPlan;
    std::atomic<bool> automixNextInputEnded { false };
    std::atomic<bool> automixNextHasAudio { false };
    std::atomic<bool> prebuffering { false };
    std::atomic<bool> stopFadeRequested { false };
    std::atomic<bool> sessionPaused { false };
    std::atomic<uint64_t> declickFadeGeneration { 0 };
    std::atomic<uint64_t> framesPlayed { 0 };
    std::atomic<uint64_t> underrunCallbacks { 0 };
    std::atomic<uint64_t> underrunFrames { 0 };
    std::chrono::steady_clock::time_point prebufferDeadline {};
    uint64_t appliedDeclickFadeGeneration = 0;
    float declickGain = 1.0f;
    int declickRampFrames = 1;
};
