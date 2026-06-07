#include "UzumeEngine.h"

#include <algorithm>
#include <array>
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
    constexpr float threshold = 0.98f;
    constexpr float headroom = 1.0f - threshold;

    const float sanitized = sanitizeSample(sample);
    const float magnitude = std::abs(sanitized);
    if (magnitude <= threshold)
        return sanitized;

    risk = true;
    const float limited = threshold + headroom * std::tanh((magnitude - threshold) / headroom);
    return std::copysign(std::min(1.0f, limited), sanitized);
}

const char* classifyPlaybackBackend(bool playbackGpuMatrix, bool playbackGpuLimiter)
{
    if (playbackGpuMatrix && playbackGpuLimiter)
        return "hybrid-gpu-matrix-limiter";

    if (playbackGpuMatrix)
        return "hybrid-gpu-matrix";

    if (playbackGpuLimiter)
        return "hybrid-gpu-limiter";

    return "cpu-reference";
}

const UzumeGpuBackendProbe& cachedGpuProbe()
{
    static const UzumeGpuBackendProbe probe = probeUzumeGpuBackend();
    return probe;
}

constexpr int maxPlanarLimiterChannels = 64;
} // namespace

UzumeEngine::UzumeEngine(
    EqProcessor& eqProcessorToUse,
    ConvolutionProcessor& convolutionProcessorToUse,
    ChannelBalanceProcessor& channelBalanceProcessorToUse,
    DspHeadroomProcessor& headroomProcessorToUse)
    : eqProcessor(eqProcessorToUse),
      convolutionProcessor(convolutionProcessorToUse),
      channelBalanceProcessor(channelBalanceProcessorToUse),
      headroomProcessor(headroomProcessorToUse)
{
}

void UzumeEngine::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    eqProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    convolutionProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    channelBalanceProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    headroomProcessor.prepare(sampleRate, maximumBlockSize, channelCount);
    wasActive = isActive();
    bypassTailBlocksRemaining = wasActive ? bypassTailBlocks : 0;
    resetGpuLimiterPlaybackStatus();
    prepareUzumeGpuPlaybackSafetyLimiter(std::max(1, maximumBlockSize));
    prepareUzumeGpuPlaybackPlanarSafetyLimiter(std::max(1, maximumBlockSize), std::min(std::max(1, channelCount), maxPlanarLimiterChannels));
    prepareUzumeGpuPlaybackStereoMatrixLimiter(std::max(1, maximumBlockSize));
    const auto fftPrepareStatus = prepareUzumeGpuPlaybackFftConvolution(std::max(1, maximumBlockSize), roomCorrectionMaxTaps);
    const auto streamingFftPrepareStatus = prepareUzumeGpuPlaybackStreamingFftConvolution(std::max(1, maximumBlockSize), roomCorrectionMaxTaps);
    gpuFftConvolutionPrepared.store(fftPrepareStatus.prepared || streamingFftPrepareStatus.prepared, std::memory_order_release);
}

void UzumeEngine::reset()
{
    eqProcessor.reset();
    convolutionProcessor.reset();
    channelBalanceProcessor.reset();
    headroomProcessor.reset();
    wasActive = false;
    bypassTailBlocksRemaining = 0;
    safetyLimiterClippingRisk.store(false, std::memory_order_release);
    resetGpuLimiterPlaybackStatus();
    resetUzumeGpuPlaybackStreamingFftConvolution();
}

void UzumeEngine::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    const bool active = isActive();

    if (! active && ! wasActive && bypassTailBlocksRemaining <= 0)
    {
        safetyLimiterClippingRisk.store(false, std::memory_order_release);
        resetGpuLimiterPlaybackStatus();
        return;
    }

    if (active)
        headroomProcessor.processBlock(buffer, startSample, numSamples);
    eqProcessor.processBlock(buffer, startSample, numSamples);
    convolutionProcessor.processBlock(buffer, startSample, numSamples);
    channelBalanceProcessor.processBlock(buffer, startSample, numSamples);
    processSafetyLimiter(buffer, startSample, numSamples);

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

