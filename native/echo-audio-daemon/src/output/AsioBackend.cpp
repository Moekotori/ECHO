#include "AsioBackend.h"

#ifdef _WIN32
#define ECHO_ENABLE_ASIO 1
#endif

#ifdef ECHO_ENABLE_ASIO

#include "../common/AudioTypes.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "asiosys.h"
#include "asio.h"
#include "asiodrivers.h"

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace echo_audio_daemon {

// ==========================================================================
// ── Simple Ring Buffer ───────────────────────────────────────────────────
// ==========================================================================

class SimpleRingBuffer {
public:
    explicit SimpleRingBuffer(int capacity)
        : capacity_(nextPowerOf2(std::max(1, capacity)))
    { reset(); }

    void reset() { writeIndex_ = 0; readIndex_ = 0; }

    int getNumReady() const { return writeIndex_ - readIndex_; }
    int getFreeSpace() const { return capacity_ - (writeIndex_ - readIndex_); }
    int getCapacity() const { return capacity_; }

    void prepareToRead(int numWanted,
                       int& start1, int& size1,
                       int& start2, int& size2) const
    {
        const int avail = std::min(numWanted, getNumReady());
        const int mask = capacity_ - 1;
        start1 = readIndex_ & mask;
        size1 = std::min(avail, capacity_ - start1);
        start2 = 0;
        size2 = avail - size1;
    }

    void finishedRead(int num) { readIndex_ += num; }

    void prepareToWrite(int numWanted,
                        int& start1, int& size1,
                        int& start2, int& size2) const
    {
        const int avail = std::min(numWanted, getFreeSpace());
        const int mask = capacity_ - 1;
        start1 = writeIndex_ & mask;
        size1 = std::min(avail, capacity_ - start1);
        start2 = 0;
        size2 = avail - size1;
    }

    void finishedWrite(int num) { writeIndex_ += num; }

private:
    static int nextPowerOf2(int n) {
        int p = 1;
        while (p < n) p <<= 1;
        return p;
    }
    int capacity_;
    int writeIndex_ = 0;
    int readIndex_ = 0;
};


// ==========================================================================
// ── Constants ────────────────────────────────────────────────────────────
// ==========================================================================

constexpr long kMaxAsioInputChannels  = 8;
constexpr long kMaxAsioOutputChannels = 8;
constexpr long kMaxAsioTotalChannels  = kMaxAsioInputChannels + kMaxAsioOutputChannels;
constexpr long kMaxAsioDrivers        = 64;


// ==========================================================================
// ── ASIO Runtime ─────────────────────────────────────────────────────────
// ==========================================================================

struct AsioRuntime {
    ASIODriverInfo    driverInfo{};
    ASIOCallbacks     callbacks{};
    ASIOBufferInfo    bufferInfos[kMaxAsioTotalChannels]{};
    ASIOChannelInfo   channelInfos[kMaxAsioTotalChannels]{};
    long              inputChannelCount      = 0;
    long              outputChannelCount     = 0;
    long              totalChannelCount      = 0;
    long              outputChannelOffset    = 0;
    long              outputChannelStart     = 0;
    long              bufferSize             = 0;
    long              minBufferSize          = 0;
    long              maxBufferSize          = 0;
    long              preferredBufferSize    = 0;
    long              granularity            = 0;
    uint32_t          requestedSampleRate    = 0;
    ASIOSampleRate    sampleRate             = 0.0;
    ASIOBool          postOutput             = ASIOFalse;
    uint32_t          sourceChannels         = 0;
    float*            scratch                = nullptr;
    uint32_t*         dopScratch             = nullptr;
    uint8_t*          nativeDsdScratch       = nullptr;
    HWND              sysRefWindow           = nullptr;
    bool              dopMode                = false;
    bool              nativeDsdMode          = false;
    bool              nativeDsdFormatApplied = false;
    bool              nativeDsdForcePackedMsb = false;
    volatile LONG     renderFailed           = 0;
    bool              initialized            = false;
    bool              buffersCreated         = false;
    bool              started                = false;
    char              selectedName[512]{};

    unsigned int (*pcmCallback)(void*, float*, unsigned int, unsigned int)       = nullptr;
    unsigned int (*dopCallback)(void*, uint32_t*, unsigned int, unsigned int)    = nullptr;
    unsigned int (*nativeDsdCallback)(void*, uint8_t*, unsigned int, unsigned int) = nullptr;
    void* callbackUserData = nullptr;
};


// ==========================================================================
// ── Ring-State Types ─────────────────────────────────────────────────────
// ==========================================================================

struct PcmRingState {
    int                   channels = 0;
    int                   capacityFrames = 0;
    SimpleRingBuffer      indexFifo{0};
    std::vector<float>    buffer;
    mutable std::mutex    mutex;
    std::atomic<bool>     inputEnded{false};
    std::atomic<bool>     sessionHasAudio{false};
    std::atomic<uint64_t> framesPlayed{0};
    std::atomic<uint64_t> underrunCallbacks{0};
    std::atomic<uint64_t> underrunFrames{0};
    std::atomic<bool>     stopRequested{false};
};

struct DopRingState {
    int                   channels = 0;
    int                   capacityFrames = 0;
    SimpleRingBuffer      indexFifo{0};
    std::vector<uint32_t> buffer;
    mutable std::mutex    mutex;
    std::atomic<bool>     inputEnded{false};
    std::atomic<bool>     sessionHasAudio{false};
    std::atomic<uint64_t> framesPlayed{0};
    std::atomic<uint64_t> underrunCallbacks{0};
    std::atomic<uint64_t> underrunFrames{0};
    std::atomic<bool>     stopRequested{false};
};

struct NativeDsdRingState {
    int                   channels = 0;
    int                   capacityByteFrames = 0;
    SimpleRingBuffer      indexFifo{0};
    std::vector<uint8_t>  buffer;
    mutable std::mutex    mutex;
    std::atomic<bool>     inputEnded{false};
    std::atomic<bool>     sessionHasAudio{false};
    std::atomic<uint64_t> framesPlayed{0};
    std::atomic<uint64_t> underrunCallbacks{0};
    std::atomic<uint64_t> underrunFrames{0};
    std::atomic<bool>     stopRequested{false};
};


// ==========================================================================
// ── Global Active Runtime ────────────────────────────────────────────────
// ==========================================================================

namespace {
    std::atomic<AsioRuntime*> g_activeRuntime{nullptr};
    std::atomic<int>          g_activeAsioCallbacks{0};

    struct AsioCallbackGuard {
        AsioCallbackGuard() { g_activeAsioCallbacks.fetch_add(1, std::memory_order_acq_rel); }
        ~AsioCallbackGuard() { g_activeAsioCallbacks.fetch_sub(1, std::memory_order_acq_rel); }
    };

    void waitForAsioCallbacks() {
        for (int i = 0; i < 1000; ++i) {
            if (g_activeAsioCallbacks.load(std::memory_order_acquire) == 0) return;
            Sleep(1);
        }
    }
}


// ==========================================================================
// ── Helpers ──────────────────────────────────────────────────────────────
// ==========================================================================

namespace {

const char* asioErrorName(ASIOError e) {
    switch (e) {
        case ASE_OK:               return "ASE_OK";
        case ASE_NotPresent:       return "ASE_NotPresent";
        case ASE_HWMalfunction:    return "ASE_HWMalfunction";
        case ASE_InvalidParameter: return "ASE_InvalidParameter";
        case ASE_InvalidMode:      return "ASE_InvalidMode";
        case ASE_SPNotAdvancing:   return "ASE_SPNotAdvancing";
        case ASE_NoClock:          return "ASE_NoClock";
        case ASE_NoMemory:         return "ASE_NoMemory";
        default:                   return "ASE_Unknown";
    }
}

int containsIcase(const char* h, const char* n) {
    if (!h || !n) return 0;
    size_t hl = strlen(h), nl = strlen(n);
    if (nl == 0) return 1;
    if (hl < nl) return 0;
    for (size_t i = 0; i + nl <= hl; ++i) {
        size_t j = 0;
        while (j < nl) {
            if (tolower(static_cast<unsigned char>(h[i + j]))
                != tolower(static_cast<unsigned char>(n[j]))) break;
            ++j;
        }
        if (j == nl) return 1;
    }
    return 0;
}

void ansiToUtf8(const char* in, char* out, int outLen) {
    if (!out || outLen <= 0) return; out[0] = '\0';
    if (!in || !in[0]) return;
    int wl = MultiByteToWideChar(CP_ACP, 0, in, -1, nullptr, 0);
    if (wl <= 0) { snprintf(out, static_cast<size_t>(outLen), "%s", in); return; }
    std::vector<wchar_t> w(static_cast<size_t>(wl));
    if (MultiByteToWideChar(CP_ACP, 0, in, -1, w.data(), wl) <= 0) return;
    WideCharToMultiByte(CP_UTF8, 0, w.data(), -1, out, outLen, nullptr, nullptr);
}

void utf8ToAnsi(const char* in, char* out, int outLen) {
    if (!out || outLen <= 0) return; out[0] = '\0';
    if (!in || !in[0]) return;
    int wl = MultiByteToWideChar(CP_UTF8, 0, in, -1, nullptr, 0);
    if (wl <= 0) { snprintf(out, static_cast<size_t>(outLen), "%s", in); return; }
    std::vector<wchar_t> w(static_cast<size_t>(wl));
    if (MultiByteToWideChar(CP_UTF8, 0, in, -1, w.data(), wl) <= 0) return;
    WideCharToMultiByte(CP_ACP, 0, w.data(), -1, out, outLen, nullptr, nullptr);
}

float clampSample(float s) {
    if (s > 1.0f) return 1.0f;
    if (s < -1.0f) return -1.0f;
    return s;
}

void writeU16BE(unsigned char* t, uint16_t v) {
    t[0] = static_cast<unsigned char>((v >> 8) & 0xff);
    t[1] = static_cast<unsigned char>(v & 0xff);
}

void writeU24LE(unsigned char* t, int32_t v) {
    t[0] = static_cast<unsigned char>(v & 0xff);
    t[1] = static_cast<unsigned char>((v >> 8) & 0xff);
    t[2] = static_cast<unsigned char>((v >> 16) & 0xff);
}

void writeU24BE(unsigned char* t, int32_t v) {
    t[0] = static_cast<unsigned char>((v >> 16) & 0xff);
    t[1] = static_cast<unsigned char>((v >> 8) & 0xff);
    t[2] = static_cast<unsigned char>(v & 0xff);
}

void writeU32BE(unsigned char* t, uint32_t v) {
    t[0] = static_cast<unsigned char>((v >> 24) & 0xff);
    t[1] = static_cast<unsigned char>((v >> 16) & 0xff);
    t[2] = static_cast<unsigned char>((v >> 8) & 0xff);
    t[3] = static_cast<unsigned char>(v & 0xff);
}

int32_t scaledIntSample(float s, int bits) {
    const double peak = static_cast<double>((1u << (bits - 1)) - 1u);
    return static_cast<int32_t>(clampSample(s) * peak);
}

int32_t alignedI32Sample(float s, int vb) {
    return scaledIntSample(s, vb) << (32 - vb);
}

void writeAsioSample(void* buf, ASIOSampleType type, long fi, float s) {
    auto* b = static_cast<unsigned char*>(buf);
    switch (type) {
        case ASIOSTInt16LSB:
            reinterpret_cast<int16_t*>(buf)[fi] = static_cast<int16_t>(scaledIntSample(s, 16));
            break;
        case ASIOSTInt16MSB:
            writeU16BE(b + fi * 2, static_cast<uint16_t>(static_cast<int16_t>(scaledIntSample(s, 16))));
            break;
        case ASIOSTInt24LSB:
            writeU24LE(b + fi * 3, scaledIntSample(s, 24));
            break;
        case ASIOSTInt24MSB:
            writeU24BE(b + fi * 3, scaledIntSample(s, 24));
            break;
        case ASIOSTInt32LSB:
            reinterpret_cast<int32_t*>(buf)[fi] = scaledIntSample(s, 32);
            break;
        case ASIOSTInt32MSB:
            writeU32BE(b + fi * 4, static_cast<uint32_t>(scaledIntSample(s, 32)));
            break;
        case ASIOSTInt32LSB16:
            reinterpret_cast<int32_t*>(buf)[fi] = alignedI32Sample(s, 16);
            break;
        case ASIOSTInt32LSB18:
            reinterpret_cast<int32_t*>(buf)[fi] = alignedI32Sample(s, 18);
            break;
        case ASIOSTInt32LSB20:
            reinterpret_cast<int32_t*>(buf)[fi] = alignedI32Sample(s, 20);
            break;
        case ASIOSTInt32LSB24:
            reinterpret_cast<int32_t*>(buf)[fi] = alignedI32Sample(s, 24);
            break;
        case ASIOSTInt32MSB16:
            writeU32BE(b + fi * 4, static_cast<uint32_t>(alignedI32Sample(s, 16)));
            break;
        case ASIOSTInt32MSB18:
            writeU32BE(b + fi * 4, static_cast<uint32_t>(alignedI32Sample(s, 18)));
            break;
        case ASIOSTInt32MSB20:
            writeU32BE(b + fi * 4, static_cast<uint32_t>(alignedI32Sample(s, 20)));
            break;
        case ASIOSTInt32MSB24:
            writeU32BE(b + fi * 4, static_cast<uint32_t>(alignedI32Sample(s, 24)));
            break;
        case ASIOSTFloat32LSB:
            reinterpret_cast<float*>(buf)[fi] = clampSample(s);
            break;
        case ASIOSTFloat32MSB: {
            union { float f; uint32_t u; } cv;
            cv.f = clampSample(s);
            writeU32BE(b + fi * 4, cv.u);
            break;
        }
        case ASIOSTFloat64LSB:
            reinterpret_cast<double*>(buf)[fi] = static_cast<double>(clampSample(s));
            break;
        case ASIOSTFloat64MSB: {
            union { double d; uint64_t u; } cv;
            cv.d = static_cast<double>(clampSample(s));
            auto* t = b + fi * 8;
            t[0] = static_cast<unsigned char>((cv.u >> 56) & 0xff);
            t[1] = static_cast<unsigned char>((cv.u >> 48) & 0xff);
            t[2] = static_cast<unsigned char>((cv.u >> 40) & 0xff);
            t[3] = static_cast<unsigned char>((cv.u >> 32) & 0xff);
            t[4] = static_cast<unsigned char>((cv.u >> 24) & 0xff);
            t[5] = static_cast<unsigned char>((cv.u >> 16) & 0xff);
            t[6] = static_cast<unsigned char>((cv.u >> 8) & 0xff);
            t[7] = static_cast<unsigned char>(cv.u & 0xff);
            break;
        }
        default:
            break;
    }
}

void writeAsioDopSample(void* buf, ASIOSampleType type, long fi, uint32_t s24) {
    auto* b = static_cast<unsigned char*>(buf);
    const uint32_t payload = s24 & 0x00ffffffu;
    const auto db1 = static_cast<unsigned char>(payload & 0xffu);
    const auto db2 = static_cast<unsigned char>((payload >> 8) & 0xffu);
    const auto mk  = static_cast<unsigned char>((payload >> 16) & 0xffu);
    switch (type) {
        case ASIOSTInt24LSB:
            b[fi * 3 + 0] = mk; b[fi * 3 + 1] = db1; b[fi * 3 + 2] = db2;
            break;
        case ASIOSTInt24MSB:
            b[fi * 3 + 0] = static_cast<unsigned char>((payload >> 16) & 0xff);
            b[fi * 3 + 1] = static_cast<unsigned char>((payload >> 8) & 0xff);
            b[fi * 3 + 2] = static_cast<unsigned char>(payload & 0xff);
            break;
        case ASIOSTInt32LSB24:
            reinterpret_cast<uint32_t*>(buf)[fi] = payload << 8;
            break;
        case ASIOSTInt32LSB:
            reinterpret_cast<uint32_t*>(buf)[fi] =
                (static_cast<uint32_t>(mk) << 24) | (static_cast<uint32_t>(mk) << 16)
                | (static_cast<uint32_t>(db1) << 8) | static_cast<uint32_t>(db2);
            break;
        case ASIOSTInt32MSB24:
        case ASIOSTInt32MSB:
            writeU32BE(b + fi * 4, payload << 8);
            break;
        default:
            break;
    }
}

unsigned char reverseBits(unsigned char b) {
    b = static_cast<unsigned char>(((b & 0xf0u) >> 4) | ((b & 0x0fu) << 4));
    b = static_cast<unsigned char>(((b & 0xccu) >> 2) | ((b & 0x33u) << 2));
    b = static_cast<unsigned char>(((b & 0xaau) >> 1) | ((b & 0x55u) << 1));
    return b;
}

bool asioNativeDsdSampleTypeSupported(ASIOSampleType t) {
    return t == ASIOSTDSDInt8LSB1 || t == ASIOSTDSDInt8MSB1 || t == ASIOSTDSDInt8NER8;
}

uint32_t asioNativeDsdSourceByteFrames(ASIOSampleType, uint32_t fc) {
    return (fc + 7u) / 8u;
}

uint32_t asioNativeDsdOutputBytes(ASIOSampleType t, uint32_t fc) {
    switch (t) {
        case ASIOSTDSDInt8LSB1: case ASIOSTDSDInt8MSB1: return (fc + 7u) / 8u;
        case ASIOSTDSDInt8NER8: return fc;
        default: return 0;
    }
}

void writeAsioNativeDsdSamples(void* buf, ASIOSampleType type, uint32_t fc,
                                const uint8_t* src, uint32_t srcBf,
                                uint32_t srcCh, uint32_t srcChIdx, bool forceMsb)
{
    auto* b = static_cast<unsigned char*>(buf);
    const uint32_t outBytes = asioNativeDsdOutputBytes(type, fc);
    const unsigned char silence = 0x69;
    const bool msb = forceMsb || type == ASIOSTDSDInt8MSB1;

    if (type == ASIOSTDSDInt8NER8) {
        for (uint32_t f = 0; f < fc; ++f) {
            unsigned char v = silence;
            uint32_t sbf = f / 8u;
            uint32_t sbit = msb ? 7u - (f % 8u) : f % 8u;
            if (src && srcCh > 0 && srcChIdx < srcCh && sbf < srcBf)
                v = src[static_cast<size_t>(sbf) * srcCh + srcChIdx];
            b[f] = static_cast<unsigned char>((v >> sbit) & 0x01u);
        }
        return;
    }
    for (uint32_t bf = 0; bf < outBytes; ++bf) {
        unsigned char v = silence;
        if (src && srcCh > 0 && srcChIdx < srcCh && bf < srcBf)
            v = src[static_cast<size_t>(bf) * srcCh + srcChIdx];
        b[bf] = msb ? reverseBits(v) : v;
    }
}

bool asioSampleTypeSupported(ASIOSampleType t) {
    switch (t) {
        case ASIOSTInt16LSB: case ASIOSTInt24LSB: case ASIOSTInt32LSB:
        case ASIOSTFloat32LSB: case ASIOSTFloat64LSB:
        case ASIOSTInt32LSB16: case ASIOSTInt32LSB18: case ASIOSTInt32LSB20: case ASIOSTInt32LSB24:
        case ASIOSTInt16MSB: case ASIOSTInt24MSB: case ASIOSTInt32MSB:
        case ASIOSTFloat32MSB: case ASIOSTFloat64MSB:
        case ASIOSTInt32MSB16: case ASIOSTInt32MSB18: case ASIOSTInt32MSB20: case ASIOSTInt32MSB24:
            return true;
        default: return false;
    }
}

bool asioDopSampleTypeSupported(ASIOSampleType t) {
    switch (t) {
        case ASIOSTInt24LSB: case ASIOSTInt24MSB:
        case ASIOSTInt32LSB24: case ASIOSTInt32MSB24:
        case ASIOSTInt32LSB: case ASIOSTInt32MSB:
            return true;
        default: return false;
    }
}

const char* asioSampleTypeName(ASIOSampleType t) {
    switch (t) {
        case ASIOSTInt16LSB: return "int16lsb";    case ASIOSTInt24LSB: return "int24lsb";
        case ASIOSTInt32LSB: return "int32lsb";    case ASIOSTFloat32LSB: return "float32lsb";
        case ASIOSTFloat64LSB: return "float64lsb";
        case ASIOSTInt32LSB16: return "int32lsb16"; case ASIOSTInt32LSB18: return "int32lsb18";
        case ASIOSTInt32LSB20: return "int32lsb20"; case ASIOSTInt32LSB24: return "int32lsb24";
        case ASIOSTInt16MSB: return "int16msb";    case ASIOSTInt24MSB: return "int24msb";
        case ASIOSTInt32MSB: return "int32msb";    case ASIOSTFloat32MSB: return "float32msb";
        case ASIOSTFloat64MSB: return "float64msb";
        case ASIOSTInt32MSB16: return "int32msb16"; case ASIOSTInt32MSB18: return "int32msb18";
        case ASIOSTInt32MSB20: return "int32msb20"; case ASIOSTInt32MSB24: return "int32msb24";
        case ASIOSTDSDInt8LSB1: return "dsd8lsb1"; case ASIOSTDSDInt8MSB1: return "dsd8msb1";
        case ASIOSTDSDInt8NER8: return "dsd8ner8";
        default: return "unsupported";
    }
}

uint32_t dopSilenceSample(long fi) {
    return ((fi & 1L) == 0L) ? 0x050000u : 0xfa0000u;
}

void fillDopSilence(uint32_t* out, uint32_t fc, uint32_t ch) {
    for (uint32_t f = 0; f < fc; ++f) {
        uint32_t s = dopSilenceSample(static_cast<long>(f));
        for (uint32_t c = 0; c < ch; ++c) out[static_cast<size_t>(f) * ch + c] = s;
    }
}

void normalizeDopMarkers(uint32_t* out, uint32_t fc, uint32_t ch) {
    for (uint32_t f = 0; f < fc; ++f) {
        uint32_t mk = (f & 1u) == 0 ? 0x05u : 0xfau;
        for (uint32_t c = 0; c < ch; ++c)
            out[static_cast<size_t>(f) * ch + c] = (out[static_cast<size_t>(f) * ch + c] & 0x0000ffffu) | (mk << 16);
    }
}

ASIOSampleRate asioSampleRateFromUint32(uint32_t sr) { return static_cast<ASIOSampleRate>(sr); }
uint32_t asioSampleRateToUint32(ASIOSampleRate sr) { return static_cast<uint32_t>(sr + 0.5); }
bool asioSampleRateMatches(ASIOSampleRate a, ASIOSampleRate b) { return std::fabs(a - b) < 0.5; }

ASIOSampleRate readAsioSampleRateOr(ASIOSampleRate fallback) {
    ASIOSampleRate r = fallback;
    if (ASIOGetSampleRate(&r) != ASE_OK || r <= 0.0) return fallback;
    return r;
}

ASIOSampleRate waitForAsioSampleRate(ASIOSampleRate req, ASIOSampleRate fb, int attempts, int sleepMs) {
    ASIOSampleRate obs = readAsioSampleRateOr(fb);
    for (int i = 0; i < attempts && !asioSampleRateMatches(obs, req); ++i) {
        Sleep(static_cast<DWORD>(std::max(1, sleepMs)));
        obs = readAsioSampleRateOr(obs);
    }
    return obs;
}

bool tryAsioSampleRatePivot(ASIOSampleRate pivot, ASIOSampleRate req, ASIOSampleRate* actual) {
    if (asioSampleRateMatches(pivot, req) || ASIOCanSampleRate(pivot) != ASE_OK) return false;
    fprintf(stderr, "[echo-audio-daemon] ASIO rate pivot: pivot=%u req=%u\n",
            asioSampleRateToUint32(pivot), asioSampleRateToUint32(req));
    ASIOError r = ASIOSetSampleRate(pivot);
    if (r != ASE_OK) {
        fprintf(stderr, "[echo-audio-daemon] ASIO rate pivot set failed: pivot=%u err=%s(%ld)\n",
                asioSampleRateToUint32(pivot), asioErrorName(r), static_cast<long>(r));
        return false;
    }
    ASIOSampleRate obs = waitForAsioSampleRate(pivot, pivot, 20, 20);
    fprintf(stderr, "[echo-audio-daemon] ASIO rate pivot obs: pivot=%u actual=%u\n",
            asioSampleRateToUint32(pivot), asioSampleRateToUint32(obs));
    Sleep(50);
    r = ASIOSetSampleRate(req);
    if (r != ASE_OK) {
        if (actual) *actual = readAsioSampleRateOr(obs);
        return false;
    }
    ASIOSampleRate fin = waitForAsioSampleRate(req, obs, 35, 20);
    if (actual) *actual = fin;
    fprintf(stderr, "[echo-audio-daemon] ASIO rate pivot done: req=%u actual=%u\n",
            asioSampleRateToUint32(req), asioSampleRateToUint32(fin));
    return asioSampleRateMatches(fin, req);
}

std::vector<ASIOSampleRate> buildAsioSampleRatePivotCandidates(ASIOSampleRate req) {
    const ASIOSampleRate known[] = { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 };
    std::vector<ASIOSampleRate> candidates;
    auto add = [&](ASIOSampleRate r) {
        if (asioSampleRateMatches(r, req)) return;
        if (std::find_if(candidates.begin(), candidates.end(),
            [&](ASIOSampleRate c) { return asioSampleRateMatches(c, r); }) == candidates.end())
            candidates.push_back(r);
    };
    if (!asioSampleRateMatches(req, 48000.0)) add(48000.0);
    for (auto r : known) add(r);
    return candidates;
}

ASIOError setAsioSampleRateAndWait(ASIOSampleRate req, ASIOSampleRate* actual) {
    ASIOError r = ASIOCanSampleRate(req);
    if (r != ASE_OK) { if (actual) *actual = readAsioSampleRateOr(req); return r; }
    r = ASIOSetSampleRate(req);
    if (r != ASE_OK) { if (actual) *actual = readAsioSampleRateOr(req); return r; }
    ASIOSampleRate obs = waitForAsioSampleRate(req, req, 25, 20);
    if (!asioSampleRateMatches(obs, req))
        for (auto p : buildAsioSampleRatePivotCandidates(req))
            if (tryAsioSampleRatePivot(p, req, &obs)) break;
    if (actual) *actual = obs;
    return ASE_OK;
}

bool isPowerOfTwo(long v) { return v > 0 && (v & (v - 1)) == 0; }

bool bufferSizeIsLegal(long size, long mn, long mx, long pref, long gran) {
    if (size <= 0) return false;
    if (mn <= 0) mn = 1;
    if (mx < mn) mx = std::max(mn, pref);
    if (size < mn || size > mx) return false;
    if (size == pref) return true;
    if (gran == -1) return isPowerOfTwo(size);
    if (gran > 0)  return ((size - mn) % gran) == 0;
    return true;
}

void addBufferCandidate(std::vector<long>& c, long size, long mn, long mx, long pref, long gran) {
    if (!bufferSizeIsLegal(size, mn, mx, pref, gran)) return;
    if (std::find(c.begin(), c.end(), size) == c.end()) c.push_back(size);
}

void addNearestLegal(std::vector<long>& c, long size, long mn, long mx, long pref, long gran) {
    if (size <= 0) return;
    if (mn <= 0) mn = 1;
    if (mx < mn) mx = std::max(mn, pref);
    addBufferCandidate(c, size, mn, mx, pref, gran);
    long clamped = std::max(mn, std::min(mx, size));
    addBufferCandidate(c, clamped, mn, mx, pref, gran);
    if (gran == -1) {
        long lower = 1;
        while (lower <= clamped / 2) lower *= 2;
        long upper = lower;
        while (upper < clamped && upper <= mx / 2) upper *= 2;
        addBufferCandidate(c, lower, mn, mx, pref, gran);
        addBufferCandidate(c, upper, mn, mx, pref, gran);
        if (upper <= mx / 2) addBufferCandidate(c, upper * 2, mn, mx, pref, gran);
        return;
    }
    if (gran > 0) {
        long offset = clamped - mn;
        long lower = mn + (offset / gran) * gran;
        addBufferCandidate(c, lower, mn, mx, pref, gran);
        addBufferCandidate(c, lower + gran, mn, mx, pref, gran);
    }
}

std::vector<long> buildBufferCandidates(long mn, long mx, long pref, long gran, uint32_t req) {
    std::vector<long> c;
    long r = static_cast<long>(req);
    if (r > 0) addNearestLegal(c, r, mn, mx, pref, gran);
    addBufferCandidate(c, pref, mn, mx, pref, gran);
    for (long s : { 512L, 1024L, 2048L, 4096L, 8192L, 256L })
        addNearestLegal(c, s, mn, mx, pref, gran);
    addBufferCandidate(c, mn, mn, mx, pref, gran);
    addBufferCandidate(c, mx, mn, mx, pref, gran);
    return c;
}

LRESULT CALLBACK asioHostWndProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
    (void)m; (void)wp; (void)lp;
    return DefWindowProc(h, m, wp, lp);
}

HWND createAsioHostWindow() {
    static const wchar_t* cls = L"EchoAudioDaemonAsioWindow";
    static bool reg = false;
    HINSTANCE inst = GetModuleHandleW(nullptr);
    if (!reg) {
        WNDCLASSW wc{};
        wc.lpfnWndProc = asioHostWndProc;
        wc.hInstance = inst;
        wc.lpszClassName = cls;
        if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return nullptr;
        reg = true;
    }
    return CreateWindowExW(0, cls, L"ECHO Audio Daemon ASIO",
                           WS_OVERLAPPED, 0, 0, 0, 0,
                           nullptr, nullptr, inst, nullptr);
}


// ── Render callbacks ────────────────────────────────────────────────────

unsigned int pcmRenderCb(void* ud, float* out, unsigned int fc, unsigned int ch) {
    auto* st = static_cast<PcmRingState*>(ud);
    if (!st || fc == 0 || !ch) return 0;
    std::memset(out, 0, static_cast<size_t>(fc) * ch * sizeof(float));
    std::lock_guard<std::mutex> lock(st->mutex);
    int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
    st->indexFifo.prepareToRead(static_cast<int>(fc), s1, sz1, s2, sz2);
    int avail = sz1 + sz2;
    if (avail > 0) {
        for (int f = 0; f < sz1; ++f)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(f) * ch + c] =
                    st->buffer[static_cast<size_t>(s1 + f) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        for (int f = 0; f < sz2; ++f)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(f + sz1) * ch + c] =
                    st->buffer[static_cast<size_t>(s2 + f) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        st->indexFifo.finishedRead(avail);
        st->framesPlayed.fetch_add(static_cast<uint64_t>(avail), std::memory_order_relaxed);
    } else if (!st->inputEnded.load(std::memory_order_acquire) && st->sessionHasAudio.load(std::memory_order_acquire)) {
        st->underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
        st->underrunFrames.fetch_add(fc, std::memory_order_relaxed);
    }
    return static_cast<unsigned int>(avail);
}

unsigned int dopRenderCb(void* ud, uint32_t* out, unsigned int fc, unsigned int ch) {
    auto* st = static_cast<DopRingState*>(ud);
    if (!st || fc == 0 || !ch) return 0;
    fillDopSilence(out, fc, ch);
    std::lock_guard<std::mutex> lock(st->mutex);
    int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
    st->indexFifo.prepareToRead(static_cast<int>(fc), s1, sz1, s2, sz2);
    int avail = sz1 + sz2;
    if (avail > 0) {
        for (int f = 0; f < sz1; ++f)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(f) * ch + c] =
                    st->buffer[static_cast<size_t>(s1 + f) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        for (int f = 0; f < sz2; ++f)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(f + sz1) * ch + c] =
                    st->buffer[static_cast<size_t>(s2 + f) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        st->indexFifo.finishedRead(avail);
        st->framesPlayed.fetch_add(static_cast<uint64_t>(avail), std::memory_order_relaxed);
    } else if (!st->inputEnded.load(std::memory_order_acquire) && st->sessionHasAudio.load(std::memory_order_acquire)) {
        st->underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
        st->underrunFrames.fetch_add(fc, std::memory_order_relaxed);
    }
    normalizeDopMarkers(out, fc, ch);
    return static_cast<unsigned int>(avail);
}

unsigned int nativeDsdRenderCb(void* ud, uint8_t* out, unsigned int bfc, unsigned int ch) {
    auto* st = static_cast<NativeDsdRingState*>(ud);
    if (!st || bfc == 0 || !ch) return 0;
    std::memset(out, 0x69, static_cast<size_t>(bfc) * ch);
    std::lock_guard<std::mutex> lock(st->mutex);
    int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
    st->indexFifo.prepareToRead(static_cast<int>(bfc), s1, sz1, s2, sz2);
    int avail = sz1 + sz2;
    if (avail > 0) {
        for (int bf = 0; bf < sz1; ++bf)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(bf) * ch + c] =
                    st->buffer[static_cast<size_t>(s1 + bf) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        for (int bf = 0; bf < sz2; ++bf)
            for (unsigned int c = 0; c < ch; ++c)
                out[static_cast<size_t>(bf + sz1) * ch + c] =
                    st->buffer[static_cast<size_t>(s2 + bf) * static_cast<size_t>(st->channels) + static_cast<size_t>(std::min(static_cast<int>(c), st->channels - 1))];
        st->indexFifo.finishedRead(avail);
        st->framesPlayed.fetch_add(static_cast<uint64_t>(avail) * 8u, std::memory_order_relaxed);
    } else if (!st->inputEnded.load(std::memory_order_acquire) && st->sessionHasAudio.load(std::memory_order_acquire)) {
        st->underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
        st->underrunFrames.fetch_add(static_cast<uint64_t>(bfc) * 8u, std::memory_order_relaxed);
    }
    return static_cast<unsigned int>(avail);
}

} // namespace


