#include "../../audio-engine/ChannelBalanceProcessor.h"
#include "../../audio-engine/DspChain.h"
#include "../../audio-engine/EqMessageProtocol.h"
#include "../../audio-engine/EqProcessor.h"

#ifdef _WIN32
#include "../third_party/asio-sdk/common/asio.h"
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <sstream>
#include <string>
#include <vector>

#define ECHO_AUDIO_HOST_TESTS 1

#include "../src/Options.h"
#include "../src/HostUtils.h"
#include "../src/DeviceTypes.h"
#include "../src/PcmRingAudioSource.h"
#include "../src/DopRingSource.h"
#include "../src/NativeDsdRingSource.h"
#include "../src/AudioDaemon.h"
#include "../../audio-engine/JsonRpcProtocol.h"

#include "../src/main.cpp"

namespace
{
constexpr float strictTolerance = 0.0f;
constexpr float nearTolerance = 0.0001f;

void require(bool condition, const std::string& message)
{
    if (! condition)
        throw std::runtime_error(message);
}

void requireContains(const std::string& text, const std::string& needle, const std::string& message)
{
    require(text.find(needle) != std::string::npos, message + " missing: " + needle + " in " + text);
}

void requireThrowsContaining(const std::function<void()>& callback, const std::string& needle, const std::string& message)
{
    try
    {
        callback();
    }
    catch (const std::exception& error)
    {
        requireContains(error.what(), needle, message);
        return;
    }

    throw std::runtime_error(message + " did not throw");
}

void requireVectorEquals(const std::vector<int>& actual, const std::vector<int>& expected, const std::string& message)
{
    require(actual == expected, message);
}

void writeLe16(std::ofstream& out, uint16_t value)
{
    char bytes[2] {
        static_cast<char>(value & 0xff),
        static_cast<char>((value >> 8) & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

void writeLe32(std::ofstream& out, uint32_t value)
{
    char bytes[4] {
        static_cast<char>(value & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 24) & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

void writeLe64(std::ofstream& out, uint64_t value)
{
    char bytes[8] {
        static_cast<char>(value & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 24) & 0xff),
        static_cast<char>((value >> 32) & 0xff),
        static_cast<char>((value >> 40) & 0xff),
        static_cast<char>((value >> 48) & 0xff),
        static_cast<char>((value >> 56) & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

void writeBe16(std::ofstream& out, uint16_t value)
{
    char bytes[2] {
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>(value & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

void writeBe32(std::ofstream& out, uint32_t value)
{
    char bytes[4] {
        static_cast<char>((value >> 24) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>(value & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

void writeBe64(std::ofstream& out, uint64_t value)
{
    char bytes[8] {
        static_cast<char>((value >> 56) & 0xff),
        static_cast<char>((value >> 48) & 0xff),
        static_cast<char>((value >> 40) & 0xff),
        static_cast<char>((value >> 32) & 0xff),
        static_cast<char>((value >> 24) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>(value & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

std::string writeStreamingDecoderWavFixture(int sampleRate, int channels, int frames)
{
    const auto path = std::filesystem::temp_directory_path()
        / std::filesystem::path("echo-libav-streaming-" + std::to_string(reinterpret_cast<uintptr_t>(&sampleRate)) + ".wav");
    std::ofstream out(path, std::ios::binary);
    require(out.good(), "streaming decoder test can create WAV fixture");

    const uint16_t bitsPerSample = 16;
    const uint32_t dataBytes = static_cast<uint32_t>(frames * channels * (bitsPerSample / 8));
    const uint32_t byteRate = static_cast<uint32_t>(sampleRate * channels * (bitsPerSample / 8));
    const uint16_t blockAlign = static_cast<uint16_t>(channels * (bitsPerSample / 8));

    out.write("RIFF", 4);
    writeLe32(out, 36 + dataBytes);
    out.write("WAVE", 4);
    out.write("fmt ", 4);
    writeLe32(out, 16);
    writeLe16(out, 1);
    writeLe16(out, static_cast<uint16_t>(channels));
    writeLe32(out, static_cast<uint32_t>(sampleRate));
    writeLe32(out, byteRate);
    writeLe16(out, blockAlign);
    writeLe16(out, bitsPerSample);
    out.write("data", 4);
    writeLe32(out, dataBytes);

    for (int frame = 0; frame < frames; ++frame)
    {
        for (int channel = 0; channel < channels; ++channel)
        {
            const auto sample = static_cast<int16_t>(((frame * 17 + channel * 4096) % 20000) - 10000);
            writeLe16(out, static_cast<uint16_t>(sample));
        }
    }

    require(out.good(), "streaming decoder test writes WAV fixture");
    return path.string();
}

std::string writeStreamingDecoderDsfFixture()
{
    constexpr uint32_t nativeSampleRate = 2822400;
    constexpr uint32_t channels = 2;
    constexpr uint32_t blockBytesPerChannel = 4096;
    constexpr uint64_t samplesPerChannel = static_cast<uint64_t>(blockBytesPerChannel) * 8;
    constexpr uint64_t dataBytes = static_cast<uint64_t>(blockBytesPerChannel) * channels;
    constexpr uint64_t fileBytes = 28 + 52 + 12 + dataBytes;
    const auto path = std::filesystem::temp_directory_path()
        / std::filesystem::path("echo-libav-streaming-dsd64.dsf");
    std::ofstream out(path, std::ios::binary);
    require(out.good(), "DSD streaming decoder test can create DSF fixture");

    out.write("DSD ", 4);
    writeLe64(out, 28);
    writeLe64(out, fileBytes);
    writeLe64(out, 0);

    out.write("fmt ", 4);
    writeLe64(out, 52);
    writeLe32(out, 1);
    writeLe32(out, 0);
    writeLe32(out, 2);
    writeLe32(out, channels);
    writeLe32(out, nativeSampleRate);
    writeLe32(out, 1);
    writeLe64(out, samplesPerChannel);
    writeLe32(out, blockBytesPerChannel);
    writeLe32(out, 0);

    out.write("data", 4);
    writeLe64(out, 12 + dataBytes);
    for (uint32_t channel = 0; channel < channels; ++channel)
    {
        for (uint32_t index = 0; index < blockBytesPerChannel; ++index)
        {
            const unsigned char byte = ((index + channel) & 1) == 0 ? 0x69 : 0x96;
            out.put(static_cast<char>(byte));
        }
    }

    require(out.good(), "DSD streaming decoder test writes DSF fixture");
    out.close();
    return path.string();
}

std::string writeStreamingDecoderDffFixture()
{
    constexpr uint32_t nativeSampleRate = 2822400;
    constexpr uint16_t channels = 2;
    constexpr uint32_t bytesPerChannel = 4096;
    constexpr uint64_t dataBytes = static_cast<uint64_t>(bytesPerChannel) * channels;
    constexpr uint64_t propertyBytes = 4 + (12 + 4) + (12 + 10) + (12 + 4);
    constexpr uint64_t fileBytes = 16 + (12 + 4) + (12 + propertyBytes) + (12 + dataBytes);
    const auto path = std::filesystem::temp_directory_path()
        / std::filesystem::path("echo-libav-streaming-dsd64.dff");
    std::ofstream out(path, std::ios::binary);
    require(out.good(), "DSD streaming decoder test can create DFF fixture");

    out.write("FRM8", 4);
    writeBe64(out, fileBytes - 12);
    out.write("DSD ", 4);

    out.write("FVER", 4);
    writeBe64(out, 4);
    writeBe32(out, 0x01050000);

    out.write("PROP", 4);
    writeBe64(out, propertyBytes);
    out.write("SND ", 4);
    out.write("FS  ", 4);
    writeBe64(out, 4);
    writeBe32(out, nativeSampleRate);
    out.write("CHNL", 4);
    writeBe64(out, 10);
    writeBe16(out, channels);
    out.write("SLFT", 4);
    out.write("SRGT", 4);
    out.write("CMPR", 4);
    writeBe64(out, 4);
    out.write("DSD ", 4);

    out.write("DSD ", 4);
    writeBe64(out, dataBytes);
    for (uint32_t index = 0; index < bytesPerChannel; ++index)
    {
        out.put(static_cast<char>((index & 1) == 0 ? 0x69 : 0x96));
        out.put(static_cast<char>((index & 1) == 0 ? 0x96 : 0x69));
    }

    require(out.good(), "DSD streaming decoder test writes DFF fixture");
    out.close();
    return path.string();
}

class ScopedFileRemoval final
{
public:
    explicit ScopedFileRemoval(std::string path) : path_(std::move(path)) {}
    ~ScopedFileRemoval()
    {
        if (! path_.empty())
            std::remove(path_.c_str());
    }

private:
    std::string path_;
};

echo::FloatAudioBuffer makeBuffer(int channels, int samples)
{
    echo::FloatAudioBuffer buffer(channels, samples);

    for (int channel = 0; channel < channels; ++channel)
    {
        auto* data = buffer.getWritePointer(channel);
        for (int sample = 0; sample < samples; ++sample)
            data[sample] = 0.15f * std::sin(static_cast<float>(sample + 1) * 0.07f + static_cast<float>(channel) * 0.31f);
    }

    return buffer;
}

echo::FloatAudioBuffer makeFloatBuffer(int channels, int samples)
{
    echo::FloatAudioBuffer buffer(channels, samples);

    for (int channel = 0; channel < channels; ++channel)
    {
        auto* data = buffer.getWritePointer(channel);
        for (int sample = 0; sample < samples; ++sample)
            data[sample] = 0.15f * std::sin(static_cast<float>(sample + 1) * 0.07f + static_cast<float>(channel) * 0.31f);
    }

    return buffer;
}

struct DspChainFixture
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::ReplayGainProcessor replayGainProcessor;
    echo::CompressorProcessor compressorProcessor;
    echo::SpatialDspProcessor spatialDspProcessor;
    echo::PlaybackRateProcessor playbackRateProcessor;
    echo::LevelMeterProcessor levelMeterProcessor;
    echo::DspChain dspChain;

    DspChainFixture()
        : dspChain(
            eqProcessor,
            convolutionProcessor,
            channelBalanceProcessor,
            headroomProcessor,
            replayGainProcessor,
            compressorProcessor,
            spatialDspProcessor,
            playbackRateProcessor,
            levelMeterProcessor)
    {
    }
};

void requireBuffersClose(
    const echo::FloatAudioBuffer& actual,
    const echo::FloatAudioBuffer& expected,
    float tolerance,
    const std::string& message)
{
    require(actual.getNumChannels() == expected.getNumChannels(), message + " channel count");
    require(actual.getNumSamples() == expected.getNumSamples(), message + " sample count");

    for (int channel = 0; channel < actual.getNumChannels(); ++channel)
    {
        const auto* actualData = actual.getReadPointer(channel);
        const auto* expectedData = expected.getReadPointer(channel);
        for (int sample = 0; sample < actual.getNumSamples(); ++sample)
        {
            const float delta = std::abs(actualData[sample] - expectedData[sample]);
            require(delta <= tolerance, message + " at channel " + std::to_string(channel) + " sample " + std::to_string(sample));
        }
    }
}

void requireFinite(const echo::FloatAudioBuffer& buffer, const std::string& message)
{
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* data = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            require(std::isfinite(data[sample]), message);
    }
}

void testConvolutionIdentityIsTransparent()
{
    echo::ConvolutionProcessor processor;
    processor.prepare(48000.0, 64, 2);
    require(processor.loadImpulseResponseForTests({ { 1.0f } }, 48000.0, "identity", "Identity"), "identity IR loads");
    processor.setEnabled(true);

    auto buffer = makeFloatBuffer(2, 64);
    auto dry = buffer;
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(processor.isEnabled(), "convolution reports enabled");
    requireBuffersClose(buffer, dry, nearTolerance, "identity convolution must be transparent");
}

void testConvolutionDelayImpulse()
{
    echo::ConvolutionProcessor processor;
    processor.prepare(48000.0, 8, 1);
    require(processor.loadImpulseResponseForTests({ { 0.0f, 1.0f } }, 48000.0, "delay", "Delay"), "delay IR loads");
    processor.setEnabled(true);

    echo::FloatAudioBuffer buffer(1, 4);
    buffer.clear();
    buffer.setSample(0, 0, 0.5f);
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(std::abs(buffer.getSample(0, 0)) <= nearTolerance, "delay sample 0");
    require(std::abs(buffer.getSample(0, 1) - 0.5f) <= nearTolerance, "delay sample 1");
    requireFinite(buffer, "delay convolution finite");
}

void testConvolutionStereoMapping()
{
    echo::ConvolutionProcessor processor;
    processor.prepare(44100.0, 8, 2);
    require(processor.loadImpulseResponseForTests({ { 1.0f }, { 0.5f } }, 44100.0, "stereo", "Stereo"), "stereo IR loads");
    processor.setEnabled(true);

    echo::FloatAudioBuffer buffer(2, 4);
    for (int sample = 0; sample < 4; ++sample)
    {
        buffer.setSample(0, sample, 0.25f);
        buffer.setSample(1, sample, 0.25f);
    }
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(std::abs(buffer.getSample(0, 0) - 0.25f) <= nearTolerance, "left stereo FIR");
    require(std::abs(buffer.getSample(1, 0) - 0.125f) <= nearTolerance, "right stereo FIR");
}

void testConvolutionRejectsLongImpulseAndClipsSafely()
{
    echo::ConvolutionProcessor processor;
    processor.prepare(48000.0, 16, 1);
    require(! processor.loadImpulseResponseForTests({ std::vector<float>(static_cast<size_t>(echo::roomCorrectionMaxTaps + 1), 1.0f) }, 48000.0, "long", "Long"), "long IR rejected");
    require(processor.loadImpulseResponseForTests({ { 8.0f } }, 48000.0, "hot", "Hot"), "hot IR loads");
    processor.setEnabled(true);

    echo::FloatAudioBuffer buffer(1, 4);
    buffer.clear();
    buffer.setSample(0, 0, 0.5f);
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    requireFinite(buffer, "hot convolution finite");
    require(processor.hasClippingRisk(), "hot convolution reports clipping risk");
    require(std::abs(buffer.getSample(0, 0)) > 1.0f, "hot convolution reports risk without limiting inside FIR");
}

void testChannelBalanceDelayCompensation()
{
    echo::ChannelBalanceProcessor processor;
    processor.prepare(1000.0, 16, 2);

    echo::ChannelBalanceState state;
    state.enabled = true;
    state.leftDelayMs = 2.0f;
    state.rightDelayMs = 0.0f;
    processor.setState(state);
    processor.reset();

    echo::FloatAudioBuffer buffer(2, 6);
    buffer.clear();
    buffer.setSample(0, 0, 0.5f);
    buffer.setSample(1, 0, 0.25f);
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(std::abs(buffer.getSample(0, 0)) <= nearTolerance, "left delay sample 0");
    require(std::abs(buffer.getSample(0, 1)) <= nearTolerance, "left delay sample 1");
    require(std::abs(buffer.getSample(0, 2) - 0.5f) <= nearTolerance, "left delay sample 2");
    require(std::abs(buffer.getSample(1, 0) - 0.25f) <= nearTolerance, "right dry timing");
    requireFinite(buffer, "channel delay finite");
}

void testChannelBalanceSoloKeepsPhysicalSide()
{
    echo::ChannelBalanceProcessor processor;
    processor.prepare(48000.0, 16, 2);

    echo::ChannelBalanceState state;
    state.enabled = true;
    state.monoMode = echo::ChannelBalanceMonoMode::LeftOnly;
    processor.setState(state);

    echo::FloatAudioBuffer liveLeftOnlyBuffer(2, 4);
    liveLeftOnlyBuffer.clear();
    liveLeftOnlyBuffer.setSample(0, 0, 0.625f);
    liveLeftOnlyBuffer.setSample(1, 0, 0.375f);
    processor.processBlock(liveLeftOnlyBuffer, 0, liveLeftOnlyBuffer.getNumSamples());

    require(std::abs(liveLeftOnlyBuffer.getSample(0, 0) - 0.625f) <= nearTolerance, "live left solo keeps physical left immediately");
    require(std::abs(liveLeftOnlyBuffer.getSample(1, 0)) <= nearTolerance, "live left solo mutes physical right immediately");

    state.monoMode = echo::ChannelBalanceMonoMode::RightOnly;
    processor.setState(state);
    processor.reset();

    echo::FloatAudioBuffer rightOnlyBuffer(2, 4);
    rightOnlyBuffer.clear();
    rightOnlyBuffer.setSample(0, 0, 0.25f);
    rightOnlyBuffer.setSample(1, 0, 0.75f);
    processor.processBlock(rightOnlyBuffer, 0, rightOnlyBuffer.getNumSamples());

    require(std::abs(rightOnlyBuffer.getSample(0, 0)) <= nearTolerance, "right solo mutes physical left");
    require(std::abs(rightOnlyBuffer.getSample(1, 0) - 0.75f) <= nearTolerance, "right solo keeps physical right");

    state.monoMode = echo::ChannelBalanceMonoMode::LeftOnly;
    processor.setState(state);
    processor.reset();

    echo::FloatAudioBuffer leftOnlyBuffer(2, 4);
    leftOnlyBuffer.clear();
    leftOnlyBuffer.setSample(0, 0, 0.5f);
    leftOnlyBuffer.setSample(1, 0, 0.125f);
    processor.processBlock(leftOnlyBuffer, 0, leftOnlyBuffer.getNumSamples());

    require(std::abs(leftOnlyBuffer.getSample(0, 0) - 0.5f) <= nearTolerance, "left solo keeps physical left");
    require(std::abs(leftOnlyBuffer.getSample(1, 0)) <= nearTolerance, "left solo mutes physical right");
    requireFinite(rightOnlyBuffer, "right solo finite");
    requireFinite(leftOnlyBuffer, "left solo finite");
}

void testChannelBalanceBandGainCompensation()
{
    echo::ChannelBalanceProcessor processor;
    processor.prepare(48000.0, 4096, 2);

    echo::ChannelBalanceState state;
    state.enabled = true;
    state.leftBandGainsDb[0] = -6.0f;
    state.rightBandGainsDb[0] = 0.0f;
    processor.setState(state);
    processor.reset();

    echo::FloatAudioBuffer buffer(2, 4096);
    for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
    {
        buffer.setSample(0, sample, 0.5f);
        buffer.setSample(1, sample, 0.5f);
    }

    processor.processBlock(buffer, 0, buffer.getNumSamples());

    const auto leftTail = std::abs(buffer.getSample(0, buffer.getNumSamples() - 1));
    const auto rightTail = std::abs(buffer.getSample(1, buffer.getNumSamples() - 1));
    require(leftTail < rightTail * 0.7f, "left low band attenuation applies to audio");
    requireFinite(buffer, "channel band compensation finite");
}

void testDspChainBypassPreservesDryBuffer()
{
    DspChainFixture fixture;
    auto& dspChain = fixture.dspChain;
    bool meterObserved = false;
    fixture.levelMeterProcessor.setIntervalMs(1);
    fixture.levelMeterProcessor.setCallback([&meterObserved](const echo::LevelMeterSnapshot& snapshot)
    {
        meterObserved = ! snapshot.peakDb.empty() && snapshot.peakDb.front() > -60.0f;
    });
    dspChain.prepare(48000.0, 128, 2);

    auto buffer = makeFloatBuffer(2, 128);
    auto dry = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        auto* drySamples = dry.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
        {
            const float value = channel == 0
                ? static_cast<float>(sample) / 127.0f
                : -static_cast<float>(sample) / 127.0f;
            samples[sample] = value;
            drySamples[sample] = value;
        }
    }

    require(! dspChain.isActive(), "inactive DSP chain must report bypass");
    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    requireBuffersClose(buffer, dry, strictTolerance, "inactive DSP chain must not touch native playback samples");
    require(meterObserved, "inactive DSP chain must still report native output levels");
    require(! dspChain.hasClippingRisk(), "inactive DSP chain must not report clipping risk");
    require(! dspChain.isSafetyLimiterProtecting(), "inactive DSP chain must not report limiter protection");
}

void testCompressorReducesHotSignalsAndPreservesBypass()
{
    echo::CompressorProcessor processor;
    processor.prepare(48'000.0, 512, 2);

    echo::FloatAudioBuffer bypassed(2, 512);
    for (int channel = 0; channel < 2; ++channel)
        std::fill_n(bypassed.getWritePointer(channel), 512, 0.8f);
    processor.processBlock(bypassed, 0, 512);
    require(std::abs(bypassed.getSample(0, 511) - 0.8f) <= 1.0e-7f,
        "disabled compressor must preserve the dry signal exactly");

    echo::CompressorState state;
    state.enabled = true;
    state.thresholdDb = -18.0f;
    state.ratio = 8.0f;
    state.attackMs = 0.1f;
    state.releaseMs = 100.0f;
    state.kneeDb = 0.0f;
    processor.setState(state);

    echo::FloatAudioBuffer compressed(2, 512);
    for (int channel = 0; channel < 2; ++channel)
        std::fill_n(compressed.getWritePointer(channel), 512, 0.8f);
    processor.processBlock(compressed, 0, 512);
    require(std::isfinite(compressed.getSample(0, 511)), "compressor output must remain finite");
    require(compressed.getSample(0, 511) < 0.35f,
        "enabled compressor must reduce a sustained signal above threshold");
    require(processor.gainReductionDb() > 8.0f,
        "compressor must expose positive gain-reduction telemetry");
}

void testSpatialDspStagesProcessIndependently()
{
    echo::SpatialDspProcessor processor;
    processor.prepare(48'000.0, 2048, 2);

    echo::CrossfeedState crossfeed;
    crossfeed.enabled = true;
    crossfeed.amount = 0.5f;
    crossfeed.cutoffHz = 1'500.0f;
    processor.setCrossfeedState(crossfeed);
    echo::FloatAudioBuffer crossfeedBuffer(2, 2048);
    std::fill_n(crossfeedBuffer.getWritePointer(0), 2048, 1.0f);
    std::fill_n(crossfeedBuffer.getWritePointer(1), 2048, -1.0f);
    processor.processCrossfeedBlock(crossfeedBuffer, 0, 2048);
    require(crossfeedBuffer.getSample(0, 2047) < 0.55f && crossfeedBuffer.getSample(0, 2047) > 0.45f,
        "crossfeed must narrow sustained low-frequency side content");
    require(std::abs(crossfeedBuffer.getSample(0, 2047) + crossfeedBuffer.getSample(1, 2047)) < 1.0e-5f,
        "crossfeed must preserve the stereo center");

    echo::StereoFieldState stereoField;
    stereoField.enabled = true;
    stereoField.width = 0.0f;
    processor.setStereoFieldState(stereoField);
    echo::FloatAudioBuffer stereoBuffer(2, 1);
    stereoBuffer.setSample(0, 0, 1.0f);
    stereoBuffer.setSample(1, 0, -1.0f);
    processor.processStereoFieldBlock(stereoBuffer, 0, 1);
    require(std::abs(stereoBuffer.getSample(0, 0)) < 1.0e-6f
            && std::abs(stereoBuffer.getSample(1, 0)) < 1.0e-6f,
        "zero stereo width must remove pure side content");

    echo::ChannelMatrixState matrix;
    matrix.enabled = true;
    matrix.leftToLeft = 0.0f;
    matrix.rightToLeft = 1.0f;
    matrix.leftToRight = 1.0f;
    matrix.rightToRight = 0.0f;
    processor.setChannelMatrixState(matrix);
    echo::FloatAudioBuffer matrixBuffer(2, 1);
    matrixBuffer.setSample(0, 0, 0.25f);
    matrixBuffer.setSample(1, 0, -0.5f);
    processor.processChannelMatrixBlock(matrixBuffer, 0, 1);
    require(std::abs(matrixBuffer.getSample(0, 0) + 0.5f) < 1.0e-6f
            && std::abs(matrixBuffer.getSample(1, 0) - 0.25f) < 1.0e-6f,
        "channel matrix must apply the configured two-by-two routing coefficients");
}

void testDspChainLimiterProtectsActiveOutput()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    DspChainFixture fixture;
    auto& eqProcessor = fixture.eqProcessor;
    auto& dspChain = fixture.dspChain;
    dspChain.prepare(48000.0, 128, 2);
    eqProcessor.setEnabled(true);

    auto buffer = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            samples[sample] = sample % 2 == 0 ? 2.0f : -2.0f;
    }

    require(dspChain.isActive(), "enabled EQ must activate DSP chain");
    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    require(dspChain.hasClippingRisk(), "active DSP chain must report clipping risk after limiting hot output");
    require(dspChain.isSafetyLimiterProtecting(), "active DSP chain must expose safety limiter protection");

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* samples = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            require(std::abs(samples[sample]) <= 1.0f + nearTolerance, "DSP safety limiter must cap active-chain output");
    }
}

void testDspChainLimiterIgnoresNearFullScaleOutput()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    DspChainFixture fixture;
    auto& eqProcessor = fixture.eqProcessor;
    auto& dspChain = fixture.dspChain;
    dspChain.prepare(48000.0, 128, 2);
    eqProcessor.setEnabled(true);

    auto buffer = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            samples[sample] = sample % 2 == 0 ? 0.99f : -0.99f;
    }

    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    require(! dspChain.isSafetyLimiterProtecting(), "DSP safety limiter must not engage below full scale");
    require(std::abs(buffer.getSample(0, 0) - 0.99f) <= nearTolerance, "near full-scale output must pass unchanged");
}

void testDspChainLimiterCanBeBypassed()
{
    echo::DspChain::setSafetyLimiterEnabled(false);
    DspChainFixture fixture;
    auto& eqProcessor = fixture.eqProcessor;
    auto& dspChain = fixture.dspChain;
    dspChain.prepare(48000.0, 128, 2);
    eqProcessor.setEnabled(true);

    auto buffer = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            samples[sample] = 2.0f;
    }

    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    require(buffer.getSample(0, 0) > 1.0f, "disabled DSP safety limiter must not cap active-chain output");
    require(! dspChain.isSafetyLimiterProtecting(), "disabled DSP safety limiter must not report protection");

    echo::DspChain::setSafetyLimiterEnabled(true);
}

void testDspHeadroomActivatesProtectionChain()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    DspChainFixture fixture;
    auto& headroomProcessor = fixture.headroomProcessor;
    auto& dspChain = fixture.dspChain;
    dspChain.prepare(48000.0, 128, 2);
    headroomProcessor.setHeadroomDb(-6.0f);

    auto processed = makeFloatBuffer(2, 128);
    processed.clear();
    processed.setSample(0, 0, 0.5f);
    processed.setSample(1, 0, -0.5f);
    require(dspChain.isActive(), "configured headroom must activate the protection chain");
    dspChain.processBlock(processed, 0, processed.getNumSamples());

    require(std::abs(processed.getSample(0, 0)) < 0.5f, "DSP headroom must attenuate output without another DSP enabled");
    require(std::abs(processed.getSample(1, 0)) < 0.5f, "DSP headroom must attenuate every channel without another DSP enabled");
}

void testDspChainProtectsUpstreamPcmProcessing()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    DspChainFixture fixture;
    auto& dspChain = fixture.dspChain;
    dspChain.prepare(192000.0, 128, 2);
    dspChain.setUpstreamPcmProcessingActive(true);

    auto buffer = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            samples[sample] = sample % 2 == 0 ? 1.25f : -1.25f;
    }

    require(dspChain.isActive(), "upstream PCM processing must activate the protection chain");
    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    require(dspChain.isSafetyLimiterProtecting(), "upstream PCM overshoot must engage the safety limiter");
    require(std::abs(dspChain.safetyLimiterCeilingDb() + 1.0f) <= nearTolerance,
        "upstream PCM limiter must use the -1 dB true-peak ceiling");
    require(dspChain.safetyLimiterGainReductionDb() > 2.0f,
        "upstream PCM limiter must report authoritative linked gain reduction");
    const float truePeakCeiling = std::pow(10.0f, -1.0f / 20.0f);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* samples = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            require(std::abs(samples[sample]) <= truePeakCeiling + nearTolerance,
                "upstream PCM protection must prevent output clipping");
    }

    auto quiet = makeFloatBuffer(2, 128);
    for (int channel = 0; channel < quiet.getNumChannels(); ++channel)
        std::fill_n(quiet.getWritePointer(channel), quiet.getNumSamples(), 0.25f);
    dspChain.processBlock(quiet, 0, quiet.getNumSamples());
    require(quiet.getSample(0, 0) < quiet.getSample(0, quiet.getNumSamples() - 1),
        "true-peak limiter must release smoothly instead of stepping back to unity");
    require(std::abs(quiet.getSample(0, 0) - quiet.getSample(1, 0)) <= strictTolerance,
        "true-peak limiter gain envelope must remain stereo linked");
}

void testDisabledEqIsDry()
{
    echo::EqProcessor processor;
    processor.prepare(48000.0, 512, 2);
    processor.setBandGainDb(2, 12.0f);
    processor.setPreampDb(6.0f);

    auto buffer = makeFloatBuffer(2, 512);
    auto dry = buffer;
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    requireBuffersClose(buffer, dry, strictTolerance, "disabled EQ must be dry");
}

void testFlatEnabledIsTransparent()
{
    echo::EqProcessor processor;
    processor.prepare(44100.0, 1024, 2);
    processor.setEnabled(true);

    auto buffer = makeFloatBuffer(2, 1024);
    auto dry = buffer;
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(processor.isEnabled(), "flat enabled EQ must report enabled");
    requireBuffersClose(buffer, dry, nearTolerance, "flat enabled EQ must be transparent");
}

void testBypassReturnsToDry()
{
    echo::EqProcessor processor;
    processor.prepare(48000.0, 4096, 2);
    processor.setEnabled(true);
    processor.setBandGainDb(0, 12.0f);
    processor.setBandGainDb(1, 10.0f);
    processor.setPreampDb(-3.0f);

    auto warmup = makeFloatBuffer(2, 4096);
    processor.processBlock(warmup, 0, warmup.getNumSamples());

    processor.setEnabled(false);
    auto fadeOut = makeFloatBuffer(2, 4096);
    processor.processBlock(fadeOut, 0, fadeOut.getNumSamples());

    auto buffer = makeFloatBuffer(2, 1024);
    auto dry = buffer;
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(! processor.isEnabled(), "bypassed EQ must report disabled");
    requireBuffersClose(buffer, dry, strictTolerance, "bypassed EQ must return to dry after fade");
}

void testRapidChangesStayFinite()
{
    for (double sampleRate : { 44100.0, 48000.0, 96000.0 })
    {
        echo::EqProcessor processor;
        processor.prepare(sampleRate, 512, 2);
        processor.setEnabled(true);

        for (int iteration = 0; iteration < 24; ++iteration)
        {
            processor.setPreampDb(iteration % 2 == 0 ? 6.0f : -12.0f);
            processor.setBandGainDb(iteration % echo::eqBandCount, iteration % 2 == 0 ? 12.0f : -12.0f);
            processor.setBandFrequencyHz((iteration + 3) % echo::eqBandCount, iteration % 2 == 0 ? 1.0f : 50000.0f);
            processor.setBandQ((iteration + 5) % echo::eqBandCount, iteration % 2 == 0 ? 0.001f : 50.0f);
            processor.setBandFilterType((iteration + 7) % echo::eqBandCount, iteration % 3 == 0 ? echo::EqFilterType::LowShelf : echo::EqFilterType::HighShelf);
            processor.setBandEnabled((iteration + 9) % echo::eqBandCount, iteration % 4 != 0);

            auto buffer = makeFloatBuffer(2, 512);
            processor.processBlock(buffer, 0, buffer.getNumSamples());
            requireFinite(buffer, "rapid EQ changes must stay finite");
        }
    }
}

void testEqReportsRiskWithoutLimitingEnabledOutput()
{
    echo::EqProcessor processor;
    processor.prepare(48000.0, 4096, 2);
    processor.setEnabled(true);
    processor.setPreampDb(12.0f);

    echo::FloatAudioBuffer buffer(2, 4096);
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            samples[sample] = sample % 2 == 0 ? 0.9f : -0.9f;
    }

    processor.processBlock(buffer, 0, buffer.getNumSamples());

    require(processor.hasClippingRisk(), "enabled EQ must keep clipping risk visible");
    requireFinite(buffer, "enabled EQ risk path must keep output finite");
    bool hotOutput = false;
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* samples = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            hotOutput = hotOutput || std::abs(samples[sample]) > 1.0f;
    }
    require(hotOutput, "enabled EQ must not cap hot output before final DSP limiter");
}

void testCoefficientUpdatesStopInSteadyState()
{
    echo::EqProcessor processor;
    processor.prepare(96000.0, 512, 2);

    const auto initialUpdates = processor.getCoefficientUpdateCountForTests();
    auto stable = makeFloatBuffer(2, 512);
    processor.processBlock(stable, 0, stable.getNumSamples());
    require(processor.getCoefficientUpdateCountForTests() == initialUpdates, "steady disabled EQ must not recalculate coefficients");

    processor.setEnabled(true);
    auto enabledStable = makeFloatBuffer(2, 512);
    processor.processBlock(enabledStable, 0, enabledStable.getNumSamples());
    require(processor.getCoefficientUpdateCountForTests() == initialUpdates, "steady flat EQ must not recalculate coefficients");

    processor.setBandGainDb(4, 6.0f);
    auto transition = makeFloatBuffer(2, 4096);
    processor.processBlock(transition, 0, transition.getNumSamples());
    const auto afterTransitionUpdates = processor.getCoefficientUpdateCountForTests();
    require(afterTransitionUpdates > initialUpdates, "changed band must recalculate coefficients while smoothing");

    auto postTransition = makeFloatBuffer(2, 4096);
    processor.processBlock(postTransition, 0, postTransition.getNumSamples());
    require(processor.getCoefficientUpdateCountForTests() == afterTransitionUpdates, "steady changed band must stop recalculating coefficients");
}

void testPeqBandControlsClampAndBypass()
{
    echo::EqProcessor processor;
    processor.prepare(48000.0, 4096, 2);
    processor.setEnabled(true);
    processor.setBandGainDb(0, 12.0f);
    processor.setBandFrequencyHz(0, 80.0f);
    processor.setBandQ(0, 50.0f);
    processor.setBandFilterType(0, echo::EqFilterType::LowShelf);

    auto state = processor.getState();
    require(state.bandQ[0] == echo::eqMaxQ, "band Q must clamp high values");
    require(state.bandFilterTypes[0] == echo::EqFilterType::LowShelf, "band filter type must store low shelf");

    auto shaped = makeFloatBuffer(2, 4096);
    processor.processBlock(shaped, 0, shaped.getNumSamples());
    requireFinite(shaped, "low shelf PEQ output must stay finite");

    processor.setBandEnabled(0, false);
    auto warmup = makeFloatBuffer(2, 4096);
    processor.processBlock(warmup, 0, warmup.getNumSamples());
    auto bypassed = makeFloatBuffer(2, 4096);
    auto dry = bypassed;
    processor.processBlock(bypassed, 0, bypassed.getNumSamples());
    requireBuffersClose(bypassed, dry, nearTolerance, "disabled PEQ band must become transparent");
}

void testPeqAdditionalFilterTypesStayFinite()
{
    const std::vector<echo::EqFilterType> filterTypes {
        echo::EqFilterType::LowPass,
        echo::EqFilterType::HighPass,
        echo::EqFilterType::Notch,
    };

    for (const auto filterType : filterTypes)
    {
        echo::EqProcessor processor;
        processor.prepare(48000.0, 4096, 2);
        processor.setEnabled(true);
        processor.setBandFrequencyHz(4, filterType == echo::EqFilterType::HighPass ? 90.0f : 7200.0f);
        processor.setBandQ(4, filterType == echo::EqFilterType::Notch ? 6.5f : 0.707f);
        processor.setBandFilterType(4, filterType);
        processor.setBandGainDb(4, 12.0f);

        auto buffer = makeFloatBuffer(2, 4096);
        processor.processBlock(buffer, 0, buffer.getNumSamples());
        requireFinite(buffer, "additional PEQ filter output must stay finite");

        const auto state = processor.getState();
        require(state.bandFilterTypes[4] == filterType, "additional PEQ filter type must round-trip in processor state");
    }
}

void testHostBufferFallbackAttempts()
{
    const auto shared = parseOptions({ "echo-audio-host" });
    requireVectorEquals(buildBufferSizeAttempts(shared), { 256, 512, 1024, 2048, 4096, 8192 }, "shared buffer fallback chain");

    const auto asio = parseOptions({ "echo-audio-host", "-asio" });
    require(asio.asio, "ASIO backend flag must parse instead of silently selecting shared output");
    requireVectorEquals(buildBufferSizeAttempts(asio), { 256, 512, 1024, 2048, 4096, 8192 }, "ASIO buffer fallback chain");

    const auto balanced = parseOptions({ "echo-audio-host", "-exclusive", "-buffer", "2048" });
    require(balanced.exclusive, "exclusive backend flag must parse");
    requireVectorEquals(buildBufferSizeAttempts(balanced), { 2048, 4096, 8192 }, "exclusive requested buffer fallback chain");
}

void testUnsupportedExclusiveFormatSkipsBufferRetries()
{
    class UnsupportedFormatBackend final : public NativePcmOutputBackend
    {
    public:
        bool open(NativePlaybackPipeline&, const Options&, int, int, int, std::string& error) override
        {
            ++openAttempts;
            error = "WASAPI exclusive format unsupported (hr=0x88890008)";
            return false;
        }
        void close() noexcept override {}
        const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

        int openAttempts = 0;
        NativePcmOutputReadyInfo info;
    } backend;

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 4096, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    DopRingSource dopSource(2, 4096, 0, 0);
    NativeDsdRingSource nativeDsdSource(2, 8192, 0, 0);
    NativePlaybackPipeline pipeline(source, dopSource, nativeDsdSource, 2);
    const auto options = parseOptions({ "echo-audio-host", "-exclusive", "-buffer", "2048" });
    int openedBufferFrames = 0;
    std::string error;

    require(! openNativePcmOutputWithFallback(backend, pipeline, options, 44100, 2, 2048, openedBufferFrames, error),
        "unsupported exclusive format must fail");
    require(backend.openAttempts == 1, "unsupported exclusive format must not retry unrelated buffer sizes");
    requireContains(error, "0x88890008", "unsupported exclusive format error must be preserved");
}

void testHostSharedBackendOptions()
{
    const auto defaultOptions = parseOptions({ "echo-audio-host" });
    require(defaultOptions.sharedBackend == "auto", "shared backend default must be auto");

    const auto directSound = parseOptions({ "echo-audio-host", "-shared-backend", "directsound" });
    require(directSound.sharedBackend == "directsound", "directsound shared backend must parse");
    require(! isDisabledSharedBackend(directSound), "directsound backend must be enabled as compatibility output");

    const auto windows = parseOptions({ "echo-audio-host", "-shared-backend", "windows" });
    require(windows.sharedBackend == "windows", "windows shared backend must parse");

    const auto alsa = parseOptions({ "echo-audio-host", "-shared-backend", "alsa" });
    require(alsa.sharedBackend == "alsa", "ALSA shared backend must parse");

    const auto invalid = parseOptions({ "echo-audio-host", "-shared-backend", "invalid" });
    require(invalid.sharedBackend == "auto", "invalid shared backend must fall back to auto");

    require(shouldIncludeSharedBackendType("DirectSound", directSound.sharedBackend), "directsound backend must include DirectSound");
    require(! shouldIncludeSharedBackendType("Windows Audio", directSound.sharedBackend), "directsound backend must skip Windows Audio");
#ifdef _WIN32
    require(shouldIncludeSharedBackendType("Windows Audio", windows.sharedBackend), "windows backend must include Windows Audio");
#else
    require(! shouldIncludeSharedBackendType("Windows Audio", windows.sharedBackend), "windows backend must not select Windows Audio on non-Windows hosts");
#endif
    require(! shouldIncludeSharedBackendType("DirectSound", windows.sharedBackend), "windows backend must skip DirectSound");
    require(shouldIncludeSharedBackendType("ALSA", alsa.sharedBackend), "ALSA backend must include ALSA");
    require(! shouldIncludeSharedBackendType("Windows Audio", alsa.sharedBackend), "ALSA backend must skip Windows Audio");
    require(! shouldIncludeSharedBackendType("DirectSound", defaultOptions.sharedBackend), "auto backend must skip DirectSound");
    require(shouldIncludeSharedBackendType("Windows Audio", defaultOptions.sharedBackend), "auto backend must include Windows Audio");
}

void testNativeDitherMatchesTypescriptGoldenVector()
{
    echo::PcmDitherProcessor processor;
    processor.configure(echo::PcmDitherMode::NoiseShaped5, 24, 2);
    std::vector<float> samples { 0.1234567f, -0.1234567f, 0.01f, -0.01f, 0.5f, -0.5f, 0.0f, 0.0f };
    processor.process(samples);
    const std::vector<float> expected {
        0.1234566122f, -0.1234567314f, 0.01000011060f, -0.009999872185f,
        0.5000000596f, -0.5000000596f, 0.0f, 1.192093038e-7f,
    };
    require(samples.size() == expected.size(), "native dither golden vector size");
    for (size_t index = 0; index < samples.size(); ++index)
        require(std::abs(samples[index] - expected[index]) < 1.0e-8f, "native dither must match TypeScript golden vector");
}

void testNativeEchoSrcMatchesReferenceConvolution()
{
    echo::EchoSrcProcessor processor;
    std::string error;
    require(processor.configure(1, { echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } } }, error),
        "native ECHO SRC configuration must succeed");
    const std::vector<float> input { 1.0f, 0.0f };
    const auto output = processor.process(input.data(), 2);
    const std::vector<float> expected { 0.5f, 1.0f, 0.5f, 0.0f };
    require(output.size() == expected.size(), "native ECHO SRC output length");
    for (size_t index = 0; index < output.size(); ++index)
        require(std::abs(output[index] - expected[index]) < 1.0e-7f, "native ECHO SRC convolution output");
}

void testNativeEchoSrcPolyphaseMatchesDenseFactorFourConvolution()
{
    echo::EchoSrcProcessor processor;
    std::string error;
    require(processor.configure(
        2,
        { echo::EchoSrcStageConfig {
            4,
            { 0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f, 0.7f },
        } },
        error),
        "factor-four native ECHO SRC configuration must succeed");

    const std::vector<float> input {
        1.0f, -1.0f,
        0.5f, 0.25f,
        0.0f, 0.0f,
    };
    const auto output = processor.process(input.data(), 3);
    const std::vector<float> expected {
        0.4f, -0.4f,
        0.8f, -0.8f,
        1.2f, -1.2f,
        1.6f, -1.6f,
        2.2f, -1.9f,
        2.8f, -2.2f,
        3.4f, -2.5f,
        0.8f, 0.4f,
        1.0f, 0.5f,
        1.2f, 0.6f,
        1.4f, 0.7f,
        0.0f, 0.0f,
    };
    require(output.size() == expected.size(), "factor-four polyphase output length");
    require(processor.estimatedMacsPerInputFrame() == 14,
        "factor-four sparse polyphase estimator must count each non-zero tap once per channel");
    for (size_t index = 0; index < output.size(); ++index)
        require(std::abs(output[index] - expected[index]) < 1.0e-6f,
            "factor-four sparse polyphase output must equal dense zero-stuffed convolution");
}

void testNativeEchoSrcIsStableAcrossDecodeChunks()
{
    const std::vector<echo::EchoSrcStageConfig> stages {
        echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } },
        echo::EchoSrcStageConfig { 2, { 0.125f, 0.75f, 0.125f } },
    };
    const std::vector<float> input { 1.0f, -0.5f, 0.25f, 0.0f, -0.25f };
    std::string error;
    echo::EchoSrcProcessor contiguous;
    echo::EchoSrcProcessor chunked;
    require(contiguous.configure(1, stages, error), "contiguous native ECHO SRC configuration");
    require(chunked.configure(1, stages, error), "chunked native ECHO SRC configuration");

    const auto expected = contiguous.process(input.data(), static_cast<int>(input.size()));
    const auto first = chunked.process(input.data(), 2);
    const auto second = chunked.process(input.data() + 2, static_cast<int>(input.size() - 2));
    std::vector<float> actual = first;
    actual.insert(actual.end(), second.begin(), second.end());

    require(actual.size() == expected.size(), "chunked native ECHO SRC output length");
    for (size_t index = 0; index < actual.size(); ++index)
        require(std::abs(actual[index] - expected[index]) < 1.0e-7f,
            "native ECHO SRC must preserve FIR history across decoder chunks");
}

void testNativeEchoSrcFlushesTailExactlyOnce()
{
    NativeFirProcessor processor;
    std::string error;
    require(processor.configure(
        1,
        { echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } } },
        false,
        64,
        error),
        "native ECHO SRC tail test configuration must succeed");

