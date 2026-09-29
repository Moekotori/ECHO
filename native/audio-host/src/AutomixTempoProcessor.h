#pragma once

#include <cstddef>
#include <vector>

// Stereo-linked WSOLA used only on the Deck B decoder thread. The audio
// callback consumes its already-prepared PCM from the lock-free ring.
class AutomixTempoProcessor final
{
public:
    AutomixTempoProcessor(int sampleRate, int channels, double tempoRatio);

    bool active() const noexcept;
    std::vector<float> process(const float* interleaved, int frames, bool finalBlock = false);

private:
    double correlationAt(int candidateFrame) const;
    void compactInput();

    int sampleRate_ = 48'000;
    int channels_ = 2;
    double ratio_ = 1.0;
    int windowFrames_ = 1'920;
    int synthesisHopFrames_ = 960;
    int searchFrames_ = 240;
    bool initialized_ = false;
    double expectedInputFrame_ = 0.0;
    int previousCandidateFrame_ = 0;
    std::vector<float> input_;
    std::vector<float> previousTail_;
};
