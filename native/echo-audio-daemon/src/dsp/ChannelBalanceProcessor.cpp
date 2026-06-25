#include "src/dsp/ChannelBalanceProcessor.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace echo_audio_daemon {

// ── Anonymous helpers ────────────────────────────────────────────────────────
namespace {

constexpr double kPi = 3.14159265358979323846;

double clamp(double value, double lo, double hi) {
    return std::max(lo, std::min(hi, value));
}

double sanitize(double value) {
    return std::isfinite(value) ? value : 0.0;
}

} // anonymous namespace

// ── Constructor ──────────────────────────────────────────────────────────────

ChannelBalanceProcessor::ChannelBalanceProcessor() {
    // Initialize delay buffers to minimum usable size (2 + margin for
    // interpolation safety) so processBlock works before setChannelDelay().
    const int minLen = std::max(1,
        static_cast<int>(std::ceil(kDefaultSampleRate * kMaxDelayMs / 1000.0)) + 2);
    delayLen_ = minLen;
    delayBuf_[0].resize(static_cast<size_t>(delayLen_), 0.0f);
    delayBuf_[1].resize(static_cast<size_t>(delayLen_), 0.0f);
    writeIndex_ = 0;
    reset();
}

// ── Parameter setters ────────────────────────────────────────────────────────

void ChannelBalanceProcessor::setChannelGain(int channel, double gainDb) {
    const double clamped = clamp(gainDb, kMinGainDb, kMaxGainDb);
    if (channel == 0)
        leftGainDb_ = clamped;
    else
        rightGainDb_ = clamped;
}

void ChannelBalanceProcessor::setChannelDelay(int channel, double delayMs, double sampleRate) {
    if (sampleRate > 0.0)
        sampleRate_ = sampleRate;

    if (channel == 0)
        leftDelayMs_ = clamp(delayMs, 0.0, kMaxDelayMs);
    else
        rightDelayMs_ = clamp(delayMs, 0.0, kMaxDelayMs);

    // Re-allocate delay buffers to accommodate the maximum possible delay
    // at the current sample rate.  +2 extra for interpolation safety.
    const int newLen = std::max(1,
        static_cast<int>(std::ceil(sampleRate_ * kMaxDelayMs / 1000.0)) + 2);

    if (newLen != delayLen_) {
        delayLen_ = newLen;
        delayBuf_[0].resize(static_cast<size_t>(delayLen_), 0.0f);
        delayBuf_[1].resize(static_cast<size_t>(delayLen_), 0.0f);
        if (writeIndex_ >= delayLen_)
            writeIndex_ = 0;
    }
}

void ChannelBalanceProcessor::setBalance(double pan) {
    balance_ = clamp(pan, -1.0, 1.0);
}

void ChannelBalanceProcessor::setMonoMode(ChannelBalanceMonoMode mode) {
    monoMode_ = mode;
}

void ChannelBalanceProcessor::setPhaseInvert(int channel, bool invert) {
    if (channel == 0)
        invertLeft_ = invert;
    else
        invertRight_ = invert;
}

void ChannelBalanceProcessor::setSwapChannels(bool swap) {
    swapChannels_ = swap;
}

// ── Processing ───────────────────────────────────────────────────────────────