    const float impulse = 1.0f;
    const auto body = processor.process(&impulse, 1);
    const auto tail = processor.flush();
    require(body.size() == 2, "native ECHO SRC body must keep the configured output factor");
    require(tail.size() == 1, "native ECHO SRC flush must emit the remaining convolution support");
    require(std::abs(body[0] - 0.5f) < 1.0e-7f
        && std::abs(body[1] - 1.0f) < 1.0e-7f
        && std::abs(tail[0] - 0.5f) < 1.0e-7f,
        "native ECHO SRC flush must preserve the complete impulse response");
    require(processor.flush().empty(), "native ECHO SRC flush must be idempotent at EOF");
}

void testNativePlaybackPipelineDrainsEchoSrcTailBeforeEof()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource pcm(1, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    DopRingSource dop(1, 64, 0, 0);
    NativeDsdRingSource nativeDsd(1, 64, 0, 0);
    NativePlaybackPipeline pipeline(pcm, dop, nativeDsd, 1);

    NativePlaybackPipeline::ProcessingConfig config;
    config.outputFormat = NativePlaybackPipeline::OutputFormat::Pcm;
    config.echoSrc.sourceSampleRate = 48'000;
    config.echoSrc.targetSampleRate = 96'000;
    config.echoSrc.stages = {
        echo::EchoSrcStageConfig { 2, { 0.25f, 0.5f, 0.25f } },
    };
    std::string error;
    require(pipeline.configure(config, error), "native pipeline ECHO SRC configuration must succeed");
    require(pipeline.seekPrerollFrames() == 1,
        "native pipeline must expose the exact source-rate FIR history needed by seek");
    const auto initialStatus = pipeline.processingStatus();
    require(initialStatus.echoSrc.nominalLatencyFrames == 1,
        "native pipeline must report the FIR nominal phase latency in output frames");
    require(initialStatus.limiter.active
            && std::abs(initialStatus.limiter.ceilingDb + 1.0f) <= nearTolerance,
        "native pipeline must report active -1 dB true-peak protection for ECHO SRC");
    pipeline.beginSession();

    const float impulse = 1.0f;
    require(pipeline.push(&impulse, 1), "native pipeline must accept ECHO SRC input");
    pipeline.markInputEnded();
    pipeline.markInputEnded();

    require(pcm.isDspActive(), "active ECHO SRC must activate PCM output protection");
    require(pipeline.hasInputEnded(), "native pipeline must publish EOF after committing the FIR tail");
    require(pipeline.getReadyFrames() == 3, "native pipeline must queue body plus one exact FIR tail frame");
    require(!pipeline.isDrained(), "native pipeline must not report drained while the FIR tail is buffered");

    auto output = makeBuffer(1, 3);
    require(pcm.renderPlanar(output, 0, 3) == 3, "native pipeline must render the complete FIR body and tail");
    require(pipeline.isDrained(), "native pipeline must report drained only after the FIR tail is consumed");

    const std::vector<float> seekPrime { 0.25f, 1.0f, 0.0f };
    require(pipeline.replaceBufferedAudioWithPreroll(
        seekPrime.data(),
        static_cast<int>(seekPrime.size()),
        1,
        false) == 2,
        "native seek replacement must prime FIR history without counting preroll as audible input");
    require(pipeline.getReadyFrames() == 4,
        "native seek replacement must discard preroll output while retaining target PCM geometry");
}

