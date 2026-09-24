#include "AudioDaemon.h"
#include "AutomixTempoProcessor.h"

#include "DopRingSource.h"
#include "HostUtils.h"
#include "NativeDsdRingSource.h"
#include "Options.h"
#include "PcmRingAudioSource.h"

#include "../../audio-engine/JsonRpcProtocol.h"

#include <algorithm>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <stdexcept>
#include <thread>
#include <unordered_set>
#include <utility>

#ifndef _WIN32
#include <unistd.h>
#else
#include <io.h>
#endif

namespace {
std::atomic<bool>* g_shutdownSignal = nullptr;
constexpr int decodeChunkFrames = 4096;

double normalizeStartSeconds(double requestedStartSeconds, double durationSeconds)
{
    if (requestedStartSeconds < 0.0)
        return 0.0;
    if (durationSeconds > 0.0 && requestedStartSeconds >= durationSeconds)
        return std::max(0.0, durationSeconds - 0.250);
    return requestedStartSeconds;
}

constexpr int seekPrimeFrames = 4096;
constexpr double seekPrimeSeconds = 0.25;
constexpr size_t maxPrefetchCacheEntries = 4;
constexpr size_t maxPrefetchCacheSamples = 8 * 1024 * 1024; // 32 MiB of float PCM.

struct StreamDecodeOutcome {
    std::vector<float> samples;
    int sampleRate = 0;
    int channels = 0;
    int frames = 0;
};

nlohmann::json createGaplessTrackInfo(
    const nlohmann::json& request,
    const echo::AudioProbe& probe,
    int outputRate,
    int outputChannels)
{
    return {
        {"filePath", request.value("filePath", "")},
        {"sampleRate", outputRate},
        {"sourceSampleRate", probe.sampleRate},
        {"channels", outputChannels},
        {"durationSeconds", probe.durationSeconds},
        {"startSeconds", 0.0},
        {"codec", probe.codec},
        {"container", probe.container},
        {"bitDepth", probe.bitDepth},
        {"nextTrackId", request.value("trackId", request.value("filePath", ""))},
        {"nextItemId", request.value("itemId", "")},
        {"nextMetadata", request.contains("metadata") && request["metadata"].is_object()
            ? request["metadata"] : nlohmann::json::object()},
        {"gaplessAdvance", true},
    };
}

bool pushOpenedStreamingLibav(AudioDaemon::SourceHooks& source,
                              echo::LibavPcmStreamDecoder& stream,
                              double durationSeconds,
                              uint64_t generation,
                              std::stop_token stopToken,
                              const std::function<void()>& onFirstPcm = {})
{
    const int sampleRate = stream.sampleRate();
    const int channels = stream.channels();
    const int64_t maxFrames = durationSeconds > 0.0
        ? static_cast<int64_t>(std::ceil(durationSeconds * static_cast<double>(sampleRate)))
        : 0;

    int64_t framesRead = 0;
    while (!stream.eof() && !stopToken.stop_requested())
    {
        if (source.generation() != generation)
            return false;

        int framesToRead = decodeChunkFrames;
        if (maxFrames > 0)
        {
            const int64_t remainingFrames = maxFrames - framesRead;
            if (remainingFrames <= 0)
                break;
            framesToRead = static_cast<int>(std::min<int64_t>(decodeChunkFrames, remainingFrames));
        }

        auto chunk = stream.readFrames(framesToRead);
        if (chunk.frames <= 0)
            break;

        if (!source.push(chunk.samples.data(), chunk.frames))
            return false;

        if (framesRead == 0 && onFirstPcm)
            onFirstPcm();
        framesRead += chunk.frames;
    }

    return !stopToken.stop_requested();
}

bool pushStreamingLibav(AudioDaemon::SourceHooks& source,
                        const std::string& filePath,
                        double startSeconds,
                        double durationSeconds,
                        int targetSampleRate,
                        int targetChannels,
                        uint64_t generation,
                        std::stop_token stopToken,
                        const echo::LibavInputOptions& inputOptions = {},
                        const std::function<void()>& onFirstPcm = {})
{
    echo::LibavPcmStreamDecoder stream;
    stream.open(filePath, targetSampleRate, targetChannels, inputOptions);
    if (startSeconds > 0.0)
        stream.seek(startSeconds);
    return pushOpenedStreamingLibav(
        source,
        stream,
        durationSeconds,
        generation,
        stopToken,
        onFirstPcm);
}

StreamDecodeOutcome readOpenedStreamingLibav(echo::LibavPcmStreamDecoder& stream,
                                             int framesToRead,
                                             std::stop_token stopToken)
{
    StreamDecodeOutcome outcome;
    outcome.sampleRate = stream.sampleRate();
    outcome.channels = stream.channels();

    while (!stream.eof() && !stopToken.stop_requested() && outcome.frames < framesToRead)
    {
        const int remainingFrames = framesToRead - outcome.frames;
        auto chunk = stream.readFrames(std::min(decodeChunkFrames, remainingFrames));
        if (chunk.frames <= 0)
            break;
        outcome.samples.insert(outcome.samples.end(), chunk.samples.begin(), chunk.samples.end());
        outcome.frames += chunk.frames;
    }

    return outcome;
}

StreamDecodeOutcome readStreamingLibav(const std::string& filePath,
                                       double startSeconds,
                                       int framesToRead,
                                       int targetSampleRate,
                                       int targetChannels,
                                       std::stop_token stopToken,
                                       const echo::LibavInputOptions& inputOptions = {})
{
    echo::LibavPcmStreamDecoder stream;
    stream.open(filePath, targetSampleRate, targetChannels, inputOptions);
    if (startSeconds > 0.0)
        stream.seek(startSeconds);
    return readOpenedStreamingLibav(stream, framesToRead, stopToken);
}

bool parseInputSource(
    const nlohmann::json& source,
    std::string& uri,
    echo::LibavInputOptions& options,
    std::string& error)
{
    if (!source.is_object()) {
        error = "invalid source";
        return false;
    }
    const std::string kind = source.value("kind", "");
    uri = source.value("uri", "");
    const bool http = uri.rfind("https://", 0) == 0 || uri.rfind("http://", 0) == 0;
    if (uri.empty() || (kind == "http") != http || (kind != "http" && kind != "local")) {
        error = "invalid source";
        return false;
    }
    options = {};
    options.network = http;
    if (!http || !source.contains("headers"))
        return true;
    if (!source["headers"].is_object() || source["headers"].size() > 12) {
        error = "invalid source headers";
        return false;
    }
    static const std::unordered_set<std::string> allowedHeaders = {
        "Authorization", "Cookie", "Referer", "Origin", "User-Agent", "Accept",
    };
    size_t totalLength = 0;
    for (const auto& [name, value] : source["headers"].items()) {
        if (!allowedHeaders.contains(name) || !value.is_string()) {
            error = "invalid source header";
            return false;
        }
        const auto text = value.get<std::string>();
        totalLength += name.size() + text.size();
        if (text.size() > 16 * 1024 || totalLength > 32 * 1024
            || text.find('\r') != std::string::npos || text.find('\n') != std::string::npos) {
            error = "invalid source header";
            return false;
        }
        options.headers.emplace_back(name, text);
    }
    return true;
}
}

static bool debugAudioEnabled() {
    static const bool enabled = [] {
        const char* env = std::getenv("ECHO_DEBUG_AUDIO");
        return env && env[0] == '1' && env[1] == '\0';
    }();
    return enabled;
}
#define DEBUG_AUDIO_LOG(fmt, ...) do { \
    if (debugAudioEnabled()) { \
        fprintf(stderr, "[audio-daemon] " fmt "\n", ##__VA_ARGS__); \
    } \
} while(0)

AudioDaemon::AudioDaemon(SourceHooks source,
                         int actualSampleRate,
                         int stdoutFd,
                         std::atomic<bool>& shutdownRequested,
                         DecodePath decodePath,
                         int outputChannels)
    : source_(std::move(source))
    , sampleRate_(actualSampleRate)
    , outputChannels_(std::max(1, outputChannels))
    , stdoutFd_(stdoutFd)
    , decodePath_(decodePath)
    , shutdownSignal_(&shutdownRequested)
    , cacheProducer_({
        source_.pushForGeneration,
        source_.requestStop,
        source_.markInputEnded,
        source_.generation,
        [this]() { return operationId_.load(std::memory_order_acquire); },
        [this](uint64_t operationId, const std::string& message) { emitAudioError(operationId, message); },
    })
{
}

void AudioDaemon::daemonSignalHandler(int /*signum*/)
{
    if (g_shutdownSignal != nullptr)
        g_shutdownSignal->store(true, std::memory_order_release);
}

void AudioDaemon::initialize()
{
    source_.markInputEnded();

    shutdownSignal_->store(false, std::memory_order_release);
    g_shutdownSignal = shutdownSignal_;
    std::signal(SIGTERM, AudioDaemon::daemonSignalHandler);
    std::signal(SIGINT, AudioDaemon::daemonSignalHandler);

    echo::JsonRpcProtocol::setOpenFileCallback(
        [this](const std::string& filePath, int targetSampleRate, double startSeconds, nlohmann::json& result) -> bool {
            currentInputOptions_ = {};
            return onOpenFile(filePath, targetSampleRate, startSeconds, result);
        });
    echo::JsonRpcProtocol::setOpenSourceCallback(
        [this](const nlohmann::json& source, int targetSampleRate, double startSeconds, nlohmann::json& result) -> bool {
            return onOpenSource(source, targetSampleRate, startSeconds, result);
        });

    echo::JsonRpcProtocol::setPauseCallback(
        [this](bool pause) {
            onPause(pause);
        });

    echo::JsonRpcProtocol::setSeekCallback(
        [this](double positionSeconds, nlohmann::json& result) -> bool {
            return onSeek(positionSeconds, result);
        });

    echo::JsonRpcProtocol::setStopCallback(
        [this](nlohmann::json& result) {
            onStop(result);
        });

    echo::JsonRpcProtocol::setPrefetchCallback(
        [this](const std::string& filePath, int targetSampleRate) -> bool {
            return onPrefetch(filePath, targetSampleRate);
        });

    echo::JsonRpcProtocol::setGaplessPrepareCallback(
        [this](const nlohmann::json& request, nlohmann::json& result) -> bool {
            return onGaplessPrepare(request, result);
        });

    echo::JsonRpcProtocol::setAutomixPrepareCallback(
        [this](const nlohmann::json& request, nlohmann::json& result) -> bool {
            return onAutomixPrepare(request, result);
        });

    echo::JsonRpcProtocol::setAutomixCancelCallback(
        [this](const std::string& planId, nlohmann::json& result) -> bool {
            return onAutomixCancel(planId, result);
        });

    echo::JsonRpcProtocol::setAutomixStateCallback(
        [this]() -> nlohmann::json {
            return onAutomixState();
        });

    echo::JsonRpcProtocol::setVolumeCallback(
        [this](float volume) {
            onSetVolume(volume);
        });

    echo::JsonRpcProtocol::setQueueSetCallback(
        [this](const nlohmann::json& items, const std::string& repeatMode, uint64_t revision,
               const std::string& currentItemId) -> bool {
            return onQueueSet(items, repeatMode, revision, currentItemId);
        });

    echo::JsonRpcProtocol::setQueueClearCallback(
        [this]() -> bool {
            onQueueClear();
            return true;
        });
}

