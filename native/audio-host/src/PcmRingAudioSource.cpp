#include "PcmRingAudioSource.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <thread>

namespace { constexpr double halfPi = 1.57079632679489661923; }

#ifdef _WIN32
#include <avrt.h>
#include <windows.h>

namespace pcm_detail {

struct PcmCallbackMmcssRegistration
{
    HANDLE handle = nullptr;

    PcmCallbackMmcssRegistration()
    {
        DWORD taskIndex = 0;
        handle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
        if (handle != nullptr)
            AvSetMmThreadPriority(handle, AVRT_PRIORITY_CRITICAL);
    }

    ~PcmCallbackMmcssRegistration()
    {
        if (handle != nullptr)
            AvRevertMmThreadCharacteristics(handle);
    }
};

void configureAudioCallbackThread()
{
    thread_local std::unique_ptr<PcmCallbackMmcssRegistration> registration;
    if (registration == nullptr)
        registration = std::make_unique<PcmCallbackMmcssRegistration>();
}

} // namespace pcm_detail
#else
namespace pcm_detail {
void configureAudioCallbackThread() {}
}
#endif

PcmRingAudioSource::PcmRingAudioSource(
    int channelCount,
    int capacityFrames,
    int startupPrebufferFramesToUse,
    int startupPrebufferTimeoutMsToUse,
    double gainToUse,
    echo::EqProcessor& eqProcessorToUse,
    echo::ChannelBalanceProcessor& channelBalanceProcessorToUse)
    : channels(channelCount),
      gain(static_cast<float>(std::max(0.0, std::min(1.0, gainToUse)))),
      startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
      startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
      fifo(capacityFrames),
      buffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
      automixFifo(capacityFrames),
      automixBuffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
      ownedConvolutionProcessor(std::make_unique<echo::ConvolutionProcessor>()),
      convolutionProcessor(ownedConvolutionProcessor.get()),
      ownedHeadroomProcessor(std::make_unique<echo::DspHeadroomProcessor>()),
      headroomProcessor(ownedHeadroomProcessor.get()),
      ownedReplayGainProcessor(std::make_unique<echo::ReplayGainProcessor>()),
      replayGainProcessor(ownedReplayGainProcessor.get()),
      ownedRateProcessor(std::make_unique<echo::PlaybackRateProcessor>()),
      rateProcessor(ownedRateProcessor.get()),
      ownedMeterProcessor(std::make_unique<echo::LevelMeterProcessor>()),
      meterProcessor(ownedMeterProcessor.get()),
      dspChain(eqProcessorToUse, *convolutionProcessor, channelBalanceProcessorToUse, *headroomProcessor,
               *ownedReplayGainProcessor, *ownedRateProcessor, *ownedMeterProcessor)
{
}

PcmRingAudioSource::PcmRingAudioSource(
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
    echo::LevelMeterProcessor& meterProcessorToUse)
    : channels(channelCount),
      gain(static_cast<float>(std::max(0.0, std::min(1.0, gainToUse)))),
      startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
      startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
      fifo(capacityFrames),
      buffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
      automixFifo(capacityFrames),
      automixBuffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
      convolutionProcessor(&convolutionProcessorToUse),
      headroomProcessor(&headroomProcessorToUse),
      replayGainProcessor(&replayGainProcessorToUse),
      rateProcessor(&rateProcessorToUse),
      meterProcessor(&meterProcessorToUse),
      dspChain(eqProcessorToUse, *convolutionProcessor, channelBalanceProcessorToUse, *headroomProcessor,
               *replayGainProcessor, *rateProcessor, *meterProcessor)
{
}

void PcmRingAudioSource::prepareToPlay(int samplesPerBlockExpected, double sampleRate)
{
    configureDeclickRamp(sampleRate);
    dspChain.prepare(sampleRate, samplesPerBlockExpected, channels);
}

