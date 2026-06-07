#include "ChannelBalanceProcessor.h"
#include "UzumeGpuBackend.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
constexpr float pi = 3.14159265358979323846f;
constexpr float stableEpsilon = 0.000001f;

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

float sanitize(float value)
{
    return std::isfinite(value) ? value : 0.0f;
}

bool nearlyEqual(float left, float right)
{
    return std::abs(left - right) <= stableEpsilon;
}

bool allZeroBands(const std::array<float, channelBalanceBandCount>& values)
{
    return std::all_of(values.begin(), values.end(), [] (float value) {
        return nearlyEqual(value, 0.0f);
    });
}

ChannelBalanceMonoMode monoModeFromInt(int value)
{
    switch (value)
    {
        case static_cast<int>(ChannelBalanceMonoMode::SumToMono): return ChannelBalanceMonoMode::SumToMono;
        case static_cast<int>(ChannelBalanceMonoMode::LeftOnly): return ChannelBalanceMonoMode::LeftOnly;
        case static_cast<int>(ChannelBalanceMonoMode::RightOnly): return ChannelBalanceMonoMode::RightOnly;
        default: return ChannelBalanceMonoMode::Off;
    }
}

void applyMono(ChannelBalanceMonoMode mode, float left, float right, float& outputLeft, float& outputRight)
{
    switch (mode)
    {
        case ChannelBalanceMonoMode::SumToMono:
        {
            const float mono = (left + right) * 0.5f;
            outputLeft = mono;
            outputRight = mono;
            break;
        }
        case ChannelBalanceMonoMode::LeftOnly:
            outputLeft = left;
            outputRight = 0.0f;
            break;
        case ChannelBalanceMonoMode::RightOnly:
            outputLeft = 0.0f;
            outputRight = right;
            break;
        case ChannelBalanceMonoMode::Off:
        default:
            outputLeft = left;
            outputRight = right;
            break;
    }
}
} // namespace

float clampChannelBalance(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    return std::max(channelBalanceMinBalance, std::min(channelBalanceMaxBalance, value));
}

float clampChannelGainDb(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    return std::max(channelBalanceMinGainDb, std::min(channelBalanceMaxGainDb, value));
}

float clampChannelBandGainDb(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    return std::max(channelBalanceBandMinGainDb, std::min(channelBalanceBandMaxGainDb, value));
}

float clampChannelDelayMs(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    return std::max(channelBalanceMinDelayMs, std::min(channelBalanceMaxDelayMs, value));
}

ChannelBalanceProcessor::ChannelBalanceProcessor()
{
    for (int band = 0; band < channelBalanceBandCount; ++band)
    {
        atomicLeftBandGainsDb[static_cast<size_t>(band)].store(0.0f, std::memory_order_relaxed);
        atomicRightBandGainsDb[static_cast<size_t>(band)].store(0.0f, std::memory_order_relaxed);
    }
}

void ChannelBalanceProcessor::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    preparedChannels = std::max(1, channelCount);
    preparedBlockSize = std::max(1, maximumBlockSize);
    const int maxDelaySamples = std::max(1, static_cast<int>(std::ceil(currentSampleRate * channelBalanceMaxDelayMs / 1000.0f)));
    delayBufferLength = maxDelaySamples + 2;
    delayHistory.assign(static_cast<size_t>(std::min(2, preparedChannels)), std::vector<float>(static_cast<size_t>(delayBufferLength), 0.0f));
    delayWriteIndex = 0;
    updateSmoothingSteps();
    reset();
}

