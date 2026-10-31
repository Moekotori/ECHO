#pragma once

#include "../../audio-engine/NativeFormatProcessor.h"

#include <memory>
#include <string>
#include <vector>

class CudaFirProcessor final
{
public:
    CudaFirProcessor();
    ~CudaFirProcessor();

    CudaFirProcessor(CudaFirProcessor&&) noexcept;
    CudaFirProcessor& operator=(CudaFirProcessor&&) noexcept;

    CudaFirProcessor(const CudaFirProcessor&) = delete;
    CudaFirProcessor& operator=(const CudaFirProcessor&) = delete;

    bool configure(
        int channels,
        const std::vector<echo::EchoSrcStageConfig>& stages,
        int maximumInputFrames,
        std::string& error);
    void release();
    void reset();
    bool process(
        const float* interleaved,
        int frames,
        std::vector<float>& output,
        std::string& error);
    bool copyLatestHistory(std::vector<std::vector<float>>& histories) const;
    bool restoreHistory(
        const std::vector<std::vector<float>>& histories,
        std::string& error);

    bool active() const noexcept;
    std::string deviceName() const;
    double warmupMilliseconds() const noexcept;
    static bool builtWithCuda() noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
