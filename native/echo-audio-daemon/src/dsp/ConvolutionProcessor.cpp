#include "src/dsp/ConvolutionProcessor.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>
#include <vector>

namespace echo_audio_daemon {

namespace {

template <typename T>
inline T readLe(const uint8_t* buf, size_t offset) {
    T val = 0;
    for (size_t i = 0; i < sizeof(T); ++i)
        val |= static_cast<T>(buf[offset + i]) << (i * 8);
    return val;
}

inline float clampSample(float v) {
    return std::isfinite(v) ? std::max(-1.0f, std::min(1.0f, v)) : 0.0f;
}

inline float intToFloat(int32_t raw, int bitsPerSample) {
    if (bitsPerSample <= 0) return 0.0f;
    const float scale = 1.0f / static_cast<float>(1LL << (bitsPerSample - 1));
    return static_cast<float>(raw) * scale;
}

bool parseWavHeader(std::ifstream& file,
                    int& outChannels,
                    int& outSampleRate,
                    int& outBitsPerSample,
                    int& outFormatTag,
                    uint32_t& outDataSize,
                    uint32_t& outDataOffset) {
    std::array<uint8_t, 44> header{};
    file.read(reinterpret_cast<char*>(header.data()), 44);
    if (file.gcount() < 44) return false;

    if (std::memcmp(header.data(), "RIFF", 4) != 0) return false;
    if (std::memcmp(header.data() + 8, "WAVE", 4) != 0) return false;

    const int fmtChunkSize = static_cast<int>(readLe<uint32_t>(header.data(), 16));
    outFormatTag = readLe<uint16_t>(header.data(), 20);
    outChannels = static_cast<int>(readLe<uint16_t>(header.data(), 22));
    outSampleRate = static_cast<int>(readLe<uint32_t>(header.data(), 24));
    outBitsPerSample = static_cast<int>(readLe<uint16_t>(header.data(), 34));

    if (outChannels <= 0 || outChannels > 8) return false;
    if (outSampleRate <= 0 || outSampleRate > 384000) return false;
    if (outFormatTag != 1 && outFormatTag != 3) return false;
    if (outFormatTag == 1 && outBitsPerSample != 16 && outBitsPerSample != 24 &&
        outBitsPerSample != 32) return false;
    if (outFormatTag == 3 && outBitsPerSample != 32) return false;

    const int fmtTotalSize = fmtChunkSize >= 16 ? fmtChunkSize : 16;
    uint32_t pos = 12 + 4 + static_cast<uint32_t>(fmtTotalSize);
    if (pos < 44) pos = 44;

    bool foundData = false;
    outDataOffset = 0;
    outDataSize = 0;

    while (!foundData) {
        if (pos + 8 > static_cast<uint32_t>(file.gcount())) {
            file.seekg(pos);
            std::array<uint8_t, 8> chunkHdr{};
            file.read(reinterpret_cast<char*>(chunkHdr.data()), 8);
            if (file.gcount() < 8) break;
            const uint32_t chunkSize = readLe<uint32_t>(chunkHdr.data(), 4);
            if (std::memcmp(chunkHdr.data(), "data", 4) == 0) {
                outDataOffset = pos + 8;
                outDataSize = chunkSize;
                foundData = true;
                break;
            }
            pos += 8 + chunkSize;
            if (chunkSize % 2 != 0) ++pos;
        } else {
            const uint8_t* chunkHdr = header.data() + pos;
            const uint32_t chunkSize = readLe<uint32_t>(chunkHdr, 4);
            if (std::memcmp(chunkHdr, "data", 4) == 0) {
                outDataOffset = pos + 8;
                outDataSize = chunkSize;
                foundData = true;
                break;
            }
            pos += 8 + chunkSize;
            if (chunkSize % 2 != 0) ++pos;
        }
    }
    if (!foundData || outDataSize == 0) return false;
    file.seekg(outDataOffset);
    return true;
}

} // anonymous namespace

// ==========================================================================
//  ConvolutionProcessor
// ==========================================================================

ConvolutionProcessor::ConvolutionProcessor() = default;
ConvolutionProcessor::~ConvolutionProcessor() { destroyFftPlans(); }

// ── WAV loading ───────────────────────────────────────────────────────────

bool ConvolutionProcessor::parseWavFile(const std::string& path,
                                        std::vector<float>& samples,
                                        int& outChannels,
                                        int& outSampleRate) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) return false;

    int bitsPerSample = 0, formatTag = 0;
    uint32_t dataSize = 0, dataOffset = 0;
    if (!parseWavHeader(file, outChannels, outSampleRate, bitsPerSample,
                        formatTag, dataSize, dataOffset))
        return false;

    const int bps = bitsPerSample / 8;
    const int frameCount = static_cast<int>(dataSize / (bps * outChannels));
    if (frameCount <= 0) return false;

    const size_t rawBytes = static_cast<size_t>(frameCount) *
                            static_cast<size_t>(outChannels) *
                            static_cast<size_t>(bps);
    std::vector<uint8_t> raw(rawBytes);
    file.read(reinterpret_cast<char*>(raw.data()),
              static_cast<std::streamsize>(rawBytes));
    if (static_cast<size_t>(file.gcount()) != rawBytes) return false;

    const int numCh = outChannels;
    const int numF = frameCount;
    std::vector<std::vector<float>> chData(static_cast<size_t>(numCh));
    for (int c = 0; c < numCh; ++c)
        chData[static_cast<size_t>(c)].resize(static_cast<size_t>(numF));

    size_t byteIdx = 0;
    for (int f = 0; f < numF; ++f)
        for (int c = 0; c < numCh; ++c) {
            float s = 0.0f;
            if (formatTag == 3 && bps == 4) {
                uint32_t bits;
                std::memcpy(&bits, &raw[byteIdx], 4);
                float fv;
                std::memcpy(&fv, &bits, 4);
                s = clampSample(fv);
                byteIdx += 4;
            } else if (formatTag == 1) {
                int32_t rv = 0;
                if (bps == 2) { rv = static_cast<int16_t>(readLe<uint16_t>(raw.data(), byteIdx)); byteIdx += 2; }
                else if (bps == 3) {
                    uint32_t u = readLe<uint32_t>(raw.data(), byteIdx) & 0x00FFFFFF;
                    rv = static_cast<int32_t>(u);
                    if (rv & 0x00800000) rv |= 0xFF000000;
                    byteIdx += 3;
                } else if (bps == 4) { rv = static_cast<int32_t>(readLe<uint32_t>(raw.data(), byteIdx)); byteIdx += 4; }
                s = clampSample(intToFloat(rv, bitsPerSample));
            }
            chData[static_cast<size_t>(c)][static_cast<size_t>(f)] = s;
        }

    // Average to mono
    samples.resize(static_cast<size_t>(numF));
    if (numCh == 1) {
        samples = chData[0];
    } else {
        for (int f = 0; f < numF; ++f) {
            double sum = 0.0;
            for (int c = 0; c < numCh; ++c)
                sum += chData[static_cast<size_t>(c)][static_cast<size_t>(f)];
            samples[static_cast<size_t>(f)] = static_cast<float>(sum / numCh);
        }
    }
    return true;
}

