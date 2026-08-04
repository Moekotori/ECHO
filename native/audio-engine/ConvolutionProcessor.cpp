#include "ConvolutionProcessor.h"
#include "DspSafetyLimiter.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/frame.h>
}

#include <algorithm>
#include <cmath>
#include <memory>
#include <sys/stat.h>
#include <vector>

namespace echo
{
namespace
{

float dbToGain(float db)
{
    return std::pow(10.0f, db / 20.0f);
}

float readLinear(const FloatAudioBuffer& buffer, int channel, double position)
{
    const int sourceSamples = buffer.getNumSamples();
    if (sourceSamples <= 0)
        return 0.0f;

    const double clamped = std::max(0.0, std::min(position, static_cast<double>(sourceSamples - 1)));
    const int index = static_cast<int>(std::floor(clamped));
    const int nextIndex = std::min(index + 1, sourceSamples - 1);
    const float fraction = static_cast<float>(clamped - static_cast<double>(index));
    const float left = buffer.getSample(channel, index);
    const float right = buffer.getSample(channel, nextIndex);
    return left + (right - left) * fraction;
}

bool isFiniteBuffer(const FloatAudioBuffer& buffer)
{
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            if (! std::isfinite(buffer.getSample(channel, sample)))
                return false;

    return true;
}

/// Decode an audio file into a FloatAudioBuffer using FFmpeg.
/// Returns an empty buffer (0 channels, 0 samples) on failure.
FloatAudioBuffer decodeAudioFile(const std::string& path)
{
    // Check file existence
    struct stat st {};
    if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode))
        return {};

    AVFormatContext* fmtCtx = nullptr;
    if (avformat_open_input(&fmtCtx, path.c_str(), nullptr, nullptr) < 0)
        return {};
    auto fmtDeleter = [](AVFormatContext* p) { if (p) avformat_close_input(&p); };
    std::unique_ptr<AVFormatContext, decltype(fmtDeleter)> ctx(fmtCtx, fmtDeleter);

    if (avformat_find_stream_info(ctx.get(), nullptr) < 0)
        return {};

    // Find the first audio stream
    int streamIdx = -1;
    for (unsigned i = 0; i < ctx->nb_streams; ++i)
    {
        if (ctx->streams[i] && ctx->streams[i]->codecpar
            && ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO)
        {
            streamIdx = static_cast<int>(i);
            break;
        }
    }
    if (streamIdx < 0)
        return {};

    AVStream* stream = ctx->streams[streamIdx];
    const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (codec == nullptr)
        return {};

    AVCodecContext* codecCtx = avcodec_alloc_context3(codec);
    if (codecCtx == nullptr)
        return {};
    auto codecDeleter = [](AVCodecContext* p) { if (p) avcodec_free_context(&p); };
    std::unique_ptr<AVCodecContext, decltype(codecDeleter)> cctx(codecCtx, codecDeleter);

    if (avcodec_parameters_to_context(cctx.get(), stream->codecpar) < 0)
        return {};

    if (avcodec_open2(cctx.get(), codec, nullptr) < 0)
        return {};

    const int outputChannels = std::min<int>(2, cctx->ch_layout.nb_channels);
    const int maxSamples = 8192 * 4; // roomCorrectionMaxTaps * 4 from ConvolutionProcessor
    std::vector<std::vector<float>> channelBuffers(static_cast<size_t>(outputChannels));
    for (auto& buf : channelBuffers)
        buf.reserve(static_cast<size_t>(maxSamples));

    AVPacket* pkt = av_packet_alloc();
    AVFrame* frame = av_frame_alloc();
    if (pkt == nullptr || frame == nullptr)
    {
        av_packet_free(&pkt);
        av_frame_free(&frame);
        return {};
    }

