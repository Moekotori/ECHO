#include "HostCommon.h"
#include "AutomixTempoProcessor.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
void require(bool condition, const std::string& message)
{
    if (!condition)
        throw std::runtime_error(message);
}

NativePlaybackPipeline::FirConfig makeX2Fir(int sourceSampleRate, int targetSampleRate)
{
    NativePlaybackPipeline::FirConfig fir;
    fir.sourceSampleRate = sourceSampleRate;
    fir.targetSampleRate = targetSampleRate;
    fir.stages = { echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } } };
    return fir;
}

void testPcmDomainDspStageProcessesBeforeSdm()
{
    echo::EqProcessor eq;
    echo::ConvolutionProcessor convolution;
    echo::ChannelBalanceProcessor channelBalance;
    echo::DspHeadroomProcessor headroom;
    echo::ReplayGainProcessor replayGain;
    echo::CompressorProcessor compressor;
    echo::SpatialDspProcessor spatialDsp;
    echo::PlaybackRateProcessor playbackRate;
    echo::LevelMeterProcessor meter;

    eq.setEnabled(true);
    headroom.setHeadroomDb(-6.0f);
    PcmDomainDspStage stage(eq, convolution, channelBalance, headroom, replayGain, compressor, spatialDsp, playbackRate, meter);
    stage.prepare(48'000.0, 1024, 2);

    std::vector<float> samples(2 * 1024, 1.0f);
    std::string error;
    require(stage.process(samples, error), "PCM-domain DSP stage must process interleaved PCM");
    require(samples.back() < 0.52f && samples.back() > 0.48f,
        "headroom must be applied in PCM domain before SDM transport encoding");
}

void testSdmOversamplingSupportsDsd256AndReportsTruthfulBackend()
{
    echo::EqProcessor eq;
    echo::ConvolutionProcessor convolution;
    echo::ChannelBalanceProcessor channelBalance;
    echo::DspHeadroomProcessor headroom;
    echo::ReplayGainProcessor replayGain;
    echo::CompressorProcessor compressor;
    echo::SpatialDspProcessor spatialDsp;
    echo::PlaybackRateProcessor playbackRate;
    echo::LevelMeterProcessor meter;
    std::atomic<bool> meterObserved { false };
    // The shared DspChain intentionally runs meters only while the DSP graph
    // is active. A flat enabled EQ activates the graph without coloring this
    // transport-focused test signal.
    eq.setEnabled(true);
    meter.setIntervalMs(1);
    meter.setCallback([&meterObserved](const echo::LevelMeterSnapshot& snapshot)
    {
        meterObserved.store(!snapshot.peakDb.empty(), std::memory_order_release);
    });

    PcmRingAudioSource pcm(2, 4'096, 0, 0, 1.0f,
        eq, convolution, channelBalance, headroom, replayGain, compressor, spatialDsp, playbackRate, meter);
    DopRingSource dop(2, 4'096, 0, 0);
    NativeDsdRingSource nativeDsd(2, 8'192, 0, 0);
    NativePlaybackPipeline pipeline(
        pcm, dop, nativeDsd, 2,
        eq, convolution, channelBalance, headroom, replayGain, compressor, spatialDsp, playbackRate, meter);

    NativePlaybackPipeline::ProcessingConfig config;
    config.outputFormat = NativePlaybackPipeline::OutputFormat::Dop;
    config.sdm.qualityProfile = echo::SdmQualityProfile::Reference;
    config.sdm.requestedBackend = NativePlaybackPipeline::ComputeBackend::Cuda;
    config.sdm.sourceSampleRate = 48'000;
    config.sdm.targetSampleRate = 768'000;
    config.sdm.oversampling = makeX2Fir(48'000, 96'000);
    config.sdm.oversampling.stages.push_back(echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } });
    config.sdm.oversampling.stages.push_back(echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } });
    config.sdm.oversampling.stages.push_back(echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } });
    config.sdm.oversampling.targetSampleRate = 768'000;

    std::string error;
    require(pipeline.configure(config, error), "four x2 SDM FIR stages must configure for DSD256");
    const auto status = pipeline.processingStatus();
    require(status.sdm.active, "SDM processing status must be active");
    require(status.sdm.sourceSampleRate == 48'000 && status.sdm.targetSampleRate == 768'000,
        "SDM status must report the native FIR sample rates");
    require(status.sdm.stageCount == 4, "SDM status must report all DSD256 FIR stages");
    require(status.sdm.requestedBackend == NativePlaybackPipeline::ComputeBackend::Cuda,
        "SDM status must retain the requested CUDA backend");
    require(status.sdm.activeBackend == status.sdm.modulatorBackend,
        "SDM active backend must describe the recursive modulator");
    if (status.sdm.activeBackend == NativePlaybackPipeline::ComputeBackend::Cuda)
    {
        require(status.sdm.fallbackReason.empty(),
            "active CUDA SDM modulator must not report a fallback");
        require(!status.sdm.deviceName.empty(),
            "active CUDA SDM modulator must identify the selected device");
    }
    else
    {
        require(!status.sdm.fallbackReason.empty(),
            "CPU fallback must expose the native CUDA initialization reason");
    }
    require(status.sdm.estimatedMacsPerSecond == 4'320'000,
        "SDM status must expose native FIR cost for realtime admission diagnostics");
    require(status.sdm.modulatorOrder == 7 && std::abs(status.sdm.ntfPeakGain - 1.6) < 1.0e-12,
        "SDM status must expose the active bounded NTF design");
    require(status.sdm.stabilityRecoveries == 0 && status.sdm.peakFeedbackState == 0.0,
        "fresh SDM status must start with clean stability telemetry");
    require(status.sdm.pcmDspRouted, "SDM status must confirm PCM-domain DSP routing");
    if (status.sdm.oversamplingBackend == NativePlaybackPipeline::ComputeBackend::Cuda)
    {
        require(status.sdm.oversamplingFallbackReason.empty(),
            "active CUDA SDM oversampling must not report a fallback");
    }
    require(pipeline.decoderSampleRate(768'000) == 48'000,
        "decoder must retain source PCM rate while host performs SDM FIR upsampling");

    pipeline.beginSession();
    std::vector<float> samples(2 * 64, 0.25f);
    require(pipeline.push(samples.data(), 64), "SDM pipeline must accept PCM input after configuration");
    require(dop.getReadyFrames() == 64 * 16, "four x2 stages must produce 16x DoP transport frames");
    const auto activeStatus = pipeline.processingStatus();
    require(activeStatus.sdm.peakFeedbackState > 0.0 && activeStatus.sdm.stabilityRecoveries == 0,
        "SDM runtime telemetry must report bounded activity without recovery");
    require(meterObserved.load(std::memory_order_acquire),
        "level meter must observe PCM-domain samples before SDM encoding");
}

