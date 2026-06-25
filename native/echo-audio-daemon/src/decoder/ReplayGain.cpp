#include "src/decoder/ReplayGain.h"
#include "src/decoder/AvDecoder.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <vector>

#include <ebur128.h>

namespace ead = echo_audio_daemon;

// ── Constants ───────────────────────────────────────────────────────────────

// EBU R128 target loudness is -23 LUFS for broadcast.
// ReplayGain 2.0 reference level is -18 LUFS (scaled from -23).
// We compute gain relative to -18 LUFS (ReplayGain standard).
static constexpr double kReferenceLoudnessLufs = -18.0;

// ── analyze() ───────────────────────────────────────────────────────────────

ead::ReplayGain::Result ead::ReplayGain::analyze(const std::string& filePath) {
    Result result;

    // Use AvDecoder to open and decode the file
    AvDecoder decoder;
    if (!decoder.open(filePath)) {
        std::cerr << "[ReplayGain] Failed to open: " << filePath << "\n";
        return result;
    }

    int sampleRate = decoder.getSampleRate();
    int channels = decoder.getChannels();

    if (sampleRate <= 0 || channels <= 0) {
        std::cerr << "[ReplayGain] Invalid sample rate or channels\n";
        return result;
    }

    // Initialize ebur128 state
    // Mode: M (momentary), S (short-term), I (integrated), LRA (loudness range)
    int mode = EBUR128_MODE_I | EBUR128_MODE_S | EBUR128_MODE_LRA;
    ebur128_state* st = ebur128_init(static_cast<unsigned int>(channels),
                                     static_cast<unsigned long>(sampleRate),
                                     mode);
    if (!st) {
        std::cerr << "[ReplayGain] ebur128_init failed\n";
        return result;
    }

    // Set channel map
    // EBU R128 channel mapping: 0=LEFT, 1=RIGHT, 2=CENTER, 3=LFE, 4=LS, 5=RS
    // For our purposes: mono→CENTER, stereo→LEFT/RIGHT
    if (channels >= 1) {
        ebur128_set_channel(st, 0, (channels == 1) ? EBUR128_CENTER : EBUR128_LEFT);
    }
    if (channels >= 2) {
        ebur128_set_channel(st, 1, EBUR128_RIGHT);
    }
    // For 3+ channels, mark LFE (index 3) as unused per BS.1770
    for (int c = 2; c < channels; ++c) {
        if (c == 3) {
            // LFE channel is not counted in loudness calculation
            ebur128_set_channel(st, c, EBUR128_UNUSED);
        } else {
            // Surround channels use standard mapping
            ebur128_set_channel(st, c, EBUR128_LEFT_SURROUND + (c - 2));
        }
    }

    // Decode the entire file and feed to ebur128
    const int kBufFrames = 4096;
    std::vector<float> buf(static_cast<size_t>(kBufFrames) * channels);

    double peak = 0.0;
    int totalFrames = 0;

    while (true) {
        int frames = decoder.decode(buf.data(), kBufFrames);
        if (frames <= 0) {
            break;
        }

        // Feed samples to ebur128 (interleaved float)
        int eburErr = ebur128_add_frames_float(st, buf.data(),
                                                static_cast<size_t>(frames));
        if (eburErr != EBUR128_SUCCESS) {
            std::cerr << "[ReplayGain] ebur128_add_frames_float error: "
                      << eburErr << "\n";
            break;
        }

        // Track peak
        for (int i = 0; i < frames * channels; ++i) {
            double absVal = static_cast<double>(std::abs(buf[i]));
            if (absVal > peak) {
                peak = absVal;
            }
        }

        totalFrames += frames;
    }

    if (totalFrames <= 0) {
        std::cerr << "[ReplayGain] No frames decoded\n";
        ebur128_destroy(&st);
        return result;
    }

    // Get integrated loudness
    double integratedLufs = 0.0;
    int loudnessErr = ebur128_loudness_global(st, &integratedLufs);
    if (loudnessErr == EBUR128_SUCCESS) {
        result.integratedLufs = integratedLufs;

        // ReplayGain gain = reference - measured
        // If measured is -23 LUFS and reference is -18 LUFS,
        // gain = -18 - (-23) = +5 dB (amplify by 5 dB)
        // If measured is -10 LUFS and reference is -18 LUFS,
        // gain = -18 - (-10) = -8 dB (attenuate by 8 dB)
        result.trackGainDb = kReferenceLoudnessLufs - integratedLufs;

        // Clamp to reasonable range (-18 to +6 dB per ReplayGain spec)
        result.trackGainDb = std::max(-18.0, std::min(6.0, result.trackGainDb));
    }

    result.trackPeak = peak;
    result.albumGainDb = result.trackGainDb;  // single-file analysis
    result.albumPeak = result.trackPeak;

    ebur128_destroy(&st);
    return result;
}

// ── applyGain() ─────────────────────────────────────────────────────────────

void ead::ReplayGain::applyGain(float* samples, int frameCount, int channels, double gainDb) {
    if (!samples || frameCount <= 0 || channels <= 0) {
        return;
    }

    double linearGain = dbToLinear(gainDb);
    int totalSamples = frameCount * channels;

    for (int i = 0; i < totalSamples; ++i) {
        samples[i] *= static_cast<float>(linearGain);
    }
}

// ── preventClipping() ───────────────────────────────────────────────────────

void ead::ReplayGain::preventClipping(float* samples, int frameCount, int channels,
                                       double peak, double targetLufs) {
    if (!samples || frameCount <= 0 || channels <= 0 || peak <= 0.0) {
        return;
    }

    // Compute the peak after gain application
    double refGainDb = kReferenceLoudnessLufs - targetLufs;
    double linearGain = dbToLinear(refGainDb);
    double peakAfterGain = peak * linearGain;

    // If we would clip, scale down proportionally
    if (peakAfterGain > 1.0) {
        double scale = 1.0 / peakAfterGain;
        int totalSamples = frameCount * channels;
        for (int i = 0; i < totalSamples; ++i) {
            samples[i] *= static_cast<float>(scale);
        }
    }
}
