#pragma once

#include "buffer.h"

#include <atomic>

namespace echo
{
struct CompressorState
{
    bool enabled = false;
    float thresholdDb = -18.0f;
    float ratio = 4.0f;
    float attackMs = 10.0f;
    float releaseMs = 120.0f;
    float kneeDb = 6.0f;
    float makeupDb = 0.0f;
    float mix = 1.0f;
};

class CompressorProcessor final
{
public:
    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    void setState(const CompressorState& state);
    CompressorState getState() const;
    bool isEnabled() const;
    bool hasClippingRisk() const;
    float gainReductionDb() const;

private:
    static CompressorState sanitizeState(const CompressorState& state);
    static float computeReductionDb(float inputDb, float thresholdDb, float ratio, float kneeDb);

    std::atomic<bool> enabled_ { false };
    std::atomic<float> thresholdDb_ { -18.0f };
    std::atomic<float> ratio_ { 4.0f };
    std::atomic<float> attackMs_ { 10.0f };
    std::atomic<float> releaseMs_ { 120.0f };
    std::atomic<float> kneeDb_ { 6.0f };
    std::atomic<float> makeupDb_ { 0.0f };
    std::atomic<float> mix_ { 1.0f };
    std::atomic<float> gainReductionDb_ { 0.0f };

    double sampleRate_ = 48000.0;
    float smoothedGain_ = 1.0f;
};
} // namespace echo
