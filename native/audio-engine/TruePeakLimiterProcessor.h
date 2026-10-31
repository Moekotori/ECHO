#pragma once

#include "buffer.h"

#include <atomic>

namespace echo
{
class TruePeakLimiterProcessor final
{
public:
    void prepare(double sampleRate, int channelCount);
    void reset();
    void processBlock(
        echo::FloatAudioBuffer& buffer,
        int startSample,
        int numSamples,
        float ceilingDb);

    bool isProtecting() const;
    float gainReductionDb() const;
    float ceilingDb() const;

private:
    float releaseCoefficient = 0.999f;
    float currentGain = 1.0f;
    std::atomic<bool> protecting { false };
    std::atomic<float> currentGainReductionDb { 0.0f };
    std::atomic<float> currentCeilingDb { 0.0f };
};
} // namespace echo
