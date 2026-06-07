#include "../../audio-engine/ChannelBalanceProcessor.h"
#include "../../audio-engine/EqMessageProtocol.h"
#include "../../audio-engine/EqProcessor.h"
#include "../../audio-engine/UzumeEngine.h"

#include <juce_audio_basics/juce_audio_basics.h>

#if JUCE_WINDOWS
#include "../third_party/asio-sdk/common/asio.h"
#endif

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <sstream>
#include <string>
#include <vector>

#define ECHO_AUDIO_HOST_TESTS 1
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

void requireVectorEquals(const std::vector<int>& actual, const std::vector<int>& expected, const std::string& message)
{
    require(actual == expected, message);
}

juce::AudioBuffer<float> makeBuffer(int channels, int samples)
{
    juce::AudioBuffer<float> buffer(channels, samples);

    for (int channel = 0; channel < channels; ++channel)
    {
        auto* data = buffer.getWritePointer(channel);
        for (int sample = 0; sample < samples; ++sample)
            data[sample] = 0.15f * std::sin(static_cast<float>(sample + 1) * 0.07f + static_cast<float>(channel) * 0.31f);
    }

    return buffer;
}

void requireBuffersClose(
    const juce::AudioBuffer<float>& actual,
    const juce::AudioBuffer<float>& expected,
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

void requireFinite(const juce::AudioBuffer<float>& buffer, const std::string& message)
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

    auto buffer = makeBuffer(2, 64);
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

    juce::AudioBuffer<float> buffer(1, 4);
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

    juce::AudioBuffer<float> buffer(2, 4);
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

    juce::AudioBuffer<float> buffer(1, 4);
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

    juce::AudioBuffer<float> buffer(2, 6);
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

    juce::AudioBuffer<float> liveLeftOnlyBuffer(2, 4);
    liveLeftOnlyBuffer.clear();
    liveLeftOnlyBuffer.setSample(0, 0, 0.625f);
    liveLeftOnlyBuffer.setSample(1, 0, 0.375f);
    processor.processBlock(liveLeftOnlyBuffer, 0, liveLeftOnlyBuffer.getNumSamples());

    require(std::abs(liveLeftOnlyBuffer.getSample(0, 0) - 0.625f) <= nearTolerance, "live left solo keeps physical left immediately");
    require(std::abs(liveLeftOnlyBuffer.getSample(1, 0)) <= nearTolerance, "live left solo mutes physical right immediately");

    state.monoMode = echo::ChannelBalanceMonoMode::RightOnly;
    processor.setState(state);
    processor.reset();

    juce::AudioBuffer<float> rightOnlyBuffer(2, 4);
    rightOnlyBuffer.clear();
    rightOnlyBuffer.setSample(0, 0, 0.25f);
    rightOnlyBuffer.setSample(1, 0, 0.75f);
    processor.processBlock(rightOnlyBuffer, 0, rightOnlyBuffer.getNumSamples());

    require(std::abs(rightOnlyBuffer.getSample(0, 0)) <= nearTolerance, "right solo mutes physical left");
    require(std::abs(rightOnlyBuffer.getSample(1, 0) - 0.75f) <= nearTolerance, "right solo keeps physical right");

    state.monoMode = echo::ChannelBalanceMonoMode::LeftOnly;
    processor.setState(state);
    processor.reset();

    juce::AudioBuffer<float> leftOnlyBuffer(2, 4);
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

    juce::AudioBuffer<float> buffer(2, 4096);
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

void testUzumeEngineBypassPreservesDryBuffer()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 128, 2);

    auto buffer = makeBuffer(2, 128);
    auto dry = makeBuffer(2, 128);
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

    require(! uzumeEngine.isActive(), "inactive UZUME engine must report bypass");
    uzumeEngine.processBlock(buffer, 0, buffer.getNumSamples());
    requireBuffersClose(buffer, dry, strictTolerance, "inactive UZUME engine must not touch native playback samples");
    require(! uzumeEngine.hasClippingRisk(), "inactive UZUME engine must not report clipping risk");
    require(! uzumeEngine.isSafetyLimiterProtecting(), "inactive UZUME engine must not report limiter protection");
}

void testUzumeEngineLimiterProtectsActiveOutput()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 128, 5);
    eqProcessor.setEnabled(true);
    echo::EqProcessor referenceEqProcessor;
    referenceEqProcessor.prepare(48000.0, 128, 5);
    referenceEqProcessor.setEnabled(true);

    auto buffer = makeBuffer(5, 128);
    auto expected = makeBuffer(5, 128);
    bool expectedRisk = false;
    const auto softLimit = [&expectedRisk](float sample) {
        constexpr float threshold = 0.98f;
        constexpr float headroom = 1.0f - threshold;
        const float sanitized = std::isfinite(sample) ? sample : 0.0f;
        const float magnitude = std::abs(sanitized);
        if (magnitude <= threshold)
            return sanitized;

        expectedRisk = true;
        const float limited = threshold + headroom * std::tanh((magnitude - threshold) / headroom);
        return std::copysign(std::min(1.0f, limited), sanitized);
    };
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* samples = buffer.getWritePointer(channel);
        auto* expectedSamples = expected.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
        {
            const float value = sample % 2 == 0 ? 2.0f : -2.0f;
            samples[sample] = value;
            expectedSamples[sample] = value;
        }
    }
    referenceEqProcessor.processBlock(expected, 0, expected.getNumSamples());
    for (int channel = 0; channel < expected.getNumChannels(); ++channel)
    {
        auto* expectedSamples = expected.getWritePointer(channel);
        for (int sample = 0; sample < expected.getNumSamples(); ++sample)
            expectedSamples[sample] = softLimit(expectedSamples[sample]);
    }

    require(uzumeEngine.isActive(), "enabled EQ must activate UZUME engine");
    uzumeEngine.processBlock(buffer, 0, buffer.getNumSamples());
    require(expectedRisk, "UZUME limiter reference must mark hot test output as clipping risk");
    require(uzumeEngine.hasClippingRisk(), "active UZUME engine must report clipping risk after limiting hot output");
    require(uzumeEngine.isSafetyLimiterProtecting(), "active UZUME engine must expose safety limiter protection");

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* samples = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            require(std::abs(samples[sample] - expected.getSample(channel, sample)) <= nearTolerance, "UZUME safety limiter must match CPU soft-limit reference at channel " + std::to_string(channel) + " sample " + std::to_string(sample));
    }

    const auto status = uzumeEngine.getRuntimeStatus();
    if (status.gpuCompiled && status.gpuAvailable)
    {
        require(status.backend == std::string("hybrid-gpu-limiter"), "CUDA-enabled UZUME playback must report hybrid GPU limiter backend after GPU limiter processing");
        require(status.gpuLimiterPlaybackActive, "CUDA-enabled UZUME playback must expose active GPU limiter section telemetry after limiter processing");
        require(! status.gpuMatrixPlaybackActive, "CUDA-enabled UZUME limiter-only playback must not expose active GPU matrix section telemetry");
        require(! status.fallbackActive, "CUDA-enabled UZUME playback limiter must not report fallback after successful GPU limiter processing");
        require(status.fallbackReason == nullptr, "CUDA-enabled UZUME playback limiter must not report a fallback reason after successful GPU limiter processing");
    }
    else
    {
        require(status.backend == std::string("cpu-reference"), "UZUME playback backend must stay CPU when CUDA limiter playback is unavailable");
    }
}

void testUzumeEngineUsesGpuMatrixForStableChannelBalance()
{
    echo::ChannelBalanceState state;
    state.enabled = true;
    state.balance = 0.25f;
    state.leftGainDb = -1.0f;
    state.rightGainDb = -3.0f;
    state.swapLeftRight = true;
    state.invertRight = true;
    state.constantPower = false;

    echo::ChannelBalanceProcessor referenceProcessor;
    referenceProcessor.prepare(48000.0, 128, 3);
    referenceProcessor.setState(state);
    referenceProcessor.reset();

    juce::AudioBuffer<float> reference(3, 128);
    reference.clear();
    juce::AudioBuffer<float> processed(3, 128);
    processed.clear();
    for (int sample = 0; sample < 128; ++sample)
    {
        const float left = 0.18f * std::sin(static_cast<float>(sample) * 0.13f);
        const float right = 0.16f * std::cos(static_cast<float>(sample) * 0.17f);
        reference.setSample(0, sample, left);
        reference.setSample(1, sample, right);
        reference.setSample(2, sample, -0.05f);
        processed.setSample(0, sample, left);
        processed.setSample(1, sample, right);
        processed.setSample(2, sample, -0.05f);
    }

    referenceProcessor.processBlock(reference, 0, reference.getNumSamples());

    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 128, 3);
    channelBalanceProcessor.setState(state);
    channelBalanceProcessor.reset();

    uzumeEngine.processBlock(processed, 0, processed.getNumSamples());

    for (int channel = 0; channel < processed.getNumChannels(); ++channel)
    {
        for (int sample = 0; sample < processed.getNumSamples(); ++sample)
            require(std::abs(processed.getSample(channel, sample) - reference.getSample(channel, sample)) <= nearTolerance, "stable Channel Balance UZUME output must match CPU reference and preserve extra channels at channel " + std::to_string(channel) + " sample " + std::to_string(sample));
    }

    const auto status = uzumeEngine.getRuntimeStatus();
    if (status.gpuCompiled && status.gpuAvailable)
    {
        require(channelBalanceProcessor.didUseGpuMatrixPlayback(), "stable Channel Balance must use prepared GPU matrix playback when CUDA is available");
        require(status.backend == std::string("hybrid-gpu-matrix-limiter"), "CUDA-enabled stable Channel Balance playback must report hybrid GPU matrix and limiter backend");
        require(status.gpuMatrixPlaybackActive, "CUDA-enabled stable Channel Balance playback must expose active GPU matrix section telemetry");
        require(status.gpuLimiterPlaybackActive, "CUDA-enabled stable Channel Balance playback must expose active GPU limiter section telemetry");
        require(! status.fallbackActive, "CUDA-enabled stable Channel Balance playback must not report fallback after successful GPU matrix processing");
        require(status.fallbackReason == nullptr, "CUDA-enabled stable Channel Balance playback must not report a fallback reason after successful GPU matrix processing");
    }
    else
    {
        require(! channelBalanceProcessor.didUseGpuMatrixPlayback(), "stable Channel Balance must stay CPU when CUDA matrix playback is unavailable");
        require(status.backend == std::string("cpu-reference"), "stable Channel Balance backend must stay CPU when CUDA matrix playback is unavailable");
    }
}

