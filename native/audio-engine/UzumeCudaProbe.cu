#include "UzumeGpuBackend.h"

#include <cuda_runtime.h>
#include <cufft.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

namespace
{
__device__ float uzumeSanitizeSample(float sample)
{
    return isfinite(sample) ? sample : 0.0f;
}

__device__ float uzumeSoftLimitSample(float sample, int* clippingRisk)
{
    constexpr float threshold = 0.98f;
    constexpr float headroom = 1.0f - threshold;

    const float sanitized = uzumeSanitizeSample(sample);
    const float magnitude = fabsf(sanitized);
    if (magnitude <= threshold)
        return sanitized;

    atomicExch(clippingRisk, 1);
    const float limited = threshold + headroom * tanhf((magnitude - threshold) / headroom);
    return copysignf(fminf(1.0f, limited), sanitized);
}

__global__ void uzumeGainLimiterKernel(float* samples, int sampleCount, float gain, int* clippingRisk)
{
    const int index = blockIdx.x * blockDim.x + threadIdx.x;
    const int stride = blockDim.x * gridDim.x;

    for (int sample = index; sample < sampleCount; sample += stride)
        samples[sample] = uzumeSoftLimitSample(samples[sample] * gain, clippingRisk);
}

__global__ void uzumeStereoMatrixLimiterKernel(
    float* leftSamples,
    float* rightSamples,
    int sampleCount,
    echo::UzumeGpuStereoMatrix matrix,
    int* clippingRisk)
{
    const int index = blockIdx.x * blockDim.x + threadIdx.x;
    const int stride = blockDim.x * gridDim.x;

    for (int sample = index; sample < sampleCount; sample += stride)
    {
        const float inputLeft = uzumeSanitizeSample(leftSamples[sample]);
        const float inputRight = uzumeSanitizeSample(rightSamples[sample]);
        const float outputLeft = (inputLeft * matrix.leftToLeft + inputRight * matrix.rightToLeft) * matrix.outputGain;
        const float outputRight = (inputLeft * matrix.leftToRight + inputRight * matrix.rightToRight) * matrix.outputGain;
        leftSamples[sample] = uzumeSoftLimitSample(outputLeft, clippingRisk);
        rightSamples[sample] = uzumeSoftLimitSample(outputRight, clippingRisk);
    }
}

__global__ void uzumeStereoMatrixKernel(
    float* leftSamples,
    float* rightSamples,
    int sampleCount,
    echo::UzumeGpuStereoMatrix matrix,
    int* clippingRisk)
{
    const int index = blockIdx.x * blockDim.x + threadIdx.x;
    const int stride = blockDim.x * gridDim.x;

    for (int sample = index; sample < sampleCount; sample += stride)
    {
        const float inputLeft = uzumeSanitizeSample(leftSamples[sample]);
        const float inputRight = uzumeSanitizeSample(rightSamples[sample]);
        const float outputLeft = uzumeSanitizeSample((inputLeft * matrix.leftToLeft + inputRight * matrix.rightToLeft) * matrix.outputGain);
        const float outputRight = uzumeSanitizeSample((inputLeft * matrix.leftToRight + inputRight * matrix.rightToRight) * matrix.outputGain);
        leftSamples[sample] = outputLeft;
        rightSamples[sample] = outputRight;
        if (fabsf(outputLeft) > 0.98f || fabsf(outputRight) > 0.98f)
            atomicExch(clippingRisk, 1);
    }
}

__global__ void uzumeScaleKernel(float* samples, int sampleCount, float scale)
{
    const int index = blockIdx.x * blockDim.x + threadIdx.x;
    const int stride = blockDim.x * gridDim.x;

    for (int sample = index; sample < sampleCount; sample += stride)
        samples[sample] *= scale;
}

__global__ void uzumeComplexMultiplyKernel(cufftComplex* left, const cufftComplex* right, int count)
{
    const int index = blockIdx.x * blockDim.x + threadIdx.x;
    const int stride = blockDim.x * gridDim.x;

    for (int item = index; item < count; item += stride)
    {
        const cufftComplex a = left[item];
        const cufftComplex b = right[item];
        cufftComplex multiplied {};
        multiplied.x = a.x * b.x - a.y * b.y;
        multiplied.y = a.x * b.y + a.y * b.x;
        left[item] = multiplied;
    }
}

int nextPowerOfTwo(int value)
{
    if (value <= 1)
        return 1;

    int result = 1;
    while (result < value && result <= (1 << 29))
        result <<= 1;
    return result;
}

bool isFiniteStereoMatrix(const echo::UzumeGpuStereoMatrix& matrix)
{
    return std::isfinite(matrix.leftToLeft)
        && std::isfinite(matrix.rightToLeft)
        && std::isfinite(matrix.leftToRight)
        && std::isfinite(matrix.rightToRight)
        && std::isfinite(matrix.outputGain);
}

bool calculatePlanarTotalSamples(int sampleCount, int channelCount, int& totalSamples)
{
    if (sampleCount <= 0 || channelCount <= 0)
        return false;

    if (sampleCount > std::numeric_limits<int>::max() / channelCount)
        return false;

    totalSamples = sampleCount * channelCount;
    return true;
}

const char* classifyCudaProbeError(cudaError_t error)
{
    switch (error)
    {
        case cudaErrorNoDevice:
            return "cuda-no-device";
        case cudaErrorInsufficientDriver:
            return "cuda-insufficient-driver";
        case cudaErrorInitializationError:
            return "cuda-initialization-error";
        default:
            return "cuda-runtime-unavailable";
    }
}

const char* classifyCudaProcessingError(cudaError_t error)
{
    switch (error)
    {
        case cudaSuccess:
            return nullptr;
        case cudaErrorMemoryAllocation:
            return "cuda-memory-allocation-failed";
        case cudaErrorLaunchFailure:
            return "cuda-kernel-launch-failed";
        case cudaErrorLaunchTimeout:
            return "cuda-kernel-timeout";
        default:
            return classifyCudaProbeError(error);
    }
}

const char* classifyCufftError(cufftResult error)
{
    switch (error)
    {
        case CUFFT_SUCCESS:
            return nullptr;
        case CUFFT_ALLOC_FAILED:
            return "cufft-allocation-failed";
        case CUFFT_INVALID_DEVICE:
            return "cufft-invalid-device";
        case CUFFT_INVALID_SIZE:
            return "cufft-invalid-size";
        case CUFFT_INVALID_VALUE:
            return "cufft-invalid-value";
        case CUFFT_EXEC_FAILED:
            return "cufft-exec-failed";
        case CUFFT_INTERNAL_ERROR:
            return "cufft-internal-error";
        case CUFFT_SETUP_FAILED:
            return "cufft-setup-failed";
        case CUFFT_NOT_SUPPORTED:
            return "cufft-not-supported";
        default:
            return "cufft-unavailable";
    }
}

struct UzumeStereoMatrixScratch
{
    cudaStream_t stream = nullptr;
    float* hostLeft = nullptr;
    float* hostRight = nullptr;
    int* hostClippingRisk = nullptr;
    float* deviceLeft = nullptr;
    float* deviceRight = nullptr;
    int* deviceClippingRisk = nullptr;
    int capacitySamples = 0;