void testDsdTransportGenerationRejectsStaleBlocks()
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    PcmRingAudioSource pcm(2, 8, 0, 0, 1.0f, eq, channelBalance);
    pcm.beginSession();
    const uint64_t stalePcmGeneration = pcm.session_.generation();
    pcm.beginSession();
    const std::vector<float> pcmFrame { 0.25f, -0.25f };
    require(!pcm.pushForGeneration(pcmFrame.data(), 1, stalePcmGeneration),
        "PCM ring must reject a block prepared before a new session");
    require(pcm.getReadyFrames() == 0, "stale PCM block must not enter the new FIFO");

    DopRingSource dop(2, 8, 0, 0);
    dop.beginSession();
    const uint64_t staleDopGeneration = dop.generation();
    dop.beginSession();
    const std::vector<uint32_t> dopFrame { 0x00056969u, 0x00056969u };
    require(!dop.pushForGeneration(dopFrame.data(), 1, staleDopGeneration),
        "DoP ring must reject a block prepared before a new session");
    require(dop.getReadyFrames() == 0, "stale DoP block must not enter the new FIFO");

    NativeDsdRingSource nativeDsd(2, 8, 0, 0);
    nativeDsd.beginSession();
    const uint64_t staleNativeGeneration = nativeDsd.generation();
    nativeDsd.beginSession();
    const std::vector<uint8_t> nativeFrame { 0x69u, 0x69u };
    require(!nativeDsd.pushForGeneration(nativeFrame.data(), 1, staleNativeGeneration),
        "native DSD ring must reject a block prepared before a new session");
    require(nativeDsd.getReadyByteFrames() == 0, "stale native DSD block must not enter the new FIFO");
}