void ChannelBalanceProcessor::reset()
{
    const auto target = readTargetSnapshot();
    smoothedBalance = target.balance;
    smoothedLeftGainDb = target.leftGainDb;
    smoothedRightGainDb = target.rightGainDb;
    smoothedLeftBandGainsDb = target.leftBandGainsDb;
    smoothedRightBandGainsDb = target.rightBandGainsDb;
    smoothedLeftDelayMs = target.leftDelayMs;
    smoothedRightDelayMs = target.rightDelayMs;
    enabledMix = target.enabled ? 1.0f : 0.0f;
    swapMix = target.swapLeftRight ? 1.0f : 0.0f;
    monoMix = 1.0f;
    invertLeftMix = target.invertLeft ? 1.0f : 0.0f;
    invertRightMix = target.invertRight ? 1.0f : 0.0f;
    constantPowerMix = target.constantPower ? 1.0f : 0.0f;
    previousMonoMode = target.monoMode;
    activeMonoMode = target.monoMode;
    targetMonoMode = target.monoMode;
    for (auto& channelHistory : delayHistory)
        std::fill(channelHistory.begin(), channelHistory.end(), 0.0f);
    lowBandState = {};
    highLowpassState = {};
    delayWriteIndex = 0;
    clippingRisk.store(false, std::memory_order_release);
    clearGpuPlaybackStatus();
}