void PcmRingAudioSource::prepareForNativeRender(int maxFramesPerCallback, double sampleRate)
{
    const int safeFrames = std::max(1, maxFramesPerCallback);
    nativeRenderBuffer.setSize(channels, safeFrames);
    configureDeclickRamp(sampleRate);
    dspChain.prepare(sampleRate, safeFrames, channels);
}

void PcmRingAudioSource::releaseResources()
{
    dspChain.reset();
}

bool PcmRingAudioSource::isDspActive() const
{
    return dspChain.isActive();
}

bool PcmRingAudioSource::hasDspClippingRisk() const
{
    return dspChain.hasClippingRisk();
}

bool PcmRingAudioSource::isDspLimiterProtecting() const
{
    return dspChain.isSafetyLimiterProtecting();
}

uint32_t PcmRingAudioSource::renderInterleaved(float* output, uint32_t frameCount, uint32_t outputChannels)
{
    return renderInterleaved({ output, frameCount, outputChannels });
}

uint32_t PcmRingAudioSource::renderInterleaved(echo_audio_host::FloatInterleavedRenderTarget target)
{
    auto* output = target.samples;
    const auto frameCount = target.frames;
    const auto outputChannels = target.channels;

    if (output == nullptr || frameCount == 0 || outputChannels == 0)
        return 0;

    std::memset(output, 0, static_cast<size_t>(frameCount) * outputChannels * sizeof(float));

    const int scratchFrames = nativeRenderBuffer.getNumSamples();
    if (scratchFrames <= 0)
        return 0;

    uint32_t renderedFrames = 0;
    uint32_t totalFramesRead = 0;

    while (renderedFrames < frameCount)
    {
        const int framesThisChunk = static_cast<int>(std::min<uint32_t>(
            static_cast<uint32_t>(scratchFrames),
            frameCount - renderedFrames));
        const auto framesRead = renderPlanar(nativeRenderBuffer, 0, framesThisChunk);
        copyPlanarToInterleaved(
            nativeRenderBuffer,
            output + static_cast<size_t>(renderedFrames) * outputChannels,
            framesThisChunk,
            static_cast<int>(outputChannels));
        totalFramesRead += static_cast<uint32_t>(framesRead);
        renderedFrames += static_cast<uint32_t>(framesThisChunk);
    }

    return totalFramesRead;
}

