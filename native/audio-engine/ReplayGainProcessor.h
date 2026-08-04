#pragma once

#include "buffer.h"

#include <atomic>

namespace echo
{
constexpr int replayGainModeOff = 0;
constexpr int replayGainModeTrack = 1;
constexpr int replayGainModeAlbum = 2;

struct ReplayGainConfig
{
    float trackGainDb = 0.0f;
    float albumGainDb = 0.0f;
    float peak = 1.0f;
    int mode = replayGainModeOff;
    float preampDb = 0.0f;
    bool preventClipping = true;
};

class ReplayGainProcessor
{
public:
    ReplayGainProcessor();

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    void setConfig(const ReplayGainConfig& config);
    ReplayGainConfig getConfig() const;
    bool isActive() const;
    float getAppliedGainDb() const;
    bool hasClippingRisk() const;

private:
    static float dbToLinear(float db);
    static float sanitize(float value);

    std::atomic<float> targetGainDb { 0.0f };
    float currentGainDb = 0.0f;
    std::atomic<bool> clippingRisk { false };
    ReplayGainConfig currentConfig;
    float sampleRate = 44100.0f;
    int rampSamples = 0;
    int rampPosition = 0;
};
} // namespace echo
