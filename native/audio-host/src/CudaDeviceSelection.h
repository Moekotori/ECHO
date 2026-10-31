#pragma once

#include <cuda_runtime.h>

#include <mutex>
#include <string>

struct CudaDeviceSelection
{
    int index = -1;
    std::string name;
};

class CudaDeviceSelector final
{
public:
    static bool select(
        const char* errorPrefix,
        CudaDeviceSelection& selection,
        std::string& error)
    {
        std::lock_guard<std::mutex> lock(selectionMutex_);
        if (cachedSelection_.index >= 0)
        {
            if (!activate(
                    cachedSelection_.index,
                    errorPrefix,
                    error))
                return false;
            selection = cachedSelection_;
            error.clear();
            return true;
        }

        int count = 0;
        const cudaError_t countStatus = cudaGetDeviceCount(&count);
        if (countStatus != cudaSuccess)
        {
            error = failure(
                errorPrefix,
                "device_count_failed",
                countStatus);
            return false;
        }

        long long bestScore = -1;
        CudaDeviceSelection best;
        for (int index = 0; index < count; ++index)
        {
            cudaDeviceProp properties {};
            int computeMode = cudaComputeModeProhibited;
            int multiprocessorCount = 0;
            int clockRate = 0;
            if (cudaGetDeviceProperties(&properties, index)
                    != cudaSuccess
                || cudaDeviceGetAttribute(
                       &computeMode,
                       cudaDevAttrComputeMode,
                       index)
                    != cudaSuccess
                || cudaDeviceGetAttribute(
                       &multiprocessorCount,
                       cudaDevAttrMultiProcessorCount,
                       index)
                    != cudaSuccess
                || cudaDeviceGetAttribute(
                       &clockRate,
                       cudaDevAttrClockRate,
                       index)
                    != cudaSuccess
                || computeMode == cudaComputeModeProhibited)
                continue;

            const long long score =
                static_cast<long long>(multiprocessorCount)
                * static_cast<long long>(clockRate);
            if (score > bestScore)
            {
                bestScore = score;
                best.index = index;
                best.name = properties.name;
            }
        }
        if (best.index < 0)
        {
            error = std::string(errorPrefix)
                + "no_compatible_device";
            return false;
        }
        if (!activate(best.index, errorPrefix, error))
            return false;

        cachedSelection_ = best;
        selection = best;
        error.clear();
        return true;
    }

    static bool activate(
        int deviceIndex,
        const char* errorPrefix,
        std::string& error)
    {
        if (activeDevice_ == deviceIndex)
            return true;
        const cudaError_t status = cudaSetDevice(deviceIndex);
        if (status != cudaSuccess)
        {
            error = failure(
                errorPrefix,
                "set_device_failed",
                status);
            return false;
        }
        activeDevice_ = deviceIndex;
        return true;
    }

private:
    static std::string failure(
        const char* prefix,
        const char* operation,
        cudaError_t status)
    {
        return std::string(prefix) + operation + ":"
            + cudaGetErrorString(status);
    }

    inline static std::mutex selectionMutex_;
    inline static CudaDeviceSelection cachedSelection_;
    inline static thread_local int activeDevice_ = -1;
};