int countBits(uint8_t value)
{
    int count = 0;
    for (int bit = 0; bit < 8; ++bit)
        count += (value & static_cast<uint8_t>(1u << bit)) != 0 ? 1 : 0;
    return count;
}

uint8_t reverseBitsForTest(uint8_t value)
{
    value = static_cast<uint8_t>(((value & 0xf0u) >> 4u) | ((value & 0x0fu) << 4u));
    value = static_cast<uint8_t>(((value & 0xccu) >> 2u) | ((value & 0x33u) << 2u));
    return static_cast<uint8_t>(((value & 0xaau) >> 1u) | ((value & 0x55u) << 1u));
}

double nativeDsdOneDensity(
    const std::vector<uint8_t>& output,
    int startTransportFrame,
    int transportFrames,
    int channels = 1,
    int channel = 0)
{
    int ones = 0;
    int bits = 0;
    const int endFrame = std::min(
        startTransportFrame + transportFrames,
        static_cast<int>(output.size() / static_cast<size_t>(std::max(1, channels) * 2)));
    for (int frame = std::max(0, startTransportFrame); frame < endFrame; ++frame)
    {
        const size_t base = static_cast<size_t>(frame * channels * 2);
        ones += countBits(output[base + static_cast<size_t>(channel)]);
        ones += countBits(output[base + static_cast<size_t>(channels + channel)]);
        bits += 16;
    }
    return bits > 0 ? static_cast<double>(ones) / static_cast<double>(bits) : 0.0;
}

double sdmProfileHeadroomGain(echo::SdmQualityProfile profile)
{
    switch (profile)
    {
        case echo::SdmQualityProfile::Hifi: return std::pow(10.0, -12.0 / 20.0);
        case echo::SdmQualityProfile::Reference: return std::pow(10.0, -14.0 / 20.0);
        case echo::SdmQualityProfile::Insane: return std::pow(10.0, -16.0 / 20.0);
        case echo::SdmQualityProfile::Safe:
        default: return std::pow(10.0, -10.0 / 20.0);
    }
}

double measureSdmInBandResidualDb(echo::SdmQualityProfile profile, int transportSampleRate)
{
    const int bitSampleRate = transportSampleRate * 16;
    const int inputFrames = transportSampleRate / 8;
    constexpr int decimation = 64;
    constexpr int tapCount = 511;
    constexpr double pi = 3.14159265358979323846;
    constexpr double signalFrequency = 1'000.0;
    constexpr double signalAmplitude = 0.1;
    constexpr double cutoffHz = 20'000.0;

    std::vector<float> input(static_cast<size_t>(inputFrames));
    for (int frame = 0; frame < inputFrames; ++frame)
        input[static_cast<size_t>(frame)] = static_cast<float>(
            std::sin(2.0 * pi * signalFrequency * static_cast<double>(frame) / transportSampleRate)
            * signalAmplitude);

    echo::SdmProcessor processor;
    processor.configure(1, profile, transportSampleRate);
    const auto output = processor.processNativeDsd(input.data(), inputFrames);

    std::vector<double> residual(static_cast<size_t>(inputFrames * 16), 0.0);
    const double headroomGain = sdmProfileHeadroomGain(profile);
    const int transitionFrames = transportSampleRate / 100;
    double previousSample = 0.0;
    size_t bitIndex = 0;
    for (int frame = 0; frame < inputFrames; ++frame)
    {
        const double sample = static_cast<double>(input[static_cast<size_t>(frame)]);
        const double transitionGain = std::min(
            1.0,
            static_cast<double>(frame + 1) / static_cast<double>(transitionFrames));
        for (int bit = 0; bit < 16; ++bit)
        {
            const double ideal =
                (previousSample + (sample - previousSample) * (static_cast<double>(bit + 1) / 16.0))
                * headroomGain
                * transitionGain;
            const uint8_t byte = output[static_cast<size_t>(frame * 2 + bit / 8)];
            const double actual = (byte & static_cast<uint8_t>(1u << (bit % 8))) != 0 ? 1.0 : -1.0;
            residual[bitIndex++] = actual - ideal;
        }
        previousSample = sample;
    }

    std::vector<double> taps(static_cast<size_t>(tapCount), 0.0);
    const int center = (tapCount - 1) / 2;
    const double normalizedCutoff = cutoffHz / bitSampleRate;
    double tapSum = 0.0;
    for (int tap = 0; tap < tapCount; ++tap)
    {
        const int offset = tap - center;
        const double sinc = offset == 0
            ? 2.0 * normalizedCutoff
            : std::sin(2.0 * pi * normalizedCutoff * offset) / (pi * offset);
        const double window = 0.5 - 0.5 * std::cos(2.0 * pi * tap / (tapCount - 1));
        taps[static_cast<size_t>(tap)] = sinc * window;
        tapSum += taps[static_cast<size_t>(tap)];
    }
    for (auto& tap : taps)
        tap /= tapSum;

    const int firstBit = bitSampleRate / 50;
    const int lastBit = bitSampleRate / 10;
    double sumSquares = 0.0;
    int sampleCount = 0;
    for (int outputBit = firstBit; outputBit < lastBit; outputBit += decimation)
    {
        if (outputBit - center < 0 || outputBit + center >= static_cast<int>(residual.size()))
            continue;
        double filtered = 0.0;
        for (int tap = 0; tap < tapCount; ++tap)
            filtered += residual[static_cast<size_t>(outputBit + tap - center)] * taps[static_cast<size_t>(tap)];
        sumSquares += filtered * filtered;
        ++sampleCount;
    }
    const double rms = sampleCount > 0 ? std::sqrt(sumSquares / sampleCount) : 1.0;
    return 20.0 * std::log10(std::max(rms, 1.0e-15));
}

