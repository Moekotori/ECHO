#include "NativeDsdRingSource.h"

#include <algorithm>
#include <cstring>
#include <thread>

NativeDsdRingSource::NativeDsdRingSource(
    int channelCount,
    int capacityByteFrames,
    int startupPrebufferByteFramesToUse,
    int startupPrebufferTimeoutMsToUse)
    : channels(std::max(1, channelCount)),
      startupPrebufferByteFrames(std::max(0, startupPrebufferByteFramesToUse)),
      startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
      fifo(std::max(1, capacityByteFrames)),
      buffer(static_cast<size_t>(std::max(1, capacityByteFrames) * std::max(1, channelCount)), 0x69u)
{
}

uint32_t NativeDsdRingSource::renderInterleaved(uint8_t* output, uint32_t byteFrameCount, uint32_t outputChannels)
{
    if (output == nullptr || byteFrameCount == 0 || outputChannels == 0)
        return 0;

    std::memset(output, 0x69, static_cast<size_t>(byteFrameCount) * outputChannels);

    if (shouldHoldForStartupPrebuffer())
        return 0;

    uint32_t byteFramesReadTotal = 0;
    uint32_t outputOffset = 0;
    uint32_t byteFramesNeeded = byteFrameCount;

    {
        std::lock_guard<std::mutex> lock(fifoMutex);

        while (byteFramesNeeded > 0)
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            fifo.prepareToRead(static_cast<int>(byteFramesNeeded), start1, size1, start2, size2);

            const int byteFramesRead = size1 + size2;
            if (byteFramesRead <= 0)
            {
                if (
                    ! inputEnded.load(std::memory_order_acquire)
                    && sessionHasAudio.load(std::memory_order_acquire))
                {
                    underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                    underrunFrames.fetch_add(static_cast<uint64_t>(byteFramesNeeded) * 8u, std::memory_order_relaxed);
                }
                break;
            }

            copyToInterleaved(start1, size1, output + static_cast<size_t>(outputOffset) * outputChannels, outputChannels);
            copyToInterleaved(
                start2,
                size2,
                output + static_cast<size_t>(outputOffset + static_cast<uint32_t>(size1)) * outputChannels,
                outputChannels);
            fifo.finishedRead(byteFramesRead);

            byteFramesReadTotal += static_cast<uint32_t>(byteFramesRead);
            outputOffset += static_cast<uint32_t>(byteFramesRead);
            byteFramesNeeded -= static_cast<uint32_t>(byteFramesRead);
        }
    }

    if (byteFramesReadTotal > 0)
        framesPlayed.fetch_add(static_cast<uint64_t>(byteFramesReadTotal) * 8u, std::memory_order_relaxed);

    return byteFramesReadTotal;
}

bool NativeDsdRingSource::push(const uint8_t* samples, int byteFrameCount)
{
    if (byteFrameCount > 0)
        sessionHasAudio.store(true, std::memory_order_release);

    int written = 0;

    while (written < byteFrameCount && ! stopRequested.load(std::memory_order_relaxed))
    {
        int start1 = 0;
        int size1 = 0;
        int start2 = 0;
        int size2 = 0;
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            fifo.prepareToWrite(byteFrameCount - written, start1, size1, start2, size2);

            const int byteFramesWritable = size1 + size2;
            if (byteFramesWritable > 0)
            {
                copyFromInput(samples + static_cast<size_t>(written) * channels, start1, size1);
                copyFromInput(samples + static_cast<size_t>(written + size1) * channels, start2, size2);
                fifo.finishedWrite(byteFramesWritable);
                written += byteFramesWritable;
                continue;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }

    return written == byteFrameCount;
}

void NativeDsdRingSource::beginSession()
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
    prebuffering.store(startupPrebufferByteFrames > 0, std::memory_order_release);
}

void NativeDsdRingSource::markInputEnded()
{
    inputEnded.store(true, std::memory_order_release);
}

void NativeDsdRingSource::requestStop()
{
    stopRequested.store(true, std::memory_order_release);
}

bool NativeDsdRingSource::isDrained() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    return inputEnded.load(std::memory_order_acquire) && fifo.getNumReady() == 0;
}

bool NativeDsdRingSource::hasInputEnded() const
{
    return inputEnded.load(std::memory_order_acquire);
}

int NativeDsdRingSource::getReadyByteFrames() const
{
    std::lock_guard<std::mutex> lock(fifoMutex);
    return fifo.getNumReady();
}

uint64_t NativeDsdRingSource::getReadyFrames() const
{
    return static_cast<uint64_t>(getReadyByteFrames()) * 8u;
}

uint64_t NativeDsdRingSource::getFramesPlayed() const
{
    return framesPlayed.load(std::memory_order_relaxed);
}

uint64_t NativeDsdRingSource::getUnderrunCallbacks() const
{
    return underrunCallbacks.load(std::memory_order_relaxed);
}

uint64_t NativeDsdRingSource::getUnderrunFrames() const
{
    return underrunFrames.load(std::memory_order_relaxed);
}

void NativeDsdRingSource::copyFromInput(const uint8_t* source, int startByteFrame, int byteFrameCount)
{
    if (byteFrameCount <= 0)
        return;

    std::memcpy(
        buffer.data() + static_cast<size_t>(startByteFrame * channels),
        source,
        static_cast<size_t>(byteFrameCount * channels));
}

void NativeDsdRingSource::copyToInterleaved(int startByteFrame, int byteFrameCount, uint8_t* output, uint32_t outputChannels) const
{
    if (byteFrameCount <= 0 || output == nullptr || outputChannels == 0)
        return;

    const uint8_t* source = buffer.data() + static_cast<size_t>(startByteFrame * channels);
    for (int byteFrame = 0; byteFrame < byteFrameCount; ++byteFrame)
    {
        for (uint32_t channel = 0; channel < outputChannels; ++channel)
        {
            const int sourceChannel = std::min<int>(static_cast<int>(channel), channels - 1);
            output[static_cast<size_t>(byteFrame) * outputChannels + channel] =
                source[static_cast<size_t>(byteFrame) * channels + sourceChannel];
        }
    }
}

bool NativeDsdRingSource::shouldHoldForStartupPrebuffer()
{
    if (! prebuffering.load(std::memory_order_acquire))
        return false;

    int readyByteFrames = 0;
    std::chrono::steady_clock::time_point deadline;
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        readyByteFrames = fifo.getNumReady();
        deadline = prebufferDeadline;
    }
    const bool enoughData = readyByteFrames >= startupPrebufferByteFrames;
    const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
    const bool ended = inputEnded.load(std::memory_order_acquire);

    if (enoughData || timedOut || ended)
    {
        prebuffering.store(false, std::memory_order_release);
        return false;
    }

    return true;
}

void pushNativeDsdPayload(NativeDsdRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels);
    pending.insert(pending.end(), payload.begin(), payload.end());

    const size_t byteFrameCount = pending.size() / frameBytes;
    if (byteFrameCount == 0)
        return;

    const auto* samples = reinterpret_cast<const uint8_t*>(pending.data());
    if (! source.push(samples, static_cast<int>(byteFrameCount)))
        return;

    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(byteFrameCount * frameBytes));
}
