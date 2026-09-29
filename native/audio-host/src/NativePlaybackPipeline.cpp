#include "NativePlaybackPipeline.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace
{
// DSD256 needs four x2 FIR stages from a 44.1/48 kHz PCM source to its
// 705.6/768 kHz DoP transport rate. Keep individual stages constrained to
// the established 1/2/4/8 factors, but accept the safe composed factor.
constexpr int maximumNativeFirUpsampleFactor = 16;
constexpr int producerDecodeChunkFrames = 4096;

bool isValidUpsampleFactor(int factor) noexcept
{
    return factor == 1 || factor == 2 || factor == 4 || factor == 8;
}

template <typename Status>
void applyFirPerformanceStatus(Status& status, const NativeFirProcessor& processor)
{
    status.processedBlocks = processor.processedBlocks();
    status.lastInputFrames = processor.lastInputFrames();
    status.lastOutputFrames = processor.lastOutputFrames();
    status.lastProcessMilliseconds = processor.lastProcessMilliseconds();
    status.averageProcessMilliseconds = processor.averageProcessMilliseconds();
    status.peakProcessMilliseconds = processor.peakProcessMilliseconds();
    status.warmupMilliseconds = processor.warmupMilliseconds();
    status.runtimeFallbacks = processor.runtimeFallbacks();
}

template <typename Status>
void applySdmPerformanceStatus(Status& status, const NativeSdmProcessor& processor)
{
    status.processedBlocks = processor.processedBlocks();
    status.lastInputFrames = processor.lastInputFrames();
    status.lastOutputFrames = processor.lastOutputFrames();
    status.lastProcessMilliseconds = processor.lastProcessMilliseconds();
    status.averageProcessMilliseconds = processor.averageProcessMilliseconds();
    status.peakProcessMilliseconds = processor.peakProcessMilliseconds();
    status.warmupMilliseconds = processor.warmupMilliseconds();
    status.runtimeFallbacks = processor.runtimeFallbacks();
}
} // namespace

NativePlaybackPipeline::NativePlaybackPipeline(
    PcmRingAudioSource& pcm,
    DopRingSource& dop,
    NativeDsdRingSource& nativeDsd,
    int channels)
    : pcm_(pcm), dop_(dop), nativeDsd_(nativeDsd), channels_(std::max(1, channels))
{
    std::string error;
    sdm_.configure(
        channels_,
        echo::SdmQualityProfile::Safe,
        176400,
        false,
        producerDecodeChunkFrames,
        error);
}

NativePlaybackPipeline::NativePlaybackPipeline(
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
    echo::DspRackOrder* rackOrder)
    : NativePlaybackPipeline(pcm, dop, nativeDsd, channels)
{
    sdmDsp_ = std::make_unique<PcmDomainDspStage>(
        eq, convolution, channelBalance, headroom, replayGain, compressor, spatialDsp, playbackRate, meter, rackOrder);
}

bool NativePlaybackPipeline::configureFirProcessor(
    NativeFirProcessor& processor,
    int channels,
    const FirConfig& config,
    const char* errorPrefix,
    int maximumInputFrames,
    std::string& error)
{
    if (config.stages.empty())
        return processor.configure(channels, {}, false, maximumInputFrames, error);

    if (config.sourceSampleRate <= 0 || config.targetSampleRate <= 0)
    {
        error = std::string(errorPrefix) + "_invalid_sample_rate";
        return false;
    }

    const int factor = calculateFirOutputFactor(config.stages, error);
    if (factor <= 0)
    {
        error = std::string(errorPrefix) + "_" + error;
        return false;
    }
    if (config.sourceSampleRate > std::numeric_limits<int>::max() / factor
        || config.sourceSampleRate * factor != config.targetSampleRate)
    {
        error = std::string(errorPrefix) + "_sample_rate_mismatch";
        return false;
    }

    if (!processor.configure(
            channels,
            config.stages,
            config.requestedBackend == ComputeBackend::Cuda,
            maximumInputFrames,
            error))
    {
        error = std::string(errorPrefix) + "_" + error;
        return false;
    }
    return true;
}

int NativePlaybackPipeline::calculateFirOutputFactor(
    const std::vector<echo::EchoSrcStageConfig>& stages,
    std::string& error)
{
    int factor = 1;
    for (const auto& stage : stages)
    {
        if (!isValidUpsampleFactor(stage.upsampleFactor))
        {
            error = "invalid_upsample_factor";
            return 0;
        }
        if (stage.taps.empty())
        {
            error = "empty_taps";
            return 0;
        }
        if (factor > maximumNativeFirUpsampleFactor / stage.upsampleFactor)
        {
            error = "upsample_factor_limit_exceeded";
            return 0;
        }
        factor *= stage.upsampleFactor;
    }
    error.clear();
    return factor;
}

