#pragma once

#include "DopRingSource.h"
#include "NativeFirProcessor.h"
#include "NativeDsdRingSource.h"
#include "NativeSdmProcessor.h"
#include "PcmDomainDspStage.h"
#include "PcmRingAudioSource.h"
#include "../../audio-engine/NativeFormatProcessor.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

class NativePlaybackPipeline final
{
public:
    enum class OutputFormat { Pcm, Dop, NativeDsd };
    enum class ComputeBackend { Cpu, Cuda };

    struct FirConfig
    {
        int sourceSampleRate = 0;
        int targetSampleRate = 0;
        std::vector<echo::EchoSrcStageConfig> stages;
        ComputeBackend requestedBackend = ComputeBackend::Cpu;
    };

    struct SdmConfig
    {
        echo::SdmQualityProfile qualityProfile = echo::SdmQualityProfile::Safe;
        ComputeBackend requestedBackend = ComputeBackend::Cpu;
        int sourceSampleRate = 0;
        int targetSampleRate = 0;
        FirConfig oversampling;
    };

    struct ProcessingConfig
    {
        OutputFormat outputFormat = OutputFormat::Pcm;
        FirConfig echoSrc;
        echo::PcmDitherMode ditherMode = echo::PcmDitherMode::Off;
        int ditherBitDepth = 16;
        SdmConfig sdm;
    };

    struct FirStatus
    {
        bool active = false;
        int sourceSampleRate = 0;
        int targetSampleRate = 0;
        int stageCount = 0;
        ComputeBackend requestedBackend = ComputeBackend::Cpu;
        ComputeBackend activeBackend = ComputeBackend::Cpu;
        uint64_t estimatedMacsPerSecond = 0;
        int nominalLatencyFrames = 0;
        double nominalLatencyMilliseconds = 0.0;
        std::string fallbackReason;
        std::string deviceName;
        uint64_t processedBlocks = 0;
        int lastInputFrames = 0;
        int lastOutputFrames = 0;
        double lastProcessMilliseconds = 0.0;
        double averageProcessMilliseconds = 0.0;
        double peakProcessMilliseconds = 0.0;
        double warmupMilliseconds = 0.0;
        uint64_t runtimeFallbacks = 0;
    };

    struct SdmStatus
    {
        bool active = false;
        int sourceSampleRate = 0;
        int targetSampleRate = 0;
        int stageCount = 0;
        ComputeBackend requestedBackend = ComputeBackend::Cpu;
        ComputeBackend activeBackend = ComputeBackend::Cpu;
        ComputeBackend modulatorBackend = ComputeBackend::Cpu;
        ComputeBackend oversamplingBackend = ComputeBackend::Cpu;
        uint64_t estimatedMacsPerSecond = 0;
        std::string fallbackReason;
        std::string oversamplingFallbackReason;
        std::string deviceName;
        uint64_t processedBlocks = 0;
        int lastInputFrames = 0;
        int lastOutputFrames = 0;
        double lastProcessMilliseconds = 0.0;
        double averageProcessMilliseconds = 0.0;
        double peakProcessMilliseconds = 0.0;
        double warmupMilliseconds = 0.0;
        uint64_t runtimeFallbacks = 0;
        bool pcmDspRouted = false;
        int modulatorOrder = 0;
        double ntfPeakGain = 0.0;
        double peakFeedbackState = 0.0;
        uint64_t stabilityRecoveries = 0;
    };

    struct ProcessingStatus
    {
        struct LimiterStatus
        {
            bool active = false;
            bool protecting = false;
            float ceilingDb = 0.0f;
            float gainReductionDb = 0.0f;
        };

        OutputFormat outputFormat = OutputFormat::Pcm;
        bool ditherActive = false;
        echo::PcmDitherMode ditherMode = echo::PcmDitherMode::Off;
        int ditherBitDepth = 16;
        FirStatus echoSrc;
        SdmStatus sdm;
        LimiterStatus limiter;
    };

    NativePlaybackPipeline(PcmRingAudioSource& pcm, DopRingSource& dop, NativeDsdRingSource& nativeDsd, int channels);
    NativePlaybackPipeline(
        PcmRingAudioSource& pcm,
        DopRingSource& dop,
        NativeDsdRingSource& nativeDsd,
        int channels,
        echo::EqProcessor& eq,
        echo::ConvolutionProcessor& convolution,
        echo::ChannelBalanceProcessor& channelBalance,
        echo::DspHeadroomProcessor& headroom,
        echo::ReplayGainProcessor& replayGain,
        echo::CompressorProcessor& compressor,
        echo::SpatialDspProcessor& spatialDsp,
        echo::PlaybackRateProcessor& playbackRate,
        echo::LevelMeterProcessor& meter,
        echo::DspRackOrder* rackOrder = nullptr);