void testCudaFirMatchesCpuAcrossBlocksOrFallsBack()
{
    const std::vector<echo::EchoSrcStageConfig> stages {
        { 2, { -0.02f, 0.0f, 0.24f, 0.56f, 0.24f, 0.0f, -0.02f } },
        { 2, { 0.0f, 0.25f, 0.5f, 0.25f, 0.0f } },
    };
    NativeFirProcessor cpu;
    NativeFirProcessor preferredCuda;
    std::string error;
    require(cpu.configure(2, stages, false, 64, error),
        "CPU FIR reference must configure");
    require(preferredCuda.configure(2, stages, true, 64, error),
        "CUDA FIR request must configure or retain CPU fallback");

    for (int block = 0; block < 3; ++block)
    {
        std::vector<float> input(2 * 37);
        for (int frame = 0; frame < 37; ++frame)
        {
            const float sample = static_cast<float>(
                0.45 * std::sin(
                    2.0 * 3.14159265358979323846
                    * static_cast<double>(block * 37 + frame) / 29.0));
            input[static_cast<size_t>(frame * 2)] = sample;
            input[static_cast<size_t>(frame * 2 + 1)] = -sample * 0.75f;
        }
        const auto expected = cpu.process(input.data(), 37);
        const auto actual = preferredCuda.process(input.data(), 37);
        require(actual.size() == expected.size(),
            "CUDA FIR must preserve multi-stage output frame count");
        for (size_t index = 0; index < expected.size(); ++index)
        {
            require(std::abs(actual[index] - expected[index]) <= 2.0e-5f,
                "CUDA FIR must match CPU polyphase output across block history");
        }
    }

    if (preferredCuda.backend() == NativeFirProcessor::Backend::Cuda)
    {
        require(preferredCuda.fallbackReason().empty(),
            "working CUDA FIR must not retain a fallback reason");
        require(!preferredCuda.deviceName().empty(),
            "working CUDA FIR must expose its device name");
        require(preferredCuda.warmupMilliseconds() > 0.0,
            "working CUDA FIR must report its pre-playback warmup cost");
        std::cout << "[native-playback-pipeline] CUDA device "
                  << preferredCuda.deviceName()
                  << ", warmup=" << preferredCuda.warmupMilliseconds()
                  << "ms, average-block=" << preferredCuda.averageProcessMilliseconds()
                  << "ms\n";
    }
    else
    {
        require(!preferredCuda.fallbackReason().empty(),
            "unavailable CUDA FIR must retain a diagnostic fallback reason");
        std::cout << "[native-playback-pipeline] CUDA fallback "
                  << preferredCuda.fallbackReason() << '\n';
    }
    require(preferredCuda.processedBlocks() == 3
            && preferredCuda.lastInputFrames() == 37
            && preferredCuda.lastOutputFrames() == 148,
        "native FIR telemetry must report authoritative block geometry");
    require(preferredCuda.averageProcessMilliseconds() > 0.0
            && preferredCuda.peakProcessMilliseconds()
                >= preferredCuda.lastProcessMilliseconds(),
        "native FIR telemetry must report bounded host-side processing time");

    const auto expectedTail = cpu.flush();
    const auto actualTail = preferredCuda.flush();
    require(actualTail.size() == expectedTail.size(),
        "CUDA FIR flush must preserve the exact CPU tail frame count");
    for (size_t index = 0; index < expectedTail.size(); ++index)
    {
        require(std::abs(actualTail[index] - expectedTail[index]) <= 2.0e-5f,
            "CUDA FIR flush must match the CPU convolution tail");
    }
    require(preferredCuda.flush().empty(),
        "CUDA FIR flush must be idempotent after the committed tail");
}

void testCudaFirHistorySnapshotRestoresCpuBoundary()
{
    const std::vector<echo::EchoSrcStageConfig> stages {
        { 2, { -0.02f, 0.0f, 0.24f, 0.56f, 0.24f, 0.0f, -0.02f } },
        { 2, { 0.0f, 0.25f, 0.5f, 0.25f, 0.0f } },
    };
    CudaFirProcessor cuda;
    std::string error;
    if (!cuda.configure(2, stages, 64, error))
    {
        std::cout << "[native-playback-pipeline] CUDA history snapshot skipped "
                  << error << '\n';
        return;
    }

    echo::EchoSrcProcessor cpuReference;
    echo::EchoSrcProcessor cpuRestored;
    require(cpuReference.configure(2, stages, error)
            && cpuRestored.configure(2, stages, error),
        "CPU FIR processors must configure for CUDA history restoration");

    // Two frames are shorter than the first stage's three-frame history.
    // This exercises the retained-history + appended-input CUDA copy path.
    constexpr int tinyBlockFrames = 2;
    std::vector<float> firstBlock(2 * tinyBlockFrames);
    std::vector<float> secondBlock(2 * tinyBlockFrames);
    for (size_t index = 0; index < firstBlock.size(); ++index)
        firstBlock[index] = static_cast<float>(0.35 * std::sin(static_cast<double>(index) * 0.17));
    for (size_t index = 0; index < secondBlock.size(); ++index)
        secondBlock[index] = static_cast<float>(0.25 * std::cos(static_cast<double>(index) * 0.11));

    std::vector<float> cudaOutput;
    require(cuda.process(
                firstBlock.data(),
                tinyBlockFrames,
                cudaOutput,
                error),
        "CUDA FIR must commit a complete first block before history restoration");
    (void)cpuReference.process(firstBlock.data(), tinyBlockFrames);

    std::vector<std::vector<float>> histories;
    require(cuda.copyLatestHistory(histories)
            && cpuRestored.restoreHistory(histories),
        "CUDA FIR must expose a restorable committed CPU history boundary");
    CudaFirProcessor cudaRestored;
    require(cudaRestored.configure(2, stages, 64, error)
            && cudaRestored.restoreHistory(histories, error),
        "CUDA FIR must restore a committed history boundary for gapless continuation");
    const auto expected =
        cpuReference.process(secondBlock.data(), tinyBlockFrames);
    const auto actual =
        cpuRestored.process(secondBlock.data(), tinyBlockFrames);
    std::vector<float> restoredCudaOutput;
    require(cudaRestored.process(
                secondBlock.data(),
                tinyBlockFrames,
                restoredCudaOutput,
                error),
        "restored CUDA FIR must process the continuation block");
    require(actual.size() == expected.size(),
        "restored CPU FIR must preserve output geometry");
    require(restoredCudaOutput.size() == expected.size(),
        "restored CUDA FIR must preserve output geometry");
    for (size_t index = 0; index < expected.size(); ++index)
    {
        require(std::abs(actual[index] - expected[index]) <= 2.0e-5f,
            "restored CPU FIR must continue from the committed CUDA boundary");
        require(std::abs(restoredCudaOutput[index] - expected[index]) <= 2.0e-5f,
            "restored CUDA FIR must continue from the committed CUDA boundary");
    }
}

