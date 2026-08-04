#include "LevelMeterProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float silenceDb = -60.0f;
} // namespace

float LevelMeterProcessor::sanitizeDb(float db)
{
    if (! std::isfinite(db))
        return silenceDb;

    return std::max(silenceDb, std::min(0.0f, db));
}

float LevelMeterProcessor::sanitize(float value)
{
    return std::isfinite(value) ? value : 0.0f;
}

LevelMeterProcessor::LevelMeterProcessor()
{
    intervalMs.store(0, std::memory_order_release);
}

void LevelMeterProcessor::prepare(double sampleRateIn, int maximumBlockSize, int channelCountIn)
{
    (void) maximumBlockSize;

    sampleRate = sampleRateIn > 0.0 ? sampleRateIn : 44100.0;
    channelCount = std::max(1, channelCountIn);

    peakSquares.assign(static_cast<size_t>(channelCount), 0.0f);
    rmsSquares.assign(static_cast<size_t>(channelCount), 0.0f);

    reset();
}

void LevelMeterProcessor::reset()
{
    std::fill(peakSquares.begin(), peakSquares.end(), 0.0f);
    std::fill(rmsSquares.begin(), rmsSquares.end(), 0.0f);
    samplesSinceReport = 0.0;
}

void LevelMeterProcessor::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    const int interval = intervalMs.load(std::memory_order_acquire);
    if (interval <= 0 || numSamples <= 0)
        return;

    const int ch = std::min(buffer.getNumChannels(), channelCount);
    if (ch <= 0)
        return;

    const double intervalSamples = sampleRate * static_cast<double>(interval) / 1000.0;
    if (intervalSamples <= 0.0)
        return;

    for (int channel = 0; channel < ch; ++channel)
    {
        const float* src = buffer.getReadPointer(channel, startSample);
        if (src == nullptr)
            continue;

        const size_t chIdx = static_cast<size_t>(channel);

        for (int sample = 0; sample < numSamples; ++sample)
        {
            const float value = src[sample];
            const float square = sanitize(value * value);

            if (square > peakSquares[chIdx])
                peakSquares[chIdx] = square;

            rmsSquares[chIdx] += square;
        }
    }

    samplesSinceReport += static_cast<double>(numSamples);

    if (samplesSinceReport >= intervalSamples && callback)
    {
        LevelMeterSnapshot snapshot;
        snapshot.timestampMs = samplesSinceReport * 1000.0 / sampleRate;

        for (int channel = 0; channel < ch; ++channel)
        {
            const size_t chIdx = static_cast<size_t>(channel);

            const float peakDb = peakSquares[chIdx] > 0.0f
                ? 10.0f * std::log10(peakSquares[chIdx])
                : silenceDb;
            snapshot.peakDb.push_back(sanitizeDb(peakDb));

            const float meanSquare = samplesSinceReport > 0.0
                ? rmsSquares[chIdx] / static_cast<float>(samplesSinceReport)
                : 0.0f;
            const float rmsDb = meanSquare > 0.0f
                ? 10.0f * std::log10(meanSquare)
                : silenceDb;
            snapshot.rmsDb.push_back(sanitizeDb(rmsDb));
        }

        callback(snapshot);

        std::fill(peakSquares.begin(), peakSquares.end(), 0.0f);
        std::fill(rmsSquares.begin(), rmsSquares.end(), 0.0f);
        samplesSinceReport = 0.0;
    }
}

void LevelMeterProcessor::setIntervalMs(int ms)
{
    const int clamped = std::max(0, std::min(levelMeterMaxIntervalMs, ms));
    intervalMs.store(clamped, std::memory_order_release);
}

void LevelMeterProcessor::setCallback(Callback callbackIn)
{
    callback = std::move(callbackIn);
}

int LevelMeterProcessor::getIntervalMs() const
{
    return intervalMs.load(std::memory_order_acquire);
}

bool LevelMeterProcessor::isEnabled() const
{
    return intervalMs.load(std::memory_order_acquire) > 0;
}
} // namespace echo
