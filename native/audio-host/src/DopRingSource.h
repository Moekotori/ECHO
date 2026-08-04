#pragma once

#include "NativePrimitives.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <vector>

class DopRingSource final
{
public:
    DopRingSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse);

    uint32_t renderInterleaved(uint32_t* output, uint32_t frameCount, uint32_t outputChannels);
    bool push(const uint32_t* samples, int frameCount);
    void beginSession();
    void markInputEnded();
    void requestStop();
    bool isDrained() const;
    bool hasInputEnded() const;
    int getReadyFrames() const;
    uint64_t getFramesPlayed() const;
    uint64_t getUnderrunCallbacks() const;
    uint64_t getUnderrunFrames() const;

private:
    static uint32_t makeDopSample(uint32_t frameIndex, uint32_t dsdLow16);
    static void fillDopSilence(uint32_t* output, uint32_t frameCount, uint32_t outputChannels);
    static void normalizeDopMarkers(uint32_t* output, uint32_t frameCount, uint32_t outputChannels);
    void copyFromInput(const uint32_t* source, int startFrame, int frameCount);
    void copyToInterleaved(int startFrame, int frameCount, uint32_t* output, uint32_t outputChannels) const;
    bool shouldHoldForStartupPrebuffer();

    const int channels;
    const int startupPrebufferFrames;
    const int startupPrebufferTimeoutMs;
    echo_audio_host::NativeFifo fifo;
    std::vector<uint32_t> buffer;
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

void pushDopPayload(DopRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload);
