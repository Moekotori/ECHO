#include "CudaFirProcessor.h"
#include "CudaDeviceSelection.h"

#include <cuda_runtime.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <limits>
#include <utility>

namespace
{
constexpr float firNumericalZeroThreshold = 1.0e-12f;
constexpr int firBlockSize = 256;

__global__ __launch_bounds__(firBlockSize) void processPolyphaseFirKernel(
    const float* __restrict__ input,
    const float* __restrict__ history,
    const float* __restrict__ coefficients,
    const int* __restrict__ delays,
    const int* __restrict__ phaseOffsets,
    float* __restrict__ output,
    int inputFrames,
    int channels,
    int upsampleFactor,
    int historyFrames)
{
    const int sampleIndex = blockIdx.x * blockDim.x + threadIdx.x;
    const int outputFrames = inputFrames * upsampleFactor;
    const int outputSamples = outputFrames * channels;
    if (sampleIndex >= outputSamples)
        return;

    const int channel = sampleIndex % channels;
    const int outputFrame = sampleIndex / channels;
    const int inputFrame = outputFrame / upsampleFactor;
    const int phase = outputFrame % upsampleFactor;
    const int combinedFrame = historyFrames + inputFrame;
    float sum = 0.0f;

    for (int tap = phaseOffsets[phase]; tap < phaseOffsets[phase + 1]; ++tap)
    {
        const int sourceFrame = combinedFrame - delays[tap];
        const float source = sourceFrame < historyFrames
            ? history[sourceFrame * channels + channel]
            : input[(sourceFrame - historyFrames) * channels + channel];
        sum = fmaf(coefficients[tap], source, sum);
    }

    output[sampleIndex] = sum;
}

std::string cudaFailure(const char* operation, cudaError_t status)
{
    return std::string("native_cuda_") + operation + ":" + cudaGetErrorString(status);
}

bool checked(cudaError_t status, const char* operation, std::string& error)
{
    if (status == cudaSuccess)
        return true;
    error = cudaFailure(operation, status);
    return false;
}

} // namespace

class CudaFirProcessor::Impl
{
public:
    struct DeviceStage
    {
        int upsampleFactor = 1;
        int historyFrames = 0;
        int tapEntryCount = 0;
        float* coefficients = nullptr;
        int* delays = nullptr;
        int* phaseOffsets = nullptr;
        float* history = nullptr;
        float* nextHistory = nullptr;
        float* hostHistory[2] { nullptr, nullptr };
    };

    ~Impl()
    {
        release();
    }

    void release()
    {
        if (deviceIndex >= 0)
            cudaSetDevice(deviceIndex);
        if (stream != nullptr)
            cudaStreamSynchronize(stream);
        for (auto& stage : stages)
        {
            cudaFree(stage.coefficients);
            cudaFree(stage.delays);
            cudaFree(stage.phaseOffsets);
            cudaFree(stage.history);
            cudaFree(stage.nextHistory);
            cudaFreeHost(stage.hostHistory[0]);
            cudaFreeHost(stage.hostHistory[1]);
        }
        stages.clear();
        cudaFree(bufferA);
        cudaFree(bufferB);
        cudaFreeHost(hostInput);
        cudaFreeHost(hostOutput);
        bufferA = nullptr;
        bufferB = nullptr;
        hostInput = nullptr;
        hostOutput = nullptr;
        bufferCapacitySamples = 0;
        if (stream != nullptr)
            cudaStreamDestroy(stream);
        stream = nullptr;
        channels = 0;
        maximumOutputFactor = 1;
        deviceIndex = -1;
        selectedDeviceName.clear();
        committedHistoryIndex = 0;
        warmupMilliseconds = 0.0;
        configured = false;
    }

    bool selectDevice(std::string& error)
    {
        CudaDeviceSelection selection;
        if (!CudaDeviceSelector::select(
                "native_cuda_",
                selection,
                error))
            return false;
        deviceIndex = selection.index;
        selectedDeviceName = std::move(selection.name);
        return true;
    }

