#pragma once

#include "NativePrimitives.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <vector>

class NativeDsdRingSource final
{
public:
    NativeDsdRingSource(
        int channelCount,
        int capacityByteFrames,
        int startupPrebufferByteFramesToUse,
        int startupPrebufferTimeoutMsToUse);

    uint32_t renderInterleaved(uint8_t* output, uint32_t byteFrameCount, uint32_t outputChannels);
    bool push(const uint8_t* samples, int byteFrameCount);
    void beginSession();
    void markInputEnded();
    void requestStop();
    bool isDrained() const;
    bool hasInputEnded() const;
    int getReadyByteFrames() const;
    uint64_t getReadyFrames() const;
    uint64_t getFramesPlayed() const;
    uint64_t getUnderrunCallbacks() const;
    uint64_t getUnderrunFrames() const;

private:
    void copyFromInput(const uint8_t* source, int startByteFrame, int byteFrameCount);
    void copyToInterleaved(int startByteFrame, int byteFrameCount, uint8_t* output, uint32_t outputChannels) const;
    bool shouldHoldForStartupPrebuffer();

    const int channels;
    const int startupPrebufferByteFrames;
    const int startupPrebufferTimeoutMs;
    echo_audio_host::NativeFifo fifo;
    std::vector<uint8_t> buffer;
    mutable std::mutex fifoMutex;
    std::atomic<bool> inputEnded { false };
    std::atomic<bool> sessionHasAudio { false };
    std::atomic<bool> prebuffering { false };
    std::atomic<bool> stopRequested { false };
    std::atomic<uint64_t> framesPlayed { 0 };
    std::atomic<uint64_t> underrunCallbacks { 0 };
    std::atomic<uint64_t> underrunFrames { 0 };
    std::chrono::steady_clock::time_point prebufferDeadline {};
};

void pushNativeDsdPayload(NativeDsdRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload);
