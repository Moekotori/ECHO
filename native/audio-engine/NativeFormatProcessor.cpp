#include "NativeFormatProcessor.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace echo {
namespace {

constexpr uint8_t dsdSilenceByte = 0x69;

constexpr uint8_t reverseDsdByteForDop(uint8_t byte)
{
    byte = static_cast<uint8_t>(((byte & 0xf0u) >> 4u) | ((byte & 0x0fu) << 4u));
    byte = static_cast<uint8_t>(((byte & 0xccu) >> 2u) | ((byte & 0x33u) << 2u));
    return static_cast<uint8_t>(((byte & 0xaau) >> 1u) | ((byte & 0x55u) << 1u));
}
// Stay below a 24-bit PCM LSB so musical tails and ordinary converter noise
// never enter the idle path. A sustained window is still required below.
constexpr double sdmIdleLockThreshold = 0.0000001;
constexpr double sdmIdleUnlockThreshold = 0.000002;
constexpr int sdmIdleLockMilliseconds = 20;
constexpr int sdmTransitionRampMilliseconds = 10;
constexpr double sdmFeedbackStateLimit = 4.0;
// Windowed-sinc halfband kernels contain mathematically zero alternate taps.
// The TypeScript tap generator reaches those zeros through floating-point
// sin(pi*n), so retain a tiny numerical tolerance when building sparse phases.
constexpr float firNumericalZeroThreshold = 1.0e-12f;

template <typename T>
T clampValue(T value, T minimum, T maximum)
{
    return std::max(minimum, std::min(maximum, value));
}

std::vector<double> ditherCoefficients(PcmDitherMode mode)
{
    switch (mode)
    {
        case PcmDitherMode::NoiseShaped5:
            return {0.82, -0.38, 0.19, -0.08, 0.025};
        case PcmDitherMode::NoiseShaped9:
            return {0.95, -0.52, 0.31, -0.18, 0.1, -0.052, 0.025, -0.01, 0.003};
        case PcmDitherMode::UltraShaped:
            return {1.08, -0.68, 0.46, -0.3, 0.19, -0.11, 0.055, -0.022, 0.006};
        default:
            return {};
    }
}

} // namespace

void PcmDitherProcessor::configure(PcmDitherMode mode, int bitDepth, int channels)
{
    mode_ = mode;
    channels_ = std::max(1, channels);
    const int safeBitDepth = bitDepth == 24 ? 24 : 16;
    maxInteger_ = std::ldexp(1.0, safeBitDepth - 1) - 1.0;
    lsb_ = 1.0 / maxInteger_;
    coefficients_ = ditherCoefficients(mode_);
    previousDither_.assign(static_cast<size_t>(channels_), 0.0);
    errorHistory_.assign(static_cast<size_t>(channels_), std::vector<double>(coefficients_.size(), 0.0));
    reset();
}

void PcmDitherProcessor::reset()
{
    rngState_ = 0x6d2b79f5u;
    std::fill(previousDither_.begin(), previousDither_.end(), 0.0);
    for (auto& history : errorHistory_)
        std::fill(history.begin(), history.end(), 0.0);
}

double PcmDitherProcessor::nextRandomUnit()
{
    uint32_t value = rngState_;
    value ^= value << 13;
    value ^= value >> 17;
    value ^= value << 5;
    rngState_ = value;
    return static_cast<double>(rngState_) / 4294967296.0;
}

double PcmDitherProcessor::nextDither(int channel)
{
    const double tpdf = (nextRandomUnit() - nextRandomUnit()) * lsb_;
    if (mode_ != PcmDitherMode::HighpassTpdf)
        return tpdf;
    const double previous = previousDither_[static_cast<size_t>(channel)];
    previousDither_[static_cast<size_t>(channel)] = tpdf;
    return (tpdf - previous) * 0.5;
}

void PcmDitherProcessor::process(std::vector<float>& interleaved)
{
    process(interleaved.data(), interleaved.size());
}

