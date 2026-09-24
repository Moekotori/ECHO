#pragma once
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswresample/swresample.h>
#include <libavutil/error.h>
#include <libavutil/mathematics.h>
#include <libavutil/opt.h>
}
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace echo {

inline std::string libavErrorMessage(const char* operation, int errorCode)
{
    char buffer[AV_ERROR_MAX_STRING_SIZE] {};
    if (av_strerror(errorCode, buffer, sizeof(buffer)) == 0)
        return std::string(operation) + ": " + buffer;
    return std::string(operation) + ": error " + std::to_string(errorCode);
}

// Match FFmpeg's short corruption recovery while bounding work until the next
// decoded PCM frame proves that the demuxer and decoder made forward progress.
inline constexpr int maxRecoverableLibavRegionErrors = 64;
inline constexpr int maxRecoverableLibavDemuxErrors = 8;
inline constexpr int maxRecoverableLibavFrameErrors = 8;
inline constexpr int64_t maxRecoverableLibavDamageDurationUs = 2 * AV_TIME_BASE;
inline constexpr int64_t maxRecoverableLibavDamageBytes = 4 * 1024 * 1024;

enum class LibavDecodeErrorStage {
    demux,
    packet,
    frame,
};

inline const char* libavDecodeErrorStageName(LibavDecodeErrorStage stage) noexcept
{
    switch (stage)
    {
        case LibavDecodeErrorStage::demux: return "demux";
        case LibavDecodeErrorStage::packet: return "packet";
        case LibavDecodeErrorStage::frame: return "frame";
    }
    return "unknown";
}

inline bool shouldLogRecoverableLibavError(int regionErrorCount) noexcept
{
    return regionErrorCount > 0
        && (regionErrorCount <= 3 || (regionErrorCount & (regionErrorCount - 1)) == 0);
}

class LibavDecodeRecoveryBudget {
public:
    bool tryConsume(
        int errorCode,
        LibavDecodeErrorStage stage,
        int64_t skippedDurationUs = 0,
        int64_t skippedBytes = 0) noexcept
    {
        if (errorCode != AVERROR_INVALIDDATA)
            return false;

        skippedDurationUs = std::max<int64_t>(0, skippedDurationUs);
        skippedBytes = std::max<int64_t>(0, skippedBytes);
        const int nextRegionErrors = regionErrors_ + 1;
        const int nextDemuxErrors = demuxErrors_ + (stage == LibavDecodeErrorStage::demux ? 1 : 0);
        const int nextFrameErrors = frameErrors_ + (stage == LibavDecodeErrorStage::frame ? 1 : 0);
        if (nextRegionErrors > maxRecoverableLibavRegionErrors
            || nextDemuxErrors > maxRecoverableLibavDemuxErrors
            || nextFrameErrors > maxRecoverableLibavFrameErrors
            || skippedDurationUs > maxRecoverableLibavDamageDurationUs - skippedDurationUs_
            || skippedBytes > maxRecoverableLibavDamageBytes - skippedBytes_)
            return false;

        regionErrors_ = nextRegionErrors;
        demuxErrors_ = nextDemuxErrors;
        frameErrors_ = nextFrameErrors;
        skippedDurationUs_ += skippedDurationUs;
        skippedBytes_ += skippedBytes;
        ++totalErrors_;
        return true;
    }

    void resetRegion() noexcept
    {
        regionErrors_ = 0;
        demuxErrors_ = 0;
        frameErrors_ = 0;
        skippedDurationUs_ = 0;
        skippedBytes_ = 0;
    }

    void resetAll() noexcept
    {
        resetRegion();
        totalErrors_ = 0;
    }

    int regionErrors() const noexcept { return regionErrors_; }
    int64_t skippedDurationUs() const noexcept { return skippedDurationUs_; }
    int64_t skippedBytes() const noexcept { return skippedBytes_; }
    uint64_t totalErrors() const noexcept { return totalErrors_; }

private:
    int regionErrors_ = 0;
    int demuxErrors_ = 0;
    int frameErrors_ = 0;
    int64_t skippedDurationUs_ = 0;
    int64_t skippedBytes_ = 0;
    uint64_t totalErrors_ = 0;
};

struct AudioProbe {
    double durationSeconds = 0.0;
    int sampleRate = 0;
    int channels = 0;
    int bitDepth = 0;
    std::string codec;
    std::string container;
    int64_t bitrate = 0;
};

struct DecodedAudio {
    std::vector<float> samples; // interleaved f32
    int sampleRate = 0;
    int channels = 0;
    int frameCount = 0;
};

struct LibavPcmChunk {
    std::vector<float> samples;
    int frames = 0;
};

struct LibavInputOptions {
    bool network = false;
    std::vector<std::pair<std::string, std::string>> headers;
};

inline int openLibavInput(
    AVFormatContext** context,
    const std::string& uri,
    const LibavInputOptions& options = {})
{
    AVDictionary* dictionary = nullptr;
    if (options.network)
    {
        av_dict_set(&dictionary, "reconnect", "1", 0);
        av_dict_set(&dictionary, "reconnect_streamed", "1", 0);
        av_dict_set(&dictionary, "reconnect_on_network_error", "1", 0);
        av_dict_set(&dictionary, "reconnect_delay_max", "2", 0);
        av_dict_set(&dictionary, "rw_timeout", "30000000", 0);
    }
    if (!options.headers.empty())
    {
        std::string headerBlock;
        for (const auto& [name, value] : options.headers)
            headerBlock += name + ": " + value + "\r\n";
        av_dict_set(&dictionary, "headers", headerBlock.c_str(), 0);
    }
    const int result = avformat_open_input(context, uri.c_str(), nullptr, &dictionary);
    av_dict_free(&dictionary);
    return result;
}

class LibavPcmStreamDecoder {
public:
    LibavPcmStreamDecoder() = default;
    ~LibavPcmStreamDecoder() { close(); }

    LibavPcmStreamDecoder(const LibavPcmStreamDecoder&) = delete;
    LibavPcmStreamDecoder& operator=(const LibavPcmStreamDecoder&) = delete;

    void open(
        const std::string& filePath,
        int targetSampleRate = 0,
        int targetChannels = 0,
        const LibavInputOptions& inputOptions = {})
    {
        close();
        cancelled_.store(false, std::memory_order_release);
        opening_.store(inputOptions.network, std::memory_order_release);
        openDeadlineNs_.store(inputOptions.network
            ? std::chrono::duration_cast<std::chrono::nanoseconds>(
                (std::chrono::steady_clock::now() + std::chrono::seconds(5)).time_since_epoch()).count()
            : 0,
            std::memory_order_release);
        reachedInputEof_ = false;
        decoderFlushed_ = false;
        recoveryBudget_.resetAll();
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;

        formatContext_ = avformat_alloc_context();
        if (formatContext_ == nullptr)
            throw std::runtime_error("avformat_alloc_context failed");
        formatContext_->interrupt_callback.callback = &LibavPcmStreamDecoder::interruptCallback;
        formatContext_->interrupt_callback.opaque = this;

        const int openResult = openLibavInput(&formatContext_, filePath, inputOptions);
        if (openResult < 0)
            throw std::runtime_error(libavErrorMessage("avformat_open_input failed", openResult));

        try
        {
            const int streamInfoResult = avformat_find_stream_info(formatContext_, nullptr);
            if (streamInfoResult < 0)
                throw std::runtime_error(libavErrorMessage("avformat_find_stream_info failed", streamInfoResult));
            opening_.store(false, std::memory_order_release);
            openDeadlineNs_.store(0, std::memory_order_release);

            audioStreamIndex_ = av_find_best_stream(formatContext_, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
            if (audioStreamIndex_ < 0)
                throw std::runtime_error("no audio stream found");

            AVStream* stream = formatContext_->streams[audioStreamIndex_];
            const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
            if (codec == nullptr)
                throw std::runtime_error("no audio decoder found");

            codecContext_ = avcodec_alloc_context3(codec);
            if (codecContext_ == nullptr)
                throw std::runtime_error("avcodec_alloc_context3 failed");

            if (avcodec_parameters_to_context(codecContext_, stream->codecpar) < 0)
                throw std::runtime_error("avcodec_parameters_to_context failed");

            if (avcodec_open2(codecContext_, codec, nullptr) < 0)
                throw std::runtime_error("avcodec_open2 failed");

            if (codecContext_->ch_layout.nb_channels <= 0)
                av_channel_layout_default(&codecContext_->ch_layout, 2);

            sampleRate_ = targetSampleRate > 0 ? targetSampleRate : codecContext_->sample_rate;
            channels_ = targetChannels > 0 ? targetChannels : codecContext_->ch_layout.nb_channels;
            if (sampleRate_ <= 0)
                throw std::runtime_error("source sample rate unavailable");
            if (channels_ <= 0)
                throw std::runtime_error("source channel count unavailable");

            if (targetChannels > 0)
                av_channel_layout_default(&outputLayout_, channels_);
            else
                av_channel_layout_copy(&outputLayout_, &codecContext_->ch_layout);
            if (swr_alloc_set_opts2(
                    &swrContext_,
                    &outputLayout_,
                    AV_SAMPLE_FMT_FLT,
                    sampleRate_,
                    &codecContext_->ch_layout,
                    codecContext_->sample_fmt,
                    codecContext_->sample_rate,
                    0,
                    nullptr) < 0 || swrContext_ == nullptr)
                throw std::runtime_error("swr_alloc_set_opts2 failed");

            if (swr_init(swrContext_) < 0)
                throw std::runtime_error("swr_init failed");

            packet_ = av_packet_alloc();
            frame_ = av_frame_alloc();
            if (packet_ == nullptr || frame_ == nullptr)
                throw std::runtime_error("libav frame allocation failed");
        }
        catch (...)
        {
            close();
            throw;
        }
    }

    bool isOpen() const { return formatContext_ != nullptr; }
    int sampleRate() const { return sampleRate_; }
    int channels() const { return channels_; }
    AudioProbe probe() const
    {
        ensureOpen();
        AVStream* stream = formatContext_->streams[audioStreamIndex_];
        const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
        AudioProbe result;
        result.durationSeconds = formatContext_->duration > 0
            ? formatContext_->duration / static_cast<double>(AV_TIME_BASE)
            : 0.0;
        result.sampleRate = stream->codecpar->sample_rate;
        result.channels = stream->codecpar->ch_layout.nb_channels;
        result.bitDepth = stream->codecpar->bits_per_raw_sample > 0
            ? stream->codecpar->bits_per_raw_sample
            : 16;
        result.codec = codec != nullptr ? codec->name : "unknown";
        result.container = formatContext_->iformat != nullptr ? formatContext_->iformat->name : "unknown";
        result.bitrate = stream->codecpar->bit_rate;
        return result;
    }
    bool eof() const { return ! isOpen() || cancelled_.load(std::memory_order_acquire) || (decoderFlushed_ && pendingOffsetSamples_ >= pendingSamples_.size()); }
    bool cancelled() const { return cancelled_.load(std::memory_order_acquire); }

    void cancel()
    {
        cancelled_.store(true, std::memory_order_release);
    }

    void seek(double seconds)
    {
        ensureOpen();
        seconds = std::max(0.0, seconds);
        AVStream* stream = formatContext_->streams[audioStreamIndex_];
        const int64_t timestamp = static_cast<int64_t>(seconds / av_q2d(stream->time_base));
        if (av_seek_frame(formatContext_, audioStreamIndex_, timestamp, AVSEEK_FLAG_BACKWARD) < 0)
            throw std::runtime_error("av_seek_frame failed");

        avcodec_flush_buffers(codecContext_);
        if (swrContext_ != nullptr)
            swr_close(swrContext_);
        if (swrContext_ != nullptr && swr_init(swrContext_) < 0)
            throw std::runtime_error("swr_init failed after seek");
        av_packet_unref(packet_);
        av_frame_unref(frame_);
        reachedInputEof_ = false;
        decoderFlushed_ = false;
        recoveryBudget_.resetRegion();
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;
        cancelled_.store(false, std::memory_order_release);
    }

    LibavPcmChunk readFrames(int maxFrames)
    {
        ensureOpen();
        if (maxFrames <= 0 || cancelled_.load(std::memory_order_acquire))
            return {};

        LibavPcmChunk chunk;
        chunk.samples.reserve(static_cast<size_t>(maxFrames) * static_cast<size_t>(channels_));

        while (chunk.frames < maxFrames && ! cancelled_.load(std::memory_order_acquire))
        {
            drainPending(chunk, maxFrames);
            if (chunk.frames >= maxFrames || decoderFlushed_)
                break;

            receiveAvailableFrames();
            if (pendingOffsetSamples_ < pendingSamples_.size())
                continue;

            if (reachedInputEof_)
            {
                flushDecoder();
                continue;
            }

            readNextPacketOrStartFlush();
        }

        return chunk;
    }

    void close()
    {
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;
        sampleRate_ = 0;
        channels_ = 0;
        audioStreamIndex_ = -1;
        reachedInputEof_ = false;
        decoderFlushed_ = false;
        recoveryBudget_.resetAll();
        opening_.store(false, std::memory_order_release);
        openDeadlineNs_.store(0, std::memory_order_release);
        cancelled_.store(false, std::memory_order_release);

        if (packet_ != nullptr)
            av_packet_free(&packet_);
        if (frame_ != nullptr)
            av_frame_free(&frame_);
        if (swrContext_ != nullptr)
            swr_free(&swrContext_);
        av_channel_layout_uninit(&outputLayout_);
        if (codecContext_ != nullptr)
            avcodec_free_context(&codecContext_);
        if (formatContext_ != nullptr)
            avformat_close_input(&formatContext_);
    }

private:
    static int interruptCallback(void* opaque)
    {
        const auto* decoder = static_cast<const LibavPcmStreamDecoder*>(opaque);
        if (decoder == nullptr)
            return 0;
        if (decoder->cancelled_.load(std::memory_order_acquire))
            return 1;
        if (! decoder->opening_.load(std::memory_order_acquire))
            return 0;
        const auto deadline = decoder->openDeadlineNs_.load(std::memory_order_acquire);
        const auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count();
        return deadline > 0 && now >= deadline ? 1 : 0;
    }

    void ensureOpen() const
    {
        if (formatContext_ == nullptr || codecContext_ == nullptr || swrContext_ == nullptr)
            throw std::runtime_error("LibavPcmStreamDecoder is not open");
    }

    void logRecoverableError(LibavDecodeErrorStage stage, int errorCode) const
    {
        if (! shouldLogRecoverableLibavError(recoveryBudget_.regionErrors()))
            return;
        const auto message = libavErrorMessage("recoverable libav decode error skipped", errorCode);
        std::fprintf(
            stderr,
            "[echo-audio-host] %s stage=%s regionErrors=%d skippedDurationMs=%lld skippedBytes=%lld total=%llu\n",
            message.c_str(),
            libavDecodeErrorStageName(stage),
            recoveryBudget_.regionErrors(),
            static_cast<long long>(recoveryBudget_.skippedDurationUs() / 1000),
            static_cast<long long>(recoveryBudget_.skippedBytes()),
            static_cast<unsigned long long>(recoveryBudget_.totalErrors()));
        std::fflush(stderr);
    }

    void finishRecoveredDamageRegion(const char* boundary)
    {
        if (recoveryBudget_.regionErrors() == 0)
            return;
        std::fprintf(
            stderr,
            "[echo-audio-host] libav decoder recovered damaged media region boundary=%s errors=%d skippedDurationMs=%lld skippedBytes=%lld total=%llu\n",
            boundary,
            recoveryBudget_.regionErrors(),
            static_cast<long long>(recoveryBudget_.skippedDurationUs() / 1000),
            static_cast<long long>(recoveryBudget_.skippedBytes()),
            static_cast<unsigned long long>(recoveryBudget_.totalErrors()));
        std::fflush(stderr);
        recoveryBudget_.resetRegion();
    }

    void drainPending(LibavPcmChunk& chunk, int maxFrames)
    {
        const size_t pendingFrames = (pendingSamples_.size() - pendingOffsetSamples_) / static_cast<size_t>(channels_);
        if (pendingFrames == 0)
        {
            pendingSamples_.clear();
            pendingOffsetSamples_ = 0;
            return;
        }

        const int framesToCopy = std::min(maxFrames - chunk.frames, static_cast<int>(pendingFrames));
        const size_t samplesToCopy = static_cast<size_t>(framesToCopy) * static_cast<size_t>(channels_);
        const auto begin = pendingSamples_.begin() + static_cast<std::ptrdiff_t>(pendingOffsetSamples_);
        chunk.samples.insert(chunk.samples.end(), begin, begin + static_cast<std::ptrdiff_t>(samplesToCopy));
        chunk.frames += framesToCopy;
        pendingOffsetSamples_ += samplesToCopy;

        if (pendingOffsetSamples_ >= pendingSamples_.size())
        {
            pendingSamples_.clear();
            pendingOffsetSamples_ = 0;
        }
    }

    void receiveAvailableFrames()
    {
        while (! cancelled_.load(std::memory_order_acquire))
        {
            const int receiveResult = avcodec_receive_frame(codecContext_, frame_);
            if (receiveResult == AVERROR(EAGAIN))
                return;
            if (receiveResult == AVERROR_EOF)
            {
                finishRecoveredDamageRegion("decoder_eof");
                decoderFlushed_ = true;
                return;
            }
            if (receiveResult < 0)
            {
                if (recoveryBudget_.tryConsume(receiveResult, LibavDecodeErrorStage::frame))
                {
                    logRecoverableError(LibavDecodeErrorStage::frame, receiveResult);
                    av_frame_unref(frame_);
                    continue;
                }
                if (receiveResult == AVERROR_INVALIDDATA)
                    throw std::runtime_error(libavErrorMessage(
                        "avcodec_receive_frame recovery budget exceeded",
                        receiveResult));
                throw std::runtime_error(libavErrorMessage("avcodec_receive_frame failed", receiveResult));
            }

            appendConvertedFrame(frame_);
            av_frame_unref(frame_);
            if (! pendingSamples_.empty())
            {
                finishRecoveredDamageRegion("decoded_pcm");
                return;
            }
        }
    }

    void appendConvertedFrame(const AVFrame* frame)
    {
        const int outputSamples = swr_get_out_samples(swrContext_, frame->nb_samples);
        if (outputSamples < 0)
            throw std::runtime_error(libavErrorMessage("swr_get_out_samples failed", outputSamples));

        std::vector<float> converted(static_cast<size_t>(outputSamples) * static_cast<size_t>(channels_));
        uint8_t* outputData[] = { reinterpret_cast<uint8_t*>(converted.data()) };
        const int convertedFrames = swr_convert(
            swrContext_,
            outputData,
            outputSamples,
            const_cast<const uint8_t**>(frame->extended_data),
            frame->nb_samples);
        if (convertedFrames < 0)
            throw std::runtime_error(libavErrorMessage("swr_convert failed", convertedFrames));

        converted.resize(static_cast<size_t>(convertedFrames) * static_cast<size_t>(channels_));
        pendingSamples_ = std::move(converted);
        pendingOffsetSamples_ = 0;
    }

    void readNextPacketOrStartFlush()
    {
        while (! cancelled_.load(std::memory_order_acquire))
        {
            const int readResult = av_read_frame(formatContext_, packet_);
            if (readResult == AVERROR_EOF)
            {
                finishRecoveredDamageRegion("input_eof");
                reachedInputEof_ = true;
                return;
            }
            if (readResult < 0)
            {
                if (recoveryBudget_.tryConsume(readResult, LibavDecodeErrorStage::demux))
                {
                    logRecoverableError(LibavDecodeErrorStage::demux, readResult);
                    continue;
                }
                if (readResult == AVERROR_INVALIDDATA)
                    throw std::runtime_error(libavErrorMessage(
                        "av_read_frame recovery budget exceeded",
                        readResult));
                throw std::runtime_error(libavErrorMessage("av_read_frame failed", readResult));
            }

            if (packet_->stream_index != audioStreamIndex_)
            {
                av_packet_unref(packet_);
                continue;
            }

            AVStream* stream = formatContext_->streams[audioStreamIndex_];
            const int64_t packetDurationUs = packet_->duration > 0
                ? av_rescale_q(packet_->duration, stream->time_base, AV_TIME_BASE_Q)
                : 0;
            const int64_t packetBytes = std::max<int64_t>(0, packet_->size);
            const int sendResult = avcodec_send_packet(codecContext_, packet_);
            av_packet_unref(packet_);
            if (sendResult == AVERROR(EAGAIN))
                return;
            if (sendResult < 0)
            {
                if (recoveryBudget_.tryConsume(
                        sendResult,
                        LibavDecodeErrorStage::packet,
                        packetDurationUs,
                        packetBytes))
                {
                    logRecoverableError(LibavDecodeErrorStage::packet, sendResult);
                    continue;
                }
                if (sendResult == AVERROR_INVALIDDATA)
                    throw std::runtime_error(libavErrorMessage(
                        "avcodec_send_packet recovery budget exceeded",
                        sendResult));
                throw std::runtime_error(libavErrorMessage("avcodec_send_packet failed", sendResult));
            }
            return;
        }
    }

    void flushDecoder()
    {
        const int sendResult = avcodec_send_packet(codecContext_, nullptr);
        if (sendResult < 0 && sendResult != AVERROR_EOF)
            throw std::runtime_error(libavErrorMessage("avcodec_send_packet flush failed", sendResult));
        receiveAvailableFrames();
    }

    AVFormatContext* formatContext_ = nullptr;
    AVCodecContext* codecContext_ = nullptr;
    SwrContext* swrContext_ = nullptr;
    AVPacket* packet_ = nullptr;
    AVFrame* frame_ = nullptr;
    AVChannelLayout outputLayout_ {};
    int audioStreamIndex_ = -1;
    int sampleRate_ = 0;
    int channels_ = 0;
    bool reachedInputEof_ = false;
    bool decoderFlushed_ = false;
    LibavDecodeRecoveryBudget recoveryBudget_;
    std::atomic<bool> cancelled_{false};
    std::atomic<bool> opening_{false};
    std::atomic<int64_t> openDeadlineNs_{0};
    std::vector<float> pendingSamples_;
    size_t pendingOffsetSamples_ = 0;
};

class LibavDecoder {
public:
    LibavDecoder() = default;
    ~LibavDecoder() { close(); }

    static AudioProbe probe(const std::string& filePath, const LibavInputOptions& inputOptions = {}) {
        AVFormatContext* fmtCtx = nullptr;
        if (openLibavInput(&fmtCtx, filePath, inputOptions) < 0)
            throw std::runtime_error("avformat_open_input failed");
        
        auto fmtDeleter = [](AVFormatContext* p) { if (p) avformat_close_input(&p); };
        std::unique_ptr<AVFormatContext, decltype(fmtDeleter)> ctx(fmtCtx, fmtDeleter);
        
        if (avformat_find_stream_info(ctx.get(), nullptr) < 0)
            throw std::runtime_error("avformat_find_stream_info failed");
        
        int audioStream = av_find_best_stream(ctx.get(), AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
        if (audioStream < 0)
            throw std::runtime_error("no audio stream found");
        
        AVStream* stream = ctx->streams[audioStream];
        const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
        
        AudioProbe result;
        result.durationSeconds = ctx->duration > 0 ? ctx->duration / (double)AV_TIME_BASE : 0.0;
        result.sampleRate = stream->codecpar->sample_rate;
        result.channels = stream->codecpar->ch_layout.nb_channels;
        result.bitDepth = stream->codecpar->bits_per_raw_sample > 0 ? stream->codecpar->bits_per_raw_sample : 16;
        result.codec = codec ? codec->name : "unknown";
        result.container = ctx->iformat ? ctx->iformat->name : "unknown";
        result.bitrate = stream->codecpar->bit_rate;
        
        return result;
    }

    DecodedAudio decode(const std::string& filePath, double startSeconds = 0.0, double durationSeconds = 0.0, int targetSampleRate = 0) {
        LibavPcmStreamDecoder stream;
        stream.open(filePath, targetSampleRate);
        if (startSeconds > 0.0)
            stream.seek(startSeconds);

        DecodedAudio result;
        result.sampleRate = stream.sampleRate();
        result.channels = stream.channels();

        const int64_t maxOutputFrames = durationSeconds > 0.0
            ? static_cast<int64_t>(durationSeconds * static_cast<double>(result.sampleRate))
            : 0;
        constexpr int blockFrames = 4096;

        while (! stream.eof())
        {
            int framesToRead = blockFrames;
            if (maxOutputFrames > 0)
            {
                const int64_t remainingFrames = maxOutputFrames - result.frameCount;
                if (remainingFrames <= 0)
                    break;
                framesToRead = static_cast<int>(std::min<int64_t>(blockFrames, remainingFrames));
            }

            auto chunk = stream.readFrames(framesToRead);
            if (chunk.frames <= 0)
                break;
            result.samples.insert(result.samples.end(), chunk.samples.begin(), chunk.samples.end());
            result.frameCount += chunk.frames;
        }

        return result;
    }

private:
    void close() {}
};

} // namespace echo
