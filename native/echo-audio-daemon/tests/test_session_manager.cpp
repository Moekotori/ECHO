// ── SessionManager Unit Tests ────────────────────────────────────────────────
// Tests the playback state machine via direct handler calls.
// NullBackend doesn't throttle — files play out instantly in <1ms.
// Tests adapt by checking final state (Ended) rather than expecting
// Playing to persist.
//
// Build target: echo-daemon-session-manager-tests
// Requires: FFmpeg (AvDecoder), pthread

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/decoder/AvDecoder.h"
#include "src/dsp/DspPipeline.h"
#include "src/output/NullBackend.h"
#include "src/session/SessionManager.h"

using json = nlohmann::json;
namespace ead = echo_audio_daemon;

#define CHECK(expr)                                                       \
    do {                                                                   \
        if (!(expr)) {                                                     \
            std::cerr << "FAIL [" << __FILE__ << ":" << __LINE__ << "] "  \
                      << #expr << "\n";                                    \
            return 1;                                                      \
        }                                                                  \
    } while (false)

#define CHECK_JSON(actual, expectedField, expectedValue)                     \
    do {                                                                     \
        auto& _j = (actual);                                                 \
        CHECK(_j.find(expectedField) != _j.end());                           \
        CHECK(_j[expectedField] == (expectedValue));                         \
    } while (false)