void ChannelBalanceProcessor::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
    {
        clearGpuPlaybackStatus();
        return;
    }

    const int channelCount = std::min(buffer.getNumChannels(), preparedChannels);

    if (channelCount <= 0)
    {
        clearGpuPlaybackStatus();
        return;
    }

    clearGpuPlaybackStatus();
    const auto target = readTargetSnapshot();
    updateSwitchTargets(target);
    const bool physicalSoloActive = target.enabled
        && (target.monoMode == ChannelBalanceMonoMode::LeftOnly || target.monoMode == ChannelBalanceMonoMode::RightOnly);

    balanceStep = (target.balance - smoothedBalance) / static_cast<float>(parameterSmoothingSamples);
    leftGainStepDb = (target.leftGainDb - smoothedLeftGainDb) / static_cast<float>(parameterSmoothingSamples);
    rightGainStepDb = (target.rightGainDb - smoothedRightGainDb) / static_cast<float>(parameterSmoothingSamples);
    for (int band = 0; band < channelBalanceBandCount; ++band)
    {
        leftBandGainStepsDb[static_cast<size_t>(band)] =
            (target.leftBandGainsDb[static_cast<size_t>(band)] - smoothedLeftBandGainsDb[static_cast<size_t>(band)]) / static_cast<float>(parameterSmoothingSamples);
        rightBandGainStepsDb[static_cast<size_t>(band)] =
            (target.rightBandGainsDb[static_cast<size_t>(band)] - smoothedRightBandGainsDb[static_cast<size_t>(band)]) / static_cast<float>(parameterSmoothingSamples);
    }
    leftDelayStepMs = (target.leftDelayMs - smoothedLeftDelayMs) / static_cast<float>(parameterSmoothingSamples);
    rightDelayStepMs = (target.rightDelayMs - smoothedRightDelayMs) / static_cast<float>(parameterSmoothingSamples);

    bool risk = false;

    if (channelCount == 1)
    {
        auto* leftSamples = buffer.getWritePointer(0, startSample);

        for (int sample = 0; sample < numSamples; ++sample)
        {
            smoothedBalance = moveTowards(smoothedBalance, target.balance, balanceStep);
            smoothedLeftGainDb = moveTowards(smoothedLeftGainDb, target.leftGainDb, leftGainStepDb);
            for (int band = 0; band < channelBalanceBandCount; ++band)
                smoothedLeftBandGainsDb[static_cast<size_t>(band)] = moveTowards(
                    smoothedLeftBandGainsDb[static_cast<size_t>(band)],
                    target.leftBandGainsDb[static_cast<size_t>(band)],
                    leftBandGainStepsDb[static_cast<size_t>(band)]);
            smoothedLeftDelayMs = moveTowards(smoothedLeftDelayMs, target.leftDelayMs, leftDelayStepMs);
            enabledMix = moveTowards(enabledMix, target.enabled ? 1.0f : 0.0f, enabledStep);
            invertLeftMix = moveTowards(invertLeftMix, target.invertLeft ? 1.0f : 0.0f, invertLeftStep);
            constantPowerMix = moveTowards(constantPowerMix, target.constantPower ? 1.0f : 0.0f, constantPowerStep);

            float linearLeft = 1.0f;
            float linearRight = 1.0f;
            float constantLeft = 1.0f;
            float constantRight = 1.0f;
            calculateBalanceGains(smoothedBalance, false, linearLeft, linearRight);
            calculateBalanceGains(smoothedBalance, true, constantLeft, constantRight);
            const float balanceLeft = linearLeft + (constantLeft - linearLeft) * constantPowerMix;

            const float dry = leftSamples[sample];
            const float inverted = dry * (1.0f - (2.0f * invertLeftMix));
            const float wet = applyBandCompensation(0, inverted * balanceLeft * dbToGain(smoothedLeftGainDb), smoothedLeftBandGainsDb);
            pushDelaySample(0, wet);
            const float delayedWet = readDelaySample(0, smoothedLeftDelayMs);
            delayWriteIndex = (delayWriteIndex + 1) % delayBufferLength;
            const float mixed = dry + (delayedWet - dry) * enabledMix;
            leftSamples[sample] = sanitize(mixed);

            if (std::abs(leftSamples[sample]) > 0.98f)
                risk = true;
        }

        clippingRisk.store(risk, std::memory_order_release);
        return;
    }

    auto* leftSamples = buffer.getWritePointer(0, startSample);
    auto* rightSamples = buffer.getWritePointer(1, startSample);

    if (tryProcessStableStereoGpuPath(buffer, startSample, numSamples, channelCount, target, risk))
    {
        clippingRisk.store(risk, std::memory_order_release);
        return;
    }

    for (int sample = 0; sample < numSamples; ++sample)
    {
        smoothedBalance = moveTowards(smoothedBalance, target.balance, balanceStep);
        smoothedLeftGainDb = moveTowards(smoothedLeftGainDb, target.leftGainDb, leftGainStepDb);
        smoothedRightGainDb = moveTowards(smoothedRightGainDb, target.rightGainDb, rightGainStepDb);
        for (int band = 0; band < channelBalanceBandCount; ++band)
        {
            smoothedLeftBandGainsDb[static_cast<size_t>(band)] = moveTowards(
                smoothedLeftBandGainsDb[static_cast<size_t>(band)],
                target.leftBandGainsDb[static_cast<size_t>(band)],
                leftBandGainStepsDb[static_cast<size_t>(band)]);
            smoothedRightBandGainsDb[static_cast<size_t>(band)] = moveTowards(
                smoothedRightBandGainsDb[static_cast<size_t>(band)],
                target.rightBandGainsDb[static_cast<size_t>(band)],
                rightBandGainStepsDb[static_cast<size_t>(band)]);
        }
        smoothedLeftDelayMs = moveTowards(smoothedLeftDelayMs, target.leftDelayMs, leftDelayStepMs);
        smoothedRightDelayMs = moveTowards(smoothedRightDelayMs, target.rightDelayMs, rightDelayStepMs);
        enabledMix = moveTowards(enabledMix, target.enabled ? 1.0f : 0.0f, enabledStep);
        swapMix = moveTowards(swapMix, target.swapLeftRight ? 1.0f : 0.0f, swapStep);
        monoMix = moveTowards(monoMix, 1.0f, monoStep);
        invertLeftMix = moveTowards(invertLeftMix, target.invertLeft ? 1.0f : 0.0f, invertLeftStep);
        invertRightMix = moveTowards(invertRightMix, target.invertRight ? 1.0f : 0.0f, invertRightStep);
        constantPowerMix = moveTowards(constantPowerMix, target.constantPower ? 1.0f : 0.0f, constantPowerStep);

        float linearLeft = 1.0f;
        float linearRight = 1.0f;
        float constantLeft = 1.0f;
        float constantRight = 1.0f;
        calculateBalanceGains(smoothedBalance, false, linearLeft, linearRight);
        calculateBalanceGains(smoothedBalance, true, constantLeft, constantRight);
        const float balanceLeft = linearLeft + (constantLeft - linearLeft) * constantPowerMix;
        const float balanceRight = linearRight + (constantRight - linearRight) * constantPowerMix;

        const float dryLeft = leftSamples[sample];
        const float dryRight = rightSamples[sample];

        const float swappedLeft = dryLeft + (dryRight - dryLeft) * swapMix;
        const float swappedRight = dryRight + (dryLeft - dryRight) * swapMix;
        const float invertedLeft = swappedLeft * (1.0f - (2.0f * invertLeftMix));
        const float invertedRight = swappedRight * (1.0f - (2.0f * invertRightMix));
        const float balancedLeft = applyBandCompensation(0, invertedLeft * balanceLeft * dbToGain(smoothedLeftGainDb), smoothedLeftBandGainsDb);
        const float balancedRight = applyBandCompensation(1, invertedRight * balanceRight * dbToGain(smoothedRightGainDb), smoothedRightBandGainsDb);

        float previousMonoLeft = balancedLeft;
        float previousMonoRight = balancedRight;
        float activeMonoLeft = balancedLeft;
        float activeMonoRight = balancedRight;
        applyMono(previousMonoMode, balancedLeft, balancedRight, previousMonoLeft, previousMonoRight);
        applyMono(activeMonoMode, balancedLeft, balancedRight, activeMonoLeft, activeMonoRight);

        const float wetLeft = previousMonoLeft + (activeMonoLeft - previousMonoLeft) * monoMix;
        const float wetRight = previousMonoRight + (activeMonoRight - previousMonoRight) * monoMix;
        pushDelaySample(0, wetLeft);
        pushDelaySample(1, wetRight);
        const float delayedWetLeft = readDelaySample(0, smoothedLeftDelayMs);
        const float delayedWetRight = readDelaySample(1, smoothedRightDelayMs);
        delayWriteIndex = (delayWriteIndex + 1) % delayBufferLength;
        const float outputLeft = physicalSoloActive ? delayedWetLeft : dryLeft + (delayedWetLeft - dryLeft) * enabledMix;
        const float outputRight = physicalSoloActive ? delayedWetRight : dryRight + (delayedWetRight - dryRight) * enabledMix;

        leftSamples[sample] = sanitize(outputLeft);
        rightSamples[sample] = sanitize(outputRight);

        if (std::abs(leftSamples[sample]) > 0.98f || std::abs(rightSamples[sample]) > 0.98f)
            risk = true;
    }

    // First version intentionally affects only channel 0/1. Additional channels
    // are preserved for future expansion into a full channel matrix.
    clippingRisk.store(risk, std::memory_order_release);
}

