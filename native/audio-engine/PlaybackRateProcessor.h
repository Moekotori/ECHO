#pragma once

#include "buffer.h"

#include <atomic>

namespace echo
{
constexpr float playbackRateMin = 0.5f;
constexpr float playbackRateMax = 2.0f;

enum class SpeedMode : int
{
    Nightcore = 0,
    Daycore = 1,
    Speed = 2,
};

class PlaybackRateProcessor
{
public:
    PlaybackRateProcessor();

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    void setRate(float rate);
    void setSpeedMode(SpeedMode mode);
    float getRate() const;
    SpeedMode getSpeedMode() const;
    bool isActive() const;

private:
    static float sanitize(float value);

    std::atomic<float> targetRate { 1.0f };
    float currentRate = 1.0f;
    SpeedMode mode = SpeedMode::Nightcore;
    double sampleRate = 44100.0;
    float readPos = 0.0f;
    int channelCount = 0;
};
} // namespace echo
