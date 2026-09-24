#pragma once

#include "buffer.h"

#include <atomic>

namespace echo
{
struct CrossfeedState
{
    bool enabled = false;
    float amount = 0.25f;
    float cutoffHz = 700.0f;
};

struct StereoFieldState
{
    bool enabled = false;
    float width = 1.0f;
    float centerGainDb = 0.0f;
    float sideGainDb = 0.0f;
};

struct ChannelMatrixState
{
    bool enabled = false;
    float leftToLeft = 1.0f;
    float rightToLeft = 0.0f;
    float leftToRight = 0.0f;
    float rightToRight = 1.0f;
};

class SpatialDspProcessor final
{
public:
    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();

    void processCrossfeedBlock(FloatAudioBuffer& buffer, int startSample, int numSamples);
    void processStereoFieldBlock(FloatAudioBuffer& buffer, int startSample, int numSamples) const;
    void processChannelMatrixBlock(FloatAudioBuffer& buffer, int startSample, int numSamples) const;

    void setCrossfeedState(const CrossfeedState& state);
    CrossfeedState getCrossfeedState() const;
    void setStereoFieldState(const StereoFieldState& state);
    StereoFieldState getStereoFieldState() const;
    void setChannelMatrixState(const ChannelMatrixState& state);
    ChannelMatrixState getChannelMatrixState() const;

    bool isCrossfeedEnabled() const;
    bool isStereoFieldEnabled() const;
    bool isChannelMatrixEnabled() const;
    bool isAnyEnabled() const;
    bool hasStereoFieldClippingRisk() const;
    bool hasChannelMatrixClippingRisk() const;
    bool hasClippingRisk() const;

private:
    std::atomic<bool> crossfeedEnabled_ { false };
    std::atomic<float> crossfeedAmount_ { 0.25f };
    std::atomic<float> crossfeedCutoffHz_ { 700.0f };

    std::atomic<bool> stereoFieldEnabled_ { false };
    std::atomic<float> stereoWidth_ { 1.0f };
    std::atomic<float> stereoCenterGainDb_ { 0.0f };
    std::atomic<float> stereoSideGainDb_ { 0.0f };

    std::atomic<bool> channelMatrixEnabled_ { false };
    std::atomic<float> matrixLeftToLeft_ { 1.0f };
    std::atomic<float> matrixRightToLeft_ { 0.0f };
    std::atomic<float> matrixLeftToRight_ { 0.0f };
    std::atomic<float> matrixRightToRight_ { 1.0f };

    double sampleRate_ = 48'000.0;
    float crossfeedLowpassSide_ = 0.0f;
};
} // namespace echo