    ~UzumeStereoMatrixScratch()
    {
        release();
    }

    void release()
    {
        cudaFree(deviceClippingRisk);
        cudaFree(deviceRight);
        cudaFree(deviceLeft);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostRight != nullptr)
            cudaFreeHost(hostRight);
        if (hostLeft != nullptr)
            cudaFreeHost(hostLeft);
        deviceClippingRisk = nullptr;
        deviceRight = nullptr;
        deviceLeft = nullptr;
        hostClippingRisk = nullptr;
        hostRight = nullptr;
        hostLeft = nullptr;
        capacitySamples = 0;

        if (stream != nullptr)
        {
            cudaStreamDestroy(stream);
            stream = nullptr;
        }
    }

    cudaError_t ensure(int sampleCount, bool& reused)
    {
        reused = stream != nullptr
            && hostLeft != nullptr
            && hostRight != nullptr
            && hostClippingRisk != nullptr
            && deviceLeft != nullptr
            && deviceRight != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount;
        if (reused)
            return cudaSuccess;

        if (stream == nullptr)
        {
            const auto streamStatus = cudaStreamCreateWithFlags(&stream, cudaStreamNonBlocking);
            if (streamStatus != cudaSuccess)
                return streamStatus;
        }

        cudaFree(deviceClippingRisk);
        cudaFree(deviceRight);
        cudaFree(deviceLeft);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostRight != nullptr)
            cudaFreeHost(hostRight);
        if (hostLeft != nullptr)
            cudaFreeHost(hostLeft);
        deviceClippingRisk = nullptr;
        deviceRight = nullptr;
        deviceLeft = nullptr;
        hostClippingRisk = nullptr;
        hostRight = nullptr;
        hostLeft = nullptr;
        capacitySamples = 0;

        const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
        auto status = cudaHostAlloc(reinterpret_cast<void**>(&hostLeft), sampleBytes, cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaHostAlloc(reinterpret_cast<void**>(&hostRight), sampleBytes, cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaHostAlloc(reinterpret_cast<void**>(&hostClippingRisk), sizeof(int), cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceLeft), sampleBytes);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceRight), sampleBytes);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceClippingRisk), sizeof(int));

        if (status != cudaSuccess)
        {
            cudaFree(deviceClippingRisk);
            cudaFree(deviceRight);
            cudaFree(deviceLeft);
            if (hostClippingRisk != nullptr)
                cudaFreeHost(hostClippingRisk);
            if (hostRight != nullptr)
                cudaFreeHost(hostRight);
            if (hostLeft != nullptr)
                cudaFreeHost(hostLeft);
            deviceClippingRisk = nullptr;
            deviceRight = nullptr;
            deviceLeft = nullptr;
            hostClippingRisk = nullptr;
            hostRight = nullptr;
            hostLeft = nullptr;
            capacitySamples = 0;
            return status;
        }

        capacitySamples = sampleCount;
        return cudaSuccess;
    }

    bool isReadyFor(int sampleCount) const
    {
        return stream != nullptr
            && hostLeft != nullptr
            && hostRight != nullptr
            && hostClippingRisk != nullptr
            && deviceLeft != nullptr
            && deviceRight != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount;
    }
};

struct UzumeGainLimiterScratch
{
    cudaStream_t stream = nullptr;
    float* hostSamples = nullptr;
    int* hostClippingRisk = nullptr;
    float* deviceSamples = nullptr;
    int* deviceClippingRisk = nullptr;
    int capacitySamples = 0;

    ~UzumeGainLimiterScratch()
    {
        release();
    }

    void release()
    {
        cudaFree(deviceClippingRisk);
        cudaFree(deviceSamples);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostSamples != nullptr)
            cudaFreeHost(hostSamples);
        deviceClippingRisk = nullptr;
        deviceSamples = nullptr;
        hostClippingRisk = nullptr;
        hostSamples = nullptr;
        capacitySamples = 0;

        if (stream != nullptr)
        {
            cudaStreamDestroy(stream);
            stream = nullptr;
        }
    }

    cudaError_t ensure(int sampleCount, bool& reused)
    {
        reused = stream != nullptr
            && hostSamples != nullptr
            && hostClippingRisk != nullptr
            && deviceSamples != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount;
        if (reused)
            return cudaSuccess;

        if (stream == nullptr)
        {
            const auto streamStatus = cudaStreamCreateWithFlags(&stream, cudaStreamNonBlocking);
            if (streamStatus != cudaSuccess)
                return streamStatus;
        }

        cudaFree(deviceClippingRisk);
        cudaFree(deviceSamples);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostSamples != nullptr)
            cudaFreeHost(hostSamples);
        deviceClippingRisk = nullptr;
        deviceSamples = nullptr;
        hostClippingRisk = nullptr;
        hostSamples = nullptr;
        capacitySamples = 0;

        const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
        auto status = cudaHostAlloc(reinterpret_cast<void**>(&hostSamples), sampleBytes, cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaHostAlloc(reinterpret_cast<void**>(&hostClippingRisk), sizeof(int), cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceSamples), sampleBytes);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceClippingRisk), sizeof(int));

        if (status != cudaSuccess)
        {
            cudaFree(deviceClippingRisk);
            cudaFree(deviceSamples);
            if (hostClippingRisk != nullptr)
                cudaFreeHost(hostClippingRisk);
            if (hostSamples != nullptr)
                cudaFreeHost(hostSamples);
            deviceClippingRisk = nullptr;
            deviceSamples = nullptr;
            hostClippingRisk = nullptr;
            hostSamples = nullptr;
            capacitySamples = 0;
            return status;
        }

        capacitySamples = sampleCount;
        return cudaSuccess;
    }

    bool isReadyFor(int sampleCount) const
    {
        return stream != nullptr
            && hostSamples != nullptr
            && hostClippingRisk != nullptr
            && deviceSamples != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount;
    }
};

struct UzumePlanarLimiterScratch
{
    cudaStream_t stream = nullptr;
    float* hostSamples = nullptr;
    int* hostClippingRisk = nullptr;
    float* deviceSamples = nullptr;
    int* deviceClippingRisk = nullptr;
    int capacitySamples = 0;
    int capacityChannels = 0;

    ~UzumePlanarLimiterScratch()
    {
        release();
    }