uint64_t PcmRingAudioSource::renderPlanar(echo::FloatAudioBuffer& output, int startSample, int frameCount)
{
    if (frameCount <= 0)
        return 0;

    output.clear(startSample, frameCount);

    if (sessionPaused.load(std::memory_order_acquire))
        return 0;

    if (shouldHoldForStartupPrebuffer())
        return 0;

    const uint64_t absoluteStartFrame = framesPlayed.load(std::memory_order_relaxed);
    activateAutomixFadeIfReady(absoluteStartFrame, frameCount);
    const float playbackRate = rateProcessor != nullptr ? rateProcessor->getRate() : 1.0f;
    const bool playbackRateActive = std::abs(playbackRate - 1.0f) > 0.0001f;
    const int sourceFrameTarget = playbackRateActive
        ? std::max(1, static_cast<int>(std::ceil(static_cast<double>(frameCount) * static_cast<double>(playbackRate))))
        : frameCount;
    if (playbackRateActive)
    {
        playbackRateInputBuffer.setSize(output.getNumChannels(), sourceFrameTarget);
        playbackRateInputBuffer.clear(0, sourceFrameTarget);
    }

    echo::FloatAudioBuffer& renderBuffer = playbackRateActive ? playbackRateInputBuffer : output;
    const int renderStartSample = playbackRateActive ? 0 : startSample;
    int framesNeeded = sourceFrameTarget;
    int outputOffset = 0;
    uint64_t framesReadTotal = 0;

    {
        std::unique_lock<std::mutex> lock(fifoMutex, std::try_to_lock);
        if (!lock.owns_lock())
        {
            renderBuffer.clear(0, sourceFrameTarget);
            return 0;
        }

        while (framesNeeded > 0)
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            fifo.prepareToRead(framesNeeded, start1, size1, start2, size2);

            const int framesRead = size1 + size2;
            if (framesRead <= 0)
            {
                if (! session_.isInputEnded() && session_.hasAudio())
                {
                    underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                    underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                }
                break;
            }

            copyToOutput(start1, size1, renderBuffer, renderStartSample + outputOffset, absoluteStartFrame + static_cast<uint64_t>(outputOffset));
            copyToOutput(
                start2,
                size2,
                renderBuffer,
                renderStartSample + outputOffset + size1,
                absoluteStartFrame + static_cast<uint64_t>(outputOffset + size1));
            fifo.finishedRead(framesRead);

            framesReadTotal += static_cast<uint64_t>(framesRead);
            framesNeeded -= framesRead;
            outputOffset += framesRead;
        }
    }

    const bool mainInputEnded = session_.isInputEnded();
    const int automixFrameBudget = mainInputEnded
        ? sourceFrameTarget
        : static_cast<int>(std::min<uint64_t>(static_cast<uint64_t>(sourceFrameTarget), framesReadTotal));
    const uint64_t automixFramesRead = automixFrameBudget > 0
        ? mixAutomixNext(renderBuffer, renderStartSample, automixFrameBudget, absoluteStartFrame)
        : 0;
    const uint64_t renderedFrames = automixPlan.enabled.load(std::memory_order_acquire)
        ? (mainInputEnded ? std::max(framesReadTotal, automixFramesRead) : framesReadTotal)
        : framesReadTotal;

    if (renderedFrames > 0)
        framesPlayed.fetch_add(renderedFrames, std::memory_order_relaxed);

    if (playbackRateActive)
        resamplePlaybackRate(renderBuffer, output, startSample, frameCount, static_cast<int>(framesReadTotal), playbackRate);

    {
        echo::FloatAudioBuffer echoBuf(output.getNumChannels(), output.getNumSamples());
        for (int c = 0; c < output.getNumChannels(); ++c)
        {
            const float* src = output.getReadPointer(c);
            float* dst = echoBuf.getWritePointer(c);
            std::copy_n(src, static_cast<std::size_t>(output.getNumSamples()), dst);
        }
        dspChain.processBlock(echoBuf, startSample, frameCount);
        for (int c = 0; c < output.getNumChannels(); ++c)
        {
            float* dst = output.getWritePointer(c);
            const float* src = echoBuf.getReadPointer(c);
            std::copy_n(src, static_cast<std::size_t>(output.getNumSamples()), dst);
        }
    }
    applyDeclickRamp(output, startSample, frameCount);

    return renderedFrames;
}

bool PcmRingAudioSource::push(const float* samples, int frameCount)
{
    if (frameCount > 0)
        session_.markHasAudio();

    int written = 0;

    while (written < frameCount && ! session_.isStopRequested())
    {
        int start1 = 0;
        int size1 = 0;
        int start2 = 0;
        int size2 = 0;
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            fifo.prepareToWrite(frameCount - written, start1, size1, start2, size2);

            const int framesWritable = size1 + size2;
            if (framesWritable > 0)
            {
                copyFromInput(samples + written * channels, start1, size1);
                copyFromInput(samples + (written + size1) * channels, start2, size2);
                fifo.finishedWrite(framesWritable);
                written += framesWritable;
                continue;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }

    return written == frameCount;
}

int PcmRingAudioSource::replaceBufferedAudio(const float* samples, int frameCount, bool pausedAfterReplace)
{
    session_.begin();
    int framesWritten = 0;
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        fifo.reset();
        prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(startupPrebufferTimeoutMs);
        if (samples != nullptr && frameCount > 0) {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            fifo.prepareToWrite(frameCount, start1, size1, start2, size2);
            framesWritten = size1 + size2;
            copyFromInput(samples, start1, size1);
            copyFromInput(samples + size1 * channels, start2, size2);
            fifo.finishedWrite(framesWritten);
        }
    }

    framesPlayed.store(0, std::memory_order_relaxed);
    underrunCallbacks.store(0, std::memory_order_relaxed);
    underrunFrames.store(0, std::memory_order_relaxed);
    sessionPaused.store(pausedAfterReplace, std::memory_order_release);
    stopFadeRequested.store(false, std::memory_order_release);
    declickFadeGeneration.fetch_add(1, std::memory_order_acq_rel);
    prebuffering.store(framesWritten <= 0 && startupPrebufferFrames > 0, std::memory_order_release);
    if (framesWritten > 0)
        session_.markHasAudio();
    cancelAutomix();
    return framesWritten;
}

