#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <vector>

namespace echo
{
constexpr float channelBalanceMinBalance = -1.0f;
constexpr float channelBalanceMaxBalance = 1.0f;
constexpr float channelBalanceMinGainDb = -12.0f;
constexpr float channelBalanceMaxGainDb = 6.0f;
constexpr int channelBalanceBandCount = 3;
constexpr float channelBalanceBandMinGainDb = -6.0f;
constexpr float channelBalanceBandMaxGainDb = 3.0f;
constexpr float channelBalanceMinDelayMs = 0.0f;
constexpr float channelBalanceMaxDelayMs = 10.0f;

enum class ChannelBalanceMonoMode
{
    Off = 0,
    SumToMono = 1,
    LeftOnly = 2,
    RightOnly = 3,
};

struct ChannelBalanceState
{
    bool enabled = false;
    float balance = 0.0f;
    float leftGainDb = 0.0f;
    float rightGainDb = 0.0f;
    std::array<float, channelBalanceBandCount> leftBandGainsDb {};
    std::array<float, channelBalanceBandCount> rightBandGainsDb {};
    float leftDelayMs = 0.0f;
    float rightDelayMs = 0.0f;
    bool swapLeftRight = false;
    ChannelBalanceMonoMode monoMode = ChannelBalanceMonoMode::Off;
    bool invertLeft = false;
    bool invertRight = false;
    bool constantPower = true;
};

float clampChannelBalance(float value);
float clampChannelGainDb(float value);
float clampChannelBandGainDb(float value);
float clampChannelDelayMs(float value);

class ChannelBalanceProcessor
{
public:
    ChannelBalanceProcessor();

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);

    void setState(const ChannelBalanceState& state);
    ChannelBalanceState getState() const;
    void resetToDefault();

    bool isEnabled() const;
    bool hasClippingRisk() const;

private:
    struct TargetSnapshot
    {
        bool enabled = false;
        float balance = 0.0f;
        float leftGainDb = 0.0f;
        float rightGainDb = 0.0f;
        std::array<float, channelBalanceBandCount> leftBandGainsDb {};
        std::array<float, channelBalanceBandCount> rightBandGainsDb {};
        float leftDelayMs = 0.0f;
        float rightDelayMs = 0.0f;
        bool swapLeftRight = false;
        ChannelBalanceMonoMode monoMode = ChannelBalanceMonoMode::Off;
        bool invertLeft = false;
        bool invertRight = false;
        bool constantPower = true;
    };

    void updateSmoothingSteps();
    TargetSnapshot readTargetSnapshot() const;
    void updateSwitchTargets(const TargetSnapshot& target);
    static void calculateBalanceGains(float balance, bool constantPower, float& leftGain, float& rightGain);
    float applyBandCompensation(int channel, float sample, const std::array<float, channelBalanceBandCount>& bandGainsDb);
    float readDelaySample(int channel, float delayMs) const;
    void pushDelaySample(int channel, float sample);

    double currentSampleRate = 44100.0;
    int preparedChannels = 0;
    int preparedBlockSize = 0;
    int delayBufferLength = 1;
    int delayWriteIndex = 0;
    std::vector<std::vector<float>> delayHistory;
    int parameterSmoothingSamples = 1;
    int switchSmoothingSamples = 1;

    float smoothedBalance = 0.0f;
    float smoothedLeftGainDb = 0.0f;
    float smoothedRightGainDb = 0.0f;
    std::array<float, channelBalanceBandCount> smoothedLeftBandGainsDb {};
    std::array<float, channelBalanceBandCount> smoothedRightBandGainsDb {};
    float smoothedLeftDelayMs = 0.0f;
    float smoothedRightDelayMs = 0.0f;
    float enabledMix = 0.0f;
    float swapMix = 0.0f;
    float monoMix = 0.0f;
    float invertLeftMix = 0.0f;
    float invertRightMix = 0.0f;
    float constantPowerMix = 1.0f;

    float balanceStep = 0.0f;
    float leftGainStepDb = 0.0f;
    float rightGainStepDb = 0.0f;
    std::array<float, channelBalanceBandCount> leftBandGainStepsDb {};
    std::array<float, channelBalanceBandCount> rightBandGainStepsDb {};
    float leftDelayStepMs = 0.0f;
    float rightDelayStepMs = 0.0f;
    float enabledStep = 0.0f;
    float swapStep = 0.0f;
    float monoStep = 0.0f;
    float invertLeftStep = 0.0f;
    float invertRightStep = 0.0f;
    float constantPowerStep = 0.0f;

    ChannelBalanceMonoMode previousMonoMode = ChannelBalanceMonoMode::Off;
    ChannelBalanceMonoMode activeMonoMode = ChannelBalanceMonoMode::Off;
    ChannelBalanceMonoMode targetMonoMode = ChannelBalanceMonoMode::Off;
    std::array<float, 2> lowBandState {};
    std::array<float, 2> highLowpassState {};

    std::atomic<bool> targetEnabled { false };
    std::atomic<float> atomicBalance { 0.0f };
    std::atomic<float> atomicLeftGainDb { 0.0f };
    std::atomic<float> atomicRightGainDb { 0.0f };
    std::array<std::atomic<float>, channelBalanceBandCount> atomicLeftBandGainsDb {};
    std::array<std::atomic<float>, channelBalanceBandCount> atomicRightBandGainsDb {};
    std::atomic<float> atomicLeftDelayMs { 0.0f };
    std::atomic<float> atomicRightDelayMs { 0.0f };
    std::atomic<bool> targetSwapLeftRight { false };
    std::atomic<int> atomicMonoMode { static_cast<int>(ChannelBalanceMonoMode::Off) };
    std::atomic<bool> targetInvertLeft { false };
    std::atomic<bool> targetInvertRight { false };
    std::atomic<bool> targetConstantPower { true };
    std::atomic<bool> clippingRisk { false };
};
} // namespace echo
