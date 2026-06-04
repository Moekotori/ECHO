#include "EqProcessor.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
bool nearlyEqual(float left, float right)
{
    return std::abs(left - right) <= 0.00001f;
}

float dbToGain(float db)
{
    return std::pow(10.0f, db / 20.0f);
}

float moveTowards(float current, float target, float step)
{
    if (std::abs(target - current) <= std::abs(step))
        return target;

    return current + (target > current ? std::abs(step) : -std::abs(step));
}

float protectClippingSample(float sample, bool shouldProtect, bool& risk)
{
    if (! std::isfinite(sample))
        return 0.0f;

    constexpr float threshold = 0.98f;
    constexpr float headroom = 1.0f - threshold;
    const float magnitude = std::abs(sample);
    if (magnitude <= threshold)
        return sample;

    risk = true;
    if (! shouldProtect)
        return sample;

    const float limited = threshold + headroom * std::tanh((magnitude - threshold) / headroom);
    return std::copysign(std::min(1.0f, limited), sample);
}
} // namespace

EqProcessor::EqProcessor()
{
    for (int band = 0; band < eqBandCount; ++band)
    {
        atomicBandGainsDb[static_cast<size_t>(band)].store(0.0f, std::memory_order_relaxed);
        atomicBandFrequenciesHz[static_cast<size_t>(band)].store(eqFrequenciesHz[static_cast<size_t>(band)], std::memory_order_relaxed);
        atomicBandQ[static_cast<size_t>(band)].store(1.0f, std::memory_order_relaxed);
        atomicBandFilterTypes[static_cast<size_t>(band)].store(static_cast<int>(EqFilterType::Peaking), std::memory_order_relaxed);
        atomicBandEnabled[static_cast<size_t>(band)].store(true, std::memory_order_relaxed);
    }
}

void EqProcessor::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    preparedChannels = std::max(1, channelCount);
    preparedBlockSize = std::max(1, maximumBlockSize);
    channelStates.resize(static_cast<size_t>(preparedChannels));
    updateSmoothingSteps();
    reset();
}

void EqProcessor::reset()
{
    for (auto& channel : channelStates)
        for (auto& filter : channel.filters)
            filter.reset();

    updateTargetSnapshot();
    smoothedPreampDb = targetPreampDb;
    bypassMix = targetEnabled.load(std::memory_order_acquire) ? 1.0f : 0.0f;
    targetBypassMix = bypassMix;
    targetBandGains = {};
    smoothedBandGains = {};
    targetBandFrequencies = eqFrequenciesHz;
    smoothedBandFrequencies = eqFrequenciesHz;
    targetBandQ = eqDefaultQ;
    smoothedBandQ = eqDefaultQ;
    smoothedBandFilterTypes = {};
    smoothedBandEnabled = eqDefaultBandEnabled;

    for (int band = 0; band < eqBandCount; ++band)
    {
        targetBandGains[band] = atomicBandGainsDb[band].load(std::memory_order_acquire);
        smoothedBandGains[band] = targetBandGains[band];
        targetBandFrequencies[band] = atomicBandFrequenciesHz[band].load(std::memory_order_acquire);
        smoothedBandFrequencies[band] = targetBandFrequencies[band];
        targetBandQ[band] = atomicBandQ[band].load(std::memory_order_acquire);
        smoothedBandQ[band] = targetBandQ[band];
        smoothedBandFilterTypes[band] = normalizeEqFilterType(atomicBandFilterTypes[band].load(std::memory_order_acquire));
        smoothedBandEnabled[band] = atomicBandEnabled[band].load(std::memory_order_acquire);
        updateBandCoefficient(band);
    }
}

