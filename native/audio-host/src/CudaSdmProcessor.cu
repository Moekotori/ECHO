#include "CudaSdmProcessor.h"
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
constexpr int maximumSdmChannels = 2;
constexpr int maximumSdmOrder = 8;
constexpr int sdmWarpSize = 32;
constexpr int sdmKernelThreads = maximumSdmChannels * sdmWarpSize;
constexpr uint8_t dsdSilenceByte = 0x69;

__device__ __forceinline__ uint8_t reverseDsdByteForDop(uint8_t byte)
{
    byte = static_cast<uint8_t>(((byte & 0xf0u) >> 4u) | ((byte & 0x0fu) << 4u));
    byte = static_cast<uint8_t>(((byte & 0xccu) >> 2u) | ((byte & 0x33u) << 2u));
    return static_cast<uint8_t>(((byte & 0xaau) >> 1u) | ((byte & 0x55u) << 1u));
}

enum class SdmOutputFormat : int
{
    Dop = 0,
    NativeDsd = 1,
};

struct DeviceSdmConfig
{
    int channels = 0;
    int order = 0;
    int transitionRampFrames = 0;
    uint32_t idleLockFrames = 0;
    double feedbackNumerator[maximumSdmOrder] {};
    double feedbackDenominator[maximumSdmOrder] {};
    double ditherAmplitude = 0.0;
    double inputLimit = 0.0;
    double stabilityLimit = 0.0;
    double profileHeadroomGain = 0.0;
    double idleLockThreshold = 0.0;
    double idleUnlockThreshold = 0.0;
    double feedbackStateLimit = 0.0;
};

struct DeviceSdmState
{
    int transitionRampPosition = 0;
    int gainRampFramesRemaining = 0;
    double currentUserGain = 1.0;
    double targetUserGain = 1.0;
    double errorHistory[maximumSdmChannels * maximumSdmOrder] {};
    double feedbackHistory[maximumSdmChannels * maximumSdmOrder] {};
    uint32_t ditherState[maximumSdmChannels] {};
    uint32_t idleRunFrames[maximumSdmChannels] {};
    uint8_t idleLocked[maximumSdmChannels] {};
    float previousSamples[maximumSdmChannels] {};
    double channelPeakFeedback[maximumSdmChannels] {};
    uint64_t channelStabilityRecoveries[maximumSdmChannels] {};
    uint64_t dopFrameIndex = 0;
};

__device__ double clampDevice(double value, double minimum, double maximum)
{
    return fmin(maximum, fmax(minimum, value));
}