bool AudioDaemon::onOpenSource(
    const nlohmann::json& source,
    int targetSampleRate,
    double requestedStartSeconds,
    nlohmann::json& result)
{
    std::string uri;
    echo::LibavInputOptions inputOptions;
    std::string error;
    if (!parseInputSource(source, uri, inputOptions, error)) {
        result["error"] = error;
        return false;
    }
    currentInputOptions_ = std::move(inputOptions);
    return onOpenFile(uri, targetSampleRate, requestedStartSeconds, result);
}

bool AudioDaemon::onOpenFile(const std::string& filePath, int targetSampleRate, double requestedStartSeconds,
                             nlohmann::json& result, bool autonomousAdvance, uint64_t expectedCompletedOperationId)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    // A stop/replacement may win while a drained callback is waiting on this
    // lock. Never let that stale callback create a newer playback operation.
    if (autonomousAdvance
        && operationId_.load(std::memory_order_acquire) != expectedCompletedOperationId) {
        return false;
    }
    if (! autonomousAdvance)
        pendingQueueAdvance_.reset();
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    stopProducersLocked();
    positionFrameOffset_.store(0, std::memory_order_release);
    positionFrameScale_.store(1.0, std::memory_order_release);
    if (autonomousAdvance)
        source_.continueSessionAfterDrain();

    std::shared_ptr<const CachedTrack> cached;
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = cache_.find(filePath);
        if (it != cache_.end() && it->second->complete)
            cached = it->second;
    }
    if (cached) {
            const double durationSeconds = cached->probe.durationSeconds > 0.0 ? cached->probe.durationSeconds : cached->fullDurationSeconds;
            const double normalizedStartSeconds = normalizeStartSeconds(requestedStartSeconds, durationSeconds);
            const double relativeStartSeconds = normalizedStartSeconds - cached->startSeconds;
            double cachedDurationSeconds = cached->durationSeconds;
            if (cached->sampleRate > 0 && cached->channels > 0)
            {
                const auto cachedFrames = static_cast<double>(cached->samples->size()) / static_cast<double>(cached->channels);
                cachedDurationSeconds = cachedFrames / static_cast<double>(cached->sampleRate);
            }
            const bool canUseCache = relativeStartSeconds >= -0.001 && relativeStartSeconds < cachedDurationSeconds;
            if (canUseCache) {
                const auto startFrame = static_cast<int64_t>(std::floor(std::max(0.0, relativeStartSeconds) * cached->sampleRate));
                cacheProducer_.start({cached->samples, cached->channels, startFrame * cached->channels},
                                     operationId, source_.generation());

                currentFilePath_ = filePath;
                result["status"] = "playing";
                result["operationId"] = operationId;
                result["filePath"] = filePath;
                result["sampleRate"] = cached->sampleRate;
                result["sourceSampleRate"] = cached->probe.sampleRate;
                result["channels"] = cached->channels;
                result["durationSeconds"] = durationSeconds;
                result["startSeconds"] = normalizedStartSeconds;
                result["codec"] = cached->probe.codec;
                result["container"] = cached->probe.container;
                return true;
            }
    }

    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        cache_.clear();
    }

    const auto inputOptions = currentInputOptions_;
    const int outSampleRate = targetSampleRate > 0 ? targetSampleRate : sampleRate_;
    sampleRate_ = outSampleRate;
    const int decodeSampleRate = source_.decoderSampleRateFor
        ? source_.decoderSampleRateFor(outSampleRate)
        : outSampleRate;
    std::shared_ptr<echo::LibavPcmStreamDecoder> openedStream;
    echo::AudioProbe probe;
    try {
        if (shouldUseStreamingDecode()) {
            openedStream = std::make_shared<echo::LibavPcmStreamDecoder>();
            openedStream->open(filePath, decodeSampleRate, outputChannels_, inputOptions);
            probe = openedStream->probe();
        } else {
            probe = echo::LibavDecoder::probe(filePath, inputOptions);
        }
    }
    catch (const std::exception& e) {
        result["error"] = std::string("probe failed: ") + e.what();
        result["operationId"] = operationId;
        return false;
    }

    currentFilePath_ = filePath;

    const double normalizedStartSeconds = normalizeStartSeconds(requestedStartSeconds, probe.durationSeconds);
    if (openedStream != nullptr && normalizedStartSeconds > 0.0) {
        try {
            openedStream->seek(normalizedStartSeconds);
        } catch (const std::exception& e) {
            result["error"] = std::string("seek failed: ") + e.what();
            result["operationId"] = operationId;
            return false;
        }
    }
    activeStream_ = openedStream;

    result["status"] = "decoding";
    result["operationId"] = operationId;
    result["filePath"] = filePath;
    result["sampleRate"] = outSampleRate;
    result["sourceSampleRate"] = probe.sampleRate;
    result["channels"] = probe.channels;
    result["durationSeconds"] = probe.durationSeconds;
    result["startSeconds"] = normalizedStartSeconds;
    result["codec"] = probe.codec;
    result["container"] = probe.container;

    decodeThread_ = std::jthread([this, filePath, decodeSampleRate, normalizedStartSeconds, operationId, openedStream](std::stop_token st) {
        const uint64_t gen = source_.generation();
        echo::DecodedAudio legacyAudio;
        try {
            if (shouldUseStreamingDecode()) {
                // Stream directly into the bounded ring. Capturing every decoded
                // float sample here retained an entire track in RAM and made
                // daemon memory grow linearly with playback duration.
                if (openedStream == nullptr || !pushOpenedStreamingLibav(
                        source_,
                        *openedStream,
                        0.0,
                        gen,
                        st,
                        [this, operationId]() { emitFirstPcm(operationId); })) {
                    DEBUG_AUDIO_LOG("streaming openFile decode stopped: operationId=%lu", static_cast<unsigned long>(operationId));
                    return;
                }
            } else {
                echo::LibavDecoder decoder;
                legacyAudio = decoder.decode(filePath, normalizedStartSeconds, 0.0, decodeSampleRate);
                const int totalSamples = static_cast<int>(legacyAudio.samples.size());
                int offset = 0;
                while (offset < totalSamples && !st.stop_requested())
                {
                    if (source_.generation() != gen) {
                        DEBUG_AUDIO_LOG("onOpenFile session expired: operationId=%lu", static_cast<unsigned long>(operationId));
                        return;
                    }
                    const int remaining = totalSamples - offset;
                    const int framesToWrite = std::min(decodeChunkFrames, remaining / legacyAudio.channels);
                    if (framesToWrite <= 0) break;
                    if (!source_.push(legacyAudio.samples.data() + offset, framesToWrite)) {
                        DEBUG_AUDIO_LOG("source_.push stopped in openFile decode: offset=%d, total=%d, operationId=%lu",
                                        offset, totalSamples, static_cast<unsigned long>(operationId));
                        return;
                    }
                    offset += framesToWrite * legacyAudio.channels;
                }
            }
        } catch (const std::exception& e) {
            DEBUG_AUDIO_LOG("onOpenFile decode error: %s, operationId=%lu",
                            e.what(), static_cast<unsigned long>(operationId));
            if (operationId_.load(std::memory_order_acquire) == operationId && !st.stop_requested()) {
                emitAudioError(operationId, e.what());
                source_.markInputEnded();
            }
            return;
        }

        const int decodedFrames = legacyAudio.channels > 0
            ? static_cast<int>(legacyAudio.samples.size() / legacyAudio.channels)
            : 0;
        DEBUG_AUDIO_LOG("onOpenFile decode succeeded: streaming=%d decodedFrames=%d totalSamples=%zu operationId=%lu startSeconds=%.3f",
                        shouldUseStreamingDecode() ? 1 : 0, decodedFrames, legacyAudio.samples.size(),
                        static_cast<unsigned long>(operationId), normalizedStartSeconds);

        if (!st.stop_requested() && operationId_.load(std::memory_order_acquire) == operationId) {
            source_.markInputEnded();
        }
    });

    return true;
}

void AudioDaemon::onPause(bool pause)
{
    paused_ = pause;
    source_.setPaused(pause);
}

