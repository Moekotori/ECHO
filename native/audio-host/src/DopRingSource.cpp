#include "DopRingSource.h"

#include <algorithm>
#include <cstring>
#include <thread>

DopRingSource::DopRingSource(
    int channelCount,
    int capacityFrames,
    int startupPrebufferFramesToUse,
    int startupPrebufferTimeoutMsToUse)
    : channels(channelCount),
      startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
      startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
      fifo(capacityFrames),
      buffer(static_cast<size_t>(capacityFrames * channelCount), 0u)
{
}

uint32_t DopRingSource::renderInterleaved(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
{
    if (output == nullptr || frameCount == 0 || outputChannels == 0)
        return 0;

    fillDopSilence(output, frameCount, outputChannels);

    if (shouldHoldForStartupPrebuffer())
        return 0;

    uint32_t framesReadTotal = 0;
    uint32_t outputOffset = 0;
    uint32_t framesNeeded = frameCount;

    {
        std::lock_guard<std::mutex> lock(fifoMutex);

        while (framesNeeded > 0)
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            fifo.prepareToRead(static_cast<int>(framesNeeded), start1, size1, start2, size2);

            const int framesRead = size1 + size2;
            if (framesRead <= 0)
            {
                if (
                    ! inputEnded.load(std::memory_order_acquire)
                    && sessionHasAudio.load(std::memory_order_acquire))
                {
                    underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                    underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                }
                break;
            }

            copyToInterleaved(start1, size1, output + static_cast<size_t>(outputOffset) * outputChannels, outputChannels);
            copyToInterleaved(
                start2,
                size2,
                output + static_cast<size_t>(outputOffset + static_cast<uint32_t>(size1)) * outputChannels,
                outputChannels);
            fifo.finishedRead(framesRead);

            framesReadTotal += static_cast<uint32_t>(framesRead);
            outputOffset += static_cast<uint32_t>(framesRead);
            framesNeeded -= static_cast<uint32_t>(framesRead);
        }
    }

    if (framesReadTotal > 0)
        framesPlayed.fetch_add(framesReadTotal, std::memory_order_relaxed);

    normalizeDopMarkers(output, frameCount, outputChannels);

    return framesReadTotal;
}

bool DopRingSource::push(const uint32_t* samples, int frameCount)
{
    if (frameCount > 0)
        sessionHasAudio.store(true, std::memory_order_release);

    int written = 0;

    while (written < frameCount && ! stopRequested.load(std::memory_order_relaxed))
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

void DopRingSource::beginSession()
{
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        fifo.reset();
        prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(1, startupPrebufferTimeoutMs));
    }

    framesPlayed.store(0, std::memory_order_relaxed);
    underrunCallbacks.store(0, std::memory_order_relaxed);
    underrunFrames.store(0, std::memory_order_relaxed);
    inputEnded.store(false, std::memory_order_release);
    sessionHasAudio.store(false, std::memory_order_release);
    prebuffering.store(startupPrebufferFrames > 0, std::memory_order_release);
}

void DopRingSource::markInputEnded()
{
    inputEnded.store(true, std::memory_order_release);
}

void DopRingSource::requestStop()
{
    stopRequested.store(true, std::memory_order_release);
}

bool DopRingSource::isDrained() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    return inputEnded.load(std::memory_order_acquire) && fifo.getNumReady() == 0;
}

bool DopRingSource::hasInputEnded() const
{
    return inputEnded.load(std::memory_order_acquire);
}

int DopRingSource::getReadyFrames() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    return fifo.getNumReady();
}

uint64_t DopRingSource::getFramesPlayed() const
{
    return framesPlayed.load(std::memory_order_relaxed);
}

uint64_t DopRingSource::getUnderrunCallbacks() const
{
    return underrunCallbacks.load(std::memory_order_relaxed);
}

uint64_t DopRingSource::getUnderrunFrames() const
{
    return underrunFrames.load(std::memory_order_relaxed);
}

uint32_t DopRingSource::makeDopSample(uint32_t frameIndex, uint32_t dsdLow16)
{
    const uint32_t marker = (frameIndex & 1u) == 0 ? 0x05u : 0xfau;
    return (dsdLow16 & 0x0000ffffu) | (marker << 16);
}

void DopRingSource::fillDopSilence(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
{
    for (uint32_t frame = 0; frame < frameCount; ++frame)
    {
        const uint32_t sample = makeDopSample(frame, 0u);
        for (uint32_t channel = 0; channel < outputChannels; ++channel)
            output[static_cast<size_t>(frame) * outputChannels + channel] = sample;
    }
}

void DopRingSource::normalizeDopMarkers(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
{
    for (uint32_t frame = 0; frame < frameCount; ++frame)
    {
        const uint32_t marker = (frame & 1u) == 0 ? 0x05u : 0xfau;
        for (uint32_t channel = 0; channel < outputChannels; ++channel)
        {
            auto& sample = output[static_cast<size_t>(frame) * outputChannels + channel];
            sample = (sample & 0x0000ffffu) | (marker << 16);
        }
    }
}

void DopRingSource::copyFromInput(const uint32_t* source, int startFrame, int frameCount)
{
    if (frameCount <= 0)
        return;

    std::memcpy(
        buffer.data() + static_cast<size_t>(startFrame * channels),
        source,
        static_cast<size_t>(frameCount * channels) * sizeof(uint32_t));
}

void DopRingSource::copyToInterleaved(int startFrame, int frameCount, uint32_t* output, uint32_t outputChannels) const
{
    if (frameCount <= 0 || output == nullptr || outputChannels == 0)
        return;

    const uint32_t* source = buffer.data() + static_cast<size_t>(startFrame * channels);
    for (int frame = 0; frame < frameCount; ++frame)
    {
        for (uint32_t channel = 0; channel < outputChannels; ++channel)
        {
            const int sourceChannel = std::min<int>(static_cast<int>(channel), channels - 1);
            output[static_cast<size_t>(frame) * outputChannels + channel] =
                source[static_cast<size_t>(frame) * channels + sourceChannel];
        }
    }
}

bool DopRingSource::shouldHoldForStartupPrebuffer()
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
    const bool enoughData = readyFrames >= startupPrebufferFrames;
    const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
    const bool ended = inputEnded.load(std::memory_order_acquire);

    if (enoughData || timedOut || ended)
    {
        prebuffering.store(false, std::memory_order_release);
        return false;
    }

    return true;
}

void pushDopPayload(DopRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels) * 3u;
    pending.insert(pending.end(), payload.begin(), payload.end());

    const size_t frameCount = pending.size() / frameBytes;
    if (frameCount == 0)
        return;

    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    std::vector<uint32_t> samples(sampleCount);
    for (size_t sample = 0; sample < sampleCount; ++sample)
    {
        const size_t byteOffset = sample * 3u;
        samples[sample] =
            static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset]))
            | (static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset + 1])) << 8)
            | (static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset + 2])) << 16);
    }

    if (! source.push(samples.data(), static_cast<int>(frameCount)))
        return;

    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(sampleCount * 3u));
}
