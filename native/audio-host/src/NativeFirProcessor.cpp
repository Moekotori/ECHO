#include "NativeFirProcessor.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>
#include <utility>

bool NativeFirProcessor::configure(
    int channels,
    const std::vector<echo::EchoSrcStageConfig>& stages,
    bool requestCuda,
    int maximumInputFrames,
    std::string& error)
{
    echo::EchoSrcProcessor nextCpu;
    if (!nextCpu.configure(channels, stages, error))
        return false;

    cpu_ = std::move(nextCpu);
    channels_ = std::max(1, channels);
    maximumInputFrames_ = std::max(1, maximumInputFrames);
    outputFactor_ = 1;
    size_t impulseEndFrame = 0;
    double nominalLatencyFrames = 0.0;
    for (const auto& stage : stages)
    {
        const auto factor = static_cast<size_t>(stage.upsampleFactor);
        impulseEndFrame =
            impulseEndFrame * factor + (stage.taps.size() - 1);
        outputFactor_ *= stage.upsampleFactor;

        bool symmetric = true;
        float peakMagnitude = 0.0f;
        size_t peakIndex = 0;
        for (size_t tap = 0; tap < stage.taps.size(); ++tap)
        {
            const float magnitude = std::abs(stage.taps[tap]);
            if (magnitude > peakMagnitude)
            {
                peakMagnitude = magnitude;
                peakIndex = tap;
            }
            const size_t mirrored = stage.taps.size() - 1 - tap;
            const float tolerance = std::max(
                1.0e-7f,
                std::max(
                    std::abs(stage.taps[tap]),
                    std::abs(stage.taps[mirrored]))
                    * 1.0e-5f);
            if (std::abs(
                    stage.taps[tap]
                    - stage.taps[mirrored])
                > tolerance)
                symmetric = false;
        }
        const double stageLatency = symmetric
            ? static_cast<double>(stage.taps.size() - 1) * 0.5
            : static_cast<double>(peakIndex);
        nominalLatencyFrames =
            nominalLatencyFrames
                * static_cast<double>(stage.upsampleFactor)
            + stageLatency;
    }
    const size_t emittedSupportFrames =
        static_cast<size_t>(outputFactor_) - 1;
    tailOutputFrames_ = stages.empty()
        || impulseEndFrame <= emittedSupportFrames
        ? 0
        : impulseEndFrame - emittedSupportFrames;
    prerollInputFrames_ = static_cast<int>(
        (tailOutputFrames_ + static_cast<size_t>(outputFactor_) - 1)
        / static_cast<size_t>(outputFactor_));
    nominalLatencyOutputFrames_ = static_cast<int>(
        std::llround(nominalLatencyFrames));
    backend_ = Backend::Cpu;
    fallbackReason_.clear();
    deviceName_.clear();
    warmupMilliseconds_ = 0.0;

    if (requestCuda && !stages.empty())
    {
        std::string cudaError;
        if (cuda_.configure(channels, stages, maximumInputFrames, cudaError))
        {
            const int admissionFrames =
                std::min(std::max(1, maximumInputFrames), 512);
            std::vector<float> admissionInput(
                static_cast<size_t>(admissionFrames * channels_),
                0.0f);
            for (int frame = 0; frame < admissionFrames; ++frame)
            {
                for (int channel = 0; channel < channels_; ++channel)
                {
                    const double phase =
                        static_cast<double>(frame)
                        * (0.037 + static_cast<double>(channel) * 0.011);
                    admissionInput[
                        static_cast<size_t>(frame * channels_ + channel)] =
                        static_cast<float>(0.31 * std::sin(phase));
                }
            }

            double cpuMilliseconds =
                std::numeric_limits<double>::infinity();
            double cudaMilliseconds =
                std::numeric_limits<double>::infinity();
            bool cudaAdmissionCompleted = true;
            std::vector<float> cudaOutput;
            for (int iteration = 0; iteration < 2; ++iteration)
            {
                const auto cpuStarted =
                    std::chrono::steady_clock::now();
                (void)cpu_.process(
                    admissionInput.data(), admissionFrames);
                cpuMilliseconds = std::min(
                    cpuMilliseconds,
                    std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now()
                        - cpuStarted).count());

                const auto cudaStarted =
                    std::chrono::steady_clock::now();
                cudaAdmissionCompleted = cuda_.process(
                    admissionInput.data(),
                    admissionFrames,
                    cudaOutput,
                    cudaError);
                cudaMilliseconds = std::min(
                    cudaMilliseconds,
                    std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now()
                        - cudaStarted).count());
                if (!cudaAdmissionCompleted)
                    break;
            }
            cpu_.reset();
            cuda_.reset();

            if (cudaAdmissionCompleted
                && cudaMilliseconds < cpuMilliseconds * 0.9)
            {
                backend_ = Backend::Cuda;
                deviceName_ = cuda_.deviceName();
                warmupMilliseconds_ = cuda_.warmupMilliseconds();
            }
            else
            {
                if (!cudaAdmissionCompleted)
                {
                    fallbackReason_ = cudaError.empty()
                        ? "native_cuda_fir_admission_failed"
                        : std::move(cudaError);
                }
                else
                {
                    std::ostringstream reason;
                    reason << std::fixed << std::setprecision(3)
                           << "native_cuda_fir_not_faster:cpu="
                           << cpuMilliseconds
                           << "ms,cuda=" << cudaMilliseconds << "ms";
                    fallbackReason_ = reason.str();
                }
                cuda_.release();
            }
        }
        else
        {
            fallbackReason_ = cudaError.empty()
                ? "native_cuda_dsp_initialization_failed"
                : std::move(cudaError);
        }
    }

    reset();
    error.clear();
    return true;
}

