#include "src/decoder/AvDecoder.h"

#include <algorithm>
#include <cstring>
#include <iostream>
#include <limits>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/frame.h>
#include <libavutil/mem.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}

namespace ead = echo_audio_daemon;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Convert FFmpeg error code to human-readable string.
static std::string avErrorString(int err) {
    char buf[AV_ERROR_MAX_STRING_SIZE] = {};
    av_make_error_string(buf, sizeof(buf), err);
    return buf;
}

// Map AVSampleFormat name to a short string.
static const char* sampleFormatName(enum AVSampleFormat fmt) {
    switch (fmt) {
        case AV_SAMPLE_FMT_U8:   return "u8";
        case AV_SAMPLE_FMT_S16:  return "s16";
        case AV_SAMPLE_FMT_S32:  return "s32";
        case AV_SAMPLE_FMT_FLT:  return "f32";
        case AV_SAMPLE_FMT_DBL:  return "f64";
        case AV_SAMPLE_FMT_U8P:  return "u8p";
        case AV_SAMPLE_FMT_S16P: return "s16p";
        case AV_SAMPLE_FMT_S32P: return "s32p";
        case AV_SAMPLE_FMT_FLTP: return "f32p";
        case AV_SAMPLE_FMT_DBLP: return "f64p";
        default:                 return "unknown";
    }
}

// ── Construction / Destruction ──────────────────────────────────────────────

ead::AvDecoder::AvDecoder() {
    // Register all codecs, demuxers, and protocols once.
    // av_register_all() is deprecated; registration is automatic in FFmpeg 4.x+.
}

ead::AvDecoder::~AvDecoder() {
    cleanup();
}

// ── open() ──────────────────────────────────────────────────────────────────

bool ead::AvDecoder::open(const std::string& filePath, int targetSampleRate, int targetChannels) {
    std::lock_guard<std::mutex> lock(mutex_);

    // Close any previously open session.
    cleanup();

    targetSampleRate_ = targetSampleRate;
    targetChannels_ = targetChannels;

    // 1. Open input file
    int ret = avformat_open_input(&fmtCtx_, filePath.c_str(), nullptr, nullptr);
    if (ret < 0) {
        std::cerr << "[AvDecoder] avformat_open_input failed: " << avErrorString(ret)
                  << " (" << filePath << ")\n";
        return false;
    }

    // 2. Find stream info
    ret = avformat_find_stream_info(fmtCtx_, nullptr);
    if (ret < 0) {
        std::cerr << "[AvDecoder] avformat_find_stream_info failed: " << avErrorString(ret) << "\n";
        cleanup();
        return false;
    }

    // 3. Find best audio stream
    const AVCodec* codec = nullptr;
    streamIndex_ = av_find_best_stream(fmtCtx_, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0);
    if (streamIndex_ < 0) {
        std::cerr << "[AvDecoder] No audio stream found\n";
        cleanup();
        return false;
    }

    AVStream* stream = fmtCtx_->streams[streamIndex_];

    // 4. Allocate codec context
    codecCtx_ = avcodec_alloc_context3(codec);
    if (!codecCtx_) {
        std::cerr << "[AvDecoder] Failed to allocate codec context\n";
        cleanup();
        return false;
    }

    // 5. Copy codec parameters from stream to codec context
    ret = avcodec_parameters_to_context(codecCtx_, stream->codecpar);
    if (ret < 0) {
        std::cerr << "[AvDecoder] avcodec_parameters_to_context failed: " << avErrorString(ret) << "\n";
        cleanup();
        return false;
    }

    // 6. Open codec
    ret = avcodec_open2(codecCtx_, codec, nullptr);
    if (ret < 0) {
        std::cerr << "[AvDecoder] avcodec_open2 failed: " << avErrorString(ret) << "\n";
        cleanup();
        return false;
    }

    // 7. Store source properties
    srcSampleRate_ = codecCtx_->sample_rate;
    srcChannels_ = codecCtx_->ch_layout.nb_channels;

    // 8. Determine output sample rate and channels
    int outSampleRate = targetSampleRate_ > 0 ? targetSampleRate_ : srcSampleRate_;
    int outChannels = targetChannels_ > 0 ? targetChannels_ : srcChannels_;

    sampleRate_ = outSampleRate;
    channels_ = outChannels;

    // 9. Get duration
    if (fmtCtx_->duration != AV_NOPTS_VALUE) {
        duration_ = static_cast<double>(fmtCtx_->duration) / AV_TIME_BASE;
    } else if (stream->duration != AV_NOPTS_VALUE) {
        AVRational tb = stream->time_base;
        duration_ = static_cast<double>(stream->duration) * av_q2d(tb);
    }

    // 10. Set up resampler for float32 interleaved output
    AVChannelLayout outChLayout;
    av_channel_layout_default(&outChLayout, outChannels);

    AVChannelLayout inChLayout = codecCtx_->ch_layout;

    ret = swr_alloc_set_opts2(
        &swrCtx_,
        &outChLayout,                     // output channel layout
        AV_SAMPLE_FMT_FLT,                // output sample format (interleaved float32)
        outSampleRate,                    // output sample rate
        &inChLayout,                      // input channel layout
        codecCtx_->sample_fmt,            // input sample format
        codecCtx_->sample_rate,           // input sample rate
        0,                                // log offset
        nullptr                           // log context
    );
    if (ret < 0 || !swrCtx_) {
        std::cerr << "[AvDecoder] swr_alloc_set_opts2 failed: " << avErrorString(ret) << "\n";
        cleanup();
        return false;
    }

    ret = swr_init(swrCtx_);
    if (ret < 0) {
        std::cerr << "[AvDecoder] swr_init failed: " << avErrorString(ret) << "\n";
        cleanup();
        return false;
    }

    // 11. Allocate reusable packet and frame
    pkt_ = av_packet_alloc();
    frame_ = av_frame_alloc();
    if (!pkt_ || !frame_) {
        std::cerr << "[AvDecoder] Failed to allocate packet/frame\n";
        cleanup();
        return false;
    }

    // 12. Reset state
    sampleBuf_.clear();
    sampleBufPos_ = 0;
    eof_ = false;

    return true;
}