void testNativeSdmProducesDeterministicProtectedDop()
{
    echo::SdmProcessor first;
    echo::SdmProcessor second;
    echo::SdmProcessor native;
    first.configure(2, echo::SdmQualityProfile::Safe);
    second.configure(2, echo::SdmQualityProfile::Safe);
    native.configure(2, echo::SdmQualityProfile::Safe);
    const std::vector<float> samples { 0.1234567f, -0.1234567f, 0.01f, -0.01f, 0.5f, -0.5f, 0.0f, 0.0f };
    const auto output = first.processDop(samples.data(), 4);
    const auto nativeOutput = native.processNativeDsd(samples.data(), 4);
    require(output == second.processDop(samples.data(), 4),
        "native SDM must remain deterministic across equivalent sessions");
    require(output.size() == 8, "native SDM must emit one protected DoP word per channel and frame");
    for (size_t frame = 0; frame < 4; ++frame)
    {
        const uint32_t expectedMarker = (frame & 1u) == 0u ? 0x05u : 0xfau;
        for (size_t channel = 0; channel < 2; ++channel)
        {
            require((output[frame * 2 + channel] >> 16u) == expectedMarker,
                "native SDM must preserve alternating DoP markers");
            const size_t nativeBase = frame * 4;
            const uint8_t older = nativeOutput[nativeBase + channel];
            const uint8_t newer = nativeOutput[nativeBase + 2 + channel];
            const uint32_t expectedDsd =
                static_cast<uint32_t>(reverseBitsForTest(newer))
                | (static_cast<uint32_t>(reverseBitsForTest(older)) << 8u);
            require((output[frame * 2 + channel] & 0xffffu) == expectedDsd,
                "native SDM DoP output must place chronological t0 at bit 15");
        }
    }
}

void testNativeSdmProfilesShapeNoiseOutOfBand()
{
    struct SpectrumGuard
    {
        echo::SdmQualityProfile profile;
        double dsd64MaximumResidualDb;
        double dsd128MaximumResidualDb;
    };
    const std::vector<SpectrumGuard> profiles {
        { echo::SdmQualityProfile::Safe, -78.0, -96.0 },
        { echo::SdmQualityProfile::Hifi, -98.0, -122.0 },
        { echo::SdmQualityProfile::Reference, -104.0, -125.0 },
        { echo::SdmQualityProfile::Insane, -108.0, -126.0 },
    };
    for (const auto [transportSampleRate, rateName] : {
        std::pair { 176'400, "DSD64" },
        std::pair { 352'800, "DSD128" },
    })
    {
        std::vector<double> residuals;
        for (const auto& guard : profiles)
        {
            const double residualDb = measureSdmInBandResidualDb(guard.profile, transportSampleRate);
            residuals.push_back(residualDb);
            const double maximumResidualDb = transportSampleRate == 176'400
                ? guard.dsd64MaximumResidualDb
                : guard.dsd128MaximumResidualDb;
            require(
                residualDb < maximumResidualDb,
                std::string("SDM profile must meet its ") + rateName
                    + " in-band residual guard, measured " + std::to_string(residualDb));
        }
        const double minimumProfileImprovementDb = transportSampleRate == 176'400 ? 3.0 : 0.25;
        for (size_t profile = 1; profile < residuals.size(); ++profile)
            require(residuals[profile] < residuals[profile - 1] - minimumProfileImprovementDb,
                std::string("each higher SDM profile must improve ") + rateName
                    + " in-band residual");
    }
}

void testNativeSdmHighOrderProfilesRemainBounded()
{
    constexpr int transportSampleRate = 176'400;
    constexpr int frames = transportSampleRate / 4;
    constexpr double pi = 3.14159265358979323846;
    uint32_t randomState = 0x12345678u;

    std::vector<float> input(static_cast<size_t>(frames));
    for (int frame = 0; frame < frames; ++frame)
    {
        const int section = (frame / 2'048) % 4;
        if (section == 0)
            input[static_cast<size_t>(frame)] = 1.0f;
        else if (section == 1)
            input[static_cast<size_t>(frame)] = -1.0f;
        else if (section == 2)
            input[static_cast<size_t>(frame)] = static_cast<float>(
                0.57 * std::sin(2.0 * pi * 997.0 * frame / transportSampleRate)
                + 0.43 * std::sin(2.0 * pi * 19'001.0 * frame / transportSampleRate));
        else
        {
            randomState = randomState * 1664525u + 1013904223u;
            input[static_cast<size_t>(frame)] =
                static_cast<float>(static_cast<double>(randomState) / 2147483648.0 - 1.0);
        }
    }

    const std::vector<std::pair<echo::SdmQualityProfile, int>> profiles {
        { echo::SdmQualityProfile::Hifi, 6 },
        { echo::SdmQualityProfile::Reference, 7 },
        { echo::SdmQualityProfile::Insane, 8 },
    };
    for (const auto& [profile, expectedOrder] : profiles)
    {
        echo::SdmProcessor processor;
        processor.configure(1, profile, transportSampleRate);
        for (int offset = 0; offset < frames; offset += 2'048)
        {
            const int chunkFrames = std::min(2'048, frames - offset);
            const auto output = processor.processNativeDsd(input.data() + offset, chunkFrames);
            require(
                output.size() == static_cast<size_t>(chunkFrames * 2),
                "high-order SDM stress block must produce complete native DSD output");
        }
        require(processor.modulatorOrder() == expectedOrder, "SDM profile must use its guarded NTF order");
        require(processor.stabilityRecoveryCount() == 0,
            "high-order SDM must not trigger stability recovery under full-scale DC, multitone, noise, or steps");
        require(processor.peakFeedbackState() < 2.0,
            "high-order SDM feedback state must retain at least 6 dB margin to the emergency guard");
    }
}

void testNativeSdmHighOrderProfilesAreChunkInvariant()
{
    constexpr int transportSampleRate = 176'400;
    constexpr int frames = 4'097;
    constexpr double pi = 3.14159265358979323846;
    std::vector<float> input(static_cast<size_t>(frames));
    for (int frame = 0; frame < frames; ++frame)
        input[static_cast<size_t>(frame)] = static_cast<float>(
            0.72 * std::sin(2.0 * pi * 997.0 * frame / transportSampleRate)
            + 0.18 * std::sin(2.0 * pi * 17'003.0 * frame / transportSampleRate));

    for (const auto profile : {
        echo::SdmQualityProfile::Hifi,
        echo::SdmQualityProfile::Reference,
        echo::SdmQualityProfile::Insane,
    })
    {
        echo::SdmProcessor contiguous;
        echo::SdmProcessor chunked;
        contiguous.configure(1, profile, transportSampleRate);
        chunked.configure(1, profile, transportSampleRate);
        const auto expected = contiguous.processNativeDsd(input.data(), frames);

        std::vector<uint8_t> actual;
        for (int offset = 0; offset < frames;)
        {
            const int chunkFrames = std::min(137 + (offset % 251), frames - offset);
            auto block = chunked.processNativeDsd(input.data() + offset, chunkFrames);
            actual.insert(actual.end(), block.begin(), block.end());
            offset += chunkFrames;
        }
        require(actual == expected, "high-order SDM output must be bit-identical across decoder chunking");
        require(chunked.stabilityRecoveryCount() == 0, "chunked high-order SDM must not require recovery");
    }
}

void testNativeSdmAppliesHeadroomAndSmoothsTransitions()
{
    constexpr int transportSampleRate = 176'400;
    constexpr int transitionFrames = transportSampleRate / 100;
    echo::SdmProcessor processor;
    processor.configure(1, echo::SdmQualityProfile::Safe, transportSampleRate);
    std::vector<float> fullScale(static_cast<size_t>(transitionFrames * 3), 1.0f);
    const auto started = processor.processNativeDsd(fullScale.data(), static_cast<int>(fullScale.size()));

    const double earlyDensity = nativeDsdOneDensity(started, 0, transitionFrames / 10);
    const double settledDensity = nativeDsdOneDensity(started, transitionFrames * 2, transitionFrames);
    require(earlyDensity < 0.56, "SDM startup must ramp from silence instead of stepping to full signal");
    require(
        settledDensity > 0.64 && settledDensity < 0.68,
        "SDM safe profile must apply its 10 dB headroom before modulation");

    processor.setTargetGain(0.0);
    std::vector<float> volumeChange(static_cast<size_t>(transitionFrames), 1.0f);
    const auto faded = processor.processNativeDsd(volumeChange.data(), transitionFrames);
    const double fadeStartDensity = nativeDsdOneDensity(faded, 0, transitionFrames / 4);
    const double fadeEndDensity = nativeDsdOneDensity(
        faded,
        transitionFrames - transitionFrames / 4,
        transitionFrames / 4);
    require(
        fadeStartDensity > fadeEndDensity + 0.1,
        "SDM volume changes must use a time-domain gain ramp");
    require(fadeEndDensity < 0.55, "SDM gain ramp must settle near shaped silence");

    echo::SdmProcessor mutedProcessor;
    mutedProcessor.configure(1, echo::SdmQualityProfile::Safe, transportSampleRate);
    mutedProcessor.setTargetGain(0.0);
    mutedProcessor.reset();
    const auto muted = mutedProcessor.processNativeDsd(fullScale.data(), transitionFrames);
    const double mutedDensity = nativeDsdOneDensity(muted, 0, transitionFrames);
    require(
        mutedDensity > 0.49 && mutedDensity < 0.51,
        "an SDM session started muted must not produce a gain-ramp hump");
}

void testNativeSdmIdleLockPreservesWeakSignals()
{
    constexpr int transportSampleRate = 176'400;
    constexpr int signalFrames = transportSampleRate / 20;
    constexpr double pi = 3.14159265358979323846;
    echo::SdmProcessor processor;
    processor.configure(1, echo::SdmQualityProfile::Reference, transportSampleRate);
    std::vector<float> weakSignal(static_cast<size_t>(signalFrames));
    for (int frame = 0; frame < signalFrames; ++frame)
        weakSignal[static_cast<size_t>(frame)] = static_cast<float>(
            std::sin(2.0 * pi * 1'000.0 * static_cast<double>(frame) / transportSampleRate) * 0.001);
    const auto signalOutput = processor.processNativeDsd(weakSignal.data(), signalFrames);

    int longestIdleRun = 0;
    int currentIdleRun = 0;
    for (int frame = transportSampleRate / 50; frame < signalFrames; ++frame)
    {
        const size_t base = static_cast<size_t>(frame * 2);
        if (signalOutput[base] == 0x69u && signalOutput[base + 1] == 0x69u)
        {
            currentIdleRun += 1;
            longestIdleRun = std::max(longestIdleRun, currentIdleRun);
        }
        else
        {
            currentIdleRun = 0;
        }
    }
    require(longestIdleRun < 64, "SDM idle lock must not gate sustained -60 dBFS content");

    processor.reset();
    std::vector<float> digitalSilence(static_cast<size_t>(transportSampleRate / 25), 0.0f);
    const auto silenceOutput = processor.processNativeDsd(
        digitalSilence.data(),
        static_cast<int>(digitalSilence.size()));
    for (int frame = static_cast<int>(digitalSilence.size()) - 32;
         frame < static_cast<int>(digitalSilence.size());
         ++frame)
    {
        const size_t base = static_cast<size_t>(frame * 2);
        require(
            silenceOutput[base] == 0x69u && silenceOutput[base + 1] == 0x69u,
            "sustained digital silence must settle to the standard DSD idle pattern");
    }
}

void testNativeProcessingConfigurationFailsClosed()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource pcm(2, 4096, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    DopRingSource dop(2, 4096, 0, 0);
    NativeDsdRingSource nativeDsd(2, 8192, 0, 0);
    NativePlaybackPipeline pipeline(pcm, dop, nativeDsd, 2);
    Options options;
    options.exclusive = true;
    options.sampleRate = 96'000;
    std::string error;

    const echo_audio_host::Json validEcho = {
        {"processing", {
            {"outputFormat", "pcm"},
            {"echoSrc", {
                {"sourceSampleRate", 48'000},
                {"targetSampleRate", 96'000},
                {"stages", echo_audio_host::Json::array({
                    {{"upsampleFactor", 2}, {"taps", {0.25, 0.5, 0.25}}},
                })},
            }},
            {"dither", {{"mode", "ns-5"}, {"bitDepth", 24}}},
        }},
    };
    require(configureNativeProcessing(validEcho, options, pipeline, error),
        "valid native ECHO SRC and dither configuration must be accepted");
    require(pipeline.decoderSampleRate(options.sampleRate) == 48'000,
        "native ECHO SRC must make the decoder preserve source rate");

    auto invalidEcho = validEcho;
    invalidEcho["processing"]["echoSrc"]["targetSampleRate"] = 192'000;
    require(! configureNativeProcessing(invalidEcho, options, pipeline, error),
        "mismatched native ECHO SRC target must fail closed");
    requireContains(error, "sample_rate_mismatch", "native ECHO SRC mismatch error");
    require(pipeline.decoderSampleRate(options.sampleRate) == 48'000,
        "failed native DSP reconfiguration must preserve the previous processor state");

    const echo_audio_host::Json invalidSdm = {
        {"processing", {
            {"outputFormat", "dop24le"},
            {"sdm", {{"qualityProfile", "unknown"}}},
        }},
    };
    require(! configureNativeProcessing(invalidSdm, options, pipeline, error),
        "unknown native SDM profile must fail closed");
    requireContains(error, "invalid_quality_profile", "native SDM profile error");
    require(pipeline.outputFormat() == NativePlaybackPipeline::OutputFormat::Pcm,
        "failed native SDM reconfiguration must preserve PCM output routing");
}

void testRuntimeDeviceConfigurationIsAuthoritative()
{
    const auto current = parseOptions({ "echo-audio-host", "--defer-device-open" });
    Options configured;
    std::string error;
    const echo_audio_host::Json sharedParams = {
        {"outputMode", "shared"},
        {"deviceId", "shared:3"},
        {"deviceName", "USB DAC"},
        {"deviceIndex", 3},
        {"sampleRate", 96000},
        {"channels", 2},
        {"bufferSize", 0},
        {"latencyProfile", "stable"},
        {"sharedBackend", "windows"},
    };

    require(configureRuntimeOutputOptions(sharedParams, current, configured, error),
        "runtime shared device configuration must be accepted");
    require(! configured.exclusive && ! configured.asio, "runtime shared mode must clear exclusive flags");
    require(configured.deviceId == "shared:3" && configured.deviceName == "USB DAC" && configured.deviceIndex == 3,
        "runtime shared configuration must preserve the selected device identity");
    require(configured.sampleRate == 96000 && configured.channels == 2,
        "runtime shared configuration must preserve the requested PCM format");
    require(configured.bufferSize == 4096, "stable latency profile must choose the stable native buffer");
    require(configured.sharedBackend == "windows", "runtime shared backend must be authoritative");

    Options repeated;
    require(configureRuntimeOutputOptions(sharedParams, configured, repeated, error),
        "repeated runtime configuration must remain accepted");
    require(hasSameRuntimeOutputOptions(configured, repeated),
        "repeated runtime configuration must be detected as a no-op");

    Options invalid;
    require(! configureRuntimeOutputOptions(
        echo_audio_host::Json{{"outputMode", "invalid-mode"}}, configured, invalid, error),
        "unsupported runtime output mode must fail closed");
    requireContains(error, "unsupported outputMode", "unsupported runtime mode error");

#ifdef _WIN32
    Options exclusive;
    require(configureRuntimeOutputOptions(
        echo_audio_host::Json{
            {"outputMode", "exclusive"},
            {"deviceName", "Exclusive DAC"},
            {"sampleRate", 192000},
            {"channels", 2},
            {"bufferSize", 1024},
        },
        configured,
        exclusive,
        error),
        "runtime exclusive device configuration must be accepted on Windows");
    require(exclusive.exclusive && ! exclusive.asio && exclusive.sampleRate == 192000,
        "runtime exclusive configuration must select the WASAPI exclusive backend and rate");

    Options asio;
    require(configureRuntimeOutputOptions(
        echo_audio_host::Json{
            {"outputMode", "asio"},
            {"deviceName", "ASIO DAC"},
            {"deviceIndex", 1},
            {"sampleRate", 96000},
            {"channels", 2},
            {"asioOutputChannelStart", 2},
        },
        exclusive,
        asio,
        error),
        "runtime ASIO device configuration must be accepted on Windows");
    require(asio.asio && ! asio.exclusive && asio.asioOutputChannelStart == 2,
        "runtime ASIO configuration must preserve the selected output channel pair");
#endif
}

void testHostBackendNames()
{
    const DeviceDescriptor shared { 0, "miniaudio-shared", "Default Output", 48000, 48000, true, false };
    const DeviceDescriptor exclusive { 1, "WASAPI Exclusive", "Exclusive DAC", 96000, 48000, false, false };
    const DeviceDescriptor asio { 2, "ASIO", "ASIO DAC", 192000, 0, false, true, 2, "1: Left, 2: Right", "asio:ASIO DAC" };

    require(! isAsioType(shared.typeName), "miniaudio shared device must not be ASIO");
    require(! isExclusiveType(shared.typeName), "miniaudio shared device must not be exclusive");
    require(isExclusiveType(exclusive.typeName), "exclusive descriptor must be recognized as exclusive");
    require(isAsioType(asio.typeName), "ASIO descriptor must be recognized as ASIO");
    require(shouldIncludeType(shared.typeName, DeviceListMode::Shared), "shared listing must include shared descriptor");
    require(! shouldIncludeType(exclusive.typeName, DeviceListMode::Shared), "shared listing must skip exclusive descriptor");
    require(shouldIncludeType(exclusive.typeName, DeviceListMode::Exclusive), "exclusive listing must include exclusive descriptor");
    require(shouldIncludeType(asio.typeName, DeviceListMode::Asio), "ASIO listing must include ASIO descriptor");
#ifdef _WIN32
    require(isPreferredSharedType("Windows Audio"), "Windows Audio descriptor must be preferred shared output on Windows");
#else
    require(isPreferredSharedType("ALSA"), "ALSA descriptor must be preferred shared output on non-Windows hosts");
#endif
    require(sharedTypePriority(shared.typeName) < sharedTypePriority("JACK"), "preferred shared backend must sort before JACK");
}

void testSpecializedOutputsSkipMiniaudioSharedOutput()
{
    const auto shared = parseOptions({ "echo-audio-host" });
#ifdef _WIN32
    require(! shouldTryMiniaudioSharedOutput(shared), "default Windows shared output must use the stable native WASAPI backend");
    require(selectNativePcmOutputBackend(shared) == NativePcmOutputBackendKind::WasapiShared,
        "default Windows shared output must dispatch to native WASAPI shared");
#else
    require(shouldTryMiniaudioSharedOutput(shared), "non-Windows shared output may use miniaudio when no platform backend is selected");
#endif

    const auto miniaudioShared = parseOptions({ "echo-audio-host", "-shared-backend", "miniaudio" });
    require(shouldTryMiniaudioSharedOutput(miniaudioShared), "miniaudio must require an explicit backend selection on Windows");
    require(selectNativePcmOutputBackend(miniaudioShared) == NativePcmOutputBackendKind::Miniaudio,
        "explicit miniaudio selection must dispatch to the experimental backend");

    const auto exclusive = parseOptions({ "echo-audio-host", "-exclusive" });
    require(! shouldTryMiniaudioSharedOutput(exclusive), "WASAPI exclusive must not route through miniaudio shared output");
    require(selectSpecializedHostRunner(exclusive) == SpecializedHostRunner::WasapiExclusivePcm,
        "WASAPI exclusive PCM must dispatch to the specialized WASAPI exclusive runner");

    const auto wasapiDop = parseOptions({ "echo-audio-host", "-exclusive", "-dop-output" });
    require(! shouldTryMiniaudioSharedOutput(wasapiDop), "WASAPI exclusive DoP must not route through miniaudio shared output");
    require(selectSpecializedHostRunner(wasapiDop) == SpecializedHostRunner::WasapiExclusiveDop,
        "WASAPI exclusive DoP must dispatch to the specialized WASAPI exclusive DoP runner");

    const auto requestedMiniaudioDop = parseOptions({ "echo-audio-host", "-shared-backend", "miniaudio", "-dop-output" });
    require(! shouldTryMiniaudioSharedOutput(requestedMiniaudioDop), "requested miniaudio shared must reject DoP transport instead of claiming success");
    require(selectSpecializedHostRunner(requestedMiniaudioDop) == SpecializedHostRunner::None,
        "DoP without WASAPI exclusive or ASIO must not select a specialized runner");

    const auto asio = parseOptions({ "echo-audio-host", "-asio" });
    require(! shouldTryMiniaudioSharedOutput(asio), "ASIO must not route through miniaudio shared output");
    require(selectSpecializedHostRunner(asio) == SpecializedHostRunner::AsioPcm,
        "ASIO PCM must dispatch to the specialized ASIO runner");

    const auto asioDop = parseOptions({ "echo-audio-host", "-asio", "-dop-output" });
    require(! shouldTryMiniaudioSharedOutput(asioDop), "ASIO DoP must not route through miniaudio shared output");
    require(selectSpecializedHostRunner(asioDop) == SpecializedHostRunner::AsioDop,
        "ASIO DoP must dispatch to the specialized ASIO DoP runner");

    const auto nativeDsd = parseOptions({ "echo-audio-host", "-asio", "-dop-output", "-asio-native-dsd-output" });
    require(! shouldTryMiniaudioSharedOutput(nativeDsd), "ASIO native DSD must not route through miniaudio shared output");
    require(selectSpecializedHostRunner(nativeDsd) == SpecializedHostRunner::AsioNativeDsd,
        "ASIO native DSD must dispatch before ASIO DoP and ASIO PCM");

    const auto requestedMiniaudioNativeDsd = parseOptions({ "echo-audio-host", "-shared-backend", "miniaudio", "-dop-output", "-asio-native-dsd-output" });
    require(! shouldTryMiniaudioSharedOutput(requestedMiniaudioNativeDsd), "requested miniaudio shared must reject native DSD transport instead of claiming success");
    require(selectSpecializedHostRunner(requestedMiniaudioNativeDsd) == SpecializedHostRunner::AsioNativeDsd,
        "ASIO native DSD selector remains fail-closed behind runHost validation when ASIO DoP is missing");
}

void testSpecializedRunHostValidationBeforeHardwareOpen()
{
    const auto dopWithoutSpecializedBackend = parseOptions({ "echo-audio-host", "-dop-output" });
    requireThrowsContaining(
        [&] { runHost(dopWithoutSpecializedBackend); },
        "DoP output requires WASAPI exclusive or ASIO",
        "DoP without WASAPI exclusive or ASIO must fail validation before hardware open");

    const auto nativeDsdWithoutAsioDop = parseOptions({ "echo-audio-host", "-dop-output", "-asio-native-dsd-output" });
    requireThrowsContaining(
        [&] { runHost(nativeDsdWithoutAsioDop); },
        "ASIO native DSD output requires ASIO DoP output",
        "ASIO native DSD must require ASIO DoP before selecting a runner");

#if ! ECHO_ENABLE_ASIO
    const auto asioDop = parseOptions({ "echo-audio-host", "-asio", "-dop-output" });
    requireThrowsContaining(
        [&] { runHost(asioDop); },
        "ASIO DoP open failed: ASIO support is disabled at build time",
        "ASIO DoP must dispatch to the disabled-build DoP runner after validation");

    const auto nativeDsd = parseOptions({ "echo-audio-host", "-asio", "-dop-output", "-asio-native-dsd-output" });
    requireThrowsContaining(
        [&] { runHost(nativeDsd); },
        "ASIO native DSD open failed: ASIO support is disabled at build time",
        "ASIO native DSD must dispatch to the disabled-build native DSD runner after validation");
#endif
}

void testHostPrebufferDefaultsRemainCompatible()
{
    const auto exclusive = parseOptions({ "echo-audio-host", "-exclusive" });

    require(! exclusive.startupPrebufferMsSpecified, "exclusive prebuffer default must be unspecified");
    require(getFifoCapacityFrames(exclusive, 48000) == 9600, "exclusive FIFO default must remain compatible");
    require(getFifoCapacityFrames(exclusive, 192000) == 144000, "high-rate exclusive FIFO must absorb decoder jitter");
    require(getStartupPrebufferFrames(exclusive, 48000) == 960, "exclusive default prebuffer must remain compatible");
    require(getStartupPrebufferFrames(exclusive, 192000) == 34560, "high-rate exclusive default prebuffer must reduce startup underruns");
    require(getStartupPrebufferTimeoutMs(exclusive) == 300, "default prebuffer timeout must remain compatible");
}

void testHighRateNativeDsdBuffersUseByteFrameScale()
{
    const auto nativeDsd = parseOptions({
        "echo-audio-host",
        "-asio",
        "-dop-output",
        "-asio-native-dsd-output",
    });

    require(
        getNativeDsdFifoCapacityByteFrames(nativeDsd, 22'579'200) == 564'480,
        "DSD512 FIFO must allocate 200 ms in byte frames");
    require(
        getNativeDsdStartupPrebufferByteFrames(nativeDsd, 22'579'200) == 56'448,
        "DSD512 startup prebuffer must hold 20 ms in byte frames");
    require(
        getNativeDsdFifoCapacityByteFrames(nativeDsd, 45'158'400) == 1'128'960,
        "DSD1024 FIFO must allocate 200 ms in byte frames");
    require(
        getNativeDsdStartupPrebufferByteFrames(nativeDsd, 45'158'400) == 112'896,
        "DSD1024 startup prebuffer must hold 20 ms in byte frames");
}

void testExplicitZeroPrebufferDisablesWait()
{
    const auto exclusive = parseOptions({
        "echo-audio-host",
        "-exclusive",
        "-prebuffer-ms",
        "0",
        "-prebuffer-timeout-ms",
        "0",
    });

    require(exclusive.startupPrebufferMsSpecified, "zero prebuffer must be tracked as explicit");
    require(exclusive.startupPrebufferTimeoutMsSpecified, "zero prebuffer timeout must be tracked as explicit");
    require(getStartupPrebufferFrames(exclusive, 48000) == 0, "explicit zero prebuffer must disable startup prebuffer");
    require(getStartupPrebufferTimeoutMs(exclusive) == 0, "explicit zero prebuffer timeout must be preserved");

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    require(waitForInitialPcm(source, 512, 0) == 0, "zero prebuffer timeout must not wait for PCM");
}

std::vector<char> makePcmPayload(const std::vector<float>& samples)
{
    std::vector<char> payload(samples.size() * sizeof(float));
    std::memcpy(payload.data(), samples.data(), payload.size());
    return payload;
}

void testPcmIdleDoesNotCountUnderrunBeforePcm()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    const auto payload = makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f });

    source.beginSession();
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getUnderrunCallbacks() == 0, "idle session before first PCM must not count underruns");
    require(source.getUnderrunFrames() == 0, "idle session before first PCM must not count underrun frames");

    std::vector<char> pending;
    pushPcmPayload(source, 2, pending, payload);
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getUnderrunCallbacks() > 0, "session must count underruns after PCM has started");
}

void testPcmSourcePauseRetainsBufferedFrames()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 2);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    require(source.getReadyFrames() == 2, "test setup must buffer two PCM frames");

    source.setPaused(true);
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getFramesPlayed() == 0, "paused source must not advance playback position");
    require(source.getReadyFrames() == 2, "paused source must retain buffered PCM frames");
    require(std::abs(output.getSample(0, 0)) < 0.000001f && std::abs(output.getSample(1, 0)) < 0.000001f, "paused source must output silence");

    source.setPaused(false);
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getFramesPlayed() == 2, "unpaused source must consume retained buffered PCM frames");
    require(source.getReadyFrames() == 0, "unpaused source must drain rendered buffered PCM frames");
}

void testPcmInputEndedWaitsForBufferedDrain()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 2);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    require(source.getReadyFrames() == 2, "test setup must buffer PCM before input ends");

    source.markInputEnded();
    require(source.hasInputEnded(), "source must report input ended after decoder EOF");
    require(! source.isDrained(), "input ended must not drain while buffered PCM remains");

    source.renderPlanar(output, 0, 1);
    require(source.getReadyFrames() == 1, "partial render must leave one buffered frame");
    require(! source.isDrained(), "source must wait for remaining buffered frame before drain");

    source.renderPlanar(output, 1, 1);
    require(source.getReadyFrames() == 0, "rendering remaining PCM must empty buffer");
    require(source.isDrained(), "source must drain only after input ended and buffered PCM is empty");
}

void testPcmSourcePlaybackRateConsumesSourceFramesAtRate()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(1, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(1, 8);

    std::vector<float> input(32, 0.0f);
    for (size_t index = 0; index < input.size(); ++index)
        input[index] = static_cast<float>(index + 1);

    source.beginSession();
    require(source.push(input.data(), 32), "playback-rate source test must accept PCM");
    source.getRateProcessor()->setRate(2.0f);
    require(source.renderPlanar(output, 0, output.getNumSamples()) == 8,
        "2x playback must report bounded output frames rather than source frames consumed");

    require(source.getFramesPlayed() == 16, "2x playback must consume source frames at double output rate");
    require(source.getReadyFrames() == 16, "2x playback must drain double-rate source frames from FIFO");
}

void testNativeRenderPlaybackRateKeepsDitherInsideOutputBuffer()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(1, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.prepareForNativeRender(8, 48'000.0);
    source.configureDither(echo::PcmDitherMode::Tpdf, 24);
    source.beginSession();
    source.getRateProcessor()->setRate(2.0f);

    const std::vector<float> input(32, 0.25f);
    require(source.push(input.data(), static_cast<int>(input.size())),
        "playback-rate dither guard test must accept PCM");

    constexpr float guardValue = 1234.5f;
    std::vector<float> outputWithGuard(12, guardValue);
    require(source.renderInterleaved(outputWithGuard.data(), 8, 1) == 8,
        "native playback-rate render must report no more than output capacity");
    require(std::all_of(outputWithGuard.begin() + 8, outputWithGuard.end(), [](float sample) {
        return sample == guardValue;
    }), "native playback-rate dither must not write beyond the output buffer");
}

void testPcmSourceReplaceBufferedAudioDropsStaleFrames()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    std::vector<float> replacement(32, -0.5f);

    require(source.replaceBufferedAudio(replacement.data(), 16, false) == 16, "replacement must write target frames");
    require(source.getReadyFrames() == 16, "replacement must leave target frames ready");
    source.renderPlanar(output, 0, output.getNumSamples());

    bool renderedReplacement = false;
    for (int frame = 0; frame < 16; frame += 1)
        renderedReplacement = renderedReplacement || output.getSample(0, frame) < -0.001f;
    require(renderedReplacement, "replacement must render target frames instead of stale positive frames");
    require(source.getFramesPlayed() == 16, "replacement session must count rendered target frames");
}

void testPcmSourceReplaceBufferedAudioWhilePausedWaitsForResume()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 64, 5000, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    std::vector<float> replacement(32, -0.5f);

    require(source.replaceBufferedAudio(replacement.data(), 16, true) == 16, "paused replacement must write target frames");
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getFramesPlayed() == 0, "paused replacement must not advance before resume");
    require(source.getReadyFrames() == 16, "paused replacement must retain target frames");

    source.setPaused(false);
    source.renderPlanar(output, 0, output.getNumSamples());
    bool renderedReplacement = false;
    for (int frame = 0; frame < 16; frame += 1)
        renderedReplacement = renderedReplacement || output.getSample(0, frame) < -0.001f;
    require(renderedReplacement, "resumed replacement must render target frames instead of stale positive frames");
    require(source.getFramesPlayed() == 16, "resumed replacement must count target frames");
}