    bool drain = false;
    while (!drain)
    {
        int ret = drain ? 0 : av_read_frame(ctx.get(), pkt);
        if (ret < 0 && ret != AVERROR_EOF)
        {
            av_packet_unref(pkt);
            break;
        }
        if (ret == AVERROR_EOF)
        {
            drain = true;
            avcodec_send_packet(cctx.get(), nullptr);
        }
        else
        {
            if (pkt->stream_index != streamIdx)
            {
                av_packet_unref(pkt);
                continue;
            }
            avcodec_send_packet(cctx.get(), pkt);
            av_packet_unref(pkt);
        }

        while (true)
        {
            ret = avcodec_receive_frame(cctx.get(), frame);
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
                break;
            if (ret < 0)
                break;

            const int frameChannels = std::min<int>(outputChannels, frame->ch_layout.nb_channels);
            const int frameSamples = frame->nb_samples;

            // Check if we've exceeded the max
            if (!channelBuffers[0].empty()
                && static_cast<int>(channelBuffers[0].size()) + frameSamples > maxSamples)
            {
                av_frame_unref(frame);
                drain = true;
                break;
            }

            // Convert frame to float planar
            if (frame->format == AV_SAMPLE_FMT_FLTP || frame->format == AV_SAMPLE_FMT_FLT)
            {
                for (int ch = 0; ch < frameChannels; ++ch)
                {
                    const float* src = reinterpret_cast<const float*>(frame->extended_data[ch]);
                    channelBuffers[static_cast<size_t>(ch)].insert(
                        channelBuffers[static_cast<size_t>(ch)].end(), src, src + frameSamples);
                }
                // If the input has more channels than outputChannels, mix them
                for (int ch = frameChannels; ch < outputChannels; ++ch)
                    channelBuffers[static_cast<size_t>(ch)].insert(
                        channelBuffers[static_cast<size_t>(ch)].end(),
                        channelBuffers[static_cast<size_t>(ch - 1)].end() - frameSamples,
                        channelBuffers[static_cast<size_t>(ch - 1)].end());
            }
            else
            {
                // Convert integer/non-float planar formats to float planar manually
                const int bps = av_get_bytes_per_sample(static_cast<AVSampleFormat>(frame->format));
                for (int ch = 0; ch < frameChannels; ++ch)
                {
                    const uint8_t* src = frame->extended_data[ch];
                    for (int s = 0; s < frameSamples; ++s)
                    {
                        float sample = 0.0f;
                        if (bps == 2)
                            sample = reinterpret_cast<const int16_t*>(src)[s] / 32768.0f;
                        else if (bps == 4 && frame->format == AV_SAMPLE_FMT_FLT)
                            sample = reinterpret_cast<const float*>(src)[s];
                        else if (bps == 4)
                            sample = reinterpret_cast<const int32_t*>(src)[s] / 2147483648.0f;
                        else if (bps == 1)
                            sample = (reinterpret_cast<const uint8_t*>(src)[s] - 128) / 128.0f;

                        channelBuffers[static_cast<size_t>(ch)].push_back(sample);
                    }
                }
                // Duplicate channels if frame has fewer than outputChannels
                for (int ch = frameChannels; ch < outputChannels; ++ch)
                    channelBuffers[static_cast<size_t>(ch)].insert(
                        channelBuffers[static_cast<size_t>(ch)].end(),
                        channelBuffers[static_cast<size_t>(ch - 1)].begin() + static_cast<ptrdiff_t>(channelBuffers[static_cast<size_t>(ch - 1)].size() - frameSamples),
                        channelBuffers[static_cast<size_t>(ch - 1)].end());
            }

            av_frame_unref(frame);
        }
    }

    av_packet_free(&pkt);
    av_frame_free(&frame);

    if (channelBuffers[0].empty())
        return {};

    const int totalSamples = static_cast<int>(channelBuffers[0].size());
    FloatAudioBuffer result(outputChannels, totalSamples);
    for (int ch = 0; ch < outputChannels; ++ch)
    {
        const auto* src = channelBuffers[static_cast<size_t>(ch)].data();
        float* dst = result.getWritePointer(ch);
        std::copy_n(src, static_cast<size_t>(totalSamples), dst);
    }

    return result;
}

} // namespace

float clampRoomCorrectionTrimDb(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    return std::max(roomCorrectionMinTrimDb, std::min(roomCorrectionMaxTrimDb, value));
}

ConvolutionProcessor::ConvolutionProcessor() = default;

void ConvolutionProcessor::prepare(double sampleRate, int maximumBlockSize, int channelCount)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    preparedChannels = std::max(1, channelCount);
    preparedBlockSize = std::max(1, maximumBlockSize);
    history.assign(static_cast<size_t>(preparedChannels), std::vector<float>(static_cast<size_t>(roomCorrectionMaxTaps), 0.0f));
    historyWriteIndex = 0;
    clippingRisk.store(false, std::memory_order_release);
}

void ConvolutionProcessor::reset()
{
    for (auto& channelHistory : history)
        std::fill(channelHistory.begin(), channelHistory.end(), 0.0f);

    historyWriteIndex = 0;
    clippingRisk.store(false, std::memory_order_release);
}