// ── decode() ────────────────────────────────────────────────────────────────

int ead::AvDecoder::decode(float* output, int maxFrames) {
    if (!output || maxFrames <= 0 || !isOpen()) {
        return 0;
    }

    std::lock_guard<std::mutex> lock(mutex_);

    int totalFrames = 0;
    int samplesPerFrame = channels_;

    while (totalFrames < maxFrames) {
        // Consume from internal buffer first
        size_t availableSamples = sampleBuf_.size() - sampleBufPos_;
        size_t neededSamples = static_cast<size_t>((maxFrames - totalFrames)) * samplesPerFrame;

        if (availableSamples > 0) {
            size_t copySamples = std::min(availableSamples, neededSamples);
            std::memcpy(output + totalFrames * samplesPerFrame,
                        sampleBuf_.data() + sampleBufPos_,
                        copySamples * sizeof(float));
            sampleBufPos_ += copySamples;
            totalFrames += static_cast<int>(copySamples / samplesPerFrame);

            // If we filled the request, done
            if (totalFrames >= maxFrames) {
                break;
            }
        }

        // If we hit EOF and buffer is drained, stop
        if (eof_) {
            break;
        }

        // Decode more packets
        bool progress = decodePacket();
        if (!progress) {
            break;
        }
    }

    return totalFrames;
}

// ── decodePacket() ──────────────────────────────────────────────────────────