bool ConvolutionProcessor::loadIr(const std::string& wavFilePath) {
    clearIr();
    std::vector<float> mono;
    int channels = 0, sampleRate = 0;
    if (!parseWavFile(wavFilePath, mono, channels, sampleRate) || mono.empty())
        return false;
    irData_ = mono;
    irLength_ = static_cast<int>(mono.size());
    irLoaded_ = true;
    useDirectConvolution_ = true;
    return true;
}

bool ConvolutionProcessor::loadIrFromSamples(const float* samples,
                                              int numSamples,
                                              int numChannels) {
    clearIr();
    if (!samples || numSamples <= 0 || numChannels <= 0) return false;

    if (numChannels == 1) {
        irData_.assign(samples, samples + numSamples);
    } else {
        irData_.resize(static_cast<size_t>(numSamples));
        for (int f = 0; f < numSamples; ++f) {
            double sum = 0.0;
            for (int c = 0; c < numChannels; ++c)
                sum += samples[static_cast<size_t>(f) * static_cast<size_t>(numChannels) + static_cast<size_t>(c)];
            irData_[static_cast<size_t>(f)] = static_cast<float>(sum / numChannels);
        }
    }
    irLength_ = numSamples;
    irLoaded_ = true;
    useDirectConvolution_ = true;
    return true;
}

