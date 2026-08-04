#include "PlaybackRateProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
float PlaybackRateProcessor::sanitize(float value)
{
    return std::isfinite(value) ? value : 0.0f;
}

PlaybackRateProcessor::PlaybackRateProcessor()
{
    targetRate.store(1.0f, std::memory_order_release);
}

void PlaybackRateProcessor::prepare(double sampleRateIn, int maximumBlockSize, int channelCountIn)
{
    (void) maximumBlockSize;
    sampleRate = sampleRateIn > 0.0 ? sampleRateIn : 44100.0;
    channelCount = std::max(1, channelCountIn);
    reset();
}

void PlaybackRateProcessor::reset()
{
    currentRate = targetRate.load(std::memory_order_acquire);
    readPos = 0.0f;
}

void PlaybackRateProcessor::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    (void) buffer;
    (void) startSample;
    (void) numSamples;
    currentRate = targetRate.load(std::memory_order_acquire);
    readPos = 0.0f;
}

void PlaybackRateProcessor::setRate(float rate)
{
    const float clamped = std::max(playbackRateMin, std::min(playbackRateMax, sanitize(rate)));
    targetRate.store(clamped, std::memory_order_release);
}

void PlaybackRateProcessor::setSpeedMode(SpeedMode modeIn)
{
    mode = modeIn;
}

float PlaybackRateProcessor::getRate() const
{
    return targetRate.load(std::memory_order_acquire);
}

SpeedMode PlaybackRateProcessor::getSpeedMode() const
{
    return mode;
}

bool PlaybackRateProcessor::isActive() const
{
    const float rate = targetRate.load(std::memory_order_acquire);
    return std::abs(rate - 1.0f) > 0.0001f;
}
} // namespace echo