void EqProcessor::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
        return;

    updateTargetSnapshot();

    const int channelCount = std::min(buffer.getNumChannels(), preparedChannels);
    bool risk = false;

    for (int sample = 0; sample < numSamples; ++sample)
    {
        smoothedPreampDb = moveTowards(smoothedPreampDb, targetPreampDb, preampStepDb);
        bypassMix = moveTowards(bypassMix, targetBypassMix, bypassStep);

        for (int band = 0; band < eqBandCount; ++band)
        {
            const float previousGain = smoothedBandGains[band];
            const float previousFrequency = smoothedBandFrequencies[band];
            const float previousQ = smoothedBandQ[band];
            const auto previousFilterType = smoothedBandFilterTypes[band];
            const bool previousEnabled = smoothedBandEnabled[band];
            smoothedBandGains[band] = moveTowards(previousGain, targetBandGains[band], bandGainSteps[band]);
            smoothedBandFrequencies[band] = moveTowards(previousFrequency, targetBandFrequencies[band], bandFrequencySteps[band]);
            smoothedBandQ[band] = moveTowards(previousQ, targetBandQ[band], bandQSteps[band]);
            smoothedBandFilterTypes[band] = normalizeEqFilterType(atomicBandFilterTypes[band].load(std::memory_order_acquire));
            smoothedBandEnabled[band] = atomicBandEnabled[band].load(std::memory_order_acquire);

            if (! nearlyEqual(previousGain, smoothedBandGains[band])
                || ! nearlyEqual(previousFrequency, smoothedBandFrequencies[band])
                || ! nearlyEqual(previousQ, smoothedBandQ[band])
                || previousFilterType != smoothedBandFilterTypes[band]
                || previousEnabled != smoothedBandEnabled[band])
            {
                updateBandCoefficient(band);
            }
        }

        const float preampGain = dbToGain(smoothedPreampDb);

        for (int channel = 0; channel < channelCount; ++channel)
        {
            auto* samples = buffer.getWritePointer(channel, startSample);
            const float dry = samples[sample];
            float wet = dry * preampGain;

            for (int band = 0; band < eqBandCount; ++band)
                wet = channelStates[static_cast<size_t>(channel)].filters[band].process(wet, coefficients[band]);

            const float mixed = dry + (wet - dry) * bypassMix;
            const bool shouldProtect = bypassMix > 0.0f || targetBypassMix > 0.0f || wasEnabled;
            samples[sample] = protectClippingSample(mixed, shouldProtect, risk);
        }
    }

    clippingRisk.store(risk, std::memory_order_release);
    wasEnabled = targetBypassMix > 0.5f;
}

void EqProcessor::setEnabled(bool shouldBeEnabled)
{
    targetEnabled.store(shouldBeEnabled, std::memory_order_release);
}

void EqProcessor::setPreampDb(float value)
{
    atomicPreampDb.store(clampEqPreampDb(value), std::memory_order_release);
}

bool EqProcessor::setBandGainDb(int bandIndex, float value)
{
    if (bandIndex < 0 || bandIndex >= eqBandCount)
        return false;

    atomicBandGainsDb[static_cast<size_t>(bandIndex)].store(clampEqGainDb(value), std::memory_order_release);
    return true;
}

bool EqProcessor::setBandFrequencyHz(int bandIndex, float value)
{
    if (bandIndex < 0 || bandIndex >= eqBandCount || ! std::isfinite(value))
        return false;

    atomicBandFrequenciesHz[static_cast<size_t>(bandIndex)].store(clampEqFrequencyHz(value), std::memory_order_release);
    return true;
}

bool EqProcessor::setBandQ(int bandIndex, float value)
{
    if (bandIndex < 0 || bandIndex >= eqBandCount || ! std::isfinite(value))
        return false;

    atomicBandQ[static_cast<size_t>(bandIndex)].store(clampEqQ(value), std::memory_order_release);
    return true;
}

bool EqProcessor::setBandFilterType(int bandIndex, EqFilterType value)
{
    if (bandIndex < 0 || bandIndex >= eqBandCount)
        return false;

    atomicBandFilterTypes[static_cast<size_t>(bandIndex)].store(static_cast<int>(normalizeEqFilterType(static_cast<int>(value))), std::memory_order_release);
    return true;
}

bool EqProcessor::setBandEnabled(int bandIndex, bool value)
{
    if (bandIndex < 0 || bandIndex >= eqBandCount)
        return false;

    atomicBandEnabled[static_cast<size_t>(bandIndex)].store(value, std::memory_order_release);
    return true;
}

void EqProcessor::resetFlat()
{
    setPreampDb(0.0f);

    for (int band = 0; band < eqBandCount; ++band)
    {
        setBandGainDb(band, 0.0f);
        setBandFrequencyHz(band, eqFrequenciesHz[static_cast<size_t>(band)]);
        setBandQ(band, 1.0f);
        setBandFilterType(band, EqFilterType::Peaking);
        setBandEnabled(band, true);
    }
}

void EqProcessor::setState(const EqState& state)
{
    setEnabled(state.enabled);
    setPreampDb(state.preampDb);

    for (int band = 0; band < eqBandCount; ++band)
    {
        setBandGainDb(band, state.bandGainsDb[static_cast<size_t>(band)]);
        setBandFrequencyHz(band, state.bandFrequenciesHz[static_cast<size_t>(band)]);
        setBandQ(band, state.bandQ[static_cast<size_t>(band)]);
        setBandFilterType(band, state.bandFilterTypes[static_cast<size_t>(band)]);
        setBandEnabled(band, state.bandEnabled[static_cast<size_t>(band)]);
    }
}