void ConvolutionProcessor::clearIr() {
    irData_.clear();
    irLength_ = 0;
    irLoaded_ = false;
    useDirectConvolution_ = true;
    destroyPartitions();
    reset();
}

static int nextPow2(int x) {
    if (x <= 1) return 1;
    int p = 1;
    while (p < x) p <<= 1;
    return p;
}

// ── Prepare / Reset ──────────────────────────────────────────────────────

void ConvolutionProcessor::prepare(int blockSize, int channels) {
    blockSize_ = blockSize;
    numChannels_ = std::max(1, channels);
    prepared_ = true;

    destroyPartitions();

    if (irLoaded_) {
        // Partition size = blockSize (or next power of 2).
        // For very short IRs, use direct convolution instead.
        const int ps = std::max(nextPow2(blockSize), 64);
        if (irLength_ > kDirectConvolutionLimit && irLength_ > ps) {
            partitionSize_ = ps;
            useDirectConvolution_ = false;
            buildPartitions(irData_);
        } else {
            useDirectConvolution_ = true;
        }
    } else {
        useDirectConvolution_ = true;
    }

    const size_t ovLen =
        static_cast<size_t>(useDirectConvolution_
                                ? (irLength_ > 0 ? irLength_ : kDirectConvolutionLimit)
                                : partitionSize_);
    channels_.assign(static_cast<size_t>(numChannels_), ChannelState{});
    for (auto& ch : channels_) {
        ch.overlap.assign(ovLen, 0.0f);
        if (!useDirectConvolution_ && numPartitions_ > 0) {
            ch.inputRing.assign(
                static_cast<size_t>(numPartitions_) * static_cast<size_t>(fftSize_),
                kiss_fft_cpx{0.0f, 0.0f});
        }
    }

    reset();
}

void ConvolutionProcessor::reset() {
    for (auto& ch : channels_) {
        if (!ch.inputRing.empty())
            std::memset(ch.inputRing.data(), 0,
                        ch.inputRing.size() * sizeof(kiss_fft_cpx));
        if (!ch.overlap.empty())
            std::memset(ch.overlap.data(), 0,
                        ch.overlap.size() * sizeof(float));
        ch.ringWriteIdx = 0;
        ch.blockCounter = 0;
    }
}

// ── Partition management ─────────────────────────────────────────────────

void ConvolutionProcessor::buildPartitions(const std::vector<float>& ir) {
    destroyPartitions();
    if (ir.empty()) return;

    fftSize_ = partitionSize_ * 2;
    numPartitions_ = (irLength_ + partitionSize_ - 1) / partitionSize_;

    if (!ensureFftPlans(fftSize_)) return;

    freqPartitions_.resize(static_cast<size_t>(numPartitions_));
    for (auto& part : freqPartitions_)
        part.assign(static_cast<size_t>(fftSize_), kiss_fft_cpx{0.0f, 0.0f});

    std::vector<kiss_fft_cpx> tbuf(static_cast<size_t>(fftSize_),
                                   kiss_fft_cpx{0.0f, 0.0f});

    for (int p = 0; p < numPartitions_; ++p) {
        std::memset(tbuf.data(), 0, tbuf.size() * sizeof(kiss_fft_cpx));
        const int off = p * partitionSize_;
        const int rem = irLength_ - off;
        const int n = std::min(partitionSize_, rem);
        for (int i = 0; i < n; ++i)
            tbuf[static_cast<size_t>(i)].r = ir[static_cast<size_t>(off + i)];
        kiss_fft(forwardCfg_, tbuf.data(),
                 freqPartitions_[static_cast<size_t>(p)].data());
    }
}

