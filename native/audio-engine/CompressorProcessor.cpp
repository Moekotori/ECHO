#include "CompressorProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float minimumThresholdDb = -72.0f;
constexpr float maximumThresholdDb = 0.0f;
constexpr float minimumRatio = 1.0f;
constexpr float maximumRatio = 40.0f;
constexpr float minimumAttackMs = 0.1f;
constexpr float maximumAttackMs = 500.0f;
constexpr float minimumReleaseMs = 5.0f;
constexpr float maximumReleaseMs = 5000.0f;
constexpr float minimumKneeDb = 0.0f;
constexpr float maximumKneeDb = 24.0f;
constexpr float minimumMakeupDb = -24.0f;
constexpr float maximumMakeupDb = 24.0f;
constexpr float minimumDetectorLevel = 1.0e-9f;

float clampFinite(float value, float minimum, float maximum, float fallback)
{
    return std::isfinite(value) ? std::clamp(value, minimum, maximum) : fallback;
}

float dbToGain(float value)
{
    return std::pow(10.0f, value / 20.0f);
}

float gainToDb(float value)
{
    return 20.0f * std::log10(std::max(value, minimumDetectorLevel));
}

float smoothingCoefficient(float milliseconds, double sampleRate)
{
    const double samples = std::max(1.0, sampleRate * static_cast<double>(milliseconds) / 1000.0);
    return static_cast<float>(std::exp(-1.0 / samples));
}
} // namespace

void CompressorProcessor::prepare(double sampleRate, int, int)
{
    sampleRate_ = std::max(1.0, sampleRate);
    reset();
}

void CompressorProcessor::reset()
{
    smoothedGain_ = 1.0f;
    gainReductionDb_.store(0.0f, std::memory_order_release);
}

void CompressorProcessor::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
        return;

    if (!isEnabled())
    {
        reset();
        return;
    }

    const auto state = getState();
    const float attackCoefficient = smoothingCoefficient(state.attackMs, sampleRate_);
    const float releaseCoefficient = smoothingCoefficient(state.releaseMs, sampleRate_);
    const float makeupGain = dbToGain(state.makeupDb);
    const int channelCount = buffer.getNumChannels();
    float peakReductionDb = 0.0f;

    for (int sample = 0; sample < numSamples; ++sample)
    {
        float detector = 0.0f;
        for (int channel = 0; channel < channelCount; ++channel)
        {
            const auto* samples = buffer.getReadPointer(channel, startSample);
            detector = std::max(detector, std::abs(samples[sample]));
        }

        const float reductionDb = computeReductionDb(
            gainToDb(detector), state.thresholdDb, state.ratio, state.kneeDb);
        const float targetGain = dbToGain(-reductionDb);
        const float coefficient = targetGain < smoothedGain_ ? attackCoefficient : releaseCoefficient;
        smoothedGain_ = coefficient * smoothedGain_ + (1.0f - coefficient) * targetGain;
        peakReductionDb = std::max(peakReductionDb, -gainToDb(smoothedGain_));
        const float wetGain = smoothedGain_ * makeupGain;

        for (int channel = 0; channel < channelCount; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            const float dry = samples[sample];
            samples[sample] = dry * ((1.0f - state.mix) + state.mix * wetGain);
        }
    }

    gainReductionDb_.store(peakReductionDb, std::memory_order_release);
}

void CompressorProcessor::setState(const CompressorState& state)
{
    const auto safe = sanitizeState(state);
    thresholdDb_.store(safe.thresholdDb, std::memory_order_release);
    ratio_.store(safe.ratio, std::memory_order_release);
    attackMs_.store(safe.attackMs, std::memory_order_release);
    releaseMs_.store(safe.releaseMs, std::memory_order_release);
    kneeDb_.store(safe.kneeDb, std::memory_order_release);
    makeupDb_.store(safe.makeupDb, std::memory_order_release);
    mix_.store(safe.mix, std::memory_order_release);
    enabled_.store(safe.enabled, std::memory_order_release);
}

CompressorState CompressorProcessor::getState() const
{
    CompressorState state;
    state.enabled = enabled_.load(std::memory_order_acquire);
    state.thresholdDb = thresholdDb_.load(std::memory_order_acquire);
    state.ratio = ratio_.load(std::memory_order_acquire);
    state.attackMs = attackMs_.load(std::memory_order_acquire);
    state.releaseMs = releaseMs_.load(std::memory_order_acquire);
    state.kneeDb = kneeDb_.load(std::memory_order_acquire);
    state.makeupDb = makeupDb_.load(std::memory_order_acquire);
    state.mix = mix_.load(std::memory_order_acquire);
    return state;
}

bool CompressorProcessor::isEnabled() const
{
    return enabled_.load(std::memory_order_acquire);
}

bool CompressorProcessor::hasClippingRisk() const
{
    return isEnabled() && makeupDb_.load(std::memory_order_acquire) > 0.001f;
}

float CompressorProcessor::gainReductionDb() const
{
    return gainReductionDb_.load(std::memory_order_acquire);
}

CompressorState CompressorProcessor::sanitizeState(const CompressorState& state)
{
    CompressorState safe;
    safe.enabled = state.enabled;
    safe.thresholdDb = clampFinite(state.thresholdDb, minimumThresholdDb, maximumThresholdDb, -18.0f);
    safe.ratio = clampFinite(state.ratio, minimumRatio, maximumRatio, 4.0f);
    safe.attackMs = clampFinite(state.attackMs, minimumAttackMs, maximumAttackMs, 10.0f);
    safe.releaseMs = clampFinite(state.releaseMs, minimumReleaseMs, maximumReleaseMs, 120.0f);
    safe.kneeDb = clampFinite(state.kneeDb, minimumKneeDb, maximumKneeDb, 6.0f);
    safe.makeupDb = clampFinite(state.makeupDb, minimumMakeupDb, maximumMakeupDb, 0.0f);
    safe.mix = clampFinite(state.mix, 0.0f, 1.0f, 1.0f);
    return safe;
}

float CompressorProcessor::computeReductionDb(float inputDb, float thresholdDb, float ratio, float kneeDb)
{
    const float overDb = inputDb - thresholdDb;
    const float slope = 1.0f - 1.0f / ratio;
    if (kneeDb <= 0.001f)
        return std::max(0.0f, overDb * slope);

    const float halfKnee = kneeDb * 0.5f;
    if (overDb <= -halfKnee)
        return 0.0f;
    if (overDb >= halfKnee)
        return overDb * slope;

    const float kneePosition = overDb + halfKnee;
    return slope * kneePosition * kneePosition / (2.0f * kneeDb);
}
} // namespace echo
