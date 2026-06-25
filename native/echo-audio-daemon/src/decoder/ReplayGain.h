#pragma once

#include <string>
#include <cmath>
#include <algorithm>

namespace echo_audio_daemon {

// ── ReplayGain ──────────────────────────────────────────────────────────────
// EBU R128 loudness analysis and gain application.
//
// analyze() uses libebur128 to measure integrated loudness (LUFS) and true
// peak of a decoded audio file.
// applyGain() applies a gain in dB to interleaved float32 samples in-place.
// preventClipping() scales samples to prevent clipping after gain application.
class ReplayGain {
public:
    // Result of loudness analysis.
    struct Result {
        double trackGainDb = 0.0;   // gain to reach target loudness (-18 LUFS)
        double trackPeak = 0.0;     // true peak (0.0 to 1.0)
        double albumGainDb = 0.0;   // album gain (same as track for single files)
        double albumPeak = 0.0;     // album peak
        double integratedLufs = 0.0;  // measured integrated loudness in LUFS
    };

    // Analyze a decoded audio file for ReplayGain.
    // filePath: path to audio file
    // Returns Result with computed gain/peak values.
    static Result analyze(const std::string& filePath);

    // Apply gain to decoded samples in-place.
    // gainDb: gain in decibels (e.g., -5.5 means reduce by 5.5 dB)
    static void applyGain(float* samples, int frameCount, int channels, double gainDb);

    // Prevent clipping after gain application by scaling down if peaks exceed 1.0.
    // peak: the true peak of the signal (0.0 to 1.0) before gain
    // targetLufs: target loudness level (default: -14.0 LUFS)
    static void preventClipping(float* samples, int frameCount, int channels,
                                 double peak, double targetLufs = -14.0);

    // Convert gain in dB to linear multiplier.
    static double dbToLinear(double gainDb) {
        return std::pow(10.0, gainDb / 20.0);
    }

    // Convert linear multiplier to gain in dB.
    static double linearToDb(double linear) {
        if (linear <= 0.0) return -std::numeric_limits<double>::infinity();
        return 20.0 * std::log10(linear);
    }
};

} // namespace echo_audio_daemon