bool AudioDaemon::onSeek(double positionSeconds, nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    pendingQueueAdvance_.reset();
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    result["operationId"] = operationId;
    stopProducersLocked();
    positionFrameOffset_.store(0, std::memory_order_release);
    positionFrameScale_.store(1.0, std::memory_order_release);

    if (currentFilePath_.empty()) return false;
    std::string seekFile = currentFilePath_;
    const int requestedPrerollFrames = source_.seekPrerollFrames
        ? std::max(0, source_.seekPrerollFrames())
        : 0;
    const auto replaceSeekBuffer = [this](
        const float* samples,
        int frames,
        int channels,
        int prerollFrames) {
        const int safePrerollFrames =
            std::clamp(prerollFrames, 0, std::max(0, frames));
        if (source_.replaceBufferedAudioWithPreroll)
        {
            return source_.replaceBufferedAudioWithPreroll(
                samples,
                frames,
                safePrerollFrames,
                paused_);
        }
        if (safePrerollFrames >= frames || channels <= 0)
            return 0;
        return source_.replaceBufferedAudio(
            samples
                + static_cast<size_t>(safePrerollFrames)
                    * static_cast<size_t>(channels),
            frames - safePrerollFrames,
            paused_);
    };

    std::vector<float> cachedPrimeSamples;
    std::shared_ptr<const std::vector<float>> cachedSamples;
    int64_t cachedContinuationSample = 0;
    int cachedChannels = 0;
    int cachedPrerollFrames = 0;
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = cache_.find(seekFile);
        if (it != cache_.end() && it->second->complete) {
            const auto& cached = *it->second;
            const double relativeSeconds = positionSeconds - cached.startSeconds;
            const double cachedDuration = cached.cachedDurationSeconds > 0.0
                ? cached.cachedDurationSeconds
                : (cached.sampleRate > 0 && cached.channels > 0
                    ? (static_cast<double>(cached.samples->size()) / static_cast<double>(cached.channels)) / static_cast<double>(cached.sampleRate)
                    : 0.0);
            if (relativeSeconds >= -0.001 && relativeSeconds < cachedDuration - 0.001) {
                const int startFrame = static_cast<int>(std::max(0.0, relativeSeconds) * cached.sampleRate);
                const int prerollStartFrame =
                    std::max(0, startFrame - requestedPrerollFrames);
                cachedPrerollFrames = startFrame - prerollStartFrame;
                int offset = prerollStartFrame * cached.channels;
                const int totalSamples = static_cast<int>(cached.samples->size());
                const int firstFrames = std::min(
                    seekPrimeFrames + cachedPrerollFrames,
                    std::max(0, (totalSamples - offset) / cached.channels));
                const int primeSamples = firstFrames * cached.channels;
                if (primeSamples <= 0) return false;
                cachedPrimeSamples.assign(cached.samples->begin() + offset, cached.samples->begin() + offset + primeSamples);
                offset += primeSamples;
                cachedSamples = cached.samples;
                cachedContinuationSample = offset;
                cachedChannels = cached.channels;
            }
        }
    }

    if (!cachedPrimeSamples.empty() && cachedChannels > 0) {
        const int primeFrames = static_cast<int>(cachedPrimeSamples.size()) / cachedChannels;
        const int replacedFrames = replaceSeekBuffer(
            cachedPrimeSamples.data(),
            primeFrames,
            cachedChannels,
            cachedPrerollFrames);
        if (replacedFrames <= 0) return false;
        const uint64_t gen = source_.generation();
        cacheProducer_.start({std::move(cachedSamples), cachedChannels, cachedContinuationSample},
                             operationId, gen);
        return true;
    }

    const int decodeSampleRate = source_.decoderSampleRateFor
        ? source_.decoderSampleRateFor(sampleRate_)
        : sampleRate_;
    const double prerollSeconds = decodeSampleRate > 0
        ? static_cast<double>(requestedPrerollFrames)
            / static_cast<double>(decodeSampleRate)
        : 0.0;
    const double seekDecodeStartSeconds =
        std::max(0.0, positionSeconds - prerollSeconds);
    StreamDecodeOutcome streamingPrimeAudio;
    std::shared_ptr<echo::LibavPcmStreamDecoder> seekStream;
    echo::DecodedAudio primeAudio;
    try {
        if (shouldUseStreamingDecode()) {
            seekStream = std::make_shared<echo::LibavPcmStreamDecoder>();
            seekStream->open(seekFile, decodeSampleRate, outputChannels_, currentInputOptions_);
            if (seekDecodeStartSeconds > 0.0)
                seekStream->seek(seekDecodeStartSeconds);
            streamingPrimeAudio = readOpenedStreamingLibav(
                *seekStream,
                seekPrimeFrames + requestedPrerollFrames,
                std::stop_token{});
        } else {
            echo::LibavDecoder decoder;
            primeAudio = decoder.decode(
                seekFile,
                seekDecodeStartSeconds,
                seekPrimeSeconds + (positionSeconds - seekDecodeStartSeconds),
                decodeSampleRate);
        }
    } catch (const std::exception& e) {
        DEBUG_AUDIO_LOG("seek prime decode failed: %s", e.what());
        return false;
    }
    const int primeChannels = shouldUseStreamingDecode() ? streamingPrimeAudio.channels : primeAudio.channels;
    const int primeSampleRate = shouldUseStreamingDecode() ? streamingPrimeAudio.sampleRate : primeAudio.sampleRate;
    const auto& primeSamples = shouldUseStreamingDecode() ? streamingPrimeAudio.samples : primeAudio.samples;
    const int primeFrames = primeChannels > 0 ? static_cast<int>(primeSamples.size() / primeChannels) : 0;
    const int actualPrerollFrames = primeSampleRate > 0
        ? std::min(
            primeFrames,
            static_cast<int>(std::llround(
                (positionSeconds - seekDecodeStartSeconds)
                * static_cast<double>(primeSampleRate))))
        : 0;
    const int replacedFrames = replaceSeekBuffer(
        primeSamples.data(),
        primeFrames,
        primeChannels,
        actualPrerollFrames);
    if (replacedFrames <= 0) return false;
    activeStream_ = seekStream;
    const int continuationSampleRate = primeSampleRate > 0 ? primeSampleRate : sampleRate_;
    const double continuationSeconds = positionSeconds + static_cast<double>(replacedFrames) / static_cast<double>(continuationSampleRate);
    decodeThread_ = std::jthread([this, filePath = seekFile, continuationSeconds, operationId, decodeSampleRate, seekStream](std::stop_token st) {
        const uint64_t gen = source_.generation();
        try {
            if (shouldUseStreamingDecode()) {
                if (seekStream == nullptr || !pushOpenedStreamingLibav(
                        source_,
                        *seekStream,
                        0.0,
                        gen,
                        st)) {
                    DEBUG_AUDIO_LOG("streaming seek decode stopped: operationId=%lu", static_cast<unsigned long>(operationId));
                    return;
                }
                DEBUG_AUDIO_LOG("seek streaming decode succeeded: operationId=%lu, positionSeconds=%.3f",
                                static_cast<unsigned long>(operationId), continuationSeconds);
            } else {
                echo::LibavDecoder decoder;
                echo::DecodedAudio audio = decoder.decode(filePath, continuationSeconds, 0.0, decodeSampleRate);
                const int decodedFrames = audio.channels > 0 ? static_cast<int>(audio.samples.size() / audio.channels) : 0;
                DEBUG_AUDIO_LOG("seek decode succeeded: decodedFrames=%d, totalSamples=%zu, sampleRate=%d, channels=%d, operationId=%lu, positionSeconds=%.3f",
                                decodedFrames, audio.samples.size(), audio.sampleRate, audio.channels,
                                static_cast<unsigned long>(operationId), continuationSeconds);
                const int totalSamples = static_cast<int>(audio.samples.size());
                int offset = 0;
                while (offset < totalSamples && !st.stop_requested()) {
                    if (source_.generation() != gen) {
                        DEBUG_AUDIO_LOG("seek session expired: operationId=%lu", static_cast<unsigned long>(operationId));
                        return;
                    }
                    const int remaining = totalSamples - offset;
                    const int framesToWrite = std::min(decodeChunkFrames, remaining / audio.channels);
                    if (framesToWrite <= 0) break;
                    if (!source_.push(audio.samples.data() + offset, framesToWrite)) {
                        DEBUG_AUDIO_LOG("source_.push stopped in seek decode: offset=%d, total=%d, operationId=%lu",
                                        offset, totalSamples, static_cast<unsigned long>(operationId));
                        return;
                    }
                    offset += framesToWrite * audio.channels;
                }
            }
        } catch (const std::exception& e) {
            DEBUG_AUDIO_LOG("seek decode failed: %s", e.what());
            if (operationId_.load(std::memory_order_acquire) == operationId && !st.stop_requested())
                emitAudioError(operationId, e.what());
        }
        if (!st.stop_requested() && operationId_.load(std::memory_order_acquire) == operationId) {
            source_.markInputEnded();
        }
    });
    return true;
}

void AudioDaemon::onStop(nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    pendingQueueAdvance_.reset();
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    result["operationId"] = operationId;
    // Keep the queue snapshot for later playback, but make this stop operation
    // terminal so its eventual drain cannot consume the next queued item.
    autoAdvanceSuppressedOperationId_.store(operationId, std::memory_order_release);
    stopProducersLocked();
    positionFrameOffset_.store(0, std::memory_order_release);
    positionFrameScale_.store(1.0, std::memory_order_release);
    source_.markInputEnded();
}

void AudioDaemon::onSetVolume(float volume)
{
    if (source_.setVolume)
        source_.setVolume(volume);
}

bool AudioDaemon::onPrefetch(const std::string& filePath, int targetSampleRate)
{
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        if (cache_.count(filePath)) return true;
    }
    const int outputRate = targetSampleRate > 0 ? targetSampleRate : sampleRate_;
    int sr = source_.decoderSampleRateFor ? source_.decoderSampleRateFor(outputRate) : outputRate;
    if (prefetchThread_.joinable())
        prefetchThread_.request_stop();
    prefetchThread_ = std::jthread([this, filePath, sr](std::stop_token st) {
        echo::AudioProbe probe;
        try { probe = echo::LibavDecoder::probe(filePath); }
        catch (...) { return; }
        double preDuration = std::min(1.0, probe.durationSeconds);
        if (preDuration <= 0) return;
        if (st.stop_requested()) return;

        StreamDecodeOutcome streamingAudio;
        echo::DecodedAudio audio;
        try {
            if (shouldUseStreamingDecode()) {
                const int prefetchFrames = static_cast<int>(std::ceil(preDuration * static_cast<double>(sr)));
                streamingAudio = readStreamingLibav(filePath, 0.0, prefetchFrames, sr, outputChannels_, st);
            } else {
                echo::LibavDecoder decoder;
                audio = decoder.decode(filePath, 0.0, preDuration, sr);
            }
        }
        catch (...) { return; }
        if (st.stop_requested()) return;

        std::lock_guard<std::mutex> lock(cacheMutex_);
        CachedTrack entry;
        if (shouldUseStreamingDecode()) {
            entry.samples = std::make_shared<const std::vector<float>>(std::move(streamingAudio.samples));
            entry.sampleRate = streamingAudio.sampleRate;
            entry.channels = streamingAudio.channels;
        } else {
            entry.samples = std::make_shared<const std::vector<float>>(std::move(audio.samples));
            entry.sampleRate = audio.sampleRate;
            entry.channels = audio.channels;
        }
        entry.durationSeconds = preDuration;
        entry.startSeconds = 0.0;
        entry.probe = probe;
        entry.complete = false;
        entry.cachedStartSeconds = 0.0;
        entry.cachedDurationSeconds = preDuration;
        entry.fullDurationSeconds = probe.durationSeconds;
        const size_t incomingSamples = entry.samples ? entry.samples->size() : 0;
        if (incomingSamples > maxPrefetchCacheSamples)
            return;
        auto cachedSamples = [this]() {
            size_t total = 0;
            for (const auto& item : cache_)
                if (item.second && item.second->samples)
                    total += item.second->samples->size();
            return total;
        };
        while (!cache_.empty()
               && (cache_.size() >= maxPrefetchCacheEntries
                   || cachedSamples() + incomingSamples > maxPrefetchCacheSamples))
            cache_.erase(cache_.begin());
        cache_[filePath] = std::make_shared<const CachedTrack>(std::move(entry));
    });
    return true;
}

