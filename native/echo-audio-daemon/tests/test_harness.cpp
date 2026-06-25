// ── Integration Test Harness: JsonRpcServer + NullBackend ──────────────────────
// Spawns the daemon's core logic in-process with NullBackend, sends JSON-RPC
// commands via pipe-redirected stdin, and verifies responses on stdout.
//
// Tests the full cycle:
//   device.list → test.play → pause → resume → setVolume → shutdown
//
// Build target: echo-daemon-harness
//
// Pipe-based approach (same pattern as test_ipc.cpp):
//   pipe(2) + dup2(2) redirect stdin/stdout, run server in background thread,
//   send requests and read responses through the pipes.

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <poll.h>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <unistd.h>

#include "src/ipc/JsonRpcServer.h"
#include "src/output/NullBackend.h"

namespace ead = echo_audio_daemon;

// ── Test Macros ───────────────────────────────────────────────────────────────
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

// ── Pipe Test Helper ─────────────────────────────────────────────────────────
// (Identical pattern to test_ipc.cpp's PipeHelper)
struct PipeHelper {
    int oldStdin  = -1;
    int oldStdout = -1;

    int stdinRead   = -1;
    int stdoutWrite = -1;
    int stdinWrite  = -1;
    int stdoutRead  = -1;

    bool active = false;

    PipeHelper() {
        fflush(nullptr);
        std::cout.flush();
        std::cerr.flush();
        std::clog.flush();

        int sp[2], rp[2];
        if (pipe(sp) != 0 || pipe(rp) != 0) {
            std::cerr << "FAIL: pipe creation failed\n";
            return;
        }
        stdinRead   = sp[0];
        stdinWrite  = sp[1];
        stdoutRead  = rp[0];
        stdoutWrite = rp[1];

        oldStdin  = dup(STDIN_FILENO);
        oldStdout = dup(STDOUT_FILENO);

        dup2(stdinRead,  STDIN_FILENO);
        dup2(stdoutWrite, STDOUT_FILENO);

        active = true;
    }

    void send(const std::string& line) {
        std::string msg = line + "\n";
        ::write(stdinWrite, msg.data(), msg.size());
    }

    std::string readLine(int timeoutMs = 3000) {
        struct pollfd pfd;
        pfd.fd     = stdoutRead;
        pfd.events = POLLIN;

        std::string result;
        char c;
        auto deadline = std::chrono::steady_clock::now()
                        + std::chrono::milliseconds(timeoutMs);

        while (std::chrono::steady_clock::now() < deadline) {
            int remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                deadline - std::chrono::steady_clock::now()).count();
            if (remaining <= 0) break;

            int ret = poll(&pfd, 1, std::min(remaining, 100));
            if (ret <= 0) continue;

            if (::read(stdoutRead, &c, 1) != 1) break;
            if (c == '\n') break;
            result += c;
        }
        return result;
    }

    void restore() {
        if (!active) return;
        dup2(oldStdin,  STDIN_FILENO);
        dup2(oldStdout, STDOUT_FILENO);
        active = false;
    }

    ~PipeHelper() {
        restore();
        if (stdinRead  >= 0) ::close(stdinRead);
        if (stdinWrite >= 0) ::close(stdinWrite);
        if (stdoutRead >= 0) ::close(stdoutRead);
        if (stdoutWrite >= 0) ::close(stdoutWrite);
        if (oldStdin  >= 0) ::close(oldStdin);
        if (oldStdout >= 0) ::close(oldStdout);
    }
};

// ── Scoped Server Thread ─────────────────────────────────────────────────────
// RAII helper (same pattern as test_ipc.cpp's ScopedServer)
struct ScopedServer {
    std::thread t;
    PipeHelper* pipe = nullptr;

    ScopedServer() = default;

    void start(std::thread thread, PipeHelper& p) {
        t = std::move(thread);
        pipe = &p;
    }

    void shutdown() {
        if (t.joinable() && pipe) {
            pipe->send(R"({"jsonrpc":"2.0","id":99,"method":"shutdown","params":{}})");
            t.join();
        }
    }

