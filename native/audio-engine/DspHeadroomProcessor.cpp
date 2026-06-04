#include "DspHeadroomProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
float clampHeadroomDb(float value)
{
    return std::max(dspHeadroomMinDb, std::min(dspHeadroomMaxDb, value));
}

float dbToGain(float db)
{
    return std::pow(10.0f, db / 20.0f);
}

float moveTowards(float current, float target, float step)
{
    if (step == 0.0f)
        return target;

    const float next = current + step;
    return step > 0.0f ? std::min(next, target) : std::max(next, target);
}
} // namespace

void DspHeadroomProcessor::prepare(double sampleRate, int maximumBlockSize, int)
{
    const int smoothingMs = 5;
    gainSmoothingSamples = std::max(maximumBlockSize, static_cast<int>((sampleRate * smoothingMs) / 1000.0));
    smoothedHeadroomDb = getHeadroomDb();
    smoothingSamplesRemaining = 0;
    headroomStepDb = 0.0f;
}

void DspHeadroomProcessor::reset()
{
    smoothedHeadroomDb = getHeadroomDb();
    smoothingSamplesRemaining = 0;
    headroomStepDb = 0.0f;
}

void DspHeadroomProcessor::setHeadroomDb(float headroomDbToUse)
{
    if (! std::isfinite(headroomDbToUse))
        headroomDbToUse = 0.0f;

    headroomDb.store(clampHeadroomDb(headroomDbToUse), std::memory_order_release);
}

float DspHeadroomProcessor::getHeadroomDb() const
{
    return headroomDb.load(std::memory_order_acquire);
}

bool DspHeadroomProcessor::isEnabled() const
{
    return std::abs(getHeadroomDb()) > 0.001f;
}

void DspHeadroomProcessor::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    const float targetHeadroomDb = getHeadroomDb();
    if (numSamples <= 0 || (std::abs(targetHeadroomDb) <= 0.001f && std::abs(smoothedHeadroomDb) <= 0.001f))
        return;

    if (std::abs(targetHeadroomDb - smoothedHeadroomDb) > 0.001f && smoothingSamplesRemaining <= 0)
    {
        smoothingSamplesRemaining = std::max(1, gainSmoothingSamples);
        headroomStepDb = (targetHeadroomDb - smoothedHeadroomDb) / static_cast<float>(smoothingSamplesRemaining);
    }

    const int channelCount = buffer.getNumChannels();
    for (int sample = 0; sample < numSamples; ++sample)
    {
        if (smoothingSamplesRemaining > 0)
        {
            smoothedHeadroomDb = moveTowards(smoothedHeadroomDb, targetHeadroomDb, headroomStepDb);
            --smoothingSamplesRemaining;
        }
        else
        {
            smoothedHeadroomDb = targetHeadroomDb;
        }

        const float gain = dbToGain(smoothedHeadroomDb);
        for (int channel = 0; channel < channelCount; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            if (samples != nullptr)
                samples[sample] *= gain;
        }
    }
}
} // namespace echo