void testUzumeEngineUsesGpuMatrixForStableMonoChannelBalance()
{
    struct Scenario
    {
        echo::ChannelBalanceMonoMode monoMode;
        const char* name;
    };

    const Scenario scenarios[] {
        { echo::ChannelBalanceMonoMode::SumToMono, "sum-to-mono" },
        { echo::ChannelBalanceMonoMode::LeftOnly, "left-only" },
        { echo::ChannelBalanceMonoMode::RightOnly, "right-only" },
    };

    for (const auto& scenario : scenarios)
    {
        echo::ChannelBalanceState state;
        state.enabled = true;
        state.balance = -0.2f;
        state.leftGainDb = -1.5f;
        state.rightGainDb = -2.5f;
        state.swapLeftRight = true;
        state.monoMode = scenario.monoMode;
        state.invertLeft = scenario.monoMode == echo::ChannelBalanceMonoMode::SumToMono;
        state.invertRight = scenario.monoMode == echo::ChannelBalanceMonoMode::RightOnly;
        state.constantPower = true;

        echo::ChannelBalanceProcessor referenceProcessor;
        referenceProcessor.prepare(48000.0, 96, 3);
        referenceProcessor.setState(state);
        referenceProcessor.reset();

        juce::AudioBuffer<float> reference(3, 96);
        reference.clear();
        juce::AudioBuffer<float> processed(2, 96);
        processed.clear();
        for (int sample = 0; sample < 96; ++sample)
        {
            const float left = 0.11f * std::sin(static_cast<float>(sample) * 0.19f);
            const float right = 0.09f * std::cos(static_cast<float>(sample) * 0.23f);
            reference.setSample(0, sample, left);
            reference.setSample(1, sample, right);
            reference.setSample(2, sample, 0.04f);
            processed.setSample(0, sample, left);
            processed.setSample(1, sample, right);
        }

        referenceProcessor.processBlock(reference, 0, reference.getNumSamples());

        echo::EqProcessor eqProcessor;
        echo::ConvolutionProcessor convolutionProcessor;
        echo::ChannelBalanceProcessor channelBalanceProcessor;
        echo::DspHeadroomProcessor headroomProcessor;
        echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
        uzumeEngine.prepare(48000.0, 96, 2);
        channelBalanceProcessor.setState(state);
        channelBalanceProcessor.reset();

        uzumeEngine.processBlock(processed, 0, processed.getNumSamples());

        for (int channel = 0; channel < processed.getNumChannels(); ++channel)
        {
            for (int sample = 0; sample < processed.getNumSamples(); ++sample)
                require(std::abs(processed.getSample(channel, sample) - reference.getSample(channel, sample)) <= nearTolerance, std::string("stable mono Channel Balance UZUME output must match CPU reference for ") + scenario.name + " at channel " + std::to_string(channel) + " sample " + std::to_string(sample));
        }

        const auto status = uzumeEngine.getRuntimeStatus();
        if (status.gpuCompiled && status.gpuAvailable)
        {
            require(channelBalanceProcessor.didUseGpuMatrixPlayback(), std::string("stable mono Channel Balance must use prepared GPU matrix playback for ") + scenario.name);
            require(status.backend == std::string("hybrid-gpu-matrix-limiter"), std::string("CUDA-enabled stable mono Channel Balance playback must report hybrid GPU matrix and limiter backend for ") + scenario.name);
            require(status.gpuMatrixPlaybackActive, std::string("CUDA-enabled stable mono Channel Balance playback must expose active GPU matrix section telemetry for ") + scenario.name);
            require(status.gpuLimiterPlaybackActive, std::string("CUDA-enabled stable mono Channel Balance playback must expose active GPU limiter section telemetry for ") + scenario.name);
            require(! status.fallbackActive, std::string("CUDA-enabled stable mono Channel Balance playback must not report fallback for ") + scenario.name);
            require(status.fallbackReason == nullptr, std::string("CUDA-enabled stable mono Channel Balance playback must not report a fallback reason for ") + scenario.name);
        }
        else
        {
            require(! channelBalanceProcessor.didUseGpuMatrixPlayback(), std::string("stable mono Channel Balance must stay CPU when CUDA matrix playback is unavailable for ") + scenario.name);
            require(status.backend == std::string("cpu-reference"), std::string("stable mono Channel Balance backend must stay CPU when CUDA matrix playback is unavailable for ") + scenario.name);
        }
    }
}

float cpuReferenceUzumeSanitizeSample(float sample)
{
    return std::isfinite(sample) ? sample : 0.0f;
}

float cpuReferenceUzumeSoftLimitSample(float sample, bool& risk)
{
    constexpr float threshold = 0.98f;
    constexpr float headroom = 1.0f - threshold;

    const float sanitized = cpuReferenceUzumeSanitizeSample(sample);
    const float magnitude = std::abs(sanitized);
    if (magnitude <= threshold)
        return sanitized;

    risk = true;
    const float limited = threshold + headroom * std::tanh((magnitude - threshold) / headroom);
    return std::copysign(std::min(1.0f, limited), sanitized);
}

float cpuReferenceUzumeFusedGainLimiterSample(float sample, float gain, bool& risk)
{
    return cpuReferenceUzumeSoftLimitSample(sample * gain, risk);
}

void cpuReferenceUzumeStereoMatrixLimiter(
    std::vector<float>& leftSamples,
    std::vector<float>& rightSamples,
    const echo::UzumeGpuStereoMatrix& matrix,
    bool& risk)
{
    for (size_t index = 0; index < leftSamples.size(); ++index)
    {
        const float inputLeft = cpuReferenceUzumeSanitizeSample(leftSamples[index]);
        const float inputRight = cpuReferenceUzumeSanitizeSample(rightSamples[index]);
        const float outputLeft = (inputLeft * matrix.leftToLeft + inputRight * matrix.rightToLeft) * matrix.outputGain;
        const float outputRight = (inputLeft * matrix.leftToRight + inputRight * matrix.rightToRight) * matrix.outputGain;
        leftSamples[index] = cpuReferenceUzumeSoftLimitSample(outputLeft, risk);
        rightSamples[index] = cpuReferenceUzumeSoftLimitSample(outputRight, risk);
    }
}

void cpuReferenceUzumeStereoMatrix(
    std::vector<float>& leftSamples,
    std::vector<float>& rightSamples,
    const echo::UzumeGpuStereoMatrix& matrix,
    bool& risk)
{
    for (size_t index = 0; index < leftSamples.size(); ++index)
    {
        const float inputLeft = cpuReferenceUzumeSanitizeSample(leftSamples[index]);
        const float inputRight = cpuReferenceUzumeSanitizeSample(rightSamples[index]);
        const float outputLeft = cpuReferenceUzumeSanitizeSample((inputLeft * matrix.leftToLeft + inputRight * matrix.rightToLeft) * matrix.outputGain);
        const float outputRight = cpuReferenceUzumeSanitizeSample((inputLeft * matrix.leftToRight + inputRight * matrix.rightToRight) * matrix.outputGain);
        leftSamples[index] = outputLeft;
        rightSamples[index] = outputRight;
        if (std::abs(outputLeft) > 0.98f || std::abs(outputRight) > 0.98f)
            risk = true;
    }
}

void testUzumeRuntimeStatusReportsBackend()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 128, 2);

    const auto status = uzumeEngine.getRuntimeStatus();
    require(status.profile == std::string("legacy-dsp-compat"), "UZUME MVP profile must be stable for telemetry");
    require(status.backend == std::string("cpu-reference"), "UZUME MVP playback backend must stay CPU before a GPU playback limiter processes a block");
    require(status.runtimeModel == std::string("uzume-native-engine"), "UZUME runtime model must be explicit");
    require(! status.gpuLimiterPlaybackActive, "UZUME runtime status must not report GPU limiter playback before a playback block processes");
    require(! status.gpuMatrixPlaybackActive, "UZUME runtime status must not report GPU matrix playback before a playback block processes");
    if (status.gpuAvailable)
        require(status.gpuCompiled, "available UZUME GPU backend must also report compiled CUDA support");
    if (status.gpuCufftAvailable)
    {
        require(status.gpuAvailable && status.cufftVersion > 0, "available UZUME cuFFT backend must report GPU availability and cuFFT version");
        require(status.gpuFftConvolutionPrepared, "available UZUME cuFFT backend must expose prepared playback FIR scratch telemetry after prepare");
    }
    else
    {
        require(! status.gpuFftConvolutionPrepared, "unavailable UZUME cuFFT backend must not expose prepared playback FIR scratch telemetry");
    }
    require(status.cudaRuntimeVersion >= 0, "UZUME CUDA runtime version must be non-negative");
    require(status.cufftVersion >= 0, "UZUME cuFFT version must be non-negative");
}