void ChannelBalanceProcessor::processBlock(float* samples, int frameCount, int channels) {
    if (!samples || frameCount <= 0 || channels <= 0)
        return;

    const int bufLen = delayLen_;
    if (bufLen <= 0)
        return;

    for (int frame = 0; frame < frameCount; ++frame) {
        const int idx = frame * channels;

        // ── Read input ──────────────────────────────────────────────────────
        float leftIn = samples[idx];
        float rightIn = (channels > 1) ? samples[idx + 1] : leftIn;

        // ── Channel swap ────────────────────────────────────────────────────
        if (swapChannels_)
            std::swap(leftIn, rightIn);

        // ── Balance (linear pan) ────────────────────────────────────────────
        // pan=-1 → left only, pan=0 → equal, pan=+1 → right only
        double leftGain = dbToGain(leftGainDb_);
        double rightGain = dbToGain(rightGainDb_);

        if (balance_ < 0.0)
            rightGain *= (1.0 + balance_);   // reduce right channel
        else if (balance_ > 0.0)
            leftGain *= (1.0 - balance_);    // reduce left channel

        float leftProc = static_cast<float>(sanitize(static_cast<double>(leftIn) * leftGain));
        float rightProc = static_cast<float>(sanitize(static_cast<double>(rightIn) * rightGain));

        // ── Phase invert ────────────────────────────────────────────────────
        if (invertLeft_)
            leftProc = -leftProc;
        if (invertRight_)
            rightProc = -rightProc;

        // ── Mono mode ───────────────────────────────────────────────────────
        if (monoMode_ == ChannelBalanceMonoMode::Sum) {
            const float mono = (leftProc + rightProc) * 0.5f;
            leftProc = mono;
            rightProc = mono;
        } else if (monoMode_ == ChannelBalanceMonoMode::Left) {
            rightProc = 0.0f;
        } else if (monoMode_ == ChannelBalanceMonoMode::Right) {
            leftProc = 0.0f;
        }
        // Off: leave as-is

        // ── Delay line (write then read) ────────────────────────────────────
        // Write current processed samples into the circular buffer.
        pushDelaySample(0, leftProc, bufLen);
        pushDelaySample(1, rightProc, bufLen);

        // Read delayed samples (with linear interpolation for fractional delay).
        const float leftOut = readDelaySample(0, leftDelayMs_, bufLen);
        const float rightOut = readDelaySample(1, rightDelayMs_, bufLen);

        // Advance write index once per frame (shared by both channels).
        writeIndex_ = (writeIndex_ + 1) % bufLen;

        // ── Write output ────────────────────────────────────────────────────
        samples[idx] = leftOut;
        if (channels > 1)
            samples[idx + 1] = rightOut;
    }
}

void ChannelBalanceProcessor::reset() {
    leftGainDb_ = 0.0;
    rightGainDb_ = 0.0;
    leftDelayMs_ = 0.0;
    rightDelayMs_ = 0.0;
    balance_ = 0.0;
    monoMode_ = ChannelBalanceMonoMode::Off;
    invertLeft_ = false;
    invertRight_ = false;
    swapChannels_ = false;

    writeIndex_ = 0;
    for (auto& buf : delayBuf_)
        std::fill(buf.begin(), buf.end(), 0.0f);
}

// ── Private helpers ──────────────────────────────────────────────────────────

double ChannelBalanceProcessor::dbToGain(double db) {
    if (db <= -60.0)
        return 0.0;
    return std::pow(10.0, db / 20.0);
}

int ChannelBalanceProcessor::wrapIndex(int index, int length) {
    while (index < 0)
        index += length;
    return index % length;
}

float ChannelBalanceProcessor::readDelaySample(int channel, double delayMs, int bufLen) const {
    if (channel < 0 || channel >= 2 || bufLen < 2)
        return 0.0f;

    const double safeDelay = clamp(delayMs, 0.0, kMaxDelayMs);
    const double delaySamples = safeDelay * sampleRate_ / 1000.0;
    const int maxWhole = std::max(0, bufLen - 2);
    const int whole = std::min(maxWhole,
        std::max(0, static_cast<int>(std::floor(delaySamples))));
    const float frac = static_cast<float>(delaySamples - static_cast<double>(whole));

    // Read two adjacent samples for linear interpolation
    const int idx1 = wrapIndex(writeIndex_ - whole, bufLen);
    const int idx2 = wrapIndex(writeIndex_ - whole - 1, bufLen);

    const float s1 = delayBuf_[channel][static_cast<size_t>(idx1)];
    const float s2 = delayBuf_[channel][static_cast<size_t>(idx2)];
    return s1 + (s2 - s1) * frac;
}

void ChannelBalanceProcessor::pushDelaySample(int channel, float sample, int bufLen) {
    if (channel < 0 || channel >= 2 || bufLen <= 0)
        return;
    delayBuf_[channel][static_cast<size_t>(writeIndex_)] = sanitize(static_cast<double>(sample));
}

} // namespace echo_audio_daemon