void ConvolutionProcessor::destroyPartitions() {
    freqPartitions_.clear();
    numPartitions_ = 0;
    fftSize_ = 0;
}

// ── FFT infrastructure ───────────────────────────────────────────────────

bool ConvolutionProcessor::ensureFftPlans(int nfft) {
    if (forwardCfg_ && inverseCfg_ && fftSize_ == nfft) return true;
    destroyFftPlans();

    forwardCfg_ = kiss_fft_alloc(nfft, 0, nullptr, nullptr);
    if (!forwardCfg_) return false;

    inverseCfg_ = kiss_fft_alloc(nfft, 1, nullptr, nullptr);
    if (!inverseCfg_) { kiss_fft_free(forwardCfg_); forwardCfg_ = nullptr; return false; }

    fftSize_ = nfft;
    const size_t sz = static_cast<size_t>(nfft);
    scratchFreq_.assign(sz, kiss_fft_cpx{0.0f, 0.0f});
    scratchAccum_.assign(sz, kiss_fft_cpx{0.0f, 0.0f});
    scratchTime_.assign(sz, kiss_fft_cpx{0.0f, 0.0f});
    return true;
}

void ConvolutionProcessor::destroyFftPlans() {
    if (forwardCfg_) { kiss_fft_free(forwardCfg_); forwardCfg_ = nullptr; }
    if (inverseCfg_) { kiss_fft_free(inverseCfg_); inverseCfg_ = nullptr; }
    scratchFreq_.clear();
    scratchAccum_.clear();
    scratchTime_.clear();
}

// ── Processing ────────────────────────────────────────────────────────────

void ConvolutionProcessor::processBlock(const float* input,
                                         float* output,
                                         int frameCount,
                                         int channels) {
    if (!input || !output || frameCount <= 0 || channels <= 0) return;

    if (!enabled_ || !irLoaded_ || irLength_ <= 0) {
        if (output != input)
            std::memcpy(output, input,
                        static_cast<size_t>(frameCount) *
                            static_cast<size_t>(channels) * sizeof(float));
        return;
    }

    if (channels_.empty()) {
        prepare(nextPow2(frameCount), channels);
    }
    if (static_cast<int>(channels_.size()) != channels)
        prepare(frameCount, channels);

    if (useDirectConvolution_)
        processDirect(input, output, frameCount, channels);
    else
        processPartitioned(input, output, frameCount, channels);
}

// ── Direct convolution (circular history) ────────────────────────────────

void ConvolutionProcessor::processDirect(const float* input,
                                          float* output,
                                          int frameCount,
                                          int channels) {
    const int L = irLength_;

    for (int ch = 0; ch < channels; ++ch) {
        auto& st = channels_[static_cast<size_t>(ch)];
        const int stride = channels;
        int iIdx = ch, oIdx = ch;

        for (int f = 0; f < frameCount; ++f) {
            st.overlap[static_cast<size_t>(st.ringWriteIdx)] = input[iIdx];

            double y = 0.0;
            for (int k = 0; k < L; ++k) {
                int h = st.ringWriteIdx - k;
                if (h < 0) h += L;
                y += static_cast<double>(irData_[static_cast<size_t>(k)]) *
                     static_cast<double>(st.overlap[static_cast<size_t>(h)]);
            }
            output[oIdx] = static_cast<float>(y);
            st.ringWriteIdx = (st.ringWriteIdx + 1) % L;
            iIdx += stride;
            oIdx += stride;
        }
    }
}