    bool ensureCapacity(size_t requiredSamples, std::string& error)
    {
        if (requiredSamples <= bufferCapacitySamples)
            return true;
        if (requiredSamples > static_cast<size_t>(std::numeric_limits<int>::max()))
        {
            error = "native_cuda_fir_block_too_large";
            return false;
        }

        float* nextBufferA = nullptr;
        float* nextBufferB = nullptr;
        float* nextHostInput = nullptr;
        float* nextHostOutput = nullptr;
        const size_t bytes = requiredSamples * sizeof(float);
        if (!checked(cudaMalloc(&nextBufferA, bytes), "allocate_buffer_a_failed", error)
            || !checked(cudaMalloc(&nextBufferB, bytes), "allocate_buffer_b_failed", error)
            || !checked(cudaMallocHost(&nextHostInput, bytes), "allocate_pinned_input_failed", error)
            || !checked(cudaMallocHost(&nextHostOutput, bytes), "allocate_pinned_output_failed", error))
        {
            cudaFree(nextBufferA);
            cudaFree(nextBufferB);
            cudaFreeHost(nextHostInput);
            cudaFreeHost(nextHostOutput);
            return false;
        }

        cudaFree(bufferA);
        cudaFree(bufferB);
        cudaFreeHost(hostInput);
        cudaFreeHost(hostOutput);
        bufferA = nextBufferA;
        bufferB = nextBufferB;
        hostInput = nextHostInput;
        hostOutput = nextHostOutput;
        bufferCapacitySamples = requiredSamples;
        return true;
    }

    int channels = 0;
    int maximumOutputFactor = 1;
    int deviceIndex = -1;
    cudaStream_t stream = nullptr;
    std::vector<DeviceStage> stages;
    float* bufferA = nullptr;
    float* bufferB = nullptr;
    float* hostInput = nullptr;
    float* hostOutput = nullptr;
    size_t bufferCapacitySamples = 0;
    std::string selectedDeviceName;
    int committedHistoryIndex = 0;
    double warmupMilliseconds = 0.0;
    bool configured = false;
};

CudaFirProcessor::CudaFirProcessor() : impl_(std::make_unique<Impl>()) {}
CudaFirProcessor::~CudaFirProcessor() = default;
CudaFirProcessor::CudaFirProcessor(CudaFirProcessor&&) noexcept = default;
CudaFirProcessor& CudaFirProcessor::operator=(CudaFirProcessor&&) noexcept = default;

void CudaFirProcessor::release()
{
    impl_->release();
}

