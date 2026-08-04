#pragma once

#include "buffer.h"

#include <atomic>
#include <functional>
#include <vector>

namespace echo
{
constexpr int levelMeterMaxIntervalMs = 5000;
constexpr float levelMeterMinDb = -60.0f;

struct LevelMeterSnapshot
{
    std::vector<float> peakDb;
    std::vector<float> rmsDb;
    double timestampMs = 0.0;
};

class LevelMeterProcessor
{
public:
    using Callback = std::function<void(const LevelMeterSnapshot&)>;

    LevelMeterProcessor();

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples);

    void setIntervalMs(int ms);
    void setCallback(Callback callback);
    int getIntervalMs() const;
    bool isEnabled() const;

private:
    static float sanitizeDb(float db);
    static float sanitize(float value);

    std::atomic<int> intervalMs { 0 };
    Callback callback;
    std::vector<float> peakSquares;
    std::vector<float> rmsSquares;
    double samplesSinceReport = 0.0;
    double sampleRate = 44100.0;
    int channelCount = 0;
};
} // namespace echo