    void release()
    {
        cudaFree(deviceClippingRisk);
        cudaFree(deviceSamples);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostSamples != nullptr)
            cudaFreeHost(hostSamples);
        deviceClippingRisk = nullptr;
        deviceSamples = nullptr;
        hostClippingRisk = nullptr;
        hostSamples = nullptr;
        capacitySamples = 0;
        capacityChannels = 0;

        if (stream != nullptr)
        {
            cudaStreamDestroy(stream);
            stream = nullptr;
        }
    }

    cudaError_t ensure(int sampleCount, int channelCount, bool& reused)
    {
        reused = stream != nullptr
            && hostSamples != nullptr
            && hostClippingRisk != nullptr
            && deviceSamples != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount
            && capacityChannels >= channelCount;
        if (reused)
            return cudaSuccess;

        if (stream == nullptr)
        {
            const auto streamStatus = cudaStreamCreateWithFlags(&stream, cudaStreamNonBlocking);
            if (streamStatus != cudaSuccess)
                return streamStatus;
        }

        cudaFree(deviceClippingRisk);
        cudaFree(deviceSamples);
        if (hostClippingRisk != nullptr)
            cudaFreeHost(hostClippingRisk);
        if (hostSamples != nullptr)
            cudaFreeHost(hostSamples);
        deviceClippingRisk = nullptr;
        deviceSamples = nullptr;
        hostClippingRisk = nullptr;
        hostSamples = nullptr;
        capacitySamples = 0;
        capacityChannels = 0;

        const auto totalSamples = static_cast<size_t>(sampleCount) * static_cast<size_t>(channelCount);
        const auto sampleBytes = totalSamples * sizeof(float);
        auto status = cudaHostAlloc(reinterpret_cast<void**>(&hostSamples), sampleBytes, cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaHostAlloc(reinterpret_cast<void**>(&hostClippingRisk), sizeof(int), cudaHostAllocDefault);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceSamples), sampleBytes);
        if (status == cudaSuccess)
            status = cudaMalloc(reinterpret_cast<void**>(&deviceClippingRisk), sizeof(int));

        if (status != cudaSuccess)
        {
            cudaFree(deviceClippingRisk);
            cudaFree(deviceSamples);
            if (hostClippingRisk != nullptr)
                cudaFreeHost(hostClippingRisk);
            if (hostSamples != nullptr)
                cudaFreeHost(hostSamples);
            deviceClippingRisk = nullptr;
            deviceSamples = nullptr;
            hostClippingRisk = nullptr;
            hostSamples = nullptr;
            capacitySamples = 0;
            capacityChannels = 0;
            return status;
        }

        capacitySamples = sampleCount;
        capacityChannels = channelCount;
        return cudaSuccess;
    }

    bool isReadyFor(int sampleCount, int channelCount) const
    {
        return stream != nullptr
            && hostSamples != nullptr
            && hostClippingRisk != nullptr
            && deviceSamples != nullptr
            && deviceClippingRisk != nullptr
            && capacitySamples >= sampleCount
            && capacityChannels >= channelCount;
    }
};

UzumeGainLimiterScratch& getGainLimiterScratch()
{
    thread_local UzumeGainLimiterScratch scratch;
    return scratch;
}

UzumeGainLimiterScratch& getPlaybackGainLimiterScratch()
{
    static UzumeGainLimiterScratch scratch;
    return scratch;
}

UzumePlanarLimiterScratch& getPlaybackPlanarLimiterScratch()
{
    static UzumePlanarLimiterScratch scratch;
    return scratch;
}

UzumeStereoMatrixScratch& getStereoMatrixScratch()
{
    thread_local UzumeStereoMatrixScratch scratch;
    return scratch;
}

UzumeStereoMatrixScratch& getPlaybackStereoMatrixScratch()
{
    static UzumeStereoMatrixScratch scratch;
    return scratch;
}

struct UzumeFftConvolutionScratch
{
    cudaStream_t stream = nullptr;
    float* hostInput = nullptr;
    float* hostImpulse = nullptr;
    float* hostOutput = nullptr;
    float* deviceInput = nullptr;
    float* deviceImpulse = nullptr;
    float* deviceOutput = nullptr;
    cufftComplex* deviceSignalSpectrum = nullptr;
    cufftComplex* deviceImpulseSpectrum = nullptr;
    cufftHandle forwardPlan = 0;
    cufftHandle inversePlan = 0;
    int fftSize = 0;

    ~UzumeFftConvolutionScratch()
    {
        release();
    }

    void releaseBuffersAndPlans()
    {
        if (inversePlan != 0)
            cufftDestroy(inversePlan);
        if (forwardPlan != 0)
            cufftDestroy(forwardPlan);
        inversePlan = 0;
        forwardPlan = 0;

        cudaFree(deviceImpulseSpectrum);
        cudaFree(deviceSignalSpectrum);
        cudaFree(deviceOutput);
        cudaFree(deviceImpulse);
        cudaFree(deviceInput);
        if (hostOutput != nullptr)
            cudaFreeHost(hostOutput);
        if (hostImpulse != nullptr)
            cudaFreeHost(hostImpulse);
        if (hostInput != nullptr)
            cudaFreeHost(hostInput);
        deviceImpulseSpectrum = nullptr;
        deviceSignalSpectrum = nullptr;
        deviceOutput = nullptr;
        deviceImpulse = nullptr;
        deviceInput = nullptr;
        hostOutput = nullptr;
        hostImpulse = nullptr;
        hostInput = nullptr;
        fftSize = 0;
    }

    void release()
    {
        releaseBuffersAndPlans();

        if (stream != nullptr)
        {
            cudaStreamDestroy(stream);
            stream = nullptr;
        }
    }