void ConvolutionProcessor::processBlock(echo::FloatAudioBuffer& buffer, int startSample, int numSamples)
{
    if (numSamples <= 0)
        return;

    auto impulse = std::atomic_load_explicit(&activeImpulse, std::memory_order_acquire);
    const bool enabled = targetEnabled.load(std::memory_order_acquire);
    const int channelCount = std::min(buffer.getNumChannels(), preparedChannels);
    if (! enabled || impulse == nullptr || impulse->tapCount <= 0 || channelCount <= 0)
    {
        clippingRisk.store(false, std::memory_order_release);
        return;
    }

    const int tapCount = std::min(impulse->tapCount, roomCorrectionMaxTaps);
    const float trimGain = dbToGain(atomicTrimDb.load(std::memory_order_acquire));
    bool risk = false;

    for (int sample = 0; sample < numSamples; ++sample)
    {
        for (int channel = 0; channel < channelCount; ++channel)
        {
            const float input = sanitize(buffer.getSample(channel, startSample + sample));
            history[static_cast<size_t>(channel)][static_cast<size_t>(historyWriteIndex)] = input;
        }

        for (int channel = 0; channel < channelCount; ++channel)
        {
            const int impulseChannel = impulse->taps.size() <= 1 ? 0 : std::min(channel, static_cast<int>(impulse->taps.size()) - 1);
            const auto& taps = impulse->taps[static_cast<size_t>(impulseChannel)];
            const auto& channelHistory = history[static_cast<size_t>(channel)];
            double output = 0.0;

            for (int tap = 0; tap < tapCount; ++tap)
            {
                int historyIndex = historyWriteIndex - tap;
                if (historyIndex < 0)
                    historyIndex += roomCorrectionMaxTaps;

                output += static_cast<double>(taps[static_cast<size_t>(tap)]) * static_cast<double>(channelHistory[static_cast<size_t>(historyIndex)]);
            }

            buffer.setSample(
                channel,
                startSample + sample,
                protectClippingSample(static_cast<float>(output) * trimGain, isDspSafetyLimiterEnabled(), risk));
        }

        historyWriteIndex = (historyWriteIndex + 1) % roomCorrectionMaxTaps;
    }

    clippingRisk.store(risk, std::memory_order_release);
}

void ConvolutionProcessor::setEnabled(bool shouldBeEnabled)
{
    targetEnabled.store(shouldBeEnabled, std::memory_order_release);
}

void ConvolutionProcessor::setTrimDb(float value)
{
    atomicTrimDb.store(clampRoomCorrectionTrimDb(value), std::memory_order_release);
}

bool ConvolutionProcessor::loadImpulseResponse(const std::string& path, const std::string& id, const std::string& name)
{
    auto source = decodeAudioFile(path);
    if (source.getNumChannels() <= 0 || source.getNumSamples() <= 0)
    {
        hasError.store(true, std::memory_order_release);
        // Differentiate missing file from invalid audio
        struct stat st {};
        if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode))
            errorMessage = "missing_file";
        else
            errorMessage = "invalid_audio";
        return false;
    }

    const int sourceChannels = source.getNumChannels();
    const int sourceSamples = source.getNumSamples();

    // Check impulse length against max taps
    const double estimatedOutputSamples = static_cast<double>(sourceSamples) * currentSampleRate / std::max(1.0, currentSampleRate);
    if (! std::isfinite(estimatedOutputSamples) || estimatedOutputSamples > static_cast<double>(roomCorrectionMaxTaps))
    {
        hasError.store(true, std::memory_order_release);
        errorMessage = "impulse_too_long";
        return false;
    }

    // Truncate if necessary
    const int maxSourceSamples = roomCorrectionMaxTaps * 4;
    if (sourceSamples > maxSourceSamples)
    {
        FloatAudioBuffer trimmed(sourceChannels, maxSourceSamples);
        for (int ch = 0; ch < sourceChannels; ++ch)
        {
            const float* src = source.getReadPointer(ch);
            float* dst = trimmed.getWritePointer(ch);
            std::copy_n(src, static_cast<size_t>(maxSourceSamples), dst);
        }
        source = std::move(trimmed);
    }

    auto prepared = createPreparedImpulse(source, currentSampleRate, currentSampleRate, id, name);
    if (prepared == nullptr)
    {
        hasError.store(true, std::memory_order_release);
        errorMessage = "invalid_impulse";
        return false;
    }

    std::atomic_store_explicit(&activeImpulse, prepared, std::memory_order_release);
    reset();
    hasError.store(false, std::memory_order_release);
    errorMessage.clear();
    return true;
}

void ConvolutionProcessor::clearImpulseResponse()
{
    std::shared_ptr<const PreparedImpulse> empty;
    std::atomic_store_explicit(&activeImpulse, empty, std::memory_order_release);
    reset();
    hasError.store(false, std::memory_order_release);
    errorMessage.clear();
}