NativePlaybackPipeline::FirStatus NativePlaybackPipeline::makeFirStatus(
    const FirConfig& config,
    const NativeFirProcessor& processor,
    bool active,
    uint64_t estimatedMacsPerSecond)
{
    FirStatus status;
    status.active = active;
    status.sourceSampleRate = config.sourceSampleRate;
    status.targetSampleRate = config.targetSampleRate;
    status.stageCount = static_cast<int>(config.stages.size());
    status.requestedBackend = config.requestedBackend;
    status.activeBackend = processor.backend() == NativeFirProcessor::Backend::Cuda
        ? ComputeBackend::Cuda
        : ComputeBackend::Cpu;
    status.estimatedMacsPerSecond = active ? estimatedMacsPerSecond : 0;
    status.nominalLatencyFrames = active
        ? processor.nominalLatencyOutputFrames()
        : 0;
    status.nominalLatencyMilliseconds =
        active && config.targetSampleRate > 0
        ? static_cast<double>(status.nominalLatencyFrames)
            * 1'000.0
            / static_cast<double>(config.targetSampleRate)
        : 0.0;
    if (active)
    {
        status.fallbackReason = processor.fallbackReason();
        status.deviceName = processor.deviceName();
        applyFirPerformanceStatus(status, processor);
    }
    return status;
}

NativePlaybackPipeline::SdmStatus NativePlaybackPipeline::makeSdmStatus(
    const SdmConfig& config,
    const NativeFirProcessor& oversampler,
    const NativeSdmProcessor& modulator,
    bool active,
    bool pcmDspRouted,
    uint64_t estimatedMacsPerSecond)
{
    SdmStatus status;
    status.active = active;
    status.sourceSampleRate = config.sourceSampleRate;
    status.targetSampleRate = config.targetSampleRate;
    status.stageCount = static_cast<int>(config.oversampling.stages.size());
    status.requestedBackend = config.requestedBackend;
    status.modulatorBackend =
        modulator.backend() == NativeSdmProcessor::Backend::Cuda
        ? ComputeBackend::Cuda
        : ComputeBackend::Cpu;
    status.oversamplingBackend =
        oversampler.backend() == NativeFirProcessor::Backend::Cuda
        ? ComputeBackend::Cuda
        : ComputeBackend::Cpu;
    status.activeBackend = status.modulatorBackend;
    status.estimatedMacsPerSecond = active ? estimatedMacsPerSecond : 0;
    status.pcmDspRouted = pcmDspRouted;
    if (active)
    {
        status.fallbackReason = modulator.fallbackReason();
        status.oversamplingFallbackReason = oversampler.fallbackReason();
        status.deviceName = modulator.backend() == NativeSdmProcessor::Backend::Cuda
            ? modulator.deviceName()
            : oversampler.deviceName();
        applySdmPerformanceStatus(status, modulator);
    }
    return status;
}