bool PcmRingAudioSource::pushAutomixNext(const float* samples, int frameCount)
{
    if (frameCount > 0)
        automixNextHasAudio.store(true, std::memory_order_release);

    int written = 0;

    while (written < frameCount && ! session_.isStopRequested())
    {
        int start1 = 0;
        int size1 = 0;
        int start2 = 0;
        int size2 = 0;
        {
            std::lock_guard<std::mutex> lock(automixMutex);
            automixFifo.prepareToWrite(frameCount - written, start1, size1, start2, size2);

            const int framesWritable = size1 + size2;
            if (framesWritable > 0)
            {
                copyToAutomixBuffer(samples + written * channels, start1, size1);
                copyToAutomixBuffer(samples + (written + size1) * channels, start2, size2);
                automixFifo.finishedWrite(framesWritable);
                written += framesWritable;
                continue;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }

    return written == frameCount;
}

void PcmRingAudioSource::prepareAutomix(double sampleRate, double fadeStartSeconds, double overlapSeconds, double currentGainDb, double nextGainDb)
{
    const double safeSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    const auto fadeStart = static_cast<uint64_t>(std::max(0.0, fadeStartSeconds) * safeSampleRate);
    const auto overlapFrames = static_cast<uint64_t>(std::max(0.001, overlapSeconds) * safeSampleRate);
    const double releaseSeconds = std::clamp(std::max(0.001, overlapSeconds) * 0.5, 0.05, 4.0);
    const auto gainReleaseFrames = static_cast<uint64_t>(releaseSeconds * safeSampleRate);

    {
        std::lock_guard<std::mutex> lock(automixMutex);
        automixFifo.reset();
        std::fill(automixBuffer.begin(), automixBuffer.end(), 0.0f);
    }

    automixPlan.fadeStartFrame.store(fadeStart, std::memory_order_release);
    automixPlan.fadeEndFrame.store(fadeStart + std::max<uint64_t>(1, overlapFrames), std::memory_order_release);
    automixPlan.gainReleaseEndFrame.store(fadeStart + std::max<uint64_t>(1, overlapFrames) + std::max<uint64_t>(1, gainReleaseFrames), std::memory_order_release);
    automixPlan.overlapFrames.store(std::max<uint64_t>(1, overlapFrames), std::memory_order_release);
    automixPlan.currentGain.store(dbToGain(currentGainDb), std::memory_order_release);
    automixPlan.nextGain.store(dbToGain(nextGainDb), std::memory_order_release);
    automixPlan.fadeActivated.store(false, std::memory_order_release);
    automixPlan.enabled.store(true, std::memory_order_release);
    automixNextInputEnded.store(false, std::memory_order_release);
    automixNextHasAudio.store(false, std::memory_order_release);
}

void PcmRingAudioSource::markAutomixNextEnded()
{
    automixNextInputEnded.store(true, std::memory_order_release);
}

void PcmRingAudioSource::cancelAutomix()
{
    automixPlan.enabled.store(false, std::memory_order_release);
    automixPlan.fadeActivated.store(false, std::memory_order_release);
    automixNextInputEnded.store(false, std::memory_order_release);
    automixNextHasAudio.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(automixMutex);
        automixFifo.reset();
    }
}

void PcmRingAudioSource::beginSession()
{
    session_.begin();
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        fifo.reset();
        prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(startupPrebufferTimeoutMs);
    }

    framesPlayed.store(0, std::memory_order_relaxed);
    underrunCallbacks.store(0, std::memory_order_relaxed);
    underrunFrames.store(0, std::memory_order_relaxed);
    sessionPaused.store(false, std::memory_order_release);
    stopFadeRequested.store(false, std::memory_order_release);
    declickFadeGeneration.fetch_add(1, std::memory_order_acq_rel);
    prebuffering.store(startupPrebufferFrames > 0, std::memory_order_release);
    cancelAutomix();
}

