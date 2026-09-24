#include "SpatialDspProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float pi = 3.14159265358979323846f;

float clampFinite(float value, float minimum, float maximum, float fallback)
{
    return std::isfinite(value) ? std::clamp(value, minimum, maximum) : fallback;
}

float dbToGain(float value)
{
    return std::pow(10.0f, value / 20.0f);
}
} // namespace

void SpatialDspProcessor::prepare(double sampleRate, int, int)
{
    sampleRate_ = std::max(1.0, sampleRate);
    reset();
}

void SpatialDspProcessor::reset()
{
    crossfeedLowpassSide_ = 0.0f;
}

void SpatialDspProcessor::processCrossfeedBlock(FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0 || buffer.getNumChannels() < 2)
        return;
    if (!isCrossfeedEnabled())
    {
        crossfeedLowpassSide_ = 0.0f;
        return;
    }

    const float amount = crossfeedAmount_.load(std::memory_order_acquire);
    const float cutoffHz = crossfeedCutoffHz_.load(std::memory_order_acquire);
    const float coefficient = 1.0f - std::exp(
        -2.0f * pi * cutoffHz / static_cast<float>(sampleRate_));
    auto* left = buffer.getWritePointer(0, startSample);
    auto* right = buffer.getWritePointer(1, startSample);

    for (int sample = 0; sample < numSamples; ++sample)
    {
        const float mid = 0.5f * (left[sample] + right[sample]);
        const float side = 0.5f * (left[sample] - right[sample]);
        crossfeedLowpassSide_ += coefficient * (side - crossfeedLowpassSide_);
        const float processedSide = side - amount * crossfeedLowpassSide_;
        left[sample] = mid + processedSide;
        right[sample] = mid - processedSide;
    }
}

void SpatialDspProcessor::processStereoFieldBlock(FloatAudioBuffer& buffer, int startSample, int numSamples) const
{
    if (numSamples <= 0 || buffer.getNumChannels() < 2 || !isStereoFieldEnabled())
        return;

    const float midGain = dbToGain(stereoCenterGainDb_.load(std::memory_order_acquire));
    const float sideGain = dbToGain(stereoSideGainDb_.load(std::memory_order_acquire))
        * stereoWidth_.load(std::memory_order_acquire);
    auto* left = buffer.getWritePointer(0, startSample);
    auto* right = buffer.getWritePointer(1, startSample);
    for (int sample = 0; sample < numSamples; ++sample)
    {
        const float mid = 0.5f * (left[sample] + right[sample]) * midGain;
        const float side = 0.5f * (left[sample] - right[sample]) * sideGain;
        left[sample] = mid + side;
        right[sample] = mid - side;
    }
}

void SpatialDspProcessor::processChannelMatrixBlock(FloatAudioBuffer& buffer, int startSample, int numSamples) const
{
    if (numSamples <= 0 || buffer.getNumChannels() < 2 || !isChannelMatrixEnabled())
        return;

    const float leftToLeft = matrixLeftToLeft_.load(std::memory_order_acquire);
    const float rightToLeft = matrixRightToLeft_.load(std::memory_order_acquire);
    const float leftToRight = matrixLeftToRight_.load(std::memory_order_acquire);
    const float rightToRight = matrixRightToRight_.load(std::memory_order_acquire);
    auto* left = buffer.getWritePointer(0, startSample);
    auto* right = buffer.getWritePointer(1, startSample);
    for (int sample = 0; sample < numSamples; ++sample)
    {
        const float inputLeft = left[sample];
        const float inputRight = right[sample];
        left[sample] = inputLeft * leftToLeft + inputRight * rightToLeft;
        right[sample] = inputLeft * leftToRight + inputRight * rightToRight;
    }
}