    ~ScopedServer() {
        if (t.joinable()) {
            if (pipe) {
                pipe->send(R"({"jsonrpc":"2.0","id":99,"method":"shutdown","params":{}})");
                pipe->readLine(500);
            }
            if (t.joinable()) t.detach();
        }
    }

    ScopedServer(const ScopedServer&) = delete;
    ScopedServer& operator=(const ScopedServer&) = delete;
    ScopedServer(ScopedServer&&) = delete;
    ScopedServer& operator=(ScopedServer&&) = delete;
};

// ── Test Fixture ──────────────────────────────────────────────────────────────
// Creates a server with NullBackend-based handlers, provides helper methods
// for sending commands and parsing responses.
struct HarnessFixture {
    std::shared_ptr<ead::NullBackend> backend;
    std::unique_ptr<ead::JsonRpcServer> server;
    std::atomic<ead::PlaybackState> playbackState;
    std::atomic<double> volume;

    PipeHelper pipe;
    ScopedServer scoped;
    std::mutex backendMutex;

    HarnessFixture()
        : backend(std::make_shared<ead::NullBackend>()),
          server(std::make_unique<ead::JsonRpcServer>()),
          playbackState(ead::PlaybackState::Stopped),
          volume(1.0)
    {
        // Register all handlers (same as main.cpp null-output mode)

        // test.echo
        server->registerMethod("test.echo", [](const json& params) -> json {
            return params;
        });

        // test.play - writes dummy data to NullBackend
        server->registerMethod("test.play", [this](const json& params) -> json {
            std::lock_guard<std::mutex> lock(backendMutex);

            int sampleRate = params.value("sampleRate", 44100);
            int channels   = params.value("channels", 2);
            int frames     = params.value("frames", sampleRate);

            if (!backend->isOpen()) {
                ead::DeviceInfo dev;
                dev.id   = "null";
                dev.name = "Null Output Device";
                if (!backend->open(dev, sampleRate, channels, 512)) {
                    return json{{"error", "failed to open NullBackend"}};
                }
            }

            std::vector<float> dummy(
                static_cast<size_t>(frames) * static_cast<size_t>(channels), 0.0f);
            if (!backend->write(dummy.data(), frames)) {
                return json{{"error", "NullBackend write failed"}};
            }

            playbackState.store(ead::PlaybackState::Playing);

            json result = {
                {"status",        "playing"},
                {"framesWritten", backend->totalFramesWritten()},
                {"writeCount",    backend->writeCount()},
            };
            auto pathIt = params.find("path");
            if (pathIt != params.end()) {
                result["path"] = *pathIt;
            }
            return result;
        });

        // test.getStatus
        server->registerMethod("test.getStatus", [this](const json&) -> json {
            std::string stateStr;
            switch (playbackState.load()) {
                case ead::PlaybackState::Stopped: stateStr = "stopped"; break;
                case ead::PlaybackState::Playing: stateStr = "playing"; break;
                case ead::PlaybackState::Paused:  stateStr = "paused";  break;
                case ead::PlaybackState::Ended:   stateStr = "ended";   break;
                case ead::PlaybackState::Error:   stateStr = "error";   break;
            }
            return json{
                {"state",         stateStr},
                {"volume",        volume.load()},
                {"framesWritten", backend->totalFramesWritten()},
                {"writeCount",    backend->writeCount()},
                {"isOpen",        backend->isOpen()},
            };
        });

        // device.list
        server->registerMethod("device.list", [](const json&) -> json {
            json device = {
                {"id",         "null"},
                {"name",       "Null Output Device"},
                {"outputMode", "shared"},
                {"sampleRate", 0},
                {"channels",   2},
                {"isDefault",  true},
            };
            return json{{"devices", json::array({device})}};
        });

        // Playback control
        server->registerMethod("pause", [this](const json&) -> json {
            playbackState.store(ead::PlaybackState::Paused);
            return json{{"status", "paused"}};
        });

        server->registerMethod("resume", [this](const json&) -> json {
            playbackState.store(ead::PlaybackState::Playing);
            return json{{"status", "playing"}};
        });

        server->registerMethod("stop", [this](const json&) -> json {
            playbackState.store(ead::PlaybackState::Stopped);
            return json{{"status", "stopped"}};
        });

        // setVolume
        server->registerMethod("setVolume", [this](const json& params) -> json {
            double vol = params.value("volume", 1.0);
            vol = std::max(0.0, std::min(1.0, vol));
            volume.store(vol);
            return json{{"volume", vol}};
        });
    }