bool UzumeEngine::isActive() const
{
    return headroomProcessor.isEnabled()
        || eqProcessor.isEnabled()
        || convolutionProcessor.isEnabled()
        || channelBalanceProcessor.isEnabled();
}

bool UzumeEngine::hasClippingRisk() const
{
    return eqProcessor.hasClippingRisk()
        || convolutionProcessor.hasClippingRisk()
        || channelBalanceProcessor.hasClippingRisk()
        || safetyLimiterClippingRisk.load(std::memory_order_acquire);
}

bool UzumeEngine::isSafetyLimiterProtecting() const
{
    return safetyLimiterClippingRisk.load(std::memory_order_acquire);
}

UzumeRuntimeStatus UzumeEngine::getRuntimeStatus() const
{
    const auto& gpuProbe = cachedGpuProbe();
    const bool gpuReady = gpuProbe.compiled && gpuProbe.available;
    const bool playbackGpuLimiter = gpuLimiterPlaybackProcessed.load(std::memory_order_acquire);
    const bool playbackGpuFallback = gpuLimiterPlaybackFallback.load(std::memory_order_acquire);
    const auto* playbackGpuFallbackReason = gpuLimiterPlaybackFallbackReason.load(std::memory_order_acquire);
    const bool playbackGpuMatrix = channelBalanceProcessor.didUseGpuMatrixPlayback();
    const bool playbackGpuMatrixFallback = channelBalanceProcessor.hadGpuMatrixPlaybackFallback();
    const auto* playbackGpuMatrixFallbackReason = channelBalanceProcessor.getGpuMatrixPlaybackFallbackReason();
    const bool backendFallbackActive = (gpuProbe.compiled && ! gpuReady) || playbackGpuFallback || playbackGpuMatrixFallback;
    const auto* backendFallbackReason = playbackGpuFallbackReason != nullptr
        ? playbackGpuFallbackReason
        : (playbackGpuMatrixFallbackReason != nullptr
            ? playbackGpuMatrixFallbackReason
            : (gpuProbe.compiled && ! gpuReady ? gpuProbe.fallbackReason : nullptr));
    const bool active = isActive();

    return {
        active,
        hasClippingRisk(),
        isSafetyLimiterProtecting(),
        backendFallbackActive,
        classifyPlaybackBackend(playbackGpuMatrix, playbackGpuLimiter),
        "uzume-skeleton-compat",
        active ? "transitional-processor-chain" : "identity-bypass",
        gpuProbe.compiled,
        gpuReady,
        gpuProbe.cufftAvailable,
        playbackGpuLimiter,
        playbackGpuMatrix,
        gpuFftConvolutionPrepared.load(std::memory_order_acquire),
        gpuProbe.deviceName,
        backendFallbackReason,
        gpuProbe.cufftFallbackReason,
        gpuProbe.cudaRuntimeVersion,
        gpuProbe.cufftVersion,
        active ? "pcm_processed" : "pcm_bitperfect",
        active ? "disabled" : "available",
        active ? "uzume_processing_enabled" : nullptr,
        headroomProcessor.isEnabled(),
        "legacy-convolution-processor",
        false,
        active ? nullptr : "identity-bypass",
    };
}