void testCudaFirReportsLongFilterRealtimeHeadroom()
{
    constexpr int tapCount = 2047;
    constexpr int inputFrames = 4096;
    constexpr int sourceSampleRate = 48'000;
    std::vector<float> taps(tapCount);
    double tapSum = 0.0;
    for (int tap = 0; tap < tapCount; ++tap)
    {
        const double centered = static_cast<double>(tap - tapCount / 2);
        const double sinc = std::abs(centered) < 1.0e-12
            ? 0.22
            : std::sin(3.14159265358979323846 * 0.22 * centered)
                / (3.14159265358979323846 * centered);
        const double window =
            0.5 - 0.5 * std::cos(
                2.0 * 3.14159265358979323846
                * static_cast<double>(tap) / static_cast<double>(tapCount - 1));
        taps[static_cast<size_t>(tap)] = static_cast<float>(sinc * window);
        tapSum += taps[static_cast<size_t>(tap)];
    }
    for (auto& tap : taps)
        tap = static_cast<float>(static_cast<double>(tap) / tapSum);

    const std::vector<echo::EchoSrcStageConfig> stages {
        { 4, std::move(taps) },
    };
    NativeFirProcessor cuda;
    std::string error;
    require(cuda.configure(2, stages, true, inputFrames, error),
        "long CUDA FIR benchmark must configure or retain CPU fallback");
    if (cuda.backend() != NativeFirProcessor::Backend::Cuda)
    {
        std::cout << "[native-playback-pipeline] long FIR CUDA benchmark skipped "
                  << cuda.fallbackReason() << '\n';
        return;
    }

    NativeFirProcessor cpu;
    require(cpu.configure(2, stages, false, inputFrames, error),
        "long CPU FIR benchmark reference must configure");
    std::vector<float> input(2 * inputFrames);
    for (size_t index = 0; index < input.size(); ++index)
        input[index] = static_cast<float>(0.2 * std::sin(static_cast<double>(index) * 0.013));
    for (int iteration = 0; iteration < 3; ++iteration)
    {
        const auto cpuOutput = cpu.process(input.data(), inputFrames);
        const auto cudaOutput = cuda.process(input.data(), inputFrames);
        require(cpuOutput.size() == cudaOutput.size(),
            "long CUDA FIR benchmark must preserve CPU output geometry");
    }
    const double blockBudgetMilliseconds =
        static_cast<double>(inputFrames) / sourceSampleRate * 1'000.0;
    std::cout << "[native-playback-pipeline] long FIR 2047-tap/4x CPU="
              << cpu.averageProcessMilliseconds()
              << "ms, CUDA=" << cuda.averageProcessMilliseconds()
              << "ms, CUDA realtime-ratio="
              << cuda.averageProcessMilliseconds() / blockBudgetMilliseconds
              << '\n';
}

std::vector<float> makeSdmInput(int startFrame, int frames)
{
    std::vector<float> input(static_cast<size_t>(frames * 2));
    for (int frame = 0; frame < frames; ++frame)
    {
        const double phase = static_cast<double>(startFrame + frame);
        input[static_cast<size_t>(frame * 2)] =
            static_cast<float>(0.42 * std::sin(phase * 0.071));
        input[static_cast<size_t>(frame * 2 + 1)] =
            static_cast<float>(0.31 * std::cos(phase * 0.053));
    }
    return input;
}

