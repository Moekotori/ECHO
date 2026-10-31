#include "CudaFirProcessor.h"

#include <utility>

class CudaFirProcessor::Impl
{
};

CudaFirProcessor::CudaFirProcessor() : impl_(std::make_unique<Impl>()) {}
CudaFirProcessor::~CudaFirProcessor() = default;
CudaFirProcessor::CudaFirProcessor(CudaFirProcessor&&) noexcept = default;
CudaFirProcessor& CudaFirProcessor::operator=(CudaFirProcessor&&) noexcept = default;

bool CudaFirProcessor::configure(
    int,
    const std::vector<echo::EchoSrcStageConfig>&,
    int,
    std::string& error)
{
    error = "native_cuda_dsp_not_built";
    return false;
}

void CudaFirProcessor::release() {}

void CudaFirProcessor::reset() {}

bool CudaFirProcessor::process(
    const float*,
    int,
    std::vector<float>& output,
    std::string& error)
{
    output.clear();
    error = "native_cuda_dsp_not_built";
    return false;
}

bool CudaFirProcessor::copyLatestHistory(
    std::vector<std::vector<float>>& histories) const
{
    histories.clear();
    return false;
}

bool CudaFirProcessor::restoreHistory(
    const std::vector<std::vector<float>>&,
    std::string& error)
{
    error = "native_cuda_dsp_not_built";
    return false;
}

bool CudaFirProcessor::active() const noexcept
{
    return false;
}

std::string CudaFirProcessor::deviceName() const
{
    return {};
}

double CudaFirProcessor::warmupMilliseconds() const noexcept
{
    return 0.0;
}

bool CudaFirProcessor::builtWithCuda() noexcept
{
    return false;
}
