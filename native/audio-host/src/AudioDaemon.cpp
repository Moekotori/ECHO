#include "AudioDaemon.h"

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
#include <stdexcept>
#include <thread>
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

constexpr int seekPrimeFrames = 8192;
constexpr double seekPrimeSeconds = 0.25;

struct StreamDecodeOutcome {
    std::vector<float> samples;
    int sampleRate = 0;
    int channels = 0;
    int frames = 0;
};

bool pushStreamingLibav(AudioDaemon::SourceHooks& source,
                       const std::string& filePath,
                       double startSeconds,
                       double durationSeconds,
                       int targetSampleRate,
                       uint64_t generation,
                       std::stop_token stopToken,
                       StreamDecodeOutcome* capture)
{
    echo::LibavPcmStreamDecoder stream;
    stream.open(filePath, targetSampleRate);
    if (startSeconds > 0.0)
        stream.seek(startSeconds);

    const int sampleRate = stream.sampleRate();
    const int channels = stream.channels();
    const int64_t maxFrames = durationSeconds > 0.0
        ? static_cast<int64_t>(std::ceil(durationSeconds * static_cast<double>(sampleRate)))
        : 0;

    if (capture != nullptr)
    {
        capture->sampleRate = sampleRate;
        capture->channels = channels;
    }

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

        if (capture != nullptr)
        {
            capture->samples.insert(capture->samples.end(), chunk.samples.begin(), chunk.samples.end());
            capture->frames += chunk.frames;
        }

        framesRead += chunk.frames;
    }

    return !stopToken.stop_requested();
}

StreamDecodeOutcome readStreamingLibav(const std::string& filePath,
                                       double startSeconds,
                                       int framesToRead,
                                       int targetSampleRate,
                                       std::stop_token stopToken)
{
    echo::LibavPcmStreamDecoder stream;
    stream.open(filePath, targetSampleRate);
    if (startSeconds > 0.0)
        stream.seek(startSeconds);

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
                         DecodePath decodePath)
    : source_(std::move(source))
    , sampleRate_(actualSampleRate)
    , stdoutFd_(stdoutFd)
    , decodePath_(decodePath)
    , shutdownSignal_(&shutdownRequested)
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
            return onOpenFile(filePath, targetSampleRate, startSeconds, result);
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

    echo::JsonRpcProtocol::setVolumeCallback(
        [this](float volume) {
            onSetVolume(volume);
        });

    echo::JsonRpcProtocol::setQueueSetCallback(
        [this](const nlohmann::json& items, const std::string& repeatMode) -> bool {
            onQueueSet(items, repeatMode);
            return true;
        });

    echo::JsonRpcProtocol::setQueueClearCallback(
        [this]() -> bool {
            onQueueClear();
            return true;
        });
}

