#pragma once
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswresample/swresample.h>
#include <libavutil/opt.h>
}
#include <algorithm>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace echo {

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

class LibavPcmStreamDecoder {
public:
    LibavPcmStreamDecoder() = default;
    ~LibavPcmStreamDecoder() { close(); }

    LibavPcmStreamDecoder(const LibavPcmStreamDecoder&) = delete;
    LibavPcmStreamDecoder& operator=(const LibavPcmStreamDecoder&) = delete;

    void open(const std::string& filePath, int targetSampleRate = 0)
    {
        close();
        cancelled_ = false;
        reachedInputEof_ = false;
        decoderFlushed_ = false;
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;

        if (avformat_open_input(&formatContext_, filePath.c_str(), nullptr, nullptr) < 0)
            throw std::runtime_error("avformat_open_input failed");

        try
        {
            if (avformat_find_stream_info(formatContext_, nullptr) < 0)
                throw std::runtime_error("avformat_find_stream_info failed");

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
            channels_ = codecContext_->ch_layout.nb_channels;
            if (sampleRate_ <= 0)
                throw std::runtime_error("source sample rate unavailable");
            if (channels_ <= 0)
                throw std::runtime_error("source channel count unavailable");

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
    bool eof() const { return ! isOpen() || cancelled_ || (decoderFlushed_ && pendingOffsetSamples_ >= pendingSamples_.size()); }
    bool cancelled() const { return cancelled_; }

    void cancel()
    {
        cancelled_ = true;
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;
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
        pendingSamples_.clear();
        pendingOffsetSamples_ = 0;
        cancelled_ = false;
    }

    LibavPcmChunk readFrames(int maxFrames)
    {
        ensureOpen();
        if (maxFrames <= 0 || cancelled_)
            return {};

        LibavPcmChunk chunk;
        chunk.samples.reserve(static_cast<size_t>(maxFrames) * static_cast<size_t>(channels_));

        while (chunk.frames < maxFrames && ! cancelled_)
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
        cancelled_ = false;

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
    void ensureOpen() const
    {
        if (formatContext_ == nullptr || codecContext_ == nullptr || swrContext_ == nullptr)
            throw std::runtime_error("LibavPcmStreamDecoder is not open");
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
        while (! cancelled_)
        {
            const int receiveResult = avcodec_receive_frame(codecContext_, frame_);
            if (receiveResult == AVERROR(EAGAIN))
                return;
            if (receiveResult == AVERROR_EOF)
            {
                decoderFlushed_ = true;
                return;
            }
            if (receiveResult < 0)
                throw std::runtime_error("avcodec_receive_frame failed");

            appendConvertedFrame(frame_);
            av_frame_unref(frame_);
            if (! pendingSamples_.empty())
                return;
        }
    }

    void appendConvertedFrame(const AVFrame* frame)
    {
        const int outputSamples = swr_get_out_samples(swrContext_, frame->nb_samples);
        if (outputSamples < 0)
            throw std::runtime_error("swr_get_out_samples failed");

        std::vector<float> converted(static_cast<size_t>(outputSamples) * static_cast<size_t>(channels_));
        uint8_t* outputData[] = { reinterpret_cast<uint8_t*>(converted.data()) };
        const int convertedFrames = swr_convert(
            swrContext_,
            outputData,
            outputSamples,
            const_cast<const uint8_t**>(frame->extended_data),
            frame->nb_samples);
        if (convertedFrames < 0)
            throw std::runtime_error("swr_convert failed");

        converted.resize(static_cast<size_t>(convertedFrames) * static_cast<size_t>(channels_));
        pendingSamples_ = std::move(converted);
        pendingOffsetSamples_ = 0;
    }

    void readNextPacketOrStartFlush()
    {
        while (! cancelled_)
        {
            const int readResult = av_read_frame(formatContext_, packet_);
            if (readResult == AVERROR_EOF)
            {
                reachedInputEof_ = true;
                return;
            }
            if (readResult < 0)
                throw std::runtime_error("av_read_frame failed");

            if (packet_->stream_index != audioStreamIndex_)
            {
                av_packet_unref(packet_);
                continue;
            }

            const int sendResult = avcodec_send_packet(codecContext_, packet_);
            av_packet_unref(packet_);
            if (sendResult == AVERROR(EAGAIN))
                return;
            if (sendResult < 0)
                throw std::runtime_error("avcodec_send_packet failed");
            return;
        }
    }

    void flushDecoder()
    {
        const int sendResult = avcodec_send_packet(codecContext_, nullptr);
        if (sendResult < 0 && sendResult != AVERROR_EOF)
            throw std::runtime_error("avcodec_send_packet flush failed");
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
    bool cancelled_ = false;
    std::vector<float> pendingSamples_;
    size_t pendingOffsetSamples_ = 0;
};

class LibavDecoder {
public:
    LibavDecoder() = default;
    ~LibavDecoder() { close(); }

    static AudioProbe probe(const std::string& filePath) {
        AVFormatContext* fmtCtx = nullptr;
        if (avformat_open_input(&fmtCtx, filePath.c_str(), nullptr, nullptr) < 0)
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