// ==========================================================================
// ── Rendering (ASIO bufferSwitch) ───────────────────────────────────────
// ==========================================================================

namespace {

void writeAsioSilence(AsioRuntime* rt, long bi) {
    if (!rt || !rt->buffersCreated || bi < 0 || bi > 1) return;
    const auto fc = static_cast<uint32_t>(std::max<long>(1, rt->bufferSize));
    for (long ch = 0; ch < rt->outputChannelCount; ++ch) {
        long idx = rt->outputChannelOffset + ch;
        if (idx < 0 || idx >= kMaxAsioTotalChannels) continue;
        void* out = rt->bufferInfos[idx].buffers[bi];
        if (!out) continue;
        ASIOSampleType st = rt->channelInfos[idx].type;
        if (rt->nativeDsdMode)
            writeAsioNativeDsdSamples(out, st, fc, nullptr, 0, 0, 0, rt->nativeDsdForcePackedMsb);
        else if (rt->dopMode)
            for (long f = 0; f < rt->bufferSize; ++f) writeAsioDopSample(out, st, f, dopSilenceSample(f));
        else
            for (long f = 0; f < rt->bufferSize; ++f) writeAsioSample(out, st, f, 0.0f);
    }
    if (rt->postOutput) ASIOOutputReady();
}

void renderAsioOutput(AsioRuntime* rt, long bi) {
    if (!rt) return;
    const auto fc = static_cast<uint32_t>(std::max<long>(1, rt->bufferSize));
    const auto sc = static_cast<uint32_t>(std::max<uint32_t>(1, rt->sourceChannels));

    if (rt->nativeDsdMode) {
        if (!rt->nativeDsdScratch || !rt->nativeDsdCallback) return;
        uint32_t sbf = 0;
        for (long ch = 0; ch < rt->outputChannelCount; ++ch)
            sbf = std::max(sbf, asioNativeDsdSourceByteFrames(rt->channelInfos[rt->outputChannelOffset + ch].type, fc));
        sbf = std::max<uint32_t>(1, sbf);
        std::memset(rt->nativeDsdScratch, 0x69, static_cast<size_t>(sbf) * sc);
        rt->nativeDsdCallback(rt->callbackUserData, rt->nativeDsdScratch, sbf, sc);
        for (long ch = 0; ch < rt->outputChannelCount; ++ch) {
            long idx = rt->outputChannelOffset + ch;
            void* out = rt->bufferInfos[idx].buffers[bi];
            auto srcCh = static_cast<uint32_t>(std::min<long>(ch, static_cast<long>(sc) - 1));
            writeAsioNativeDsdSamples(out, rt->channelInfos[idx].type, fc,
                                       rt->nativeDsdScratch, sbf, sc, srcCh, rt->nativeDsdForcePackedMsb);
        }
        if (rt->postOutput) ASIOOutputReady();
        return;
    }

    if (rt->dopMode) {
        if (!rt->dopScratch || !rt->dopCallback) return;
        std::memset(rt->dopScratch, 0, static_cast<size_t>(fc) * sc * sizeof(uint32_t));
        rt->dopCallback(rt->callbackUserData, rt->dopScratch, fc, sc);
        for (long ch = 0; ch < rt->outputChannelCount; ++ch) {
            long idx = rt->outputChannelOffset + ch;
            void* out = rt->bufferInfos[idx].buffers[bi];
            ASIOSampleType st = rt->channelInfos[idx].type;
            auto srcCh = static_cast<uint32_t>(std::min<long>(ch, static_cast<long>(sc) - 1));
            for (long f = 0; f < rt->bufferSize; ++f) {
                uint32_t s = rt->dopScratch[static_cast<size_t>(f) * sc + srcCh];
                writeAsioDopSample(out, st, f, s);
            }
        }
        if (rt->postOutput) ASIOOutputReady();
        return;
    }

    if (!rt->scratch || !rt->pcmCallback) return;
    std::memset(rt->scratch, 0, static_cast<size_t>(fc) * sc * sizeof(float));
    rt->pcmCallback(rt->callbackUserData, rt->scratch, fc, sc);
    for (long ch = 0; ch < rt->outputChannelCount; ++ch) {
        long idx = rt->outputChannelOffset + ch;
        void* out = rt->bufferInfos[idx].buffers[bi];
        ASIOSampleType st = rt->channelInfos[idx].type;
        auto srcCh = static_cast<uint32_t>(std::min<long>(ch, static_cast<long>(sc) - 1));
        for (long f = 0; f < rt->bufferSize; ++f) {
            float s = rt->scratch[static_cast<size_t>(f) * sc + srcCh];
            writeAsioSample(out, st, f, s);
        }
    }
    if (rt->postOutput) ASIOOutputReady();
}

void renderAsioOutputSafely(long bi) noexcept {
    AsioCallbackGuard guard;
    auto* rt = g_activeRuntime.load(std::memory_order_acquire);
    if (!rt) return;
    try { renderAsioOutput(rt, bi); }
    catch (...) { InterlockedExchange(&rt->renderFailed, 1); writeAsioSilence(rt, bi); }
}

void CALLBACK asioBufferSwitch(long index, ASIOBool processNow) {
    (void)processNow; renderAsioOutputSafely(index);
}

ASIOTime* CALLBACK asioBufferSwitchTimeInfo(ASIOTime* params, long index, ASIOBool processNow) {
    (void)processNow; renderAsioOutputSafely(index); return params;
}

void CALLBACK asioSampleRateDidChange(ASIOSampleRate sr) {
    auto* rt = g_activeRuntime.load(std::memory_order_acquire);
    if (rt) rt->sampleRate = sr;
}

long CALLBACK asioMessages(long selector, long value, void* msg, double* opt) {
    (void)msg; (void)opt;
    switch (selector) {
        case kAsioSelectorSupported:
            return (value == kAsioResetRequest || value == kAsioEngineVersion ||
                    value == kAsioResyncRequest || value == kAsioLatenciesChanged ||
                    value == kAsioSupportsTimeInfo || value == kAsioSupportsTimeCode ||
                    value == kAsioSupportsInputMonitor) ? 1L : 0L;
        case kAsioResetRequest: case kAsioResyncRequest: case kAsioLatenciesChanged: return 1L;
        case kAsioEngineVersion: return 2L;
        case kAsioSupportsTimeInfo: return 1L;
        case kAsioSupportsTimeCode: case kAsioSupportsInputMonitor: return 0L;
        default: return 0L;
    }
}


// ── ASIO buffer/channel helpers ─────────────────────────────────────────

void prepareBufferInfos(AsioRuntime* rt, bool inclInputs) {
    std::memset(rt->bufferInfos, 0, sizeof(rt->bufferInfos));
    long idx = 0; rt->outputChannelOffset = 0;
    if (inclInputs) {
        for (long ch = 0; ch < rt->inputChannelCount; ++ch, ++idx) {
            rt->bufferInfos[idx].isInput = ASIOTrue;
            rt->bufferInfos[idx].channelNum = ch;
        }
        rt->outputChannelOffset = rt->inputChannelCount;
    }
    for (long ch = 0; ch < rt->outputChannelCount; ++ch, ++idx) {
        rt->bufferInfos[idx].isInput = ASIOFalse;
        rt->bufferInfos[idx].channelNum = rt->outputChannelStart + ch;
    }
    rt->totalChannelCount = idx;
}

bool populateChannelInfos(AsioRuntime* rt, std::string& err) {
    std::memset(rt->channelInfos, 0, sizeof(rt->channelInfos));
    for (long i = 0; i < rt->totalChannelCount; ++i) {
        rt->channelInfos[i].channel = rt->bufferInfos[i].channelNum;
        rt->channelInfos[i].isInput = rt->bufferInfos[i].isInput;
        ASIOError r = ASIOGetChannelInfo(&rt->channelInfos[i]);
        if (r != ASE_OK) {
            char buf[256]; snprintf(buf, sizeof(buf), "ASIOGetChannelInfo failed driver=\"%s\" ch=%ld err=%s(%ld)",
                                     rt->selectedName, i, asioErrorName(r), static_cast<long>(r));
            err = buf; return false;
        }
        bool ok = rt->nativeDsdMode ? asioNativeDsdSampleTypeSupported(rt->channelInfos[i].type)
                 : rt->dopMode      ? asioDopSampleTypeSupported(rt->channelInfos[i].type)
                 :                    asioSampleTypeSupported(rt->channelInfos[i].type);
        if (!rt->channelInfos[i].isInput && !ok) {
            char buf[256]; snprintf(buf, sizeof(buf), "unsupported ASIO sample type driver=\"%s\" ch=%ld type=%ld",
                                     rt->selectedName, i, static_cast<long>(rt->channelInfos[i].type));
            err = buf; return false;
        }
    }
    return true;
}

bool createBuffersWithCandidates(AsioRuntime* rt, const std::vector<long>& candidates, std::string& err) {
    struct Attempt { long size; ASIOError err; };
    std::vector<Attempt> attempts;
    std::vector<bool> inclInputs;
    if (!rt->dopMode && !rt->nativeDsdMode && rt->inputChannelCount > 0) inclInputs.push_back(true);
    inclInputs.push_back(false);

    for (bool ii : inclInputs) {
        for (long cs : candidates) {
            fprintf(stderr, "[echo-audio-daemon] ASIO trying buffer %lu frames\n", static_cast<unsigned long>(cs));
            prepareBufferInfos(rt, ii);
            ASIOError r = ASIOCreateBuffers(rt->bufferInfos, rt->totalChannelCount, cs, &rt->callbacks);
            if (r == ASE_OK) {
                rt->bufferSize = cs; rt->buffersCreated = true;
                if (populateChannelInfos(rt, err)) return true;
                ASIODisposeBuffers(); rt->buffersCreated = false; continue;
            }
            attempts.push_back({cs, r}); ASIODisposeBuffers();
        }
    }

    char msg[768];
    snprintf(msg, sizeof(msg), "ASIOCreateBuffers failed driver=\"%s\" rate=%u mn=%ld mx=%ld pref=%ld gran=%ld attempts=",
             rt->selectedName, static_cast<unsigned int>(rt->requestedSampleRate),
             rt->minBufferSize, rt->maxBufferSize, rt->preferredBufferSize, rt->granularity);
    err = msg;
    for (size_t i = 0; i < attempts.size(); ++i) {
        char buf[96]; snprintf(buf, sizeof(buf), "%s%ld:%s(%ld)", i == 0 ? "" : ",",
                                attempts[i].size, asioErrorName(attempts[i].err), static_cast<long>(attempts[i].err));
        err += buf;
    }
    return false;
}

bool refreshAsioBufferSize(AsioRuntime* rt, const char* label, std::string& err) {
    long mn = 0, mx = 0, pref = 0, gran = 0;
    ASIOError r = ASIOGetBufferSize(&mn, &mx, &pref, &gran);
    if (r != ASE_OK || pref <= 0) {
        char buf[256]; snprintf(buf, sizeof(buf), "ASIOGetBufferSize failed %s err=%s(%ld)",
                                 label ? label : "", asioErrorName(r), static_cast<long>(r));
        err = buf; return false;
    }
    rt->minBufferSize = mn; rt->maxBufferSize = mx; rt->preferredBufferSize = pref; rt->granularity = gran;
    fprintf(stderr, "[echo-audio-daemon] ASIOGetBufferSize %s: mn=%ld mx=%ld pref=%ld gran=%ld\n",
            label ? label : "", rt->minBufferSize, rt->maxBufferSize, rt->preferredBufferSize, rt->granularity);
    return true;
}

bool retryAsyncCreateAfterRecovery(AsioRuntime* rt, ASIOSampleRate reqRate, uint32_t reqBuf, std::string& err) {
    if (refreshAsioBufferSize(rt, "after-create-failure", err)) {
        auto candidates = buildBufferCandidates(rt->minBufferSize, rt->maxBufferSize,
                                                 rt->preferredBufferSize, rt->granularity, reqBuf);
        if (createBuffersWithCandidates(rt, candidates, err)) return true;
    }
    for (auto pivot : buildAsioSampleRatePivotCandidates(reqRate)) {
        ASIOSampleRate rec = rt->sampleRate;
        if (!tryAsioSampleRatePivot(pivot, reqRate, &rec)) { rt->sampleRate = rec; continue; }
        rt->sampleRate = rec;
        if (!refreshAsioBufferSize(rt, "after-rate-pivot", err)) continue;
        auto candidates = buildBufferCandidates(rt->minBufferSize, rt->maxBufferSize,
                                                 rt->preferredBufferSize, rt->granularity, reqBuf);
        if (createBuffersWithCandidates(rt, candidates, err)) return true;
    }
    return false;
}

std::string outputFormatSummary(const AsioRuntime* rt) {
    if (!rt || rt->outputChannelCount <= 0) return "unknown";
    ASIOSampleType first = rt->channelInfos[rt->outputChannelOffset].type;
    for (long ch = 1; ch < rt->outputChannelCount; ++ch)
        if (rt->channelInfos[rt->outputChannelOffset + ch].type != first) return "mixed";
    return asioSampleTypeName(first);
}

bool setFormatType(ASIOIoFormatType ft, const char* label, std::string& err) {
    ASIOIoFormat f{}; f.FormatType = ft;
    ASIOError r = ASIOFuture(kAsioSetIoFormat, &f);
    if (r == ASE_SUCCESS || r == ASE_OK) return true;
    char buf[256]; snprintf(buf, sizeof(buf), "ASIO %s format switch failed err=%s(%ld)",
                             label ? label : "", asioErrorName(r), static_cast<long>(r));
    err = buf; return false;
}

bool enableNativeDsdFormat(std::string& err) {
    ASIOIoFormat f{}; f.FormatType = kASIODSDFormat;
    ASIOError can = ASIOFuture(kAsioCanDoIoFormat, &f);
    if (can != ASE_SUCCESS && can != ASE_OK) {
        char buf[256]; snprintf(buf, sizeof(buf), "native DSD format unsupported err=%s(%ld)",
                                 asioErrorName(can), static_cast<long>(can));
        err = buf; return false;
    }
    return setFormatType(kASIODSDFormat, "native DSD", err);
}

} // namespace