RoomCorrectionState ConvolutionProcessor::getState() const
{
    auto impulse = std::atomic_load_explicit(&activeImpulse, std::memory_order_acquire);
    RoomCorrectionState state;
    state.enabled = targetEnabled.load(std::memory_order_acquire);
    state.trimDb = atomicTrimDb.load(std::memory_order_acquire);
    state.clippingRisk = clippingRisk.load(std::memory_order_acquire);
    state.error = hasError.load(std::memory_order_acquire) ? errorMessage : std::string();

    if (impulse != nullptr)
    {
        state.status = state.enabled ? "active" : "loaded";
        state.irId = impulse->id;
        state.irName = impulse->name;
        state.channelMode = impulse->channelMode;
        state.sampleRate = impulse->sampleRate;
        state.tapCount = impulse->tapCount;
    }
    else
    {
        state.status = state.error.empty() ? "empty" : "error";
        state.channelMode = "none";
    }

    return state;
}

bool ConvolutionProcessor::isEnabled() const
{
    auto impulse = std::atomic_load_explicit(&activeImpulse, std::memory_order_acquire);
    return targetEnabled.load(std::memory_order_acquire) && impulse != nullptr && impulse->tapCount > 0;
}

bool ConvolutionProcessor::hasClippingRisk() const
{
    return clippingRisk.load(std::memory_order_acquire);
}

std::shared_ptr<const ConvolutionProcessor::PreparedImpulse> ConvolutionProcessor::createPreparedImpulse(
    const echo::FloatAudioBuffer& source,
    double sourceSampleRate,
    double targetSampleRate,
    const std::string& id,
    const std::string& name)
{
    if (source.getNumChannels() <= 0 || source.getNumSamples() <= 0 || ! isFiniteBuffer(source))
        return nullptr;

    const double safeSourceRate = sourceSampleRate > 0.0 ? sourceSampleRate : targetSampleRate;
    const double safeTargetRate = targetSampleRate > 0.0 ? targetSampleRate : safeSourceRate;
    const int outputSamples = std::max(1, static_cast<int>(std::ceil(static_cast<double>(source.getNumSamples()) * safeTargetRate / safeSourceRate)));
    if (outputSamples > roomCorrectionMaxTaps)
        return nullptr;

    auto impulse = std::make_shared<PreparedImpulse>();
    impulse->id = id;
    impulse->name = name;
    impulse->sampleRate = safeTargetRate;
    impulse->tapCount = outputSamples;
    impulse->channelMode = source.getNumChannels() > 1 ? "stereo" : "mono";
    impulse->taps.assign(static_cast<size_t>(std::min(2, source.getNumChannels())), std::vector<float>(static_cast<size_t>(outputSamples), 0.0f));

    const double ratio = safeSourceRate / safeTargetRate;
    for (int channel = 0; channel < static_cast<int>(impulse->taps.size()); ++channel)
    {
        for (int sample = 0; sample < outputSamples; ++sample)
            impulse->taps[static_cast<size_t>(channel)][static_cast<size_t>(sample)] = sanitize(readLinear(source, channel, static_cast<double>(sample) * ratio));
    }

    return impulse;
}

float ConvolutionProcessor::sanitize(float value)
{
    return std::isfinite(value) ? value : 0.0f;
}

float ConvolutionProcessor::protectClippingSample(float sample, bool shouldProtect, bool& risk)
{
    (void)shouldProtect;

    if (! std::isfinite(sample))
        return 0.0f;

    constexpr float riskThreshold = 0.98f;
    const float magnitude = std::abs(sample);
    risk = risk || magnitude > riskThreshold;
    return sample;
}

#if defined(ECHO_AUDIO_ENGINE_TESTS) && ECHO_AUDIO_ENGINE_TESTS
bool ConvolutionProcessor::loadImpulseResponseForTests(
    const std::vector<std::vector<float>>& taps,
    double sourceSampleRate,
    const std::string& id,
    const std::string& name)
{
    if (taps.empty() || taps[0].empty() || taps[0].size() > static_cast<size_t>(roomCorrectionMaxTaps))
        return false;

    const int channels = std::min<int>(2, static_cast<int>(taps.size()));
    const int samples = static_cast<int>(taps[0].size());
    FloatAudioBuffer source(channels, samples);
    for (int ch = 0; ch < channels; ++ch)
    {
        float* dst = source.getWritePointer(ch);
        for (int s = 0; s < std::min(samples, static_cast<int>(taps[static_cast<size_t>(ch)].size())); ++s)
            dst[s] = taps[static_cast<size_t>(ch)][static_cast<size_t>(s)];
    }

    auto prepared = createPreparedImpulse(source, sourceSampleRate, currentSampleRate, id, name);
    if (prepared == nullptr)
        return false;

    std::atomic_store_explicit(&activeImpulse, prepared, std::memory_order_release);
    reset();
    hasError.store(false, std::memory_order_release);
    errorMessage.clear();
    return true;
}
#endif
} // namespace echo