    cudaError_t ensure(int requestedFftSize, cufftResult& cufftStatus, bool& scratchReused, bool& planReused)
    {
        cufftStatus = CUFFT_SUCCESS;
        scratchReused = stream != nullptr
            && hostInput != nullptr
            && hostImpulse != nullptr
            && hostOutput != nullptr
            && deviceInput != nullptr
            && deviceImpulse != nullptr
            && deviceOutput != nullptr
            && deviceSignalSpectrum != nullptr
            && deviceImpulseSpectrum != nullptr
            && fftSize == requestedFftSize;
        planReused = scratchReused && forwardPlan != 0 && inversePlan != 0;

        if (scratchReused && planReused)
            return cudaSuccess;

        if (stream == nullptr)
        {
            const auto streamStatus = cudaStreamCreateWithFlags(&stream, cudaStreamNonBlocking);
            if (streamStatus != cudaSuccess)
                return streamStatus;
        }

        releaseBuffersAndPlans();

        const auto signalBytes = static_cast<size_t>(requestedFftSize) * sizeof(float);
        const int spectrumCount = requestedFftSize / 2 + 1;
        const auto spectrumBytes = static_cast<size_t>(spectrumCount) * sizeof(cufftComplex);

        auto cudaStatus = cudaHostAlloc(reinterpret_cast<void**>(&hostInput), signalBytes, cudaHostAllocDefault);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaHostAlloc(reinterpret_cast<void**>(&hostImpulse), signalBytes, cudaHostAllocDefault);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaHostAlloc(reinterpret_cast<void**>(&hostOutput), signalBytes, cudaHostAllocDefault);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceInput), signalBytes);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceImpulse), signalBytes);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceOutput), signalBytes);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceSignalSpectrum), spectrumBytes);
        if (cudaStatus == cudaSuccess)
            cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceImpulseSpectrum), spectrumBytes);
        if (cudaStatus != cudaSuccess)
        {
            releaseBuffersAndPlans();
            return cudaStatus;
        }

        cufftStatus = cufftPlan1d(&forwardPlan, requestedFftSize, CUFFT_R2C, 1);
        if (cufftStatus == CUFFT_SUCCESS)
            cufftStatus = cufftPlan1d(&inversePlan, requestedFftSize, CUFFT_C2R, 1);
        if (cufftStatus == CUFFT_SUCCESS)
            cufftStatus = cufftSetStream(forwardPlan, stream);
        if (cufftStatus == CUFFT_SUCCESS)
            cufftStatus = cufftSetStream(inversePlan, stream);

        if (cufftStatus != CUFFT_SUCCESS)
        {
            releaseBuffersAndPlans();
            return cudaSuccess;
        }

        fftSize = requestedFftSize;
        return cudaSuccess;
    }

    bool isReadyFor(int requestedFftSize) const
    {
        return stream != nullptr
            && hostInput != nullptr
            && hostImpulse != nullptr
            && hostOutput != nullptr
            && deviceInput != nullptr
            && deviceImpulse != nullptr
            && deviceOutput != nullptr
            && deviceSignalSpectrum != nullptr
            && deviceImpulseSpectrum != nullptr
            && forwardPlan != 0
            && inversePlan != 0
            && fftSize == requestedFftSize;
    }
};

UzumeFftConvolutionScratch& getFftConvolutionScratch()
{
    thread_local UzumeFftConvolutionScratch scratch;
    return scratch;
}

UzumeFftConvolutionScratch& getPlaybackFftConvolutionScratch()
{
    static UzumeFftConvolutionScratch scratch;
    return scratch;
}

struct UzumeStreamingFftConvolutionScratch
{
    UzumeFftConvolutionScratch fftScratch;
    std::vector<float> history;
    std::vector<float> inputWindow;
    int maxSamples = 0;
    int maxImpulseCount = 0;

    void resetHistory()
    {
        std::fill(history.begin(), history.end(), 0.0f);
    }

    bool isPreparedFor(int sampleCount, int impulseCount, int requiredFftSize) const
    {
        const int historyCount = std::max(0, impulseCount - 1);
        const int inputCount = sampleCount + historyCount;
        return sampleCount > 0
            && impulseCount > 0
            && maxSamples >= sampleCount
            && maxImpulseCount >= impulseCount
            && static_cast<int>(history.size()) >= historyCount
            && static_cast<int>(inputWindow.size()) >= inputCount
            && fftScratch.isReadyFor(fftScratch.fftSize)
            && fftScratch.fftSize >= requiredFftSize;
    }

    cudaError_t ensure(int requestedMaxSamples, int requestedMaxImpulseCount, int requiredFftSize, cufftResult& cufftStatus, bool& scratchReused, bool& planReused)
    {
        cufftStatus = CUFFT_SUCCESS;
        const int historyCount = std::max(0, requestedMaxImpulseCount - 1);
        const int inputCount = requestedMaxSamples + historyCount;
        const bool hostReused = maxSamples >= requestedMaxSamples
            && maxImpulseCount >= requestedMaxImpulseCount
            && static_cast<int>(history.size()) >= historyCount
            && static_cast<int>(inputWindow.size()) >= inputCount;
        const bool fftReused = fftScratch.isReadyFor(fftScratch.fftSize)
            && fftScratch.fftSize >= requiredFftSize;

        scratchReused = hostReused && fftReused;
        planReused = fftReused;

        if (! fftReused)
        {
            bool fftScratchReused = false;
            bool fftPlanReused = false;
            const auto cudaStatus = fftScratch.ensure(requiredFftSize, cufftStatus, fftScratchReused, fftPlanReused);
            if (cudaStatus != cudaSuccess || cufftStatus != CUFFT_SUCCESS)
                return cudaStatus;
            planReused = fftPlanReused;
        }

        if (! hostReused)
        {
            history.resize(static_cast<size_t>(historyCount));
            inputWindow.resize(static_cast<size_t>(inputCount));
            maxSamples = requestedMaxSamples;
            maxImpulseCount = requestedMaxImpulseCount;
        }

        resetHistory();
        return cudaSuccess;
    }
};

UzumeStreamingFftConvolutionScratch& getPlaybackStreamingFftConvolutionScratch()
{
    static UzumeStreamingFftConvolutionScratch scratch;
    return scratch;
}

bool calculateStreamingFftSize(int sampleCount, int impulseCount, int& fftSize)
{
    if (sampleCount <= 0 || impulseCount <= 0)
        return false;

    const auto convolutionLength = static_cast<long long>(sampleCount) + (2LL * static_cast<long long>(impulseCount)) - 2LL;
    if (convolutionLength <= 0 || convolutionLength > static_cast<long long>(std::numeric_limits<int>::max()))
        return false;

    fftSize = nextPowerOfTwo(static_cast<int>(convolutionLength));
    return fftSize >= convolutionLength;
}