void testPcmPrebufferDoesNotCountUnderrunBeforeTarget()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 64, 5000, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getFramesPlayed() == 0, "prebuffering PCM session must not consume early PCM");
    require(source.getReadyFrames() == 2, "prebuffering PCM session must retain early PCM");
    require(source.getUnderrunCallbacks() == 0, "prebuffering PCM session must not count underruns before target");

    std::vector<float> samples(128, 0.15f);
    pushPcmPayload(source, 2, pending, makePcmPayload(samples));
    source.renderPlanar(output, 0, output.getNumSamples());
    require(source.getFramesPlayed() > 0, "PCM session must start after the prebuffer target is reached");
}

void testNativeFifoWrapsAndResets()
{
    echo_audio_host::NativeFifo fifo(5);
    int start1 = 0;
    int size1 = 0;
    int start2 = 0;
    int size2 = 0;

    fifo.prepareToWrite(4, start1, size1, start2, size2);
    require(start1 == 0 && size1 == 4 && start2 == 0 && size2 == 0, "native FIFO first write block");
    fifo.finishedWrite(4);
    require(fifo.getNumReady() == 4 && fifo.getFreeSpace() == 1, "native FIFO tracks initial write");

    fifo.prepareToRead(3, start1, size1, start2, size2);
    require(start1 == 0 && size1 == 3 && start2 == 0 && size2 == 0, "native FIFO first read block");
    fifo.finishedRead(3);
    require(fifo.getNumReady() == 1 && fifo.getFreeSpace() == 4, "native FIFO tracks consumed frames");

    fifo.prepareToWrite(4, start1, size1, start2, size2);
    require(start1 == 4 && size1 == 1 && start2 == 0 && size2 == 3, "native FIFO write wraps around end");
    fifo.finishedWrite(4);

    fifo.prepareToRead(5, start1, size1, start2, size2);
    require(start1 == 3 && size1 == 2 && start2 == 0 && size2 == 3, "native FIFO read exposes wrapped blocks");
    fifo.reset();
    require(fifo.getNumReady() == 0 && fifo.getFreeSpace() == 5, "native FIFO reset clears state");
}


void testLibavPcmStreamDecoderReadsBoundedChunks()
{
    const int sampleRate = 48000;
    const int channels = 2;
    const int frames = 10000;
    const auto path = writeStreamingDecoderWavFixture(sampleRate, channels, frames);
    ScopedFileRemoval cleanup(path);

    echo::LibavPcmStreamDecoder decoder;
    decoder.open(path);
    require(decoder.sampleRate() == sampleRate, "streaming decoder reports fixture sample rate");
    require(decoder.channels() == channels, "streaming decoder reports fixture channels");

    int totalFrames = 0;
    int chunks = 0;
    while (! decoder.eof())
    {
        auto chunk = decoder.readFrames(1024);
        if (chunk.frames == 0)
            break;
        require(chunk.frames <= 1024, "streaming decoder respects requested chunk frame bound");
        require(chunk.samples.size() == static_cast<size_t>(chunk.frames * channels), "streaming decoder chunk is interleaved f32");
        totalFrames += chunk.frames;
        ++chunks;
    }

    require(totalFrames == frames, "streaming decoder emits every generated frame");
    require(chunks > 1, "streaming decoder does not return the whole track as one resident chunk");
}

void testLibavPcmStreamDecoderBoundsDamagedMediaRecovery()
{
    echo::LibavDecodeRecoveryBudget budget;
    require(
        ! budget.tryConsume(AVERROR(EIO), echo::LibavDecodeErrorStage::packet),
        "streaming decoder does not hide I/O errors");
    require(
        ! budget.tryConsume(AVERROR(ENOMEM), echo::LibavDecodeErrorStage::packet),
        "streaming decoder does not hide allocation errors");
    require(
        ! budget.tryConsume(AVERROR_EOF, echo::LibavDecodeErrorStage::packet),
        "streaming decoder keeps EOF outside error recovery");

    for (int count = 1; count <= 5; ++count)
        require(
            budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::packet, 24'000, 1'024),
            "streaming decoder tolerates the five-packet damage burst seen in a playable MP3");
    require(
        budget.regionErrors() == 5
            && budget.skippedDurationUs() == 120'000
            && budget.skippedBytes() == 5'120,
        "streaming decoder tracks the damaged media region");
    budget.resetRegion();
    require(
        budget.regionErrors() == 0 && budget.totalErrors() == 5,
        "a decoded PCM frame resets the region without erasing lifetime diagnostics");

    for (int count = 1; count <= echo::maxRecoverableLibavFrameErrors; ++count)
        require(
            budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::frame),
            "streaming decoder permits a bounded run of invalid frames");
    require(
        ! budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::frame),
        "streaming decoder fails closed after repeated invalid frames");

    budget.resetRegion();
    for (int count = 1; count <= echo::maxRecoverableLibavDemuxErrors; ++count)
        require(
            budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::demux),
            "streaming decoder permits a bounded demux resynchronization attempt");
    require(
        ! budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::demux),
        "streaming decoder stops a demuxer that cannot make progress");

    budget.resetRegion();
    require(
        budget.tryConsume(
            AVERROR_INVALIDDATA,
            echo::LibavDecodeErrorStage::packet,
            echo::maxRecoverableLibavDamageDurationUs,
            0),
        "streaming decoder accepts damage at the duration budget boundary");
    require(
        ! budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::packet, 1, 0),
        "streaming decoder rejects damage beyond the duration budget");

    budget.resetRegion();
    require(
        budget.tryConsume(
            AVERROR_INVALIDDATA,
            echo::LibavDecodeErrorStage::packet,
            0,
            echo::maxRecoverableLibavDamageBytes),
        "streaming decoder accepts damage at the byte budget boundary");
    require(
        ! budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::packet, 0, 1),
        "streaming decoder rejects damage beyond the byte budget");

    budget.resetRegion();
    for (int count = 1; count <= echo::maxRecoverableLibavRegionErrors; ++count)
        require(
            budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::packet),
            "streaming decoder permits bounded recovery when packet timing is unavailable");
    require(
        ! budget.tryConsume(AVERROR_INVALIDDATA, echo::LibavDecodeErrorStage::packet),
        "streaming decoder stops recovery when no valid PCM frame appears");

    require(echo::shouldLogRecoverableLibavError(1), "recovery logs the first damaged packet");
    require(echo::shouldLogRecoverableLibavError(4), "recovery logs power-of-two progress");
    require(! echo::shouldLogRecoverableLibavError(5), "recovery suppresses repetitive log noise");
}

