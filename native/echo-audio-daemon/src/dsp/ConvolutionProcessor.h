#pragma once

#include <kissfft/kiss_fft.h>

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace echo_audio_daemon {

// ── ConvolutionProcessor ─────────────────────────────────────────────────────
// Partitioned FFT convolution for room-correction / IR processing using KissFFT.
//
// Supports:
//   - WAV file IR loading (16/24/32-bit integer, 32-bit float)
//   - Stereo IR → mono conversion by channel averaging
//   - Partitioned convolution (overlap-add) for long IRs
//   - Direct convolution fallback for short IRs (IR length < partition size)
//   - Per-channel processing for multi-channel audio
//   - Bypass toggle
//
// Conventions (matching BiquadFilter/EqProcessor):
//   - float processing, double coefficient compute where applicable
//   - namespace echo_audio_daemon
class ConvolutionProcessor {
public:
    ConvolutionProcessor();
    ~ConvolutionProcessor();

    // ── Lifecycle ───────────────────────────────────────────────────────────

    // Load IR from a WAV file. The WAV must be PCM (16/24/32-bit integer or
    // 32-bit float). Stereo files are averaged to mono.
    // Returns true on success.
    bool loadIr(const std::string& wavFilePath);

    // Load IR from raw floating-point samples (mono). Used for testing.
    bool loadIrFromSamples(const float* samples, int numSamples, int numChannels = 1);

    // Release IR data and reset processing state.
    void clearIr();

    // Prepare the processor for real-time operation. Must be called after
    // loadIr() / loadIrFromSamples() and before processBlock().
    //   blockSize  – expected frame count for each processBlock() call
    //   channels   – number of interleaved channels in the audio stream
    void prepare(int blockSize, int channels);

    // Reset all per-channel processing state (overlap buffers, ring buffers,
    // block counter). Does NOT clear the IR. Does NOT change enabled state.
    void reset();

    // ── Processing ──────────────────────────────────────────────────────────

    // Process one block of interleaved audio frames.
    //   frameCount must equal the blockSize passed to prepare().
    //   If disabled, input is copied verbatim to output.
    void processBlock(const float* input, float* output, int frameCount, int channels);

    // ── Control ─────────────────────────────────────────────────────────────

    void setEnabled(bool enabled);
    bool isEnabled() const;

    // ── Queries ─────────────────────────────────────────────────────────────

    int irLength() const { return irLength_; }
    bool irLoaded() const { return irLoaded_; }
    int partitionSize() const { return partitionSize_; }

private:
    // ── WAV parser ─────────────────────────────────────────────────────────
    // Parse a WAV file into floating-point samples (mono after averaging).
    // Returns true on success, false on parse error.
    static bool parseWavFile(const std::string& path,
                             std::vector<float>& samples,
                             int& outChannels,
                             int& outSampleRate);

    // ── Partition management ────────────────────────────────────────────────
    void buildPartitions(const std::vector<float>& ir);
    void destroyPartitions();

    // ── FFT infrastructure ──────────────────────────────────────────────────
    bool ensureFftPlans(int nfft);
    void destroyFftPlans();

    // ── Processing modes ────────────────────────────────────────────────────
    void processPartitioned(const float* input, float* output, int frameCount, int channels);
    void processDirect(const float* input, float* output, int frameCount, int channels);

    // ── Constants ──────────────────────────────────────────────────────────
    static constexpr int kDefaultPartitionSize = 1024;
    // When IR length is below this, direct convolution is used (zero latency).
    static constexpr int kDirectConvolutionLimit = 256;

    // ── IR data (mono) ──────────────────────────────────────────────────────
    std::vector<float> irData_;          // mono IR samples (time domain)
    int irLength_ = 0;
    bool irLoaded_ = false;

    // ── Partition state ─────────────────────────────────────────────────────
    int partitionSize_ = kDefaultPartitionSize;
    int fftSize_ = 0;                     // 2 * partitionSize_
    int numPartitions_ = 0;
    bool useDirectConvolution_ = true;

    // Frequency-domain partition data: numPartitions_ vectors, each fftSize_
    // complex bins.
    std::vector<std::vector<kiss_fft_cpx>> freqPartitions_;

    // ── FFT plans (shared across channels) ──────────────────────────────────
    kiss_fft_cfg forwardCfg_ = nullptr;
    kiss_fft_cfg inverseCfg_ = nullptr;

    // ── Per-channel processing state ────────────────────────────────────────
    struct ChannelState {
        // Ring buffer of FFT'd input blocks (numPartitions_ entries of
        // fftSize_ complex bins each).  Only the last numPartitions_ blocks
        // are kept — older blocks no longer contribute to any output sample.
        std::vector<kiss_fft_cpx> inputRing;

        // Overlap from the previous block's IFFT (partitionSize_ samples).
        std::vector<float> overlap;

        // Write index into inputRing (next position to overwrite).
        int ringWriteIdx = 0;

        // How many blocks have been processed.  Also serves as the ring
        // frame counter (only the min(blockCounter, numPartitions) most recent
        // entries are valid).
        int blockCounter = 0;
    };
    std::vector<ChannelState> channels_;

    // ── Scratch buffers (size fftSize_ each, reused per block) ─────────────
    std::vector<kiss_fft_cpx> scratchFreq_;   // current input block FFT
    std::vector<kiss_fft_cpx> scratchAccum_;  // frequency accumulator
    std::vector<kiss_fft_cpx> scratchTime_;   // IFFT result

    // ── Configuration ───────────────────────────────────────────────────────
    int blockSize_ = 0;
    int numChannels_ = 0;
    bool enabled_ = true;
    bool prepared_ = false;
};

} // namespace echo_audio_daemon