bool NativePlaybackPipeline::configure(const ProcessingConfig& config, std::string& error)
{
    const bool echoSrcActive = !config.echoSrc.stages.empty();
    const bool sdmOversamplingActive = !config.sdm.oversampling.stages.empty();
    const bool sdmActive = config.outputFormat != OutputFormat::Pcm;

    if (!sdmActive && sdmOversamplingActive)
    {
        error = "native_sdm_oversampling_requires_sdm_output";
        return false;
    }
    if (sdmActive && echoSrcActive)
    {
        error = "native_sdm_cannot_combine_echo_src";
        return false;
    }
    if (sdmActive && config.sdm.targetSampleRate <= 0)
    {
        error = "native_sdm_invalid_target_sample_rate";
        return false;
    }
    if (sdmOversamplingActive
        && (config.sdm.sourceSampleRate <= 0 || config.sdm.oversampling.sourceSampleRate <= 0
            || config.sdm.oversampling.targetSampleRate <= 0
            || config.sdm.sourceSampleRate != config.sdm.oversampling.sourceSampleRate
            || config.sdm.targetSampleRate != config.sdm.oversampling.targetSampleRate))
    {
        error = "native_sdm_oversampling_sample_rate_mismatch";
        return false;
    }

    NativeFirProcessor nextEchoSrc;
    if (!configureFirProcessor(
            nextEchoSrc,
            channels_,
            config.echoSrc,
            "native_echo_src",
            producerDecodeChunkFrames,
            error))
        return false;
    NativeFirProcessor nextAutomixEchoSrc;
    if (!configureFirProcessor(
            nextAutomixEchoSrc,
            channels_,
            config.echoSrc,
            "native_automix_echo_src",
            producerDecodeChunkFrames,
            error))
        return false;

    NativeFirProcessor nextSdmOversampler;
    auto sdmOversamplingConfig = config.sdm.oversampling;
    // SDM owns one compute-backend choice. The nested FIR config is an
    // implementation detail and must not silently reset that choice to CPU.
    sdmOversamplingConfig.requestedBackend = config.sdm.requestedBackend;
    if (!configureFirProcessor(
            nextSdmOversampler,
            channels_,
            sdmOversamplingConfig,
            "native_sdm_oversampling",
            producerDecodeChunkFrames,
            error))
        return false;

    int sdmDspMaximumFrames = producerDecodeChunkFrames;
    if (sdmOversamplingActive)
    {
        const int factor = calculateFirOutputFactor(
            config.sdm.oversampling.stages,
            error);
        if (factor <= 0)
        {
            error = "native_sdm_oversampling_" + error;
            return false;
        }
        sdmDspMaximumFrames = producerDecodeChunkFrames * factor;
    }

    NativeSdmProcessor nextSdm;
    if (!nextSdm.configure(
            channels_,
            config.sdm.qualityProfile,
            std::max(1, config.sdm.targetSampleRate),
            sdmActive
                && config.sdm.requestedBackend == ComputeBackend::Cuda,
            sdmDspMaximumFrames,
            error))
    {
        error = "native_sdm_modulator_" + error;
        return false;
    }
    const uint64_t echoSrcEstimatedMacsPerSecond =
        nextEchoSrc.estimatedMacsPerInputFrame()
        * static_cast<uint64_t>(std::max(0, config.echoSrc.sourceSampleRate));
    const uint64_t sdmEstimatedMacsPerSecond =
        nextSdmOversampler.estimatedMacsPerInputFrame()
        * static_cast<uint64_t>(std::max(0, config.sdm.sourceSampleRate));

    std::lock_guard<std::mutex> lock(processingMutex_);
    // A successful reconfiguration invalidates any prepared block that was
    // produced against the old FIR/SDM route. requestStop() is non-blocking;
    // the generation-aware ring push rejects that stale block after we release
    // this DSP-state lock.
    pcm_.requestStop();
    dop_.requestStop();
    nativeDsd_.requestStop();
    if (sdmActive && sdmDsp_ != nullptr)
        sdmDsp_->prepare(config.sdm.targetSampleRate, sdmDspMaximumFrames, channels_);

    echoSrc_ = std::move(nextEchoSrc);
    automixEchoSrc_ = std::move(nextAutomixEchoSrc);
    sdmOversampler_ = std::move(nextSdmOversampler);
    sdm_ = std::move(nextSdm);
    outputFormat_ = config.outputFormat;
    pcm_.setUpstreamPcmProcessingActive(
        outputFormat_ == OutputFormat::Pcm && echoSrcActive);
    pcm_.configureDither(outputFormat_ == OutputFormat::Pcm ? config.ditherMode : echo::PcmDitherMode::Off,
                         config.ditherBitDepth);

    const int decoderRate = outputFormat_ == OutputFormat::Pcm && echoSrcActive
        ? config.echoSrc.sourceSampleRate
        : sdmActive && sdmOversamplingActive
            ? config.sdm.sourceSampleRate
            : 0;
    decoderSampleRate_.store(decoderRate, std::memory_order_release);

    ProcessingStatus nextStatus;
    nextStatus.outputFormat = outputFormat_;
    nextStatus.ditherMode = config.ditherMode;
    nextStatus.ditherBitDepth = config.ditherBitDepth;
    nextStatus.ditherActive = outputFormat_ == OutputFormat::Pcm && config.ditherMode != echo::PcmDitherMode::Off;
    nextStatus.echoSrc = makeFirStatus(
        config.echoSrc,
        echoSrc_,
        echoSrcActive,
        echoSrcEstimatedMacsPerSecond);
    nextStatus.sdm = makeSdmStatus(
        config.sdm,
        sdmOversampler_,
        sdm_,
        sdmActive,
        sdmActive && sdmDsp_ != nullptr,
        sdmEstimatedMacsPerSecond);
    processingStatus_ = std::move(nextStatus);

    resetProcessorsLocked();
    error.clear();
    return true;
}

bool NativePlaybackPipeline::configurePassthroughOutput(OutputFormat format, std::string& error)
{
    if (format == OutputFormat::Pcm)
    {
        error = "native_passthrough_requires_dsd_output";
        return false;
    }

    std::lock_guard<std::mutex> lock(processingMutex_);
    pcm_.requestStop();
    dop_.requestStop();
    nativeDsd_.requestStop();
    outputFormat_ = format;
    pcm_.setUpstreamPcmProcessingActive(false);
    decoderSampleRate_.store(0, std::memory_order_release);
    pcm_.configureDither(echo::PcmDitherMode::Off, 16);
    processingStatus_ = {};
    processingStatus_.outputFormat = format;
    resetProcessorsLocked();
    error.clear();
    return true;
}