bool AudioDaemon::onGaplessPrepare(const nlohmann::json& request, nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    const std::string filePath = request.value("filePath", "");
    if (filePath.empty() || currentFilePath_.empty()) {
        result["error"] = "invalid gapless source";
        return false;
    }

    cancelGaplessLocked();
    const int outputRate = request.value("sampleRate", sampleRate_);
    const int decodeSampleRate = source_.decoderSampleRateFor
        ? source_.decoderSampleRateFor(outputRate > 0 ? outputRate : sampleRate_)
        : (outputRate > 0 ? outputRate : sampleRate_);
    const uint64_t currentOperationId = operationId_.load(std::memory_order_acquire);
    auto stream = std::make_shared<echo::LibavPcmStreamDecoder>();
    echo::AudioProbe probe;
    StreamDecodeOutcome prime;
    try {
        stream->open(filePath, decodeSampleRate, outputChannels_);
        probe = stream->probe();
        prime = readOpenedStreamingLibav(*stream, decodeChunkFrames, std::stop_token{});
    } catch (const std::exception& e) {
        result["error"] = std::string("gapless probe failed: ") + e.what();
        return false;
    }
    if (prime.frames <= 0 || prime.samples.empty()) {
        result["error"] = "gapless source produced no PCM";
        return false;
    }
    if (! source_.prepareGapless || ! source_.prepareGapless()) {
        result["error"] = "gapless pipeline unavailable";
        return false;
    }
    if (! source_.pushGaplessNext
        || ! source_.pushGaplessNext(prime.samples.data(), prime.frames)) {
        if (source_.cancelGapless) source_.cancelGapless();
        result["error"] = "gapless prime buffer rejected";
        return false;
    }

    const int preparedOutputRate = outputRate > 0 ? outputRate : sampleRate_;
    const uint64_t gaplessFrameScale =
        decodeSampleRate > 0
            && preparedOutputRate >= decodeSampleRate
            && preparedOutputRate % decodeSampleRate == 0
        ? static_cast<uint64_t>(
            preparedOutputRate / decodeSampleRate)
        : 1;
    const nlohmann::json firstTrackInfo = createGaplessTrackInfo(
        request,
        probe,
        preparedOutputRate,
        outputChannels_);
    std::vector<nlohmann::json> followingRequests;
    if (request.contains("following") && request["following"].is_array()) {
        const auto& following = request["following"];
        const size_t count = std::min<size_t>(following.size(), 30);
        followingRequests.reserve(count);
        for (size_t index = 0; index < count; ++index) {
            if (following[index].is_object() && ! following[index].value("filePath", "").empty())
                followingRequests.push_back(following[index]);
        }
    }

    const uint64_t preparationId = gaplessPreparationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    {
        std::lock_guard<std::mutex> stateLock(gaplessStateMutex_);
        preparedGapless_.active = true;
        preparedGapless_.currentOperationId = currentOperationId;
        preparedGapless_.nextTransitionIndex = 0;
        preparedGapless_.tracks = {{0, firstTrackInfo}};
    }
    activeGaplessStream_ = stream;
    gaplessThread_ = std::jthread([
        this,
        stream,
        preparationId,
        decodeSampleRate,
        preparedOutputRate,
        gaplessFrameScale,
        followingRequests = std::move(followingRequests),
        firstTrackFrames =
            static_cast<uint64_t>(prime.frames) * gaplessFrameScale
    ](std::stop_token st) mutable {
        bool completed = false;
        uint64_t sequenceFrames = firstTrackFrames;
        try {
            while (! stream->eof() && ! st.stop_requested()) {
                auto chunk = stream->readFrames(decodeChunkFrames);
                if (chunk.frames <= 0)
                    break;
                if (! source_.pushGaplessNext
                    || ! source_.pushGaplessNext(chunk.samples.data(), chunk.frames))
                    break;
                sequenceFrames +=
                    static_cast<uint64_t>(chunk.frames)
                    * gaplessFrameScale;
            }

            for (const auto& followingRequest : followingRequests) {
                if (st.stop_requested()
                    || gaplessPreparationId_.load(std::memory_order_acquire) != preparationId)
                    break;

                auto followingStream = std::make_shared<echo::LibavPcmStreamDecoder>();
                echo::AudioProbe followingProbe;
                StreamDecodeOutcome followingPrime;
                try {
                    followingStream->open(
                        followingRequest.value("filePath", ""),
                        decodeSampleRate,
                        outputChannels_);
                    followingProbe = followingStream->probe();
                    followingPrime = readOpenedStreamingLibav(
                        *followingStream,
                        decodeChunkFrames,
                        st);
                } catch (const std::exception& e) {
                    DEBUG_AUDIO_LOG("gapless following track skipped: %s", e.what());
                    break;
                }
                if (followingPrime.frames <= 0 || followingPrime.samples.empty())
                    break;

                const nlohmann::json followingInfo = createGaplessTrackInfo(
                    followingRequest,
                    followingProbe,
                    preparedOutputRate,
                    outputChannels_);
                const uint64_t followingStartFrame = sequenceFrames;
                if (! source_.pushGaplessNext
                    || ! source_.pushGaplessNext(followingPrime.samples.data(), followingPrime.frames))
                    break;
                {
                    std::lock_guard<std::mutex> stateLock(gaplessStateMutex_);
                    if (! preparedGapless_.active
                        || gaplessPreparationId_.load(std::memory_order_acquire) != preparationId)
                        break;
                    preparedGapless_.tracks.push_back({followingStartFrame, followingInfo});
                }
                sequenceFrames +=
                    static_cast<uint64_t>(followingPrime.frames)
                    * gaplessFrameScale;
                while (! followingStream->eof() && ! st.stop_requested()) {
                    auto chunk = followingStream->readFrames(decodeChunkFrames);
                    if (chunk.frames <= 0)
                        break;
                    if (! source_.pushGaplessNext
                        || ! source_.pushGaplessNext(chunk.samples.data(), chunk.frames))
                        break;
                    sequenceFrames +=
                        static_cast<uint64_t>(chunk.frames)
                        * gaplessFrameScale;
                }
            }
            completed = ! st.stop_requested();
        } catch (const std::exception& e) {
            DEBUG_AUDIO_LOG("gapless continuation decode failed: %s", e.what());
        }
        if (gaplessPreparationId_.load(std::memory_order_acquire) == preparationId
            && source_.markGaplessNextEnded) {
            source_.markGaplessNextEnded();
        }
        if (! completed)
            DEBUG_AUDIO_LOG("gapless continuation ended before decoder EOF");
    });

    result = firstTrackInfo;
    result["prepared"] = true;
    result["operationId"] = currentOperationId;
    return true;
}