__global__ void processSdmKernel(
    const float* input,
    uint8_t* output,
    DeviceSdmState* state,
    DeviceSdmConfig config,
    int frames,
    SdmOutputFormat outputFormat)
{
    const int lane = static_cast<int>(threadIdx.x) & (sdmWarpSize - 1);
    const int channel = static_cast<int>(threadIdx.x) / sdmWarpSize;
    if (blockIdx.x != 0
        || channel >= config.channels
        || channel >= maximumSdmChannels)
        return;
    constexpr unsigned int warpMask = 0xffffffffu;

    const int historyBase = channel * maximumSdmOrder;
    double errorHistory =
        lane < config.order ? state->errorHistory[historyBase + lane] : 0.0;
    double feedbackHistory =
        lane < config.order ? state->feedbackHistory[historyBase + lane] : 0.0;
    uint32_t ditherState =
        lane == 0 ? state->ditherState[channel] : 0u;
    uint32_t idleRunFrames =
        lane == 0 ? state->idleRunFrames[channel] : 0u;
    uint8_t idleLocked =
        lane == 0 && state->idleLocked[channel] != 0 ? 1 : 0;
    float previousSample =
        lane == 0 ? state->previousSamples[channel] : 0.0f;
    double channelPeakFeedback =
        lane == 0 ? state->channelPeakFeedback[channel] : 0.0;
    uint64_t channelStabilityRecoveries =
        lane == 0 ? state->channelStabilityRecoveries[channel] : 0u;
    double currentUserGain =
        lane == 0 ? state->currentUserGain : 1.0;
    const double targetUserGain = state->targetUserGain;
    int gainRampFramesRemaining =
        lane == 0 ? state->gainRampFramesRemaining : 0;
    int transitionRampPosition =
        lane == 0 ? state->transitionRampPosition : 0;
    const uint64_t initialDopFrameIndex = state->dopFrameIndex;

    for (int frame = 0; frame < frames; ++frame)
    {
        double sample = 0.0;
        double previous = 0.0;
        int emitIdleSilence = 0;
        if (lane == 0)
        {
            if (gainRampFramesRemaining > 0)
            {
                currentUserGain +=
                    (targetUserGain - currentUserGain)
                    / static_cast<double>(gainRampFramesRemaining);
                --gainRampFramesRemaining;
            }
            else
            {
                currentUserGain = targetUserGain;
            }
            const double transitionGain =
                transitionRampPosition < config.transitionRampFrames
                    ? static_cast<double>(++transitionRampPosition)
                        / static_cast<double>(config.transitionRampFrames)
                    : 1.0;
            const double protectedGain =
                config.profileHeadroomGain * currentUserGain * transitionGain;
            const float protectedSample = static_cast<float>(
                static_cast<double>(
                    input[frame * config.channels + channel])
                * protectedGain);
            sample = clampDevice(
                static_cast<double>(protectedSample),
                -config.inputLimit,
                config.inputLimit);
            previous = clampDevice(
                static_cast<double>(previousSample),
                -config.inputLimit,
                config.inputLimit);

            const double magnitude = fabs(sample);
            if (idleLocked != 0)
            {
                if (magnitude < config.idleUnlockThreshold)
                {
                    emitIdleSilence = 1;
                }
                else
                {
                    idleLocked = 0;
                    idleRunFrames = 0;
                    previousSample = 0.0f;
                }
            }
            else if (magnitude <= config.idleLockThreshold)
            {
                idleRunFrames =
                    min(config.idleLockFrames, idleRunFrames + 1u);
                if (idleRunFrames >= config.idleLockFrames)
                {
                    idleLocked = 1;
                    previousSample = 0.0f;
                    emitIdleSilence = 1;
                }
            }
            else
            {
                idleRunFrames = 0;
            }
        }
        sample = __shfl_sync(warpMask, sample, 0);
        previous = __shfl_sync(warpMask, previous, 0);
        emitIdleSilence = __shfl_sync(
            warpMask, emitIdleSilence, 0);
        if (emitIdleSilence != 0)
        {
            errorHistory = 0.0;
            feedbackHistory = 0.0;
        }

        uint8_t firstByte = 0;
        uint8_t secondByte = 0;
        if (emitIdleSilence != 0)
        {
            if (lane == 0)
            {
                firstByte = dsdSilenceByte;
                secondByte = dsdSilenceByte;
            }
        }
        else
        {
            for (int bit = 0; bit < 16; ++bit)
            {
                const double bitSample =
                    previous
                    + (sample - previous)
                        * (static_cast<double>(bit + 1) / 16.0);
                double feedback =
                    lane < config.order
                    ? config.feedbackNumerator[lane] * errorHistory
                        - config.feedbackDenominator[lane] * feedbackHistory
                    : 0.0;
                for (int offset = sdmWarpSize / 2; offset > 0; offset /= 2)
                {
                    feedback +=
                        __shfl_down_sync(warpMask, feedback, offset);
                }
                int resetHistory = 0;
                double quantizationError = 0.0;
                int one = 0;
                if (lane == 0)
                {
                    if (!isfinite(feedback)
                        || fabs(feedback) > config.feedbackStateLimit)
                    {
                        feedback = 0.0;
                        resetHistory = 1;
                        ++channelStabilityRecoveries;
                    }
                    channelPeakFeedback =
                        fmax(channelPeakFeedback, fabs(feedback));
                    if (ditherState == 0)
                        ditherState = 0x9e3779b9u;
                    ditherState = ditherState * 1664525u + 1013904223u;
                    const double dither =
                        (static_cast<double>(ditherState)
                            / 4294967296.0 - 0.5)
                        * config.ditherAmplitude;
                    const double decision = clampDevice(
                        bitSample + dither + feedback,
                        -config.stabilityLimit,
                        config.stabilityLimit);
                    one = decision >= 0.0 ? 1 : 0;
                    quantizationError = clampDevice(
                        decision - (one != 0 ? 1.0 : -1.0),
                        -config.stabilityLimit,
                        config.stabilityLimit);
                    if (one != 0)
                    {
                        if (bit < 8)
                            firstByte = static_cast<uint8_t>(
                                firstByte
                                | static_cast<uint8_t>(1u << bit));
                        else
                            secondByte = static_cast<uint8_t>(
                                secondByte
                                | static_cast<uint8_t>(1u << (bit - 8)));
                    }
                }
                feedback = __shfl_sync(warpMask, feedback, 0);
                quantizationError = __shfl_sync(
                    warpMask, quantizationError, 0);
                resetHistory = __shfl_sync(
                    warpMask, resetHistory, 0);
                if (resetHistory != 0)
                {
                    errorHistory = 0.0;
                    feedbackHistory = 0.0;
                }
                const double previousError =
                    __shfl_up_sync(warpMask, errorHistory, 1);
                const double previousFeedback =
                    __shfl_up_sync(warpMask, feedbackHistory, 1);
                if (lane < config.order)
                {
                    errorHistory =
                        lane == 0 ? quantizationError : previousError;
                    feedbackHistory =
                        lane == 0 ? feedback : previousFeedback;
                }
            }
            if (lane == 0)
                previousSample = static_cast<float>(sample);
        }

        if (lane == 0 && outputFormat == SdmOutputFormat::Dop)
        {
            const uint32_t marker =
                ((initialDopFrameIndex + static_cast<uint64_t>(frame)) & 1u) == 0u
                    ? 0x05u
                    : 0xfau;
            reinterpret_cast<uint32_t*>(output)[
                frame * config.channels + channel] =
                static_cast<uint32_t>(reverseDsdByteForDop(secondByte))
                | (static_cast<uint32_t>(reverseDsdByteForDop(firstByte)) << 8u)
                | (marker << 16u);
        }
        else if (lane == 0)
        {
            const int outputBase = frame * config.channels * 2;
            output[outputBase + channel] = firstByte;
            output[outputBase + config.channels + channel] = secondByte;
        }
    }

    if (lane < config.order)
    {
        state->errorHistory[historyBase + lane] = errorHistory;
        state->feedbackHistory[historyBase + lane] = feedbackHistory;
    }
    if (lane == 0)
    {
        state->ditherState[channel] = ditherState;
        state->idleRunFrames[channel] = idleRunFrames;
        state->idleLocked[channel] = idleLocked;
        state->previousSamples[channel] = previousSample;
        state->channelPeakFeedback[channel] = channelPeakFeedback;
        state->channelStabilityRecoveries[channel] =
            channelStabilityRecoveries;
        if (channel == 0)
        {
            state->transitionRampPosition = transitionRampPosition;
            state->gainRampFramesRemaining = gainRampFramesRemaining;
            state->currentUserGain = currentUserGain;
            state->dopFrameIndex =
                initialDopFrameIndex + static_cast<uint64_t>(frames);
        }
    }
}

