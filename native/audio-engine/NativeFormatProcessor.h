#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace echo {

enum class PcmDitherMode {
    Off,
    Tpdf,
    HighpassTpdf,
    NoiseShaped5,
    NoiseShaped9,
    UltraShaped,
};

class PcmDitherProcessor final {
public:
    void configure(PcmDitherMode mode, int bitDepth, int channels);
    void reset();
    bool active() const noexcept { return mode_ != PcmDitherMode::Off; }
    void process(float* interleaved, size_t sampleCount);
    void process(std::vector<float>& interleaved);

private:
    double nextRandomUnit();
    double nextDither(int channel);

    PcmDitherMode mode_ = PcmDitherMode::Off;
    int channels_ = 2;
    double maxInteger_ = 32767.0;
    double lsb_ = 1.0 / 32767.0;
    uint32_t rngState_ = 0x6d2b79f5u;
    std::vector<double> previousDither_;
    std::vector<double> coefficients_;
    std::vector<std::vector<double>> errorHistory_;
};

struct EchoSrcStageConfig {
    int upsampleFactor = 1;
    std::vector<float> taps;
};

class EchoSrcProcessor final {
public:
    bool configure(int channels, const std::vector<EchoSrcStageConfig>& stages, std::string& error);
    void reset();
    bool active() const noexcept { return !stages_.empty(); }
    uint64_t estimatedMacsPerInputFrame() const noexcept;
    std::vector<float> process(const float* interleaved, int frames);
    void copyHistory(std::vector<std::vector<float>>& histories) const;
    bool restoreHistory(const std::vector<std::vector<float>>& histories);

private:
    struct PhaseTap {
        size_t delayFrames = 0;
        float coefficient = 0.0f;
    };

    struct Stage {
        int upsampleFactor = 1;
        size_t historyFrames = 0;
        std::vector<std::vector<PhaseTap>> phases;
        std::vector<float> history;
    };

    std::vector<float> processStage(Stage& stage, const std::vector<float>& input);

    int channels_ = 2;
    std::vector<Stage> stages_;
};

enum class SdmQualityProfile {
    Safe,
    Hifi,
    Reference,
    Insane,
};

struct SdmProcessorConfig {
    int channels = 2;
    int transportSampleRate = 176400;
    int transitionRampFrames = 1764;
    uint32_t idleLockFrames = 3528;
    std::vector<double> feedbackNumeratorCoefficients;
    std::vector<double> feedbackDenominatorCoefficients;
    double ditherAmplitude = 0.0000002;
    double inputLimit = 0.96;
    double stabilityLimit = 3.25;
    double ntfPeakGain = 1.45;
    double profileHeadroomGain = 0.31622776601683794;
    double idleLockThreshold = 0.0000001;
    double idleUnlockThreshold = 0.000002;
    double feedbackStateLimit = 4.0;
};

struct SdmProcessorState {
    int transitionRampPosition = 0;
    int gainRampFramesRemaining = 0;
    double currentUserGain = 1.0;
    double targetUserGain = 1.0;
    std::vector<double> errorHistory;
    std::vector<double> feedbackHistory;
    std::vector<uint32_t> ditherState;
    std::vector<uint32_t> idleRunFrames;
    std::vector<uint8_t> idleLocked;
    std::vector<float> previousSamples;
    double peakFeedbackState = 0.0;
    uint64_t stabilityRecoveryCount = 0;
    uint64_t dopFrameIndex = 0;
};

class SdmProcessor final {
public:
    void configure(int channels, SdmQualityProfile profile, int transportSampleRate = 176400);
    void reset();
    void setTargetGain(double gain);
    int modulatorOrder() const noexcept { return static_cast<int>(feedbackNumeratorCoefficients_.size()); }
    double ntfPeakGain() const noexcept { return ntfPeakGain_; }
    double peakFeedbackState() const noexcept { return peakFeedbackState_; }
    uint64_t stabilityRecoveryCount() const noexcept { return stabilityRecoveryCount_; }
    SdmProcessorConfig configuration() const;
    SdmProcessorState state() const;
    bool restoreState(const SdmProcessorState& state);
    std::vector<uint32_t> processDop(const float* interleaved, int frames);
    std::vector<uint8_t> processNativeDsd(const float* interleaved, int frames);

private:
    struct BytePair { uint8_t first = 0; uint8_t second = 0; };
    BytePair modulateSample(int channel, float sample);
    double advanceProtectedGain();
    bool shouldEmitIdleSilence(int channel, double sample);
    void resetChannelHistory(int channel);
    void configureNtf(int order, double peakGain);
    double nextDither(int channel);

    int channels_ = 2;
    int transportSampleRate_ = 176400;
    int transitionRampFrames_ = 1764;
    int transitionRampPosition_ = 0;
    int gainRampFramesRemaining_ = 0;
    uint32_t idleLockFrames_ = 3528;
    std::vector<double> feedbackNumeratorCoefficients_;
    std::vector<double> feedbackDenominatorCoefficients_;
    double ditherAmplitude_ = 0.0000002;
    double inputLimit_ = 0.96;
    double stabilityLimit_ = 3.25;
    double ntfPeakGain_ = 1.45;
    double profileHeadroomGain_ = 0.31622776601683794;
    double currentUserGain_ = 1.0;
    double targetUserGain_ = 1.0;
    std::vector<double> errorHistory_;
    std::vector<double> feedbackHistory_;
    std::vector<uint32_t> ditherState_;
    std::vector<uint32_t> idleRunFrames_;
    std::vector<uint8_t> idleLocked_;
    std::vector<float> previousSamples_;
    double peakFeedbackState_ = 0.0;
    uint64_t stabilityRecoveryCount_ = 0;
    uint64_t dopFrameIndex_ = 0;
};

} // namespace echo