bool AudioDaemon::onAutomixPrepare(const nlohmann::json& request, nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    cancelAutomixLocked("replaced");

    if (! request.contains("plan") || ! request["plan"].is_object()
        || ! request.contains("nextSource") || ! request["nextSource"].is_object()) {
        result["error"] = "invalid automix request";
        return false;
    }
    const auto& plan = request["plan"];
    const std::string planId = plan.value("planId", "");
    const std::string fromItemId = plan.value("fromItemId", "");
    const std::string toItemId = plan.value("toItemId", "");
    const std::string fromTrackId = plan.value("fromTrackId", "");
    const std::string toTrackId = plan.value("toTrackId", "");
    const std::string mode = plan.value("mode", "");
    const uint64_t queueRevision = plan.value("queueRevision", static_cast<uint64_t>(0));
    const uint64_t fadeStartFrame = plan.value("fadeStartOutputFrame", static_cast<uint64_t>(0));
    const uint64_t fadeEndFrame = plan.value("fadeEndOutputFrame", static_cast<uint64_t>(0));
    const uint64_t commitFrame = plan.value("commitOutputFrame", static_cast<uint64_t>(0));
    const uint64_t overlapFrames = plan.value("overlapFrames", static_cast<uint64_t>(0));
    const int requestedMixRate = plan.value("mixSampleRate", sampleRate_);
    const double nextStartSeconds = plan.value("nextStartSeconds", 0.0);
    const double tempoRatio = plan.value("tempoRatio", 1.0);
    if (plan.value("version", 0) != 2 || planId.empty() || fromItemId.empty() || toItemId.empty()
        || fromTrackId.empty() || toTrackId.empty() || queueRevision == 0
        || requestedMixRate <= 0 || ! std::isfinite(nextStartSeconds)
        || nextStartSeconds < 0.0 || ! std::isfinite(tempoRatio)) {
        result["error"] = "invalid automix plan";
        return false;
    }
    if (mode == "gapless_fallback") {
        result = {
            {"acknowledged", true},
            {"state", "fallback"},
            {"planId", planId},
            {"operationId", operationId_.load(std::memory_order_acquire)},
            {"reason", plan.value("fallbackReason", "gapless_fallback")},
        };
        return true;
    }
    if (overlapFrames < 2 || fadeEndFrame <= fadeStartFrame
        || fadeEndFrame - fadeStartFrame != overlapFrames
        || commitFrame < fadeStartFrame || commitFrame > fadeEndFrame) {
        result["error"] = "invalid automix frame schedule";
        return false;
    }
    if (tempoRatio < 0.985 || tempoRatio > 1.015) {
        result["error"] = "automix tempo ratio outside native WSOLA range";
        return false;
    }

    {
        std::lock_guard<std::mutex> queueLock(queueMutex_);
        if (queueRevision_ != queueRevision || currentQueueIndex_ < 0
            || currentQueueIndex_ >= static_cast<int>(queue_.size())
            || queue_[currentQueueIndex_].itemId != fromItemId) {
            result["error"] = "automix queue revision or current item mismatch";
            return false;
        }
        int nextIndex = currentQueueIndex_ + 1;
        if (nextIndex >= static_cast<int>(queue_.size()) && repeatMode_ == "all")
            nextIndex = 0;
        if (repeatMode_ == "one" || nextIndex < 0 || nextIndex >= static_cast<int>(queue_.size())
            || queue_[nextIndex].itemId != toItemId || queue_[nextIndex].trackId != toTrackId) {
            result["error"] = "automix target is not the exact next queue item";
            return false;
        }
    }

    std::string uri;
    echo::LibavInputOptions inputOptions;
    std::string parseError;
    if (! parseInputSource(request["nextSource"], uri, inputOptions, parseError)) {
        result["error"] = parseError;
        return false;
    }
    auto stream = std::make_shared<echo::LibavPcmStreamDecoder>();
    echo::AudioProbe probe;
    StreamDecodeOutcome prime;
    const int decodeSampleRate = source_.decoderSampleRateFor
        ? source_.decoderSampleRateFor(requestedMixRate)
        : requestedMixRate;
    try {
        stream->open(uri, decodeSampleRate, outputChannels_, inputOptions);
        probe = stream->probe();
        if (nextStartSeconds > 0.0)
            stream->seek(nextStartSeconds);
        prime = readOpenedStreamingLibav(*stream, decodeChunkFrames, std::stop_token{});
    } catch (const std::exception& error) {
        result["error"] = std::string("automix next deck prepare failed: ") + error.what();
        return false;
    }
    if (prime.frames <= 0 || prime.samples.empty()) {
        result["error"] = "automix next deck produced no PCM";
        return false;
    }
    if (! source_.prepareAutomixFrames
        || ! source_.prepareAutomixFrames(
            fadeStartFrame,
            overlapFrames,
            plan.value("currentGainDb", 0.0),
            plan.value("nextGainDb", 0.0),
            plan.value("currentReplayGainDb", 0.0),
            plan.value("nextReplayGainDb", 0.0))) {
        result["error"] = "automix pipeline unavailable";
        return false;
    }
    auto tempoProcessor = std::make_shared<AutomixTempoProcessor>(
        decodeSampleRate,
        outputChannels_,
        tempoRatio);
    const std::vector<float> preparedPrime = tempoProcessor->process(
        prime.samples.data(),
        prime.frames);
    const float* primeSamples = tempoProcessor->active()
        ? preparedPrime.data()
        : prime.samples.data();
    const int primeFrames = tempoProcessor->active()
        ? static_cast<int>(preparedPrime.size() / static_cast<size_t>(outputChannels_))
        : prime.frames;
    if (primeFrames <= 0 || ! source_.pushAutomixNext
        || ! source_.pushAutomixNext(primeSamples, primeFrames)) {
        if (source_.cancelAutomix) source_.cancelAutomix();
        result["error"] = "automix prime buffer rejected";
        return false;
    }

    const uint64_t preparationId = automixPreparationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    const uint64_t currentOperationId = operationId_.load(std::memory_order_acquire);
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        preparedAutomix_ = {
            "armed",
            planId,
            "",
            queueRevision,
            currentOperationId,
            fadeStartFrame,
            fadeEndFrame,
            commitFrame,
            nextStartSeconds,
            false,
            plan,
            {
                {"filePath", uri},
                {"nextItemId", toItemId},
                {"nextTrackId", toTrackId},
                {"fromItemId", fromItemId},
                {"fromTrackId", fromTrackId},
                {"sampleRate", requestedMixRate},
                {"sourceSampleRate", probe.sampleRate},
                {"channels", outputChannels_},
                {"durationSeconds", probe.durationSeconds},
                {"startSeconds", nextStartSeconds},
                {"codec", probe.codec},
                {"container", probe.container},
                {"bitDepth", probe.bitDepth},
            },
        };
    }
    activeAutomixStream_ = stream;
    automixThread_ = std::jthread([this, stream, tempoProcessor, preparationId](std::stop_token stopToken) {
        bool completed = false;
        try {
            while (! stream->eof() && ! stopToken.stop_requested()
                && automixPreparationId_.load(std::memory_order_acquire) == preparationId) {
                auto chunk = stream->readFrames(decodeChunkFrames);
                if (chunk.frames <= 0)
                    break;
                const std::vector<float> prepared = tempoProcessor->process(
                    chunk.samples.data(),
                    chunk.frames);
                const float* samples = tempoProcessor->active()
                    ? prepared.data()
                    : chunk.samples.data();
                const int frames = tempoProcessor->active()
                    ? static_cast<int>(prepared.size() / static_cast<size_t>(outputChannels_))
                    : chunk.frames;
                if (frames == 0)
                    continue;
                if (! source_.pushAutomixNext
                    || ! source_.pushAutomixNext(samples, frames))
                    break;
            }
            if (! stopToken.stop_requested() && tempoProcessor->active()) {
                const std::vector<float> tail = tempoProcessor->process(nullptr, 0, true);
                const int tailFrames = static_cast<int>(
                    tail.size() / static_cast<size_t>(outputChannels_));
                if (tailFrames > 0 && source_.pushAutomixNext)
                    source_.pushAutomixNext(tail.data(), tailFrames);
            }
            completed = stream->eof() && ! stopToken.stop_requested();
        } catch (const std::exception& error) {
            DEBUG_AUDIO_LOG("automix next deck decode failed: %s", error.what());
        }
        const bool stillCurrent = automixPreparationId_.load(std::memory_order_acquire) == preparationId;
        if (stillCurrent && ! completed && source_.failAutomixNext)
            source_.failAutomixNext(static_cast<uint64_t>(std::max(1, sampleRate_ / 50)));
        if (stillCurrent && source_.markAutomixNextEnded)
            source_.markAutomixNextEnded();
        if (! completed) {
            std::lock_guard<std::mutex> stateLock(automixStateMutex_);
            if (preparedAutomix_.planId.size() > 0
                && (preparedAutomix_.state == "armed" || preparedAutomix_.state == "committed")) {
                preparedAutomix_.state = "fallback";
                preparedAutomix_.reason = "next_deck_decode_failed";
            }
        }
    });

    result = {
        {"acknowledged", true},
        {"state", "armed"},
        {"planId", planId},
        {"operationId", currentOperationId},
        {"reason", nullptr},
    };
    return true;
}

bool AudioDaemon::onAutomixCancel(const std::string& planId, nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        if (! preparedAutomix_.planId.empty() && preparedAutomix_.planId != planId) {
            result["error"] = "automix plan id mismatch";
            return false;
        }
    }
    cancelAutomixLocked("cancelled");
    result = {
        {"acknowledged", true},
        {"state", "idle"},
        {"planId", planId},
    };
    return true;
}

nlohmann::json AudioDaemon::onAutomixState()
{
    std::lock_guard<std::mutex> stateLock(automixStateMutex_);
    return {
        {"state", preparedAutomix_.state},
        {"planId", preparedAutomix_.planId.empty() ? nlohmann::json(nullptr) : nlohmann::json(preparedAutomix_.planId)},
        {"queueRevision", preparedAutomix_.queueRevision == 0 ? nlohmann::json(nullptr) : nlohmann::json(preparedAutomix_.queueRevision)},
        {"operationId", preparedAutomix_.operationId == 0 ? nlohmann::json(nullptr) : nlohmann::json(preparedAutomix_.operationId)},
        {"reason", preparedAutomix_.reason.empty() ? nlohmann::json(nullptr) : nlohmann::json(preparedAutomix_.reason)},
    };
}

bool AudioDaemon::shouldUseStreamingDecode() const
{
    return decodePath_ == DecodePath::StreamingLibav;
}

void AudioDaemon::stopDecodeThreadLocked()
{
    if (activeStream_ != nullptr)
        activeStream_->cancel();
    if (decodeThread_.joinable()) {
        source_.requestStop();
        decodeThread_.request_stop();
        decodeThread_ = std::jthread();
    }
    activeStream_.reset();
}

void AudioDaemon::stopProducersLocked()
{
    cancelAutomixLocked("playback_operation_changed");
    cancelGaplessLocked();
    cacheProducer_.cancel(operationId_.load(std::memory_order_acquire) - 1);
    cacheProducer_.join();
    stopDecodeThreadLocked();
}

uint64_t AudioDaemon::cancelPendingQueueAdvanceLocked()
{
    if (! pendingQueueAdvance_)
        return 0;

    const uint64_t fromOperationId = pendingQueueAdvance_->fromOperationId;
    const uint64_t targetOperationId = pendingQueueAdvance_->targetOperationId;
    pendingQueueAdvance_.reset();
    if (operationId_.load(std::memory_order_acquire) == targetOperationId)
    {
        stopProducersLocked();
        source_.markInputEnded();
        autoAdvanceSuppressedOperationId_.store(targetOperationId, std::memory_order_release);
    }
    return fromOperationId;
}

void AudioDaemon::cancelAutomixLocked(const std::string& reason)
{
    automixPreparationId_.fetch_add(1, std::memory_order_acq_rel);
    if (activeAutomixStream_ != nullptr)
        activeAutomixStream_->cancel();
    if (source_.cancelAutomix)
        source_.cancelAutomix();
    if (automixThread_.joinable()) {
        automixThread_.request_stop();
        automixThread_ = std::jthread();
    }
    activeAutomixStream_.reset();
    std::lock_guard<std::mutex> stateLock(automixStateMutex_);
    preparedAutomix_ = {};
    if (! reason.empty() && reason != "replaced" && reason != "playback_operation_changed") {
        preparedAutomix_.reason = reason;
    }
}

void AudioDaemon::emitAudioError(uint64_t operationId, const std::string& message)
{
    std::string notification = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.error", {{"operationId", operationId}, {"message", message}}) + "\n";
    std::lock_guard<std::mutex> lock(rpcWriteMutex_);
    write(stdoutFd_, notification.data(), notification.size());
}

void AudioDaemon::cancelGaplessLocked()
{
    gaplessPreparationId_.fetch_add(1, std::memory_order_acq_rel);
    if (activeGaplessStream_ != nullptr)
        activeGaplessStream_->cancel();
    if (source_.cancelGapless)
        source_.cancelGapless();
    if (gaplessThread_.joinable()) {
        gaplessThread_.request_stop();
        gaplessThread_ = std::jthread();
    }
    activeGaplessStream_.reset();
    {
        std::lock_guard<std::mutex> stateLock(gaplessStateMutex_);
        preparedGapless_ = {};
    }
}

void AudioDaemon::emitFirstPcm(uint64_t operationId)
{
    std::string notification = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.firstPcm", {{"operationId", operationId}}) + "\n";
    std::lock_guard<std::mutex> lock(rpcWriteMutex_);
    if (firstPcmNotifiedOperationId_ == operationId)
        return;
    firstPcmNotifiedOperationId_ = operationId;
    write(stdoutFd_, notification.data(), notification.size());
}