void ChannelBalanceProcessor::setState(const ChannelBalanceState& state)
{
    targetEnabled.store(state.enabled, std::memory_order_release);
    atomicBalance.store(clampChannelBalance(state.balance), std::memory_order_release);
    atomicLeftGainDb.store(clampChannelGainDb(state.leftGainDb), std::memory_order_release);
    atomicRightGainDb.store(clampChannelGainDb(state.rightGainDb), std::memory_order_release);
    for (int band = 0; band < channelBalanceBandCount; ++band)
    {
        atomicLeftBandGainsDb[static_cast<size_t>(band)].store(clampChannelBandGainDb(state.leftBandGainsDb[static_cast<size_t>(band)]), std::memory_order_release);
        atomicRightBandGainsDb[static_cast<size_t>(band)].store(clampChannelBandGainDb(state.rightBandGainsDb[static_cast<size_t>(band)]), std::memory_order_release);
    }
    atomicLeftDelayMs.store(clampChannelDelayMs(state.leftDelayMs), std::memory_order_release);
    atomicRightDelayMs.store(clampChannelDelayMs(state.rightDelayMs), std::memory_order_release);
    targetSwapLeftRight.store(state.swapLeftRight, std::memory_order_release);
    atomicMonoMode.store(static_cast<int>(state.monoMode), std::memory_order_release);
    targetInvertLeft.store(state.invertLeft, std::memory_order_release);
    targetInvertRight.store(state.invertRight, std::memory_order_release);
    targetConstantPower.store(state.constantPower, std::memory_order_release);
}