void PcmDitherProcessor::process(float* interleaved, size_t sampleCount)
{
    if (!active())
        return;
    if (interleaved == nullptr || sampleCount == 0)
        return;
    for (size_t index = 0; index < sampleCount; ++index)
    {
        const int channel = static_cast<int>(index % static_cast<size_t>(channels_));
        auto& history = errorHistory_[static_cast<size_t>(channel)];
        double shaped = static_cast<double>(interleaved[index]);
        for (size_t tap = 0; tap < coefficients_.size(); ++tap)
            shaped += history[tap] * coefficients_[tap];
        const double dithered = shaped + nextDither(channel);
        const double quantized = std::round(clampValue(dithered, -1.0, 1.0) * maxInteger_) / maxInteger_;
        if (!history.empty())
        {
            for (size_t tap = history.size() - 1; tap > 0; --tap)
                history[tap] = history[tap - 1];
            history[0] = clampValue(shaped - quantized, -lsb_ * 8.0, lsb_ * 8.0);
        }
        interleaved[index] = static_cast<float>(clampValue(quantized, -1.0, 1.0));
    }
}

bool EchoSrcProcessor::configure(int channels, const std::vector<EchoSrcStageConfig>& stages, std::string& error)
{
    channels_ = std::max(1, channels);
    stages_.clear();
    for (const auto& config : stages)
    {
        if (config.upsampleFactor != 1 && config.upsampleFactor != 2
            && config.upsampleFactor != 4 && config.upsampleFactor != 8)
        {
            error = "echo_src_native_invalid_upsample_factor";
            return false;
        }
        if (config.taps.empty())
        {
            error = "echo_src_native_empty_taps";
            return false;
        }
        Stage stage;
        stage.upsampleFactor = config.upsampleFactor;
        stage.historyFrames = (config.taps.size() - 1) / static_cast<size_t>(stage.upsampleFactor);
        stage.phases.resize(static_cast<size_t>(stage.upsampleFactor));
        const float interpolationGain = static_cast<float>(stage.upsampleFactor);
        for (size_t tap = 0; tap < config.taps.size(); ++tap)
        {
            const float coefficient = config.taps[tap];
            if (std::abs(coefficient) <= firNumericalZeroThreshold)
                continue;
            const size_t phase = tap % static_cast<size_t>(stage.upsampleFactor);
            stage.phases[phase].push_back(PhaseTap {
                tap / static_cast<size_t>(stage.upsampleFactor),
                coefficient * interpolationGain,
            });
        }
        stage.history.assign(stage.historyFrames * static_cast<size_t>(channels_), 0.0f);
        stages_.push_back(std::move(stage));
    }
    error.clear();
    return true;
}

void EchoSrcProcessor::reset()
{
    for (auto& stage : stages_)
        std::fill(stage.history.begin(), stage.history.end(), 0.0f);
}

uint64_t EchoSrcProcessor::estimatedMacsPerInputFrame() const noexcept
{
    uint64_t total = 0;
    uint64_t stageInputFactor = 1;
    for (const auto& stage : stages_)
    {
        uint64_t phaseTapCount = 0;
        for (const auto& phase : stage.phases)
            phaseTapCount += static_cast<uint64_t>(phase.size());
        total += stageInputFactor * static_cast<uint64_t>(channels_) * phaseTapCount;
        stageInputFactor *= static_cast<uint64_t>(stage.upsampleFactor);
    }
    return total;
}

std::vector<float> EchoSrcProcessor::process(const float* interleaved, int frames)
{
    if (frames <= 0 || interleaved == nullptr)
        return {};
    std::vector<float> output(interleaved, interleaved + static_cast<size_t>(frames * channels_));
    for (auto& stage : stages_)
        output = processStage(stage, output);
    return output;
}

void EchoSrcProcessor::copyHistory(
    std::vector<std::vector<float>>& histories) const
{
    histories.clear();
    histories.reserve(stages_.size());
    for (const auto& stage : stages_)
        histories.push_back(stage.history);
}

bool EchoSrcProcessor::restoreHistory(const std::vector<std::vector<float>>& histories)
{
    if (histories.size() != stages_.size())
        return false;
    for (size_t index = 0; index < stages_.size(); ++index)
    {
        if (histories[index].size() != stages_[index].history.size())
            return false;
    }
    for (size_t index = 0; index < stages_.size(); ++index)
        stages_[index].history = histories[index];
    return true;
}