void testUzumeGpuSafetyLimiterMatchesCpuReference()
{
    std::vector<float> gpuSamples {
        -2.0f,
        -1.0f,
        -0.25f,
        0.0f,
        0.25f,
        0.979f,
        0.981f,
        1.0f,
        2.0f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity(),
    };
    auto cpuSamples = gpuSamples;

    bool cpuRisk = false;
    for (auto& sample : cpuSamples)
        sample = cpuReferenceUzumeSoftLimitSample(sample, cpuRisk);

    auto result = echo::processUzumeGpuSafetyLimiter(gpuSamples.data(), static_cast<int>(gpuSamples.size()));

    if (! result.processed)
    {
        require(! result.available || result.fallbackReason != nullptr, "unprocessed UZUME GPU limiter must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME GPU limiter must report available backend");
    require(result.fallbackReason == nullptr, "processed UZUME GPU limiter must not report fallback");
    require(result.clippingRisk == cpuRisk, "UZUME GPU limiter clipping risk must match CPU reference");
    require(result.streamBacked, "processed UZUME GPU limiter must use stream-backed scratch");
    require(result.pinnedHostBacked, "processed UZUME GPU limiter must use pinned host staging buffers");
    require(result.scratchCapacitySamples >= static_cast<int>(gpuSamples.size()), "processed UZUME GPU limiter must report scratch capacity");
    require(result.pinnedHostCapacitySamples >= static_cast<int>(gpuSamples.size()), "processed UZUME GPU limiter must report pinned host capacity");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "UZUME GPU limiter output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeGpuPreparedPlaybackLimiterMatchesCpuReference()
{
    auto prepareResult = echo::prepareUzumeGpuPlaybackSafetyLimiter(64);
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || prepareResult.fallbackReason != nullptr, "unprepared UZUME GPU playback limiter must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME GPU playback limiter must report available backend");
    require(prepareResult.streamBacked, "prepared UZUME GPU playback limiter must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME GPU playback limiter must use pinned host staging buffers");
    require(prepareResult.scratchCapacitySamples >= 64, "prepared UZUME GPU playback limiter must report scratch capacity");
    require(prepareResult.pinnedHostCapacitySamples >= 64, "prepared UZUME GPU playback limiter must report pinned host capacity");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackSafetyLimiter(32);
    require(secondPrepareResult.prepared, "second UZUME GPU playback limiter prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME GPU playback limiter prepare must reuse prepared scratch");
    require(secondPrepareResult.scratchCapacitySamples >= prepareResult.scratchCapacitySamples, "second UZUME GPU playback limiter prepare must keep scratch capacity");

    std::vector<float> gpuSamples {
        -2.0f,
        -0.75f,
        0.0f,
        0.75f,
        2.0f,
        std::numeric_limits<float>::quiet_NaN(),
    };
    auto cpuSamples = gpuSamples;

    bool cpuRisk = false;
    for (auto& sample : cpuSamples)
        sample = cpuReferenceUzumeSoftLimitSample(sample, cpuRisk);

    auto result = echo::processUzumeGpuPreparedPlaybackSafetyLimiter(gpuSamples.data(), static_cast<int>(gpuSamples.size()));
    require(result.processed, "prepared UZUME GPU playback limiter must process with preallocated scratch");
    require(result.clippingRisk == cpuRisk, "prepared UZUME GPU playback limiter clipping risk must match CPU reference");
    require(result.streamBacked, "prepared UZUME GPU playback limiter must process on stream-backed scratch");
    require(result.scratchReused, "prepared UZUME GPU playback limiter must reuse prepared scratch");
    require(result.pinnedHostBacked, "prepared UZUME GPU playback limiter must use pinned host staging buffers");
    require(result.fallbackReason == nullptr, "prepared UZUME GPU playback limiter must not report fallback");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "prepared UZUME GPU playback limiter output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeGpuPreparedPlaybackPlanarLimiterMatchesCpuReference()
{
    auto prepareResult = echo::prepareUzumeGpuPlaybackPlanarSafetyLimiter(64, 5);
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || prepareResult.fallbackReason != nullptr, "unprepared UZUME GPU playback planar limiter must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME GPU playback planar limiter must report available backend");
    require(prepareResult.streamBacked, "prepared UZUME GPU playback planar limiter must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME GPU playback planar limiter must use pinned host staging buffers");
    require(prepareResult.scratchCapacitySamples >= 64, "prepared UZUME GPU playback planar limiter must report sample scratch capacity");
    require(prepareResult.pinnedHostCapacitySamples >= 64, "prepared UZUME GPU playback planar limiter must report sample pinned host capacity");
    require(prepareResult.scratchCapacityChannels >= 5, "prepared UZUME GPU playback planar limiter must report channel scratch capacity");
    require(prepareResult.pinnedHostCapacityChannels >= 5, "prepared UZUME GPU playback planar limiter must report channel pinned host capacity");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackPlanarSafetyLimiter(32, 4);
    require(secondPrepareResult.prepared, "second UZUME GPU playback planar limiter prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME GPU playback planar limiter prepare must reuse prepared scratch");
    require(secondPrepareResult.scratchCapacitySamples >= prepareResult.scratchCapacitySamples, "second UZUME GPU playback planar limiter prepare must keep sample scratch capacity");
    require(secondPrepareResult.scratchCapacityChannels >= prepareResult.scratchCapacityChannels, "second UZUME GPU playback planar limiter prepare must keep channel scratch capacity");

    std::vector<std::vector<float>> gpuChannels {
        { -2.0f, -0.75f, 0.0f, 0.75f, 2.0f, std::numeric_limits<float>::quiet_NaN() },
        { 0.2f, -1.4f, std::numeric_limits<float>::infinity(), -0.3f, 0.4f, 1.2f },
        { -0.1f, -0.2f, -0.3f, -std::numeric_limits<float>::infinity(), -0.5f, -0.6f },
        { 0.979f, 0.981f, -0.982f, 0.4f, -0.4f, 0.0f },
        { 1.5f, -1.5f, 0.1f, -0.1f, 0.3f, -0.3f },
    };
    auto cpuChannels = gpuChannels;
    std::vector<float*> channelPointers;
    channelPointers.reserve(gpuChannels.size());

    bool cpuRisk = false;
    for (auto& channel : cpuChannels)
        for (auto& sample : channel)
            sample = cpuReferenceUzumeSoftLimitSample(sample, cpuRisk);
    for (auto& channel : gpuChannels)
        channelPointers.push_back(channel.data());

    auto result = echo::processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(
        channelPointers.data(),
        static_cast<int>(channelPointers.size()),
        static_cast<int>(gpuChannels.front().size()));

    require(result.processed, "prepared UZUME GPU playback planar limiter must process with preallocated scratch");
    require(result.clippingRisk == cpuRisk, "prepared UZUME GPU playback planar limiter clipping risk must match CPU reference");
    require(result.streamBacked, "prepared UZUME GPU playback planar limiter must process on stream-backed scratch");
    require(result.scratchReused, "prepared UZUME GPU playback planar limiter must reuse prepared scratch");
    require(result.pinnedHostBacked, "prepared UZUME GPU playback planar limiter must use pinned host staging buffers");
    require(result.scratchCapacitySamples >= prepareResult.scratchCapacitySamples, "prepared UZUME GPU playback planar limiter must report sample scratch capacity");
    require(result.scratchCapacityChannels >= prepareResult.scratchCapacityChannels, "prepared UZUME GPU playback planar limiter must report channel scratch capacity");
    require(result.fallbackReason == nullptr, "prepared UZUME GPU playback planar limiter must not report fallback");

    for (size_t channel = 0; channel < gpuChannels.size(); ++channel)
        for (size_t sample = 0; sample < gpuChannels[channel].size(); ++sample)
            require(std::abs(gpuChannels[channel][sample] - cpuChannels[channel][sample]) <= nearTolerance, "prepared UZUME GPU playback planar limiter output must match CPU reference at channel " + std::to_string(channel) + " sample " + std::to_string(sample));

    const int oversizedChannelCount = secondPrepareResult.scratchCapacityChannels + 1;
    std::vector<std::vector<float>> oversizedChannels(static_cast<size_t>(oversizedChannelCount), std::vector<float>(8, 0.1f));
    std::vector<float*> oversizedChannelPointers;
    oversizedChannelPointers.reserve(oversizedChannels.size());
    for (auto& channel : oversizedChannels)
        oversizedChannelPointers.push_back(channel.data());

    const auto oversizedResult = echo::processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(
        oversizedChannelPointers.data(),
        oversizedChannelCount,
        8);

    require(! oversizedResult.processed, "oversized UZUME GPU playback planar limiter must not allocate during processing");
    require(oversizedResult.available, "oversized UZUME GPU playback planar limiter must still report available backend");
    require(oversizedResult.scratchCapacitySamples == secondPrepareResult.scratchCapacitySamples, "oversized UZUME GPU playback planar limiter must keep prepared sample scratch capacity");
    require(oversizedResult.scratchCapacityChannels == secondPrepareResult.scratchCapacityChannels, "oversized UZUME GPU playback planar limiter must keep prepared channel scratch capacity");
    require(oversizedResult.fallbackReason != nullptr && std::string(oversizedResult.fallbackReason) == "cuda-playback-planar-scratch-too-small", "oversized UZUME GPU playback planar limiter must report prepared planar scratch capacity fallback");
}

void testUzumeGpuFusedGainLimiterMatchesCpuReference()
{
    constexpr float fusedGain = 1.75f;
    std::vector<float> gpuSamples {
        -0.8f,
        -0.5f,
        -0.1f,
        0.0f,
        0.1f,
        0.5f,
        0.8f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity(),
    };
    auto cpuSamples = gpuSamples;

    bool cpuRisk = false;
    for (auto& sample : cpuSamples)
        sample = cpuReferenceUzumeFusedGainLimiterSample(sample, fusedGain, cpuRisk);

    auto result = echo::processUzumeGpuFusedGainLimiter(gpuSamples.data(), static_cast<int>(gpuSamples.size()), fusedGain);

    if (! result.processed)
    {
        require(! result.available || result.fallbackReason != nullptr, "unprocessed UZUME GPU fused gain limiter must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME GPU fused gain limiter must report available backend");
    require(result.fallbackReason == nullptr, "processed UZUME GPU fused gain limiter must not report fallback");
    require(result.clippingRisk == cpuRisk, "UZUME GPU fused gain limiter clipping risk must match CPU reference");
    require(result.streamBacked, "processed UZUME GPU fused gain limiter must use stream-backed scratch");
    require(result.pinnedHostBacked, "processed UZUME GPU fused gain limiter must use pinned host staging buffers");
    require(result.scratchCapacitySamples >= static_cast<int>(gpuSamples.size()), "processed UZUME GPU fused gain limiter must report scratch capacity");
    require(result.pinnedHostCapacitySamples >= static_cast<int>(gpuSamples.size()), "processed UZUME GPU fused gain limiter must report pinned host capacity");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "UZUME GPU fused gain limiter output must match CPU reference at sample " + std::to_string(index));

    std::vector<float> secondGpuSamples { 0.2f, -0.4f, 0.6f, -0.8f };
    auto secondCpuSamples = secondGpuSamples;
    bool secondCpuRisk = false;
    for (auto& sample : secondCpuSamples)
        sample = cpuReferenceUzumeFusedGainLimiterSample(sample, fusedGain, secondCpuRisk);

    auto secondResult = echo::processUzumeGpuFusedGainLimiter(secondGpuSamples.data(), static_cast<int>(secondGpuSamples.size()), fusedGain);

    require(secondResult.processed, "second UZUME GPU fused gain limiter pass must process after first pass");
    require(secondResult.streamBacked, "second UZUME GPU fused gain limiter pass must use stream-backed scratch");
    require(secondResult.scratchReused, "second UZUME GPU fused gain limiter pass must reuse scratch buffers");
    require(secondResult.pinnedHostBacked, "second UZUME GPU fused gain limiter pass must use pinned host staging buffers");
    require(secondResult.scratchCapacitySamples >= result.scratchCapacitySamples, "second UZUME GPU fused gain limiter pass must keep scratch capacity");
    require(secondResult.pinnedHostCapacitySamples >= result.pinnedHostCapacitySamples, "second UZUME GPU fused gain limiter pass must keep pinned host capacity");
    require(secondResult.clippingRisk == secondCpuRisk, "second UZUME GPU fused gain limiter clipping risk must match CPU reference");

    for (size_t index = 0; index < secondGpuSamples.size(); ++index)
        require(std::abs(secondGpuSamples[index] - secondCpuSamples[index]) <= nearTolerance, "second UZUME GPU fused gain limiter output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeGpuStereoMatrixLimiterMatchesCpuReference()
{
    std::vector<float> gpuLeftSamples {
        -0.8f,
        -0.25f,
        0.0f,
        0.35f,
        1.1f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
    };
    std::vector<float> gpuRightSamples {
        0.5f,
        -0.5f,
        0.25f,
        -0.7f,
        -1.2f,
        -std::numeric_limits<float>::infinity(),
        std::numeric_limits<float>::quiet_NaN(),
    };
    auto cpuLeftSamples = gpuLeftSamples;
    auto cpuRightSamples = gpuRightSamples;
    const echo::UzumeGpuStereoMatrix matrix {
        0.8f,
        -0.35f,
        0.2f,
        1.1f,
        1.25f,
    };

    bool cpuRisk = false;
    cpuReferenceUzumeStereoMatrixLimiter(cpuLeftSamples, cpuRightSamples, matrix, cpuRisk);

    auto result = echo::processUzumeGpuStereoMatrixLimiter(
        gpuLeftSamples.data(),
        gpuRightSamples.data(),
        static_cast<int>(gpuLeftSamples.size()),
        matrix);

    if (! result.processed)
    {
        require(! result.available || result.fallbackReason != nullptr, "unprocessed UZUME GPU stereo matrix limiter must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME GPU stereo matrix limiter must report available backend");
    require(result.fallbackReason == nullptr, "processed UZUME GPU stereo matrix limiter must not report fallback");
    require(result.clippingRisk == cpuRisk, "UZUME GPU stereo matrix limiter clipping risk must match CPU reference");
    require(result.streamBacked, "UZUME GPU stereo matrix limiter must use stream-backed scratch");
    require(result.scratchCapacitySamples >= static_cast<int>(gpuLeftSamples.size()), "UZUME GPU stereo matrix limiter must report scratch capacity");
    require(result.pinnedHostBacked, "UZUME GPU stereo matrix limiter must use pinned host staging buffers");
    require(result.pinnedHostCapacitySamples >= static_cast<int>(gpuLeftSamples.size()), "UZUME GPU stereo matrix limiter must report pinned host capacity");

    for (size_t index = 0; index < gpuLeftSamples.size(); ++index)
    {
        require(std::abs(gpuLeftSamples[index] - cpuLeftSamples[index]) <= nearTolerance, "UZUME GPU stereo matrix limiter left output must match CPU reference at sample " + std::to_string(index));
        require(std::abs(gpuRightSamples[index] - cpuRightSamples[index]) <= nearTolerance, "UZUME GPU stereo matrix limiter right output must match CPU reference at sample " + std::to_string(index));
    }

    std::vector<float> secondGpuLeftSamples { 0.2f, -0.3f, 0.4f, -0.5f };
    std::vector<float> secondGpuRightSamples { -0.1f, 0.6f, -0.7f, 0.8f };
    auto secondCpuLeftSamples = secondGpuLeftSamples;
    auto secondCpuRightSamples = secondGpuRightSamples;
    bool secondCpuRisk = false;
    cpuReferenceUzumeStereoMatrixLimiter(secondCpuLeftSamples, secondCpuRightSamples, matrix, secondCpuRisk);

    auto secondResult = echo::processUzumeGpuStereoMatrixLimiter(
        secondGpuLeftSamples.data(),
        secondGpuRightSamples.data(),
        static_cast<int>(secondGpuLeftSamples.size()),
        matrix);

    require(secondResult.processed, "second UZUME GPU stereo matrix limiter pass must process after first pass");
    require(secondResult.streamBacked, "second UZUME GPU stereo matrix limiter pass must use stream-backed scratch");
    require(secondResult.scratchReused, "second UZUME GPU stereo matrix limiter pass must reuse scratch buffers");
    require(secondResult.scratchCapacitySamples >= result.scratchCapacitySamples, "second UZUME GPU stereo matrix limiter pass must keep scratch capacity");
    require(secondResult.pinnedHostBacked, "second UZUME GPU stereo matrix limiter pass must use pinned host staging buffers");
    require(secondResult.pinnedHostCapacitySamples >= result.pinnedHostCapacitySamples, "second UZUME GPU stereo matrix limiter pass must keep pinned host capacity");
    require(secondResult.clippingRisk == secondCpuRisk, "second UZUME GPU stereo matrix limiter clipping risk must match CPU reference");

    for (size_t index = 0; index < secondGpuLeftSamples.size(); ++index)
    {
        require(std::abs(secondGpuLeftSamples[index] - secondCpuLeftSamples[index]) <= nearTolerance, "second UZUME GPU stereo matrix limiter left output must match CPU reference at sample " + std::to_string(index));
        require(std::abs(secondGpuRightSamples[index] - secondCpuRightSamples[index]) <= nearTolerance, "second UZUME GPU stereo matrix limiter right output must match CPU reference at sample " + std::to_string(index));
    }
}

void testUzumeGpuStereoMatrixMatchesCpuReference()
{
    std::vector<float> gpuLeftSamples {
        -0.8f,
        -0.25f,
        0.0f,
        0.35f,
        1.1f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
    };
    std::vector<float> gpuRightSamples {
        0.5f,
        -0.5f,
        0.25f,
        -0.7f,
        -1.2f,
        -std::numeric_limits<float>::infinity(),
        std::numeric_limits<float>::quiet_NaN(),
    };
    auto cpuLeftSamples = gpuLeftSamples;
    auto cpuRightSamples = gpuRightSamples;
    const echo::UzumeGpuStereoMatrix matrix {
        0.8f,
        -0.35f,
        0.2f,
        1.1f,
        1.25f,
    };

    bool cpuRisk = false;
    cpuReferenceUzumeStereoMatrix(cpuLeftSamples, cpuRightSamples, matrix, cpuRisk);

    auto result = echo::processUzumeGpuStereoMatrix(
        gpuLeftSamples.data(),
        gpuRightSamples.data(),
        static_cast<int>(gpuLeftSamples.size()),
        matrix);

    if (! result.processed)
    {
        require(! result.available || result.fallbackReason != nullptr, "unprocessed UZUME GPU stereo matrix must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME GPU stereo matrix must report available backend");
    require(result.fallbackReason == nullptr, "processed UZUME GPU stereo matrix must not report fallback");
    require(result.clippingRisk == cpuRisk, "UZUME GPU stereo matrix clipping risk must match CPU reference");
    require(result.streamBacked, "UZUME GPU stereo matrix must use stream-backed scratch");
    require(result.scratchCapacitySamples >= static_cast<int>(gpuLeftSamples.size()), "UZUME GPU stereo matrix must report scratch capacity");
    require(result.pinnedHostBacked, "UZUME GPU stereo matrix must use pinned host staging buffers");
    require(result.pinnedHostCapacitySamples >= static_cast<int>(gpuLeftSamples.size()), "UZUME GPU stereo matrix must report pinned host capacity");

    for (size_t index = 0; index < gpuLeftSamples.size(); ++index)
    {
        require(std::abs(gpuLeftSamples[index] - cpuLeftSamples[index]) <= nearTolerance, "UZUME GPU stereo matrix left output must match CPU reference at sample " + std::to_string(index));
        require(std::abs(gpuRightSamples[index] - cpuRightSamples[index]) <= nearTolerance, "UZUME GPU stereo matrix right output must match CPU reference at sample " + std::to_string(index));
    }
}

void testUzumeGpuPreparedPlaybackStereoMatrixLimiterMatchesCpuReference()
{
    auto prepareResult = echo::prepareUzumeGpuPlaybackStereoMatrixLimiter(64);
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || prepareResult.fallbackReason != nullptr, "unprepared UZUME GPU playback stereo matrix limiter must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME GPU playback stereo matrix limiter must report available backend");
    require(prepareResult.streamBacked, "prepared UZUME GPU playback stereo matrix limiter must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME GPU playback stereo matrix limiter must use pinned host staging buffers");
    require(prepareResult.scratchCapacitySamples >= 64, "prepared UZUME GPU playback stereo matrix limiter must report scratch capacity");
    require(prepareResult.pinnedHostCapacitySamples >= 64, "prepared UZUME GPU playback stereo matrix limiter must report pinned host capacity");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackStereoMatrixLimiter(32);
    require(secondPrepareResult.prepared, "second UZUME GPU playback stereo matrix prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME GPU playback stereo matrix prepare must reuse prepared scratch");
    require(secondPrepareResult.scratchCapacitySamples >= prepareResult.scratchCapacitySamples, "second UZUME GPU playback stereo matrix prepare must keep scratch capacity");

    std::vector<float> gpuLeftSamples {
        -0.8f,
        -0.25f,
        0.0f,
        0.35f,
        1.1f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
    };
    std::vector<float> gpuRightSamples {
        0.5f,
        -0.5f,
        0.25f,
        -0.7f,
        -1.2f,
        -std::numeric_limits<float>::infinity(),
        std::numeric_limits<float>::quiet_NaN(),
    };
    auto cpuLeftSamples = gpuLeftSamples;
    auto cpuRightSamples = gpuRightSamples;
    const echo::UzumeGpuStereoMatrix matrix {
        0.8f,
        -0.35f,
        0.2f,
        1.1f,
        1.25f,
    };

    bool cpuRisk = false;
    cpuReferenceUzumeStereoMatrixLimiter(cpuLeftSamples, cpuRightSamples, matrix, cpuRisk);

    auto result = echo::processUzumeGpuPreparedPlaybackStereoMatrixLimiter(
        gpuLeftSamples.data(),
        gpuRightSamples.data(),
        static_cast<int>(gpuLeftSamples.size()),
        matrix);

    require(result.processed, "prepared UZUME GPU playback stereo matrix limiter must process with preallocated scratch");
    require(result.clippingRisk == cpuRisk, "prepared UZUME GPU playback stereo matrix limiter clipping risk must match CPU reference");
    require(result.streamBacked, "prepared UZUME GPU playback stereo matrix limiter must process on stream-backed scratch");
    require(result.scratchReused, "prepared UZUME GPU playback stereo matrix limiter must reuse prepared scratch");
    require(result.pinnedHostBacked, "prepared UZUME GPU playback stereo matrix limiter must use pinned host staging buffers");
    require(result.fallbackReason == nullptr, "prepared UZUME GPU playback stereo matrix limiter must not report fallback");

    for (size_t index = 0; index < gpuLeftSamples.size(); ++index)
    {
        require(std::abs(gpuLeftSamples[index] - cpuLeftSamples[index]) <= nearTolerance, "prepared UZUME GPU playback stereo matrix limiter left output must match CPU reference at sample " + std::to_string(index));
        require(std::abs(gpuRightSamples[index] - cpuRightSamples[index]) <= nearTolerance, "prepared UZUME GPU playback stereo matrix limiter right output must match CPU reference at sample " + std::to_string(index));
    }

    const int oversizedSampleCount = secondPrepareResult.scratchCapacitySamples + 1;
    std::vector<float> oversizedLeftSamples(static_cast<size_t>(oversizedSampleCount), 0.1f);
    std::vector<float> oversizedRightSamples(static_cast<size_t>(oversizedSampleCount), -0.1f);
    const auto oversizedResult = echo::processUzumeGpuPreparedPlaybackStereoMatrixLimiter(
        oversizedLeftSamples.data(),
        oversizedRightSamples.data(),
        oversizedSampleCount,
        matrix);

    require(! oversizedResult.processed, "oversized UZUME GPU playback stereo matrix limiter must not allocate during processing");
    require(oversizedResult.available, "oversized UZUME GPU playback stereo matrix limiter must still report available backend");
    require(oversizedResult.scratchCapacitySamples == secondPrepareResult.scratchCapacitySamples, "oversized UZUME GPU playback stereo matrix limiter must keep prepared scratch capacity");
    require(oversizedResult.fallbackReason != nullptr && std::string(oversizedResult.fallbackReason) == "cuda-playback-stereo-scratch-too-small", "oversized UZUME GPU playback stereo matrix limiter must report prepared scratch capacity fallback");
}

void testUzumeGpuPreparedPlaybackStereoMatrixMatchesCpuReference()
{
    auto prepareResult = echo::prepareUzumeGpuPlaybackStereoMatrixLimiter(64);
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || prepareResult.fallbackReason != nullptr, "unprepared UZUME GPU playback stereo matrix must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME GPU playback stereo matrix must report available backend");
    require(prepareResult.streamBacked, "prepared UZUME GPU playback stereo matrix must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME GPU playback stereo matrix must use pinned host staging buffers");
    require(prepareResult.scratchCapacitySamples >= 64, "prepared UZUME GPU playback stereo matrix must report scratch capacity");
    require(prepareResult.pinnedHostCapacitySamples >= 64, "prepared UZUME GPU playback stereo matrix must report pinned host capacity");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackStereoMatrixLimiter(32);
    require(secondPrepareResult.prepared, "second UZUME GPU playback stereo matrix prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME GPU playback stereo matrix prepare must reuse prepared scratch");
    require(secondPrepareResult.scratchCapacitySamples >= prepareResult.scratchCapacitySamples, "second UZUME GPU playback stereo matrix prepare must keep scratch capacity");

    std::vector<float> gpuLeftSamples {
        -0.8f,
        -0.25f,
        0.0f,
        0.35f,
        1.1f,
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
    };
    std::vector<float> gpuRightSamples {
        0.5f,
        -0.5f,
        0.25f,
        -0.7f,
        -1.2f,
        -std::numeric_limits<float>::infinity(),
        std::numeric_limits<float>::quiet_NaN(),
    };
    auto cpuLeftSamples = gpuLeftSamples;
    auto cpuRightSamples = gpuRightSamples;
    const echo::UzumeGpuStereoMatrix matrix {
        0.8f,
        -0.35f,
        0.2f,
        1.1f,
        1.25f,
    };

    bool cpuRisk = false;
    cpuReferenceUzumeStereoMatrix(cpuLeftSamples, cpuRightSamples, matrix, cpuRisk);

    auto result = echo::processUzumeGpuPreparedPlaybackStereoMatrix(
        gpuLeftSamples.data(),
        gpuRightSamples.data(),
        static_cast<int>(gpuLeftSamples.size()),
        matrix);

    require(result.processed, "prepared UZUME GPU playback stereo matrix must process with preallocated scratch");
    require(result.clippingRisk == cpuRisk, "prepared UZUME GPU playback stereo matrix clipping risk must match CPU reference");
    require(result.streamBacked, "prepared UZUME GPU playback stereo matrix must process on stream-backed scratch");
    require(result.scratchReused, "prepared UZUME GPU playback stereo matrix must reuse prepared scratch");
    require(result.pinnedHostBacked, "prepared UZUME GPU playback stereo matrix must use pinned host staging buffers");
    require(result.fallbackReason == nullptr, "prepared UZUME GPU playback stereo matrix must not report fallback");

    for (size_t index = 0; index < gpuLeftSamples.size(); ++index)
    {
        require(std::abs(gpuLeftSamples[index] - cpuLeftSamples[index]) <= nearTolerance, "prepared UZUME GPU playback stereo matrix left output must match CPU reference at sample " + std::to_string(index));
        require(std::abs(gpuRightSamples[index] - cpuRightSamples[index]) <= nearTolerance, "prepared UZUME GPU playback stereo matrix right output must match CPU reference at sample " + std::to_string(index));
    }

    const int oversizedSampleCount = secondPrepareResult.scratchCapacitySamples + 1;
    std::vector<float> oversizedLeftSamples(static_cast<size_t>(oversizedSampleCount), 0.1f);
    std::vector<float> oversizedRightSamples(static_cast<size_t>(oversizedSampleCount), -0.1f);
    const auto oversizedResult = echo::processUzumeGpuPreparedPlaybackStereoMatrix(
        oversizedLeftSamples.data(),
        oversizedRightSamples.data(),
        oversizedSampleCount,
        matrix);

    require(! oversizedResult.processed, "oversized UZUME GPU playback stereo matrix must not allocate during processing");
    require(oversizedResult.available, "oversized UZUME GPU playback stereo matrix must still report available backend");
    require(oversizedResult.scratchCapacitySamples == secondPrepareResult.scratchCapacitySamples, "oversized UZUME GPU playback stereo matrix must keep prepared scratch capacity");
    require(oversizedResult.fallbackReason != nullptr && std::string(oversizedResult.fallbackReason) == "cuda-playback-stereo-scratch-too-small", "oversized UZUME GPU playback stereo matrix must report prepared scratch capacity fallback");
}

void testUzumeGpuCufftRoundtripMatchesCpuReference()
{
    std::vector<float> gpuSamples(64, 0.0f);
    for (size_t index = 0; index < gpuSamples.size(); ++index)
        gpuSamples[index] = 0.5f * std::sin(static_cast<float>(index) * 0.37f)
            + 0.25f * std::cos(static_cast<float>(index) * 0.11f);
    const auto cpuSamples = gpuSamples;

    auto result = echo::processUzumeGpuFftRoundtrip(gpuSamples.data(), static_cast<int>(gpuSamples.size()));

    if (! result.processed)
    {
        require(! result.available || ! result.cufftAvailable || result.fallbackReason != nullptr, "unprocessed UZUME cuFFT roundtrip must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME cuFFT roundtrip must report available CUDA backend");
    require(result.cufftAvailable, "processed UZUME cuFFT roundtrip must report available cuFFT backend");
    require(result.fallbackReason == nullptr, "processed UZUME cuFFT roundtrip must not report fallback");
    require(result.maxAbsError <= nearTolerance, "UZUME cuFFT roundtrip max error must stay within tolerance");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "UZUME cuFFT roundtrip output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeGpuCufftConvolutionMatchesCpuReference()
{
    std::vector<float> gpuSamples(64, 0.0f);
    for (size_t index = 0; index < gpuSamples.size(); ++index)
        gpuSamples[index] = 0.4f * std::sin(static_cast<float>(index) * 0.29f)
            + 0.2f * std::cos(static_cast<float>(index) * 0.17f);
    const std::vector<float> impulse { 0.5f, -0.25f, 0.125f, 0.0625f, -0.03125f };
    std::vector<float> cpuSamples(gpuSamples.size(), 0.0f);

    for (size_t sample = 0; sample < cpuSamples.size(); ++sample)
    {
        float sum = 0.0f;
        for (size_t tap = 0; tap < impulse.size(); ++tap)
        {
            if (sample >= tap)
                sum += gpuSamples[sample - tap] * impulse[tap];
        }
        cpuSamples[sample] = sum;
    }

    auto result = echo::processUzumeGpuFftConvolution(
        gpuSamples.data(),
        impulse.data(),
        static_cast<int>(gpuSamples.size()),
        static_cast<int>(impulse.size()));

    if (! result.processed)
    {
        require(! result.available || ! result.cufftAvailable || result.fallbackReason != nullptr, "unprocessed UZUME cuFFT convolution must expose fallback reason");
        return;
    }

    require(result.available, "processed UZUME cuFFT convolution must report available CUDA backend");
    require(result.cufftAvailable, "processed UZUME cuFFT convolution must report available cuFFT backend");
    require(result.fftSize >= static_cast<int>(gpuSamples.size() + impulse.size() - 1), "UZUME cuFFT convolution must report padded FFT size");
    require(result.fallbackReason == nullptr, "processed UZUME cuFFT convolution must not report fallback");
    require(result.maxAbsError <= nearTolerance, "UZUME cuFFT convolution max error must stay within tolerance");
    require(result.streamBacked, "processed UZUME cuFFT convolution must use stream-backed scratch");
    require(result.scratchFftSize == result.fftSize, "processed UZUME cuFFT convolution must report scratch FFT size");
    require(result.pinnedHostBacked, "processed UZUME cuFFT convolution must use pinned host staging buffers");
    require(result.pinnedHostFftSize == result.fftSize, "processed UZUME cuFFT convolution must report pinned host FFT size");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "UZUME cuFFT convolution output must match CPU reference at sample " + std::to_string(index));

    std::vector<float> secondGpuSamples(64, 0.0f);
    for (size_t index = 0; index < secondGpuSamples.size(); ++index)
        secondGpuSamples[index] = 0.3f * std::sin(static_cast<float>(index) * 0.19f)
            - 0.1f * std::cos(static_cast<float>(index) * 0.41f);
    std::vector<float> secondCpuSamples(secondGpuSamples.size(), 0.0f);
    for (size_t sample = 0; sample < secondCpuSamples.size(); ++sample)
    {
        float sum = 0.0f;
        for (size_t tap = 0; tap < impulse.size(); ++tap)
        {
            if (sample >= tap)
                sum += secondGpuSamples[sample - tap] * impulse[tap];
        }
        secondCpuSamples[sample] = sum;
    }

    auto secondResult = echo::processUzumeGpuFftConvolution(
        secondGpuSamples.data(),
        impulse.data(),
        static_cast<int>(secondGpuSamples.size()),
        static_cast<int>(impulse.size()));

    require(secondResult.processed, "second UZUME cuFFT convolution pass must process after first pass");
    require(secondResult.streamBacked, "second UZUME cuFFT convolution pass must use stream-backed scratch");
    require(secondResult.scratchReused, "second UZUME cuFFT convolution pass must reuse scratch buffers");
    require(secondResult.planReused, "second UZUME cuFFT convolution pass must reuse cuFFT plans");
    require(secondResult.scratchFftSize == result.scratchFftSize, "second UZUME cuFFT convolution pass must keep scratch FFT size");
    require(secondResult.pinnedHostBacked, "second UZUME cuFFT convolution pass must use pinned host staging buffers");
    require(secondResult.pinnedHostFftSize == result.pinnedHostFftSize, "second UZUME cuFFT convolution pass must keep pinned host FFT size");
    require(secondResult.maxAbsError <= nearTolerance, "second UZUME cuFFT convolution max error must stay within tolerance");

    for (size_t index = 0; index < secondGpuSamples.size(); ++index)
        require(std::abs(secondGpuSamples[index] - secondCpuSamples[index]) <= nearTolerance, "second UZUME cuFFT convolution output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeGpuPreparedPlaybackFftConvolutionMatchesCpuReference()
{
    const std::vector<float> impulse { 0.5f, -0.25f, 0.125f, 0.0625f, -0.03125f };
    auto prepareResult = echo::prepareUzumeGpuPlaybackFftConvolution(64, static_cast<int>(impulse.size()));
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || ! prepareResult.cufftAvailable || prepareResult.fallbackReason != nullptr, "unprepared UZUME playback cuFFT convolution must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME playback cuFFT convolution must report available CUDA backend");
    require(prepareResult.cufftAvailable, "prepared UZUME playback cuFFT convolution must report available cuFFT backend");
    require(prepareResult.streamBacked, "prepared UZUME playback cuFFT convolution must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME playback cuFFT convolution must use pinned host staging buffers");
    require(prepareResult.fftSize >= static_cast<int>(64 + impulse.size() - 1), "prepared UZUME playback cuFFT convolution must report padded FFT size");
    require(prepareResult.scratchFftSize == prepareResult.fftSize, "prepared UZUME playback cuFFT convolution must report scratch FFT size");
    require(prepareResult.pinnedHostFftSize == prepareResult.fftSize, "prepared UZUME playback cuFFT convolution must report pinned host FFT size");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackFftConvolution(61, static_cast<int>(impulse.size()));
    require(secondPrepareResult.prepared, "second UZUME playback cuFFT convolution prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME playback cuFFT convolution prepare must reuse scratch for same FFT size");
    require(secondPrepareResult.planReused, "second UZUME playback cuFFT convolution prepare must reuse cuFFT plans for same FFT size");

    std::vector<float> gpuSamples(64, 0.0f);
    for (size_t index = 0; index < gpuSamples.size(); ++index)
        gpuSamples[index] = 0.35f * std::sin(static_cast<float>(index) * 0.23f)
            + 0.15f * std::cos(static_cast<float>(index) * 0.13f);
    std::vector<float> cpuSamples(gpuSamples.size(), 0.0f);

    for (size_t sample = 0; sample < cpuSamples.size(); ++sample)
    {
        float sum = 0.0f;
        for (size_t tap = 0; tap < impulse.size(); ++tap)
        {
            if (sample >= tap)
                sum += gpuSamples[sample - tap] * impulse[tap];
        }
        cpuSamples[sample] = sum;
    }

    auto result = echo::processUzumeGpuPreparedPlaybackFftConvolution(
        gpuSamples.data(),
        impulse.data(),
        static_cast<int>(gpuSamples.size()),
        static_cast<int>(impulse.size()));

    require(result.processed, "prepared UZUME playback cuFFT convolution must process with preallocated scratch");
    require(result.streamBacked, "prepared UZUME playback cuFFT convolution must process on stream-backed scratch");
    require(result.scratchReused, "prepared UZUME playback cuFFT convolution must reuse prepared scratch");
    require(result.planReused, "prepared UZUME playback cuFFT convolution must reuse prepared cuFFT plans");
    require(result.pinnedHostBacked, "prepared UZUME playback cuFFT convolution must use pinned host staging buffers");
    require(result.scratchFftSize == prepareResult.scratchFftSize, "prepared UZUME playback cuFFT convolution must keep scratch FFT size");
    require(result.pinnedHostFftSize == prepareResult.pinnedHostFftSize, "prepared UZUME playback cuFFT convolution must keep pinned host FFT size");
    require(result.fallbackReason == nullptr, "prepared UZUME playback cuFFT convolution must not report fallback");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "prepared UZUME playback cuFFT convolution output must match CPU reference at sample " + std::to_string(index));

    const int oversizedSampleCount = prepareResult.scratchFftSize;
    std::vector<float> oversizedSamples(static_cast<size_t>(oversizedSampleCount), 0.1f);
    const auto oversizedResult = echo::processUzumeGpuPreparedPlaybackFftConvolution(
        oversizedSamples.data(),
        impulse.data(),
        oversizedSampleCount,
        static_cast<int>(impulse.size()));

    require(! oversizedResult.processed, "oversized UZUME playback cuFFT convolution must not allocate during processing");
    require(oversizedResult.available, "oversized UZUME playback cuFFT convolution must still report available CUDA backend");
    require(oversizedResult.cufftAvailable, "oversized UZUME playback cuFFT convolution must still report available cuFFT backend");
    require(oversizedResult.fftSize > prepareResult.scratchFftSize, "oversized UZUME playback cuFFT convolution must require larger FFT than prepared");
    require(oversizedResult.scratchFftSize == prepareResult.scratchFftSize, "oversized UZUME playback cuFFT convolution must keep prepared scratch FFT size");
    require(oversizedResult.fallbackReason != nullptr && std::string(oversizedResult.fallbackReason) == "cuda-playback-fft-scratch-too-small", "oversized UZUME playback cuFFT convolution must report prepared FFT capacity fallback");
}

void testUzumeGpuPreparedPlaybackStreamingFftConvolutionKeepsHistory()
{
    const std::vector<float> impulse { 0.5f, -0.25f, 0.125f, 0.0625f, -0.03125f };
    auto prepareResult = echo::prepareUzumeGpuPlaybackStreamingFftConvolution(32, static_cast<int>(impulse.size()));
    if (! prepareResult.prepared)
    {
        require(! prepareResult.available || ! prepareResult.cufftAvailable || prepareResult.fallbackReason != nullptr, "unprepared UZUME streaming playback cuFFT convolution must expose fallback reason");
        return;
    }

    require(prepareResult.available, "prepared UZUME streaming playback cuFFT convolution must report available CUDA backend");
    require(prepareResult.cufftAvailable, "prepared UZUME streaming playback cuFFT convolution must report available cuFFT backend");
    require(prepareResult.streamBacked, "prepared UZUME streaming playback cuFFT convolution must use stream-backed scratch");
    require(prepareResult.pinnedHostBacked, "prepared UZUME streaming playback cuFFT convolution must use pinned host staging buffers");
    require(prepareResult.fftSize >= static_cast<int>(32 + 2 * impulse.size() - 2), "prepared UZUME streaming playback cuFFT convolution must cover history-padded FFT size");
    require(prepareResult.scratchFftSize >= prepareResult.fftSize, "prepared UZUME streaming playback cuFFT convolution must report sufficient scratch FFT size");

    const auto secondPrepareResult = echo::prepareUzumeGpuPlaybackStreamingFftConvolution(24, static_cast<int>(impulse.size()));
    require(secondPrepareResult.prepared, "second UZUME streaming playback cuFFT convolution prepare must succeed");
    require(secondPrepareResult.scratchReused, "second UZUME streaming playback cuFFT convolution prepare must reuse scratch for same FFT size");
    require(secondPrepareResult.planReused, "second UZUME streaming playback cuFFT convolution prepare must reuse cuFFT plans for same FFT size");

    std::vector<float> firstBlock(16, 0.0f);
    std::vector<float> secondBlock(16, 0.0f);
    for (size_t index = 0; index < firstBlock.size(); ++index)
        firstBlock[index] = 0.35f * std::sin(static_cast<float>(index) * 0.23f)
            + 0.15f * std::cos(static_cast<float>(index) * 0.13f);
    for (size_t index = 0; index < secondBlock.size(); ++index)
        secondBlock[index] = 0.25f * std::sin(static_cast<float>(index + firstBlock.size()) * 0.17f)
            - 0.1f * std::cos(static_cast<float>(index) * 0.31f);

    std::vector<float> cpuInput;
    cpuInput.reserve(firstBlock.size() + secondBlock.size());
    cpuInput.insert(cpuInput.end(), firstBlock.begin(), firstBlock.end());
    cpuInput.insert(cpuInput.end(), secondBlock.begin(), secondBlock.end());
    std::vector<float> cpuOutput(cpuInput.size(), 0.0f);
    for (size_t sample = 0; sample < cpuOutput.size(); ++sample)
    {
        float sum = 0.0f;
        for (size_t tap = 0; tap < impulse.size(); ++tap)
        {
            if (sample >= tap)
                sum += cpuInput[sample - tap] * impulse[tap];
        }
        cpuOutput[sample] = sum;
    }

    auto gpuFirstBlock = firstBlock;
    auto gpuSecondBlock = secondBlock;
    echo::resetUzumeGpuPlaybackStreamingFftConvolution();
    auto firstResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        gpuFirstBlock.data(),
        impulse.data(),
        static_cast<int>(gpuFirstBlock.size()),
        static_cast<int>(impulse.size()));
    auto secondResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        gpuSecondBlock.data(),
        impulse.data(),
        static_cast<int>(gpuSecondBlock.size()),
        static_cast<int>(impulse.size()));

    require(firstResult.processed, "first UZUME streaming playback cuFFT convolution block must process with preallocated scratch");
    require(secondResult.processed, "second UZUME streaming playback cuFFT convolution block must process with preserved history");
    require(firstResult.streamBacked && secondResult.streamBacked, "UZUME streaming playback cuFFT convolution must process on stream-backed scratch");
    require(firstResult.scratchReused && secondResult.scratchReused, "UZUME streaming playback cuFFT convolution must reuse prepared scratch");
    require(firstResult.planReused && secondResult.planReused, "UZUME streaming playback cuFFT convolution must reuse prepared cuFFT plans");
    require(firstResult.pinnedHostBacked && secondResult.pinnedHostBacked, "UZUME streaming playback cuFFT convolution must use pinned host staging buffers");
    require(secondResult.fallbackReason == nullptr, "second UZUME streaming playback cuFFT convolution must not report fallback");

    for (size_t index = 0; index < gpuFirstBlock.size(); ++index)
        require(std::abs(gpuFirstBlock[index] - cpuOutput[index]) <= nearTolerance, "first UZUME streaming playback cuFFT convolution block must match CPU reference at sample " + std::to_string(index));
    for (size_t index = 0; index < gpuSecondBlock.size(); ++index)
        require(std::abs(gpuSecondBlock[index] - cpuOutput[firstBlock.size() + index]) <= nearTolerance, "second UZUME streaming playback cuFFT convolution block must include previous block history at sample " + std::to_string(index));

    echo::resetUzumeGpuPlaybackStreamingFftConvolution();
    auto resetBlock = secondBlock;
    auto resetResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        resetBlock.data(),
        impulse.data(),
        static_cast<int>(resetBlock.size()),
        static_cast<int>(impulse.size()));
    require(resetResult.processed, "reset UZUME streaming playback cuFFT convolution block must process after history reset");
    require(std::abs(resetBlock[0] - secondBlock[0] * impulse[0]) <= nearTolerance, "reset UZUME streaming playback cuFFT convolution must clear previous block history");

    const int oversizedSampleCount = prepareResult.scratchFftSize;
    std::vector<float> oversizedSamples(static_cast<size_t>(oversizedSampleCount), 0.1f);
    const auto oversizedResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        oversizedSamples.data(),
        impulse.data(),
        oversizedSampleCount,
        static_cast<int>(impulse.size()));

    require(! oversizedResult.processed, "oversized UZUME streaming playback cuFFT convolution must not allocate during processing");
    require(oversizedResult.available, "oversized UZUME streaming playback cuFFT convolution must still report available CUDA backend");
    require(oversizedResult.cufftAvailable, "oversized UZUME streaming playback cuFFT convolution must still report available cuFFT backend");
    require(oversizedResult.scratchFftSize == prepareResult.scratchFftSize, "oversized UZUME streaming playback cuFFT convolution must keep prepared scratch FFT size");
    require(oversizedResult.fallbackReason != nullptr && std::string(oversizedResult.fallbackReason) == "cuda-playback-streaming-fft-scratch-too-small", "oversized UZUME streaming playback cuFFT convolution must report prepared streaming FFT capacity fallback");
}