void testCudaSdmPreservesRecursiveStateAcrossBlocksOrFallsBack()
{
    constexpr int totalFrames = 112;
    constexpr int blockFrames[] { 17, 31, 64 };
    NativeSdmProcessor whole;
    NativeSdmProcessor chunked;
    std::string error;
    require(whole.configure(
                2,
                echo::SdmQualityProfile::Reference,
                768'000,
                true,
                totalFrames,
                error)
            && chunked.configure(
                2,
                echo::SdmQualityProfile::Reference,
                768'000,
                true,
                totalFrames,
                error),
        "CUDA SDM requests must configure or retain CPU fallback");
    whole.setTargetGain(0.83);
    chunked.setTargetGain(0.83);

    const auto input = makeSdmInput(0, totalFrames);
    const auto expected = whole.processDop(input.data(), totalFrames);
    std::vector<uint32_t> actual;
    int offset = 0;
    for (int frames : blockFrames)
    {
        const auto block = chunked.processDop(
            input.data() + static_cast<size_t>(offset * 2),
            frames);
        actual.insert(actual.end(), block.begin(), block.end());
        offset += frames;
    }
    require(actual == expected,
        "CUDA SDM must preserve recursive state, gain ramps, dither, and DoP markers across block boundaries");
    require(chunked.stabilityRecoveryCount() == 0
            && std::isfinite(chunked.peakFeedbackState())
            && chunked.peakFeedbackState() > 0.0,
        "CUDA SDM must retain bounded stability telemetry");
    require(chunked.processedBlocks() == 3
            && chunked.lastInputFrames() == 64
            && chunked.lastOutputFrames() == 64,
        "CUDA SDM telemetry must report authoritative block geometry");

    NativeSdmProcessor wholeNative;
    NativeSdmProcessor chunkedNative;
    require(wholeNative.configure(
                2,
                echo::SdmQualityProfile::Reference,
                768'000,
                true,
                totalFrames,
                error)
            && chunkedNative.configure(
                2,
                echo::SdmQualityProfile::Reference,
                768'000,
                true,
                totalFrames,
                error),
        "native DSD CUDA SDM requests must configure or retain CPU fallback");
    const auto expectedNative =
        wholeNative.processNativeDsd(input.data(), totalFrames);
    std::vector<uint8_t> actualNative;
    offset = 0;
    for (int frames : blockFrames)
    {
        const auto block = chunkedNative.processNativeDsd(
            input.data() + static_cast<size_t>(offset * 2),
            frames);
        actualNative.insert(
            actualNative.end(), block.begin(), block.end());
        offset += frames;
    }
    require(actualNative == expectedNative,
        "CUDA SDM native DSD bytes must remain invariant to host block partitioning");

    if (chunked.backend() == NativeSdmProcessor::Backend::Cuda)
    {
        require(chunked.fallbackReason().empty()
                && !chunked.deviceName().empty()
                && chunked.warmupMilliseconds() > 0.0,
            "working CUDA SDM must expose its device and warmup without fallback");
        std::cout << "[native-playback-pipeline] SDM CUDA device "
                  << chunked.deviceName()
                  << ", warmup=" << chunked.warmupMilliseconds()
                  << "ms, average-block="
                  << chunked.averageProcessMilliseconds() << "ms\n";
    }
    else
    {
        require(!chunked.fallbackReason().empty(),
            "unavailable CUDA SDM must expose its fallback reason");
        std::cout << "[native-playback-pipeline] SDM CUDA fallback "
                  << chunked.fallbackReason() << '\n';
    }

    echo::SdmProcessor initial;
    initial.configure(
        2, echo::SdmQualityProfile::Reference, 768'000);
    CudaSdmProcessor cudaWhole;
    CudaSdmProcessor cudaChunked;
    if (!cudaWhole.configure(
            initial.configuration(),
            initial.state(),
            totalFrames,
            error)
        || !cudaChunked.configure(
            initial.configuration(),
            initial.state(),
            totalFrames,
            error))
    {
        std::cout << "[native-playback-pipeline] direct SDM CUDA continuity skipped "
                  << error << '\n';
        return;
    }
    cudaWhole.setTargetGain(0.83);
    cudaChunked.setTargetGain(0.83);
    std::vector<uint32_t> directExpected;
    require(cudaWhole.processDop(
                input.data(), totalFrames, directExpected, error),
        "direct CUDA SDM must process a complete DoP block");
    std::vector<uint32_t> directActual;
    offset = 0;
    for (int frames : blockFrames)
    {
        std::vector<uint32_t> block;
        require(cudaChunked.processDop(
                    input.data() + static_cast<size_t>(offset * 2),
                    frames,
                    block,
                    error),
            "direct CUDA SDM must process each partitioned DoP block");
        directActual.insert(
            directActual.end(), block.begin(), block.end());
        offset += frames;
    }
    require(directActual == directExpected,
        "direct CUDA SDM state must be invariant to DoP block partitioning");
    require(cudaChunked.stabilityRecoveryCount() == 0
            && cudaChunked.peakFeedbackState() > 0.0,
        "direct CUDA SDM must retain bounded state telemetry");

    CudaSdmProcessor cudaWholeNative;
    CudaSdmProcessor cudaChunkedNative;
    require(cudaWholeNative.configure(
                initial.configuration(),
                initial.state(),
                totalFrames,
                error)
            && cudaChunkedNative.configure(
                initial.configuration(),
                initial.state(),
                totalFrames,
                error),
        "direct CUDA SDM native DSD processors must configure");
    std::vector<uint8_t> directExpectedNative;
    require(cudaWholeNative.processNativeDsd(
                input.data(),
                totalFrames,
                directExpectedNative,
                error),
        "direct CUDA SDM must process a complete native DSD block");
    std::vector<uint8_t> directActualNative;
    offset = 0;
    for (int frames : blockFrames)
    {
        std::vector<uint8_t> block;
        require(cudaChunkedNative.processNativeDsd(
                    input.data() + static_cast<size_t>(offset * 2),
                    frames,
                    block,
                    error),
            "direct CUDA SDM must process each partitioned native DSD block");
        directActualNative.insert(
            directActualNative.end(), block.begin(), block.end());
        offset += frames;
    }
    require(directActualNative == directExpectedNative,
        "direct CUDA SDM state must be invariant to native DSD block partitioning");
}

void testCudaSdmReportsRealtimeHeadroom()
{
    constexpr int frames = 8192;
    constexpr int transportSampleRate = 768'000;
    echo::SdmProcessor cpu;
    cpu.configure(
        2, echo::SdmQualityProfile::Insane, transportSampleRate);
    CudaSdmProcessor cuda;
    std::string error;
    if (!cuda.configure(
            cpu.configuration(),
            cpu.state(),
            frames,
            error))
    {
        std::cout << "[native-playback-pipeline] SDM CUDA benchmark skipped "
                  << error << '\n';
        return;
    }

    const auto input = makeSdmInput(0, frames);
    double cpuMilliseconds = 0.0;
    double cudaMilliseconds = 0.0;
    for (int iteration = 0; iteration < 3; ++iteration)
    {
        const auto cpuStarted = std::chrono::steady_clock::now();
        const auto cpuOutput = cpu.processDop(input.data(), frames);
        cpuMilliseconds += std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - cpuStarted).count();
        std::vector<uint32_t> cudaOutput;
        const auto cudaStarted = std::chrono::steady_clock::now();
        require(cuda.processDop(
                    input.data(), frames, cudaOutput, error),
            "direct CUDA SDM benchmark must process");
        cudaMilliseconds += std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - cudaStarted).count();
        require(cpuOutput.size() == cudaOutput.size(),
            "CUDA SDM benchmark must preserve DoP output geometry");
    }
    cpuMilliseconds /= 3.0;
    cudaMilliseconds /= 3.0;
    const double blockBudgetMilliseconds =
        static_cast<double>(frames) / transportSampleRate * 1'000.0;
    std::cout << "[native-playback-pipeline] SDM order-8 CPU="
              << cpuMilliseconds
              << "ms, CUDA=" << cudaMilliseconds
              << "ms, CUDA realtime-ratio="
              << cudaMilliseconds / blockBudgetMilliseconds
              << '\n';
}