EqState EqProcessor::getState() const
{
    EqState state;
    state.enabled = targetEnabled.load(std::memory_order_acquire);
    state.preampDb = atomicPreampDb.load(std::memory_order_acquire);

    for (int band = 0; band < eqBandCount; ++band)
    {
        state.bandGainsDb[static_cast<size_t>(band)] = atomicBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire);
        state.bandFrequenciesHz[static_cast<size_t>(band)] = atomicBandFrequenciesHz[static_cast<size_t>(band)].load(std::memory_order_acquire);
        state.bandQ[static_cast<size_t>(band)] = atomicBandQ[static_cast<size_t>(band)].load(std::memory_order_acquire);
        state.bandFilterTypes[static_cast<size_t>(band)] =
            normalizeEqFilterType(atomicBandFilterTypes[static_cast<size_t>(band)].load(std::memory_order_acquire));
        state.bandEnabled[static_cast<size_t>(band)] = atomicBandEnabled[static_cast<size_t>(band)].load(std::memory_order_acquire);
    }

    return state;
}

bool EqProcessor::isEnabled() const
{
    return targetEnabled.load(std::memory_order_acquire);
}

bool EqProcessor::hasClippingRisk() const
{
    return clippingRisk.load(std::memory_order_acquire);
}

#if defined(ECHO_AUDIO_ENGINE_TESTS) && ECHO_AUDIO_ENGINE_TESTS
uint64_t EqProcessor::getCoefficientUpdateCountForTests() const
{
    return coefficientUpdateCount;
}
#endif

void EqProcessor::updateSmoothingSteps()
{
    gainSmoothingSamples = std::max(1, static_cast<int>(currentSampleRate * 0.008));
    bypassSmoothingSamples = std::max(1, static_cast<int>(currentSampleRate * 0.006));
}

void EqProcessor::updateBandCoefficient(int bandIndex)
{
    coefficients[static_cast<size_t>(bandIndex)] = makeEqCoefficients(
        currentSampleRate,
        smoothedBandFrequencies[static_cast<size_t>(bandIndex)],
        smoothedBandGains[static_cast<size_t>(bandIndex)],
        smoothedBandQ[static_cast<size_t>(bandIndex)],
        smoothedBandFilterTypes[static_cast<size_t>(bandIndex)],
        smoothedBandEnabled[static_cast<size_t>(bandIndex)]);

#if defined(ECHO_AUDIO_ENGINE_TESTS) && ECHO_AUDIO_ENGINE_TESTS
    ++coefficientUpdateCount;
#endif
}

void EqProcessor::updateTargetSnapshot()
{
    targetPreampDb = atomicPreampDb.load(std::memory_order_acquire);
    preampStepDb = (targetPreampDb - smoothedPreampDb) / static_cast<float>(gainSmoothingSamples);
    targetBypassMix = targetEnabled.load(std::memory_order_acquire) ? 1.0f : 0.0f;
    bypassStep = (targetBypassMix - bypassMix) / static_cast<float>(bypassSmoothingSamples);

    for (int band = 0; band < eqBandCount; ++band)
    {
        targetBandGains[static_cast<size_t>(band)] = atomicBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire);
        bandGainSteps[static_cast<size_t>(band)] =
            (targetBandGains[static_cast<size_t>(band)] - smoothedBandGains[static_cast<size_t>(band)])
            / static_cast<float>(gainSmoothingSamples);
        targetBandFrequencies[static_cast<size_t>(band)] = atomicBandFrequenciesHz[static_cast<size_t>(band)].load(std::memory_order_acquire);
        bandFrequencySteps[static_cast<size_t>(band)] =
            (targetBandFrequencies[static_cast<size_t>(band)] - smoothedBandFrequencies[static_cast<size_t>(band)])
            / static_cast<float>(gainSmoothingSamples);
        targetBandQ[static_cast<size_t>(band)] = atomicBandQ[static_cast<size_t>(band)].load(std::memory_order_acquire);
        bandQSteps[static_cast<size_t>(band)] =
            (targetBandQ[static_cast<size_t>(band)] - smoothedBandQ[static_cast<size_t>(band)])
            / static_cast<float>(gainSmoothingSamples);
    }
}
} // namespace echo