bool ead::AvDecoder::decodePacket() {
    // Read packets until we get a decoded frame or hit EOF
    while (true) {
        int ret = av_read_frame(fmtCtx_, pkt_);
        if (ret < 0) {
            if (ret == AVERROR_EOF) {
                // Flush the decoder
                avcodec_send_packet(codecCtx_, nullptr);
                eof_ = true;
            }
            // Try to receive any remaining frames from decoder
            break;
        }

        if (pkt_->stream_index != streamIndex_) {
            av_packet_unref(pkt_);
            continue;
        }

        ret = avcodec_send_packet(codecCtx_, pkt_);
        av_packet_unref(pkt_);
        if (ret < 0) {
            // Skip problematic packets
            continue;
        }

        // Try to receive a frame
        ret = avcodec_receive_frame(codecCtx_, frame_);
        if (ret >= 0) {
            // Convert and store
            convertAndStoreFrame();
            av_frame_unref(frame_);
            return true;  // got data
        }
        // EAGAIN means need more packets, continue reading
    }

    // Flush remaining frames from decoder after EOF
    while (true) {
        int ret = avcodec_receive_frame(codecCtx_, frame_);
        if (ret < 0) {
            break;
        }
        convertAndStoreFrame();
        av_frame_unref(frame_);
        if (sampleBuf_.size() > sampleBufPos_) {
            return true;
        }
    }

    // After decoder is flushed, try to flush SWR buffer
    if (!flushResampler()) {
        return sampleBuf_.size() > sampleBufPos_;
    }
    return sampleBuf_.size() > sampleBufPos_;
}

// ── convertAndStoreFrame() ──────────────────────────────────────────────────

void ead::AvDecoder::convertAndStoreFrame() {
    if (!frame_ || frame_->nb_samples <= 0) {
        return;
    }

    // Determine output buffer size for swr_convert
    int outSamples = swr_get_out_samples(swrCtx_, frame_->nb_samples);
    if (outSamples <= 0) {
        outSamples = frame_->nb_samples * 2;  // safe estimate
    }

    // Allocate temporary output buffer for planar (we'll convert to interleaved manually)
    // Actually, since we set output format to AV_SAMPLE_FMT_FLT (interleaved),
    // swr_convert will produce interleaved data in one buffer.
    uint8_t* outBuf[1] = {nullptr};
    int linesize = 0;

    // Use av_samples_alloc for proper alignment
    int bufSize = av_samples_alloc(outBuf, &linesize, channels_, outSamples,
                                   AV_SAMPLE_FMT_FLT, 0);
    if (bufSize < 0) {
        return;
    }

    int converted = swr_convert(swrCtx_, outBuf, outSamples,
                                const_cast<const uint8_t**>(frame_->data),
                                frame_->nb_samples);
    if (converted > 0) {
        // Append converted samples to internal buffer
        size_t oldSize = sampleBuf_.size();
        size_t newSamples = static_cast<size_t>(converted) * channels_;
        sampleBuf_.resize(oldSize + newSamples);
        std::memcpy(sampleBuf_.data() + oldSize, outBuf[0],
                    newSamples * sizeof(float));
    }

    av_freep(&outBuf[0]);
}

// ── flushResampler() ────────────────────────────────────────────────────────

bool ead::AvDecoder::flushResampler() {
    if (!swrCtx_) return false;

    uint8_t* outBuf[1] = {nullptr};
    int estOutSamples = swr_get_out_samples(swrCtx_, 0);
    if (estOutSamples <= 0) {
        return false;
    }

    int linesize = 0;
    int bufSize = av_samples_alloc(outBuf, &linesize, channels_, estOutSamples,
                                   AV_SAMPLE_FMT_FLT, 0);
    if (bufSize < 0) {
        return false;
    }

    int converted = swr_convert(swrCtx_, outBuf, estOutSamples, nullptr, 0);
    if (converted > 0) {
        size_t oldSize = sampleBuf_.size();
        size_t newSamples = static_cast<size_t>(converted) * channels_;
        sampleBuf_.resize(oldSize + newSamples);
        std::memcpy(sampleBuf_.data() + oldSize, outBuf[0],
                    newSamples * sizeof(float));
    }

    av_freep(&outBuf[0]);
    return converted > 0;
}

// ── seek() ──────────────────────────────────────────────────────────────────