void testNativeDsdPassthroughRoutesRawTransportWithoutSdm()
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    PcmRingAudioSource pcm(2, 16, 0, 0, 1.0f, eq, channelBalance);
    DopRingSource dop(2, 16, 0, 0);
    NativeDsdRingSource nativeDsd(2, 16, 0, 0);
    NativePlaybackPipeline pipeline(pcm, dop, nativeDsd, 2);

    std::string error;
    require(
        pipeline.configurePassthroughOutput(NativePlaybackPipeline::OutputFormat::NativeDsd, error),
        "native DSD passthrough output must configure");
    const auto status = pipeline.processingStatus();
    require(status.outputFormat == NativePlaybackPipeline::OutputFormat::NativeDsd,
        "passthrough status must report native DSD output");
    require(! status.sdm.active, "raw DSD passthrough must not claim PCM-to-SDM processing");
    require(pipeline.decoderSampleRate(5'644'800) == 5'644'800,
        "raw DSD passthrough must not introduce a decoder or resampler rate");

    pipeline.beginSession();
    const std::vector<uint8_t> rawDsd { 0x69u, 0x96u, 0xa5u, 0x5au };
    require(nativeDsd.push(rawDsd.data(), 2), "native DSD passthrough must accept raw byte frames");
    require(pipeline.getReadyFrames() == 16,
        "pipeline telemetry must expose native DSD byte frames as eight one-bit sample frames");
    require(dop.getReadyFrames() == 0 && pcm.getReadyFrames() == 0,
        "raw native DSD must bypass DoP and PCM FIFOs");
}