    // Start the server in a background thread
    void start() {
        // Move server to heap so it lives for the thread duration
        auto* rawServer = server.release();
        scoped.start(std::thread([rawServer]() {
            rawServer->start();
            delete rawServer;
        }), pipe);

        // Give the server a moment to start reading
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    // Send a JSON-RPC request and parse the response line
    json sendRequest(const std::string& requestLine, int timeoutMs = 3000) {
        pipe.send(requestLine);
        auto line = pipe.readLine(timeoutMs);
        if (line.empty()) {
            // Return a marker object; caller should check
            return json{{"_empty", true}};
        }
        return json::parse(line);
    }

    // Verify jsonrpc + id in a response.  Returns true on success.
    bool verifyEnvelope(const json& resp, const json& expectedId) {
        if (resp.value("_empty", false)) return false;
        return resp.value("jsonrpc", "") == "2.0" &&
               resp.value("id", json())    == expectedId;
    }

    // Check that response is a success (has result, no error).  Returns true on success.
    bool verifySuccess(const json& resp) {
        if (resp.value("_empty", false)) return false;
        return resp.find("result") != resp.end() &&
               resp.find("error")  == resp.end();
    }

    ~HarnessFixture() = default;
};

// ── Test: device.list returns device array ─────────────────────────────────────
static int test_device_list() {
    std::cout << "  test_device_list...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    auto resp = fx.sendRequest(
        R"({"jsonrpc":"2.0","id":1,"method":"device.list","params":{}})");

    CHECK(fx.verifyEnvelope(resp, 1));
    CHECK(fx.verifySuccess(resp));
    CHECK(resp["result"].find("devices") != resp["result"].end());
    CHECK(resp["result"]["devices"].is_array());
    CHECK(resp["result"]["devices"].size() >= 1);
    CHECK(resp["result"]["devices"][0]["id"]   == "null");
    CHECK(resp["result"]["devices"][0]["name"] == "Null Output Device");

    fx.scoped.shutdown();
    return 0;
}

// ── Test: test.play writes to NullBackend ──────────────────────────────────────
static int test_play() {
    std::cout << "  test_play...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    // Verify initial state: 0 frames written
    {
        auto status = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":1,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(status, 1));
        CHECK(fx.verifySuccess(status));
        CHECK(status["result"]["framesWritten"] == 0);
        CHECK(status["result"]["state"] == "stopped");
    }

    // Play: send 44100 frames of dummy data
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":2,"method":"test.play","params":{"path":"/tmp/test.flac","sampleRate":44100,"channels":2,"frames":44100}})");
        CHECK(fx.verifyEnvelope(resp, 2));
        CHECK(fx.verifySuccess(resp));
        CHECK_JSON(resp["result"], "status", "playing");
        CHECK(resp["result"]["framesWritten"] == 44100);
        CHECK(resp["result"]["writeCount"] == 1);
    }

    // Verify NullBackend state via test.getStatus
    {
        auto status = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":3,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(status, 3));
        CHECK(fx.verifySuccess(status));
        CHECK(status["result"]["framesWritten"] == 44100);
        CHECK(status["result"]["writeCount"] == 1);
        CHECK(status["result"]["state"] == "playing");
        CHECK(status["result"]["isOpen"] == true);
    }

    // Play again: frames should accumulate
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":4,"method":"test.play","params":{"frames":22050}})");
        CHECK(fx.verifyEnvelope(resp, 4));
        CHECK(fx.verifySuccess(resp));
        CHECK(resp["result"]["framesWritten"] == 66150);  // 44100 + 22050
        CHECK(resp["result"]["writeCount"] == 2);
    }

    fx.scoped.shutdown();
    return 0;
}