std::string cudaFailure(const char* operation, cudaError_t status)
{
    return std::string("native_cuda_sdm_") + operation + ":"
        + cudaGetErrorString(status);
}

bool checked(cudaError_t status, const char* operation, std::string& error)
{
    if (status == cudaSuccess)
        return true;
    error = cudaFailure(operation, status);
    return false;
}

} // namespace

class CudaSdmProcessor::Impl
{
public:
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
        cudaFree(deviceInput);
        cudaFree(deviceOutput);
        cudaFree(deviceState);
        cudaFreeHost(hostInput);
        cudaFreeHost(hostOutput);
        cudaFreeHost(hostState[0]);
        cudaFreeHost(hostState[1]);
        if (stream != nullptr)
            cudaStreamDestroy(stream);
        deviceInput = nullptr;
        deviceOutput = nullptr;
        deviceState = nullptr;
        hostInput = nullptr;
        hostOutput = nullptr;
        hostState[0] = nullptr;
        hostState[1] = nullptr;
        stream = nullptr;
        inputCapacitySamples = 0;
        outputCapacityBytes = 0;
        deviceIndex = -1;
        selectedDeviceName.clear();
        committedStateIndex = 0;
        warmupMilliseconds = 0.0;
        configured = false;
    }

    bool selectDevice(std::string& error)
    {
        CudaDeviceSelection selection;
        if (!CudaDeviceSelector::select(
                "native_cuda_sdm_",
                selection,
                error))
            return false;
        deviceIndex = selection.index;
        selectedDeviceName = std::move(selection.name);
        return true;
    }

    bool stateToDevice(
        const echo::SdmProcessorState& source,
        DeviceSdmState& target,
        std::string& error) const
    {
        const size_t channels = static_cast<size_t>(config.channels);
        const size_t historySize =
            channels * static_cast<size_t>(config.order);
        if (source.errorHistory.size() != historySize
            || source.feedbackHistory.size() != historySize
            || source.ditherState.size() != channels
            || source.idleRunFrames.size() != channels
            || source.idleLocked.size() != channels
            || source.previousSamples.size() != channels)
        {
            error = "native_cuda_sdm_state_shape_mismatch";
            return false;
        }
        target = {};
        target.transitionRampPosition = source.transitionRampPosition;
        target.gainRampFramesRemaining = source.gainRampFramesRemaining;
        target.currentUserGain = source.currentUserGain;
        target.targetUserGain = source.targetUserGain;
        for (int channel = 0; channel < config.channels; ++channel)
        {
            for (int tap = 0; tap < config.order; ++tap)
            {
                const size_t sourceIndex =
                    static_cast<size_t>(channel * config.order + tap);
                const int targetIndex = channel * maximumSdmOrder + tap;
                target.errorHistory[targetIndex] =
                    source.errorHistory[sourceIndex];
                target.feedbackHistory[targetIndex] =
                    source.feedbackHistory[sourceIndex];
            }
            target.ditherState[channel] =
                source.ditherState[static_cast<size_t>(channel)];
            target.idleRunFrames[channel] =
                source.idleRunFrames[static_cast<size_t>(channel)];
            target.idleLocked[channel] =
                source.idleLocked[static_cast<size_t>(channel)];
            target.previousSamples[channel] =
                source.previousSamples[static_cast<size_t>(channel)];
            target.channelPeakFeedback[channel] =
                source.peakFeedbackState;
        }
        target.channelStabilityRecoveries[0] =
            source.stabilityRecoveryCount;
        target.dopFrameIndex = source.dopFrameIndex;
        error.clear();
        return true;
    }

    bool deviceToState(
        const DeviceSdmState& source,
        echo::SdmProcessorState& target) const
    {
        if (!configured)
            return false;
        target = {};
        target.transitionRampPosition = source.transitionRampPosition;
        target.gainRampFramesRemaining = source.gainRampFramesRemaining;
        target.currentUserGain = source.currentUserGain;
        target.targetUserGain = source.targetUserGain;
        target.errorHistory.resize(
            static_cast<size_t>(config.channels * config.order));
        target.feedbackHistory.resize(
            static_cast<size_t>(config.channels * config.order));
        target.ditherState.resize(static_cast<size_t>(config.channels));
        target.idleRunFrames.resize(static_cast<size_t>(config.channels));
        target.idleLocked.resize(static_cast<size_t>(config.channels));
        target.previousSamples.resize(static_cast<size_t>(config.channels));
        for (int channel = 0; channel < config.channels; ++channel)
        {
            for (int tap = 0; tap < config.order; ++tap)
            {
                const size_t targetIndex =
                    static_cast<size_t>(channel * config.order + tap);
                const int sourceIndex = channel * maximumSdmOrder + tap;
                target.errorHistory[targetIndex] =
                    source.errorHistory[sourceIndex];
                target.feedbackHistory[targetIndex] =
                    source.feedbackHistory[sourceIndex];
            }
            target.ditherState[static_cast<size_t>(channel)] =
                source.ditherState[channel];
            target.idleRunFrames[static_cast<size_t>(channel)] =
                source.idleRunFrames[channel];
            target.idleLocked[static_cast<size_t>(channel)] =
                source.idleLocked[channel];
            target.previousSamples[static_cast<size_t>(channel)] =
                source.previousSamples[channel];
            target.peakFeedbackState = std::max(
                target.peakFeedbackState,
                source.channelPeakFeedback[channel]);
            target.stabilityRecoveryCount +=
                source.channelStabilityRecoveries[channel];
        }
        target.dopFrameIndex = source.dopFrameIndex;
        return true;
    }

    bool process(
        const float* interleaved,
        int frames,
        SdmOutputFormat format,
        size_t outputBytes,
        std::string& error)
    {
        if (!configured || interleaved == nullptr || frames <= 0)
        {
            error = "native_cuda_sdm_invalid_input";
            return false;
        }
        const size_t inputSamples =
            static_cast<size_t>(frames)
            * static_cast<size_t>(config.channels);
        if (inputSamples > inputCapacitySamples
            || outputBytes > outputCapacityBytes)
        {
            error = "native_cuda_sdm_block_too_large";
            return false;
        }
        if (!CudaDeviceSelector::activate(
                deviceIndex,
                "native_cuda_sdm_",
                error))
            return false;

        const int pendingStateIndex = 1 - committedStateIndex;
        std::memcpy(
            hostInput,
            interleaved,
            inputSamples * sizeof(float));
        if (!checked(cudaMemcpyAsync(
                         deviceInput,
                         hostInput,
                         inputSamples * sizeof(float),
                         cudaMemcpyHostToDevice,
                         stream),
                     "copy_input_failed",
                     error)
            || !checked(cudaMemcpyAsync(
                            deviceState,
                            hostState[committedStateIndex],
                            sizeof(DeviceSdmState),
                            cudaMemcpyHostToDevice,
                            stream),
                        "copy_state_to_device_failed",
                        error))
            return false;

        processSdmKernel<<<1, sdmKernelThreads, 0, stream>>>(
            deviceInput,
            deviceOutput,
            deviceState,
            config,
            frames,
            format);
        if (!checked(cudaPeekAtLastError(), "kernel_launch_failed", error)
            || !checked(cudaMemcpyAsync(
                            hostOutput,
                            deviceOutput,
                            outputBytes,
                            cudaMemcpyDeviceToHost,
                            stream),
                        "copy_output_failed",
                        error)
            || !checked(cudaMemcpyAsync(
                            hostState[pendingStateIndex],
                            deviceState,
                            sizeof(DeviceSdmState),
                            cudaMemcpyDeviceToHost,
                            stream),
                        "copy_state_from_device_failed",
                        error)
            || !checked(cudaStreamSynchronize(stream), "stream_sync_failed", error))
            return false;

        committedStateIndex = pendingStateIndex;
        error.clear();
        return true;
    }

    DeviceSdmConfig config {};
    int deviceIndex = -1;
    cudaStream_t stream = nullptr;
    float* deviceInput = nullptr;
    uint8_t* deviceOutput = nullptr;
    DeviceSdmState* deviceState = nullptr;
    float* hostInput = nullptr;
    uint8_t* hostOutput = nullptr;
    DeviceSdmState* hostState[2] { nullptr, nullptr };
    size_t inputCapacitySamples = 0;
    size_t outputCapacityBytes = 0;
    int committedStateIndex = 0;
    std::string selectedDeviceName;
    double warmupMilliseconds = 0.0;
    bool configured = false;
};