bool CudaFirProcessor::configure(
    int channels,
    const std::vector<echo::EchoSrcStageConfig>& stages,
    int maximumInputFrames,
    std::string& error)
{
    impl_->release();
    if (channels <= 0 || stages.empty() || maximumInputFrames <= 0)
    {
        error = "native_cuda_invalid_fir_configuration";
        return false;
    }
    if (!impl_->selectDevice(error))
    {
        impl_->release();
        return false;
    }
    if (!checked(cudaStreamCreateWithFlags(&impl_->stream, cudaStreamNonBlocking),
                 "stream_create_failed", error))
    {
        impl_->release();
        return false;
    }

    impl_->channels = channels;
    impl_->maximumOutputFactor = 1;
    impl_->stages.reserve(stages.size());

    for (const auto& config : stages)
    {
        if (config.upsampleFactor != 1 && config.upsampleFactor != 2
            && config.upsampleFactor != 4 && config.upsampleFactor != 8)
        {
            error = "native_cuda_invalid_upsample_factor";
            impl_->release();
            return false;
        }
        if (config.taps.empty())
        {
            error = "native_cuda_empty_taps";
            impl_->release();
            return false;
        }
        if (impl_->maximumOutputFactor
            > std::numeric_limits<int>::max() / config.upsampleFactor)
        {
            error = "native_cuda_output_factor_overflow";
            impl_->release();
            return false;
        }
        impl_->maximumOutputFactor *= config.upsampleFactor;

        Impl::DeviceStage stage;
        stage.upsampleFactor = config.upsampleFactor;
        stage.historyFrames =
            static_cast<int>((config.taps.size() - 1) / static_cast<size_t>(config.upsampleFactor));

        std::vector<float> coefficients;
        std::vector<int> delays;
        std::vector<int> phaseOffsets(static_cast<size_t>(config.upsampleFactor + 1), 0);
        const float interpolationGain = static_cast<float>(config.upsampleFactor);
        for (int phase = 0; phase < config.upsampleFactor; ++phase)
        {
            phaseOffsets[static_cast<size_t>(phase)] = static_cast<int>(coefficients.size());
            for (size_t tap = static_cast<size_t>(phase);
                 tap < config.taps.size();
                 tap += static_cast<size_t>(config.upsampleFactor))
            {
                const float coefficient = config.taps[tap];
                if (std::abs(coefficient) <= firNumericalZeroThreshold)
                    continue;
                coefficients.push_back(coefficient * interpolationGain);
                delays.push_back(static_cast<int>(
                    tap / static_cast<size_t>(config.upsampleFactor)));
            }
        }
        phaseOffsets.back() = static_cast<int>(coefficients.size());
        stage.tapEntryCount = static_cast<int>(coefficients.size());

        const size_t coefficientBytes = std::max<size_t>(1, coefficients.size()) * sizeof(float);
        const size_t delayBytes = std::max<size_t>(1, delays.size()) * sizeof(int);
        const size_t offsetBytes = phaseOffsets.size() * sizeof(int);
        const size_t historySamples =
            static_cast<size_t>(stage.historyFrames) * static_cast<size_t>(channels);
        const size_t historyBytes = std::max<size_t>(1, historySamples) * sizeof(float);

        if (!checked(cudaMalloc(&stage.coefficients, coefficientBytes),
                     "allocate_coefficients_failed", error)
            || !checked(cudaMalloc(&stage.delays, delayBytes),
                        "allocate_delays_failed", error)
            || !checked(cudaMalloc(&stage.phaseOffsets, offsetBytes),
                        "allocate_phase_offsets_failed", error)
            || !checked(cudaMalloc(&stage.history, historyBytes),
                        "allocate_history_failed", error)
            || !checked(cudaMalloc(&stage.nextHistory, historyBytes),
                        "allocate_next_history_failed", error)
            || (historySamples > 0
                && (!checked(cudaMallocHost(&stage.hostHistory[0], historyBytes),
                             "allocate_history_snapshot_a_failed", error)
                    || !checked(cudaMallocHost(&stage.hostHistory[1], historyBytes),
                                "allocate_history_snapshot_b_failed", error))))
        {
            cudaFree(stage.coefficients);
            cudaFree(stage.delays);
            cudaFree(stage.phaseOffsets);
            cudaFree(stage.history);
            cudaFree(stage.nextHistory);
            cudaFreeHost(stage.hostHistory[0]);
            cudaFreeHost(stage.hostHistory[1]);
            impl_->release();
            return false;
        }
        if (historySamples > 0)
        {
            std::memset(stage.hostHistory[0], 0, historyBytes);
            std::memset(stage.hostHistory[1], 0, historyBytes);
        }
        if ((!coefficients.empty()
             && !checked(cudaMemcpy(stage.coefficients, coefficients.data(),
                                    coefficients.size() * sizeof(float), cudaMemcpyHostToDevice),
                         "copy_coefficients_failed", error))
            || (!delays.empty()
                && !checked(cudaMemcpy(stage.delays, delays.data(),
                                       delays.size() * sizeof(int), cudaMemcpyHostToDevice),
                            "copy_delays_failed", error))
            || !checked(cudaMemcpy(stage.phaseOffsets, phaseOffsets.data(),
                                   offsetBytes, cudaMemcpyHostToDevice),
                        "copy_phase_offsets_failed", error)
            || !checked(cudaMemset(stage.history, 0, historyBytes),
                        "clear_history_failed", error)
            || !checked(cudaMemset(stage.nextHistory, 0, historyBytes),
                        "clear_next_history_failed", error))
        {
            cudaFree(stage.coefficients);
            cudaFree(stage.delays);
            cudaFree(stage.phaseOffsets);
            cudaFree(stage.history);
            cudaFree(stage.nextHistory);
            cudaFreeHost(stage.hostHistory[0]);
            cudaFreeHost(stage.hostHistory[1]);
            impl_->release();
            return false;
        }
        impl_->stages.push_back(stage);
    }

    const size_t maximumSamples =
        static_cast<size_t>(maximumInputFrames)
        * static_cast<size_t>(channels)
        * static_cast<size_t>(impl_->maximumOutputFactor);
    if (!impl_->ensureCapacity(maximumSamples, error))
    {
        impl_->release();
        return false;
    }

    impl_->configured = true;
    const int warmupFrames = std::min(maximumInputFrames, 64);
    std::vector<float> warmupInput(
        static_cast<size_t>(warmupFrames) * static_cast<size_t>(channels),
        0.0f);
    std::vector<float> warmupOutput;
    const auto warmupStarted = std::chrono::steady_clock::now();
    if (!process(warmupInput.data(), warmupFrames, warmupOutput, error))
    {
        error = error.empty()
            ? "native_cuda_fir_warmup_failed"
            : "native_cuda_fir_warmup_failed:" + error;
        impl_->release();
        return false;
    }
    const auto warmupFinished = std::chrono::steady_clock::now();
    const double warmupMilliseconds =
        std::chrono::duration<double, std::milli>(warmupFinished - warmupStarted).count();
    reset();
    impl_->warmupMilliseconds = warmupMilliseconds;
    error.clear();
    return true;
}