void testUzumeEnginePreparePrewarmsGpuFftConvolutionScratch()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 64, 2);

    std::vector<float> gpuSamples(64, 0.0f);
    for (size_t index = 0; index < gpuSamples.size(); ++index)
        gpuSamples[index] = 0.25f * std::sin(static_cast<float>(index) * 0.11f);
    const auto cpuSamples = gpuSamples;
    std::vector<float> impulse(static_cast<size_t>(echo::roomCorrectionMaxTaps), 0.0f);
    impulse[0] = 1.0f;

    const auto result = echo::processUzumeGpuPreparedPlaybackFftConvolution(
        gpuSamples.data(),
        impulse.data(),
        static_cast<int>(gpuSamples.size()),
        static_cast<int>(impulse.size()));

    if (! result.processed)
    {
        require(! result.available || ! result.cufftAvailable || result.fallbackReason != nullptr, "unprocessed UZUME engine-prepared playback cuFFT convolution must expose fallback reason");
        return;
    }

    require(result.streamBacked, "UZUME engine prepare must prewarm stream-backed playback cuFFT convolution scratch");
    require(result.scratchReused, "UZUME engine prepare must allow playback cuFFT convolution process to reuse scratch");
    require(result.planReused, "UZUME engine prepare must allow playback cuFFT convolution process to reuse cuFFT plans");
    require(result.pinnedHostBacked, "UZUME engine prepare must prewarm playback cuFFT convolution pinned staging");
    require(result.scratchFftSize >= echo::roomCorrectionMaxTaps + static_cast<int>(gpuSamples.size()) - 1, "UZUME engine prepare must cover max room correction tap capacity");
    require(result.fallbackReason == nullptr, "UZUME engine-prepared playback cuFFT convolution must not report fallback");

    for (size_t index = 0; index < gpuSamples.size(); ++index)
        require(std::abs(gpuSamples[index] - cpuSamples[index]) <= nearTolerance, "UZUME engine-prepared playback cuFFT identity convolution output must match CPU reference at sample " + std::to_string(index));
}

