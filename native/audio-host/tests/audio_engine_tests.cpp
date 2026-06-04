#include "../../audio-engine/ChannelBalanceProcessor.h"
#include "../../audio-engine/DspChain.h"
#include "../../audio-engine/EqMessageProtocol.h"
#include "../../audio-engine/EqProcessor.h"

#include <juce_audio_basics/juce_audio_basics.h>

#if JUCE_WINDOWS
#include "../third_party/asio-sdk/common/asio.h"
#endif

#include <algorithm>
#include <cmath>
#include <iostream>
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
    require(std::abs(buffer.getSample(0, 0)) <= 1.0f, "hot convolution limited");
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

void testDspChainBypassPreservesDryBuffer()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::DspChain dspChain(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    dspChain.prepare(48000.0, 128, 2);

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

    require(! dspChain.isActive(), "inactive DSP chain must report bypass");
    dspChain.processBlock(buffer, 0, buffer.getNumSamples());
    requireBuffersClose(buffer, dry, strictTolerance, "inactive DSP chain must not touch native playback samples");
    require(! dspChain.hasClippingRisk(), "inactive DSP chain must not report clipping risk");
    require(! dspChain.isSafetyLimiterProtecting(), "inactive DSP chain must not report limiter protection");
}

void testDspChainLimiterProtectsActiveOutput()
{
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

void testDspHeadroomOnlyAppliesToActiveDsp()
{
    echo::EqProcessor eqProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::DspChain dspChain(eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor);
    dspChain.prepare(48000.0, 128, 2);
    headroomProcessor.setHeadroomDb(-6.0f);

    auto bypassed = makeBuffer(2, 128);
    bypassed.clear();
    bypassed.setSample(0, 0, 0.5f);
    bypassed.setSample(1, 0, -0.5f);
    dspChain.processBlock(bypassed, 0, bypassed.getNumSamples());
    require(std::abs(bypassed.getSample(0, 0) - 0.5f) <= strictTolerance, "DSP headroom must not affect native bypass");
    require(std::abs(bypassed.getSample(1, 0) + 0.5f) <= strictTolerance, "DSP headroom must preserve bypass polarity");

    eqProcessor.setEnabled(true);
    auto processed = makeBuffer(2, 128);
    processed.clear();
    processed.setSample(0, 0, 0.5f);
    processed.setSample(1, 0, -0.5f);
    dspChain.processBlock(processed, 0, processed.getNumSamples());

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

void testEqLimiterProtectsEnabledOutput()
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

    require(processor.hasClippingRisk(), "enabled EQ limiter must keep clipping risk visible");
    requireFinite(buffer, "enabled EQ limiter must keep output finite");
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        const auto* samples = buffer.getReadPointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            require(std::abs(samples[sample]) <= 1.0f + nearTolerance, "enabled EQ limiter must cap output");
    }
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
        { "EQ limiter protects enabled output", testEqLimiterProtectsEnabledOutput },
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
        { "DSP chain limiter protects active output", testDspChainLimiterProtectsActiveOutput },
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