ChannelBalanceState ChannelBalanceProcessor::getState() const
{
    ChannelBalanceState state;
    state.enabled = targetEnabled.load(std::memory_order_acquire);
    state.balance = atomicBalance.load(std::memory_order_acquire);
    state.leftGainDb = atomicLeftGainDb.load(std::memory_order_acquire);
    state.rightGainDb = atomicRightGainDb.load(std::memory_order_acquire);
    for (int band = 0; band < channelBalanceBandCount; ++band)
    {
        state.leftBandGainsDb[static_cast<size_t>(band)] = atomicLeftBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire);
        state.rightBandGainsDb[static_cast<size_t>(band)] = atomicRightBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire);
    }
    state.leftDelayMs = atomicLeftDelayMs.load(std::memory_order_acquire);
    state.rightDelayMs = atomicRightDelayMs.load(std::memory_order_acquire);
    state.swapLeftRight = targetSwapLeftRight.load(std::memory_order_acquire);
    state.monoMode = monoModeFromInt(atomicMonoMode.load(std::memory_order_acquire));
    state.invertLeft = targetInvertLeft.load(std::memory_order_acquire);
    state.invertRight = targetInvertRight.load(std::memory_order_acquire);
    state.constantPower = targetConstantPower.load(std::memory_order_acquire);
    return state;
}

void ChannelBalanceProcessor::resetToDefault()
{
    setState(ChannelBalanceState {});
}

bool ChannelBalanceProcessor::isEnabled() const
{
    return targetEnabled.load(std::memory_order_acquire);
}

bool ChannelBalanceProcessor::hasClippingRisk() const
{
    return clippingRisk.load(std::memory_order_acquire);
}

bool ChannelBalanceProcessor::didUseGpuMatrixPlayback() const
{
    return gpuMatrixPlaybackProcessed.load(std::memory_order_acquire);
}

bool ChannelBalanceProcessor::hadGpuMatrixPlaybackFallback() const
{
    return gpuMatrixPlaybackFallback.load(std::memory_order_acquire);
}

const char* ChannelBalanceProcessor::getGpuMatrixPlaybackFallbackReason() const
{
    return gpuMatrixPlaybackFallbackReason.load(std::memory_order_acquire);
}

void ChannelBalanceProcessor::clearGpuPlaybackStatus()
{
    gpuMatrixPlaybackProcessed.store(false, std::memory_order_release);
    gpuMatrixPlaybackFallback.store(false, std::memory_order_release);
    gpuMatrixPlaybackFallbackReason.store(nullptr, std::memory_order_release);
}