void CudaFirProcessor::reset()
{
    if (!impl_->configured || impl_->deviceIndex < 0)
        return;
    cudaSetDevice(impl_->deviceIndex);
    for (auto& stage : impl_->stages)
    {
        const size_t historySamples =
            static_cast<size_t>(stage.historyFrames)
            * static_cast<size_t>(impl_->channels);
        const size_t historyBytes =
            std::max<size_t>(1, historySamples)
            * sizeof(float);
        cudaMemsetAsync(stage.history, 0, historyBytes, impl_->stream);
        cudaMemsetAsync(stage.nextHistory, 0, historyBytes, impl_->stream);
        if (historySamples > 0)
        {
            std::memset(stage.hostHistory[0], 0, historyBytes);
            std::memset(stage.hostHistory[1], 0, historyBytes);
        }
    }
    cudaStreamSynchronize(impl_->stream);
    impl_->committedHistoryIndex = 0;
}

bool CudaFirProcessor::process(
    const float* interleaved,
    int frames,
    std::vector<float>& output,
    std::string& error)
{
    output.clear();
    if (!impl_->configured)
    {
        error = "native_cuda_fir_not_configured";
        return false;
    }
    if (interleaved == nullptr || frames <= 0)
    {
        if (frames == 0)
        {
            error.clear();
            return true;
        }
        error = "native_cuda_invalid_fir_input";
        return false;
    }
    if (!CudaDeviceSelector::activate(
            impl_->deviceIndex,
            "native_cuda_",
            error))
        return false;

    const size_t inputSamples =
        static_cast<size_t>(frames) * static_cast<size_t>(impl_->channels);
    const size_t outputSamples =
        inputSamples * static_cast<size_t>(impl_->maximumOutputFactor);
    if (!impl_->ensureCapacity(outputSamples, error))
        return false;

    std::memcpy(impl_->hostInput, interleaved, inputSamples * sizeof(float));
    if (!checked(cudaMemcpyAsync(
                     impl_->bufferA,
                     impl_->hostInput,
                     inputSamples * sizeof(float),
                     cudaMemcpyHostToDevice,
                     impl_->stream),
                 "copy_input_failed", error))
        return false;

    float* input = impl_->bufferA;
    float* nextOutput = impl_->bufferB;
    int inputFrames = frames;
    const int pendingHistoryIndex = 1 - impl_->committedHistoryIndex;
    for (auto& stage : impl_->stages)
    {
        const int outputFrames = inputFrames * stage.upsampleFactor;
        const int stageOutputSamples = outputFrames * impl_->channels;
        const int outputBlocks = (stageOutputSamples + firBlockSize - 1) / firBlockSize;
        processPolyphaseFirKernel<<<outputBlocks, firBlockSize, 0, impl_->stream>>>(
            input,
            stage.history,
            stage.coefficients,
            stage.delays,
            stage.phaseOffsets,
            nextOutput,
            inputFrames,
            impl_->channels,
            stage.upsampleFactor,
            stage.historyFrames);
        if (!checked(cudaPeekAtLastError(), "fir_kernel_launch_failed", error))
            return false;

        const int historySamples = stage.historyFrames * impl_->channels;
        if (historySamples > 0)
        {
            const size_t frameBytes =
                static_cast<size_t>(impl_->channels) * sizeof(float);
            if (inputFrames >= stage.historyFrames)
            {
                const float* historyInput =
                    input
                    + static_cast<size_t>(
                        inputFrames - stage.historyFrames)
                        * static_cast<size_t>(impl_->channels);
                if (!checked(cudaMemcpyAsync(
                                 stage.nextHistory,
                                 historyInput,
                                 static_cast<size_t>(stage.historyFrames)
                                     * frameBytes,
                                 cudaMemcpyDeviceToDevice,
                                 impl_->stream),
                             "copy_history_tail_failed",
                             error))
                    return false;
            }
            else
            {
                const int retainedFrames =
                    stage.historyFrames - inputFrames;
                const size_t retainedBytes =
                    static_cast<size_t>(retainedFrames) * frameBytes;
                const size_t inputBytes =
                    static_cast<size_t>(inputFrames) * frameBytes;
                if (!checked(cudaMemcpyAsync(
                                 stage.nextHistory,
                                 stage.history
                                     + static_cast<size_t>(inputFrames)
                                         * static_cast<size_t>(
                                             impl_->channels),
                                 retainedBytes,
                                 cudaMemcpyDeviceToDevice,
                                 impl_->stream),
                             "copy_retained_history_failed",
                             error)
                    || !checked(cudaMemcpyAsync(
                                    stage.nextHistory
                                        + static_cast<size_t>(
                                            retainedFrames)
                                            * static_cast<size_t>(
                                                impl_->channels),
                                    input,
                                    inputBytes,
                                    cudaMemcpyDeviceToDevice,
                                    impl_->stream),
                                "append_history_input_failed",
                                error))
                    return false;
            }
            std::swap(stage.history, stage.nextHistory);
        }

        std::swap(input, nextOutput);
        inputFrames = outputFrames;
    }

    for (const auto& stage : impl_->stages)
    {
        const size_t historySamples =
            static_cast<size_t>(stage.historyFrames)
            * static_cast<size_t>(impl_->channels);
        if (historySamples > 0
            && !checked(cudaMemcpyAsync(
                            stage.hostHistory[pendingHistoryIndex],
                            stage.history,
                            historySamples * sizeof(float),
                            cudaMemcpyDeviceToHost,
                            impl_->stream),
                        "copy_history_snapshot_failed", error))
            return false;
    }

    if (!checked(cudaMemcpyAsync(
                     impl_->hostOutput,
                     input,
                     outputSamples * sizeof(float),
                     cudaMemcpyDeviceToHost,
                     impl_->stream),
                 "copy_output_failed", error)
        || !checked(cudaStreamSynchronize(impl_->stream), "stream_sync_failed", error))
        return false;

    impl_->committedHistoryIndex = pendingHistoryIndex;
    output.assign(impl_->hostOutput, impl_->hostOutput + outputSamples);
    error.clear();
    return true;
}