CudaSdmProcessor::CudaSdmProcessor() : impl_(std::make_unique<Impl>()) {}
CudaSdmProcessor::~CudaSdmProcessor() = default;
CudaSdmProcessor::CudaSdmProcessor(CudaSdmProcessor&&) noexcept = default;
CudaSdmProcessor& CudaSdmProcessor::operator=(CudaSdmProcessor&&) noexcept = default;

void CudaSdmProcessor::release()
{
    impl_->release();
}

bool CudaSdmProcessor::configure(
    const echo::SdmProcessorConfig& config,
    const echo::SdmProcessorState& initialState,
    int maximumInputFrames,
    std::string& error)
{
    impl_->release();
    const int order =
        static_cast<int>(config.feedbackNumeratorCoefficients.size());
    if (config.channels <= 0 || config.channels > maximumSdmChannels
        || order <= 0 || order > maximumSdmOrder
        || config.feedbackDenominatorCoefficients.size()
            != config.feedbackNumeratorCoefficients.size()
        || maximumInputFrames <= 0)
    {
        error = "native_cuda_sdm_invalid_configuration";
        return false;
    }
    if (!impl_->selectDevice(error)
        || !checked(cudaStreamCreateWithFlags(
                        &impl_->stream, cudaStreamNonBlocking),
                    "stream_create_failed",
                    error))
    {
        impl_->release();
        return false;
    }

    impl_->config.channels = config.channels;
    impl_->config.order = order;
    impl_->config.transitionRampFrames = config.transitionRampFrames;
    impl_->config.idleLockFrames = config.idleLockFrames;
    impl_->config.ditherAmplitude = config.ditherAmplitude;
    impl_->config.inputLimit = config.inputLimit;
    impl_->config.stabilityLimit = config.stabilityLimit;
    impl_->config.profileHeadroomGain = config.profileHeadroomGain;
    impl_->config.idleLockThreshold = config.idleLockThreshold;
    impl_->config.idleUnlockThreshold = config.idleUnlockThreshold;
    impl_->config.feedbackStateLimit = config.feedbackStateLimit;
    for (int tap = 0; tap < order; ++tap)
    {
        impl_->config.feedbackNumerator[tap] =
            config.feedbackNumeratorCoefficients[static_cast<size_t>(tap)];
        impl_->config.feedbackDenominator[tap] =
            config.feedbackDenominatorCoefficients[static_cast<size_t>(tap)];
    }

    impl_->inputCapacitySamples =
        static_cast<size_t>(maximumInputFrames)
        * static_cast<size_t>(config.channels);
    impl_->outputCapacityBytes =
        impl_->inputCapacitySamples * sizeof(uint32_t);
    if (!checked(cudaMalloc(
                     &impl_->deviceInput,
                     impl_->inputCapacitySamples * sizeof(float)),
                 "allocate_input_failed",
                 error)
        || !checked(cudaMalloc(
                        &impl_->deviceOutput,
                        impl_->outputCapacityBytes),
                    "allocate_output_failed",
                    error)
        || !checked(cudaMalloc(
                        &impl_->deviceState,
                        sizeof(DeviceSdmState)),
                    "allocate_state_failed",
                    error)
        || !checked(cudaMallocHost(
                        &impl_->hostInput,
                        impl_->inputCapacitySamples * sizeof(float)),
                    "allocate_pinned_input_failed",
                    error)
        || !checked(cudaMallocHost(
                        &impl_->hostOutput,
                        impl_->outputCapacityBytes),
                    "allocate_pinned_output_failed",
                    error)
        || !checked(cudaMallocHost(
                        &impl_->hostState[0],
                        sizeof(DeviceSdmState)),
                    "allocate_state_snapshot_a_failed",
                    error)
        || !checked(cudaMallocHost(
                        &impl_->hostState[1],
                        sizeof(DeviceSdmState)),
                    "allocate_state_snapshot_b_failed",
                    error))
    {
        impl_->release();
        return false;
    }

    impl_->configured = true;
    if (!reset(initialState, error))
    {
        impl_->release();
        return false;
    }
    const int warmupFrames = std::min(maximumInputFrames, 64);
    std::vector<float> warmupInput(
        static_cast<size_t>(warmupFrames * config.channels),
        0.0f);
    std::vector<uint32_t> warmupOutput;
    const auto started = std::chrono::steady_clock::now();
    if (!processDop(
            warmupInput.data(), warmupFrames, warmupOutput, error))
    {
        error = error.empty()
            ? "native_cuda_sdm_warmup_failed"
            : "native_cuda_sdm_warmup_failed:" + error;
        impl_->release();
        return false;
    }
    const auto finished = std::chrono::steady_clock::now();
    const double warmupMilliseconds =
        std::chrono::duration<double, std::milli>(finished - started).count();
    if (!reset(initialState, error))
    {
        impl_->release();
        return false;
    }
    impl_->warmupMilliseconds = warmupMilliseconds;
    error.clear();
    return true;
}