// ── Test: pause → resume state transitions ────────────────────────────────────
static int test_pause_resume() {
    std::cout << "  test_pause_resume...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    // Start in stopped state
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":1,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 1));
        CHECK(resp["result"]["state"] == "stopped");
    }

    // Play a bit first
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":2,"method":"test.play","params":{"frames":1000}})");
        CHECK(fx.verifyEnvelope(resp, 2));
    }

    // Verify playing
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":3,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 3));
        CHECK(resp["result"]["state"] == "playing");
    }

    // Pause
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":4,"method":"pause","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 4));
        CHECK(fx.verifySuccess(resp));
        CHECK_JSON(resp["result"], "status", "paused");
    }

    // Verify paused
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":5,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 5));
        CHECK(resp["result"]["state"] == "paused");
    }

    // Resume
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":6,"method":"resume","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 6));
        CHECK(fx.verifySuccess(resp));
        CHECK_JSON(resp["result"], "status", "playing");
    }

    // Verify playing again
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":7,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 7));
        CHECK(resp["result"]["state"] == "playing");
    }

    fx.scoped.shutdown();
    return 0;
}

// ── Test: setVolume ───────────────────────────────────────────────────────────
static int test_set_volume() {
    std::cout << "  test_set_volume...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    // Default volume should be 1.0
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":1,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 1));
        CHECK(resp["result"]["volume"] == 1.0);
    }

    // Set volume to 0.5
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":2,"method":"setVolume","params":{"volume":0.5}})");
        CHECK(fx.verifyEnvelope(resp, 2));
        CHECK(fx.verifySuccess(resp));
        CHECK_JSON(resp["result"], "volume", 0.5);
    }

    // Verify via getStatus
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":3,"method":"test.getStatus","params":{}})");
        CHECK(fx.verifyEnvelope(resp, 3));
        CHECK(resp["result"]["volume"] == 0.5);
    }

    // Set volume to 0.0 (mute)
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":4,"method":"setVolume","params":{"volume":0.0}})");
        CHECK(fx.verifyEnvelope(resp, 4));
        CHECK_JSON(resp["result"], "volume", 0.0);
    }

    // Clamp: set to 1.5 → should become 1.0
    {
        auto resp = fx.sendRequest(
            R"({"jsonrpc":"2.0","id":5,"method":"setVolume","params":{"volume":1.5}})");
        CHECK(fx.verifyEnvelope(resp, 5));
        CHECK_JSON(resp["result"], "volume", 1.0);
    }

    fx.scoped.shutdown();
    return 0;
}

// ── Test: shutdown exits cleanly ──────────────────────────────────────────────
static int test_shutdown() {
    std::cout << "  test_shutdown...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    auto resp = fx.sendRequest(
        R"({"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}})");

    CHECK(fx.verifyEnvelope(resp, 1));
    CHECK(fx.verifySuccess(resp));
    CHECK_JSON(resp["result"], "status", "shutdown");

    // Server thread should have joined via ScopedServer
    // (No explicit verification needed — if shutdown didn't work,
    //  the test would hang or the thread would detach in destructor.)
    return 0;
}

// ── Test: test.echo round-trip ────────────────────────────────────────────────
static int test_echo() {
    std::cout << "  test_echo...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    json resp = fx.sendRequest(
        R"({"jsonrpc":"2.0","id":1,"method":"test.echo","params":{"msg":"hello"}})");

    CHECK(fx.verifyEnvelope(resp, 1));
    CHECK(fx.verifySuccess(resp));
    CHECK(resp["result"]["msg"] == "hello");

    fx.scoped.shutdown();
    return 0;
}

// ── Test: unknown method returns -32601 ───────────────────────────────────────
static int test_unknown_method() {
    std::cout << "  test_unknown_method...\n";

    HarnessFixture fx;
    CHECK(fx.pipe.active);
    fx.start();

    json resp = fx.sendRequest(
        R"({"jsonrpc":"2.0","id":1,"method":"nonexistent","params":{}})");

    CHECK(resp["jsonrpc"] == "2.0");
    CHECK(resp["id"] == 1);
    CHECK(resp["error"]["code"] == -32601);

    fx.scoped.shutdown();
    return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-harness tests ===\n";

    int failures = 0;
    failures += test_device_list();
    failures += test_play();
    failures += test_pause_resume();
    failures += test_set_volume();
    failures += test_shutdown();
    failures += test_echo();
    failures += test_unknown_method();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