void AudioDaemon::queueLevelMeter(const echo::LevelMeterSnapshot& snapshot) noexcept
{
    const size_t channels = std::min({
        snapshot.peakDb.size(),
        snapshot.rmsDb.size(),
        maximumLevelMeterChannels_,
    });
    if (channels == 0)
        return;

    const uint64_t writeSequence = pendingLevelMeterSequence_.load(std::memory_order_seq_cst) + 1;
    pendingLevelMeterSequence_.store(writeSequence, std::memory_order_seq_cst);
    for (size_t channel = 0; channel < channels; ++channel)
    {
        pendingLevelMeterPeakDb_[channel].store(snapshot.peakDb[channel], std::memory_order_relaxed);
        pendingLevelMeterRmsDb_[channel].store(snapshot.rmsDb[channel], std::memory_order_relaxed);
    }
    pendingLevelMeterChannels_.store(channels, std::memory_order_relaxed);
    pendingLevelMeterTimestampMs_.store(snapshot.timestampMs, std::memory_order_relaxed);
    pendingLevelMeterOperationId_.store(operationId_.load(std::memory_order_relaxed), std::memory_order_relaxed);
    pendingLevelMeterSequence_.store(writeSequence + 1, std::memory_order_seq_cst);
}

void AudioDaemon::flushLevelMeter()
{
    const uint64_t sequenceBefore = pendingLevelMeterSequence_.load(std::memory_order_seq_cst);
    if (sequenceBefore == flushedLevelMeterSequence_ || (sequenceBefore & 1u) != 0)
        return;

    const size_t channels = std::min(
        pendingLevelMeterChannels_.load(std::memory_order_relaxed),
        maximumLevelMeterChannels_);
    std::vector<float> peakDb(channels);
    std::vector<float> rmsDb(channels);
    for (size_t channel = 0; channel < channels; ++channel)
    {
        peakDb[channel] = pendingLevelMeterPeakDb_[channel].load(std::memory_order_relaxed);
        rmsDb[channel] = pendingLevelMeterRmsDb_[channel].load(std::memory_order_relaxed);
    }
    const double timestampMs = pendingLevelMeterTimestampMs_.load(std::memory_order_relaxed);
    const uint64_t operationId = pendingLevelMeterOperationId_.load(std::memory_order_relaxed);
    const uint64_t sequenceAfter = pendingLevelMeterSequence_.load(std::memory_order_seq_cst);
    if (channels == 0 || sequenceAfter != sequenceBefore || (sequenceAfter & 1u) != 0)
        return;

    flushedLevelMeterSequence_ = sequenceAfter;
    nlohmann::json params {
        {"operationId", operationId},
        {"peakDb", peakDb},
        {"rmsDb", rmsDb},
        {"timestampMs", timestampMs},
    };
    const std::string notification = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.levelMeter", params) + "\n";
    std::lock_guard<std::mutex> lock(rpcWriteMutex_);
    write(stdoutFd_, notification.data(), notification.size());
}

void AudioDaemon::emitPosition(uint64_t framesPlayed, int bufferedFrames, bool inputEnded)
{
    maybeCommitAutomix(framesPlayed);
    nlohmann::json gaplessAdvance;
    while (maybeCommitGaplessAdvance(framesPlayed, gaplessAdvance)) {
        emitEndedWithAdvance(gaplessAdvance);
        gaplessAdvance = nlohmann::json{};
    }

    const uint64_t operationId = operationId_.load(std::memory_order_acquire);
    const uint64_t frameOffset = positionFrameOffset_.load(std::memory_order_acquire);
    const uint64_t outputTrackFrames = framesPlayed >= frameOffset ? framesPlayed - frameOffset : 0;
    const double frameScale = positionFrameScale_.load(std::memory_order_acquire);
    const uint64_t trackFramesPlayed = static_cast<uint64_t>(std::llround(
        static_cast<double>(outputTrackFrames) * frameScale));
    if (trackFramesPlayed > 0)
    {
        std::lock_guard<std::mutex> operationLock(operationMutex_);
        if (pendingQueueAdvance_
            && pendingQueueAdvance_->targetOperationId == operationId)
        {
            // Keep operation ownership through publication. A user stop/open
            // cannot invalidate this commit between the operation check and
            // the queueAdvance write.
            emitEndedWithAdvance(pendingQueueAdvance_->payload);
            pendingQueueAdvance_.reset();
        }
    }

    const std::string startedNotification = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.started", {{"operationId", operationId}}) + "\n";
    nlohmann::json positionParams {
        {"framesPlayed", trackFramesPlayed},
        {"bufferedFrames", bufferedFrames},
        {"inputEnded", inputEnded},
        {"operationId", operationId},
    };
    if (source_.processingTelemetry)
        positionParams["processing"] = source_.processingTelemetry();
    std::string notif = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.position", positionParams) + "\n";
    {
        std::lock_guard<std::mutex> lock(rpcWriteMutex_);
        if (trackFramesPlayed > 0 && startedNotifiedOperationId_ != operationId) {
            startedNotifiedOperationId_ = operationId;
            write(stdoutFd_, startedNotification.data(), startedNotification.size());
        }
        write(stdoutFd_, notif.data(), notif.size());
    }
}

void AudioDaemon::maybeCommitAutomix(uint64_t absoluteFramesPlayed)
{
    nlohmann::json event;
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        if ((preparedAutomix_.state != "armed" && preparedAutomix_.state != "committed")
            || preparedAutomix_.commitEmitted)
            return;

        // The audio callback may defer the fade until Deck B has PCM ready. The
        // callback-owned frame range is therefore authoritative, not the
        // planner's requested range.
        if (! source_.automixActive || ! source_.automixActive())
            return;
        // Once Deck B has produced audible output, ordinary queue edits may
        // update future items but may no longer erase this transition.
        preparedAutomix_.state = "committed";
        const uint64_t actualFadeStart = source_.automixFadeStartFrame
            ? source_.automixFadeStartFrame()
            : preparedAutomix_.fadeStartFrame;
        const uint64_t actualFadeEnd = source_.automixFadeEndFrame
            ? source_.automixFadeEndFrame()
            : preparedAutomix_.fadeEndFrame;
        if (actualFadeEnd <= actualFadeStart)
            return;
        const uint64_t actualCommitFrame = actualFadeStart + (actualFadeEnd - actualFadeStart) / 2;
        if (absoluteFramesPlayed < actualCommitFrame)
            return;

        preparedAutomix_.fadeStartFrame = actualFadeStart;
        preparedAutomix_.fadeEndFrame = actualFadeEnd;
        preparedAutomix_.commitFrame = actualCommitFrame;
        preparedAutomix_.commitEmitted = true;
        preparedAutomix_.state = "committed";
        const uint64_t nextOperationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
        preparedAutomix_.operationId = nextOperationId;
        const auto overlapProgressFrames = preparedAutomix_.commitFrame >= preparedAutomix_.fadeStartFrame
            ? preparedAutomix_.commitFrame - preparedAutomix_.fadeStartFrame
            : 0;
        const double tempoRatio = std::clamp(
            preparedAutomix_.plan.value("tempoRatio", 1.0),
            0.985,
            1.015);
        const double sourcePositionSeconds = preparedAutomix_.nextStartSeconds
            + static_cast<double>(overlapProgressFrames) * tempoRatio
                / static_cast<double>(std::max(1, sampleRate_));
        event = {
            {"planId", preparedAutomix_.planId},
            {"queueRevision", preparedAutomix_.queueRevision},
            {"operationId", nextOperationId},
            {"fromItemId", preparedAutomix_.plan.value("fromItemId", "")},
            {"fromTrackId", preparedAutomix_.plan.value("fromTrackId", "")},
            {"toItemId", preparedAutomix_.plan.value("toItemId", "")},
            {"toTrackId", preparedAutomix_.plan.value("toTrackId", "")},
            {"outputFrame", preparedAutomix_.commitFrame},
            {"sourcePositionSeconds", sourcePositionSeconds},
        };
        positionFrameOffset_.store(preparedAutomix_.commitFrame, std::memory_order_release);
        positionFrameScale_.store(tempoRatio, std::memory_order_release);
        currentFilePath_ = preparedAutomix_.nextTrackInfo.value("filePath", currentFilePath_);
    }

    {
        std::lock_guard<std::mutex> queueLock(queueMutex_);
        const std::string toItemId = event.value("toItemId", "");
        for (size_t index = 0; index < queue_.size(); ++index) {
            if (queue_[index].itemId == toItemId) {
                currentQueueIndex_ = static_cast<int>(index);
                break;
            }
        }
    }

    const std::string notification = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.transitionCommitted", event) + "\n";
    std::lock_guard<std::mutex> lock(rpcWriteMutex_);
    write(stdoutFd_, notification.data(), notification.size());
}

bool AudioDaemon::maybeCommitGaplessAdvance(uint64_t absoluteFramesPlayed, nlohmann::json& nextTrackInfo)
{
    if (! source_.gaplessBoundaryFrame)
        return false;
    const uint64_t boundaryFrame = source_.gaplessBoundaryFrame();
    if (boundaryFrame == UINT64_MAX || absoluteFramesPlayed < boundaryFrame)
        return false;

    std::lock_guard<std::mutex> operationLock(operationMutex_);
    const uint64_t currentOperationId = operationId_.load(std::memory_order_acquire);
    uint64_t transitionBoundaryFrame = UINT64_MAX;
    {
        std::lock_guard<std::mutex> stateLock(gaplessStateMutex_);
        if (! preparedGapless_.active
            || preparedGapless_.currentOperationId != currentOperationId
            || preparedGapless_.nextTransitionIndex >= preparedGapless_.tracks.size())
            return false;

        const auto& transition = preparedGapless_.tracks[preparedGapless_.nextTransitionIndex];
        transitionBoundaryFrame = boundaryFrame + transition.startFrameAfterBoundary;
        if (absoluteFramesPlayed < transitionBoundaryFrame)
            return false;
        nextTrackInfo = transition.trackInfo;
        preparedGapless_.nextTransitionIndex += 1;
    }

    const uint64_t nextOperationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    {
        std::lock_guard<std::mutex> stateLock(gaplessStateMutex_);
        preparedGapless_.currentOperationId = nextOperationId;
    }
    positionFrameOffset_.store(transitionBoundaryFrame, std::memory_order_release);
    positionFrameScale_.store(1.0, std::memory_order_release);
    currentFilePath_ = nextTrackInfo.value("filePath", currentFilePath_);
    currentInputOptions_ = {};

    {
        std::lock_guard<std::mutex> queueLock(queueMutex_);
        int matchingIndex = -1;
        const std::string requestedItemId = nextTrackInfo.value("nextItemId", "");
        const std::string requestedTrackId = nextTrackInfo.value("nextTrackId", "");
        for (size_t index = 0; index < queue_.size(); ++index) {
            if ((! requestedItemId.empty() && queue_[index].itemId == requestedItemId)
                || (! requestedTrackId.empty() && queue_[index].trackId == requestedTrackId)
                || queue_[index].filePath == currentFilePath_) {
                matchingIndex = static_cast<int>(index);
                const auto& item = queue_[index];
                nextTrackInfo["nextItemId"] = item.itemId;
                nextTrackInfo["nextTrackId"] = item.trackId;
                nextTrackInfo["nextMetadata"] = {
                    {"title", item.title},
                    {"artist", item.artist},
                    {"album", item.album},
                    {"albumArtist", item.albumArtist},
                    {"coverUrl", item.coverUrl},
                };
                break;
            }
        }
        if (matchingIndex >= 0)
            currentQueueIndex_ = matchingIndex;
        if (queueRevision_ > 0)
            nextTrackInfo["queueRevision"] = queueRevision_;
        nextTrackInfo["queueIndex"] = matchingIndex;
    }

    nextTrackInfo["operationId"] = nextOperationId;
    nextTrackInfo["gaplessAdvance"] = true;
    return true;
}