void testUzumeEnginePreparePrewarmsGpuStreamingFftConvolutionScratch()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 64, 2);

    const std::vector<float> impulse { 0.5f, -0.25f, 0.125f };
    std::vector<float> firstBlock(64, 0.0f);
    std::vector<float> secondBlock(64, 0.0f);
    for (size_t index = 0; index < firstBlock.size(); ++index)
        firstBlock[index] = 0.35f * std::sin(static_cast<float>(index) * 0.19f)
            + 0.05f * std::cos(static_cast<float>(index) * 0.07f);
    for (size_t index = 0; index < secondBlock.size(); ++index)
        secondBlock[index] = -0.2f * std::sin(static_cast<float>(index + firstBlock.size()) * 0.13f)
            + 0.15f * std::cos(static_cast<float>(index) * 0.17f);

    std::vector<float> cpuInput;
    cpuInput.reserve(firstBlock.size() + secondBlock.size());
    cpuInput.insert(cpuInput.end(), firstBlock.begin(), firstBlock.end());
    cpuInput.insert(cpuInput.end(), secondBlock.begin(), secondBlock.end());
    std::vector<float> cpuOutput(cpuInput.size(), 0.0f);
    for (size_t sample = 0; sample < cpuOutput.size(); ++sample)
    {
        float sum = 0.0f;
        for (size_t tap = 0; tap < impulse.size(); ++tap)
        {
            if (sample >= tap)
                sum += cpuInput[sample - tap] * impulse[tap];
        }
        cpuOutput[sample] = sum;
    }

    auto gpuFirstBlock = firstBlock;
    auto gpuSecondBlock = secondBlock;
    auto firstResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        gpuFirstBlock.data(),
        impulse.data(),
        static_cast<int>(gpuFirstBlock.size()),
        static_cast<int>(impulse.size()));

    if (! firstResult.processed)
    {
        require(! firstResult.available || ! firstResult.cufftAvailable || firstResult.fallbackReason != nullptr, "unprocessed UZUME engine-prepared streaming playback cuFFT convolution must expose fallback reason");
        return;
    }

    auto secondResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        gpuSecondBlock.data(),
        impulse.data(),
        static_cast<int>(gpuSecondBlock.size()),
        static_cast<int>(impulse.size()));

    require(firstResult.streamBacked && secondResult.streamBacked, "UZUME engine prepare must prewarm stream-backed streaming playback cuFFT convolution scratch");
    require(firstResult.scratchReused && secondResult.scratchReused, "UZUME engine prepare must allow streaming playback cuFFT convolution process to reuse scratch");
    require(firstResult.planReused && secondResult.planReused, "UZUME engine prepare must allow streaming playback cuFFT convolution process to reuse cuFFT plans");
    require(firstResult.pinnedHostBacked && secondResult.pinnedHostBacked, "UZUME engine prepare must prewarm streaming playback cuFFT convolution pinned staging");
    require(firstResult.scratchFftSize >= static_cast<int>(gpuFirstBlock.size()) + 2 * echo::roomCorrectionMaxTaps - 2, "UZUME engine prepare must cover max streaming room correction tap capacity");
    require(firstResult.fallbackReason == nullptr && secondResult.fallbackReason == nullptr, "UZUME engine-prepared streaming playback cuFFT convolution must not report fallback");

    for (size_t index = 0; index < gpuFirstBlock.size(); ++index)
        require(std::abs(gpuFirstBlock[index] - cpuOutput[index]) <= nearTolerance, "UZUME engine-prepared streaming playback cuFFT first block must match CPU reference at sample " + std::to_string(index));
    for (size_t index = 0; index < gpuSecondBlock.size(); ++index)
        require(std::abs(gpuSecondBlock[index] - cpuOutput[firstBlock.size() + index]) <= nearTolerance, "UZUME engine-prepared streaming playback cuFFT second block must include history at sample " + std::to_string(index));

    uzumeEngine.reset();
    auto resetBlock = secondBlock;
    const auto resetResult = echo::processUzumeGpuPreparedPlaybackStreamingFftConvolution(
        resetBlock.data(),
        impulse.data(),
        static_cast<int>(resetBlock.size()),
        static_cast<int>(impulse.size()));
    require(resetResult.processed, "UZUME engine reset must leave prepared streaming playback cuFFT scratch usable");
    require(resetResult.scratchReused, "UZUME engine reset must not force streaming playback cuFFT scratch allocation");
    require(std::abs(resetBlock[0] - secondBlock[0] * impulse[0]) <= nearTolerance, "UZUME engine reset must clear streaming playback cuFFT history");
}

