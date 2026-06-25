#pragma once

#include "../common/AudioTypes.h"
#include <string>
#include <vector>
#include <memory>
#include <mutex>

struct AVFormatContext;
struct AVCodecContext;
struct AVStream;
struct SwrContext;
struct AVFrame;
struct AVPacket;

namespace echo_audio_daemon {

// ── AvDecoder ──────────────────────────────────────────────────────────────
// libavformat/libavcodec/libswresample wrapper for opening audio files,
// decoding to interleaved float32 PCM, seeking, and probing file metadata.
//
// Thread safety: all public methods are guarded by a mutex except static
// probe() and isOpen()/getSampleRate()/getChannels()/getDuration() which
// are safe to call after construction / after close().
class AvDecoder {
public:
    AvDecoder();
    ~AvDecoder();

    // Open file and prepare for decoding.
    // targetSampleRate: 0 = native rate; targetChannels: 0 = native channels.
    bool open(const std::string& filePath, int targetSampleRate = 0, int targetChannels = 0);

    // Decode up to maxFrames frames of audio into interleaved float32 output.
    // Returns actual number of frames decoded (0 on end-of-file or error).
    int decode(float* output, int maxFrames);

    // Seek to position in seconds. Returns true on success.
    bool seek(double seconds);

    // Close and release all decoder resources.
    void close();

    // Probe file metadata without opening for decode.
    static AudioFormat probe(const std::string& filePath);

    // ── State queries (safe to call without lock after construction/close) ──
    bool isOpen() const { return fmtCtx_ != nullptr; }
    int getSampleRate() const { return sampleRate_; }
    int getChannels() const { return channels_; }
    double getDuration() const { return duration_; }
    int getTargetSampleRate() const { return targetSampleRate_; }
    int getTargetChannels() const { return targetChannels_; }

private:
    // Internal: decode one packet and push converted samples into internal buffer.
    // Returns true if more frames may be available, false on EOF or error.
    bool decodePacket();

    // Internal: convert a decoded frame via swr and append to sample buffer.
    void convertAndStoreFrame();

    // Internal: flush remaining samples from swr converter.
    bool flushResampler();

    // Free all FFmpeg resources (no lock).
    void cleanup();

    AVFormatContext* fmtCtx_ = nullptr;
    AVCodecContext*  codecCtx_ = nullptr;
    SwrContext*      swrCtx_ = nullptr;
    int streamIndex_ = -1;

    // Source properties
    int srcSampleRate_ = 0;
    int srcChannels_ = 0;

    // Target (output) properties
    int targetSampleRate_ = 0;
    int targetChannels_ = 0;

    // Decoded output properties
    int sampleRate_ = 0;
    int channels_ = 0;
    double duration_ = 0.0;

    // Reusable packet and frame (cached to avoid alloc churn)
    AVPacket* pkt_ = nullptr;
    AVFrame*  frame_ = nullptr;

    // Internal sample buffer (interleaved float32)
    std::vector<float> sampleBuf_;
    size_t sampleBufPos_ = 0;  // read position in samples (frames * channels)

    bool eof_ = false;
    std::mutex mutex_;
};

} // namespace echo_audio_daemon