void testAutomixWsolaKeepsPitchAndBoundedTempo()
{
    constexpr int sampleRate = 48'000;
    constexpr int channels = 2;
    constexpr double frequency = 440.0;
    constexpr double ratio = 1.01;
    const int inputFrames = sampleRate * 2;
    std::vector<float> input(static_cast<size_t>(inputFrames * channels));
    for (int frame = 0; frame < inputFrames; ++frame)
    {
        const float sample = static_cast<float>(
            0.4 * std::sin(2.0 * 3.14159265358979323846 * frequency
                * static_cast<double>(frame) / sampleRate));
        input[static_cast<size_t>(frame * channels)] = sample;
        input[static_cast<size_t>(frame * channels + 1)] = sample;
    }

    AutomixTempoProcessor processor(sampleRate, channels, ratio);
    require(processor.active(), "non-unity AutoMix tempo must activate WSOLA");
    std::vector<float> output;
    for (int offset = 0; offset < inputFrames; offset += 4096)
    {
        const int frames = std::min(4096, inputFrames - offset);
        auto chunk = processor.process(
            input.data() + static_cast<size_t>(offset * channels),
            frames);
        output.insert(output.end(), chunk.begin(), chunk.end());
    }
    auto tail = processor.process(nullptr, 0, true);
    output.insert(output.end(), tail.begin(), tail.end());

    const int outputFrames = static_cast<int>(output.size() / channels);
    const double expectedFrames = static_cast<double>(inputFrames) / ratio;
    require(std::abs(static_cast<double>(outputFrames) - expectedFrames) < sampleRate * 0.08,
        "WSOLA output duration must follow the bounded tempo ratio");
    for (float sample : output)
        require(std::isfinite(sample), "WSOLA output must remain finite");

    int positiveCrossings = 0;
    for (int frame = sampleRate / 4 + 1; frame < outputFrames - sampleRate / 4; ++frame)
    {
        const float previous = output[static_cast<size_t>((frame - 1) * channels)];
        const float current = output[static_cast<size_t>(frame * channels)];
        if (previous <= 0.0f && current > 0.0f)
            ++positiveCrossings;
    }
    const double measuredSeconds = static_cast<double>(
        outputFrames - sampleRate / 2) / sampleRate;
    const double measuredFrequency = positiveCrossings / std::max(0.001, measuredSeconds);
    require(std::abs(measuredFrequency - frequency) < 8.0,
        "stereo-linked WSOLA must change tempo without changing pitch");
}

void testAutomixDeckUsesIndependentEchoSrcState()
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    PcmRingAudioSource pcm(2, 256, 0, 0, 1.0f, eq, channelBalance);
    DopRingSource dop(2, 256, 0, 0);
    NativeDsdRingSource nativeDsd(2, 256, 0, 0);
    NativePlaybackPipeline pipeline(pcm, dop, nativeDsd, 2);
    NativePlaybackPipeline::ProcessingConfig config;
    config.outputFormat = NativePlaybackPipeline::OutputFormat::Pcm;
    config.echoSrc = makeX2Fir(48'000, 96'000);
    std::string error;
    require(pipeline.configure(config, error), "ECHO SRC must configure before AutoMix");
    pipeline.beginSession();
    require(pipeline.prepareAutomixFrames(16, 32, 0.0, 0.0),
        "PCM AutoMix must remain available with ECHO SRC active");
    const std::vector<float> nextDeck {
        0.25f, 0.25f,
        0.5f, 0.5f,
        0.75f, 0.75f,
        1.0f, 1.0f,
    };
    require(pipeline.pushAutomixNext(nextDeck.data(), 4),
        "Deck B must pass through its own ECHO SRC instance");
    require(pcm.getReadyFrames() == 8,
        "Deck B ECHO SRC must publish target-rate frames to the common mix ring");
}