bool ead::AvDecoder::seek(double seconds) {
    if (!isOpen()) {
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);

    // Convert seconds to stream timebase
    int64_t timestamp = static_cast<int64_t>(seconds * AV_TIME_BASE);
    int ret = av_seek_frame(fmtCtx_, -1, timestamp, AVSEEK_FLAG_BACKWARD);
    if (ret < 0) {
        // Try with stream index
        AVStream* stream = fmtCtx_->streams[streamIndex_];
        AVRational tb = stream->time_base;
        int64_t streamTs = static_cast<int64_t>(seconds / av_q2d(tb));
        ret = av_seek_frame(fmtCtx_, streamIndex_, streamTs, AVSEEK_FLAG_BACKWARD);
        if (ret < 0) {
            return false;
        }
    }

    // Flush decoder and swr buffers
    avcodec_flush_buffers(codecCtx_);

    // Reset internal state
    sampleBuf_.clear();
    sampleBufPos_ = 0;
    eof_ = false;

    return true;
}

// ── close() ─────────────────────────────────────────────────────────────────

void ead::AvDecoder::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    cleanup();
}

// ── cleanup() ───────────────────────────────────────────────────────────────

void ead::AvDecoder::cleanup() {
    if (swrCtx_) {
        swr_free(&swrCtx_);
        swrCtx_ = nullptr;
    }
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }
    if (fmtCtx_) {
        avformat_close_input(&fmtCtx_);
        fmtCtx_ = nullptr;
    }
    av_frame_free(&frame_);
    av_packet_free(&pkt_);

    streamIndex_ = -1;
    srcSampleRate_ = 0;
    srcChannels_ = 0;
    sampleRate_ = 0;
    channels_ = 0;
    duration_ = 0.0;
    sampleBuf_.clear();
    sampleBuf_.shrink_to_fit();
    sampleBufPos_ = 0;
    eof_ = false;
}

// ── probe() static ──────────────────────────────────────────────────────────

ead::AudioFormat ead::AvDecoder::probe(const std::string& filePath) {
    AudioFormat result;

    AVFormatContext* fmtCtx = nullptr;
    int ret = avformat_open_input(&fmtCtx, filePath.c_str(), nullptr, nullptr);
    if (ret < 0) {
        return result;  // empty / invalid format
    }

    ret = avformat_find_stream_info(fmtCtx, nullptr);
    if (ret < 0) {
        avformat_close_input(&fmtCtx);
        return result;
    }

    // Set format name
    if (fmtCtx->iformat) {
        result.format = fmtCtx->iformat->name ? fmtCtx->iformat->name : "";
    }

    // Duration
    if (fmtCtx->duration != AV_NOPTS_VALUE) {
        result.duration = static_cast<double>(fmtCtx->duration) / AV_TIME_BASE;
    }

    // Find audio stream
    const AVCodec* codec = nullptr;
    int streamIdx = av_find_best_stream(fmtCtx, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0);
    if (streamIdx >= 0) {
        AVStream* stream = fmtCtx->streams[streamIdx];
        AVCodecParameters* par = stream->codecpar;

        result.sampleRate = par->sample_rate;
        result.channels = par->ch_layout.nb_channels;
        result.bitRate = par->bit_rate;

        // Codec name
        if (codec && codec->name) {
            result.codec = codec->name;
        }

        // Bit depth from sample format (stored in bitRate field as proxy)
        // AudioFormat doesn't have bitDepth; bitRate is available instead.
        if (par->format != AV_SAMPLE_FMT_NONE) {
            int bytesPerSample = av_get_bytes_per_sample(static_cast<AVSampleFormat>(par->format));
            if (bytesPerSample > 0 && result.bitRate == 0) {
                // Approximate bitrate from sample format if not known
                result.bitRate = bytesPerSample * 8 * par->sample_rate * par->ch_layout.nb_channels;
            }
        }

        // If stream has its own duration (more accurate for some formats)
        if (result.duration <= 0.0 && stream->duration != AV_NOPTS_VALUE) {
            AVRational tb = stream->time_base;
            result.duration = static_cast<double>(stream->duration) * av_q2d(tb);
        }
    }

    avformat_close_input(&fmtCtx);
    return result;
}