NativePlaybackPipeline::OutputFormat NativePlaybackPipeline::outputFormat() const
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    return outputFormat_;
}

NativePlaybackPipeline::ProcessingStatus NativePlaybackPipeline::processingStatus() const
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    auto status = processingStatus_;
    status.limiter.active =
        outputFormat_ == OutputFormat::Pcm
        && status.echoSrc.active
        && pcm_.isDspLimiterEnabled();
    status.limiter.protecting =
        status.limiter.active
        && pcm_.isDspLimiterProtecting();
    status.limiter.ceilingDb =
        pcm_.getDspLimiterCeilingDb();
    status.limiter.gainReductionDb =
        status.limiter.active
        ? pcm_.getDspLimiterGainReductionDb()
        : 0.0f;
    if (status.echoSrc.active)
    {
        status.echoSrc.activeBackend = echoSrc_.backend() == NativeFirProcessor::Backend::Cuda
            ? ComputeBackend::Cuda
            : ComputeBackend::Cpu;
        status.echoSrc.fallbackReason = echoSrc_.fallbackReason();
        status.echoSrc.deviceName = echoSrc_.deviceName();
        applyFirPerformanceStatus(status.echoSrc, echoSrc_);
    }
    if (status.sdm.active)
    {
        status.sdm.modulatorBackend =
            sdm_.backend() == NativeSdmProcessor::Backend::Cuda
            ? ComputeBackend::Cuda
            : ComputeBackend::Cpu;
        status.sdm.oversamplingBackend =
            sdmOversampler_.backend() == NativeFirProcessor::Backend::Cuda
            ? ComputeBackend::Cuda
            : ComputeBackend::Cpu;
        status.sdm.activeBackend = status.sdm.modulatorBackend;
        status.sdm.fallbackReason = sdm_.fallbackReason();
        status.sdm.oversamplingFallbackReason =
            sdmOversampler_.fallbackReason();
        status.sdm.deviceName =
            sdm_.backend() == NativeSdmProcessor::Backend::Cuda
            ? sdm_.deviceName()
            : sdmOversampler_.deviceName();
        applySdmPerformanceStatus(status.sdm, sdm_);
        status.sdm.modulatorOrder = sdm_.modulatorOrder();
        status.sdm.ntfPeakGain = sdm_.ntfPeakGain();
        status.sdm.peakFeedbackState = sdm_.peakFeedbackState();
        status.sdm.stabilityRecoveries = sdm_.stabilityRecoveryCount();
    }
    return status;
}

int NativePlaybackPipeline::decoderSampleRate(int outputSampleRate) const noexcept
{
    const int configured = decoderSampleRate_.load(std::memory_order_acquire);
    return configured > 0 ? configured : outputSampleRate;
}

void NativePlaybackPipeline::resetProcessorsLocked()
{
    gaplessEchoSrcActive_ = false;
    gaplessEchoSrcReady_ = false;
    gaplessEchoSrcCancelled_ = true;
    gaplessEchoSrcGeneration_ = 0;
    gaplessPendingInput_.clear();
    gaplessStateChanged_.notify_all();
    echoSrc_.reset();
    automixEchoSrc_.reset();
    sdmOversampler_.reset();
    pcm_.resetDither();
    sdm_.setTargetGain(gain_.load(std::memory_order_acquire));
    sdm_.reset();
    if (sdmDsp_ != nullptr)
        sdmDsp_->reset();
}

void NativePlaybackPipeline::beginSession(bool startPaused)
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    resetProcessorsLocked();
    pcm_.beginSession(startPaused);
    dop_.beginSession();
    nativeDsd_.beginSession();
    dop_.setPaused(startPaused);
    nativeDsd_.setPaused(startPaused);
}

void NativePlaybackPipeline::continueSessionAfterDrain()
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    resetProcessorsLocked();
    pcm_.continueSessionAfterDrain();
    dop_.beginSession();
    nativeDsd_.beginSession();
}