bool CudaSdmProcessor::reset(
    const echo::SdmProcessorState& state,
    std::string& error)
{
    if (!impl_->configured)
    {
        error = "native_cuda_sdm_not_configured";
        return false;
    }
    DeviceSdmState converted {};
    if (!impl_->stateToDevice(state, converted, error))
        return false;
    *impl_->hostState[0] = converted;
    *impl_->hostState[1] = converted;
    impl_->committedStateIndex = 0;
    error.clear();
    return true;
}

void CudaSdmProcessor::setTargetGain(double gain)
{
    if (!impl_->configured)
        return;
    const double normalized =
        std::max(0.0, std::min(1.0, std::isfinite(gain) ? gain : 1.0));
    auto& state = *impl_->hostState[impl_->committedStateIndex];
    if (std::abs(normalized - state.targetUserGain)
        <= std::numeric_limits<double>::epsilon())
        return;
    state.targetUserGain = normalized;
    state.gainRampFramesRemaining = impl_->config.transitionRampFrames;
}

bool CudaSdmProcessor::processDop(
    const float* interleaved,
    int frames,
    std::vector<uint32_t>& output,
    std::string& error)
{
    output.clear();
    const size_t outputSamples =
        static_cast<size_t>(std::max(0, frames))
        * static_cast<size_t>(impl_->config.channels);
    const size_t outputBytes = outputSamples * sizeof(uint32_t);
    if (!impl_->process(
            interleaved,
            frames,
            SdmOutputFormat::Dop,
            outputBytes,
            error))
        return false;
    const auto* data = reinterpret_cast<const uint32_t*>(impl_->hostOutput);
    output.assign(data, data + outputSamples);
    return true;
}

