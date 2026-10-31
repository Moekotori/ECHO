#pragma once

#include "CudaSdmProcessor.h"
#include "../../audio-engine/NativeFormatProcessor.h"

#include <cstdint>
#include <string>
#include <vector>

class NativeSdmProcessor final
{
public:
    enum class Backend { Cpu, Cuda };

    bool configure(
        int channels,
        echo::SdmQualityProfile profile,
        int transportSampleRate,
        bool requestCuda,
        int maximumInputFrames,
        std::string& error);
    void reset();
    void setTargetGain(double gain);
    std::vector<uint32_t> processDop(const float* interleaved, int frames);
    std::vector<uint8_t> processNativeDsd(const float* interleaved, int frames);

    Backend backend() const noexcept { return backend_; }
    const std::string& fallbackReason() const noexcept { return fallbackReason_; }
    const std::string& deviceName() const noexcept { return deviceName_; }
    int modulatorOrder() const noexcept { return cpu_.modulatorOrder(); }
    double ntfPeakGain() const noexcept { return cpu_.ntfPeakGain(); }
    double peakFeedbackState() const noexcept;
    uint64_t stabilityRecoveryCount() const noexcept;
    uint64_t processedBlocks() const noexcept { return processedBlocks_; }
    int lastInputFrames() const noexcept { return lastInputFrames_; }
    int lastOutputFrames() const noexcept { return lastOutputFrames_; }
    double lastProcessMilliseconds() const noexcept { return lastProcessMilliseconds_; }
    double averageProcessMilliseconds() const noexcept
    {
        return processedBlocks_ == 0
            ? 0.0
            : totalProcessMilliseconds_ / static_cast<double>(processedBlocks_);
    }
    double peakProcessMilliseconds() const noexcept { return peakProcessMilliseconds_; }
    double warmupMilliseconds() const noexcept { return warmupMilliseconds_; }
    uint64_t runtimeFallbacks() const noexcept { return runtimeFallbacks_; }

private:
    void recordProcess(int inputFrames, int outputFrames, double milliseconds);
    void fallBackToCpu(const std::string& cudaError);

    echo::SdmProcessor cpu_;
    CudaSdmProcessor cuda_;
    int channels_ = 2;
    Backend backend_ = Backend::Cpu;
    std::string fallbackReason_;
    std::string deviceName_;
    uint64_t processedBlocks_ = 0;
    int lastInputFrames_ = 0;
    int lastOutputFrames_ = 0;
    double lastProcessMilliseconds_ = 0.0;
    double totalProcessMilliseconds_ = 0.0;
    double peakProcessMilliseconds_ = 0.0;
    double warmupMilliseconds_ = 0.0;
    uint64_t runtimeFallbacks_ = 0;
};