void testDspChainLimiterIgnoresNearFullScaleOutput()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::DspChain dspChain(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    dspChain.prepare(48000.0, 128, 2);
    eqProcessor.setEnabled(true);

    auto buffer = makeBuffer(2, 128);
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
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::DspChain dspChain(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    dspChain.prepare(48000.0, 128, 2);
    eqProcessor.setEnabled(true);

    auto buffer = makeBuffer(2, 128);
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

void testDspHeadroomOnlyAppliesToActiveDsp()
{
    echo::DspChain::setSafetyLimiterEnabled(true);
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::UzumeEngine uzumeEngine(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    uzumeEngine.prepare(48000.0, 128, 2);
    headroomProcessor.setHeadroomDb(-6.0f);

    auto bypassed = makeBuffer(2, 128);
    bypassed.clear();
    bypassed.setSample(0, 0, 0.5f);
    bypassed.setSample(1, 0, -0.5f);
    uzumeEngine.processBlock(bypassed, 0, bypassed.getNumSamples());
    require(std::abs(bypassed.getSample(0, 0) - 0.5f) <= strictTolerance, "DSP headroom must not affect native bypass");
    require(std::abs(bypassed.getSample(1, 0) + 0.5f) <= strictTolerance, "DSP headroom must preserve bypass polarity");

    eqProcessor.setEnabled(true);
    auto processed = makeBuffer(2, 128);
    processed.clear();
    processed.setSample(0, 0, 0.5f);
    processed.setSample(1, 0, -0.5f);
    uzumeEngine.processBlock(processed, 0, processed.getNumSamples());

    require(std::abs(processed.getSample(0, 0)) < 0.5f, "DSP headroom must attenuate active DSP output");
    require(std::abs(processed.getSample(1, 0)) < 0.5f, "DSP headroom must attenuate active DSP output on all channels");
}

void testDisabledEqIsDry()
{
    echo::EqProcessor processor;
    processor.prepare(48000.0, 512, 2);
    processor.setBandGainDb(2, 12.0f);
    processor.setPreampDb(6.0f);

    auto buffer = makeBuffer(2, 512);
    auto dry = buffer;
    processor.processBlock(buffer, 0, buffer.getNumSamples());

    requireBuffersClose(buffer, dry, strictTolerance, "disabled EQ must be dry");
}

void testFlatEnabledIsTransparent()
{
    echo::EqProcessor processor;
    processor.prepare(44100.0, 1024, 2);
    processor.setEnabled(true);

    auto buffer = makeBuffer(2, 1024);
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

    auto warmup = makeBuffer(2, 4096);
    processor.processBlock(warmup, 0, warmup.getNumSamples());

    processor.setEnabled(false);
    auto fadeOut = makeBuffer(2, 4096);
    processor.processBlock(fadeOut, 0, fadeOut.getNumSamples());

    auto buffer = makeBuffer(2, 1024);
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

            auto buffer = makeBuffer(2, 512);
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

    juce::AudioBuffer<float> buffer(2, 4096);
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
    auto stable = makeBuffer(2, 512);
    processor.processBlock(stable, 0, stable.getNumSamples());
    require(processor.getCoefficientUpdateCountForTests() == initialUpdates, "steady disabled EQ must not recalculate coefficients");

    processor.setEnabled(true);
    auto enabledStable = makeBuffer(2, 512);
    processor.processBlock(enabledStable, 0, enabledStable.getNumSamples());
    require(processor.getCoefficientUpdateCountForTests() == initialUpdates, "steady flat EQ must not recalculate coefficients");

    processor.setBandGainDb(4, 6.0f);
    auto transition = makeBuffer(2, 4096);
    processor.processBlock(transition, 0, transition.getNumSamples());
    const auto afterTransitionUpdates = processor.getCoefficientUpdateCountForTests();
    require(afterTransitionUpdates > initialUpdates, "changed band must recalculate coefficients while smoothing");

    auto postTransition = makeBuffer(2, 4096);
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

    auto shaped = makeBuffer(2, 4096);
    processor.processBlock(shaped, 0, shaped.getNumSamples());
    requireFinite(shaped, "low shelf PEQ output must stay finite");

    processor.setBandEnabled(0, false);
    auto warmup = makeBuffer(2, 4096);
    processor.processBlock(warmup, 0, warmup.getNumSamples());
    auto bypassed = makeBuffer(2, 4096);
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

        auto buffer = makeBuffer(2, 4096);
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
    requireVectorEquals(buildBufferSizeAttempts(asio), { 256, 512, 1024, 2048, 4096, 8192 }, "ASIO buffer fallback chain");

    const auto balanced = parseOptions({ "echo-audio-host", "-exclusive", "-buffer", "2048" });
    requireVectorEquals(buildBufferSizeAttempts(balanced), { 2048, 4096, 8192 }, "exclusive requested buffer fallback chain");
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
#if JUCE_WINDOWS
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

void testHostBackendNames()
{
    const auto shared = parseOptions({ "echo-audio-host" });
#if JUCE_WINDOWS
    require(getBackendName(shared, "Windows Audio") == "wasapi-shared", "Windows Audio shared backend name");
    require(getBackendName(shared, "DirectSound") == "directsound-shared", "DirectSound shared backend name");
    require(getBackendImplName(shared, "DirectSound") == "juce-directsound-shared", "DirectSound backend implementation name");
#else
    require(getBackendName(shared, "ALSA") == "alsa-shared", "ALSA shared backend name");
    require(getBackendImplName(shared, "ALSA") == "juce-alsa-shared", "ALSA backend implementation name");
    require(getBackendName(shared, "JACK") == "jack-shared", "JACK shared backend name");
    require(getBackendName(shared, "PulseAudio") == "linux-shared", "generic Linux shared backend name");
#endif

    const auto exclusive = parseOptions({ "echo-audio-host", "-exclusive" });
    require(getBackendName(exclusive, "Windows Audio (Exclusive Mode)") == "wasapi-exclusive", "exclusive backend name");

    const auto asio = parseOptions({ "echo-audio-host", "-asio" });
    require(getBackendName(asio, "ASIO") == "asio", "ASIO backend name");
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

StdinFrameHeader makeFrame(StdinFrameType type, uint32_t sessionId, uint32_t payloadBytes = 0)
{
    StdinFrameHeader header;
    header.type = static_cast<uint8_t>(type);
    header.sessionId = sessionId;
    header.payloadBytes = payloadBytes;
    return header;
}

void testFramedStdinSessionResetAndLatePcmDrop()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    std::atomic<bool> shutdownRequested { false };
    uint32_t currentSessionId = 0;
    bool hasSession = false;
    std::vector<char> pending;
    std::vector<char> pendingAutomix;
    const auto payload = makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f });

    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::BeginSession, 1),
        {});
    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::PcmF32Le, 1, static_cast<uint32_t>(payload.size())),
        payload);
    require(source.getReadyFrames() == 2, "current session PCM must enter FIFO");

    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::BeginSession, 2),
        {});
    require(source.getReadyFrames() == 0, "begin-session must clear FIFO");
    require(source.getFramesPlayed() == 0, "begin-session must reset position");

    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::PcmF32Le, 1, static_cast<uint32_t>(payload.size())),
        payload);
    require(source.getReadyFrames() == 0, "late PCM from old session must be ignored");

    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::EndSession, 2),
        {});
    require(source.isDrained(), "end-session must mark empty FIFO drained");
    require(! shutdownRequested.load(), "end-session must not request host shutdown");
}