void testLibavPcmStreamDecoderMapsToNativeOutputFormat()
{
    const int sourceSampleRate = 44100;
    const int targetSampleRate = 48000;
    const int sourceFrames = 4410;
    const auto path = writeStreamingDecoderWavFixture(sourceSampleRate, 1, sourceFrames);
    ScopedFileRemoval cleanup(path);

    echo::LibavPcmStreamDecoder decoder;
    decoder.open(path, targetSampleRate, 2);
    require(decoder.sampleRate() == targetSampleRate,
        "streaming decoder must resample into the native device rate");
    require(decoder.channels() == 2,
        "streaming decoder must map mono input into the native stereo layout");

    int totalFrames = 0;
    while (! decoder.eof())
    {
        auto chunk = decoder.readFrames(512);
        if (chunk.frames == 0)
            break;
        require(chunk.samples.size() == static_cast<size_t>(chunk.frames * 2),
            "mapped streaming decoder output must remain stereo interleaved f32");
        totalFrames += chunk.frames;
    }
    require(totalFrames > sourceFrames,
        "44.1 kHz source must expand when mapped into a 48 kHz native output stream");
}

void requireDsdContainerDecodesToPcm(const std::string& path, const std::string& container)
{
    const auto probe = echo::LibavDecoder::probe(path);
    require(probe.channels == 2, container + " probe reports stereo channels");
    require(probe.codec.find("dsd") != std::string::npos, container + " probe resolves a DSD codec");

    constexpr int targetSampleRate = 176400;
    echo::LibavPcmStreamDecoder decoder;
    decoder.open(path, targetSampleRate, 2);
    require(decoder.sampleRate() == targetSampleRate, container + " decoder maps into the requested PCM sample rate");
    require(decoder.channels() == 2, container + " decoder keeps stereo PCM output");

    int totalFrames = 0;
    float peakMagnitude = 0.0f;
    while (! decoder.eof())
    {
        auto chunk = decoder.readFrames(512);
        if (chunk.frames == 0)
            break;
        require(chunk.samples.size() == static_cast<size_t>(chunk.frames * 2),
            container + " decoder output is stereo interleaved f32");
        require(std::all_of(chunk.samples.begin(), chunk.samples.end(), [](float sample) {
            return std::isfinite(sample);
        }), container + " decoder output remains finite");
        for (const float sample : chunk.samples)
            peakMagnitude = std::max(peakMagnitude, std::abs(sample));
        totalFrames += chunk.frames;
    }

    require(totalFrames > 0, container + " decoder emits PCM frames");
    require(peakMagnitude <= 1.0f, container + " decoder output stays within normalized PCM range");
}

void testLibavPcmStreamDecoderDecodesDsdContainersToPcm()
{
    const auto dsfPath = writeStreamingDecoderDsfFixture();
    ScopedFileRemoval dsfCleanup(dsfPath);
    requireDsdContainerDecodesToPcm(dsfPath, "DSF");

    const auto dffPath = writeStreamingDecoderDffFixture();
    ScopedFileRemoval dffCleanup(dffPath);
    requireDsdContainerDecodesToPcm(dffPath, "DFF");
}

void testLibavPcmStreamDecoderSeekCancelAndInvalidFile()
{
    const int sampleRate = 44100;
    const int channels = 2;
    const auto path = writeStreamingDecoderWavFixture(sampleRate, channels, 12000);
    ScopedFileRemoval cleanup(path);

    echo::LibavPcmStreamDecoder decoder;
    decoder.open(path);
    decoder.seek(0.10);
    auto chunk = decoder.readFrames(512);
    require(chunk.frames > 0 && chunk.frames <= 512, "streaming decoder reads after seek");
    decoder.cancel();
    require(decoder.cancelled(), "streaming decoder exposes cancel state");
    require(decoder.readFrames(512).frames == 0, "streaming decoder cancel stops subsequent reads");
    decoder.close();
    require(decoder.eof(), "streaming decoder close reaches EOF state");

    bool invalidFailed = false;
    try
    {
        echo::LibavPcmStreamDecoder invalid;
        invalid.open(path + ".missing");
    }
    catch (const std::exception&)
    {
        invalidFailed = true;
    }
    require(invalidFailed, "streaming decoder invalid input fails visibly");
}


void testNativeRenderAdapter()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.prepareForNativeRender(16, 100.0);
    source.beginSession();

    std::vector<float> emptyOutput(8, 1.0f);
    const auto emptyFrames = source.renderInterleaved(emptyOutput.data(), 4, 2);
    require(emptyFrames == 0, "native render adapter must report zero frames before PCM");
    require(std::all_of(emptyOutput.begin(), emptyOutput.end(), [] (float sample) { return sample == 0.0f; }),
        "native render adapter must clear output before PCM");
    require(source.getUnderrunCallbacks() == 0, "native render adapter must not count underrun before first PCM");

    const std::vector<float> input {
        0.10f, -0.10f,
        0.20f, -0.20f,
        0.30f, -0.30f,
        0.40f, -0.40f,
        0.50f, -0.50f,
        0.60f, -0.60f,
    };
    require(source.push(input.data(), 6), "native render adapter test PCM push");

    std::vector<float> rampWarmup(4, 0.0f);
    require(source.renderInterleaved(rampWarmup.data(), 2, 2) == 2, "native render adapter must consume ramp warmup");
    std::vector<float> output(8, 0.0f);
    const auto frames = source.renderInterleaved(output.data(), 4, 2);
    require(frames == 4, "native render adapter must report consumed frame count");

    for (size_t i = 0; i < output.size(); ++i)
        require(std::abs(output[i] - input[i + 4]) <= nearTolerance, "native render adapter must preserve interleaved PCM after declick ramp");
}

void testPcmDeclickRampOnSessionStartAndStop()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.prepareForNativeRender(16, 1000.0);
    source.beginSession();

    std::vector<float> input(48, 1.0f);
    require(source.push(input.data(), 24), "declick source must accept PCM");

    auto fadeIn = makeBuffer(2, 8);
    require(source.renderPlanar(fadeIn, 0, 8) == 8, "declick fade-in must render input");
    require(std::abs(fadeIn.getSample(0, 0)) <= nearTolerance, "declick fade-in must start from silence");
    for (int sample = 1; sample < 7; ++sample)
        require(fadeIn.getSample(0, sample) >= fadeIn.getSample(0, sample - 1), "declick fade-in must be monotonic");
    require(fadeIn.getSample(0, 7) > 0.99f, "declick fade-in must reach unity");

    source.requestStop();
    auto fadeOut = makeBuffer(2, 8);
    require(source.renderPlanar(fadeOut, 0, 8) == 8, "declick fade-out must render remaining input");
    require(fadeOut.getSample(0, 0) > 0.99f, "declick fade-out must begin at current level");
    for (int sample = 1; sample < 8; ++sample)
        require(fadeOut.getSample(0, sample) <= fadeOut.getSample(0, sample - 1) + nearTolerance, "declick fade-out must be monotonic");
    require(std::abs(fadeOut.getSample(0, 7)) <= nearTolerance, "declick fade-out must reach silence");
}

void testNativeAutomixDeckMixesNextBeforeCurrentEnds()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.beginSession();
    source.prepareAutomix(4.0, 0.5, 0.5, 0.0, 0.0);

    const std::vector<float> current {
        1.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
    };
    const std::vector<float> next {
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
    };
    require(source.push(current.data(), 6), "native automix must accept current deck PCM");
    require(source.pushAutomixNext(next.data(), 4), "native automix must accept next deck PCM");
    source.markInputEnded();
    source.markAutomixNextEnded();

    auto output = makeBuffer(2, 6);
    const auto frames = source.renderPlanar(output, 0, 6);
    require(frames == 6, "native automix must advance output clock through current deck");
    require(std::abs(output.getSample(0, 1) - 1.0f) <= nearTolerance, "automix must keep current deck before fade");
    require(output.getSample(0, 3) > 1.0f, "automix must overlap current and next during fade");
    require(std::abs(output.getSample(0, 4) - 0.5f) <= 0.02f, "automix must keep next deck after fade");
    require(source.isDrained(), "native automix must drain only after next deck ends");
}

void testNativeAutomixAppliesUserDspOnceAfterDeckSum()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::ReplayGainProcessor replayGainProcessor;
    echo::CompressorProcessor compressorProcessor;
    echo::SpatialDspProcessor spatialDspProcessor;
    echo::PlaybackRateProcessor playbackRateProcessor;
    echo::LevelMeterProcessor meterProcessor;
    eqProcessor.setEnabled(true);
    headroomProcessor.setHeadroomDb(-6.0f);

    PcmRingAudioSource source(
        2,
        256,
        0,
        0,
        1.0f,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor,
        replayGainProcessor,
        compressorProcessor,
        spatialDspProcessor,
        playbackRateProcessor,
        meterProcessor);
    source.prepareForNativeRender(64, 1000.0);
    source.beginSession();
    require(source.prepareAutomixFrames(16, 32, 0.0, 0.0),
        "DSP routing test must arm Smart Transition");

    const std::vector<float> current(64 * 2, 0.5f);
    const std::vector<float> next(64 * 2, 0.5f);
    require(source.push(current.data(), 64), "DSP routing test must accept current deck");
    require(source.pushAutomixNext(next.data(), 64), "DSP routing test must accept next deck");

    auto output = makeBuffer(2, 64);
    require(source.renderPlanar(output, 0, 64) == 64, "DSP routing test must render the overlap");

    constexpr float minusSixDbGain = 0.5011872f;
    require(std::abs(output.getSample(0, 8) - (0.5f * minusSixDbGain)) < 0.015f,
        "headroom must run once on the single-deck region");
    const float equalPowerMidpoint = 0.5f * std::sqrt(2.0f) * minusSixDbGain;
    require(std::abs(output.getSample(0, 32) - equalPowerMidpoint) < 0.02f,
        "EQ/headroom must run once after the equal-power A/B sum");
}

void testNativeAutomixAppliesReplayGainPerDeckWithoutGlobalDoubleProcessing()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::ReplayGainProcessor replayGainProcessor;
    echo::CompressorProcessor compressorProcessor;
    echo::SpatialDspProcessor spatialDspProcessor;
    echo::PlaybackRateProcessor playbackRateProcessor;
    echo::LevelMeterProcessor meterProcessor;
    echo::ReplayGainConfig globalReplayGain;
    globalReplayGain.mode = echo::replayGainModeTrack;
    globalReplayGain.trackGainDb = 6.0f;
    globalReplayGain.preventClipping = false;
    replayGainProcessor.setConfig(globalReplayGain);

    PcmRingAudioSource source(
        2,
        256,
        0,
        0,
        1.0f,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor,
        replayGainProcessor,
        compressorProcessor,
        spatialDspProcessor,
        playbackRateProcessor,
        meterProcessor);
    source.prepareForNativeRender(64, 1000.0);
    source.beginSession();
    require(source.prepareAutomixFrames(16, 32, 0.0, 0.0, -6.0, -12.0),
        "ReplayGain routing test must arm Smart Transition");

    const std::vector<float> current(64 * 2, 0.5f);
    const std::vector<float> next(64 * 2, 0.5f);
    require(source.push(current.data(), 64), "ReplayGain routing test must accept current deck");
    require(source.pushAutomixNext(next.data(), 64), "ReplayGain routing test must accept next deck");

    auto output = makeBuffer(2, 64);
    require(source.renderPlanar(output, 0, 64) == 64, "ReplayGain routing test must render the overlap");

    constexpr float currentDeckGain = 0.5011872f;
    constexpr float nextDeckGain = 0.2511886f;
    require(std::abs(output.getSample(0, 8) - (0.5f * currentDeckGain)) < 0.015f,
        "current Deck ReplayGain must replace, not multiply with, the global ReplayGain stage");
    const float expectedMidpoint =
        0.5f * static_cast<float>(std::sqrt(0.5)) * (currentDeckGain + nextDeckGain);
    require(std::abs(output.getSample(0, 32) - expectedMidpoint) < 0.02f,
        "current and next ReplayGain must be applied independently before the A/B sum");
}

void testNativeAutomixNextDeckCannotAdvancePastCurrentBuffer()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.beginSession();
    source.prepareAutomix(4.0, 0.5, 0.5, 0.0, 0.0);

    const std::vector<float> current {
        1.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
    };
    const std::vector<float> next {
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
        0.5f, 0.5f,
    };
    require(source.push(current.data(), 3), "native automix must accept partial current deck PCM");
    require(source.pushAutomixNext(next.data(), 6), "native automix must accept prebuffered next deck PCM");

    auto output = makeBuffer(2, 6);
    const auto frames = source.renderPlanar(output, 0, 6);
    require(frames == 3, "native automix next deck must not advance the clock beyond current deck PCM");
    require(source.getFramesPlayed() == 3, "native automix clock must stay pinned to available current deck frames");
}

void testNativeAutomixDeckFailureUsesTwentyMillisecondRecovery()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 256, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.prepareForNativeRender(64, 1000.0);
    source.beginSession();
    require(source.prepareAutomixFrames(0, 100, 0.0, 0.0), "fault test must arm AutoMix");
    const std::vector<float> current(160 * 2, 1.0f);
    const std::vector<float> next(160 * 2, 0.5f);
    require(source.push(current.data(), 160), "fault test must accept current deck");
    require(source.pushAutomixNext(next.data(), 160), "fault test must accept next deck");

    auto beforeFailure = makeBuffer(2, 12);
    require(source.renderPlanar(beforeFailure, 0, 12) == 12, "fault test must enter overlap");
    source.failAutomixNext(20);
    source.markAutomixNextEnded();
    auto recovery = makeBuffer(2, 24);
    require(source.renderPlanar(recovery, 0, 24) == 24, "healthy deck must continue through recovery");
    for (int frame = 0; frame < recovery.getNumSamples(); ++frame)
    {
        require(std::isfinite(recovery.getSample(0, frame)), "fault recovery must remain finite");
        if (frame > 0)
            require(std::abs(recovery.getSample(0, frame) - recovery.getSample(0, frame - 1)) < 0.08f,
                "fault recovery must not introduce a block-edge pop");
    }
    require(std::abs(recovery.getSample(0, 23) - 1.0f) < 0.02f,
        "20ms recovery must restore the healthy current deck to unity");
}

void testNativeGaplessJoinsAtDecodedPcmBoundary()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 64, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    source.beginSession();
    source.prepareGapless();

    const std::vector<float> current(8, 1.0f);
    const std::vector<float> next(8, 0.25f);
    require(source.push(current.data(), 4), "native gapless must accept current PCM");
    require(source.pushAutomixNext(next.data(), 4), "native gapless must prebuffer next PCM");
    source.markInputEnded();
    source.markAutomixNextEnded();

    auto output = makeBuffer(2, 8);
    require(source.renderPlanar(output, 0, 8) == 8, "native gapless must fill one callback across the track boundary");
    require(std::abs(output.getSample(0, 3) - 1.0f) <= nearTolerance, "native gapless must preserve the final current-track sample");
    require(std::abs(output.getSample(0, 4) - 0.25f) <= nearTolerance, "native gapless must start the next track without a silent or faded sample");
    require(source.getGaplessBoundaryFrame() == 4, "native gapless boundary must come from consumed PCM frames");
    require(source.isDrained(), "native gapless must drain only after both tracks finish");
}

void testDopRenderKeepsValidMarkersDuringSilenceAndData()
{
    DopRingSource source(2, 16, 0, 0);
    std::vector<uint32_t> silence(6, 0xffffffffu);

    const auto emptyFrames = source.renderInterleaved(silence.data(), 3, 2);
    require(emptyFrames == 0, "DoP silence render must not count as consumed input frames");
    require(silence[0] == 0x056969 && silence[1] == 0x056969,
        "DoP silence frame 0 must carry balanced DSD idle with 0x05 markers");
    require(silence[2] == 0xfa6969 && silence[3] == 0xfa6969,
        "DoP silence frame 1 must carry balanced DSD idle with 0xfa markers");
    require(silence[4] == 0x056969 && silence[5] == 0x056969,
        "DoP silence frame 2 must keep balanced idle and alternating markers");

    source.beginSession();
    const std::vector<uint32_t> wrongMarkerInput {
        0xaa0201u, 0xaa0605u,
        0xbb0403u, 0xbb0807u,
    };
    require(source.push(wrongMarkerInput.data(), 2), "DoP source must accept packed frames");

    std::vector<uint32_t> data(4, 0u);
    const auto dataFrames = source.renderInterleaved(data.data(), 2, 2);
    require(dataFrames == 2, "DoP render must consume queued input frames");
    require(data[0] == 0xfa0201 && data[1] == 0xfa0605,
        "DoP data frame 0 must preserve the transport phase with a 0xfa marker");
    require(data[2] == 0x050403 && data[3] == 0x050807,
        "DoP data frame 1 must preserve the transport phase with a 0x05 marker");
}

#ifdef _WIN32
std::vector<uint32_t> buildAsioCandidates(long minSize, long maxSize, long preferredSize, long granularity, uint32_t requested)
{
    std::vector<uint32_t> values(16, 0);
    const auto count = asio_build_buffer_candidates_for_tests(
        minSize,
        maxSize,
        preferredSize,
        granularity,
        requested,
        values.data(),
        static_cast<uint32_t>(values.size()));
    values.resize(count);
    return values;
}