void UzumeEngine::processSafetyLimiter(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
    {
        safetyLimiterClippingRisk.store(false, std::memory_order_release);
        resetGpuLimiterPlaybackStatus();
        return;
    }

    const int channelCount = buffer.getNumChannels();
    bool risk = false;
    bool gpuProcessed = false;
    bool gpuFallback = false;
    const char* gpuFallbackReason = nullptr;
    bool canAttemptStereoPairGpu = true;
    int channel = 0;

    if (channelCount > 0 && channelCount <= maxPlanarLimiterChannels)
    {
        std::array<float*, maxPlanarLimiterChannels> channelSamples {};
        bool hasAllChannelPointers = true;
        for (int currentChannel = 0; currentChannel < channelCount; ++currentChannel)
        {
            channelSamples[static_cast<size_t>(currentChannel)] = buffer.getWritePointer(currentChannel, startSample);
            if (channelSamples[static_cast<size_t>(currentChannel)] == nullptr)
                hasAllChannelPointers = false;
        }

        if (hasAllChannelPointers)
        {
            const auto gpuResult = processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(channelSamples.data(), channelCount, numSamples);
            if (gpuResult.processed)
            {
                gpuLimiterPlaybackProcessed.store(true, std::memory_order_release);
                gpuLimiterPlaybackFallback.store(false, std::memory_order_release);
                gpuLimiterPlaybackFallbackReason.store(nullptr, std::memory_order_release);
                safetyLimiterClippingRisk.store(gpuResult.clippingRisk, std::memory_order_release);
                return;
            }

            if (gpuResult.available || gpuResult.fallbackReason != nullptr)
            {
                gpuFallback = gpuFallback || gpuResult.available;
                if (gpuFallbackReason == nullptr && gpuResult.available)
                    gpuFallbackReason = gpuResult.fallbackReason;
            }
        }
    }

    while (channel < channelCount)
    {
        if (canAttemptStereoPairGpu && channel + 1 < channelCount)
        {
            auto* leftSamples = buffer.getWritePointer(channel, startSample);
            auto* rightSamples = buffer.getWritePointer(channel + 1, startSample);
            if (leftSamples != nullptr && rightSamples != nullptr)
            {
                const UzumeGpuStereoMatrix identityStereo {
                    1.0f,
                    0.0f,
                    0.0f,
                    1.0f,
                    1.0f,
                };
                const auto gpuResult = processUzumeGpuPreparedPlaybackStereoMatrixLimiter(leftSamples, rightSamples, numSamples, identityStereo);
                if (gpuResult.processed)
                {
                    gpuProcessed = true;
                    risk = risk || gpuResult.clippingRisk;
                    channel += 2;
                    continue;
                }

                canAttemptStereoPairGpu = false;
                if (gpuResult.available || gpuResult.fallbackReason != nullptr)
                {
                    gpuFallback = gpuFallback || gpuResult.available;
                    if (gpuFallbackReason == nullptr && gpuResult.available)
                        gpuFallbackReason = gpuResult.fallbackReason;
                }
            }
        }

        auto* samples = buffer.getWritePointer(channel, startSample);
        if (samples == nullptr)
        {
            ++channel;
            continue;
        }

        const auto gpuResult = processUzumeGpuPreparedPlaybackSafetyLimiter(samples, numSamples);
        if (gpuResult.processed)
        {
            gpuProcessed = true;
            risk = risk || gpuResult.clippingRisk;
            ++channel;
            continue;
        }

        if (gpuResult.available || gpuResult.fallbackReason != nullptr)
        {
            gpuFallback = gpuFallback || gpuResult.available;
            if (gpuFallbackReason == nullptr && gpuResult.available)
                gpuFallbackReason = gpuResult.fallbackReason;
        }

        for (int sample = 0; sample < numSamples; ++sample)
            samples[sample] = softLimitSample(samples[sample], risk);

        ++channel;
    }

    gpuLimiterPlaybackProcessed.store(gpuProcessed, std::memory_order_release);
    gpuLimiterPlaybackFallback.store(gpuFallback, std::memory_order_release);
    gpuLimiterPlaybackFallbackReason.store(gpuFallbackReason, std::memory_order_release);
    safetyLimiterClippingRisk.store(risk, std::memory_order_release);
}

void UzumeEngine::resetGpuLimiterPlaybackStatus()
{
    channelBalanceProcessor.clearGpuPlaybackStatus();
    gpuLimiterPlaybackProcessed.store(false, std::memory_order_release);
    gpuLimiterPlaybackFallback.store(false, std::memory_order_release);
    gpuLimiterPlaybackFallbackReason.store(nullptr, std::memory_order_release);
}
} // namespace echo