// ==========================================================================
// ── AsioBackend ─────────────────────────────────────────────────────────
// ==========================================================================

struct AsioBackend::Impl {
    AsioRuntime   runtime{};
    PcmRingState       pcmRing;
    DopRingState       dopRing;
    NativeDsdRingState nativeDsdRing;
    bool openFlag = false;
    int  sampleRate_ = 0;
    int  channels_ = 0;
    int  bufferFrames_ = 0;
    std::vector<float>    pcmScratch;
    std::vector<uint32_t> dopScratch;
    std::vector<uint8_t>  nativeDsdScratch;
};


AsioBackend::AsioBackend() : impl_(std::make_unique<Impl>()) {}
AsioBackend::~AsioBackend() { close(); }

bool AsioBackend::open(const DeviceInfo& device, int sampleRate,
                        int channels, int bufferFrames)
{
    if (isOpen()) close();
    if (!impl_) return false;

    std::vector<DeviceInfo> devList;
    if (!enumerateDevices(devList) || devList.empty()) return false;

    std::string selName;
    for (const auto& d : devList) {
        if (d.name == device.name || d.id == device.id) { selName = d.name; break; }
    }
    if (selName.empty() && !devList.empty()) selName = devList[0].name;
    if (selName.empty()) return false;

    AsioRuntime& rt = impl_->runtime;
    std::memset(&rt, 0, sizeof(rt));

    char ansi[512]{}; utf8ToAnsi(selName.c_str(), ansi, (int)sizeof(ansi));
    if (ansi[0] == '\0') return false;

    snprintf(rt.selectedName, sizeof(rt.selectedName), "%s", selName.c_str());
    rt.sourceChannels = std::max<uint32_t>(1, std::min<uint32_t>(static_cast<uint32_t>(channels), kMaxAsioOutputChannels));
    rt.outputChannelStart = 0;
    rt.requestedSampleRate = static_cast<uint32_t>(sampleRate);
    rt.dopMode = (dsdMode_ == DsdMode::Dop);
    rt.nativeDsdMode = (dsdMode_ == DsdMode::NativeDsd);
    if (rt.nativeDsdMode)
        rt.nativeDsdForcePackedMsb = (containsIcase(selName.c_str(), "TEAC") != 0);

    rt.driverInfo.asioVersion = 2;
    rt.sysRefWindow = createAsioHostWindow();
    rt.driverInfo.sysRef = rt.sysRefWindow ? rt.sysRefWindow : GetDesktopWindow();

    fprintf(stderr, "[echo-audio-daemon] ASIO loadDriver: %s\n", selName.c_str());
    if (!loadAsioDriver(ansi)) return false;

    fprintf(stderr, "[echo-audio-daemon] ASIOInit: %s\n", selName.c_str());
    ASIOError result = ASIOInit(&rt.driverInfo);
    if (result != ASE_OK) { cleanUp(); return false; }
    rt.initialized = true;

    if (rt.nativeDsdMode) {
        std::string err;
        if (!enableNativeDsdFormat(err)) { cleanUp(); return false; }
        rt.nativeDsdFormatApplied = true;
    }

    long availIn = 0, availOut = 0;
    result = ASIOGetChannels(&availIn, &availOut);
    if (result != ASE_OK || availOut <= 0) { cleanUp(); return false; }

    { std::string err; if (!refreshAsioBufferSize(&rt, "initial", err)) { cleanUp(); return false; } }

    ASIOSampleRate reqRate = asioSampleRateFromUint32(static_cast<uint32_t>(sampleRate));
    ASIOSampleRate actRate = reqRate;
    ASIOError srResult = setAsioSampleRateAndWait(reqRate, &actRate);
    rt.sampleRate = actRate;
    if ((rt.dopMode || rt.nativeDsdMode) &&
        (srResult != ASE_OK || asioSampleRateToUint32(actRate) != static_cast<uint32_t>(sampleRate)))
    { cleanUp(); return false; }

    { std::string err; if (!refreshAsioBufferSize(&rt, "after-rate", err)) { cleanUp(); return false; } }

    rt.inputChannelCount = std::min<long>(std::max<long>(0, availIn), kMaxAsioInputChannels);
    rt.outputChannelCount = std::min<long>(
        std::max<long>(1, availOut),
        std::min<long>(kMaxAsioOutputChannels, static_cast<long>(rt.sourceChannels)));

    rt.callbacks.bufferSwitch = asioBufferSwitch;
    rt.callbacks.sampleRateDidChange = asioSampleRateDidChange;
    rt.callbacks.asioMessage = asioMessages;
    rt.callbacks.bufferSwitchTimeInfo = asioBufferSwitchTimeInfo;
    rt.postOutput = (ASIOOutputReady() == ASE_OK) ? ASIOTrue : ASIOFalse;

    auto candidates = buildBufferCandidates(rt.minBufferSize, rt.maxBufferSize,
                                             rt.preferredBufferSize, rt.granularity,
                                             static_cast<uint32_t>(bufferFrames));

    g_activeRuntime.store(&rt, std::memory_order_release);

    {
        std::string err;
        if (!createBuffersWithCandidates(&rt, candidates, err) &&
            !retryAsyncCreateAfterRecovery(&rt, reqRate, static_cast<uint32_t>(bufferFrames), err))
        {
            fprintf(stderr, "[echo-audio-daemon] All ASIO buffer candidates failed: %s\n", err.c_str());
            g_activeRuntime.store(nullptr, std::memory_order_release);
            cleanUp(); return false;
        }
    }

    size_t sf = static_cast<size_t>(std::max<long>(1, rt.bufferSize)) * rt.sourceChannels;
    if (rt.nativeDsdMode) {
        impl_->nativeDsdScratch.assign(sf, 0x69);
        rt.nativeDsdScratch = impl_->nativeDsdScratch.data();
        rt.nativeDsdCallback = nativeDsdRenderCb;
        rt.callbackUserData = &impl_->nativeDsdRing;
    } else if (rt.dopMode) {
        impl_->dopScratch.assign(sf, 0);
        rt.dopScratch = impl_->dopScratch.data();
        rt.dopCallback = dopRenderCb;
        rt.callbackUserData = &impl_->dopRing;
    } else {
        impl_->pcmScratch.assign(sf, 0.0f);
        rt.scratch = impl_->pcmScratch.data();
        rt.pcmCallback = pcmRenderCb;
        rt.callbackUserData = &impl_->pcmRing;
    }

    int ringCap = std::max(4096, bufferFrames * 4);
    if (rt.nativeDsdMode) {
        auto& ring = impl_->nativeDsdRing;
        ring.channels = (int)rt.sourceChannels;
        ring.capacityByteFrames = ringCap;
        ring.indexFifo = SimpleRingBuffer(ringCap);
        ring.buffer.assign((size_t)ringCap * ring.channels, 0x69u);
    } else if (rt.dopMode) {
        auto& ring = impl_->dopRing;
        ring.channels = (int)rt.sourceChannels;
        ring.capacityFrames = ringCap;
        ring.indexFifo = SimpleRingBuffer(ringCap);
        ring.buffer.assign((size_t)ringCap * ring.channels, 0u);
    } else {
        auto& ring = impl_->pcmRing;
        ring.channels = (int)rt.sourceChannels;
        ring.capacityFrames = ringCap;
        ring.indexFifo = SimpleRingBuffer(ringCap);
        ring.buffer.assign((size_t)ringCap * ring.channels, 0.0f);
    }

    result = ASIOStart();
    if (result != ASE_OK) {
        fprintf(stderr, "[echo-audio-daemon] ASIOStart failed: %s(%ld)\n",
                asioErrorName(result), static_cast<long>(result));
        g_activeRuntime.store(nullptr, std::memory_order_release);
        cleanUp(); return false;
    }
    rt.started = true;

    impl_->sampleRate_ = sampleRate;
    impl_->channels_ = (int)rt.sourceChannels;
    impl_->bufferFrames_ = (int)rt.bufferSize;
    impl_->openFlag = true;

    fprintf(stderr, "[echo-audio-daemon] ASIO open OK: dev=%s rate=%u ch=%ld buf=%ld fmt=%s\n",
            selName.c_str(), asioSampleRateToUint32(rt.sampleRate),
            rt.outputChannelCount, rt.bufferSize, outputFormatSummary(&rt).c_str());
    return true;
}