bool CudaFirProcessor::copyLatestHistory(
    std::vector<std::vector<float>>& histories) const
{
    histories.clear();
    if (!impl_->configured)
        return false;
    histories.reserve(impl_->stages.size());
    for (const auto& stage : impl_->stages)
    {
        const size_t historySamples =
            static_cast<size_t>(stage.historyFrames)
            * static_cast<size_t>(impl_->channels);
        if (historySamples == 0)
        {
            histories.emplace_back();
            continue;
        }
        const float* snapshot = stage.hostHistory[impl_->committedHistoryIndex];
        if (snapshot == nullptr)
        {
            histories.clear();
            return false;
        }
        histories.emplace_back(snapshot, snapshot + historySamples);
    }
    return true;
}

bool CudaFirProcessor::restoreHistory(
    const std::vector<std::vector<float>>& histories,
    std::string& error)
{
    if (!impl_->configured || histories.size() != impl_->stages.size())
    {
        error = "native_cuda_fir_history_shape_mismatch";
        return false;
    }
    if (!CudaDeviceSelector::activate(
            impl_->deviceIndex,
            "native_cuda_",
            error))
        return false;

    for (size_t index = 0; index < impl_->stages.size(); ++index)
    {
        auto& stage = impl_->stages[index];
        const size_t historySamples =
            static_cast<size_t>(stage.historyFrames)
            * static_cast<size_t>(impl_->channels);
        if (histories[index].size() != historySamples)
        {
            error = "native_cuda_fir_history_shape_mismatch";
            return false;
        }
        if (historySamples == 0)
            continue;

        const size_t historyBytes = historySamples * sizeof(float);
        std::memcpy(
            stage.hostHistory[0],
            histories[index].data(),
            historyBytes);
        std::memcpy(
            stage.hostHistory[1],
            histories[index].data(),
            historyBytes);
        if (!checked(cudaMemcpyAsync(
                         stage.history,
                         histories[index].data(),
                         historyBytes,
                         cudaMemcpyHostToDevice,
                         impl_->stream),
                     "restore_history_failed",
                     error)
            || !checked(cudaMemcpyAsync(
                            stage.nextHistory,
                            histories[index].data(),
                            historyBytes,
                            cudaMemcpyHostToDevice,
                            impl_->stream),
                        "restore_next_history_failed",
                        error))
            return false;
    }
    if (!checked(
            cudaStreamSynchronize(impl_->stream),
            "restore_history_sync_failed",
            error))
        return false;
    impl_->committedHistoryIndex = 0;
    error.clear();
    return true;
}

bool CudaFirProcessor::active() const noexcept
{
    return impl_->configured;
}

std::string CudaFirProcessor::deviceName() const
{
    return impl_->selectedDeviceName;
}

double CudaFirProcessor::warmupMilliseconds() const noexcept
{
    return impl_->warmupMilliseconds;
}

bool CudaFirProcessor::builtWithCuda() noexcept
{
    return true;
}