// ── Partitioned FFT convolution (overlap-add, Gardner 1994) ──────────────

void ConvolutionProcessor::processPartitioned(const float* input,
                                               float* output,
                                               int frameCount,
                                               int channels) {
    const int N = partitionSize_;
    const int fftSz = fftSize_;
    const int M = numPartitions_;

    for (int ch = 0; ch < channels; ++ch) {
        auto& st = channels_[static_cast<size_t>(ch)];
        const int stride = channels;

        int inPos = 0;
        while (inPos < frameCount) {
            const int chunk = std::min(N, frameCount - inPos);

            // Step 1: pack chunk into FFT buffer (zero-pad if partial)
            std::memset(scratchFreq_.data(), 0,
                        fftSz * sizeof(kiss_fft_cpx));
            {
                int srcIdx = (inPos * stride) + ch;
                for (int i = 0; i < chunk; ++i) {
                    scratchFreq_[static_cast<size_t>(i)].r = input[srcIdx];
                    srcIdx += stride;
                }
            }

            // Step 2: FFT
            kiss_fft(forwardCfg_, scratchFreq_.data(), scratchFreq_.data());

            // Step 3: store in ring buffer
            kiss_fft_cpx* ringEntry =
                &st.inputRing[static_cast<size_t>(st.ringWriteIdx) *
                              static_cast<size_t>(fftSz)];
            std::memcpy(ringEntry, scratchFreq_.data(),
                        fftSz * sizeof(kiss_fft_cpx));

            // Step 4: accumulate in frequency domain
            std::memset(scratchAccum_.data(), 0,
                        fftSz * sizeof(kiss_fft_cpx));

            const int valid = std::min(st.blockCounter + 1, M);
            for (int p = 0; p < valid; ++p) {
                const int rdIdx = (st.ringWriteIdx - p + M) % M;
                const kiss_fft_cpx* rp =
                    &st.inputRing[static_cast<size_t>(rdIdx) *
                                  static_cast<size_t>(fftSz)];
                const kiss_fft_cpx* hp =
                    freqPartitions_[static_cast<size_t>(p)].data();

                for (int k = 0; k < fftSz; ++k) {
                    const float ar = rp[k].r, ai = rp[k].i;
                    const float br = hp[k].r, bi = hp[k].i;
                    scratchAccum_[static_cast<size_t>(k)].r += ar * br - ai * bi;
                    scratchAccum_[static_cast<size_t>(k)].i += ar * bi + ai * br;
                }
            }

            // Step 5: IFFT
            std::memset(scratchTime_.data(), 0,
                        fftSz * sizeof(kiss_fft_cpx));
            kiss_fft(inverseCfg_, scratchAccum_.data(), scratchTime_.data());

            const float invFftSz = 1.0f / static_cast<float>(fftSz);

            // Step 6: output with overlap
            const int outBase = inPos * stride;
            for (int i = 0; i < chunk; ++i) {
                const float t = scratchTime_[static_cast<size_t>(i)].r * invFftSz;
                const float ov = st.overlap[static_cast<size_t>(i)];
                output[outBase + i * stride + ch] = t + ov;
            }

            // Step 7: save new overlap (only for full blocks)
            if (chunk == N) {
                for (int i = 0; i < N; ++i)
                    st.overlap[static_cast<size_t>(i)] =
                        scratchTime_[static_cast<size_t>(N + i)].r * invFftSz;
            }

            st.ringWriteIdx = (st.ringWriteIdx + 1) % M;
            st.blockCounter++;
            inPos += chunk;
        }
    }
}

// ── Control ──────────────────────────────────────────────────────────────

void ConvolutionProcessor::setEnabled(bool enabled) { enabled_ = enabled; }
bool ConvolutionProcessor::isEnabled() const {
    return enabled_ && irLoaded_ && irLength_ > 0;
}

} // namespace echo_audio_daemon