std::vector<int> buildAsioIncludeInputAttempts(long inputChannels, bool dopMode, bool nativeDsdMode)
{
    std::vector<int> values(4, -1);
    const auto count = asio_build_buffer_include_input_attempts_for_tests(
        inputChannels,
        dopMode ? 1 : 0,
        nativeDsdMode ? 1 : 0,
        values.data(),
        static_cast<uint32_t>(values.size()));
    values.resize(count);
    return values;
}

std::vector<uint32_t> buildAsioRatePivots(double requested)
{
    std::vector<uint32_t> values(8, 0);
    const auto count = asio_build_sample_rate_pivot_candidates_for_tests(
        requested,
        values.data(),
        static_cast<uint32_t>(values.size()));
    values.resize(count);
    return values;
}

void testAsioBufferCandidateGeneration()
{
    auto explicitValid = buildAsioCandidates(128, 4096, 512, 128, 1024);
    require(! explicitValid.empty(), "ASIO explicit valid candidate list");
    require(explicitValid[0] == 1024, "ASIO explicit valid buffer must be first");
    require(std::find(explicitValid.begin(), explicitValid.end(), 512) != explicitValid.end(), "ASIO preferred fallback must be included");

    auto defaultPreferred = buildAsioCandidates(128, 4096, 512, 128, 0);
    require(! defaultPreferred.empty(), "ASIO default candidate list");
    require(defaultPreferred[0] == 512, "ASIO default buffer must prefer driver preferred size");

    auto powerOfTwo = buildAsioCandidates(64, 4096, 512, -1, 300);
    require(std::find(powerOfTwo.begin(), powerOfTwo.end(), 256) != powerOfTwo.end(), "ASIO power-of-two lower candidate");
    require(std::find(powerOfTwo.begin(), powerOfTwo.end(), 512) != powerOfTwo.end(), "ASIO power-of-two preferred candidate");

    auto stepped = buildAsioCandidates(128, 4096, 512, 128, 1000);
    require(std::find(stepped.begin(), stepped.end(), 896) != stepped.end(), "ASIO stepped lower aligned candidate");
    require(std::find(stepped.begin(), stepped.end(), 1024) != stepped.end(), "ASIO stepped upper aligned candidate");

    requireVectorEquals(
        buildAsioIncludeInputAttempts(2, false, false),
        { 1, 0 },
        "ASIO PCM should still try input+output before output-only");
    requireVectorEquals(
        buildAsioIncludeInputAttempts(0, false, false),
        { 0 },
        "ASIO PCM without inputs should try output-only");
    requireVectorEquals(
        buildAsioIncludeInputAttempts(2, true, false),
        { 0 },
        "ASIO DoP must match the reference host and create output-only buffers");
    requireVectorEquals(
        buildAsioIncludeInputAttempts(2, false, true),
        { 0 },
        "ASIO native DSD must match the reference host and create output-only buffers");
}

void testAsioSampleRatePivotCandidateGeneration()
{
    const auto downTo48 = buildAsioRatePivots(48000.0);
    require(! downTo48.empty(), "ASIO 48k pivot candidates");
    require(downTo48[0] == 44100, "ASIO 48k recovery must pivot away from 48k first");
    require(std::find(downTo48.begin(), downTo48.end(), 48000u) == downTo48.end(), "ASIO 48k pivot must not include requested rate");
    require(std::find(downTo48.begin(), downTo48.end(), 96000u) != downTo48.end(), "ASIO 48k pivot includes high-rate recovery");

    const auto upTo192 = buildAsioRatePivots(192000.0);
    require(! upTo192.empty(), "ASIO 192k pivot candidates");
    require(upTo192[0] == 48000, "ASIO non-48k recovery should try stable 48k first");
    require(std::find(upTo192.begin(), upTo192.end(), 192000u) == upTo192.end(), "ASIO 192k pivot must not include requested rate");
}

void testAsioSampleConversion()
{
    std::vector<unsigned char> bytes(16, 0);
    asio_write_sample_for_tests(bytes.data(), ASIOSTInt16LSB, 0, 1.0f);
    require(reinterpret_cast<int16_t*>(bytes.data())[0] == 32767, "ASIO int16 LSB conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTInt16MSB, 0, 1.0f);
    require(bytes[0] == 0x7f && bytes[1] == 0xff, "ASIO int16 MSB conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTInt24LSB, 0, 1.0f);
    require(bytes[0] == 0xff && bytes[1] == 0xff && bytes[2] == 0x7f, "ASIO int24 LSB conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTInt32LSB24, 0, 1.0f);
    require(reinterpret_cast<int32_t*>(bytes.data())[0] == 0x7fffff00, "ASIO int32 LSB 24-bit aligned conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTFloat32LSB, 0, 0.5f);
    require(std::abs(reinterpret_cast<float*>(bytes.data())[0] - 0.5f) <= nearTolerance, "ASIO float32 LSB conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTFloat64LSB, 0, -0.5f);
    require(std::abs(reinterpret_cast<double*>(bytes.data())[0] + 0.5) <= nearTolerance, "ASIO float64 LSB conversion");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_sample_for_tests(bytes.data(), ASIOSTFloat32MSB, 0, 1.0f);
    require(bytes[0] == 0x3f && bytes[1] == 0x80 && bytes[2] == 0x00 && bytes[3] == 0x00, "ASIO float32 MSB conversion");

    require(std::string(asio_error_name_for_tests(ASE_InvalidMode)) == "ASE_InvalidMode", "ASIO error name helper");
}

void testAsioDopConversionMatchesStandards()
{
    std::vector<unsigned char> bytes(16, 0);
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt24LSB, 0, 0x05a1b2u);
    require(
        bytes[0] == 0xb2 && bytes[1] == 0xa1 && bytes[2] == 0x05,
        "ASIO DoP packed int24 LSB must put the marker in the most-significant byte");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt24MSB, 0, 0x05a1b2u);
    require(
        bytes[0] == 0x05 && bytes[1] == 0xa1 && bytes[2] == 0xb2,
        "ASIO DoP packed int24 MSB must put the marker in the most-significant byte");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32LSB, 0, 0x05a1b2u);
    require(
        bytes[0] == 0x00 && bytes[1] == 0xb2 && bytes[2] == 0xa1 && bytes[3] == 0x05,
        "ASIO DoP basic int32 LSB must left-align the 24-bit frame");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32MSB, 0, 0x05a1b2u);
    require(
        bytes[0] == 0x05 && bytes[1] == 0xa1 && bytes[2] == 0xb2 && bytes[3] == 0x00,
        "ASIO DoP basic int32 MSB must left-align the 24-bit frame");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32LSB24, 0, 0xfaa1b2u);
    require(
        bytes[0] == 0xb2 && bytes[1] == 0xa1 && bytes[2] == 0xfa && bytes[3] == 0xff,
        "ASIO DoP int32 LSB24 must right-align and sign-extend the 24-bit frame");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32MSB24, 0, 0xfaa1b2u);
    require(
        bytes[0] == 0xff && bytes[1] == 0xfa && bytes[2] == 0xa1 && bytes[3] == 0xb2,
        "ASIO DoP int32 MSB24 must right-align and sign-extend the 24-bit frame");
}

void testAsioNativeDsdConversion()
{
    const std::vector<uint8_t> source { 0x80, 0x01 };
    std::vector<unsigned char> bytes(16, 0);

    asio_write_native_dsd_samples_for_tests(
        bytes.data(),
        ASIOSTDSDInt8MSB1,
        16,
        source.data(),
        2,
        1,
        0,
        0);
    require(bytes[0] == 0x01 && bytes[1] == 0x80, "ASIO native DSD MSB must reverse DSF byte order");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_native_dsd_samples_for_tests(
        bytes.data(),
        ASIOSTDSDInt8LSB1,
        16,
        source.data(),
        2,
        1,
        0,
        0);
    require(bytes[0] == 0x80 && bytes[1] == 0x01, "ASIO native DSD LSB normally preserves DSF byte order");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_native_dsd_samples_for_tests(
        bytes.data(),
        ASIOSTDSDInt8LSB1,
        16,
        source.data(),
        2,
        1,
        0,
        1);
    require(bytes[0] == 0x01 && bytes[1] == 0x80, "ASIO native DSD compatibility mode must reverse packed DSF bytes");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_native_dsd_samples_for_tests(
        bytes.data(),
        ASIOSTDSDInt8NER8,
        8,
        source.data(),
        1,
        1,
        0,
        1);
    require(bytes[0] == 1 && bytes[1] == 0 && bytes[7] == 0, "ASIO native DSD NER8 expands MSB-first bits in compatibility mode");
}

void testAsioRenderGuardCatchesCallbackException()
{
    require(asio_render_guard_catches_exception_for_tests() != 0, "ASIO render guard must catch callback exceptions and write silence");
}

void testAsioUnsolicitedWindowSuppressionScope()
{
    require(
        asio_should_suppress_unsolicited_windows_for_tests("O Deus ASIO Link Pro") == 1,
        "ASIO Link Pro must suppress its unsolicited routing window");
    require(
        asio_should_suppress_unsolicited_windows_for_tests("O DEUS ASIO LINK PRO 2.4.2.0") == 1,
        "ASIO Link Pro matching must be case insensitive");
    require(
        asio_should_suppress_unsolicited_windows_for_tests("RME Fireface USB") == 0,
        "ordinary ASIO drivers must keep their native window behavior");
}
#endif

void testCleanupEmitsShutdownAckOnce()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    bool shutdownAckSent = false;
    std::ostringstream output;
    auto* oldBuffer = std::cout.rdbuf(output.rdbuf());

    cleanupHostAndAck([&] { cleanupPcmSource(source); }, [] {}, shutdownAckSent);
    cleanupHostAndAck([&] { cleanupPcmSource(source); }, [] {}, shutdownAckSent);
    std::cout.rdbuf(oldBuffer);

    require(shutdownAckSent, "cleanup must mark shutdown ack sent");
    require(output.str() == "{\"event\":\"shutdown-ack\"}\n", "cleanup must emit shutdown ack exactly once");
}

void testExplicitStopSuppressesDaemonQueueAdvance()
{
    const auto fixturePath = writeStreamingDecoderWavFixture(48000, 2, 64);
    ScopedFileRemoval removeFixture(fixturePath);
    std::atomic<bool> shutdownRequested { false };
    int continueAfterDrainCalls = 0;
    int inputEndedCalls = 0;
    AudioDaemon daemon({
        [] {},
        [&] { ++continueAfterDrainCalls; },
        [&] { ++inputEndedCalls; },
        [] {},
        [](bool) {},
        [](const float*, int frames, bool) { return frames; },
        [](const float*, int) { return true; },
        [](const float*, int, uint64_t) { return true; },
        [] { return true; },
        [](const float*, int) { return true; },
        [] {},
        [] {},
        [] { return UINT64_MAX; },
        [](uint64_t, uint64_t, double, double, double, double) { return true; },
        [](const float*, int) { return true; },
        [] {},
        [] {},
        [](uint64_t) {},
        [] { return uint64_t { 0 }; },
        [] { return uint64_t { 0 }; },
        [] { return false; },
        [] { return uint64_t { 1 }; },
        [](float) {},
        [](int outputSampleRate) { return outputSampleRate; },
    }, 48000, 1, shutdownRequested);

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
    }), "off", 1, "current"), "daemon queue snapshot is accepted");

    nlohmann::json stopResult;
    daemon.stopForTests(stopResult);
    daemon.emitEnded();

    require(stopResult.value("operationId", uint64_t { 0 }) > 0, "explicit stop creates a playback operation boundary");
    require(inputEndedCalls == 1, "explicit stop marks the source ended once");
    require(continueAfterDrainCalls == 0, "explicit stop must not autonomously open the next queued track");
}

void testNaturalEndStillAdvancesDaemonQueue()
{
    const auto fixturePath = writeStreamingDecoderWavFixture(48000, 2, 64);
    ScopedFileRemoval removeFixture(fixturePath);
    std::atomic<bool> shutdownRequested { false };
    int continueAfterDrainCalls = 0;
    AudioDaemon daemon({
        [] {},
        [&] { ++continueAfterDrainCalls; },
        [] {},
        [] {},
        [](bool) {},
        [](const float*, int frames, bool) { return frames; },
        [](const float*, int) { return true; },
        [](const float*, int, uint64_t) { return true; },
        [] { return true; },
        [](const float*, int) { return true; },
        [] {},
        [] {},
        [] { return UINT64_MAX; },
        [](uint64_t, uint64_t, double, double, double, double) { return true; },
        [](const float*, int) { return true; },
        [] {},
        [] {},
        [](uint64_t) {},
        [] { return uint64_t { 0 }; },
        [] { return uint64_t { 0 }; },
        [] { return false; },
        [] { return uint64_t { 1 }; },
        [](float) {},
        [](int outputSampleRate) { return outputSampleRate; },
    }, 48000, 1, shutdownRequested);

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
    }), "off", 1, "current"), "daemon queue snapshot is accepted");

    daemon.emitEnded();

    require(continueAfterDrainCalls == 1, "natural playback end still autonomously opens the next queued track");
    require(daemon.hasPendingQueueAdvanceForTests(), "queue advance waits for the next operation to render PCM");
    daemon.emitPosition(0, 0, false);
    require(daemon.hasPendingQueueAdvanceForTests(), "zero-frame position must not commit queue advance or audio.started");
    daemon.emitEnded();
    require(! daemon.hasPendingQueueAdvanceForTests(), "a target ending before first PCM clears the pending advance");
    nlohmann::json stopResult;
    daemon.stopForTests(stopResult);
}

void testRuntimeOutputTransitionRunsOnPumpOwner()
{
    RuntimeOutputTransitionCoordinator coordinator;
    const auto ownerThread = std::this_thread::get_id();
    std::thread::id handlerThread;
    coordinator.setHandler([&](int targetSampleRate)
    {
        handlerThread = std::this_thread::get_id();
        return RuntimeOutputTransitionResult {true, targetSampleRate, "test", {}, 0.0};
    });

    RuntimeOutputTransitionResult result;
    std::atomic<bool> completed { false };
    std::jthread requester([&]
    {
        result = coordinator.request(44100);
        completed.store(true, std::memory_order_release);
    });
    while (! completed.load(std::memory_order_acquire))
    {
        coordinator.pump();
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    require(result.success && result.actualSampleRate == 44100, "runtime transition returns the owner result");
    require(handlerThread == ownerThread, "runtime transition handler stays on the pump owner thread");
    coordinator.close();
}

void testMixedRateDaemonAdvanceReconfiguresBeforeDecode()
{
    const auto fixturePath = writeStreamingDecoderWavFixture(44100, 2, 64);
    ScopedFileRemoval removeFixture(fixturePath);
    std::atomic<bool> shutdownRequested { false };
    int transitionTarget = 0;
    int transitionCalls = 0;
    int continueAfterDrainCalls = 0;

    AudioDaemon::SourceHooks hooks;
    hooks.continueSessionAfterDrain = [&] { ++continueAfterDrainCalls; };
    hooks.markInputEnded = [] {};
    hooks.requestStop = [] {};
    hooks.setPaused = [](bool) {};
    hooks.replaceBufferedAudio = [](const float*, int frames, bool) { return frames; };
    hooks.push = [](const float*, int) { return true; };
    hooks.pushForGeneration = [](const float*, int, uint64_t) { return true; };
    hooks.generation = [] { return uint64_t { 1 }; };
    hooks.decoderSampleRateFor = [](int outputSampleRate) { return outputSampleRate; };
    hooks.reconfigureOutputSampleRate = [&](int targetSampleRate, nlohmann::json& result, std::string&)
    {
        ++transitionCalls;
        transitionTarget = targetSampleRate;
        result = {
            {"actualSampleRate", targetSampleRate},
            {"mode", "test-stop-open"},
            {"durationMs", 10.0},
        };
        return true;
    };
    hooks.strictOutputSampleRateTransition = [] { return true; };
    AudioDaemon daemon(std::move(hooks), 48000, 1, shutdownRequested);

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", "current.wav"}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 44100}},
        {{"itemId", "third"}, {"trackId", "track-third"}, {"filePath", fixturePath}, {"sampleRate", 44100}},
    }), "off", 2, "current"), "mixed-rate daemon queue snapshot is accepted");

    daemon.emitEnded();

    require(transitionTarget == 44100, "mixed-rate daemon advance reconfigures the device to the source rate");
    require(continueAfterDrainCalls == 1, "decode starts only after the output transition succeeds");
    require(daemon.hasPendingQueueAdvanceForTests(), "mixed-rate queue advance waits for rendered PCM");
    daemon.emitPosition(1, 0, false);
    require(! daemon.hasPendingQueueAdvanceForTests(), "mixed-rate queue advance commits on the first rendered PCM frame");
    daemon.emitEnded();
    require(transitionCalls == 1, "the following same-rate track does not reconfigure the device");
    require(continueAfterDrainCalls == 2, "the same-rate third track keeps the fast autonomous path");
    require(daemon.hasPendingQueueAdvanceForTests(), "the same-rate third track still waits for first rendered PCM");
    daemon.emitPosition(1, 0, false);
    require(! daemon.hasPendingQueueAdvanceForTests(), "the same-rate third track commits on rendered PCM");
    nlohmann::json stopResult;
    daemon.stopForTests(stopResult);
}

void testManualStopSupersedesMixedRateDaemonAdvance()
{
    const auto fixturePath = writeStreamingDecoderWavFixture(44100, 2, 64);
    ScopedFileRemoval removeFixture(fixturePath);
    std::atomic<bool> shutdownRequested { false };
    int continueAfterDrainCalls = 0;
    AudioDaemon* daemonOwner = nullptr;

    AudioDaemon::SourceHooks hooks;
    hooks.continueSessionAfterDrain = [&] { ++continueAfterDrainCalls; };
    hooks.markInputEnded = [] {};
    hooks.requestStop = [] {};
    hooks.setPaused = [](bool) {};
    hooks.replaceBufferedAudio = [](const float*, int frames, bool) { return frames; };
    hooks.push = [](const float*, int) { return true; };
    hooks.pushForGeneration = [](const float*, int, uint64_t) { return true; };
    hooks.generation = [] { return uint64_t { 1 }; };
    hooks.decoderSampleRateFor = [](int outputSampleRate) { return outputSampleRate; };
    hooks.reconfigureOutputSampleRate = [&](int targetSampleRate, nlohmann::json& result, std::string&)
    {
        nlohmann::json stopResult;
        daemonOwner->stopForTests(stopResult);
        result = {
            {"actualSampleRate", targetSampleRate},
            {"mode", "test-stop-open"},
            {"durationMs", 10.0},
        };
        return true;
    };
    hooks.strictOutputSampleRateTransition = [] { return true; };
    AudioDaemon daemon(std::move(hooks), 48000, 1, shutdownRequested);
    daemonOwner = &daemon;

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", "current.wav"}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 44100}},
    }), "off", 3, "current"), "mixed-rate queue is accepted before stop race");

    daemon.emitEnded();

    require(continueAfterDrainCalls == 0, "a manual stop winning the transition prevents autonomous decode");
    require(! daemon.hasPendingQueueAdvanceForTests(), "a superseded transition cannot publish queue advance");
}

