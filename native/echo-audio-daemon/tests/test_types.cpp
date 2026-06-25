// ── Type Definition Compilation & Usage Tests ───────────────────────────────
// Verifies that the core type headers compile and that the types are usable
// as designed.  All tests are static_assert or runtime CHECK-based.
//
// Build target: echo-daemon-tests

#include <cassert>
#include <iostream>
#include <string>
#include <utility>

#include "src/common/AudioTypes.h"
#include "src/common/ErrorCodes.h"
#include "src/common/Result.h"

namespace ead = echo_audio_daemon;

// ── Helpers ─────────────────────────────────────────────────────────────────
#define CHECK(expr)                                                       \
    do {                                                                   \
        if (!(expr)) {                                                     \
            std::cerr << "FAIL [" << __FILE__ << ":" << __LINE__ << "] "  \
                      << #expr << "\n";                                    \
            return 1;                                                      \
        }                                                                  \
    } while (false)

#define CHECK_THROWS(expr, msgContains)                                     \
    do {                                                                    \
        bool caught = false;                                                \
        try { (void)(expr); }                                               \
        catch (const std::exception& e) {                                   \
            caught = true;                                                  \
            CHECK(std::string(e.what()).find(msgContains) != std::string::npos); \
        }                                                                   \
        CHECK(caught);                                                      \
    } while (false)

// ── Test: AudioFormat ───────────────────────────────────────────────────────
static int testAudioFormat() {
    std::cout << "  testAudioFormat...\n";

    // Default construction
    ead::AudioFormat fmt;
    CHECK(fmt.format.empty());
    CHECK(fmt.sampleRate == 0);
    CHECK(fmt.channels == 0);
    CHECK(fmt.duration == 0.0);
    CHECK(fmt.bitRate == 0);
    CHECK(fmt.codec.empty());
    CHECK(fmt.isDsd == false);

    // Aggregate initialization
    ead::AudioFormat flac = {
        .format = "flac",
        .sampleRate = 44100,
        .channels = 2,
        .duration = 253.5,
        .bitRate = 987000,
        .codec = "FLAC",
        .isDsd = false
    };
    CHECK(flac.format == "flac");
    CHECK(flac.sampleRate == 44100);
    CHECK(flac.channels == 2);
    CHECK(flac.duration == 253.5);
    CHECK(flac.bitRate == 987000);
    CHECK(flac.codec == "FLAC");
    CHECK(flac.isDsd == false);

    // DSD format
    ead::AudioFormat dsd = {
        .format = "dsf",
        .sampleRate = 2822400,
        .channels = 2,
        .duration = 180.0,
        .bitRate = 0,
        .codec = "DSD64",
        .isDsd = true
    };
    CHECK(dsd.isDsd == true);
    CHECK(dsd.codec == "DSD64");

    return 0;
}

// ── Test: DeviceInfo ────────────────────────────────────────────────────────
static int testDeviceInfo() {
    std::cout << "  testDeviceInfo...\n";

    // Default construction
    ead::DeviceInfo dev;
    CHECK(dev.id.empty());
    CHECK(dev.name.empty());
    CHECK(dev.outputMode == ead::OutputMode::Shared);
    CHECK(dev.sampleRate == 0);
    CHECK(dev.sharedSampleRate == 0);
    CHECK(dev.channels == 2);
    CHECK(dev.isDefault == false);
    CHECK(dev.asioOutputChannels == 0);

    // Aggregate initialization
    ead::DeviceInfo asioDev = {
        .id = "ASIO::Focusrite USB",
        .name = "Focusrite Scarlett 2i2",
        .outputMode = ead::OutputMode::Asio,
        .sampleRate = 96000,
        .sharedSampleRate = 48000,
        .channels = 2,
        .isDefault = false,
        .asioOutputChannels = 2
    };
    CHECK(asioDev.outputMode == ead::OutputMode::Asio);
    CHECK(asioDev.sampleRate == 96000);
    CHECK(asioDev.sharedSampleRate == 48000);
    CHECK(asioDev.asioOutputChannels == 2);

    return 0;
}