void PcmRingAudioSource::markInputEnded()
{
    session_.markInputEnded();
}

void PcmRingAudioSource::requestStop()
{
    session_.requestStop();
    sessionPaused.store(false, std::memory_order_release);
    stopFadeRequested.store(true, std::memory_order_release);
}

void PcmRingAudioSource::setPaused(bool paused)
{
    sessionPaused.store(paused, std::memory_order_release);
}

void PcmRingAudioSource::setGain(float nextGain)
{
    if (! std::isfinite(nextGain))
        return;

    gain.store(std::max(0.0f, std::min(1.0f, nextGain)), std::memory_order_release);
}

bool PcmRingAudioSource::isDrained() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    const bool mainDrained = session_.isDrained(fifo.getNumReady() == 0);
    if (! mainDrained)
        return false;

    if (! automixPlan.enabled.load(std::memory_order_acquire))
        return true;

    std::lock_guard<std::mutex> automixLock(automixMutex);
    return automixNextInputEnded.load(std::memory_order_acquire) && automixFifo.getNumReady() == 0;
}

bool PcmRingAudioSource::hasInputEnded() const
{
    return session_.isInputEnded();
}

int PcmRingAudioSource::getReadyFrames() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    int ready = fifo.getNumReady();
    if (automixPlan.enabled.load(std::memory_order_acquire))
    {
        std::lock_guard<std::mutex> automixLock(automixMutex);
        ready += automixFifo.getNumReady();
    }
    return ready;
}

uint64_t PcmRingAudioSource::getFramesPlayed() const
{
    return framesPlayed.load(std::memory_order_relaxed);
}

uint64_t PcmRingAudioSource::getUnderrunCallbacks() const
{
    return underrunCallbacks.load(std::memory_order_relaxed);
}

uint64_t PcmRingAudioSource::getUnderrunFrames() const
{
    return underrunFrames.load(std::memory_order_relaxed);
}

echo::ReplayGainProcessor* PcmRingAudioSource::getReplayGainProcessor()
{
    return replayGainProcessor;
}

echo::PlaybackRateProcessor* PcmRingAudioSource::getRateProcessor()
{
    return rateProcessor;
}

echo::LevelMeterProcessor* PcmRingAudioSource::getMeterProcessor()
{
    return meterProcessor;
}

void PcmRingAudioSource::copyFromInput(const float* source, int startFrame, int frameCount)
{
    if (frameCount <= 0)
        return;

    std::memcpy(
        buffer.data() + static_cast<size_t>(startFrame * channels),
        source,
        static_cast<size_t>(frameCount * channels) * sizeof(float));
}

float PcmRingAudioSource::dbToGain(double db)
{
    if (! std::isfinite(db))
        return 1.0f;

    return static_cast<float>(std::pow(10.0, std::max(-24.0, std::min(12.0, db)) / 20.0));
}