void testFramedStdinIdleDoesNotCountUnderrunBeforePcm()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    juce::AudioSourceChannelInfo info(&output, 0, 16);
    const auto payload = makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f });

    source.beginSession();
    source.getNextAudioBlock(info);
    require(source.getUnderrunCallbacks() == 0, "idle session before first PCM must not count underruns");
    require(source.getUnderrunFrames() == 0, "idle session before first PCM must not count underrun frames");

    std::vector<char> pending;
    pushPcmPayload(source, 2, pending, payload);
    source.getNextAudioBlock(info);
    require(source.getUnderrunCallbacks() > 0, "session must count underruns after PCM has started");
}

void testFramedStdinPrebufferDoesNotCountUnderrunBeforeTarget()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 64, 5000, 1.0f, eqProcessor, channelBalanceProcessor);
    auto output = makeBuffer(2, 16);
    juce::AudioSourceChannelInfo info(&output, 0, 16);
    std::vector<char> pending;

    source.beginSession();
    pushPcmPayload(source, 2, pending, makePcmPayload({ 0.1f, 0.2f, 0.3f, 0.4f }));
    source.getNextAudioBlock(info);
    require(source.getFramesPlayed() == 0, "prebuffering framed session must not consume early PCM");
    require(source.getReadyFrames() == 2, "prebuffering framed session must retain early PCM");
    require(source.getUnderrunCallbacks() == 0, "prebuffering framed session must not count underruns before target");

    std::vector<float> samples(128, 0.15f);
    pushPcmPayload(source, 2, pending, makePcmPayload(samples));
    source.getNextAudioBlock(info);
    require(source.getFramesPlayed() > 0, "framed session must start after the prebuffer target is reached");
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