void AudioDaemon::emitEnded()
{
    const uint64_t completedOperationId = operationId_.load(std::memory_order_acquire);
    uint64_t pendingFromOperationId = 0;
    {
        std::lock_guard<std::mutex> operationLock(operationMutex_);
        if (pendingQueueAdvance_
            && pendingQueueAdvance_->targetOperationId == completedOperationId)
        {
            pendingFromOperationId = pendingQueueAdvance_->fromOperationId;
            pendingQueueAdvance_.reset();
        }
    }
    if (pendingFromOperationId != 0)
    {
        emitAudioError(
            pendingFromOperationId,
            "daemon_pending_queue_advance_ended_before_started");
        emitEndedForOperation(pendingFromOperationId);
        return;
    }
    if (autoAdvanceSuppressedOperationId_.load(std::memory_order_acquire) != completedOperationId
        && tryAutoAdvance(completedOperationId)) {
        return;
    }
    emitEndedForOperation(operationId_.load(std::memory_order_acquire));
}

void AudioDaemon::emitEndedForOperation(uint64_t operationId)
{
    {
        std::lock_guard<std::mutex> endedLock(endedNotificationMutex_);
        if (endedNotifiedOperationId_ == operationId)
            return;
        endedNotifiedOperationId_ = operationId;
    }

    std::string notif = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.ended", {{"operationId", operationId}}
    ) + "\n";
    {
        std::lock_guard<std::mutex> lock(rpcWriteMutex_);
        write(stdoutFd_, notif.data(), notif.size());
    }
}

bool AudioDaemon::onQueueSet(
    const nlohmann::json& items,
    const std::string& repeatMode,
    uint64_t revision,
    const std::string& currentItemId)
{
    std::vector<QueueItem> nextQueue;

    if (items.is_array()) {
        for (const auto& item : items) {
            QueueItem qi;
            if (item.contains("itemId") && item["itemId"].is_string()) {
                qi.itemId = item["itemId"].get<std::string>();
            }
            if (item.contains("trackId") && item["trackId"].is_string()) {
                qi.trackId = item["trackId"].get<std::string>();
            }
            if (item.contains("filePath") && item["filePath"].is_string()) {
                qi.filePath = item["filePath"].get<std::string>();
            }
            if (item.contains("sampleRate") && item["sampleRate"].is_number()) {
                qi.targetSampleRate = item["sampleRate"].get<int>();
            }
            if (item.contains("startSeconds") && item["startSeconds"].is_number()) {
                qi.startSeconds = item["startSeconds"].get<double>();
            }
            if (item.contains("metadata") && item["metadata"].is_object()) {
                const auto& metadata = item["metadata"];
                if (metadata.contains("title") && metadata["title"].is_string()) qi.title = metadata["title"].get<std::string>();
                if (metadata.contains("artist") && metadata["artist"].is_string()) qi.artist = metadata["artist"].get<std::string>();
                if (metadata.contains("album") && metadata["album"].is_string()) qi.album = metadata["album"].get<std::string>();
                if (metadata.contains("albumArtist") && metadata["albumArtist"].is_string()) qi.albumArtist = metadata["albumArtist"].get<std::string>();
                if (metadata.contains("coverUrl") && metadata["coverUrl"].is_string()) qi.coverUrl = metadata["coverUrl"].get<std::string>();
            }
            if (!qi.itemId.empty() && !qi.trackId.empty() && !qi.filePath.empty()) {
                nextQueue.push_back(std::move(qi));
            }
        }
    }

    bool audibleAutomixCommitted = false;
    std::string committedFromItemId;
    std::string committedToItemId;
    QueueItem committedItem;
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        audibleAutomixCommitted =
            (preparedAutomix_.state == "committed")
            || (preparedAutomix_.state == "armed"
                && source_.automixActive
                && source_.automixActive());
        if (audibleAutomixCommitted) {
            preparedAutomix_.state = "committed";
            preparedAutomix_.queueRevision = revision;
            preparedAutomix_.plan["queueRevision"] = revision;
            committedFromItemId = preparedAutomix_.plan.value("fromItemId", "");
            committedToItemId = preparedAutomix_.plan.value("toItemId", "");
            committedItem.itemId = committedToItemId;
            committedItem.trackId = preparedAutomix_.plan.value("toTrackId", "");
            committedItem.filePath = preparedAutomix_.nextTrackInfo.value("filePath", "");
            committedItem.targetSampleRate = preparedAutomix_.nextTrackInfo.value("sampleRate", sampleRate_);
            committedItem.startSeconds = preparedAutomix_.nextStartSeconds;
        }
    }
    if (audibleAutomixCommitted && ! committedToItemId.empty()) {
        const auto existing = std::find_if(
            nextQueue.begin(),
            nextQueue.end(),
            [&](const QueueItem& item) { return item.itemId == committedToItemId; });
        if (existing == nextQueue.end()) {
            const auto from = std::find_if(
                nextQueue.begin(),
                nextQueue.end(),
                [&](const QueueItem& item) { return item.itemId == committedFromItemId; });
            nextQueue.insert(
                from == nextQueue.end() ? nextQueue.begin() : std::next(from),
                committedItem);
        }
    }

    uint64_t cancelledPendingFromOperationId = 0;
    {
        // Queue replacement and first-frame queueAdvance publication share
        // operation ownership. Whichever acquires this lock first becomes the
        // only externally visible truth.
        std::lock_guard<std::mutex> operationLock(operationMutex_);
        {
            std::lock_guard<std::mutex> lock(queueMutex_);
            if (revision < queueRevision_) {
                return false;
            }
            if (revision == queueRevision_) {
                return true;
            }
            queue_ = std::move(nextQueue);
            currentQueueIndex_ = -1;
            repeatMode_ = repeatMode == "one" || repeatMode == "all" ? repeatMode : "off";
            queueRevision_ = revision;

            for (size_t i = 0; i < queue_.size(); i++) {
                if ((audibleAutomixCommitted && queue_[i].itemId == committedToItemId)
                    || (!audibleAutomixCommitted && !currentItemId.empty() && queue_[i].itemId == currentItemId)
                    || (currentItemId.empty() && !currentFilePath_.empty() && queue_[i].filePath == currentFilePath_)) {
                        currentQueueIndex_ = static_cast<int>(i);
                        break;
                }
            }
        }
        cancelledPendingFromOperationId = cancelPendingQueueAdvanceLocked();
    }
    if (cancelledPendingFromOperationId != 0)
    {
        emitAudioError(cancelledPendingFromOperationId, "daemon_pending_queue_advance_cancelled_by_queue_set");
        emitEndedForOperation(cancelledPendingFromOperationId);
    }

    std::string armedPlanId;
    uint64_t armedRevision = 0;
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        if (preparedAutomix_.state == "armed") {
            armedPlanId = preparedAutomix_.planId;
            armedRevision = preparedAutomix_.queueRevision;
        }
    }
    if (! audibleAutomixCommitted && ! armedPlanId.empty() && armedRevision != revision) {
        nlohmann::json ignored;
        onAutomixCancel(armedPlanId, ignored);
    }
    return true;
}

void AudioDaemon::onQueueClear()
{
    uint64_t cancelledPendingFromOperationId = 0;
    {
        std::lock_guard<std::mutex> operationLock(operationMutex_);
        {
            std::lock_guard<std::mutex> lock(queueMutex_);
            queue_.clear();
            currentQueueIndex_ = -1;
            repeatMode_ = "off";
        }
        cancelledPendingFromOperationId = cancelPendingQueueAdvanceLocked();
    }
    if (cancelledPendingFromOperationId != 0)
    {
        emitAudioError(cancelledPendingFromOperationId, "daemon_pending_queue_advance_cancelled_by_queue_clear");
        emitEndedForOperation(cancelledPendingFromOperationId);
    }
    std::string armedPlanId;
    {
        std::lock_guard<std::mutex> stateLock(automixStateMutex_);
        if (preparedAutomix_.state == "armed")
            armedPlanId = preparedAutomix_.planId;
    }
    if (! armedPlanId.empty()) {
        nlohmann::json ignored;
        onAutomixCancel(armedPlanId, ignored);
    }
}