std::vector<float> EchoSrcProcessor::processStage(Stage& stage, const std::vector<float>& input)
{
    const size_t inputFrames = input.size() / static_cast<size_t>(channels_);
    const size_t outputFrames = inputFrames * static_cast<size_t>(stage.upsampleFactor);
    std::vector<float> combined;
    combined.reserve(stage.history.size() + input.size());
    combined.insert(combined.end(), stage.history.begin(), stage.history.end());
    combined.insert(combined.end(), input.begin(), input.end());

    std::vector<float> output(outputFrames * static_cast<size_t>(channels_), 0.0f);
    for (size_t inputFrame = 0; inputFrame < inputFrames; ++inputFrame)
    {
        const size_t combinedFrame = stage.historyFrames + inputFrame;
        for (size_t phase = 0; phase < stage.phases.size(); ++phase)
        {
            const size_t outputFrame =
                inputFrame * static_cast<size_t>(stage.upsampleFactor) + phase;
            const auto& phaseTaps = stage.phases[phase];
            for (int channel = 0; channel < channels_; ++channel)
            {
                double sample = 0.0;
                for (const auto& tap : phaseTaps)
                    sample += static_cast<double>(tap.coefficient)
                        * static_cast<double>(combined[
                            (combinedFrame - tap.delayFrames) * static_cast<size_t>(channels_)
                            + static_cast<size_t>(channel)]);
                output[
                    outputFrame * static_cast<size_t>(channels_)
                    + static_cast<size_t>(channel)] = static_cast<float>(sample);
            }
        }
    }
    if (!stage.history.empty())
        std::copy(combined.end() - static_cast<std::ptrdiff_t>(stage.history.size()), combined.end(), stage.history.begin());
    return output;
}

void SdmProcessor::configure(int channels, SdmQualityProfile profile, int transportSampleRate)
{
    channels_ = clampValue(channels, 1, 2);
    transportSampleRate_ = std::max(1, transportSampleRate);
    transitionRampFrames_ = std::max(
        1,
        static_cast<int>(std::ceil(
            static_cast<double>(transportSampleRate_) * sdmTransitionRampMilliseconds / 1000.0)));
    idleLockFrames_ = static_cast<uint32_t>(std::max(
        1,
        static_cast<int>(std::ceil(
            static_cast<double>(transportSampleRate_) * sdmIdleLockMilliseconds / 1000.0))));
    switch (profile)
    {
        case SdmQualityProfile::Hifi:
            configureNtf(6, 1.55); ditherAmplitude_ = 0.0000001; inputLimit_ = 0.94; stabilityLimit_ = 3.5;
            profileHeadroomGain_ = std::pow(10.0, -12.0 / 20.0); break;
        case SdmQualityProfile::Reference:
            configureNtf(7, 1.60); ditherAmplitude_ = 0.00000005; inputLimit_ = 0.92; stabilityLimit_ = 3.75;
            profileHeadroomGain_ = std::pow(10.0, -14.0 / 20.0); break;
        case SdmQualityProfile::Insane:
            configureNtf(8, 1.65); ditherAmplitude_ = 0.000000025; inputLimit_ = 0.90; stabilityLimit_ = 4.0;
            profileHeadroomGain_ = std::pow(10.0, -16.0 / 20.0); break;
        case SdmQualityProfile::Safe:
        default:
            configureNtf(3, 1.45); ditherAmplitude_ = 0.0000002; inputLimit_ = 0.96; stabilityLimit_ = 3.25;
            profileHeadroomGain_ = std::pow(10.0, -10.0 / 20.0); break;
    }
    errorHistory_.assign(static_cast<size_t>(channels_) * feedbackNumeratorCoefficients_.size(), 0.0);
    feedbackHistory_.assign(static_cast<size_t>(channels_) * feedbackNumeratorCoefficients_.size(), 0.0);
    ditherState_.resize(static_cast<size_t>(channels_));
    idleRunFrames_.assign(static_cast<size_t>(channels_), 0u);
    idleLocked_.assign(static_cast<size_t>(channels_), 0u);
    previousSamples_.assign(static_cast<size_t>(channels_), 0.0f);
    reset();
}

