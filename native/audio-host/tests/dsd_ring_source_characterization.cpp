#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "HostCommon.h"

namespace
{
void require(bool condition, const std::string& message)
{
    if (! condition)
        throw std::runtime_error(message);
}

void testDsdRingSourcesStayIndependentOfPcmDspChain()
{
    static_assert(std::is_constructible<DopRingSource, int, int, int, int>::value, "DoP ring source constructor stays DSP-free");
    static_assert(std::is_constructible<NativeDsdRingSource, int, int, int, int>::value, "native DSD ring source constructor stays DSP-free");

    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    echo::ConvolutionProcessor convolution;
    echo::DspHeadroomProcessor headroom;
    echo::ReplayGainProcessor replayGain;
    echo::PlaybackRateProcessor playbackRate;
    echo::LevelMeterProcessor meter;
    eq.prepare(48000.0, 16, 2);
    channelBalance.prepare(48000.0, 16, 2);
    convolution.prepare(48000.0, 16, 2);
    headroom.prepare(48000.0, 16, 2);
    replayGain.prepare(48000.0, 16, 2);
    playbackRate.prepare(48000.0, 16, 2);
    meter.prepare(48000.0, 16, 2);

    DopRingSource dop(2, 8, 0, 0);
    dop.beginSession();
    std::vector<char> dopPending;
    const std::vector<char> dopPayload {
        static_cast<char>(0x34), static_cast<char>(0x12), static_cast<char>(0xaa),
        static_cast<char>(0x78), static_cast<char>(0x56), static_cast<char>(0xbb),
    };
    pushDopPayload(dop, 2, dopPending, dopPayload);
    std::vector<uint32_t> dopOut(2, 0u);
    require(dop.renderInterleaved(dopOut.data(), 1, 2) == 1, "DoP render reads one frame after push");
    require(dopOut[0] == 0x00051234u && dopOut[1] == 0x00055678u, "DoP output preserves DSD low 16 bits and marker without PCM DSP mutation");

    NativeDsdRingSource native(2, 8, 0, 0);
    native.beginSession();
    std::vector<char> nativePending;
    const std::vector<char> nativePayload { static_cast<char>(0xa5), static_cast<char>(0x5a) };
    pushNativeDsdPayload(native, 2, nativePending, nativePayload);
    std::vector<uint8_t> nativeOut(2, 0u);
    require(native.renderInterleaved(nativeOut.data(), 1, 2) == 1, "native DSD render reads one byte-frame after push");
    require(nativeOut[0] == 0xa5u && nativeOut[1] == 0x5au, "native DSD output preserves raw bits without PCM DSP mutation");
}

void testDopRingSourceOutputsDopEncodedSamples()
{
    DopRingSource source(2, 8, 0, 0);
    source.beginSession();

    std::vector<char> pending;
    const std::vector<char> payload {
        static_cast<char>(0x01), static_cast<char>(0x02), static_cast<char>(0x80),
        static_cast<char>(0x03), static_cast<char>(0x04), static_cast<char>(0x81),
        static_cast<char>(0x05), static_cast<char>(0x06), static_cast<char>(0x82),
        static_cast<char>(0x07), static_cast<char>(0x08), static_cast<char>(0x83),
        static_cast<char>(0x09), static_cast<char>(0x0a), static_cast<char>(0x05),
        static_cast<char>(0x0b), static_cast<char>(0x0c), static_cast<char>(0xfa),
    };
    pushDopPayload(source, 2, pending, payload);
    require(pending.empty(), "complete DoP payload is consumed");

    std::vector<uint32_t> output(6, 0u);
    require(source.renderInterleaved(output.data(), 3, 2) == 3, "DoP source renders three frames");
    require(output[0] == 0x00050201u, "DoP frame 0 left has 0x05 marker and low-16 DSD sample");
    require(output[1] == 0x00050403u, "DoP frame 0 right has 0x05 marker and low-16 DSD sample");
    require(output[2] == 0x00fa0605u, "DoP frame 1 left has 0xfa marker and low-16 DSD sample");
    require(output[3] == 0x00fa0807u, "DoP frame 1 right has 0xfa marker and low-16 DSD sample");
    require(output[4] == 0x00050a09u, "DoP frame 2 left rewrites source marker byte back to 0x05");
    require(output[5] == 0x00050c0bu, "DoP frame 2 right rewrites source marker byte back to 0x05");
}

void testDopRingSourcePreservesPendingAndWrappedBytes()
{
    DopRingSource source(2, 3, 0, 0);
    source.beginSession();

    std::vector<char> pending;
    pushDopPayload(
        source,
        2,
        pending,
        {
            static_cast<char>(0x11), static_cast<char>(0x22), static_cast<char>(0x80),
            static_cast<char>(0x33), static_cast<char>(0x44), static_cast<char>(0x81),
            static_cast<char>(0x55),
        });
    require(pending.size() == 1, "incomplete DoP byte remains pending");
    std::vector<uint32_t> firstRender(4, 0xffffffffu);
    require(source.renderInterleaved(firstRender.data(), 2, 2) == 1, "DoP source consumes only the complete frame before wrap");
    require(firstRender[0] == 0x00052211u && firstRender[1] == 0x00054433u, "DoP first frame preserves complete payload bytes");
    require(firstRender[2] == 0x00fa0000u && firstRender[3] == 0x00fa0000u, "DoP incomplete requested frame renders marker-preserving silence");

    pushDopPayload(
        source,
        2,
        pending,
        {
            static_cast<char>(0x66), static_cast<char>(0x82),
            static_cast<char>(0x77), static_cast<char>(0x88), static_cast<char>(0x83),
            static_cast<char>(0x99), static_cast<char>(0xaa), static_cast<char>(0x84),
            static_cast<char>(0xbb), static_cast<char>(0xcc), static_cast<char>(0x85),
        });
    require(pending.empty(), "completed DoP bytes are consumed after pending merge");

    std::vector<uint32_t> wrappedFrames(6, 0u);
    require(source.renderInterleaved(wrappedFrames.data(), 3, 2) == 2, "DoP source renders only completed wrapped frames");
    require(wrappedFrames[0] == 0x00056655u, "DoP wrapped render frame 0 left preserves pending-completed bytes with marker");
    require(wrappedFrames[1] == 0x00058877u, "DoP wrapped render frame 0 right preserves payload bytes with marker");
    require(wrappedFrames[2] == 0x00faaa99u, "DoP wrapped render frame 1 left preserves payload bytes with marker");
    require(wrappedFrames[3] == 0x00faccbbu, "DoP wrapped render frame 1 right preserves payload bytes with marker");
    require(wrappedFrames[4] == 0x00050000u && wrappedFrames[5] == 0x00050000u, "DoP incomplete frame renders marker-preserving silence");
}

void testNativeDsdRingSourcePreservesNativeBitstream()
{
    NativeDsdRingSource source(2, 8, 0, 0);
    source.beginSession();

    std::vector<char> pending;
    const std::vector<char> payload {
        static_cast<char>(0xff), static_cast<char>(0x00),
        static_cast<char>(0x69), static_cast<char>(0x96),
        static_cast<char>(0x05), static_cast<char>(0xfa),
        static_cast<char>(0xa5), static_cast<char>(0x5a),
    };
    pushNativeDsdPayload(source, 2, pending, payload);
    require(pending.empty(), "complete native DSD payload is consumed");

    std::vector<uint8_t> output(8, 0u);
    require(source.renderInterleaved(output.data(), 4, 2) == 4, "native DSD source renders four byte-frames");
    for (size_t i = 0; i < payload.size(); ++i)
        require(output[i] == static_cast<uint8_t>(payload[i]), "native DSD byte " + std::to_string(i) + " is preserved bit-for-bit");
}

void testNativeDsdRingSourcePreservesPendingAndWrappedBytes()
{
    NativeDsdRingSource source(2, 3, 0, 0);
    source.beginSession();

    std::vector<char> pending;
    pushNativeDsdPayload(
        source,
        2,
        pending,
        { static_cast<char>(0x10), static_cast<char>(0x20), static_cast<char>(0x30) });
    require(pending.size() == 1, "incomplete native DSD byte-frame remains pending");

    std::vector<uint8_t> firstFrame(2, 0u);
    require(source.renderInterleaved(firstFrame.data(), 1, 2) == 1, "native DSD source renders first byte-frame before wrap");
    require(firstFrame[0] == 0x10u && firstFrame[1] == 0x20u, "native DSD first byte-frame preserves raw bytes");

    pushNativeDsdPayload(
        source,
        2,
        pending,
        {
            static_cast<char>(0x40),
            static_cast<char>(0x50), static_cast<char>(0x60),
            static_cast<char>(0x70), static_cast<char>(0x80),
            static_cast<char>(0x90),
        });
    require(pending.size() == 1, "native DSD trailing partial byte remains pending after wrap fill");

    std::vector<uint8_t> wrappedFrames(6, 0u);
    require(source.renderInterleaved(wrappedFrames.data(), 3, 2) == 3, "native DSD source renders wrapped byte-frames");
    const std::vector<uint8_t> expected { 0x30u, 0x40u, 0x50u, 0x60u, 0x70u, 0x80u };
    for (size_t i = 0; i < expected.size(); ++i)
        require(wrappedFrames[i] == expected[i], "native DSD wrapped byte " + std::to_string(i) + " is preserved bit-for-bit");
}

}

int main()
{
    const std::vector<std::pair<std::string, void (*)()>> tests {
        { "DSD ring sources stay independent of PCM DSP chain", testDsdRingSourcesStayIndependentOfPcmDspChain },
        { "DoP ring source outputs DoP encoded samples", testDopRingSourceOutputsDopEncodedSamples },
        { "DoP ring source preserves pending and wrapped bytes", testDopRingSourcePreservesPendingAndWrappedBytes },
        { "native DSD ring source preserves native bitstream", testNativeDsdRingSourcePreservesNativeBitstream },
        { "native DSD ring source preserves pending and wrapped bytes", testNativeDsdRingSourcePreservesPendingAndWrappedBytes },
    };

    try
    {
        for (const auto& test : tests)
        {
            test.second();
            std::cout << "[dsd-ring-source-characterization] PASS " << test.first << '\n';
        }
    }
    catch (const std::exception& error)
    {
        std::cerr << "[dsd-ring-source-characterization] FAIL " << error.what() << '\n';
        return 1;
    }

    return 0;
}