void AsioBackend::close() {
    if (!impl_ || !impl_->openFlag) return;
    if (impl_->runtime.dopMode)
        impl_->dopRing.inputEnded.store(true, std::memory_order_release);
    else if (impl_->runtime.nativeDsdMode)
        impl_->nativeDsdRing.inputEnded.store(true, std::memory_order_release);
    else
        impl_->pcmRing.inputEnded.store(true, std::memory_order_release);
    cleanUp();
}

void AsioBackend::cleanUp() {
    if (!impl_) return;
    AsioRuntime& rt = impl_->runtime;
    g_activeRuntime.store(nullptr, std::memory_order_release);
    waitForAsioCallbacks();
    if (rt.started) { ASIOStop(); rt.started = false; }
    waitForAsioCallbacks();
    if (rt.buffersCreated) { ASIODisposeBuffers(); rt.buffersCreated = false; }
    if (rt.initialized) {
        if (rt.nativeDsdFormatApplied) { std::string ign; setFormatType(kASIOPCMFormat, "PCM", ign); rt.nativeDsdFormatApplied = false; }
        ASIOExit(); rt.initialized = false;
    }
    if (rt.sysRefWindow) { DestroyWindow(rt.sysRefWindow); rt.sysRefWindow = nullptr; }
    if (asioDrivers) asioDrivers->removeCurrentDriver();
    rt.scratch = nullptr; rt.dopScratch = nullptr; rt.nativeDsdScratch = nullptr;
    impl_->pcmScratch.clear(); impl_->dopScratch.clear(); impl_->nativeDsdScratch.clear();
    impl_->openFlag = false;
    fprintf(stderr, "[echo-audio-daemon] ASIO closed\n");
}