bool ChannelBalanceProcessor::tryProcessStableStereoGpuPath(
    juce::AudioBuffer<float>& buffer,
    int startSample,
    int numSamples,
    int channelCount,
    const TargetSnapshot& target,
    bool& risk)
{
    if (! isStableStereoGpuPathEligible(channelCount, target))
        return false;

    float linearLeft = 1.0f;
    float linearRight = 1.0f;
    float constantLeft = 1.0f;
    float constantRight = 1.0f;
    calculateBalanceGains(target.balance, false, linearLeft, linearRight);
    calculateBalanceGains(target.balance, true, constantLeft, constantRight);
    const float constantMix = target.constantPower ? 1.0f : 0.0f;
    const float balanceLeft = linearLeft + (constantLeft - linearLeft) * constantMix;
    const float balanceRight = linearRight + (constantRight - linearRight) * constantMix;
    const float leftGain = balanceLeft * dbToGain(target.leftGainDb) * (target.invertLeft ? -1.0f : 1.0f);
    const float rightGain = balanceRight * dbToGain(target.rightGainDb) * (target.invertRight ? -1.0f : 1.0f);
    const float baseLeftToLeft = target.swapLeftRight ? 0.0f : leftGain;
    const float baseRightToLeft = target.swapLeftRight ? leftGain : 0.0f;
    const float baseLeftToRight = target.swapLeftRight ? rightGain : 0.0f;
    const float baseRightToRight = target.swapLeftRight ? 0.0f : rightGain;
    UzumeGpuStereoMatrix matrix {
        baseLeftToLeft,
        baseRightToLeft,
        baseLeftToRight,
        baseRightToRight,
        1.0f,
    };

    switch (target.monoMode)
    {
        case ChannelBalanceMonoMode::SumToMono:
        {
            const float leftInputToMono = (baseLeftToLeft + baseLeftToRight) * 0.5f;
            const float rightInputToMono = (baseRightToLeft + baseRightToRight) * 0.5f;
            matrix = {
                leftInputToMono,
                rightInputToMono,
                leftInputToMono,
                rightInputToMono,
                1.0f,
            };
            break;
        }
        case ChannelBalanceMonoMode::LeftOnly:
            matrix = {
                baseLeftToLeft,
                baseRightToLeft,
                0.0f,
                0.0f,
                1.0f,
            };
            break;
        case ChannelBalanceMonoMode::RightOnly:
            matrix = {
                0.0f,
                0.0f,
                baseLeftToRight,
                baseRightToRight,
                1.0f,
            };
            break;
        case ChannelBalanceMonoMode::Off:
        default:
            break;
    }

    auto* leftSamples = buffer.getWritePointer(0, startSample);
    auto* rightSamples = buffer.getWritePointer(1, startSample);
    const auto gpuResult = processUzumeGpuPreparedPlaybackStereoMatrix(leftSamples, rightSamples, numSamples, matrix);
    if (! gpuResult.processed)
    {
        if (gpuResult.available)
        {
            gpuMatrixPlaybackFallback.store(true, std::memory_order_release);
            gpuMatrixPlaybackFallbackReason.store(gpuResult.fallbackReason, std::memory_order_release);
        }
        return false;
    }

    for (int sample = 0; sample < numSamples; ++sample)
    {
        leftSamples[sample] = sanitize(leftSamples[sample]);
        rightSamples[sample] = sanitize(rightSamples[sample]);
        pushDelaySample(0, leftSamples[sample]);
        pushDelaySample(1, rightSamples[sample]);
        delayWriteIndex = (delayWriteIndex + 1) % delayBufferLength;
    }

    risk = gpuResult.clippingRisk;
    gpuMatrixPlaybackProcessed.store(true, std::memory_order_release);
    return true;
}

bool ChannelBalanceProcessor::isStableStereoGpuPathEligible(int channelCount, const TargetSnapshot& target) const
{
    if (channelCount < 2 || ! target.enabled)
        return false;

    if (activeMonoMode != target.monoMode || targetMonoMode != target.monoMode)
        return false;

    if (! allZeroBands(target.leftBandGainsDb)
        || ! allZeroBands(target.rightBandGainsDb)
        || ! allZeroBands(smoothedLeftBandGainsDb)
        || ! allZeroBands(smoothedRightBandGainsDb))
        return false;

    if (! nearlyEqual(target.leftDelayMs, 0.0f)
        || ! nearlyEqual(target.rightDelayMs, 0.0f)
        || ! nearlyEqual(smoothedLeftDelayMs, 0.0f)
        || ! nearlyEqual(smoothedRightDelayMs, 0.0f))
        return false;

    if (! nearlyEqual(smoothedBalance, target.balance)
        || ! nearlyEqual(smoothedLeftGainDb, target.leftGainDb)
        || ! nearlyEqual(smoothedRightGainDb, target.rightGainDb)
        || ! nearlyEqual(enabledMix, 1.0f)
        || ! nearlyEqual(swapMix, target.swapLeftRight ? 1.0f : 0.0f)
        || ! nearlyEqual(monoMix, 1.0f)
        || ! nearlyEqual(invertLeftMix, target.invertLeft ? 1.0f : 0.0f)
        || ! nearlyEqual(invertRightMix, target.invertRight ? 1.0f : 0.0f)
        || ! nearlyEqual(constantPowerMix, target.constantPower ? 1.0f : 0.0f))
        return false;

    return nearlyEqual(balanceStep, 0.0f)
        && nearlyEqual(leftGainStepDb, 0.0f)
        && nearlyEqual(rightGainStepDb, 0.0f)
        && allZeroBands(leftBandGainStepsDb)
        && allZeroBands(rightBandGainStepsDb)
        && nearlyEqual(leftDelayStepMs, 0.0f)
        && nearlyEqual(rightDelayStepMs, 0.0f)
        && nearlyEqual(enabledStep, 0.0f)
        && nearlyEqual(swapStep, 0.0f)
        && nearlyEqual(monoStep, 0.0f)
        && nearlyEqual(invertLeftStep, 0.0f)
        && nearlyEqual(invertRightStep, 0.0f)
        && nearlyEqual(constantPowerStep, 0.0f);
}