void NativePlaybackPipeline::markInputEnded()
{
    PreparedOutput tail;
    std::vector<float> gaplessPrime;
    OutputFormat endedFormat = OutputFormat::Pcm;
    uint64_t endedGeneration = 0;
    bool gaplessStateChanged = false;
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        endedFormat = outputFormat_;
        switch (endedFormat)
        {
            case OutputFormat::Pcm:
                endedGeneration = pcm_.session_.generation();
                if (echoSrc_.active())
                {
                    if (gaplessEchoSrcActive_
                        && !gaplessEchoSrcCancelled_
                        && gaplessEchoSrcGeneration_ == endedGeneration)
                    {
                        std::vector<std::vector<float>> histories;
                        automixEchoSrc_.reset();
                        gaplessEchoSrcReady_ =
                            echoSrc_.copyLatestHistory(histories)
                            && automixEchoSrc_.restoreHistory(histories);
                        if (!gaplessEchoSrcReady_)
                        {
                            gaplessEchoSrcCancelled_ = true;
                            tail.format = OutputFormat::Pcm;
                            tail.sourceGeneration = endedGeneration;
                            tail.pcm = echoSrc_.flush();
                        }
                        else if (!gaplessPendingInput_.empty())
                        {
                            gaplessPrime = automixEchoSrc_.process(
                                gaplessPendingInput_.data(),
                                static_cast<int>(
                                    gaplessPendingInput_.size()
                                    / static_cast<size_t>(channels_)));
                            gaplessPendingInput_.clear();
                        }
                        gaplessStateChanged = true;
                    }
                    else
                    {
                        tail.format = OutputFormat::Pcm;
                        tail.sourceGeneration = endedGeneration;
                        tail.pcm = echoSrc_.flush();
                    }
                }
                break;
            case OutputFormat::Dop:
                endedGeneration = dop_.generation();
                break;
            case OutputFormat::NativeDsd:
                endedGeneration = nativeDsd_.generation();
                break;
        }
    }

    // A ring push may wait for a paused device to drain, so never hold the
    // stateful processing lock while committing the FIR tail.
    if (!tail.pcm.empty() && !pushPreparedOutput(tail))
        return;
    if (!gaplessPrime.empty()
        && (endedGeneration != pcm_.session_.generation()
            || !pcm_.pushAutomixNext(
                gaplessPrime.data(),
                static_cast<int>(
                    gaplessPrime.size()
                    / static_cast<size_t>(channels_)))))
        return;
    if (gaplessStateChanged)
        gaplessStateChanged_.notify_all();

    std::lock_guard<std::mutex> lock(processingMutex_);
    if (outputFormat_ != endedFormat)
        return;
    const uint64_t currentGeneration =
        endedFormat == OutputFormat::Pcm
        ? pcm_.session_.generation()
        : endedFormat == OutputFormat::Dop
            ? dop_.generation()
            : nativeDsd_.generation();
    if (currentGeneration != endedGeneration)
        return;

    // Keep the legacy all-source markers in sync, while the generation check
    // prevents a stale producer from ending a replacement/seek session.
    pcm_.markInputEnded();
    dop_.markInputEnded();
    nativeDsd_.markInputEnded();
}

void NativePlaybackPipeline::requestStop()
{
    pcm_.requestStop();
    dop_.requestStop();
    nativeDsd_.requestStop();
}

void NativePlaybackPipeline::setPaused(bool paused)
{
    pcm_.setPaused(paused);
    dop_.setPaused(paused);
    nativeDsd_.setPaused(paused);
}

void NativePlaybackPipeline::setGain(float gain)
{
    const float normalized = std::max(0.0f, std::min(1.0f, gain));
    gain_.store(normalized, std::memory_order_release);
    pcm_.setGain(normalized);
}

bool NativePlaybackPipeline::prepareGapless()
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    if (outputFormat_ != OutputFormat::Pcm
        || processingStatus_.sdm.active)
        return false;
    if (processingStatus_.echoSrc.active && pcm_.hasInputEnded())
        return false;

    gaplessEchoSrcActive_ = processingStatus_.echoSrc.active;
    gaplessEchoSrcReady_ = false;
    gaplessEchoSrcCancelled_ = false;
    gaplessEchoSrcGeneration_ = pcm_.session_.generation();
    gaplessPendingInput_.clear();
    pcm_.prepareGapless();
    return true;
}

bool NativePlaybackPipeline::pushGaplessNext(const float* samples, int frames)
{
    if (samples == nullptr || frames <= 0)
        return frames == 0;

    std::vector<float> prepared;
    uint64_t sourceGeneration = 0;
    {
        std::unique_lock<std::mutex> lock(processingMutex_);
        if (!gaplessEchoSrcActive_)
        {
            lock.unlock();
            return pcm_.pushAutomixNext(samples, frames);
        }

        sourceGeneration = gaplessEchoSrcGeneration_;
        if (!gaplessEchoSrcReady_)
        {
            if (gaplessPendingInput_.empty())
            {
                gaplessPendingInput_.assign(
                    samples,
                    samples
                        + static_cast<size_t>(frames)
                            * static_cast<size_t>(channels_));
                return true;
            }
            gaplessStateChanged_.wait(lock, [this, sourceGeneration] {
                return gaplessEchoSrcReady_
                    || gaplessEchoSrcCancelled_
                    || gaplessEchoSrcGeneration_ != sourceGeneration
                    || pcm_.session_.generation() != sourceGeneration;
            });
        }
        if (gaplessEchoSrcCancelled_
            || !gaplessEchoSrcReady_
            || gaplessEchoSrcGeneration_ != sourceGeneration
            || pcm_.session_.generation() != sourceGeneration)
            return false;

        if (!gaplessPendingInput_.empty())
        {
            prepared = automixEchoSrc_.process(
                gaplessPendingInput_.data(),
                static_cast<int>(
                    gaplessPendingInput_.size()
                    / static_cast<size_t>(channels_)));
            gaplessPendingInput_.clear();
        }
        auto block = automixEchoSrc_.process(samples, frames);
        prepared.insert(prepared.end(), block.begin(), block.end());
    }
    return sourceGeneration == pcm_.session_.generation()
        && pcm_.pushAutomixNext(
            prepared.data(),
            static_cast<int>(
                prepared.size() / static_cast<size_t>(channels_)));
}

