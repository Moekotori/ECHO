#include "NullBackend.h"

#include <cstring>

namespace echo_audio_daemon {

bool NullBackend::open(const DeviceInfo& /*device*/,
                       int sampleRate,
                       int channels,
                       int bufferFrames) {
    sampleRate_ = sampleRate;
    channels_ = channels;
    bufferFrames_ = bufferFrames;
    isOpen_ = true;
    return true;
}

void NullBackend::close() {
    isOpen_ = false;
    sampleRate_ = 0;
    channels_ = 0;
    bufferFrames_ = 0;
    framesWritten_.store(0);
    writeCount_.store(0);
    lastSamples_.clear();
    lastSamples_.shrink_to_fit();
}

bool NullBackend::write(const float* samples, int frameCount) {
    if (!isOpen_) {
        return false;
    }

    // Copy samples for test inspection
    const int sampleCount = frameCount * channels_;
    lastSamples_.assign(samples, samples + sampleCount);

    framesWritten_.fetch_add(static_cast<uint64_t>(frameCount));
    writeCount_.fetch_add(1);
    return true;
}

} // namespace echo_audio_daemon