// ── Test: PlaybackState ─────────────────────────────────────────────────────
static int testPlaybackState() {
    std::cout << "  testPlaybackState...\n";

    CHECK(static_cast<int>(ead::PlaybackState::Stopped) == 0);
    CHECK(static_cast<int>(ead::PlaybackState::Playing) == 1);
    CHECK(static_cast<int>(ead::PlaybackState::Paused)  == 2);
    CHECK(static_cast<int>(ead::PlaybackState::Ended)   == 3);
    CHECK(static_cast<int>(ead::PlaybackState::Error)   == 4);

    // State transitions (compile-time enum usage)
    auto state = ead::PlaybackState::Stopped;
    state = ead::PlaybackState::Playing;
    CHECK(state == ead::PlaybackState::Playing);
    state = ead::PlaybackState::Ended;
    CHECK(state == ead::PlaybackState::Ended);

    return 0;
}

// ── Test: OutputMode ────────────────────────────────────────────────────────
static int testOutputMode() {
    std::cout << "  testOutputMode...\n";

    CHECK(static_cast<int>(ead::OutputMode::Shared)    == 0);
    CHECK(static_cast<int>(ead::OutputMode::Exclusive) == 1);
    CHECK(static_cast<int>(ead::OutputMode::Asio)      == 2);

    return 0;
}

// ── Test: DecoderSession ────────────────────────────────────────────────────
static int testDecoderSession() {
    std::cout << "  testDecoderSession...\n";

    ead::DecoderSession session;
    CHECK(session.filePath.empty());
    CHECK(session.format.format.empty());
    CHECK(session.position == 0.0);
    CHECK(session.speed == 1.0);
    CHECK(session.seekable == false);
    CHECK(session.gaplessReady == false);
    CHECK(session.bitDepth == 0);

    // Populated session
    ead::AudioFormat flac = {
        .format = "flac", .sampleRate = 44100, .channels = 2,
        .duration = 300.0, .bitRate = 800000, .codec = "FLAC"
    };
    session.filePath = "/music/track.flac";
    session.format = flac;
    session.position = 42.5;
    session.speed = 1.0;
    session.seekable = true;
    session.gaplessReady = true;
    session.bitDepth = 24;

    CHECK(session.filePath == "/music/track.flac");
    CHECK(session.format.sampleRate == 44100);
    CHECK(session.position == 42.5);
    CHECK(session.seekable == true);
    CHECK(session.gaplessReady == true);
    CHECK(session.bitDepth == 24);

    return 0;
}

// ── Test: DspState ──────────────────────────────────────────────────────────
static int testDspState() {
    std::cout << "  testDspState...\n";

    ead::DspState dsp;
    CHECK(dsp.eqEnabled == false);
    CHECK(dsp.convolutionEnabled == false);
    CHECK(dsp.channelBalanceEnabled == false);
    CHECK(dsp.clippingRisk == false);
    CHECK(dsp.limiterProtecting == false);
    CHECK(dsp.headroomDb == 0.0);

    dsp.eqEnabled = true;
    dsp.clippingRisk = true;
    dsp.headroomDb = -3.5;
    CHECK(dsp.eqEnabled == true);
    CHECK(dsp.headroomDb == -3.5);

    return 0;
}