bool CudaSdmProcessor::processNativeDsd(
    const float* interleaved,
    int frames,
    std::vector<uint8_t>& output,
    std::string& error)
{
    output.clear();
    const size_t outputBytes =
        static_cast<size_t>(std::max(0, frames))
        * static_cast<size_t>(impl_->config.channels)
        * 2u;
    if (!impl_->process(
            interleaved,
            frames,
            SdmOutputFormat::NativeDsd,
            outputBytes,
            error))
        return false;
    output.assign(impl_->hostOutput, impl_->hostOutput + outputBytes);
    return true;
}

bool CudaSdmProcessor::copyLatestState(
    echo::SdmProcessorState& state) const
{
    if (!impl_->configured)
        return false;
    return impl_->deviceToState(
        *impl_->hostState[impl_->committedStateIndex],
        state);
}

bool CudaSdmProcessor::active() const noexcept
{
    return impl_->configured;
}

std::string CudaSdmProcessor::deviceName() const
{
    return impl_->selectedDeviceName;
}

double CudaSdmProcessor::warmupMilliseconds() const noexcept
{
    return impl_->warmupMilliseconds;
}

double CudaSdmProcessor::peakFeedbackState() const noexcept
{
    if (!impl_->configured)
        return 0.0;
    const auto& state = *impl_->hostState[impl_->committedStateIndex];
    double peak = 0.0;
    for (int channel = 0; channel < impl_->config.channels; ++channel)
        peak = std::max(peak, state.channelPeakFeedback[channel]);
    return peak;
}

uint64_t CudaSdmProcessor::stabilityRecoveryCount() const noexcept
{
    if (!impl_->configured)
        return 0;
    const auto& state = *impl_->hostState[impl_->committedStateIndex];
    uint64_t count = 0;
    for (int channel = 0; channel < impl_->config.channels; ++channel)
        count += state.channelStabilityRecoveries[channel];
    return count;
}
