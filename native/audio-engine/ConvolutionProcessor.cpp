#include "ConvolutionProcessor.h"
#include "DspSafetyLimiter.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
float dbToGain(float db)
{
    return std::pow(10.0f, db / 20.0f);
}

float readLinear(const juce::AudioBuffer<float>& buffer, int channel, double position)
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

bool isFiniteBuffer(const juce::AudioBuffer<float>& buffer)
{
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            if (! std::isfinite(buffer.getSample(channel, sample)))
                return false;

    return true;
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

void ConvolutionProcessor::processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
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
    juce::File file(juce::String::fromUTF8(path.data(), static_cast<int>(path.size())));
    if (! file.existsAsFile())
    {
        hasError.store(true, std::memory_order_release);
        errorMessage = "missing_file";
        return false;
    }

    juce::WavAudioFormat wavFormat;
    std::unique_ptr<juce::AudioFormatReader> reader(wavFormat.createReaderFor(file.createInputStream().release(), true));
    if (reader == nullptr || reader->numChannels <= 0 || reader->lengthInSamples <= 0)
    {
        hasError.store(true, std::memory_order_release);
        errorMessage = "invalid_wav";
        return false;
    }

    const int sourceChannels = std::min<int>(2, static_cast<int>(reader->numChannels));
    const double targetRate = currentSampleRate > 0.0 ? currentSampleRate : reader->sampleRate;
    const double estimatedOutputSamples = static_cast<double>(reader->lengthInSamples) * targetRate / std::max(1.0, reader->sampleRate);
    if (! std::isfinite(estimatedOutputSamples) || estimatedOutputSamples > static_cast<double>(roomCorrectionMaxTaps))
    {
        hasError.store(true, std::memory_order_release);
        errorMessage = "impulse_too_long";
        return false;
    }

    const int sourceSamples = static_cast<int>(std::min<int64_t>(reader->lengthInSamples, static_cast<int64_t>(roomCorrectionMaxTaps * 4)));
    juce::AudioBuffer<float> source(sourceChannels, sourceSamples);
    reader->read(&source, 0, sourceSamples, 0, true, sourceChannels > 1);

    auto prepared = createPreparedImpulse(source, reader->sampleRate, currentSampleRate, id, name);
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
    const juce::AudioBuffer<float>& source,
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
    juce::AudioBuffer<float> source(channels, samples);
    source.clear();
    for (int channel = 0; channel < channels; ++channel)
        for (int sample = 0; sample < std::min<int>(samples, static_cast<int>(taps[static_cast<size_t>(channel)].size())); ++sample)
            source.setSample(channel, sample, taps[static_cast<size_t>(channel)][static_cast<size_t>(sample)]);

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