void PcmRingAudioSource::activateAutomixFadeIfReady(uint64_t absoluteStartFrame, int frameCount)
{
    if (frameCount <= 0 || ! automixPlan.enabled.load(std::memory_order_acquire) || automixPlan.fadeActivated.load(std::memory_order_acquire))
        return;

    const uint64_t plannedFadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
    if (absoluteStartFrame + static_cast<uint64_t>(frameCount) <= plannedFadeStartFrame)
        return;

    {
        std::lock_guard<std::mutex> lock(automixMutex);
        if (automixFifo.getNumReady() <= 0)
            return;
    }

    const uint64_t effectiveFadeStartFrame = std::max(absoluteStartFrame, plannedFadeStartFrame);
    const uint64_t overlapFrames = std::max<uint64_t>(1, automixPlan.overlapFrames.load(std::memory_order_acquire));
    const uint64_t releaseFrames = std::max<uint64_t>(
        1,
        automixPlan.gainReleaseEndFrame.load(std::memory_order_acquire)
            - automixPlan.fadeEndFrame.load(std::memory_order_acquire));
    automixPlan.fadeStartFrame.store(effectiveFadeStartFrame, std::memory_order_release);
    automixPlan.fadeEndFrame.store(effectiveFadeStartFrame + overlapFrames, std::memory_order_release);
    automixPlan.gainReleaseEndFrame.store(effectiveFadeStartFrame + overlapFrames + releaseFrames, std::memory_order_release);
    automixPlan.fadeActivated.store(true, std::memory_order_release);
}

void PcmRingAudioSource::configureDeclickRamp(double sampleRate)
{
    const double safeSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    declickRampFrames = std::max(1, static_cast<int>(std::ceil(safeSampleRate * 0.006)));
}

void PcmRingAudioSource::applyDeclickRamp(echo::FloatAudioBuffer& output, int startSample, int frameCount)
{
    const auto generation = declickFadeGeneration.load(std::memory_order_acquire);
    if (generation != appliedDeclickFadeGeneration)
    {
        appliedDeclickFadeGeneration = generation;
        declickGain = 0.0f;
    }

    const float targetGain = stopFadeRequested.load(std::memory_order_acquire) ? 0.0f : 1.0f;
    if (declickGain == targetGain && targetGain == 1.0f)
        return;

    const float step = 1.0f / static_cast<float>(std::max(1, declickRampFrames));
    const int outputChannels = output.getNumChannels();

    std::vector<float*> chPtrs(static_cast<size_t>(outputChannels));
    for (int ch = 0; ch < outputChannels; ++ch)
        chPtrs[static_cast<size_t>(ch)] = output.getWritePointer(ch, startSample);

    for (int frame = 0; frame < frameCount; ++frame)
    {
        for (int ch = 0; ch < outputChannels; ++ch)
            chPtrs[static_cast<size_t>(ch)][frame] *= declickGain;

        if (declickGain < targetGain)
            declickGain = std::min(targetGain, declickGain + step);
        else if (declickGain > targetGain)
            declickGain = std::max(targetGain, declickGain - step);
    }
}

float PcmRingAudioSource::currentAutomixEnvelope(uint64_t absoluteFrame) const
{
    const bool enabled = automixPlan.enabled.load(std::memory_order_acquire);
    const bool fadeActivated = automixPlan.fadeActivated.load(std::memory_order_acquire);
    const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
    const uint64_t fadeEndFrame = automixPlan.fadeEndFrame.load(std::memory_order_acquire);
    const float currentGain = automixPlan.currentGain.load(std::memory_order_acquire);
    if (! enabled)
        return 1.0f;

    if (! fadeActivated || absoluteFrame < fadeStartFrame)
        return 1.0f;

    if (absoluteFrame >= fadeEndFrame)
        return 0.0f;

    const double progress = static_cast<double>(absoluteFrame - fadeStartFrame)
        / static_cast<double>(std::max<uint64_t>(1, fadeEndFrame - fadeStartFrame));
    const auto smoothProgress = static_cast<float>(std::sin(progress * halfPi));
    const float gainMatch = 1.0f + ((currentGain - 1.0f) * smoothProgress);
    return gainMatch * static_cast<float>(std::cos(progress * halfPi));
}