void NativePlaybackPipeline::markGaplessNextEnded()
{
    std::vector<float> prepared;
    uint64_t sourceGeneration = 0;
    {
        std::unique_lock<std::mutex> lock(processingMutex_);
        if (!gaplessEchoSrcActive_)
        {
            lock.unlock();
            pcm_.markAutomixNextEnded();
            return;
        }

        sourceGeneration = gaplessEchoSrcGeneration_;
        if (!gaplessEchoSrcReady_)
        {
            gaplessStateChanged_.wait(lock, [this, sourceGeneration] {
                return gaplessEchoSrcReady_
                    || gaplessEchoSrcCancelled_
                    || gaplessEchoSrcGeneration_ != sourceGeneration
                    || pcm_.session_.generation() != sourceGeneration;
            });
        }
        if (gaplessEchoSrcCancelled_
            || !gaplessEchoSrcReady_
            || gaplessEchoSrcGeneration_ != sourceGeneration
            || pcm_.session_.generation() != sourceGeneration)
            return;

        if (!gaplessPendingInput_.empty())
        {
            prepared = automixEchoSrc_.process(
                gaplessPendingInput_.data(),
                static_cast<int>(
                    gaplessPendingInput_.size()
                    / static_cast<size_t>(channels_)));
            gaplessPendingInput_.clear();
        }
        auto tail = automixEchoSrc_.flush();
        prepared.insert(prepared.end(), tail.begin(), tail.end());
    }
    if (!prepared.empty()
        && (sourceGeneration != pcm_.session_.generation()
            || !pcm_.pushAutomixNext(
                prepared.data(),
                static_cast<int>(
                    prepared.size() / static_cast<size_t>(channels_)))))
        return;
    if (sourceGeneration == pcm_.session_.generation())
        pcm_.markAutomixNextEnded();
}

void NativePlaybackPipeline::cancelGapless()
{
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        gaplessEchoSrcActive_ = false;
        gaplessEchoSrcReady_ = false;
        gaplessEchoSrcCancelled_ = true;
        gaplessEchoSrcGeneration_ = 0;
        gaplessPendingInput_.clear();
    }
    gaplessStateChanged_.notify_all();
    pcm_.cancelAutomix();
}

uint64_t NativePlaybackPipeline::getGaplessBoundaryFrame() const
{
    return pcm_.getGaplessBoundaryFrame();
}

bool NativePlaybackPipeline::prepareAutomixFrames(
    uint64_t fadeStartFrame,
    uint64_t overlapFrames,
    double currentGainDb,
    double nextGainDb,
    double currentReplayGainDb,
    double nextReplayGainDb)
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    if (outputFormat_ != OutputFormat::Pcm
        || processingStatus_.sdm.active)
        return false;
    automixEchoSrc_.reset();
    return pcm_.prepareAutomixFrames(
        fadeStartFrame,
        overlapFrames,
        currentGainDb,
        nextGainDb,
        currentReplayGainDb,
        nextReplayGainDb);
}

bool NativePlaybackPipeline::pushAutomixNext(const float* samples, int frames)
{
    if (samples == nullptr || frames <= 0)
        return frames == 0;

    std::vector<float> prepared;
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        if (outputFormat_ != OutputFormat::Pcm)
            return false;
        prepared = automixEchoSrc_.process(samples, frames);
    }
    if (prepared.empty())
        return true;
    return pcm_.pushAutomixNext(
        prepared.data(),
        static_cast<int>(prepared.size() / static_cast<size_t>(channels_)));
}