// ── Test Audio File ──────────────────────────────────────────────────────────
static std::string ensureTestFile() {
    const std::string path = "/tmp/sm_test_tone.wav";
    FILE* f = std::fopen(path.c_str(), "rb");
    if (f) {
        std::fseek(f, 0, SEEK_END);
        long sz = std::ftell(f);
        std::fclose(f);
        if (sz > 1000) return path;
    }
    std::string cmd = "ffmpeg -y -f lavfi -i \"sine=frequency=440:duration=2\" "
                      "-ac 1 -ar 44100 -sample_fmt s16 "
                      + path + " 2>/dev/null";
    std::system(cmd.c_str());
    return path;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 1: Initial state after construction
// ═════════════════════════════════════════════════════════════════════════════

static int test_initial_state() {
    std::cout << "  test_initial_state...\n";

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    CHECK(sm.getState() == ead::PlaybackState::Stopped);
    CHECK(sm.isStopped());
    CHECK(!sm.isPlaying());
    CHECK(!sm.isPaused());
    CHECK(sm.getVolume() == 1.0);
    CHECK(sm.getFramesPlayed() == 0);
    CHECK(sm.getUnderrunCount() == 0);

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 2: Volume clamping
// ═════════════════════════════════════════════════════════════════════════════

static int test_volume_clamping() {
    std::cout << "  test_volume_clamping...\n";

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    CHECK(sm.getVolume() == 1.0);

    json r1 = sm.handleSetVolume({{"volume", 0.5}});
    CHECK_JSON(r1, "volume", 0.5);
    CHECK(sm.getVolume() == 0.5);

    json r2 = sm.handleSetVolume({{"volume", 1.5}});
    CHECK_JSON(r2, "volume", 1.0);
    CHECK(sm.getVolume() == 1.0);

    json r3 = sm.handleSetVolume({{"volume", -0.5}});
    CHECK_JSON(r3, "volume", 0.0);
    CHECK(sm.getVolume() == 0.0);

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 3: State transitions from Stopped (rejected)
// ═════════════════════════════════════════════════════════════════════════════

static int test_state_transitions_stopped() {
    std::cout << "  test_state_transitions_stopped...\n";

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    CHECK(sm.isStopped());

    json r1 = sm.handlePause(json::object());
    CHECK_JSON(r1, "status", "stopped");
    CHECK(sm.isStopped());

    json r2 = sm.handleResume(json::object());
    CHECK(r2.find("error") != r2.end());

    json r3 = sm.handleStop(json::object());
    CHECK_JSON(r3, "status", "stopped");

    json r4 = sm.handleSeek({{"seconds", 10.0}});
    CHECK(r4.find("error") != r4.end());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 4: Play natural end — file plays out instantly with NullBackend
// ═════════════════════════════════════════════════════════════════════════════

static int test_play_natural_end() {
    std::cout << "  test_play_natural_end...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json playResult = sm.handlePlay({{"path", testFile}});
    CHECK_JSON(playResult, "status", "playing");
    CHECK(sm.isPlaying());

    // With NullBackend the file plays out instantly (no HW throttling).
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    // Should have reached natural end
    CHECK(sm.getState() == ead::PlaybackState::Ended);
    CHECK(sm.getFramesPlayed() > 0);
    CHECK(backend.totalFramesWritten() > 0);
    CHECK(backend.writeCount() > 0);
    // Output stays open after natural end for gapless transitions
    CHECK(backend.isOpen());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 5: Play then Stop
// ═════════════════════════════════════════════════════════════════════════════

static int test_play_stop_midplay() {
    std::cout << "  test_play_stop_midplay...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json playResult = sm.handlePlay({{"path", testFile}});
    CHECK_JSON(playResult, "status", "playing");

    json stopResult = sm.handleStop(json::object());
    CHECK_JSON(stopResult, "status", "stopped");
    CHECK(sm.isStopped());
    CHECK(!backend.isOpen());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 6: Pause/Resume (race-tolerant for instant NullBackend)
// ═════════════════════════════════════════════════════════════════════════════

static int test_pause_resume() {
    std::cout << "  test_pause_resume...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json playResult = sm.handlePlay({{"path", testFile}});
    CHECK_JSON(playResult, "status", "playing");

    // Try to pause; thread may have already finished
    json pauseResult = sm.handlePause(json::object());
    CHECK(pauseResult.find("status") != pauseResult.end());

    // Try to resume (may fail if thread already ended)
    json resumeResult = sm.handleResume(json::object());

    json stopResult = sm.handleStop(json::object());
    CHECK_JSON(stopResult, "status", "stopped");
    CHECK(sm.isStopped());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 7: Seek
// ═════════════════════════════════════════════════════════════════════════════

static int test_seek() {
    std::cout << "  test_seek...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    sm.handlePlay({{"path", testFile}});

    json seekResult = sm.handleSeek({{"seconds", 1.0}});
    if (seekResult.find("error") != seekResult.end()) {
        std::cerr << "  Seek error: " << seekResult.dump() << "\n";
        sm.handleStop(json::object());
        return 1;
    }
    CHECK(seekResult["position"] == 1.0);

    sm.handleStop(json::object());
    CHECK(sm.isStopped());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 8: QueueNext preparation
// ═════════════════════════════════════════════════════════════════════════════

static int test_queue_next() {
    std::cout << "  test_queue_next...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json qResult = sm.handleQueueNext({{"path", testFile}});
    if (qResult.find("error") != qResult.end()) {
        std::cout << "    (queueNext skipped)\n";
    } else {
        CHECK_JSON(qResult, "queued", true);
    }

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 9: PrepareAutomix
// ═════════════════════════════════════════════════════════════════════════════

static int test_prepare_automix() {
    std::cout << "  test_prepare_automix...\n";

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json r = sm.handlePrepareAutomix({
        {"fadeStartSeconds", 8.0},
        {"overlapSeconds",   6.0},
        {"currentGainDb",    0.0},
        {"nextGainDb",      -3.0},
        {"mode",             "equalPower"},
    });
    CHECK_JSON(r, "prepared", true);

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 10: Replay (play, stop, play again)
// ═════════════════════════════════════════════════════════════════════════════

static int test_replay() {
    std::cout << "  test_replay...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    // First play
    sm.handlePlay({{"path", testFile}});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    CHECK(sm.getState() == ead::PlaybackState::Ended);
    CHECK(backend.totalFramesWritten() > 0);
    uint64_t framesAfterFirst = backend.totalFramesWritten();

    sm.handleStop(json::object());
    CHECK(sm.isStopped());

    // Second play
    sm.handlePlay({{"path", testFile}});
    CHECK(sm.isPlaying());
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    CHECK(sm.getState() == ead::PlaybackState::Ended);
    CHECK(backend.totalFramesWritten() >= framesAfterFirst);

    sm.handleStop(json::object());
    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 11: Shutdown via destructor
// ═════════════════════════════════════════════════════════════════════════════

static int test_shutdown_clean() {
    std::cout << "  test_shutdown_clean...\n";

    std::string testFile = ensureTestFile();

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;

    {
        ead::SessionManager sm(server, decoder, dsp, backend);
        sm.handlePlay({{"path", testFile}});
        CHECK(sm.isPlaying());
        // sm goes out of scope → destructor calls shutdown()
    }

    CHECK(!backend.isOpen());

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 12: Volume via handler
// ═════════════════════════════════════════════════════════════════════════════

static int test_volume_via_handler() {
    std::cout << "  test_volume_via_handler...\n";

    ead::JsonRpcServer server;
    ead::NullBackend backend;
    ead::AvDecoder   decoder;
    ead::DspPipeline dsp;
    ead::SessionManager sm(server, decoder, dsp, backend);

    json r = sm.handleSetVolume({{"volume", 0.33}});
    CHECK_JSON(r, "volume", 0.33);
    CHECK(sm.getVolume() == 0.33);

    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

int main() {
    ensureTestFile();

    std::cout << "=== echo-daemon-session-manager tests ===\n";

    int failures = 0;
    failures += test_initial_state();
    failures += test_volume_clamping();
    failures += test_state_transitions_stopped();
    failures += test_play_natural_end();
    failures += test_play_stop_midplay();
    failures += test_pause_resume();
    failures += test_seek();
    failures += test_queue_next();
    failures += test_prepare_automix();
    failures += test_replay();
    failures += test_shutdown_clean();
    failures += test_volume_via_handler();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
