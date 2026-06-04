#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace echo
{
constexpr int roomCorrectionMaxTaps = 8192;
constexpr float roomCorrectionMinTrimDb = -24.0f;
constexpr float roomCorrectionMaxTrimDb = 6.0f;

struct RoomCorrectionState
{
    bool enabled = false;
    std::string status = "empty";
    std::string irId;
    std::string irName;
    std::string channelMode = "none";
    double sampleRate = 0.0;
    int tapCount = 0;
    float trimDb = 0.0f;
    int latencySamples = 0;
    bool clippingRisk = false;
    std::string error;
};

float clampRoomCorrectionTrimDb(float value);

class ConvolutionProcessor
{
public:
    ConvolutionProcessor();

    void prepare(double sampleRate, int maximumBlockSize, int channelCount);
    void reset();
    void processBlock(juce::AudioBuffer<float>& buffer, int startSample, int numSamples);

    void setEnabled(bool shouldBeEnabled);
    void setTrimDb(float value);
    bool loadImpulseResponse(const std::string& path, const std::string& id, const std::string& name);
    void clearImpulseResponse();

    RoomCorrectionState getState() const;
    bool isEnabled() const;
    bool hasClippingRisk() const;

#if defined(ECHO_AUDIO_ENGINE_TESTS) && ECHO_AUDIO_ENGINE_TESTS
    bool loadImpulseResponseForTests(const std::vector<std::vector<float>>& taps, double sourceSampleRate, const std::string& id, const std::string& name);
#endif

private:
    struct PreparedImpulse
    {
        std::vector<std::vector<float>> taps;
        std::string id;
        std::string name;
        std::string channelMode = "none";
        double sampleRate = 0.0;
        int tapCount = 0;
    };

    static std::shared_ptr<const PreparedImpulse> createPreparedImpulse(
        const juce::AudioBuffer<float>& source,
        double sourceSampleRate,
        double targetSampleRate,
        const std::string& id,
        const std::string& name);
    static float sanitize(float value);
    static float protectClippingSample(float sample, bool shouldProtect, bool& risk);

    double currentSampleRate = 44100.0;
    int preparedChannels = 0;
    int preparedBlockSize = 0;
    int historyWriteIndex = 0;
    std::vector<std::vector<float>> history;
    std::shared_ptr<const PreparedImpulse> activeImpulse;

    std::atomic<bool> targetEnabled { false };
    std::atomic<float> atomicTrimDb { 0.0f };
    std::atomic<bool> clippingRisk { false };
    std::atomic<bool> hasError { false };
    std::string errorMessage;
};
} // namespace echo