void SdmProcessor::configureNtf(int order, double peakGain)
{
    const int safeOrder = clampValue(order, 1, 8);
    ntfPeakGain_ = std::max(1.0, peakGain);
    feedbackNumeratorCoefficients_.assign(static_cast<size_t>(safeOrder), 0.0);
    feedbackDenominatorCoefficients_.assign(static_cast<size_t>(safeOrder), 0.0);
    if (safeOrder == 1 && std::abs(ntfPeakGain_ - 2.0) <= std::numeric_limits<double>::epsilon())
    {
        feedbackNumeratorCoefficients_[0] = 1.0;
        return;
    }

    // H(z) = ((1 - z^-1) / (1 - r z^-1))^N. Choosing r from the
    // requested Nyquist gain constrains ||H||inf without sacrificing the
    // N zeros at DC. The error-feedback filter is F(z) = 1 - H(z).
    const double poleRadius = 2.0 / std::pow(ntfPeakGain_, 1.0 / safeOrder) - 1.0;
    double binomial = 1.0;
    for (int tap = 1; tap <= safeOrder; ++tap)
    {
        binomial *= static_cast<double>(safeOrder - tap + 1) / static_cast<double>(tap);
        const double denominator = binomial * std::pow(-poleRadius, tap);
        const double numerator = binomial * std::pow(-1.0, tap);
        feedbackDenominatorCoefficients_[static_cast<size_t>(tap - 1)] = denominator;
        feedbackNumeratorCoefficients_[static_cast<size_t>(tap - 1)] = denominator - numerator;
    }
}

void SdmProcessor::reset()
{
    std::fill(errorHistory_.begin(), errorHistory_.end(), 0.0);
    std::fill(feedbackHistory_.begin(), feedbackHistory_.end(), 0.0);
    std::fill(idleRunFrames_.begin(), idleRunFrames_.end(), 0u);
    std::fill(idleLocked_.begin(), idleLocked_.end(), 0u);
    std::fill(previousSamples_.begin(), previousSamples_.end(), 0.0f);
    for (int channel = 0; channel < channels_; ++channel)
        ditherState_[static_cast<size_t>(channel)] = 0x9e3779b9u + static_cast<uint32_t>(channel) * 0x85ebca6bu;
    transitionRampPosition_ = 0;
    currentUserGain_ = targetUserGain_;
    gainRampFramesRemaining_ = 0;
    peakFeedbackState_ = 0.0;
    stabilityRecoveryCount_ = 0;
    dopFrameIndex_ = 0;
}

void SdmProcessor::setTargetGain(double gain)
{
    const double normalized = clampValue(std::isfinite(gain) ? gain : 1.0, 0.0, 1.0);
    if (std::abs(normalized - targetUserGain_) <= std::numeric_limits<double>::epsilon())
        return;
    targetUserGain_ = normalized;
    gainRampFramesRemaining_ = transitionRampFrames_;
}

SdmProcessorConfig SdmProcessor::configuration() const
{
    SdmProcessorConfig config;
    config.channels = channels_;
    config.transportSampleRate = transportSampleRate_;
    config.transitionRampFrames = transitionRampFrames_;
    config.idleLockFrames = idleLockFrames_;
    config.feedbackNumeratorCoefficients = feedbackNumeratorCoefficients_;
    config.feedbackDenominatorCoefficients = feedbackDenominatorCoefficients_;
    config.ditherAmplitude = ditherAmplitude_;
    config.inputLimit = inputLimit_;
    config.stabilityLimit = stabilityLimit_;
    config.ntfPeakGain = ntfPeakGain_;
    config.profileHeadroomGain = profileHeadroomGain_;
    config.idleLockThreshold = sdmIdleLockThreshold;
    config.idleUnlockThreshold = sdmIdleUnlockThreshold;
    config.feedbackStateLimit = sdmFeedbackStateLimit;
    return config;
}

SdmProcessorState SdmProcessor::state() const
{
    SdmProcessorState state;
    state.transitionRampPosition = transitionRampPosition_;
    state.gainRampFramesRemaining = gainRampFramesRemaining_;
    state.currentUserGain = currentUserGain_;
    state.targetUserGain = targetUserGain_;
    state.errorHistory = errorHistory_;
    state.feedbackHistory = feedbackHistory_;
    state.ditherState = ditherState_;
    state.idleRunFrames = idleRunFrames_;
    state.idleLocked = idleLocked_;
    state.previousSamples = previousSamples_;
    state.peakFeedbackState = peakFeedbackState_;
    state.stabilityRecoveryCount = stabilityRecoveryCount_;
    state.dopFrameIndex = dopFrameIndex_;
    return state;
}