void NativePlaybackPipeline::markAutomixNextEnded()
{
    std::vector<float> tail;
    uint64_t sourceGeneration = 0;
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        sourceGeneration = pcm_.session_.generation();
        if (outputFormat_ == OutputFormat::Pcm
            && processingStatus_.echoSrc.active)
            tail = automixEchoSrc_.flush();
    }
    if (!tail.empty()
        && (sourceGeneration != pcm_.session_.generation()
            || !pcm_.pushAutomixNext(
                tail.data(),
                static_cast<int>(
                    tail.size() / static_cast<size_t>(channels_)))))
        return;
    if (sourceGeneration != pcm_.session_.generation())
        return;
    pcm_.markAutomixNextEnded();
}

void NativePlaybackPipeline::failAutomixNext(uint64_t fadeFrames)
{
    pcm_.failAutomixNext(fadeFrames);
}

void NativePlaybackPipeline::cancelAutomix()
{
    pcm_.cancelAutomix();
}

uint64_t NativePlaybackPipeline::getAutomixFadeStartFrame() const
{
    return pcm_.getAutomixFadeStartFrame();
}

uint64_t NativePlaybackPipeline::getAutomixFadeEndFrame() const
{
    return pcm_.getAutomixFadeEndFrame();
}

bool NativePlaybackPipeline::isAutomixActive() const
{
    return outputFormat_ == OutputFormat::Pcm && pcm_.isAutomixActive();
}

std::vector<float> NativePlaybackPipeline::preparePcm(const float* samples, int frames)
{
    return echoSrc_.process(samples, frames);
}

bool NativePlaybackPipeline::prepareSdmPcm(
    const float* samples,
    int frames,
    std::vector<float>& output,
    std::string& error)
{
    output.assign(samples, samples + static_cast<size_t>(frames * channels_));
    if (sdmOversampler_.active())
    {
        output = sdmOversampler_.process(output.data(), frames);
        if (output.empty())
        {
            error = "native_sdm_oversampling_failed";
            return false;
        }
    }
    if (sdmDsp_ != nullptr && !sdmDsp_->process(output, error))
        return false;
    sdm_.setTargetGain(gain_.load(std::memory_order_acquire));
    error.clear();
    return true;
}

bool NativePlaybackPipeline::prepareOutputLocked(
    const float* samples,
    int frames,
    PreparedOutput& output,
    std::string& error)
{
    if (samples == nullptr || frames <= 0)
        return frames == 0;

    output = {};
    output.format = outputFormat_;
    switch (output.format)
    {
        case OutputFormat::Pcm: output.sourceGeneration = pcm_.session_.generation(); break;
        case OutputFormat::Dop: output.sourceGeneration = dop_.generation(); break;
        case OutputFormat::NativeDsd: output.sourceGeneration = nativeDsd_.generation(); break;
    }
    if (output.format == OutputFormat::Pcm)
    {
        output.pcm = preparePcm(samples, frames);
        error.clear();
        return true;
    }

    std::vector<float> pcm;
    if (!prepareSdmPcm(samples, frames, pcm, error))
        return false;
    const int outputFrames = static_cast<int>(pcm.size() / static_cast<size_t>(channels_));
    if (output.format == OutputFormat::Dop)
    {
        output.dop = sdm_.processDop(pcm.data(), outputFrames);
        error.clear();
        return true;
    }
    output.nativeDsd = sdm_.processNativeDsd(pcm.data(), outputFrames);
    error.clear();
    return true;
}

bool NativePlaybackPipeline::pushPreparedOutput(const PreparedOutput& output)
{
    switch (output.format)
    {
        case OutputFormat::Pcm:
            return pcm_.pushForGeneration(
                output.pcm.data(), static_cast<int>(output.pcm.size() / static_cast<size_t>(channels_)), output.sourceGeneration);
        case OutputFormat::Dop:
            return dop_.pushForGeneration(
                output.dop.data(), static_cast<int>(output.dop.size() / static_cast<size_t>(channels_)), output.sourceGeneration);
        case OutputFormat::NativeDsd:
            return nativeDsd_.pushForGeneration(
                output.nativeDsd.data(), static_cast<int>(output.nativeDsd.size() / static_cast<size_t>(channels_)), output.sourceGeneration);
    }
    return false;
}

bool NativePlaybackPipeline::push(const float* samples, int frames)
{
    if (samples == nullptr || frames <= 0)
        return frames == 0;

    PreparedOutput output;
    std::string error;
    {
        // Keep stateful FIR/SDM/PCM-DSP work serialized, but never hold this
        // mutex across a ring push: push may wait for a paused device to drain.
        std::lock_guard<std::mutex> lock(processingMutex_);
        if (!prepareOutputLocked(samples, frames, output, error))
            return false;
    }
    return pushPreparedOutput(output);
}