bool AudioDaemon::onOpenFile(const std::string& filePath, int targetSampleRate, double requestedStartSeconds, nlohmann::json& result)
{
    std::lock_guard<std::mutex> operationLock(operationMutex_);
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    stopDecodeThreadLocked();

    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = cache_.find(filePath);
        if (it != cache_.end() && it->second.complete) {
            const auto& cached = it->second;
            const double durationSeconds = cached.probe.durationSeconds > 0.0 ? cached.probe.durationSeconds : cached.fullDurationSeconds;
            const double normalizedStartSeconds = normalizeStartSeconds(requestedStartSeconds, durationSeconds);
            const double relativeStartSeconds = normalizedStartSeconds - cached.startSeconds;
            double cachedDurationSeconds = cached.durationSeconds;
            if (cached.sampleRate > 0 && cached.channels > 0)
            {
                const auto cachedFrames = static_cast<double>(cached.samples.size()) / static_cast<double>(cached.channels);
                cachedDurationSeconds = cachedFrames / static_cast<double>(cached.sampleRate);
            }
            const bool canUseCache = relativeStartSeconds >= -0.001 && relativeStartSeconds < cachedDurationSeconds;
            if (canUseCache) {
                source_.beginSession();
                const int chunkFrames = decodeChunkFrames;
                const auto startFrame = static_cast<int64_t>(std::floor(std::max(0.0, relativeStartSeconds) * cached.sampleRate));
                const int totalSamples = static_cast<int>(cached.samples.size());
                int offset = static_cast<int>(std::min<int64_t>(startFrame * cached.channels, totalSamples));
                uint64_t gen = source_.generation();
                while (offset < totalSamples) {
                    if (source_.generation() != gen) return false;
                    const int remaining = totalSamples - offset;
                    const int framesToWrite = std::min(chunkFrames, remaining / cached.channels);
                    if (framesToWrite <= 0) break;
                    if (!source_.push(cached.samples.data() + offset, framesToWrite)) {
                        DEBUG_AUDIO_LOG("source_.push stopped in onOpenFile cache: offset=%d, total=%d, operationId=%lu",
                                        offset, totalSamples, static_cast<unsigned long>(operationId));
                        return false;
                    }
                    offset += framesToWrite * cached.channels;
                }
                source_.markInputEnded();

                currentFilePath_ = filePath;
                result["status"] = "playing";
                result["operationId"] = operationId;
                result["filePath"] = filePath;
                result["sampleRate"] = cached.sampleRate;
                result["channels"] = cached.channels;
                result["durationSeconds"] = durationSeconds;
                result["startSeconds"] = normalizedStartSeconds;
                result["codec"] = cached.probe.codec;
                result["container"] = cached.probe.container;
                return true;
            }
        }
    }

    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        cache_.clear();
    }

    echo::AudioProbe probe;
    try { probe = echo::LibavDecoder::probe(filePath); }
    catch (const std::exception& e) {
        result["error"] = std::string("probe failed: ") + e.what();
        result["operationId"] = operationId;
        return false;
    }

    currentFilePath_ = filePath;

    const int outSampleRate = targetSampleRate > 0 ? targetSampleRate : sampleRate_;
    const double normalizedStartSeconds = normalizeStartSeconds(requestedStartSeconds, probe.durationSeconds);

    result["status"] = "decoding";
    result["operationId"] = operationId;
    result["filePath"] = filePath;
    result["sampleRate"] = outSampleRate;
    result["channels"] = probe.channels;
    result["durationSeconds"] = probe.durationSeconds;
    result["startSeconds"] = normalizedStartSeconds;
    result["codec"] = probe.codec;
    result["container"] = probe.container;

    source_.beginSession();

    decodeThread_ = std::jthread([this, filePath, outSampleRate, normalizedStartSeconds, probe, operationId](std::stop_token st) {
        const uint64_t gen = source_.generation();
        StreamDecodeOutcome streamedAudio;
        echo::DecodedAudio legacyAudio;
        try {
            if (shouldUseStreamingDecode()) {
                if (!pushStreamingLibav(source_, filePath, normalizedStartSeconds, 0.0, outSampleRate, gen, st, &streamedAudio)) {
                    DEBUG_AUDIO_LOG("streaming openFile decode stopped: operationId=%lu", static_cast<unsigned long>(operationId));
                    return;
                }
            } else {
                echo::LibavDecoder decoder;
                legacyAudio = decoder.decode(filePath, normalizedStartSeconds, 0.0, outSampleRate);
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
            if (operationId_.load(std::memory_order_acquire) == operationId && !st.stop_requested())
                source_.markInputEnded();
            return;
        }

        const int decodedFrames = shouldUseStreamingDecode()
            ? streamedAudio.frames
            : (legacyAudio.channels > 0 ? static_cast<int>(legacyAudio.samples.size() / legacyAudio.channels) : 0);
        const int decodedSampleRate = shouldUseStreamingDecode() ? streamedAudio.sampleRate : legacyAudio.sampleRate;
        const int decodedChannels = shouldUseStreamingDecode() ? streamedAudio.channels : legacyAudio.channels;
        const auto& decodedSamples = shouldUseStreamingDecode() ? streamedAudio.samples : legacyAudio.samples;
        DEBUG_AUDIO_LOG("onOpenFile decode succeeded: decodedFrames=%d, totalSamples=%zu, sampleRate=%d, channels=%d, operationId=%lu, startSeconds=%.3f",
                        decodedFrames, decodedSamples.size(), decodedSampleRate, decodedChannels,
                        static_cast<unsigned long>(operationId), normalizedStartSeconds);

        if (!st.stop_requested() && operationId_.load(std::memory_order_acquire) == operationId) {
            source_.markInputEnded();
            {
                std::lock_guard<std::mutex> lock(cacheMutex_);
                CachedTrack entry;
                entry.samples = decodedSamples;
                entry.sampleRate = decodedSampleRate;
                entry.channels = decodedChannels;
                entry.durationSeconds = probe.durationSeconds;
                entry.startSeconds = normalizedStartSeconds;
                entry.probe = probe;
                entry.complete = true;
                entry.cachedStartSeconds = normalizedStartSeconds;
                entry.cachedDurationSeconds = probe.durationSeconds - normalizedStartSeconds;
                entry.fullDurationSeconds = probe.durationSeconds;
                cache_[filePath] = std::move(entry);
            }
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
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    result["operationId"] = operationId;
    stopDecodeThreadLocked();

    if (currentFilePath_.empty()) return false;
    std::string seekFile = currentFilePath_;

    std::vector<float> cachedPrimeSamples;
    std::vector<float> cachedRemainingSamples;
    int cachedChannels = 0;
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = cache_.find(seekFile);
        if (it != cache_.end() && it->second.complete) {
            const auto& cached = it->second;
            const double relativeSeconds = positionSeconds - cached.startSeconds;
            const double cachedDuration = cached.cachedDurationSeconds > 0.0
                ? cached.cachedDurationSeconds
                : (cached.sampleRate > 0 && cached.channels > 0
                    ? (static_cast<double>(cached.samples.size()) / static_cast<double>(cached.channels)) / static_cast<double>(cached.sampleRate)
                    : 0.0);
            if (relativeSeconds >= -0.001 && relativeSeconds < cachedDuration - 0.001) {
                const int startFrame = static_cast<int>(std::max(0.0, relativeSeconds) * cached.sampleRate);
                int offset = startFrame * cached.channels;
                const int totalSamples = static_cast<int>(cached.samples.size());
                const int firstFrames = std::min(seekPrimeFrames, std::max(0, (totalSamples - offset) / cached.channels));
                const int primeSamples = firstFrames * cached.channels;
                if (primeSamples <= 0) return false;
                cachedPrimeSamples.assign(cached.samples.begin() + offset, cached.samples.begin() + offset + primeSamples);
                offset += primeSamples;
                if (offset < totalSamples)
                    cachedRemainingSamples.assign(cached.samples.begin() + offset, cached.samples.end());
                cachedChannels = cached.channels;
            }
        }
    }

    if (!cachedPrimeSamples.empty() && cachedChannels > 0) {
        const int primeFrames = static_cast<int>(cachedPrimeSamples.size()) / cachedChannels;
        const int replacedFrames = source_.replaceBufferedAudio(cachedPrimeSamples.data(), primeFrames, paused_);
        if (replacedFrames <= 0) return false;
        const int chunkFrames = decodeChunkFrames;
        const uint64_t gen = source_.generation();
        decodeThread_ = std::jthread([this, samples = std::move(cachedRemainingSamples), cachedChannels, operationId, gen, chunkFrames](std::stop_token st) {
            const int continuationSamples = static_cast<int>(samples.size());
            int continuationOffset = 0;
            while (continuationOffset < continuationSamples && !st.stop_requested()) {
                if (source_.generation() != gen) return;
                const int remaining = continuationSamples - continuationOffset;
                const int framesToWrite = std::min(chunkFrames, remaining / cachedChannels);
                if (framesToWrite <= 0) break;
                if (!source_.push(samples.data() + continuationOffset, framesToWrite)) {
                    DEBUG_AUDIO_LOG("source_.push stopped in seek cache: offset=%d, total=%d, operationId=%lu",
                                    continuationOffset, continuationSamples, static_cast<unsigned long>(operationId));
                    return;
                }
                continuationOffset += framesToWrite * cachedChannels;
            }
            if (!st.stop_requested() && operationId_.load(std::memory_order_acquire) == operationId) {
                source_.markInputEnded();
            }
        });
        return true;
    }

    StreamDecodeOutcome streamingPrimeAudio;
    echo::DecodedAudio primeAudio;
    try {
        if (shouldUseStreamingDecode()) {
            streamingPrimeAudio = readStreamingLibav(seekFile, positionSeconds, seekPrimeFrames, sampleRate_, std::stop_token{});
        } else {
            echo::LibavDecoder decoder;
            primeAudio = decoder.decode(seekFile, positionSeconds, seekPrimeSeconds, sampleRate_);
        }
    } catch (const std::exception& e) {
        DEBUG_AUDIO_LOG("seek prime decode failed: %s", e.what());
        return false;
    }
    const int primeChannels = shouldUseStreamingDecode() ? streamingPrimeAudio.channels : primeAudio.channels;
    const int primeSampleRate = shouldUseStreamingDecode() ? streamingPrimeAudio.sampleRate : primeAudio.sampleRate;
    const auto& primeSamples = shouldUseStreamingDecode() ? streamingPrimeAudio.samples : primeAudio.samples;
    const int primeFrames = primeChannels > 0 ? static_cast<int>(primeSamples.size() / primeChannels) : 0;
    const int replacedFrames = source_.replaceBufferedAudio(primeSamples.data(), primeFrames, paused_);
    if (replacedFrames <= 0) return false;
    const int continuationSampleRate = primeSampleRate > 0 ? primeSampleRate : sampleRate_;
    const double continuationSeconds = positionSeconds + static_cast<double>(replacedFrames) / static_cast<double>(continuationSampleRate);
    decodeThread_ = std::jthread([this, filePath = seekFile, continuationSeconds, operationId](std::stop_token st) {
        const uint64_t gen = source_.generation();
        try {
            if (shouldUseStreamingDecode()) {
                if (!pushStreamingLibav(source_, filePath, continuationSeconds, 0.0, sampleRate_, gen, st, nullptr)) {
                    DEBUG_AUDIO_LOG("streaming seek decode stopped: operationId=%lu", static_cast<unsigned long>(operationId));
                    return;
                }
                DEBUG_AUDIO_LOG("seek streaming decode succeeded: operationId=%lu, positionSeconds=%.3f",
                                static_cast<unsigned long>(operationId), continuationSeconds);
            } else {
                echo::LibavDecoder decoder;
                echo::DecodedAudio audio = decoder.decode(filePath, continuationSeconds, 0.0, sampleRate_);
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
    const uint64_t operationId = operationId_.fetch_add(1, std::memory_order_acq_rel) + 1;
    result["operationId"] = operationId;
    stopDecodeThreadLocked();
    source_.beginSession();
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
    int sr = targetSampleRate > 0 ? targetSampleRate : sampleRate_;
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
                streamingAudio = readStreamingLibav(filePath, 0.0, prefetchFrames, sr, st);
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
            entry.samples = std::move(streamingAudio.samples);
            entry.sampleRate = streamingAudio.sampleRate;
            entry.channels = streamingAudio.channels;
        } else {
            entry.samples = std::move(audio.samples);
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
        cache_[filePath] = std::move(entry);
    });
    return true;
}

bool AudioDaemon::shouldUseStreamingDecode() const
{
    return decodePath_ == DecodePath::StreamingLibav;
}

void AudioDaemon::stopDecodeThreadLocked()
{
    if (decodeThread_.joinable()) {
        source_.requestStop();
        decodeThread_.request_stop();
        decodeThread_ = std::jthread();
    }
}

void AudioDaemon::emitPosition(uint64_t framesPlayed, int bufferedFrames, bool inputEnded)
{
    std::string notif = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.position",
        {{"framesPlayed", framesPlayed},
         {"bufferedFrames", bufferedFrames},
         {"inputEnded", inputEnded},
         {"operationId", operationId_.load(std::memory_order_acquire)}}
    ) + "\n";
    {
        std::lock_guard<std::mutex> lock(rpcWriteMutex_);
        write(stdoutFd_, notif.data(), notif.size());
    }
}

void AudioDaemon::emitEnded()
{
    if (tryAutoAdvance()) {
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

void AudioDaemon::onQueueSet(const nlohmann::json& items, const std::string& repeatMode)
{
    queue_.clear();
    currentQueueIndex_ = -1;
    repeatMode_ = repeatMode;

    if (items.is_array()) {
        for (const auto& item : items) {
            QueueItem qi;
            if (item.contains("filePath") && item["filePath"].is_string()) {
                qi.filePath = item["filePath"].get<std::string>();
            }
            if (item.contains("sampleRate") && item["sampleRate"].is_number()) {
                qi.targetSampleRate = item["sampleRate"].get<int>();
            }
            if (item.contains("startSeconds") && item["startSeconds"].is_number()) {
                qi.startSeconds = item["startSeconds"].get<double>();
            }
            if (!qi.filePath.empty()) {
                queue_.push_back(std::move(qi));
            }
        }
    }

    if (!currentFilePath_.empty()) {
        for (size_t i = 0; i < queue_.size(); i++) {
            if (queue_[i].filePath == currentFilePath_) {
                currentQueueIndex_ = static_cast<int>(i);
                break;
            }
        }
    }
}

void AudioDaemon::onQueueClear()
{
    queue_.clear();
    currentQueueIndex_ = -1;
    repeatMode_ = "off";
}

bool AudioDaemon::tryAutoAdvance()
{
    if (repeatMode_ == "one" && !currentFilePath_.empty()) {
        nlohmann::json nextResult;
        if (onOpenFile(currentFilePath_, sampleRate_, 0.0, nextResult)) {
            emitEndedWithAdvance(nextResult);
            return true;
        }
        return false;
    }

    if (!queue_.empty()) {
        int nextIdx = currentQueueIndex_ + 1;
        if (nextIdx >= static_cast<int>(queue_.size())) {
            if (repeatMode_ == "all") {
                nextIdx = 0;
            } else {
                return false;
            }
        }

        if (nextIdx >= 0 && nextIdx < static_cast<int>(queue_.size())) {
            const auto& next = queue_[nextIdx];
            nlohmann::json nextResult;
            if (onOpenFile(next.filePath, next.targetSampleRate, next.startSeconds, nextResult)) {
                currentQueueIndex_ = nextIdx;
                emitEndedWithAdvance(nextResult);
                return true;
            }
        }
    }

    return false;
}

void AudioDaemon::emitEndedWithAdvance(const nlohmann::json& nextTrackInfo)
{
    nlohmann::json endedMsg;
    endedMsg["queueAdvance"] = true;
    endedMsg["queueIndex"] = currentQueueIndex_;

    if (nextTrackInfo.contains("filePath"))
        endedMsg["nextFilePath"] = nextTrackInfo["filePath"];
    if (nextTrackInfo.contains("sampleRate"))
        endedMsg["nextSampleRate"] = nextTrackInfo["sampleRate"];
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