void testGaplessEchoSrcContinuesFirAcrossTrackBoundary()
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    PcmRingAudioSource pcm(1, 256, 0, 0, 1.0f, eq, channelBalance);
    DopRingSource dop(1, 256, 0, 0);
    NativeDsdRingSource nativeDsd(1, 256, 0, 0);
    NativePlaybackPipeline pipeline(pcm, dop, nativeDsd, 1);
    NativePlaybackPipeline::ProcessingConfig config;
    config.outputFormat = NativePlaybackPipeline::OutputFormat::Pcm;
    config.echoSrc = makeX2Fir(48'000, 96'000);
    std::string error;
    require(pipeline.configure(config, error),
        "ECHO SRC must configure before gapless continuation");
    pipeline.beginSession();

    const std::vector<float> current { 0.1f, 0.2f };
    const std::vector<float> next { 0.3f, 0.4f };
    require(pipeline.push(current.data(), 2),
        "current gapless deck must enter the main FIR");
    require(pipeline.prepareGapless(),
        "gapless must remain available while ECHO SRC current input is open");
    require(pipeline.pushGaplessNext(next.data(), 2),
        "next gapless deck prime must be accepted before current EOF");
    pipeline.markInputEnded();
    pipeline.markGaplessNextEnded();

    echo::EchoSrcProcessor reference;
    require(reference.configure(1, config.echoSrc.stages, error),
        "gapless reference FIR must configure");
    const std::vector<float> joined { 0.1f, 0.2f, 0.3f, 0.4f };
    auto expected = reference.process(
        joined.data(),
        static_cast<int>(joined.size()));
    const float zero = 0.0f;
    auto referenceTail = reference.process(&zero, 1);
    expected.push_back(referenceTail.front());

    require(pipeline.getReadyFrames() == static_cast<int>(expected.size()),
        "gapless ECHO SRC must queue one continuous body plus final FIR tail");
    auto output = echo::FloatAudioBuffer(1, static_cast<int>(expected.size()));
    require(pcm.renderPlanar(
                output,
                0,
                static_cast<int>(expected.size()))
            == expected.size(),
        "gapless ECHO SRC must render the continuous joined stream");
    for (size_t frame = 1; frame < expected.size(); ++frame)
    {
        require(std::abs(
                    output.getSample(0, static_cast<int>(frame))
                    - expected[frame])
                <= 1.0e-6f,
            "gapless ECHO SRC must preserve FIR history across the track boundary");
    }
    require(pipeline.getGaplessBoundaryFrame() == 4,
        "gapless boundary must be reported in target-rate PCM frames");
    require(pipeline.isDrained(),
        "gapless ECHO SRC must drain only after the continuation FIR tail");
}
} // namespace

int main()
{
    try
    {
        testPcmDomainDspStageProcessesBeforeSdm();
        std::cout << "[native-playback-pipeline] PASS PCM-domain DSP stage\n";
        testSdmOversamplingSupportsDsd256AndReportsTruthfulBackend();
        std::cout << "[native-playback-pipeline] PASS DSD256 SDM oversampling backend truth\n";
        testCudaFirMatchesCpuAcrossBlocksOrFallsBack();
        std::cout << "[native-playback-pipeline] PASS CUDA FIR parity or explicit fallback\n";
        testCudaFirHistorySnapshotRestoresCpuBoundary();
        std::cout << "[native-playback-pipeline] PASS CUDA FIR committed history restoration\n";
        testCudaFirReportsLongFilterRealtimeHeadroom();
        std::cout << "[native-playback-pipeline] PASS CUDA FIR long-filter telemetry\n";
        testCudaSdmPreservesRecursiveStateAcrossBlocksOrFallsBack();
        std::cout << "[native-playback-pipeline] PASS CUDA SDM recursive-state continuity\n";
        testCudaSdmReportsRealtimeHeadroom();
        std::cout << "[native-playback-pipeline] PASS CUDA SDM realtime telemetry\n";
        testDsdTransportGenerationRejectsStaleBlocks();
        std::cout << "[native-playback-pipeline] PASS DSD transport generation guard\n";
        testNativeDsdPassthroughRoutesRawTransportWithoutSdm();
        std::cout << "[native-playback-pipeline] PASS native DSD raw passthrough routing\n";
        testAutomixWsolaKeepsPitchAndBoundedTempo();
        std::cout << "[native-playback-pipeline] PASS AutoMix WSOLA tempo and pitch\n";
        testAutomixDeckUsesIndependentEchoSrcState();
        std::cout << "[native-playback-pipeline] PASS AutoMix independent ECHO SRC deck\n";
        testGaplessEchoSrcContinuesFirAcrossTrackBoundary();
        std::cout << "[native-playback-pipeline] PASS gapless ECHO SRC FIR continuity\n";
    }
    catch (const std::exception& error)
    {
        std::cerr << "[native-playback-pipeline] FAIL " << error.what() << '\n';
        return 1;
    }

    return 0;
}