void ChannelBalanceProcessor::updateSmoothingSteps()
{
    parameterSmoothingSamples = std::max(1, static_cast<int>(currentSampleRate * 0.02));
    switchSmoothingSamples = std::max(1, static_cast<int>(currentSampleRate * 0.012));
}

ChannelBalanceProcessor::TargetSnapshot ChannelBalanceProcessor::readTargetSnapshot() const
{
    TargetSnapshot target;
    target.enabled = targetEnabled.load(std::memory_order_acquire);
    target.balance = clampChannelBalance(atomicBalance.load(std::memory_order_acquire));
    target.leftGainDb = clampChannelGainDb(atomicLeftGainDb.load(std::memory_order_acquire));
    target.rightGainDb = clampChannelGainDb(atomicRightGainDb.load(std::memory_order_acquire));
    for (int band = 0; band < channelBalanceBandCount; ++band)
    {
        target.leftBandGainsDb[static_cast<size_t>(band)] = clampChannelBandGainDb(atomicLeftBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire));
        target.rightBandGainsDb[static_cast<size_t>(band)] = clampChannelBandGainDb(atomicRightBandGainsDb[static_cast<size_t>(band)].load(std::memory_order_acquire));
    }
    target.leftDelayMs = clampChannelDelayMs(atomicLeftDelayMs.load(std::memory_order_acquire));
    target.rightDelayMs = clampChannelDelayMs(atomicRightDelayMs.load(std::memory_order_acquire));
    target.swapLeftRight = targetSwapLeftRight.load(std::memory_order_acquire);
    target.monoMode = monoModeFromInt(atomicMonoMode.load(std::memory_order_acquire));
    target.invertLeft = targetInvertLeft.load(std::memory_order_acquire);
    target.invertRight = targetInvertRight.load(std::memory_order_acquire);
    target.constantPower = targetConstantPower.load(std::memory_order_acquire);
    return target;
}

void ChannelBalanceProcessor::updateSwitchTargets(const TargetSnapshot& target)
{
    if (targetMonoMode != target.monoMode)
    {
        if (target.monoMode == ChannelBalanceMonoMode::LeftOnly || target.monoMode == ChannelBalanceMonoMode::RightOnly)
        {
            targetMonoMode = target.monoMode;
            activeMonoMode = target.monoMode;
            previousMonoMode = target.monoMode;
            monoMix = 1.0f;
        }
        else
        {
            previousMonoMode = activeMonoMode;
            targetMonoMode = target.monoMode;
            activeMonoMode = target.monoMode;
            monoMix = 0.0f;
        }
    }

    enabledStep = ((target.enabled ? 1.0f : 0.0f) - enabledMix) / static_cast<float>(switchSmoothingSamples);
    swapStep = ((target.swapLeftRight ? 1.0f : 0.0f) - swapMix) / static_cast<float>(switchSmoothingSamples);
    monoStep = (1.0f - monoMix) / static_cast<float>(switchSmoothingSamples);
    invertLeftStep = ((target.invertLeft ? 1.0f : 0.0f) - invertLeftMix) / static_cast<float>(switchSmoothingSamples);
    invertRightStep = ((target.invertRight ? 1.0f : 0.0f) - invertRightMix) / static_cast<float>(switchSmoothingSamples);
    constantPowerStep = ((target.constantPower ? 1.0f : 0.0f) - constantPowerMix) / static_cast<float>(switchSmoothingSamples);
}