void testStrictDaemonAdvanceRejectsMissingSampleRate()
{
    std::atomic<bool> shutdownRequested { false };
    int continueAfterDrainCalls = 0;
    int transitionCalls = 0;
    AudioDaemon::SourceHooks hooks;
    hooks.continueSessionAfterDrain = [&] { ++continueAfterDrainCalls; };
    hooks.markInputEnded = [] {};
    hooks.requestStop = [] {};
    hooks.setPaused = [](bool) {};
    hooks.decoderSampleRateFor = [](int outputSampleRate) { return outputSampleRate; };
    hooks.reconfigureOutputSampleRate = [&](int, nlohmann::json&, std::string&)
    {
        ++transitionCalls;
        return true;
    };
    hooks.strictOutputSampleRateTransition = [] { return true; };
    AudioDaemon daemon(std::move(hooks), 48000, 1, shutdownRequested);

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", "current.wav"}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", "missing-rate.wav"}},
    }), "off", 4, "current"), "strict queue with missing next rate is accepted as metadata");

    daemon.emitEnded();

    require(transitionCalls == 0, "missing source rate fails before any device transition");
    require(continueAfterDrainCalls == 0, "missing source rate fails before autonomous decode");
    require(! daemon.hasPendingQueueAdvanceForTests(), "missing source rate cannot publish queue advance");
}

void testQueueReplacementCancelsPendingDaemonAdvance()
{
    const auto fixturePath = writeStreamingDecoderWavFixture(48000, 2, 64);
    ScopedFileRemoval removeFixture(fixturePath);
    std::atomic<bool> shutdownRequested { false };
    int continueAfterDrainCalls = 0;
    AudioDaemon::SourceHooks hooks;
    hooks.continueSessionAfterDrain = [&] { ++continueAfterDrainCalls; };
    hooks.markInputEnded = [] {};
    hooks.requestStop = [] {};
    hooks.setPaused = [](bool) {};
    hooks.replaceBufferedAudio = [](const float*, int frames, bool) { return frames; };
    hooks.push = [](const float*, int) { return true; };
    hooks.pushForGeneration = [](const float*, int, uint64_t) { return true; };
    hooks.generation = [] { return uint64_t { 1 }; };
    hooks.decoderSampleRateFor = [](int outputSampleRate) { return outputSampleRate; };
    AudioDaemon daemon(std::move(hooks), 48000, 1, shutdownRequested);

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
    }), "off", 5, "current"), "initial queue is accepted before pending replacement");
    daemon.emitEnded();
    require(daemon.hasPendingQueueAdvanceForTests(), "natural advance arms a pending first-frame commit");

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "current"}, {"trackId", "track-current"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
        {{"itemId", "next"}, {"trackId", "track-next"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
    }), "off", 5, "current"), "same-revision retry is accepted idempotently");
    require(daemon.hasPendingQueueAdvanceForTests(), "same-revision retry preserves the pending commit");

    require(daemon.onQueueSet(nlohmann::json::array({
        {{"itemId", "replacement"}, {"trackId", "track-replacement"}, {"filePath", fixturePath}, {"sampleRate", 48000}},
    }), "off", 6, "replacement"), "replacement queue wins before first PCM");

    require(continueAfterDrainCalls == 1, "replacement occurs after exactly one autonomous open");
    require(! daemon.hasPendingQueueAdvanceForTests(), "replacement queue cancels the stale pending advance");
    daemon.emitPosition(1, 0, false);
    require(! daemon.hasPendingQueueAdvanceForTests(), "stale first PCM cannot resurrect a cancelled advance");
}

void testProtocolMessages()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    eqProcessor.prepare(48000.0, 512, 2);
    channelBalanceProcessor.prepare(48000.0, 512, 2);

    const auto gainResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-gain","band":3,"gainDb":4.5})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(gainResponse, R"("type":"eq:state")", "gain response");
    requireContains(gainResponse, R"("gainDb":4.5)", "gain response");

    const auto frequencyResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-frequency","band":3,"frequencyHz":360})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(frequencyResponse, R"("frequencyHz":360)", "frequency response");

    const auto qResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-q","band":3,"q":3.5})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(qResponse, R"("q":3.5)", "Q response");

    const auto filterResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-filter-type","band":3,"filterType":"highShelf"})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(filterResponse, R"("filterType":"highShelf")", "filter type response");

    const auto lowPassResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-filter-type","band":3,"filterType":"lowPass"})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(lowPassResponse, R"("filterType":"lowPass")", "low pass filter response");

    const auto highPassResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-filter-type","band":3,"filterType":"highPass"})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(highPassResponse, R"("filterType":"highPass")", "high pass filter response");

    const auto notchResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-filter-type","band":3,"filterType":"notch"})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(notchResponse, R"("filterType":"notch")", "notch filter response");

    const auto bypassResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-enabled","band":3,"enabled":false})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(bypassResponse, R"("enabled":false)", "band bypass response");

    const std::string presetJson =
        R"({"type":"eq:set-preset","preampDb":-2,"bands":[)"
        R"({"frequencyHz":31,"gainDb":0,"q":1.2,"filterType":"lowShelf","enabled":true},{"frequencyHz":62,"gainDb":1},{"frequencyHz":125,"gainDb":2},)"
        R"({"frequencyHz":250,"gainDb":3},{"frequencyHz":500,"gainDb":4},{"frequencyHz":1000,"gainDb":5},)"
        R"({"frequencyHz":2000,"gainDb":4},{"frequencyHz":4000,"gainDb":3},{"frequencyHz":8000,"gainDb":2},)"
        R"({"frequencyHz":16000,"gainDb":1,"q":0.5,"filterType":"highShelf","enabled":false}]})";
    const auto presetResponse = echo::EqMessageProtocol::handleJsonLine(presetJson, eqProcessor, channelBalanceProcessor);
    requireContains(presetResponse, R"("preampDb":-2)", "preset response");
    requireContains(presetResponse, R"("gainDb":5)", "preset response");
    requireContains(presetResponse, R"("filterType":"lowShelf")", "preset response");
    requireContains(presetResponse, R"("enabled":false)", "preset response");

    const auto invalidJsonResponse = echo::EqMessageProtocol::handleJsonLine("{not json", eqProcessor, channelBalanceProcessor);
    requireContains(invalidJsonResponse, R"("type":"eq:error")", "invalid json response");
    requireContains(invalidJsonResponse, "invalid_json", "invalid json response");

    const auto invalidBandResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-gain","band":99,"gainDb":2})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(invalidBandResponse, R"("type":"eq:error")", "invalid band response");
    requireContains(invalidBandResponse, "invalid_band_index", "invalid band response");

    const auto invalidPresetResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-preset","preampDb":0,"bands":[{"frequencyHz":31,"gainDb":0}]})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(invalidPresetResponse, R"("type":"eq:error")", "invalid preset response");
    requireContains(invalidPresetResponse, "invalid_preset_bands", "invalid preset response");

    const auto invalidFilterResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"eq:set-band-filter-type","band":1,"filterType":"allPass"})",
        eqProcessor,
        channelBalanceProcessor);
    requireContains(invalidFilterResponse, R"("type":"eq:error")", "invalid filter response");
    requireContains(invalidFilterResponse, "invalid_filter_type", "invalid filter response");

    echo::ConvolutionProcessor convolutionProcessor;
    convolutionProcessor.prepare(48000.0, 512, 2);
    require(convolutionProcessor.loadImpulseResponseForTests({ { 1.0f } }, 48000.0, "proto", "Protocol IR"), "protocol IR loads");
    const auto roomTrimResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"roomCorrection:set-trim","trimDb":-3.5})",
        eqProcessor,
        channelBalanceProcessor,
        convolutionProcessor);
    requireContains(roomTrimResponse, R"("type":"roomCorrection:state")", "room correction trim response");
    requireContains(roomTrimResponse, R"("trimDb":-3.5)", "room correction trim response");

    const auto roomEnableResponse = echo::EqMessageProtocol::handleJsonLine(
        R"({"type":"roomCorrection:set-enabled","enabled":true})",
        eqProcessor,
        channelBalanceProcessor,
        convolutionProcessor);
    requireContains(roomEnableResponse, R"("enabled":true)", "room correction enabled response");
    requireContains(roomEnableResponse, R"("status":"active")", "room correction active response");
}

} // namespace

int main()
{
    const std::vector<std::pair<std::string, void (*)()>> tests {
        { "disabled EQ is dry", testDisabledEqIsDry },
        { "flat enabled is transparent", testFlatEnabledIsTransparent },
        { "bypass returns to dry", testBypassReturnsToDry },
        { "rapid changes stay finite", testRapidChangesStayFinite },
        { "EQ reports risk without limiting enabled output", testEqReportsRiskWithoutLimitingEnabledOutput },
        { "coefficient updates stop in steady state", testCoefficientUpdatesStopInSteadyState },
        { "PEQ band controls clamp and bypass", testPeqBandControlsClampAndBypass },
        { "PEQ additional filter types stay finite", testPeqAdditionalFilterTypesStayFinite },
        { "FIR convolution identity is transparent", testConvolutionIdentityIsTransparent },
        { "FIR convolution delay impulse", testConvolutionDelayImpulse },
        { "FIR convolution stereo mapping", testConvolutionStereoMapping },
        { "FIR convolution rejects long IR and clips safely", testConvolutionRejectsLongImpulseAndClipsSafely },
        { "Channel balance delay compensation", testChannelBalanceDelayCompensation },
        { "Channel balance solo keeps physical side", testChannelBalanceSoloKeepsPhysicalSide },
        { "Channel balance band gain compensation", testChannelBalanceBandGainCompensation },
        { "DSP chain bypass preserves dry buffer", testDspChainBypassPreservesDryBuffer },
        { "compressor reduces hot signals and preserves bypass", testCompressorReducesHotSignalsAndPreservesBypass },
        { "spatial DSP stages process independently", testSpatialDspStagesProcessIndependently },
        { "DSP chain limiter protects active output", testDspChainLimiterProtectsActiveOutput },
        { "DSP chain limiter ignores near full-scale output", testDspChainLimiterIgnoresNearFullScaleOutput },
        { "DSP chain limiter can be bypassed", testDspChainLimiterCanBeBypassed },
        { "DSP headroom activates protection chain", testDspHeadroomActivatesProtectionChain },
        { "DSP chain protects upstream PCM processing", testDspChainProtectsUpstreamPcmProcessing },
        { "host buffer fallback attempts", testHostBufferFallbackAttempts },
        { "unsupported exclusive format skips buffer retries", testUnsupportedExclusiveFormatSkipsBufferRetries },
        { "native dither matches TypeScript golden vector", testNativeDitherMatchesTypescriptGoldenVector },
        { "native ECHO SRC matches reference convolution", testNativeEchoSrcMatchesReferenceConvolution },
        { "native ECHO SRC factor-four polyphase matches dense convolution", testNativeEchoSrcPolyphaseMatchesDenseFactorFourConvolution },
        { "native ECHO SRC is stable across decode chunks", testNativeEchoSrcIsStableAcrossDecodeChunks },
        { "native ECHO SRC flushes tail exactly once", testNativeEchoSrcFlushesTailExactlyOnce },
        { "native pipeline drains ECHO SRC tail before EOF", testNativePlaybackPipelineDrainsEchoSrcTailBeforeEof },
        { "native SDM produces deterministic protected DoP", testNativeSdmProducesDeterministicProtectedDop },
        { "native SDM profiles shape noise out of band", testNativeSdmProfilesShapeNoiseOutOfBand },
        { "native SDM high-order profiles remain bounded", testNativeSdmHighOrderProfilesRemainBounded },
        { "native SDM high-order profiles are chunk invariant", testNativeSdmHighOrderProfilesAreChunkInvariant },
        { "native SDM applies headroom and smooths transitions", testNativeSdmAppliesHeadroomAndSmoothsTransitions },
        { "native SDM idle lock preserves weak signals", testNativeSdmIdleLockPreservesWeakSignals },
        { "native processing configuration fails closed", testNativeProcessingConfigurationFailsClosed },
        { "host shared backend options", testHostSharedBackendOptions },
        { "runtime device configuration is authoritative", testRuntimeDeviceConfigurationIsAuthoritative },
        { "host backend names", testHostBackendNames },
    { "specialized outputs skip miniaudio shared output", testSpecializedOutputsSkipMiniaudioSharedOutput },
    { "specialized runHost validation before hardware open", testSpecializedRunHostValidationBeforeHardwareOpen },
    { "host prebuffer defaults remain compatible", testHostPrebufferDefaultsRemainCompatible },
        { "high-rate native DSD buffers use byte-frame scale", testHighRateNativeDsdBuffersUseByteFrameScale },
        { "explicit zero prebuffer disables wait", testExplicitZeroPrebufferDisablesWait },
        { "native FIFO wraps and resets", testNativeFifoWrapsAndResets },
        { "libav PCM stream decoder reads bounded chunks", testLibavPcmStreamDecoderReadsBoundedChunks },
        { "libav PCM stream decoder bounds damaged media recovery", testLibavPcmStreamDecoderBoundsDamagedMediaRecovery },
        { "libav PCM stream decoder maps native output format", testLibavPcmStreamDecoderMapsToNativeOutputFormat },
        { "libav PCM stream decoder decodes DSD containers to PCM", testLibavPcmStreamDecoderDecodesDsdContainersToPcm },
        { "libav PCM stream decoder seek cancel and invalid file", testLibavPcmStreamDecoderSeekCancelAndInvalidFile },
        { "PCM idle does not count underrun before PCM", testPcmIdleDoesNotCountUnderrunBeforePcm },
        { "PCM pause retains buffered frames", testPcmSourcePauseRetainsBufferedFrames },
        { "PCM input ended waits for buffered drain", testPcmInputEndedWaitsForBufferedDrain },
        { "PCM playback rate consumes source frames", testPcmSourcePlaybackRateConsumesSourceFramesAtRate },
        { "PCM playback rate bounds native dither writes", testNativeRenderPlaybackRateKeepsDitherInsideOutputBuffer },
        { "PCM replacement drops stale frames", testPcmSourceReplaceBufferedAudioDropsStaleFrames },
        { "PCM replacement stays paused until resume", testPcmSourceReplaceBufferedAudioWhilePausedWaitsForResume },
        { "PCM prebuffer avoids premature underrun", testPcmPrebufferDoesNotCountUnderrunBeforeTarget },
        { "native render adapter", testNativeRenderAdapter },
        { "PCM declick ramp", testPcmDeclickRampOnSessionStartAndStop },
        { "native automix mixes next deck", testNativeAutomixDeckMixesNextBeforeCurrentEnds },
        { "native automix applies DSP once after deck sum", testNativeAutomixAppliesUserDspOnceAfterDeckSum },
        { "native automix applies ReplayGain per deck", testNativeAutomixAppliesReplayGainPerDeckWithoutGlobalDoubleProcessing },
        { "native automix next deck respects current buffer", testNativeAutomixNextDeckCannotAdvancePastCurrentBuffer },
        { "native automix deck failure recovery", testNativeAutomixDeckFailureUsesTwentyMillisecondRecovery },
        { "native gapless joins at PCM boundary", testNativeGaplessJoinsAtDecodedPcmBoundary },
        { "DoP render keeps valid markers", testDopRenderKeepsValidMarkersDuringSilenceAndData },
#ifdef _WIN32
        { "ASIO buffer candidates", testAsioBufferCandidateGeneration },
        { "ASIO sample-rate pivots", testAsioSampleRatePivotCandidateGeneration },
        { "ASIO sample conversion", testAsioSampleConversion },
        { "ASIO DoP conversion", testAsioDopConversionMatchesStandards },
        { "ASIO native DSD conversion", testAsioNativeDsdConversion },
        { "ASIO render guard catches exceptions", testAsioRenderGuardCatchesCallbackException },
        { "ASIO unsolicited window suppression scope", testAsioUnsolicitedWindowSuppressionScope },
#endif
        { "cleanup emits shutdown ack once", testCleanupEmitsShutdownAckOnce },
        { "explicit stop suppresses daemon queue advance", testExplicitStopSuppressesDaemonQueueAdvance },
        { "natural end advances daemon queue", testNaturalEndStillAdvancesDaemonQueue },
        { "runtime output transition stays on owner", testRuntimeOutputTransitionRunsOnPumpOwner },
        { "mixed-rate daemon advance reconfigures before decode", testMixedRateDaemonAdvanceReconfiguresBeforeDecode },
        { "manual stop supersedes mixed-rate daemon advance", testManualStopSupersedesMixedRateDaemonAdvance },
        { "strict daemon advance rejects missing sample rate", testStrictDaemonAdvanceRejectsMissingSampleRate },
        { "queue replacement cancels pending daemon advance", testQueueReplacementCancelsPendingDaemonAdvance },
        { "protocol messages", testProtocolMessages },
    };

    int failures = 0;
    for (const auto& [name, test] : tests)
    {
        try
        {
            test();
            std::cout << "[PASS] " << name << std::endl;
        }
        catch (const std::exception& error)
        {
            ++failures;
            std::cerr << "[FAIL] " << name << ": " << error.what() << std::endl;
        }
        catch (...)
        {
            ++failures;
            std::cerr << "[FAIL] " << name << ": unknown error" << std::endl;
        }
    }

    return failures == 0 ? 0 : 1;
}