float PcmRingAudioSource::nextAutomixEnvelope(uint64_t absoluteFrame) const
{
    const bool enabled = automixPlan.enabled.load(std::memory_order_acquire);
    const bool fadeActivated = automixPlan.fadeActivated.load(std::memory_order_acquire);
    const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
    const uint64_t fadeEndFrame = automixPlan.fadeEndFrame.load(std::memory_order_acquire);
    const uint64_t gainReleaseEndFrame = automixPlan.gainReleaseEndFrame.load(std::memory_order_acquire);
    const float nextGain = automixPlan.nextGain.load(std::memory_order_acquire);
    if (! enabled || ! fadeActivated || absoluteFrame < fadeStartFrame)
        return 0.0f;

    if (absoluteFrame >= gainReleaseEndFrame)
        return 1.0f;

    if (absoluteFrame >= fadeEndFrame)
    {
        const double releaseProgress = static_cast<double>(absoluteFrame - fadeEndFrame)
            / static_cast<double>(std::max<uint64_t>(1, gainReleaseEndFrame - fadeEndFrame));
        const float smoothRelease = static_cast<float>(std::sin(releaseProgress * halfPi));
        return nextGain + ((1.0f - nextGain) * smoothRelease);
    }

    const double progress = static_cast<double>(absoluteFrame - fadeStartFrame)
        / static_cast<double>(std::max<uint64_t>(1, fadeEndFrame - fadeStartFrame));
    return nextGain * static_cast<float>(std::sin(progress * halfPi));
}

void PcmRingAudioSource::copyToOutput(int startFrame, int frameCount, echo::FloatAudioBuffer& output, int outputStart, uint64_t absoluteStartFrame)
{
    if (frameCount <= 0)
        return;

    const float* source = buffer.data() + static_cast<size_t>(startFrame * channels);
    const float outputGain = gain.load(std::memory_order_acquire);
    const int outputChannels = output.getNumChannels();

    for (int channel = 0; channel < outputChannels; ++channel)
    {
        float* destination = output.getWritePointer(channel, outputStart);
        const int sourceChannel = std::min(channel, channels - 1);

        for (int frame = 0; frame < frameCount; ++frame)
            destination[frame] = source[frame * channels + sourceChannel]
                * outputGain
                * currentAutomixEnvelope(absoluteStartFrame + static_cast<uint64_t>(frame));
    }
}

void PcmRingAudioSource::copyToAutomixBuffer(const float* source, int startFrame, int frameCount)
{
    if (frameCount <= 0)
        return;

    std::memcpy(
        automixBuffer.data() + static_cast<size_t>(startFrame * channels),
        source,
        static_cast<size_t>(frameCount * channels) * sizeof(float));
}

void PcmRingAudioSource::addAutomixToOutput(int startFrame, int frameCount, echo::FloatAudioBuffer& output, int outputStart, uint64_t absoluteStartFrame)
{
    if (frameCount <= 0)
        return;

    const float* source = automixBuffer.data() + static_cast<size_t>(startFrame * channels);
    const int outputChannels = output.getNumChannels();

    for (int channel = 0; channel < outputChannels; ++channel)
    {
        float* destination = output.getWritePointer(channel, outputStart);
        const int sourceChannel = std::min(channel, channels - 1);

        for (int frame = 0; frame < frameCount; ++frame)
        {
            destination[frame] += source[frame * channels + sourceChannel]
                * nextAutomixEnvelope(absoluteStartFrame + static_cast<uint64_t>(frame));
        }
    }
}