void SpatialDspProcessor::setCrossfeedState(const CrossfeedState& state)
{
    crossfeedAmount_.store(clampFinite(state.amount, 0.0f, 1.0f, 0.25f), std::memory_order_release);
    crossfeedCutoffHz_.store(clampFinite(state.cutoffHz, 100.0f, 4'000.0f, 700.0f), std::memory_order_release);
    crossfeedEnabled_.store(state.enabled, std::memory_order_release);
}

CrossfeedState SpatialDspProcessor::getCrossfeedState() const
{
    return {
        crossfeedEnabled_.load(std::memory_order_acquire),
        crossfeedAmount_.load(std::memory_order_acquire),
        crossfeedCutoffHz_.load(std::memory_order_acquire)
    };
}

void SpatialDspProcessor::setStereoFieldState(const StereoFieldState& state)
{
    stereoWidth_.store(clampFinite(state.width, 0.0f, 2.0f, 1.0f), std::memory_order_release);
    stereoCenterGainDb_.store(clampFinite(state.centerGainDb, -18.0f, 18.0f, 0.0f), std::memory_order_release);
    stereoSideGainDb_.store(clampFinite(state.sideGainDb, -18.0f, 18.0f, 0.0f), std::memory_order_release);
    stereoFieldEnabled_.store(state.enabled, std::memory_order_release);
}

StereoFieldState SpatialDspProcessor::getStereoFieldState() const
{
    return {
        stereoFieldEnabled_.load(std::memory_order_acquire),
        stereoWidth_.load(std::memory_order_acquire),
        stereoCenterGainDb_.load(std::memory_order_acquire),
        stereoSideGainDb_.load(std::memory_order_acquire)
    };
}

void SpatialDspProcessor::setChannelMatrixState(const ChannelMatrixState& state)
{
    matrixLeftToLeft_.store(clampFinite(state.leftToLeft, -2.0f, 2.0f, 1.0f), std::memory_order_release);
    matrixRightToLeft_.store(clampFinite(state.rightToLeft, -2.0f, 2.0f, 0.0f), std::memory_order_release);
    matrixLeftToRight_.store(clampFinite(state.leftToRight, -2.0f, 2.0f, 0.0f), std::memory_order_release);
    matrixRightToRight_.store(clampFinite(state.rightToRight, -2.0f, 2.0f, 1.0f), std::memory_order_release);
    channelMatrixEnabled_.store(state.enabled, std::memory_order_release);
}

ChannelMatrixState SpatialDspProcessor::getChannelMatrixState() const
{
    return {
        channelMatrixEnabled_.load(std::memory_order_acquire),
        matrixLeftToLeft_.load(std::memory_order_acquire),
        matrixRightToLeft_.load(std::memory_order_acquire),
        matrixLeftToRight_.load(std::memory_order_acquire),
        matrixRightToRight_.load(std::memory_order_acquire)
    };
}

bool SpatialDspProcessor::isCrossfeedEnabled() const
{
    return crossfeedEnabled_.load(std::memory_order_acquire);
}

bool SpatialDspProcessor::isStereoFieldEnabled() const
{
    return stereoFieldEnabled_.load(std::memory_order_acquire);
}

bool SpatialDspProcessor::isChannelMatrixEnabled() const
{
    return channelMatrixEnabled_.load(std::memory_order_acquire);
}

bool SpatialDspProcessor::isAnyEnabled() const
{
    return isCrossfeedEnabled() || isStereoFieldEnabled() || isChannelMatrixEnabled();
}

bool SpatialDspProcessor::hasStereoFieldClippingRisk() const
{
    if (isStereoFieldEnabled())
    {
        const float mid = dbToGain(stereoCenterGainDb_.load(std::memory_order_acquire));
        const float side = dbToGain(stereoSideGainDb_.load(std::memory_order_acquire))
            * stereoWidth_.load(std::memory_order_acquire);
        if (0.5f * (std::abs(mid + side) + std::abs(mid - side)) > 1.001f)
            return true;
    }
    return false;
}

bool SpatialDspProcessor::hasChannelMatrixClippingRisk() const
{
    if (isChannelMatrixEnabled())
    {
        const float leftSum = std::abs(matrixLeftToLeft_.load(std::memory_order_acquire))
            + std::abs(matrixRightToLeft_.load(std::memory_order_acquire));
        const float rightSum = std::abs(matrixLeftToRight_.load(std::memory_order_acquire))
            + std::abs(matrixRightToRight_.load(std::memory_order_acquire));
        if (std::max(leftSum, rightSum) > 1.001f)
            return true;
    }
    return false;
}

bool SpatialDspProcessor::hasClippingRisk() const
{
    return hasStereoFieldClippingRisk() || hasChannelMatrixClippingRisk();
}
} // namespace echo
