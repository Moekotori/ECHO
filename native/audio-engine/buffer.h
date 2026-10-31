#pragma once

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <stdexcept>
#include <vector>

namespace echo {

/// Lightweight header-only planar float audio buffer.
/// Data is stored as vector<vector<float>> — one inner vector per channel,
/// all channels have the same length (numSamples_).
class FloatAudioBuffer {
public:
    FloatAudioBuffer() = default;

    FloatAudioBuffer(int numChannels, int numSamples) {
        setSize(numChannels, numSamples);
    }

    // ── allocation ──────────────────────────────────────────────────────

    void setSize(int numChannels, int numSamples) {
        if (numChannels < 0 || numSamples < 0) {
            throw std::invalid_argument("FloatAudioBuffer::setSize: negative size");
        }
        channels_.resize(static_cast<std::size_t>(numChannels));
        for (auto& ch : channels_) {
            ch.assign(static_cast<std::size_t>(numSamples), 0.0f);
        }
        numSamples_ = numSamples;
    }

    // ── metadata ────────────────────────────────────────────────────────

    int getNumChannels() const noexcept { return static_cast<int>(channels_.size()); }

    int getNumSamples() const noexcept { return numSamples_; }

    // ── raw pointer access ──────────────────────────────────────────────

    /// Returns a writeable pointer to channel[0].
    float* getWritePointer(int channel) {
        return channels_[static_cast<std::size_t>(channel)].data();
    }

    /// Returns a read-only pointer to channel[0].
    const float* getReadPointer(int channel) const {
        return channels_[static_cast<std::size_t>(channel)].data();
    }

    /// Returns a writeable pointer to channel[startSample].
    float* getWritePointer(int channel, int startSample) {
        return channels_[static_cast<std::size_t>(channel)].data() + startSample;
    }

    /// Returns a read-only pointer to channel[startSample].
    const float* getReadPointer(int channel, int startSample) const {
        return channels_[static_cast<std::size_t>(channel)].data() + startSample;
    }

    // ── sample get/set ──────────────────────────────────────────────────

    float getSample(int channel, int sampleIndex) const {
        return channels_[static_cast<std::size_t>(channel)][static_cast<std::size_t>(sampleIndex)];
    }

    void setSample(int channel, int sampleIndex, float value) {
        channels_[static_cast<std::size_t>(channel)][static_cast<std::size_t>(sampleIndex)] = value;
    }

    // ── gain ────────────────────────────────────────────────────────────

    /// Multiply every sample in every channel by `gain`.
    void applyGain(float gain) {
        for (auto& ch : channels_) {
            for (auto& s : ch) {
                s *= gain;
            }
        }
    }

    /// Multiply `numSamples` starting at `startSample` on the given channel by `gain`.
    void applyGain(int channel, int startSample, int numSamples, float gain) {
        auto& ch = channels_[static_cast<std::size_t>(channel)];
        auto* begin = ch.data() + startSample;
        auto* end = begin + numSamples;
        for (auto* p = begin; p != end; ++p) {
            *p *= gain;
        }
    }

    // ── clear ───────────────────────────────────────────────────────────

    /// Zero every sample in every channel.
    void clear() {
        for (auto& ch : channels_) {
            std::fill(ch.begin(), ch.end(), 0.0f);
        }
    }

    /// Zero `numSamples` starting at `startSample` on **all** channels.
    void clear(int startSample, int numSamples) {
        for (auto& ch : channels_) {
            std::fill_n(ch.begin() + startSample, static_cast<std::size_t>(numSamples), 0.0f);
        }
    }

    /// Zero `numSamples` starting at `startSample` on a specific channel.
    void clear(int channel, int startSample, int numSamples) {
        auto& ch = channels_[static_cast<std::size_t>(channel)];
        std::fill_n(ch.begin() + startSample, static_cast<std::size_t>(numSamples), 0.0f);
    }

    // ── copy ────────────────────────────────────────────────────────────

    /// Copy `numSamples` from source channel to destination channel.
    void copyFrom(int destChannel, int destStartSample,
                  const FloatAudioBuffer& source,
                  int sourceChannel, int sourceStartSample, int numSamples) {
        auto& dst = channels_[static_cast<std::size_t>(destChannel)];
        const auto& src = source.channels_[static_cast<std::size_t>(sourceChannel)];
        std::copy_n(src.begin() + sourceStartSample, static_cast<std::size_t>(numSamples),
                    dst.begin() + destStartSample);
    }

private:
    std::vector<std::vector<float>> channels_;
    int numSamples_ = 0;
};

} // namespace echo
