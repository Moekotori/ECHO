#pragma once

#include "CudaFirProcessor.h"
#include "../../audio-engine/NativeFormatProcessor.h"

#include <cstdint>
#include <string>
#include <vector>

class NativeFirProcessor final
{
public:
    enum class Backend { Cpu, Cuda };

    bool configure(
        int channels,
        const std::vector<echo::EchoSrcStageConfig>& stages,
        bool requestCuda,
        int maximumInputFrames,
        std::string& error);
    void reset();
    bool active() const noexcept { return cpu_.active(); }
    uint64_t estimatedMacsPerInputFrame() const noexcept
    {
        return cpu_.estimatedMacsPerInputFrame();
    }
    std::vector<float> process(const float* interleaved, int frames);
    std::vector<float> flush();
    bool copyLatestHistory(
        std::vector<std::vector<float>>& histories) const;
    bool restoreHistory(
        const std::vector<std::vector<float>>& histories);
    int outputFactor() const noexcept { return outputFactor_; }
    int prerollInputFrames() const noexcept { return prerollInputFrames_; }
    int nominalLatencyOutputFrames() const noexcept
    {
        return nominalLatencyOutputFrames_;
    }
    size_t tailOutputFrames() const noexcept { return tailOutputFrames_; }

    Backend backend() const noexcept { return backend_; }
    const std::string& fallbackReason() const noexcept { return fallbackReason_; }
    const std::string& deviceName() const noexcept { return deviceName_; }
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
    void recordProcess(int inputFrames, size_t outputSamples, double milliseconds);

    echo::EchoSrcProcessor cpu_;
    CudaFirProcessor cuda_;
    int channels_ = 1;
    int maximumInputFrames_ = 1;
    int outputFactor_ = 1;
    int prerollInputFrames_ = 0;
    int nominalLatencyOutputFrames_ = 0;
    size_t tailOutputFrames_ = 0;
    bool flushPending_ = false;
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