bool SdmProcessor::restoreState(const SdmProcessorState& state)
{
    const size_t channels = static_cast<size_t>(channels_);
    const size_t historySize = channels * feedbackNumeratorCoefficients_.size();
    if (state.errorHistory.size() != historySize
        || state.feedbackHistory.size() != historySize
        || state.ditherState.size() != channels
        || state.idleRunFrames.size() != channels
        || state.idleLocked.size() != channels
        || state.previousSamples.size() != channels)
        return false;
    transitionRampPosition_ = std::max(0, state.transitionRampPosition);
    gainRampFramesRemaining_ = std::max(0, state.gainRampFramesRemaining);
    currentUserGain_ = clampValue(state.currentUserGain, 0.0, 1.0);
    targetUserGain_ = clampValue(state.targetUserGain, 0.0, 1.0);
    errorHistory_ = state.errorHistory;
    feedbackHistory_ = state.feedbackHistory;
    ditherState_ = state.ditherState;
    idleRunFrames_ = state.idleRunFrames;
    idleLocked_ = state.idleLocked;
    previousSamples_ = state.previousSamples;
    peakFeedbackState_ = std::max(0.0, state.peakFeedbackState);
    stabilityRecoveryCount_ = state.stabilityRecoveryCount;
    dopFrameIndex_ = state.dopFrameIndex;
    return true;
}

double SdmProcessor::advanceProtectedGain()
{
    if (gainRampFramesRemaining_ > 0)
    {
        currentUserGain_ +=
            (targetUserGain_ - currentUserGain_) / static_cast<double>(gainRampFramesRemaining_);
        --gainRampFramesRemaining_;
    }
    else
    {
        currentUserGain_ = targetUserGain_;
    }

    const double transitionGain = transitionRampPosition_ < transitionRampFrames_
        ? static_cast<double>(++transitionRampPosition_) / static_cast<double>(transitionRampFrames_)
        : 1.0;
    return profileHeadroomGain_ * currentUserGain_ * transitionGain;
}

double SdmProcessor::nextDither(int channel)
{
    auto& state = ditherState_[static_cast<size_t>(channel)];
    if (state == 0)
        state = 0x9e3779b9u;
    state = state * 1664525u + 1013904223u;
    return (static_cast<double>(state) / 4294967296.0 - 0.5) * ditherAmplitude_;
}

void SdmProcessor::resetChannelHistory(int channel)
{
    const size_t order = feedbackNumeratorCoefficients_.size();
    const size_t base = static_cast<size_t>(channel) * order;
    std::fill(errorHistory_.begin() + static_cast<std::ptrdiff_t>(base),
              errorHistory_.begin() + static_cast<std::ptrdiff_t>(base + order), 0.0);
    std::fill(feedbackHistory_.begin() + static_cast<std::ptrdiff_t>(base),
              feedbackHistory_.begin() + static_cast<std::ptrdiff_t>(base + order), 0.0);
    previousSamples_[static_cast<size_t>(channel)] = 0.0f;
}

bool SdmProcessor::shouldEmitIdleSilence(int channel, double sample)
{
    const size_t index = static_cast<size_t>(channel);
    const double magnitude = std::abs(sample);
    if (idleLocked_[index] == 1)
    {
        if (magnitude < sdmIdleUnlockThreshold)
            return true;
        idleLocked_[index] = 0;
        idleRunFrames_[index] = 0;
        resetChannelHistory(channel);
        return false;
    }
    if (magnitude <= sdmIdleLockThreshold)
    {
        idleRunFrames_[index] = std::min(idleLockFrames_, idleRunFrames_[index] + 1);
        if (idleRunFrames_[index] >= idleLockFrames_)
        {
            idleLocked_[index] = 1;
            resetChannelHistory(channel);
            return true;
        }
    }
    else
    {
        idleRunFrames_[index] = 0;
    }
    return false;
}