cudaError_t runFftConvolutionWindowWithScratch(
    UzumeFftConvolutionScratch& scratch,
    const float* inputSamples,
    const float* impulse,
    float* outputSamples,
    int inputCount,
    int impulseCount,
    int outputOffset,
    int outputCount,
    int fftSize,
    cufftResult& cufftStatus)
{
    cufftStatus = CUFFT_SUCCESS;
    const auto signalBytes = static_cast<size_t>(fftSize) * sizeof(float);
    const int spectrumCount = fftSize / 2 + 1;

    std::fill(scratch.hostInput, scratch.hostInput + fftSize, 0.0f);
    std::fill(scratch.hostImpulse, scratch.hostImpulse + fftSize, 0.0f);
    for (int sample = 0; sample < inputCount; ++sample)
        scratch.hostInput[sample] = inputSamples[sample];
    for (int tap = 0; tap < impulseCount; ++tap)
        scratch.hostImpulse[tap] = impulse[tap];

    auto cudaStatus = cudaMemcpyAsync(scratch.deviceInput, scratch.hostInput, signalBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (cudaStatus == cudaSuccess)
        cudaStatus = cudaMemcpyAsync(scratch.deviceImpulse, scratch.hostImpulse, signalBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (cudaStatus == cudaSuccess)
        cufftStatus = cufftExecR2C(scratch.forwardPlan, scratch.deviceInput, scratch.deviceSignalSpectrum);
    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cufftStatus = cufftExecR2C(scratch.forwardPlan, scratch.deviceImpulse, scratch.deviceImpulseSpectrum);

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (spectrumCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeComplexMultiplyKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceSignalSpectrum,
            scratch.deviceImpulseSpectrum,
            spectrumCount);
        cudaStatus = cudaGetLastError();
    }

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cufftStatus = cufftExecC2R(scratch.inversePlan, scratch.deviceSignalSpectrum, scratch.deviceOutput);

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (fftSize + threadsPerBlock - 1) / threadsPerBlock));
        uzumeScaleKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceOutput,
            fftSize,
            1.0f / static_cast<float>(fftSize));
        cudaStatus = cudaGetLastError();
    }

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cudaStatus = cudaMemcpyAsync(scratch.hostOutput, scratch.deviceOutput, signalBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cudaStatus = cudaStreamSynchronize(scratch.stream);

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
    {
        for (int sample = 0; sample < outputCount; ++sample)
            outputSamples[sample] = scratch.hostOutput[outputOffset + sample];
    }

    return cudaStatus;
}

cudaError_t runFftConvolutionWithScratch(
    UzumeFftConvolutionScratch& scratch,
    float* samples,
    const float* impulse,
    int sampleCount,
    int impulseCount,
    int fftSize,
    cufftResult& cufftStatus)
{
    return runFftConvolutionWindowWithScratch(
        scratch,
        samples,
        impulse,
        samples,
        sampleCount,
        impulseCount,
        0,
        sampleCount,
        fftSize,
        cufftStatus);
}

const echo::UzumeGpuBackendProbe& cachedUzumeGpuBackendProbe()
{
    static const echo::UzumeGpuBackendProbe probe = echo::probeUzumeGpuBackend();
    return probe;
}
} // namespace