bool NativePlaybackPipeline::pushForGeneration(const float* samples, int frames, uint64_t generation)
{
    if (samples == nullptr || frames <= 0)
        return frames == 0 && generation == this->generation();

    PreparedOutput output;
    std::string error;
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        if (generation != this->generation()
            || !prepareOutputLocked(samples, frames, output, error))
            return false;
    }

    return generation == this->generation() && pushPreparedOutput(output);
}

int NativePlaybackPipeline::replacePreparedOutput(
    const PreparedOutput& output,
    int inputFrames,
    bool pausedAfterReplace)
{
    switch (output.format)
    {
        case OutputFormat::Pcm:
            return pcm_.replaceBufferedAudio(
                output.pcm.data(), static_cast<int>(output.pcm.size() / static_cast<size_t>(channels_)), pausedAfterReplace) > 0
                ? inputFrames : 0;
        case OutputFormat::Dop:
            return dop_.replaceBufferedAudio(
                output.dop.data(), static_cast<int>(output.dop.size() / static_cast<size_t>(channels_)), pausedAfterReplace) > 0
                ? inputFrames : 0;
        case OutputFormat::NativeDsd:
            return nativeDsd_.replaceBufferedAudio(
                output.nativeDsd.data(), static_cast<int>(output.nativeDsd.size() / static_cast<size_t>(channels_)), pausedAfterReplace) > 0
                ? inputFrames : 0;
    }
    return 0;
}

int NativePlaybackPipeline::replaceBufferedAudio(const float* samples, int frames, bool pausedAfterReplace)
{
    return replaceBufferedAudioWithPreroll(
        samples,
        frames,
        0,
        pausedAfterReplace);
}

int NativePlaybackPipeline::replaceBufferedAudioWithPreroll(
    const float* samples,
    int frames,
    int prerollFrames,
    bool pausedAfterReplace)
{
    PreparedOutput output;
    std::string error;
    int discardedInputFrames = 0;
    {
        std::lock_guard<std::mutex> lock(processingMutex_);
        resetProcessorsLocked();
        if (!prepareOutputLocked(samples, frames, output, error))
            return 0;
        if (output.format == OutputFormat::Pcm
            && echoSrc_.active()
            && prerollFrames > 0)
        {
            discardedInputFrames = std::min(prerollFrames, frames);
            const size_t discardedOutputSamples =
                static_cast<size_t>(discardedInputFrames)
                * static_cast<size_t>(echoSrc_.outputFactor())
                * static_cast<size_t>(channels_);
            if (discardedOutputSamples >= output.pcm.size())
                return 0;
            output.pcm.erase(
                output.pcm.begin(),
                output.pcm.begin()
                    + static_cast<std::ptrdiff_t>(
                        discardedOutputSamples));
        }
    }
    return replacePreparedOutput(
        output,
        frames - discardedInputFrames,
        pausedAfterReplace);
}

int NativePlaybackPipeline::seekPrerollFrames() const
{
    std::lock_guard<std::mutex> lock(processingMutex_);
    return outputFormat_ == OutputFormat::Pcm && echoSrc_.active()
        ? echoSrc_.prerollInputFrames()
        : 0;
}

bool NativePlaybackPipeline::isDrained() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.isDrained();
        case OutputFormat::NativeDsd: return nativeDsd_.isDrained();
        case OutputFormat::Pcm: return pcm_.isDrained();
    }
    return true;
}

bool NativePlaybackPipeline::hasInputEnded() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.hasInputEnded();
        case OutputFormat::NativeDsd: return nativeDsd_.hasInputEnded();
        case OutputFormat::Pcm: return pcm_.hasInputEnded();
    }
    return true;
}

int NativePlaybackPipeline::getReadyFrames() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.getReadyFrames();
        case OutputFormat::NativeDsd: return static_cast<int>(nativeDsd_.getReadyFrames());
        case OutputFormat::Pcm: return pcm_.getReadyFrames();
    }
    return 0;
}

uint64_t NativePlaybackPipeline::getFramesPlayed() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.getFramesPlayed();
        case OutputFormat::NativeDsd: return nativeDsd_.getFramesPlayed();
        case OutputFormat::Pcm: return pcm_.getFramesPlayed();
    }
    return 0;
}

uint64_t NativePlaybackPipeline::getUnderrunCallbacks() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.getUnderrunCallbacks();
        case OutputFormat::NativeDsd: return nativeDsd_.getUnderrunCallbacks();
        case OutputFormat::Pcm: return pcm_.getUnderrunCallbacks();
    }
    return 0;
}

uint64_t NativePlaybackPipeline::getUnderrunFrames() const
{
    switch (outputFormat())
    {
        case OutputFormat::Dop: return dop_.getUnderrunFrames();
        case OutputFormat::NativeDsd: return nativeDsd_.getUnderrunFrames();
        case OutputFormat::Pcm: return pcm_.getUnderrunFrames();
    }
    return 0;
}