bool AsioBackend::write(const float* samples, int frameCount) {
    if (!impl_ || !impl_->openFlag || !samples || frameCount <= 0) return false;
    AsioRuntime& rt = impl_->runtime;

    if (rt.nativeDsdMode) {
        auto& r = impl_->nativeDsdRing;
        auto* src = reinterpret_cast<const uint8_t*>(samples);
        std::lock_guard<std::mutex> lock(r.mutex);
        r.sessionHasAudio.store(true, std::memory_order_release);
        int w = 0;
        while (w < frameCount && !r.stopRequested.load(std::memory_order_relaxed)) {
            int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
            r.indexFifo.prepareToWrite(frameCount - w, s1, sz1, s2, sz2);
            int wr = sz1 + sz2;
            if (wr > 0) {
                memcpy(&r.buffer[(size_t)s1 * r.channels], src + (size_t)w * r.channels, (size_t)wr * r.channels);
                r.indexFifo.finishedWrite(wr); w += wr; continue;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        return w == frameCount;
    }

    if (rt.dopMode) {
        auto& r = impl_->dopRing;
        auto* src = reinterpret_cast<const uint32_t*>(samples);
        std::lock_guard<std::mutex> lock(r.mutex);
        r.sessionHasAudio.store(true, std::memory_order_release);
        int w = 0;
        while (w < frameCount && !r.stopRequested.load(std::memory_order_relaxed)) {
            int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
            r.indexFifo.prepareToWrite(frameCount - w, s1, sz1, s2, sz2);
            int wr = sz1 + sz2;
            if (wr > 0) {
                memcpy(&r.buffer[(size_t)s1 * r.channels], src + (size_t)w * r.channels,
                       (size_t)wr * r.channels * sizeof(uint32_t));
                r.indexFifo.finishedWrite(wr); w += wr; continue;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        return w == frameCount;
    }

    {
        auto& r = impl_->pcmRing;
        std::lock_guard<std::mutex> lock(r.mutex);
        r.sessionHasAudio.store(true, std::memory_order_release);
        int w = 0;
        while (w < frameCount && !r.stopRequested.load(std::memory_order_relaxed)) {
            int s1 = 0, sz1 = 0, s2 = 0, sz2 = 0;
            r.indexFifo.prepareToWrite(frameCount - w, s1, sz1, s2, sz2);
            int wr = sz1 + sz2;
            if (wr > 0) {
                memcpy(&r.buffer[(size_t)s1 * r.channels], samples + (size_t)w * r.channels,
                       (size_t)wr * r.channels * sizeof(float));
                r.indexFifo.finishedWrite(wr); w += wr; continue;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        return w == frameCount;
    }
}

void AsioBackend::flush() {}

bool AsioBackend::isOpen() const { return impl_ && impl_->openFlag; }
int AsioBackend::getSampleRate() const { return impl_ ? impl_->sampleRate_ : 0; }
int AsioBackend::getChannels() const { return impl_ ? impl_->channels_ : 0; }
int AsioBackend::getBufferFrames() const { return impl_ ? impl_->bufferFrames_ : 0; }
std::string AsioBackend::getBackendName() const { return "asio"; }
void AsioBackend::setDsdMode(DsdMode m) { dsdMode_ = m; }


bool AsioBackend::enumerateDevices(std::vector<DeviceInfo>& out) {
    out.clear();
    char storage[kMaxAsioDrivers][512]{};
    char* names[kMaxAsioDrivers]{};
    for (long i = 0; i < kMaxAsioDrivers; ++i) names[i] = storage[i];
    AsioDrivers drv;
    long cnt = drv.getDriverNames(names, kMaxAsioDrivers);
    if (cnt <= 0) return false;

    for (long i = 0; i < cnt; ++i) {
        char utf8[512]{}; ansiToUtf8(names[i], utf8, (int)sizeof(utf8));
        if (utf8[0] == '\0') continue;
        bool dup = false;
        for (auto& d : out) if (d.name == utf8) { dup = true; break; }
        if (dup) continue;
        DeviceInfo info; info.id = utf8; info.name = utf8;
        info.outputMode = OutputMode::Asio; info.isDefault = out.empty();
        char ansi[512]{}; utf8ToAnsi(utf8, ansi, (int)sizeof(ansi));
        if (containsIcase(utf8, "asio4all") && ansi[0] && loadAsioDriver(ansi)) {
            ASIODriverInfo di{}; di.asioVersion = 2;
            HWND w = createAsioHostWindow(); di.sysRef = w ? w : GetDesktopWindow();
            if (ASIOInit(&di) == ASE_OK) {
                long iCh = 0, oCh = 0;
                if (ASIOGetChannels(&iCh, &oCh) == ASE_OK && oCh > 0)
                    info.asioOutputChannels = (int)std::min<long>(oCh, kMaxAsioOutputChannels);
                ASIOExit();
                if (asioDrivers) asioDrivers->removeCurrentDriver();
            }
            if (w) DestroyWindow(w);
        }
        out.push_back(std::move(info));
    }
    return !out.empty();
}

} // namespace echo_audio_daemon


#else // !ECHO_ENABLE_ASIO

#include "../common/AudioTypes.h"
#include <vector>

namespace echo_audio_daemon {

struct AsioBackend::Impl {};
AsioBackend::AsioBackend() : impl_(std::make_unique<Impl>()) {}
AsioBackend::~AsioBackend() = default;
bool AsioBackend::open(const DeviceInfo&, int, int, int) { return false; }
void AsioBackend::close() {}
bool AsioBackend::write(const float*, int) { return false; }
void AsioBackend::flush() {}
bool AsioBackend::isOpen() const { return false; }
int AsioBackend::getSampleRate() const { return 0; }
int AsioBackend::getChannels() const { return 0; }
int AsioBackend::getBufferFrames() const { return 0; }
std::string AsioBackend::getBackendName() const { return "asio (stub)"; }
void AsioBackend::setDsdMode(DsdMode) {}
bool AsioBackend::enumerateDevices(std::vector<DeviceInfo>&) { return false; }
void AsioBackend::cleanUp() {}

} // namespace echo_audio_daemon

#endif // ECHO_ENABLE_ASIO