SdmProcessor::BytePair SdmProcessor::modulateSample(int channel, float sample)
{
    const double clampedSample = clampValue(static_cast<double>(sample), -inputLimit_, inputLimit_);
    if (shouldEmitIdleSilence(channel, clampedSample))
        return {dsdSilenceByte, dsdSilenceByte};

    BytePair result;
    const size_t order = feedbackNumeratorCoefficients_.size();
    const size_t base = static_cast<size_t>(channel) * order;
    const double previous = clampValue(static_cast<double>(previousSamples_[static_cast<size_t>(channel)]), -inputLimit_, inputLimit_);
    for (int bit = 0; bit < 16; ++bit)
    {
        const double bitSample = previous + (clampedSample - previous) * (static_cast<double>(bit + 1) / 16.0);
        double feedback = 0.0;
        for (size_t tap = 0; tap < order; ++tap)
        {
            feedback += feedbackNumeratorCoefficients_[tap] * errorHistory_[base + tap];
            feedback -= feedbackDenominatorCoefficients_[tap] * feedbackHistory_[base + tap];
        }
        if (!std::isfinite(feedback) || std::abs(feedback) > sdmFeedbackStateLimit)
        {
            resetChannelHistory(channel);
            feedback = 0.0;
            ++stabilityRecoveryCount_;
        }
        peakFeedbackState_ = std::max(peakFeedbackState_, std::abs(feedback));
        double decision = bitSample + nextDither(channel) + feedback;
        decision = clampValue(decision, -stabilityLimit_, stabilityLimit_);
        const bool one = decision >= 0.0;
        const double quantizationError = clampValue(decision - (one ? 1.0 : -1.0), -stabilityLimit_, stabilityLimit_);
        for (size_t tap = order; tap-- > 1;)
        {
            errorHistory_[base + tap] = errorHistory_[base + tap - 1];
            feedbackHistory_[base + tap] = feedbackHistory_[base + tap - 1];
        }
        errorHistory_[base] = quantizationError;
        feedbackHistory_[base] = feedback;
        if (one)
        {
            if (bit < 8) result.first = static_cast<uint8_t>(result.first | static_cast<uint8_t>(1u << bit));
            else result.second = static_cast<uint8_t>(result.second | static_cast<uint8_t>(1u << (bit - 8)));
        }
    }
    previousSamples_[static_cast<size_t>(channel)] = static_cast<float>(clampedSample);
    return result;
}

std::vector<uint32_t> SdmProcessor::processDop(const float* interleaved, int frames)
{
    if (interleaved == nullptr || frames <= 0)
        return {};
    std::vector<uint32_t> output(static_cast<size_t>(frames * channels_));
    for (int frame = 0; frame < frames; ++frame)
    {
        const double protectedGain = advanceProtectedGain();
        const uint32_t marker = (dopFrameIndex_ & 1u) == 0u ? 0x05u : 0xfau;
        for (int channel = 0; channel < channels_; ++channel)
        {
            const auto bytes = modulateSample(
                channel,
                static_cast<float>(static_cast<double>(interleaved[frame * channels_ + channel]) * protectedGain));
            // Native DSD bytes are chronological LSB-first. DoP v1.1 places
            // the oldest bit (t0) at bit 15, so reverse each byte and put the
            // older byte in the high half of the 16-bit DSD payload.
            const uint32_t dopDsd =
                static_cast<uint32_t>(reverseDsdByteForDop(bytes.second))
                | (static_cast<uint32_t>(reverseDsdByteForDop(bytes.first)) << 8u);
            output[static_cast<size_t>(frame * channels_ + channel)] =
                dopDsd | (marker << 16u);
        }
        ++dopFrameIndex_;
    }
    return output;
}

std::vector<uint8_t> SdmProcessor::processNativeDsd(const float* interleaved, int frames)
{
    if (interleaved == nullptr || frames <= 0)
        return {};
    std::vector<uint8_t> output(static_cast<size_t>(frames * channels_ * 2));
    for (int frame = 0; frame < frames; ++frame)
    {
        const double protectedGain = advanceProtectedGain();
        for (int channel = 0; channel < channels_; ++channel)
        {
            const auto bytes = modulateSample(
                channel,
                static_cast<float>(static_cast<double>(interleaved[frame * channels_ + channel]) * protectedGain));
            const size_t base = static_cast<size_t>(frame * channels_ * 2);
            output[base + static_cast<size_t>(channel)] = bytes.first;
            output[base + static_cast<size_t>(channels_ + channel)] = bytes.second;
        }
        ++dopFrameIndex_;
    }
    return output;
}

} // namespace echo
