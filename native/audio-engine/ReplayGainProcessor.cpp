#include "ReplayGainProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float minLinearGain = 0.0f;
constexpr float maxLinearGain = 16.0f;
} // namespace

float ReplayGainProcessor::dbToLinear(float db)
{
    return static_cast<float>(std::pow(10.0, db / 20.0));
}

float ReplayGainProcessor::sanitize(float value)
{
    return std::isfinite(value) ? value : 0.0f;
}

ReplayGainProcessor::ReplayGainProcessor()
{
    targetGainDb.store(0.0f, std::memory_order_release);
}

void ReplayGainProcessor::prepare(double sampleRateIn, int maximumBlockSize, int channelCount)
{
    (void) maximumBlockSize;
    (void) channelCount;

    sampleRate = sampleRateIn > 0.0 ? static_cast<float>(sampleRateIn) : 44100.0f;
    rampSamples = static_cast<int>(sampleRate * 0.01);
    if (rampSamples < 1)
        rampSamples = 1;

    reset();
}

void ReplayGainProcessor::reset()
{
    currentGainDb = targetGainDb.load(std::memory_order_acquire);
    rampPosition = rampSamples;
    clippingRisk.store(false, std::memory_order_release);
}

void ReplayGainProcessor::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
        return;

    const int ch = buffer.getNumChannels();
    if (ch <= 0)
        return;

    const float target = targetGainDb.load(std::memory_order_acquire);

    const float rampStartGainDb = currentGainDb;

    bool risk = false;

    for (int sample = 0; sample < numSamples; ++sample)
    {
        if (rampPosition < rampSamples)
        {
            const float t = static_cast<float>(rampPosition) / static_cast<float>(rampSamples);
            currentGainDb = rampStartGainDb + (target - rampStartGainDb) * t;
            ++rampPosition;
        }
        else
        {
            currentGainDb = target;
        }

        float gain = dbToLinear(currentGainDb);
        gain = std::max(minLinearGain, std::min(maxLinearGain, gain));

        for (int channel = 0; channel < ch; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            if (samples == nullptr)
                continue;

            samples[sample] = sanitize(samples[sample] * gain);

            if (std::abs(samples[sample]) > 0.98f)
                risk = true;
        }
    }

    clippingRisk.store(risk, std::memory_order_release);
}

void ReplayGainProcessor::setConfig(const ReplayGainConfig& config)
{
    currentConfig = config;

    float gainDb = 0.0f;

    if (config.mode == replayGainModeTrack)
        gainDb = config.trackGainDb;
    else if (config.mode == replayGainModeAlbum)
        gainDb = config.albumGainDb;

    gainDb += config.preampDb;

    if (config.preventClipping && config.peak > 0.0f)
    {
        const float appliedLinear = dbToLinear(gainDb);
        if (config.peak * appliedLinear > 1.0f)
        {
            const float maxGain = 1.0f / config.peak;
            const float maxGainDb = 20.0f * std::log10(maxGain);
            gainDb = std::min(gainDb, maxGainDb);
        }
    }

    targetGainDb.store(gainDb, std::memory_order_release);
}

ReplayGainConfig ReplayGainProcessor::getConfig() const
{
    ReplayGainConfig config = currentConfig;
    config.mode = currentConfig.mode;
    return config;
}

bool ReplayGainProcessor::isActive() const
{
    return currentConfig.mode != replayGainModeOff
        || std::abs(currentConfig.preampDb) > 0.01f;
}

float ReplayGainProcessor::getAppliedGainDb() const
{
    return currentGainDb;
}

bool ReplayGainProcessor::hasClippingRisk() const
{
    return clippingRisk.load(std::memory_order_acquire);
}
} // namespace echo
