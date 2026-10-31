#include "TruePeakLimiterProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float minimumGain = 1.0e-6f;

float sanitizeSample(float sample)
{
    return std::isfinite(sample) ? sample : 0.0f;
}

float dbToGain(float db)
{
    return std::pow(10.0f, db / 20.0f);
}

float gainToReductionDb(float gain)
{
    return std::max(
        0.0f,
        -20.0f * std::log10(std::max(minimumGain, gain)));
}
} // namespace

void TruePeakLimiterProcessor::prepare(double sampleRate, int)
{
    const double safeSampleRate =
        std::max(1.0, std::isfinite(sampleRate) ? sampleRate : 48'000.0);
    constexpr double releaseMilliseconds = 80.0;
    releaseCoefficient = static_cast<float>(std::exp(
        -1.0
        / (safeSampleRate * releaseMilliseconds / 1'000.0)));
    reset();
}

void TruePeakLimiterProcessor::reset()
{
    currentGain = 1.0f;
    protecting.store(false, std::memory_order_release);
    currentGainReductionDb.store(0.0f, std::memory_order_release);
    currentCeilingDb.store(0.0f, std::memory_order_release);
}

void TruePeakLimiterProcessor::processBlock(
    echo::FloatAudioBuffer& buffer,
    int startSample,
    int numSamples,
    float ceilingDb)
{
    if (numSamples <= 0)
    {
        protecting.store(false, std::memory_order_release);
        return;
    }

    const float safeCeilingDb = std::clamp(
        std::isfinite(ceilingDb) ? ceilingDb : 0.0f,
        -6.0f,
        0.0f);
    const float ceiling = dbToGain(safeCeilingDb);
    const int channelCount = buffer.getNumChannels();
    bool blockProtecting = false;

    for (int sample = 0; sample < numSamples; ++sample)
    {
        float linkedPeak = 0.0f;
        for (int channel = 0; channel < channelCount; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            if (samples == nullptr)
                continue;
            samples[sample] = sanitizeSample(samples[sample]);
            linkedPeak = std::max(
                linkedPeak,
                std::abs(samples[sample]));
        }

        const float requiredGain = linkedPeak > ceiling
            ? ceiling / linkedPeak
            : 1.0f;
        if (requiredGain < currentGain)
            currentGain = requiredGain;
        else
            currentGain = std::min(
                requiredGain,
                releaseCoefficient * currentGain
                    + (1.0f - releaseCoefficient));

        blockProtecting = blockProtecting
            || currentGain < 0.99999f;
        for (int channel = 0; channel < channelCount; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            if (samples != nullptr)
                samples[sample] *= currentGain;
        }
    }

    protecting.store(blockProtecting, std::memory_order_release);
    currentGainReductionDb.store(
        gainToReductionDb(currentGain),
        std::memory_order_release);
    currentCeilingDb.store(
        safeCeilingDb,
        std::memory_order_release);
}

bool TruePeakLimiterProcessor::isProtecting() const
{
    return protecting.load(std::memory_order_acquire);
}

float TruePeakLimiterProcessor::gainReductionDb() const
{
    return currentGainReductionDb.load(std::memory_order_acquire);
}

float TruePeakLimiterProcessor::ceilingDb() const
{
    return currentCeilingDb.load(std::memory_order_acquire);
}
} // namespace echo
