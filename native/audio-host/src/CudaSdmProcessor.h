#pragma once

#include "../../audio-engine/NativeFormatProcessor.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

class CudaSdmProcessor final
{
public:
    CudaSdmProcessor();
    ~CudaSdmProcessor();

    CudaSdmProcessor(CudaSdmProcessor&&) noexcept;
    CudaSdmProcessor& operator=(CudaSdmProcessor&&) noexcept;

    CudaSdmProcessor(const CudaSdmProcessor&) = delete;
    CudaSdmProcessor& operator=(const CudaSdmProcessor&) = delete;

    bool configure(
        const echo::SdmProcessorConfig& config,
        const echo::SdmProcessorState& initialState,
        int maximumInputFrames,
        std::string& error);
    void release();
    bool reset(const echo::SdmProcessorState& state, std::string& error);
    void setTargetGain(double gain);
    bool processDop(
        const float* interleaved,
        int frames,
        std::vector<uint32_t>& output,
        std::string& error);
    bool processNativeDsd(
        const float* interleaved,
        int frames,
        std::vector<uint8_t>& output,
        std::string& error);
    bool copyLatestState(echo::SdmProcessorState& state) const;

    bool active() const noexcept;
    std::string deviceName() const;
    double warmupMilliseconds() const noexcept;
    double peakFeedbackState() const noexcept;
    uint64_t stabilityRecoveryCount() const noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