uint64_t PcmRingAudioSource::mixAutomixNext(echo::FloatAudioBuffer& output, int startSample, int frameCount, uint64_t absoluteStartFrame)
{
    if (! automixPlan.enabled.load(std::memory_order_acquire) || frameCount <= 0)
        return 0;

    const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
    if (absoluteStartFrame + static_cast<uint64_t>(frameCount) <= fadeStartFrame)
        return 0;

    const int startOffset = absoluteStartFrame >= fadeStartFrame
        ? 0
        : static_cast<int>(fadeStartFrame - absoluteStartFrame);
    int framesNeeded = frameCount - startOffset;
    int outputOffset = startOffset;
    uint64_t framesReadTotal = 0;

    {
        std::lock_guard<std::mutex> lock(automixMutex);

        while (framesNeeded > 0)
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            automixFifo.prepareToRead(framesNeeded, start1, size1, start2, size2);

            const int framesRead = size1 + size2;
            if (framesRead <= 0)
            {
                if (! automixNextInputEnded.load(std::memory_order_acquire) && automixNextHasAudio.load(std::memory_order_acquire))
                {
                    underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                    underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                }
                break;
            }

            addAutomixToOutput(
                start1,
                size1,
                output,
                startSample + outputOffset,
                absoluteStartFrame + static_cast<uint64_t>(outputOffset));
            addAutomixToOutput(
                start2,
                size2,
                output,
                startSample + outputOffset + size1,
                absoluteStartFrame + static_cast<uint64_t>(outputOffset + size1));
            automixFifo.finishedRead(framesRead);

            framesReadTotal += static_cast<uint64_t>(framesRead);
            framesNeeded -= framesRead;
            outputOffset += framesRead;
        }
    }

    return framesReadTotal > 0 ? framesReadTotal + static_cast<uint64_t>(startOffset) : 0;
}

void PcmRingAudioSource::resamplePlaybackRate(const echo::FloatAudioBuffer& source, echo::FloatAudioBuffer& output, int outputStart, int outputFrames, int sourceFrames, float playbackRate)
{
    if (outputFrames <= 0 || sourceFrames <= 0 || playbackRate <= 0.0f)
        return;

    const int outputChannels = output.getNumChannels();
    const int sourceChannels = source.getNumChannels();
    const int channelsToCopy = std::min(outputChannels, sourceChannels);

    for (int frame = 0; frame < outputFrames; ++frame)
    {
        const int sourceFrame = static_cast<int>(static_cast<float>(frame) * playbackRate);
        if (sourceFrame < 0 || sourceFrame >= sourceFrames)
            break;

        for (int channel = 0; channel < channelsToCopy; ++channel)
            output.getWritePointer(channel, outputStart)[frame] = source.getReadPointer(channel)[sourceFrame];
    }
}

void PcmRingAudioSource::copyPlanarToInterleaved(const echo::FloatAudioBuffer& source, float* output, int frameCount, int outputChannels) const
{
    if (output == nullptr || frameCount <= 0 || outputChannels <= 0)
        return;

    const int sourceChannels = source.getNumChannels();
    if (sourceChannels <= 0)
        return;

    for (int frame = 0; frame < frameCount; ++frame)
    {
        for (int channel = 0; channel < outputChannels; ++channel)
        {
            const int sourceChannel = std::min(channel, sourceChannels - 1);
            output[static_cast<size_t>(frame) * outputChannels + channel] =
                source.getReadPointer(sourceChannel)[frame];
        }
    }
}

bool PcmRingAudioSource::shouldHoldForStartupPrebuffer()
{
    if (! prebuffering.load(std::memory_order_acquire))
        return false;

    int readyFrames = 0;
    std::chrono::steady_clock::time_point deadline;
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        readyFrames = fifo.getNumReady();
        deadline = prebufferDeadline;
    }
    const bool enoughPcm = readyFrames >= startupPrebufferFrames;
    const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
    const bool ended = session_.isInputEnded();

    if (enoughPcm || timedOut || ended)
    {
        prebuffering.store(false, std::memory_order_release);
        return false;
    }

    return true;
}