void testDopRenderKeepsValidMarkersDuringSilenceAndData()
{
    DopRingSource source(2, 16, 0, 0);
    std::vector<uint32_t> silence(6, 0xffffffffu);

    const auto emptyFrames = source.renderInterleaved(silence.data(), 3, 2);
    require(emptyFrames == 0, "DoP silence render must not count as consumed input frames");
    require(silence[0] == 0x050000 && silence[1] == 0x050000, "DoP silence frame 0 must carry 0x05 markers");
    require(silence[2] == 0xfa0000 && silence[3] == 0xfa0000, "DoP silence frame 1 must carry 0xfa markers");
    require(silence[4] == 0x050000 && silence[5] == 0x050000, "DoP silence frame 2 must keep alternating markers");

    source.beginSession();
    const std::vector<uint32_t> wrongMarkerInput {
        0xaa0201u, 0xaa0605u,
        0xbb0403u, 0xbb0807u,
    };
    require(source.push(wrongMarkerInput.data(), 2), "DoP source must accept packed frames");

    std::vector<uint32_t> data(4, 0u);
    const auto dataFrames = source.renderInterleaved(data.data(), 2, 2);
    require(dataFrames == 2, "DoP render must consume queued input frames");
    require(data[0] == 0x050201 && data[1] == 0x050605, "DoP data frame 0 must rewrite to the reference 0x05 marker");
    require(data[2] == 0xfa0403 && data[3] == 0xfa0807, "DoP data frame 1 must rewrite to the reference 0xfa marker");
}

#if JUCE_WINDOWS
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
    require(explicitValid[0] == 1024u, "ASIO explicit valid buffer must be first");
    require(std::find(explicitValid.begin(), explicitValid.end(), 512u) != explicitValid.end(), "ASIO preferred fallback must be included");

    auto defaultPreferred = buildAsioCandidates(128, 4096, 512, 128, 0);
    require(! defaultPreferred.empty(), "ASIO default candidate list");
    require(defaultPreferred[0] == 512u, "ASIO default buffer must prefer driver preferred size");

    auto powerOfTwo = buildAsioCandidates(64, 4096, 512, -1, 300);
    require(std::find(powerOfTwo.begin(), powerOfTwo.end(), 256u) != powerOfTwo.end(), "ASIO power-of-two lower candidate");
    require(std::find(powerOfTwo.begin(), powerOfTwo.end(), 512u) != powerOfTwo.end(), "ASIO power-of-two preferred candidate");

    auto stepped = buildAsioCandidates(128, 4096, 512, 128, 1000);
    require(std::find(stepped.begin(), stepped.end(), 896u) != stepped.end(), "ASIO stepped lower aligned candidate");
    require(std::find(stepped.begin(), stepped.end(), 1024u) != stepped.end(), "ASIO stepped upper aligned candidate");

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

void testAsioDopConversionMatchesReferenceHost()
{
    std::vector<unsigned char> bytes(16, 0);
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32LSB, 0, 0x050201u);
    require(
        bytes[0] == 0x02 && bytes[1] == 0x01 && bytes[2] == 0x05 && bytes[3] == 0x05,
        "ASIO DoP int32 LSB must match asio-test-native byte layout");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt32LSB24, 0, 0x050201u);
    require(
        bytes[0] == 0x00 && bytes[1] == 0x01 && bytes[2] == 0x02 && bytes[3] == 0x05,
        "ASIO DoP int32 LSB 24-bit aligned must keep the DoP payload left-aligned");

    std::fill(bytes.begin(), bytes.end(), static_cast<unsigned char>(0));
    asio_write_dop_sample_for_tests(bytes.data(), ASIOSTInt24LSB, 0, 0xfa0403u);
    require(
        bytes[0] == 0xfa && bytes[1] == 0x03 && bytes[2] == 0x04,
        "ASIO DoP int24 LSB must match asio-test-native byte layout");
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
#endif

void testFramedStdinShutdown()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    std::atomic<bool> shutdownRequested { false };
    uint32_t currentSessionId = 0;
    bool hasSession = false;
    std::vector<char> pending;
    std::vector<char> pendingAutomix;

    handleFramedStdinPayload(
        source,
        2,
        shutdownRequested,
        currentSessionId,
        hasSession,
        pending,
        pendingAutomix,
        48000.0,
        makeFrame(StdinFrameType::Shutdown, 0),
        {});
    require(shutdownRequested.load(), "shutdown frame must request host shutdown");
}

void testCleanupEmitsShutdownAckOnce()
{
    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    PcmRingAudioSource source(2, 512, 0, 0, 1.0f, eqProcessor, channelBalanceProcessor);
    juce::AudioSourcePlayer player;
    EqControlServer eqControlServer(0, eqProcessor, channelBalanceProcessor);
    std::unique_ptr<juce::AudioIODevice> device;
    bool shutdownAckSent = false;
    std::ostringstream output;
    auto* oldBuffer = std::cout.rdbuf(output.rdbuf());

    cleanupAudioDeviceAndAck(source, device, player, eqControlServer, shutdownAckSent);
    cleanupAudioDeviceAndAck(source, device, player, eqControlServer, shutdownAckSent);
    std::cout.rdbuf(oldBuffer);

    require(shutdownAckSent, "cleanup must mark shutdown ack sent");
    require(output.str() == "{\"event\":\"shutdown-ack\"}\n", "cleanup must emit shutdown ack exactly once");
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
        { "UZUME engine bypass preserves dry buffer", testUzumeEngineBypassPreservesDryBuffer },
        { "UZUME engine limiter protects active output", testUzumeEngineLimiterProtectsActiveOutput },
        { "UZUME engine uses GPU matrix for stable channel balance", testUzumeEngineUsesGpuMatrixForStableChannelBalance },
        { "UZUME engine uses GPU matrix for stable mono channel balance", testUzumeEngineUsesGpuMatrixForStableMonoChannelBalance },
        { "UZUME runtime status reports backend", testUzumeRuntimeStatusReportsBackend },
        { "UZUME GPU safety limiter matches CPU reference", testUzumeGpuSafetyLimiterMatchesCpuReference },
        { "UZUME GPU prepared playback limiter matches CPU reference", testUzumeGpuPreparedPlaybackLimiterMatchesCpuReference },
        { "UZUME GPU prepared playback planar limiter matches CPU reference", testUzumeGpuPreparedPlaybackPlanarLimiterMatchesCpuReference },
        { "UZUME GPU fused gain limiter matches CPU reference", testUzumeGpuFusedGainLimiterMatchesCpuReference },
        { "UZUME GPU stereo matrix limiter matches CPU reference", testUzumeGpuStereoMatrixLimiterMatchesCpuReference },
        { "UZUME GPU stereo matrix matches CPU reference", testUzumeGpuStereoMatrixMatchesCpuReference },
        { "UZUME GPU prepared playback stereo matrix limiter matches CPU reference", testUzumeGpuPreparedPlaybackStereoMatrixLimiterMatchesCpuReference },
        { "UZUME GPU prepared playback stereo matrix matches CPU reference", testUzumeGpuPreparedPlaybackStereoMatrixMatchesCpuReference },
        { "UZUME GPU cuFFT roundtrip matches CPU reference", testUzumeGpuCufftRoundtripMatchesCpuReference },
        { "UZUME GPU cuFFT convolution matches CPU reference", testUzumeGpuCufftConvolutionMatchesCpuReference },
        { "UZUME GPU prepared playback cuFFT convolution matches CPU reference", testUzumeGpuPreparedPlaybackFftConvolutionMatchesCpuReference },
        { "UZUME GPU prepared playback streaming cuFFT convolution keeps history", testUzumeGpuPreparedPlaybackStreamingFftConvolutionKeepsHistory },
        { "UZUME engine prepare prewarms GPU cuFFT convolution scratch", testUzumeEnginePreparePrewarmsGpuFftConvolutionScratch },
        { "UZUME engine prepare prewarms GPU streaming cuFFT convolution scratch", testUzumeEnginePreparePrewarmsGpuStreamingFftConvolutionScratch },
        { "DSP chain bypass preserves dry buffer", testDspChainBypassPreservesDryBuffer },
        { "DSP chain limiter protects active output", testDspChainLimiterProtectsActiveOutput },
        { "DSP chain limiter ignores near full-scale output", testDspChainLimiterIgnoresNearFullScaleOutput },
        { "DSP chain limiter can be bypassed", testDspChainLimiterCanBeBypassed },
        { "DSP headroom only applies to active DSP", testDspHeadroomOnlyAppliesToActiveDsp },
        { "host buffer fallback attempts", testHostBufferFallbackAttempts },
        { "host shared backend options", testHostSharedBackendOptions },
        { "host backend names", testHostBackendNames },
        { "host prebuffer defaults remain compatible", testHostPrebufferDefaultsRemainCompatible },
        { "explicit zero prebuffer disables wait", testExplicitZeroPrebufferDisablesWait },
        { "framed stdin session reset and late PCM drop", testFramedStdinSessionResetAndLatePcmDrop },
        { "framed stdin idle does not count underrun before PCM", testFramedStdinIdleDoesNotCountUnderrunBeforePcm },
        { "framed stdin prebuffer does not count underrun before target", testFramedStdinPrebufferDoesNotCountUnderrunBeforeTarget },
        { "native render adapter", testNativeRenderAdapter },
        { "PCM declick ramp on session start and stop", testPcmDeclickRampOnSessionStartAndStop },
        { "native automix deck mixes next before current ends", testNativeAutomixDeckMixesNextBeforeCurrentEnds },
        { "native automix next deck cannot advance past current buffer", testNativeAutomixNextDeckCannotAdvancePastCurrentBuffer },
        { "DoP render keeps valid markers during silence and data", testDopRenderKeepsValidMarkersDuringSilenceAndData },
#if JUCE_WINDOWS
        { "ASIO buffer candidate generation", testAsioBufferCandidateGeneration },
        { "ASIO sample-rate pivot candidate generation", testAsioSampleRatePivotCandidateGeneration },
        { "ASIO sample conversion", testAsioSampleConversion },
        { "ASIO DoP conversion matches reference host", testAsioDopConversionMatchesReferenceHost },
        { "ASIO native DSD conversion", testAsioNativeDsdConversion },
        { "ASIO render guard catches callback exception", testAsioRenderGuardCatchesCallbackException },
#endif
        { "framed stdin shutdown", testFramedStdinShutdown },
        { "cleanup emits shutdown ack once", testCleanupEmitsShutdownAckOnce },
        { "protocol messages", testProtocolMessages },
    };

    try
    {
        for (const auto& test : tests)
        {
            test.second();
            std::cout << "[audio-engine-tests] PASS " << test.first << '\n';
        }
    }
    catch (const std::exception& error)
    {
        std::cerr << "[audio-engine-tests] FAIL " << error.what() << '\n';
        return 1;
    }

    return 0;
}