    bool configure(const ProcessingConfig& config, std::string& error);
    bool configurePassthroughOutput(OutputFormat format, std::string& error);

    OutputFormat outputFormat() const;
    ProcessingStatus processingStatus() const;
    int decoderSampleRate(int outputSampleRate) const noexcept;
    PcmRingAudioSource& pcmSource() noexcept { return pcm_; }
    DopRingSource& dopSource() noexcept { return dop_; }
    NativeDsdRingSource& nativeDsdSource() noexcept { return nativeDsd_; }

    void beginSession(bool startPaused = false);
    void continueSessionAfterDrain();
    void markInputEnded();
    void requestStop();
    void setPaused(bool paused);
    void setGain(float gain);
    bool push(const float* samples, int frames);
    bool pushForGeneration(const float* samples, int frames, uint64_t generation);
    bool prepareGapless();
    bool pushGaplessNext(const float* samples, int frames);
    void markGaplessNextEnded();
    void cancelGapless();
    uint64_t getGaplessBoundaryFrame() const;
    bool prepareAutomixFrames(
        uint64_t fadeStartFrame,
        uint64_t overlapFrames,
        double currentGainDb,
        double nextGainDb,
        double currentReplayGainDb = 0.0,
        double nextReplayGainDb = 0.0);
    bool pushAutomixNext(const float* samples, int frames);
    void markAutomixNextEnded();
    void failAutomixNext(uint64_t fadeFrames);
    void cancelAutomix();
    uint64_t getAutomixFadeStartFrame() const;
    uint64_t getAutomixFadeEndFrame() const;
    bool isAutomixActive() const;
    int replaceBufferedAudio(const float* samples, int frames, bool pausedAfterReplace);
    int replaceBufferedAudioWithPreroll(
        const float* samples,
        int frames,
        int prerollFrames,
        bool pausedAfterReplace);
    int seekPrerollFrames() const;

    uint64_t generation() const noexcept { return pcm_.session_.generation(); }
    bool isDrained() const;
    bool hasInputEnded() const;
    int getReadyFrames() const;
    uint64_t getFramesPlayed() const;
    uint64_t getUnderrunCallbacks() const;
    uint64_t getUnderrunFrames() const;

private:
    struct PreparedOutput
    {
        OutputFormat format = OutputFormat::Pcm;
        uint64_t sourceGeneration = 0;
        std::vector<float> pcm;
        std::vector<uint32_t> dop;
        std::vector<uint8_t> nativeDsd;
    };

    bool prepareOutputLocked(const float* samples, int frames, PreparedOutput& output, std::string& error);
    bool pushPreparedOutput(const PreparedOutput& output);
    int replacePreparedOutput(const PreparedOutput& output, int inputFrames, bool pausedAfterReplace);
    bool prepareSdmPcm(const float* samples, int frames, std::vector<float>& output, std::string& error);
    std::vector<float> preparePcm(const float* samples, int frames);
    void resetProcessorsLocked();
    static bool configureFirProcessor(
        NativeFirProcessor& processor,
        int channels,
        const FirConfig& config,
        const char* errorPrefix,
        int maximumInputFrames,
        std::string& error);
    static int calculateFirOutputFactor(const std::vector<echo::EchoSrcStageConfig>& stages, std::string& error);
    static FirStatus makeFirStatus(
        const FirConfig& config,
        const NativeFirProcessor& processor,
        bool active,
        uint64_t estimatedMacsPerSecond);
    static SdmStatus makeSdmStatus(
        const SdmConfig& config,
        const NativeFirProcessor& oversampler,
        const NativeSdmProcessor& modulator,
        bool active,
        bool pcmDspRouted,
        uint64_t estimatedMacsPerSecond);

    PcmRingAudioSource& pcm_;
    DopRingSource& dop_;
    NativeDsdRingSource& nativeDsd_;
    int channels_ = 2;
    mutable std::mutex processingMutex_;
    OutputFormat outputFormat_ = OutputFormat::Pcm;
    std::atomic<int> decoderSampleRate_ { 0 };
    std::atomic<float> gain_ { 1.0f };
    NativeFirProcessor echoSrc_;
    NativeFirProcessor automixEchoSrc_;
    NativeFirProcessor sdmOversampler_;
    NativeSdmProcessor sdm_;
    std::unique_ptr<PcmDomainDspStage> sdmDsp_;
    ProcessingStatus processingStatus_;
    std::condition_variable gaplessStateChanged_;
    bool gaplessEchoSrcActive_ = false;
    bool gaplessEchoSrcReady_ = false;
    bool gaplessEchoSrcCancelled_ = false;
    uint64_t gaplessEchoSrcGeneration_ = 0;
    std::vector<float> gaplessPendingInput_;
};