void NativeFirProcessor::reset()
{
    cpu_.reset();
    cuda_.reset();
    flushPending_ = active();
    processedBlocks_ = 0;
    lastInputFrames_ = 0;
    lastOutputFrames_ = 0;
    lastProcessMilliseconds_ = 0.0;
    totalProcessMilliseconds_ = 0.0;
    peakProcessMilliseconds_ = 0.0;
    runtimeFallbacks_ = 0;
}

std::vector<float> NativeFirProcessor::process(const float* interleaved, int frames)
{
    if (interleaved != nullptr && frames > 0)
        flushPending_ = active();

    const auto started = std::chrono::steady_clock::now();
    if (backend_ != Backend::Cuda)
    {
        auto output = cpu_.process(interleaved, frames);
        const auto finished = std::chrono::steady_clock::now();
        recordProcess(
            frames,
            output.size(),
            std::chrono::duration<double, std::milli>(finished - started).count());
        return output;
    }

    std::vector<float> output;
    std::string cudaError;
    if (cuda_.process(interleaved, frames, output, cudaError))
    {
        const auto finished = std::chrono::steady_clock::now();
        recordProcess(
            frames,
            output.size(),
            std::chrono::duration<double, std::milli>(finished - started).count());
        return output;
    }

    // Keep the last fully committed GPU FIR history in a double-buffered host
    // snapshot. If a later CUDA block fails, the CPU can process that same
    // input block from the exact previous boundary without a waveform reset.
    backend_ = Backend::Cpu;
    ++runtimeFallbacks_;
    fallbackReason_ = cudaError.empty()
        ? "native_cuda_dsp_runtime_failure"
        : "native_cuda_dsp_runtime_failure:" + cudaError;
    deviceName_.clear();
    std::vector<std::vector<float>> histories;
    if (!cuda_.copyLatestHistory(histories) || !cpu_.restoreHistory(histories))
    {
        cpu_.reset();
        fallbackReason_ += ":history_restore_failed";
    }
    output = cpu_.process(interleaved, frames);
    const auto finished = std::chrono::steady_clock::now();
    recordProcess(
        frames,
        output.size(),
        std::chrono::duration<double, std::milli>(finished - started).count());
    return output;
}

std::vector<float> NativeFirProcessor::flush()
{
    if (!active() || !flushPending_ || tailOutputFrames_ == 0)
    {
        flushPending_ = false;
        return {};
    }

    const size_t requiredInputFrames =
        static_cast<size_t>(prerollInputFrames_);
    std::vector<float> output;
    output.reserve(
        requiredInputFrames
        * static_cast<size_t>(outputFactor_)
        * static_cast<size_t>(channels_));
    std::vector<float> silence(
        static_cast<size_t>(maximumInputFrames_)
            * static_cast<size_t>(channels_),
        0.0f);

    size_t remaining = requiredInputFrames;
    while (remaining > 0)
    {
        const int framesThisBlock = static_cast<int>(std::min(
            remaining,
            static_cast<size_t>(maximumInputFrames_)));
        auto block = process(silence.data(), framesThisBlock);
        output.insert(output.end(), block.begin(), block.end());
        remaining -= static_cast<size_t>(framesThisBlock);
    }

    output.resize(
        tailOutputFrames_ * static_cast<size_t>(channels_));
    flushPending_ = false;
    return output;
}

bool NativeFirProcessor::copyLatestHistory(
    std::vector<std::vector<float>>& histories) const
{
    if (backend_ == Backend::Cuda)
        return cuda_.copyLatestHistory(histories);
    cpu_.copyHistory(histories);
    return true;
}

bool NativeFirProcessor::restoreHistory(
    const std::vector<std::vector<float>>& histories)
{
    if (!cpu_.restoreHistory(histories))
        return false;
    if (backend_ == Backend::Cuda)
    {
        std::string error;
        if (!cuda_.restoreHistory(histories, error))
        {
            backend_ = Backend::Cpu;
            ++runtimeFallbacks_;
            fallbackReason_ = error.empty()
                ? "native_cuda_fir_history_restore_failed"
                : "native_cuda_fir_history_restore_failed:" + error;
            deviceName_.clear();
        }
    }
    flushPending_ = active();
    return true;
}

void NativeFirProcessor::recordProcess(
    int inputFrames,
    size_t outputSamples,
    double milliseconds)
{
    ++processedBlocks_;
    lastInputFrames_ = std::max(0, inputFrames);
    lastOutputFrames_ = static_cast<int>(
        outputSamples / static_cast<size_t>(std::max(1, channels_)));
    lastProcessMilliseconds_ = milliseconds;
    totalProcessMilliseconds_ += milliseconds;
    peakProcessMilliseconds_ = std::max(peakProcessMilliseconds_, milliseconds);
}