bool AudioDaemon::tryAutoAdvance(uint64_t completedOperationId)
{
    QueueItem next;
    int nextIdx = -1;
    uint64_t queueRevision = 0;
    {
        // Select from one immutable revision, then release the queue control
        // lock before probing or waiting for an ASIO driver transaction.
        std::lock_guard<std::mutex> queueLock(queueMutex_);
        queueRevision = queueRevision_;
        if (repeatMode_ == "one" && !currentFilePath_.empty()) {
            next.filePath = currentFilePath_;
            next.targetSampleRate = sampleRate_;
            if (currentQueueIndex_ >= 0 && currentQueueIndex_ < static_cast<int>(queue_.size())) {
                next = queue_[currentQueueIndex_];
                nextIdx = currentQueueIndex_;
            }
        } else if (!queue_.empty()) {
            nextIdx = currentQueueIndex_ + 1;
            if (nextIdx >= static_cast<int>(queue_.size())) {
                if (repeatMode_ == "all") {
                    nextIdx = 0;
                } else {
                    return false;
                }
            }
            if (nextIdx >= 0 && nextIdx < static_cast<int>(queue_.size())) {
                next = queue_[nextIdx];
            }
        }
    }
    if (next.filePath.empty()) {
        return false;
    }

    const int previousSampleRate = sampleRate_;
    const int targetSampleRate = next.targetSampleRate;
    const bool strictRateTransition = source_.strictOutputSampleRateTransition
        && source_.strictOutputSampleRateTransition();
    if (strictRateTransition && targetSampleRate <= 0)
    {
        emitAudioError(completedOperationId, "daemon_auto_advance_missing_source_sample_rate");
        return false;
    }

    if (strictRateTransition) try
    {
        const auto nextProbe = echo::LibavDecoder::probe(next.filePath);
        if (nextProbe.sampleRate != targetSampleRate)
        {
            emitAudioError(
                completedOperationId,
                "daemon_auto_advance_source_rate_mismatch:queue="
                    + std::to_string(targetSampleRate)
                    + ";probe=" + std::to_string(nextProbe.sampleRate));
            return false;
        }
    }
    catch (const std::exception& error)
    {
        emitAudioError(
            completedOperationId,
            "daemon_auto_advance_probe_failed:" + std::string(error.what()));
        return false;
    }

    nlohmann::json transitionResult;
    std::string transitionError;
    if (strictRateTransition && targetSampleRate != previousSampleRate)
    {
        if (! source_.reconfigureOutputSampleRate
            || ! source_.reconfigureOutputSampleRate(targetSampleRate, transitionResult, transitionError))
        {
            emitAudioError(
                completedOperationId,
                transitionError.empty()
                    ? "asio_pcm_sample_rate_transition_failed"
                    : transitionError);
            return false;
        }
        const int actualSampleRate = transitionResult.value("actualSampleRate", 0);
        if (actualSampleRate != targetSampleRate)
        {
            emitAudioError(
                completedOperationId,
                "asio_pcm_sample_rate_transition_mismatch:"
                    + std::to_string(targetSampleRate) + "->" + std::to_string(actualSampleRate));
            return false;
        }
        sampleRate_ = actualSampleRate;
    }

    if (operationId_.load(std::memory_order_acquire) != completedOperationId)
        return true;

    nlohmann::json nextResult;
    currentInputOptions_ = {};
    const int decoderTargetSampleRate = strictRateTransition ? targetSampleRate : sampleRate_;
    if (onOpenFile(next.filePath, decoderTargetSampleRate, next.startSeconds, nextResult, true, completedOperationId)) {
        const uint64_t targetOperationId = nextResult.value("operationId", uint64_t { 0 });
        const int sourceSampleRate = nextResult.value("sourceSampleRate", 0);
        const int decoderSampleRate = nextResult.value("sampleRate", 0);
        bool strictContractFailed = false;
        bool queueRevisionChanged = false;
        {
            std::lock_guard<std::mutex> operationLock(operationMutex_);
            if (operationId_.load(std::memory_order_acquire) != targetOperationId)
                return true;

            strictContractFailed = strictRateTransition
                && (sourceSampleRate != targetSampleRate || decoderSampleRate != targetSampleRate);
            if (! strictContractFailed)
            {
                std::lock_guard<std::mutex> queueLock(queueMutex_);
                queueRevisionChanged = queueRevision_ != queueRevision
                    || (nextIdx >= 0
                        && (nextIdx >= static_cast<int>(queue_.size())
                            || queue_[nextIdx].itemId != next.itemId));
            }
            if (strictContractFailed || queueRevisionChanged)
            {
                stopProducersLocked();
                source_.markInputEnded();
                autoAdvanceSuppressedOperationId_.store(
                    targetOperationId,
                    std::memory_order_release);
            }
        }
        if (strictContractFailed)
        {
            emitAudioError(
                completedOperationId,
                "asio_pcm_strict_rate_contract_failed:source=" + std::to_string(sourceSampleRate)
                    + ";decoder=" + std::to_string(decoderSampleRate)
                    + ";device=" + std::to_string(targetSampleRate));
            emitEndedForOperation(completedOperationId);
            return true;
        }
        if (queueRevisionChanged)
        {
            emitAudioError(completedOperationId, "daemon_auto_advance_queue_revision_changed");
            emitEndedForOperation(completedOperationId);
            return true;
        }
        nextResult["queueRevision"] = queueRevision;
        nextResult["queueIndex"] = nextIdx;
        nextResult["nextItemId"] = next.itemId;
        nextResult["nextTrackId"] = next.trackId;
        nextResult["nextMetadata"] = {
            {"title", next.title},
            {"artist", next.artist},
            {"album", next.album},
            {"albumArtist", next.albumArtist},
            {"coverUrl", next.coverUrl},
        };
        nextResult["fromOperationId"] = completedOperationId;
        nextResult["previousSampleRate"] = previousSampleRate;
        const bool outputRateTransitioned = strictRateTransition
            && targetSampleRate != previousSampleRate;
        nextResult["targetSampleRate"] = strictRateTransition
            ? targetSampleRate
            : sampleRate_;
        nextResult["sampleRateTransitionMode"] = ! outputRateTransitioned
            ? "resident"
            : transitionResult.value("mode", "unknown");
        nextResult["sampleRateTransitionDurationMs"] = ! outputRateTransitioned
            ? 0.0
            : transitionResult.value("durationMs", 0.0);
        nextResult["actualSampleRate"] = sampleRate_;
        bool lateQueueRevisionChanged = false;
        {
            std::lock_guard<std::mutex> operationLock(operationMutex_);
            if (operationId_.load(std::memory_order_acquire) != targetOperationId)
                return true;
            {
                std::lock_guard<std::mutex> queueLock(queueMutex_);
                if (queueRevision_ != queueRevision)
                    lateQueueRevisionChanged = true;
                else if (nextIdx >= 0)
                    currentQueueIndex_ = nextIdx;
            }
            if (lateQueueRevisionChanged)
            {
                stopProducersLocked();
                source_.markInputEnded();
                autoAdvanceSuppressedOperationId_.store(targetOperationId, std::memory_order_release);
            }
            else
            {
                pendingQueueAdvance_ = PendingQueueAdvance {
                    completedOperationId,
                    targetOperationId,
                    std::move(nextResult),
                };
            }
        }
        if (lateQueueRevisionChanged)
        {
            emitAudioError(completedOperationId, "daemon_auto_advance_queue_revision_changed");
            emitEndedForOperation(completedOperationId);
        }
        return true;
    }
    const uint64_t currentOperationId = operationId_.load(std::memory_order_acquire);
    const uint64_t attemptedOperationId = nextResult.value("operationId", uint64_t { 0 });
    if (currentOperationId != completedOperationId)
    {
        // A manual stop/open/seek may have won before autonomous open acquired
        // operation ownership. Never stop or report against that newer op.
        if (attemptedOperationId == 0 || currentOperationId != attemptedOperationId)
            return true;
        {
            std::lock_guard<std::mutex> operationLock(operationMutex_);
            if (operationId_.load(std::memory_order_acquire) != attemptedOperationId)
                return true;
            source_.markInputEnded();
            autoAdvanceSuppressedOperationId_.store(
                attemptedOperationId,
                std::memory_order_release);
        }
        emitAudioError(
            completedOperationId,
            nextResult.value("error", "daemon_auto_advance_open_failed"));
        emitEndedForOperation(completedOperationId);
        return true;
    }
    return false;
}

void AudioDaemon::emitEndedWithAdvance(const nlohmann::json& nextTrackInfo)
{
    nlohmann::json endedMsg;
    endedMsg["queueAdvance"] = true;
    if (nextTrackInfo.contains("operationId"))
        endedMsg["operationId"] = nextTrackInfo["operationId"];
    if (nextTrackInfo.contains("queueRevision"))
        endedMsg["queueRevision"] = nextTrackInfo["queueRevision"];
    if (nextTrackInfo.contains("queueIndex"))
        endedMsg["queueIndex"] = nextTrackInfo["queueIndex"];
    if (nextTrackInfo.contains("nextItemId"))
        endedMsg["nextItemId"] = nextTrackInfo["nextItemId"];
    if (nextTrackInfo.contains("nextTrackId"))
        endedMsg["nextTrackId"] = nextTrackInfo["nextTrackId"];
    if (nextTrackInfo.contains("nextMetadata"))
        endedMsg["nextMetadata"] = nextTrackInfo["nextMetadata"];
    if (nextTrackInfo.contains("gaplessAdvance"))
        endedMsg["gaplessAdvance"] = nextTrackInfo["gaplessAdvance"];
    if (nextTrackInfo.contains("fromOperationId"))
        endedMsg["fromOperationId"] = nextTrackInfo["fromOperationId"];
    if (nextTrackInfo.contains("previousSampleRate"))
        endedMsg["previousSampleRate"] = nextTrackInfo["previousSampleRate"];
    if (nextTrackInfo.contains("targetSampleRate"))
        endedMsg["targetSampleRate"] = nextTrackInfo["targetSampleRate"];
    if (nextTrackInfo.contains("sampleRateTransitionMode"))
        endedMsg["sampleRateTransitionMode"] = nextTrackInfo["sampleRateTransitionMode"];
    if (nextTrackInfo.contains("sampleRateTransitionDurationMs"))
        endedMsg["sampleRateTransitionDurationMs"] = nextTrackInfo["sampleRateTransitionDurationMs"];
    if (nextTrackInfo.contains("actualSampleRate"))
        endedMsg["actualSampleRate"] = nextTrackInfo["actualSampleRate"];

    if (nextTrackInfo.contains("filePath"))
        endedMsg["nextFilePath"] = nextTrackInfo["filePath"];
    if (nextTrackInfo.contains("sampleRate"))
        endedMsg["nextSampleRate"] = nextTrackInfo["sampleRate"];
    if (nextTrackInfo.contains("sourceSampleRate"))
        endedMsg["nextSourceSampleRate"] = nextTrackInfo["sourceSampleRate"];
    if (nextTrackInfo.contains("channels"))
        endedMsg["nextChannels"] = nextTrackInfo["channels"];
    if (nextTrackInfo.contains("durationSeconds"))
        endedMsg["nextDurationSeconds"] = nextTrackInfo["durationSeconds"];
    if (nextTrackInfo.contains("startSeconds"))
        endedMsg["nextStartSeconds"] = nextTrackInfo["startSeconds"];
    if (nextTrackInfo.contains("codec"))
        endedMsg["nextCodec"] = nextTrackInfo["codec"];
    if (nextTrackInfo.contains("bitDepth"))
        endedMsg["nextBitDepth"] = nextTrackInfo["bitDepth"];

    std::string notif = echo::JsonRpcProtocol::createJsonRpcNotification("audio.ended", endedMsg) + "\n";
    {
        std::lock_guard<std::mutex> lock(rpcWriteMutex_);
        write(stdoutFd_, notif.data(), notif.size());
    }
}
