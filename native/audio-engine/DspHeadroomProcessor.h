#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>

namespace echo
{
constexpr float dspHeadroomMinDb = -12.0f;
constexpr float dspHeadroomMaxDb = 0.0f;

class DspHeadroomProcessor
{
public:
    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void setHeadroomDb(float headroomDbToUse);
    float getHeadroomDb() const;
    bool isEnabled() const;
    void processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);

private:
    std::atomic<float> headroomDb { 0.0f };
    float smoothedHeadroomDb = 0.0f;
    float headroomStepDb = 0.0f;
    int smoothingSamplesRemaining = 0;
    int gainSmoothingSamples = 256;
};
} // namespace echo
