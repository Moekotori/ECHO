#include "CudaSdmProcessor.h"

class CudaSdmProcessor::Impl
{
};

CudaSdmProcessor::CudaSdmProcessor() : impl_(std::make_unique<Impl>()) {}
CudaSdmProcessor::~CudaSdmProcessor() = default;
CudaSdmProcessor::CudaSdmProcessor(CudaSdmProcessor&&) noexcept = default;
CudaSdmProcessor& CudaSdmProcessor::operator=(CudaSdmProcessor&&) noexcept = default;

bool CudaSdmProcessor::configure(
    const echo::SdmProcessorConfig&,
    const echo::SdmProcessorState&,
    int,
    std::string& error)
{
    error = "native_cuda_sdm_not_built";
    return false;
}

void CudaSdmProcessor::release() {}

bool CudaSdmProcessor::reset(const echo::SdmProcessorState&, std::string& error)
{
    error = "native_cuda_sdm_not_built";
    return false;
}

void CudaSdmProcessor::setTargetGain(double) {}

bool CudaSdmProcessor::processDop(
    const float*,
    int,
    std::vector<uint32_t>& output,
    std::string& error)
{
    output.clear();
    error = "native_cuda_sdm_not_built";
    return false;
}

bool CudaSdmProcessor::processNativeDsd(
    const float*,
    int,
    std::vector<uint8_t>& output,
    std::string& error)
{
    output.clear();
    error = "native_cuda_sdm_not_built";
    return false;
}

bool CudaSdmProcessor::copyLatestState(echo::SdmProcessorState&) const
{
    return false;
}

bool CudaSdmProcessor::active() const noexcept
{
    return false;
}

std::string CudaSdmProcessor::deviceName() const
{
    return {};
}

double CudaSdmProcessor::warmupMilliseconds() const noexcept
{
    return 0.0;
}

double CudaSdmProcessor::peakFeedbackState() const noexcept
{
    return 0.0;
}

uint64_t CudaSdmProcessor::stabilityRecoveryCount() const noexcept
{
    return 0;
}