namespace echo
{
UzumeGpuBackendProbe probeUzumeGpuBackend()
{
    static char selectedDeviceName[256] {};

    UzumeGpuBackendProbe probe;
    probe.compiled = true;
    probe.backend = "gpu-cuda";
    probe.fallbackReason = "cuda-runtime-unavailable";
    probe.cufftFallbackReason = "cuda-runtime-unavailable";

    int runtimeVersion = 0;
    const auto runtimeStatus = cudaRuntimeGetVersion(&runtimeVersion);
    if (runtimeStatus != cudaSuccess)
    {
        probe.fallbackReason = classifyCudaProbeError(runtimeStatus);
        return probe;
    }

    probe.cudaRuntimeVersion = runtimeVersion;
    probe.cufftFallbackReason = "cuda-runtime-unavailable";

    int deviceCount = 0;
    const auto deviceStatus = cudaGetDeviceCount(&deviceCount);
    if (deviceStatus != cudaSuccess || deviceCount <= 0)
    {
        probe.deviceCount = 0;
        probe.fallbackReason = deviceStatus == cudaSuccess ? "cuda-no-device" : classifyCudaProbeError(deviceStatus);
        probe.cufftFallbackReason = probe.fallbackReason;
        return probe;
    }

    cudaDeviceProp properties {};
    const auto propertiesStatus = cudaGetDeviceProperties(&properties, 0);
    if (propertiesStatus != cudaSuccess)
    {
        probe.deviceCount = deviceCount;
        probe.fallbackReason = classifyCudaProbeError(propertiesStatus);
        probe.cufftFallbackReason = probe.fallbackReason;
        return probe;
    }

    probe.available = true;
    probe.deviceCount = deviceCount;
    std::strncpy(selectedDeviceName, properties.name, sizeof(selectedDeviceName) - 1);
    selectedDeviceName[sizeof(selectedDeviceName) - 1] = '\0';
    probe.deviceName = selectedDeviceName;
    probe.fallbackReason = nullptr;

    int cufftVersion = 0;
    const auto cufftVersionStatus = cufftGetVersion(&cufftVersion);
    if (cufftVersionStatus != CUFFT_SUCCESS)
    {
        probe.cufftFallbackReason = classifyCufftError(cufftVersionStatus);
        return probe;
    }

    probe.cufftVersion = cufftVersion;
    cufftHandle plan = 0;
    const auto planStatus = cufftPlan1d(&plan, 8, CUFFT_R2C, 1);
    if (planStatus != CUFFT_SUCCESS)
    {
        probe.cufftFallbackReason = classifyCufftError(planStatus);
        return probe;
    }

    cufftDestroy(plan);
    probe.cufftAvailable = true;
    probe.cufftFallbackReason = nullptr;

    return probe;
}

UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackSafetyLimiter(int maxSamples)
{
    UzumeGpuPlaybackLimiterStatus result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (maxSamples <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackGainLimiterScratch();
    bool scratchReused = false;
    const auto status = scratch.ensure(maxSamples, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    result.prepared = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackSafetyLimiter(float* samples, int sampleCount)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (samples == nullptr || sampleCount <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackGainLimiterScratch();
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    if (! scratch.isReadyFor(sampleCount))
    {
        result.fallbackReason = scratch.capacitySamples > 0
            ? "cuda-playback-scratch-too-small"
            : "cuda-playback-scratch-unprepared";
        return result;
    }

    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
    std::memcpy(scratch.hostSamples, samples, sampleBytes);

    auto status = cudaMemcpyAsync(scratch.deviceSamples, scratch.hostSamples, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeGainLimiterKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceSamples,
            sampleCount,
            1.0f,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostSamples, scratch.deviceSamples, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(samples, scratch.hostSamples, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = true;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackPlanarSafetyLimiter(int maxSamples, int maxChannels)
{
    UzumeGpuPlaybackLimiterStatus result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    int totalSamples = 0;
    if (! calculatePlanarTotalSamples(maxSamples, maxChannels, totalSamples))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }
    (void) totalSamples;

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackPlanarLimiterScratch();
    bool scratchReused = false;
    const auto status = scratch.ensure(maxSamples, maxChannels, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    result.prepared = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.scratchCapacityChannels = scratch.capacityChannels;
    result.pinnedHostCapacityChannels = scratch.capacityChannels;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(float* const* channelSamples, int channelCount, int sampleCount)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    int totalSamples = 0;
    if (channelSamples == nullptr || ! calculatePlanarTotalSamples(sampleCount, channelCount, totalSamples))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    for (int channel = 0; channel < channelCount; ++channel)
    {
        if (channelSamples[channel] == nullptr)
        {
            result.fallbackReason = "invalid-input";
            return result;
        }
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackPlanarLimiterScratch();
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.scratchCapacityChannels = scratch.capacityChannels;
    result.pinnedHostCapacityChannels = scratch.capacityChannels;
    if (! scratch.isReadyFor(sampleCount, channelCount))
    {
        result.fallbackReason = scratch.capacitySamples > 0 || scratch.capacityChannels > 0
            ? "cuda-playback-planar-scratch-too-small"
            : "cuda-playback-planar-scratch-unprepared";
        return result;
    }

    const auto channelSampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
    for (int channel = 0; channel < channelCount; ++channel)
        std::memcpy(scratch.hostSamples + static_cast<size_t>(channel) * static_cast<size_t>(sampleCount), channelSamples[channel], channelSampleBytes);

    const auto totalSampleBytes = static_cast<size_t>(totalSamples) * sizeof(float);
    auto status = cudaMemcpyAsync(scratch.deviceSamples, scratch.hostSamples, totalSampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (totalSamples + threadsPerBlock - 1) / threadsPerBlock));
        uzumeGainLimiterKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceSamples,
            totalSamples,
            1.0f,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostSamples, scratch.deviceSamples, totalSampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    for (int channel = 0; channel < channelCount; ++channel)
        std::memcpy(channelSamples[channel], scratch.hostSamples + static_cast<size_t>(channel) * static_cast<size_t>(sampleCount), channelSampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = true;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.scratchCapacityChannels = scratch.capacityChannels;
    result.pinnedHostCapacityChannels = scratch.capacityChannels;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuSafetyLimiter(float* samples, int sampleCount)
{
    return processUzumeGpuFusedGainLimiter(samples, sampleCount, 1.0f);
}

UzumeGpuLimiterResult processUzumeGpuFusedGainLimiter(float* samples, int sampleCount, float gain)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (samples == nullptr || sampleCount <= 0 || ! std::isfinite(gain))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getGainLimiterScratch();
    bool scratchReused = false;
    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);

    auto status = scratch.ensure(sampleCount, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(scratch.hostSamples, samples, sampleBytes);

    status = cudaMemcpyAsync(scratch.deviceSamples, scratch.hostSamples, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeGainLimiterKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceSamples,
            sampleCount,
            gain,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostSamples, scratch.deviceSamples, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(samples, scratch.hostSamples, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuPlaybackStereoMatrixStatus prepareUzumeGpuPlaybackStereoMatrixLimiter(int maxSamples)
{
    UzumeGpuPlaybackStereoMatrixStatus result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (maxSamples <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackStereoMatrixScratch();
    bool scratchReused = false;
    const auto status = scratch.ensure(maxSamples, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    result.prepared = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrixLimiter(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (leftSamples == nullptr || rightSamples == nullptr || sampleCount <= 0 || ! isFiniteStereoMatrix(matrix))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackStereoMatrixScratch();
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    if (! scratch.isReadyFor(sampleCount))
    {
        result.fallbackReason = scratch.capacitySamples > 0
            ? "cuda-playback-stereo-scratch-too-small"
            : "cuda-playback-stereo-scratch-unprepared";
        return result;
    }

    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
    std::memcpy(scratch.hostLeft, leftSamples, sampleBytes);
    std::memcpy(scratch.hostRight, rightSamples, sampleBytes);

    auto status = cudaMemcpyAsync(scratch.deviceLeft, scratch.hostLeft, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.deviceRight, scratch.hostRight, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeStereoMatrixLimiterKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceLeft,
            scratch.deviceRight,
            sampleCount,
            matrix,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostLeft, scratch.deviceLeft, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostRight, scratch.deviceRight, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(leftSamples, scratch.hostLeft, sampleBytes);
    std::memcpy(rightSamples, scratch.hostRight, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = true;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrix(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (leftSamples == nullptr || rightSamples == nullptr || sampleCount <= 0 || ! isFiniteStereoMatrix(matrix))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getPlaybackStereoMatrixScratch();
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    if (! scratch.isReadyFor(sampleCount))
    {
        result.fallbackReason = scratch.capacitySamples > 0
            ? "cuda-playback-stereo-scratch-too-small"
            : "cuda-playback-stereo-scratch-unprepared";
        return result;
    }

    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
    std::memcpy(scratch.hostLeft, leftSamples, sampleBytes);
    std::memcpy(scratch.hostRight, rightSamples, sampleBytes);

    auto status = cudaMemcpyAsync(scratch.deviceLeft, scratch.hostLeft, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.deviceRight, scratch.hostRight, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeStereoMatrixKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceLeft,
            scratch.deviceRight,
            sampleCount,
            matrix,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostLeft, scratch.deviceLeft, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostRight, scratch.deviceRight, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(leftSamples, scratch.hostLeft, sampleBytes);
    std::memcpy(rightSamples, scratch.hostRight, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = true;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuStereoMatrixLimiter(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (leftSamples == nullptr || rightSamples == nullptr || sampleCount <= 0 || ! isFiniteStereoMatrix(matrix))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getStereoMatrixScratch();
    bool scratchReused = false;
    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);

    auto status = scratch.ensure(sampleCount, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(scratch.hostLeft, leftSamples, sampleBytes);
    std::memcpy(scratch.hostRight, rightSamples, sampleBytes);

    status = cudaMemcpyAsync(scratch.deviceLeft, scratch.hostLeft, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.deviceRight, scratch.hostRight, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeStereoMatrixLimiterKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceLeft,
            scratch.deviceRight,
            sampleCount,
            matrix,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostLeft, scratch.deviceLeft, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostRight, scratch.deviceRight, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(leftSamples, scratch.hostLeft, sampleBytes);
    std::memcpy(rightSamples, scratch.hostRight, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuLimiterResult processUzumeGpuStereoMatrix(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix)
{
    UzumeGpuLimiterResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.fallbackReason = probe.fallbackReason;

    if (leftSamples == nullptr || rightSamples == nullptr || sampleCount <= 0 || ! isFiniteStereoMatrix(matrix))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available)
        return result;

    auto& scratch = getStereoMatrixScratch();
    bool scratchReused = false;
    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);

    auto status = scratch.ensure(sampleCount, scratchReused);
    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(scratch.hostLeft, leftSamples, sampleBytes);
    std::memcpy(scratch.hostRight, rightSamples, sampleBytes);

    status = cudaMemcpyAsync(scratch.deviceLeft, scratch.hostLeft, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.deviceRight, scratch.hostRight, sampleBytes, cudaMemcpyHostToDevice, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemsetAsync(scratch.deviceClippingRisk, 0, sizeof(int), scratch.stream);

    if (status == cudaSuccess)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeStereoMatrixKernel<<<blocks, threadsPerBlock, 0, scratch.stream>>>(
            scratch.deviceLeft,
            scratch.deviceRight,
            sampleCount,
            matrix,
            scratch.deviceClippingRisk);
        status = cudaGetLastError();
    }

    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostLeft, scratch.deviceLeft, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostRight, scratch.deviceRight, sampleBytes, cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaMemcpyAsync(scratch.hostClippingRisk, scratch.deviceClippingRisk, sizeof(int), cudaMemcpyDeviceToHost, scratch.stream);
    if (status == cudaSuccess)
        status = cudaStreamSynchronize(scratch.stream);

    if (status != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(status);
        return result;
    }

    std::memcpy(leftSamples, scratch.hostLeft, sampleBytes);
    std::memcpy(rightSamples, scratch.hostRight, sampleBytes);

    result.processed = true;
    result.clippingRisk = *scratch.hostClippingRisk != 0;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.pinnedHostBacked = true;
    result.scratchCapacitySamples = scratch.capacitySamples;
    result.pinnedHostCapacitySamples = scratch.capacitySamples;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuFftRoundtripResult processUzumeGpuFftRoundtrip(float* samples, int sampleCount)
{
    UzumeGpuFftRoundtripResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    if (samples == nullptr || sampleCount <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available || ! probe.cufftAvailable)
        return result;

    const std::vector<float> original(samples, samples + sampleCount);
    const auto sampleBytes = static_cast<size_t>(sampleCount) * sizeof(float);
    const auto spectrumBytes = static_cast<size_t>(sampleCount / 2 + 1) * sizeof(cufftComplex);

    float* deviceInput = nullptr;
    float* deviceOutput = nullptr;
    cufftComplex* deviceSpectrum = nullptr;
    cufftHandle forwardPlan = 0;
    cufftHandle inversePlan = 0;

    auto cleanup = [&]()
    {
        if (inversePlan != 0)
            cufftDestroy(inversePlan);
        if (forwardPlan != 0)
            cufftDestroy(forwardPlan);
        cudaFree(deviceSpectrum);
        cudaFree(deviceOutput);
        cudaFree(deviceInput);
    };

    auto cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceInput), sampleBytes);
    if (cudaStatus == cudaSuccess)
        cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceOutput), sampleBytes);
    if (cudaStatus == cudaSuccess)
        cudaStatus = cudaMalloc(reinterpret_cast<void**>(&deviceSpectrum), spectrumBytes);
    if (cudaStatus != cudaSuccess)
    {
        cleanup();
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }

    auto cufftStatus = cufftPlan1d(&forwardPlan, sampleCount, CUFFT_R2C, 1);
    if (cufftStatus == CUFFT_SUCCESS)
        cufftStatus = cufftPlan1d(&inversePlan, sampleCount, CUFFT_C2R, 1);
    if (cufftStatus != CUFFT_SUCCESS)
    {
        cleanup();
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    cudaStatus = cudaMemcpy(deviceInput, samples, sampleBytes, cudaMemcpyHostToDevice);
    if (cudaStatus == cudaSuccess)
        cufftStatus = cufftExecR2C(forwardPlan, deviceInput, deviceSpectrum);
    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cufftStatus = cufftExecC2R(inversePlan, deviceSpectrum, deviceOutput);

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
    {
        constexpr int threadsPerBlock = 256;
        const int blocks = std::max(1, std::min(1024, (sampleCount + threadsPerBlock - 1) / threadsPerBlock));
        uzumeScaleKernel<<<blocks, threadsPerBlock>>>(deviceOutput, sampleCount, 1.0f / static_cast<float>(sampleCount));
        cudaStatus = cudaGetLastError();
    }

    if (cudaStatus == cudaSuccess && cufftStatus == CUFFT_SUCCESS)
        cudaStatus = cudaMemcpy(samples, deviceOutput, sampleBytes, cudaMemcpyDeviceToHost);

    cleanup();

    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }

    float maxAbsError = 0.0f;
    for (int sample = 0; sample < sampleCount; ++sample)
        maxAbsError = std::max(maxAbsError, std::fabs(samples[sample] - original[static_cast<size_t>(sample)]));

    result.processed = true;
    result.maxAbsError = maxAbsError;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackFftConvolution(int maxSamples, int maxImpulseCount)
{
    UzumeGpuFftConvolutionPrepareStatus result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    if (maxSamples <= 0 || maxImpulseCount <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available || ! probe.cufftAvailable)
        return result;

    const int convolutionLength = maxSamples + maxImpulseCount - 1;
    const int fftSize = nextPowerOfTwo(convolutionLength);
    if (fftSize < convolutionLength)
    {
        result.fallbackReason = "fft-size-overflow";
        return result;
    }

    result.fftSize = fftSize;
    auto& scratch = getPlaybackFftConvolutionScratch();
    bool scratchReused = false;
    bool planReused = false;
    cufftResult cufftStatus = CUFFT_SUCCESS;
    const auto cudaStatus = scratch.ensure(fftSize, cufftStatus, scratchReused, planReused);
    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }
    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    result.prepared = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.planReused = planReused;
    result.pinnedHostBacked = true;
    result.scratchFftSize = scratch.fftSize;
    result.pinnedHostFftSize = scratch.fftSize;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount)
{
    UzumeGpuFftConvolutionResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    if (samples == nullptr || impulse == nullptr || sampleCount <= 0 || impulseCount <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available || ! probe.cufftAvailable)
        return result;

    const int convolutionLength = sampleCount + impulseCount - 1;
    const int fftSize = nextPowerOfTwo(convolutionLength);
    if (fftSize < convolutionLength)
    {
        result.fallbackReason = "fft-size-overflow";
        return result;
    }

    result.fftSize = fftSize;
    auto& scratch = getPlaybackFftConvolutionScratch();
    result.scratchFftSize = scratch.fftSize;
    result.pinnedHostFftSize = scratch.fftSize;
    if (! scratch.isReadyFor(fftSize))
    {
        result.fallbackReason = scratch.fftSize > 0
            ? "cuda-playback-fft-scratch-too-small"
            : "cuda-playback-fft-scratch-unprepared";
        return result;
    }

    cufftResult cufftStatus = CUFFT_SUCCESS;
    const auto cudaStatus = runFftConvolutionWithScratch(
        scratch,
        samples,
        impulse,
        sampleCount,
        impulseCount,
        fftSize,
        cufftStatus);

    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }

    result.processed = true;
    result.streamBacked = true;
    result.scratchReused = true;
    result.planReused = true;
    result.pinnedHostBacked = true;
    result.scratchFftSize = scratch.fftSize;
    result.pinnedHostFftSize = scratch.fftSize;
    result.maxAbsError = 0.0f;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackStreamingFftConvolution(int maxSamples, int maxImpulseCount)
{
    UzumeGpuFftConvolutionPrepareStatus result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    int fftSize = 0;
    if (! calculateStreamingFftSize(maxSamples, maxImpulseCount, fftSize))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    result.fftSize = fftSize;
    if (! probe.available || ! probe.cufftAvailable)
        return result;

    auto& scratch = getPlaybackStreamingFftConvolutionScratch();
    bool scratchReused = false;
    bool planReused = false;
    cufftResult cufftStatus = CUFFT_SUCCESS;
    const auto cudaStatus = scratch.ensure(maxSamples, maxImpulseCount, fftSize, cufftStatus, scratchReused, planReused);
    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }
    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    result.prepared = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.planReused = planReused;
    result.pinnedHostBacked = true;
    result.scratchFftSize = scratch.fftScratch.fftSize;
    result.pinnedHostFftSize = scratch.fftScratch.fftSize;
    result.fallbackReason = nullptr;
    return result;
}

void resetUzumeGpuPlaybackStreamingFftConvolution()
{
    auto& scratch = getPlaybackStreamingFftConvolutionScratch();
    scratch.resetHistory();
}

UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackStreamingFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount)
{
    UzumeGpuFftConvolutionResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    int fftSize = 0;
    if (samples == nullptr || impulse == nullptr || ! calculateStreamingFftSize(sampleCount, impulseCount, fftSize))
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    result.fftSize = fftSize;
    if (! probe.available || ! probe.cufftAvailable)
        return result;

    auto& scratch = getPlaybackStreamingFftConvolutionScratch();
    result.scratchFftSize = scratch.fftScratch.fftSize;
    result.pinnedHostFftSize = scratch.fftScratch.fftSize;
    if (! scratch.isPreparedFor(sampleCount, impulseCount, fftSize))
    {
        result.fallbackReason = scratch.fftScratch.fftSize > 0
            ? "cuda-playback-streaming-fft-scratch-too-small"
            : "cuda-playback-streaming-fft-scratch-unprepared";
        return result;
    }

    const int historyCount = std::max(0, impulseCount - 1);
    const int maxHistoryCount = static_cast<int>(scratch.history.size());
    const int inputCount = sampleCount + historyCount;
    const int historyStart = maxHistoryCount - historyCount;
    for (int sample = 0; sample < historyCount; ++sample)
        scratch.inputWindow[static_cast<size_t>(sample)] = scratch.history[static_cast<size_t>(historyStart + sample)];
    for (int sample = 0; sample < sampleCount; ++sample)
        scratch.inputWindow[static_cast<size_t>(historyCount + sample)] = samples[sample];

    cufftResult cufftStatus = CUFFT_SUCCESS;
    const auto cudaStatus = runFftConvolutionWindowWithScratch(
        scratch.fftScratch,
        scratch.inputWindow.data(),
        impulse,
        samples,
        inputCount,
        impulseCount,
        historyCount,
        sampleCount,
        scratch.fftScratch.fftSize,
        cufftStatus);

    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }

    if (maxHistoryCount > 0)
    {
        const auto* currentInput = scratch.inputWindow.data() + historyCount;
        if (sampleCount >= maxHistoryCount)
        {
            std::copy(currentInput + sampleCount - maxHistoryCount, currentInput + sampleCount, scratch.history.begin());
        }
        else
        {
            const int oldSamplesToKeep = maxHistoryCount - sampleCount;
            std::move(scratch.history.end() - oldSamplesToKeep, scratch.history.end(), scratch.history.begin());
            std::copy(currentInput, currentInput + sampleCount, scratch.history.begin() + oldSamplesToKeep);
        }
    }

    result.processed = true;
    result.streamBacked = true;
    result.scratchReused = true;
    result.planReused = true;
    result.pinnedHostBacked = true;
    result.scratchFftSize = scratch.fftScratch.fftSize;
    result.pinnedHostFftSize = scratch.fftScratch.fftSize;
    result.maxAbsError = 0.0f;
    result.fallbackReason = nullptr;
    return result;
}

UzumeGpuFftConvolutionResult processUzumeGpuFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount)
{
    UzumeGpuFftConvolutionResult result;
    const auto& probe = cachedUzumeGpuBackendProbe();
    result.available = probe.available;
    result.cufftAvailable = probe.cufftAvailable;
    result.fallbackReason = probe.available ? probe.cufftFallbackReason : probe.fallbackReason;

    if (samples == nullptr || impulse == nullptr || sampleCount <= 0 || impulseCount <= 0)
    {
        result.fallbackReason = "invalid-input";
        return result;
    }

    if (! probe.available || ! probe.cufftAvailable)
        return result;

    const int convolutionLength = sampleCount + impulseCount - 1;
    const int fftSize = nextPowerOfTwo(convolutionLength);
    if (fftSize < convolutionLength)
    {
        result.fallbackReason = "fft-size-overflow";
        return result;
    }

    result.fftSize = fftSize;
    const std::vector<float> original(samples, samples + sampleCount);
    std::vector<float> cpuReference(static_cast<size_t>(sampleCount), 0.0f);

    for (int sample = 0; sample < sampleCount; ++sample)
    {
        float sum = 0.0f;
        for (int tap = 0; tap < impulseCount; ++tap)
        {
            const int source = sample - tap;
            if (source >= 0)
                sum += original[static_cast<size_t>(source)] * impulse[tap];
        }
        cpuReference[static_cast<size_t>(sample)] = sum;
    }

    auto& scratch = getFftConvolutionScratch();
    bool scratchReused = false;
    bool planReused = false;
    cufftResult cufftStatus = CUFFT_SUCCESS;
    auto cudaStatus = scratch.ensure(fftSize, cufftStatus, scratchReused, planReused);
    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }
    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    cufftStatus = CUFFT_SUCCESS;
    cudaStatus = runFftConvolutionWithScratch(
        scratch,
        samples,
        impulse,
        sampleCount,
        impulseCount,
        fftSize,
        cufftStatus);

    if (cufftStatus != CUFFT_SUCCESS)
    {
        result.fallbackReason = classifyCufftError(cufftStatus);
        return result;
    }

    if (cudaStatus != cudaSuccess)
    {
        result.fallbackReason = classifyCudaProcessingError(cudaStatus);
        return result;
    }

    float maxAbsError = 0.0f;
    for (int sample = 0; sample < sampleCount; ++sample)
        maxAbsError = std::max(maxAbsError, std::fabs(samples[sample] - cpuReference[static_cast<size_t>(sample)]));

    result.processed = true;
    result.streamBacked = true;
    result.scratchReused = scratchReused;
    result.planReused = planReused;
    result.pinnedHostBacked = true;
    result.scratchFftSize = scratch.fftSize;
    result.pinnedHostFftSize = scratch.fftSize;
    result.maxAbsError = maxAbsError;
    result.fallbackReason = nullptr;
    return result;
}
} // namespace echo