// ── Test: Result<T, E> ──────────────────────────────────────────────────────
static int testResult() {
    std::cout << "  testResult...\n";

    // --- Ok with std::string error (default) ---
    {
        auto r = ead::Result<int>(42);
        CHECK(r.isOk());
        CHECK(!r.isError());
        CHECK(r.unwrap() == 42);
        CHECK(r.valueOr(-1) == 42);
    }

    // --- Error with std::string ---
    {
        auto r = ead::Result<int>(std::string("oops"));
        CHECK(!r.isOk());
        CHECK(r.isError());
        CHECK(r.error() == "oops");
        CHECK(r.valueOr(-1) == -1);
    }

    // --- Error: unwrap throws ---
    {
        auto r = ead::Result<double>(std::string("bad value"));
        CHECK_THROWS(r.unwrap(), "bad value");
    }

    // --- Error with DaemonErrorCode ---
    {
        auto r = ead::Result<int, ead::DaemonErrorCode>(
            ead::DaemonErrorCode::DeviceUnavailable);
        CHECK(r.isError());
        CHECK(r.error() == ead::DaemonErrorCode::DeviceUnavailable);
        CHECK_THROWS(r.unwrap(), "-32001");
    }

    // --- Ok with DaemonErrorCode error type ---
    {
        auto r = ead::Result<double, ead::DaemonErrorCode>(3.14);
        CHECK(r.isOk());
        CHECK(r.unwrap() == 3.14);
    }

    // --- Copy construction (const&) ---
    {
        const int okVal = 99;
        auto r = ead::Result<int>(okVal);
        CHECK(r.unwrap() == 99);
    }

    // --- Move semantics (use explicit distinct error type) ---
    {
        auto r = ead::Result<std::string, int>(std::string("hello"));
        CHECK(r.isOk());
        auto moved = std::move(r).unwrap();
        CHECK(moved == "hello");
    }

    // --- Move error ---
    {
        auto r = ead::Result<int, std::string>(std::string("error msg"));
        CHECK(r.isError());
        auto err = std::move(r).error();
        CHECK(err == "error msg");
    }

    return 0;
}

// ── Test: ErrorCodes ────────────────────────────────────────────────────────
static int testErrorCodes() {
    std::cout << "  testErrorCodes...\n";

    // JSON-RPC 2.0 standard codes
    CHECK(static_cast<int>(ead::DaemonErrorCode::ParseError)      == -32700);
    CHECK(static_cast<int>(ead::DaemonErrorCode::InvalidRequest)  == -32600);
    CHECK(static_cast<int>(ead::DaemonErrorCode::MethodNotFound)  == -32601);
    CHECK(static_cast<int>(ead::DaemonErrorCode::InvalidParams)   == -32602);
    CHECK(static_cast<int>(ead::DaemonErrorCode::InternalError)   == -32000);

    // Daemon-specific codes
    CHECK(static_cast<int>(ead::DaemonErrorCode::DeviceUnavailable) == -32001);
    CHECK(static_cast<int>(ead::DaemonErrorCode::DecodeError)       == -32002);
    CHECK(static_cast<int>(ead::DaemonErrorCode::FormatUnsupported) == -32003);
    CHECK(static_cast<int>(ead::DaemonErrorCode::SeekError)         == -32004);
    CHECK(static_cast<int>(ead::DaemonErrorCode::AsioDriverError)   == -32005);
    CHECK(static_cast<int>(ead::DaemonErrorCode::InvalidFilePath)   == -32006);
    CHECK(static_cast<int>(ead::DaemonErrorCode::DeviceInUse)       == -32007);

    // Utility functions
    CHECK(ead::isDaemonError(ead::DaemonErrorCode::DeviceUnavailable));
    CHECK(ead::isDaemonError(ead::DaemonErrorCode::DeviceInUse));
    CHECK(!ead::isDaemonError(ead::DaemonErrorCode::ParseError));
    CHECK(!ead::isDaemonError(ead::DaemonErrorCode::InternalError));

    // Labels
    CHECK(std::string(errorCodeLabel(ead::DaemonErrorCode::ParseError)) == "ParseError");
    CHECK(std::string(errorCodeLabel(ead::DaemonErrorCode::DeviceInUse)) == "DeviceInUse");

    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-types tests ===\n";

    int failures = 0;
    failures += testAudioFormat();
    failures += testDeviceInfo();
    failures += testPlaybackState();
    failures += testOutputMode();
    failures += testDecoderSession();
    failures += testDspState();
    failures += testResult();
    failures += testErrorCodes();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