void ChannelBalanceProcessor::calculateBalanceGains(float balance, bool constantPower, float& leftGain, float& rightGain)
{
    const float safeBalance = clampChannelBalance(balance);

    if (! constantPower)
    {
        leftGain = safeBalance > 0.0f ? 1.0f - safeBalance : 1.0f;
        rightGain = safeBalance < 0.0f ? 1.0f + safeBalance : 1.0f;
        return;
    }

    const float pan = (safeBalance + 1.0f) * pi * 0.25f;
    const float compensation = std::sqrt(2.0f);
    leftGain = std::min(1.0f, std::cos(pan) * compensation);
    rightGain = std::min(1.0f, std::sin(pan) * compensation);
}

float ChannelBalanceProcessor::applyBandCompensation(int channel, float sample, const std::array<float, channelBalanceBandCount>& bandGainsDb)
{
    const int safeChannel = channel <= 0 ? 0 : 1;
    const float lowCutoffHz = 200.0f;
    const float highCutoffHz = 2000.0f;
    const float lowAlpha = 1.0f - std::exp((-2.0f * pi * lowCutoffHz) / static_cast<float>(currentSampleRate));
    const float highAlpha = 1.0f - std::exp((-2.0f * pi * highCutoffHz) / static_cast<float>(currentSampleRate));

    lowBandState[static_cast<size_t>(safeChannel)] += lowAlpha * (sample - lowBandState[static_cast<size_t>(safeChannel)]);
    highLowpassState[static_cast<size_t>(safeChannel)] += highAlpha * (sample - highLowpassState[static_cast<size_t>(safeChannel)]);

    const float low = lowBandState[static_cast<size_t>(safeChannel)];
    const float high = sample - highLowpassState[static_cast<size_t>(safeChannel)];
    const float mid = sample - low - high;

    return sanitize(
        low * dbToGain(bandGainsDb[0])
        + mid * dbToGain(bandGainsDb[1])
        + high * dbToGain(bandGainsDb[2]));
}

float ChannelBalanceProcessor::readDelaySample(int channel, float delayMs) const
{
    if (channel < 0 || channel >= static_cast<int>(delayHistory.size()) || delayBufferLength <= 0)
        return 0.0f;

    const float safeDelayMs = clampChannelDelayMs(delayMs);
    const float delaySamples = safeDelayMs * static_cast<float>(currentSampleRate) / 1000.0f;
    const int wholeSamples = std::min(delayBufferLength - 2, std::max(0, static_cast<int>(std::floor(delaySamples))));
    const float fraction = delaySamples - static_cast<float>(wholeSamples);
    const auto& history = delayHistory[static_cast<size_t>(channel)];

    const auto wrapIndex = [this](int index) {
        while (index < 0)
            index += delayBufferLength;
        return index % delayBufferLength;
    };

    const float newer = history[static_cast<size_t>(wrapIndex(delayWriteIndex - wholeSamples))];
    const float older = history[static_cast<size_t>(wrapIndex(delayWriteIndex - wholeSamples - 1))];
    return sanitize(newer + (older - newer) * fraction);
}

void ChannelBalanceProcessor::pushDelaySample(int channel, float sample)
{
    if (channel < 0 || channel >= static_cast<int>(delayHistory.size()) || delayBufferLength <= 0)
        return;

    delayHistory[static_cast<size_t>(channel)][static_cast<size_t>(delayWriteIndex)] = sanitize(sample);
}
} // namespace echo
