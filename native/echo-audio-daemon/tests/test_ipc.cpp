// ── IPC Module Tests ──────────────────────────────────────────────────────────
// Tests for MessageTypes.h parsing/response builders and JsonRpcServer dispatch,
// error handling, event output, throttling, and shutdown.
//
// Build target: echo-daemon-ipc-tests
//
// Pipe-based approach: tests that exercise the full server redirect stdin/stdout
// via pipe(2) + dup2(2), run the server in a background thread, then send
// requests and read responses through the pipes.

#include <cassert>
#include <chrono>
#include <cstring>
#include <iostream>
#include <poll.h>
#include <sstream>
#include <string>
#include <thread>
#include <unistd.h>

#include "src/ipc/JsonRpcServer.h"

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

// ── Pipe Test Helper ─────────────────────────────────────────────────────────
// Creates a pair of pipes, redirects the server's stdin/stdout, and provides
// helper methods for the test to send data and read responses.
struct PipeHelper {
    int oldStdin  = -1;
    int oldStdout = -1;

    // Server side
    int stdinRead  = -1;  // server reads from this
    int stdoutWrite = -1; // server writes to this

    // Test side
    int stdinWrite = -1;  // test writes   to this → server reads
    int stdoutRead = -1;  // test reads    from this ← server writes

    bool active = false;

    PipeHelper() {
        // Flush all stdio buffers before redirecting stdout
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

    // Send a line to the server's stdin (appends \n)
    void send(const std::string& line) {
        std::string msg = line + "\n";
        ::write(stdinWrite, msg.data(), msg.size());
    }

    // Read a single line from the server's stdout (blocking, with timeout ms).
    // Returns empty string on timeout or error.
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

    // Read all available data (up to maxLines) with short per-line timeout.
    // Used for throttling tests where many events are expected.
    std::vector<std::string> readAll(int maxLines = 200, int perLineTimeoutMs = 200) {
        std::vector<std::string> lines;
        for (int i = 0; i < maxLines; ++i) {
            auto line = readLine(perLineTimeoutMs);
            if (line.empty()) break;
            lines.push_back(std::move(line));
        }
        return lines;
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
// RAII helper that sends shutdown and joins on destruction.
// Prevents std::terminate when CHECK triggers early return.
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

// ── Test: Valid Request Parsing ───────────────────────────────────────────────
static int test_valid_request() {
    std::cout << "  test_valid_request...\n";

    auto req = ead::parseRequest(
        R"({"jsonrpc":"2.0","id":1,"method":"play","params":{"path":"/music/track.flac"}})");
    CHECK(req.has_value());
    CHECK(req->method == "play");
    CHECK(req->params["path"] == "/music/track.flac");
    CHECK(req->id.has_value());
    CHECK(req->id.value() == 1);

    // Notification (no id)
    auto notif = ead::parseRequest(
        R"({"jsonrpc":"2.0","method":"event.state","params":{"state":"playing"}})");
    CHECK(notif.has_value());
    CHECK(notif->method == "event.state");
    CHECK(!notif->id.has_value());

    // No params
    auto noParams = ead::parseRequest(
        R"({"jsonrpc":"2.0","id":2,"method":"pause"})");
    CHECK(noParams.has_value());
    CHECK(noParams->method == "pause");
    CHECK(noParams->params.is_object());
    CHECK(noParams->params.empty());

    return 0;
}

// ── Test: Invalid JSON ────────────────────────────────────────────────────────
static int test_invalid_json() {
    std::cout << "  test_invalid_json...\n";

    // Garbage input
    auto r1 = ead::parseRequest("not json");
    CHECK(!r1.has_value());

    // Empty
    auto r2 = ead::parseRequest("");
    CHECK(!r2.has_value());

    // JSON array (not object)
    CHECK_THROWS(ead::parseRequest("[1,2,3]"), "object");

    return 0;
}

// ── Test: Missing or Invalid Fields ───────────────────────────────────────────
static int test_missing_fields() {
    std::cout << "  test_missing_fields...\n";

    // Missing jsonrpc
    CHECK_THROWS(
        ead::parseRequest(R"({"id":1,"method":"play","params":{}})"),
        "jsonrpc");

    // Wrong jsonrpc version
    CHECK_THROWS(
        ead::parseRequest(R"({"jsonrpc":"1.0","id":1,"method":"play","params":{}})"),
        "jsonrpc");

    // Missing method
    CHECK_THROWS(
        ead::parseRequest(R"({"jsonrpc":"2.0","id":1,"params":{}})"),
        "method");

    // Method not a string
    CHECK_THROWS(
        ead::parseRequest(R"({"jsonrpc":"2.0","id":1,"method":123,"params":{}})"),
        "method");

    return 0;
}

// ── Test: Response Format ─────────────────────────────────────────────────────
static int test_response_format() {
    std::cout << "  test_response_format...\n";

    // Successful response
    ead::JsonRpcResponse resp;
    resp.id     = 1;
    resp.result = json{{"status", "playing"}};
    json j = ead::makeResponse(resp);
    CHECK(j["jsonrpc"] == "2.0");
    CHECK(j["id"] == 1);
    CHECK(j["result"]["status"] == "playing");
    CHECK(j.find("error") == j.end());

    // Error response
    json errJ = ead::makeErrorResponse(json(42),
        static_cast<int>(ead::JsonRpcErrorCode::MethodNotFound),
        "Method not found");
    CHECK(errJ["jsonrpc"] == "2.0");
    CHECK(errJ["id"] == 42);
    CHECK(errJ["error"]["code"] == -32601);
    CHECK(errJ["error"]["message"] == "Method not found");
    CHECK(errJ.find("result") == errJ.end());

    // Error response with data
    json errWithData = ead::makeErrorResponse(
        json(1),
        static_cast<int>(ead::JsonRpcErrorCode::ParseError),
        "Parse error",
        {{"details", "column 5"}});
    CHECK(errWithData["error"]["data"]["details"] == "column 5");

    return 0;
}

// ── Test: Event Format ────────────────────────────────────────────────────────
static int test_event_format() {
    std::cout << "  test_event_format...\n";

    json j = ead::makeEvent("event.position",
                            {{"seconds", 42.0}, {"duration", 245.3}});
    CHECK(j["jsonrpc"] == "2.0");
    CHECK(j["method"]  == "event.position");
    CHECK(j["params"]["seconds"]  == 42.0);
    CHECK(j["params"]["duration"] == 245.3);
    CHECK(j.find("id") == j.end()); // notifications have no id

    return 0;
}

// ── Test: Param Extraction Helpers ────────────────────────────────────────────
static int test_param_extraction() {
    std::cout << "  test_param_extraction...\n";

    json params = {
        {"path", "/music/track.flac"},
        {"volume", 0.75},
        {"count", 42},
        {"enabled", true},
        {"optional_str", "present"},
        {"optional_num", 3.14},
    };

    // Required
    CHECK(ead::getParamString(params, "path") == "/music/track.flac");
    CHECK(ead::getParamDouble(params, "volume") == 0.75);
    CHECK(ead::getParamInt(params, "count") == 42);
    CHECK(ead::getParamBool(params, "enabled") == true);

    // Required missing → throw
    CHECK_THROWS(ead::getParamString(params, "nope"), "Missing");

    // Optional
    CHECK(ead::getParamStringOpt(params, "optional_str") == "present");
    CHECK(ead::getParamStringOpt(params, "missing") == "");
    CHECK(ead::getParamStringOpt(params, "missing", "default") == "default");
    CHECK(ead::getParamDoubleOpt(params, "optional_num") == 3.14);
    CHECK(ead::getParamDoubleOpt(params, "missing", 1.0) == 1.0);
    CHECK(ead::getParamIntOpt(params, "count") == 42);
    CHECK(ead::getParamIntOpt(params, "missing", -1) == -1);
    CHECK(ead::getParamBoolOpt(params, "enabled") == true);
    CHECK(ead::getParamBoolOpt(params, "missing", true) == true);

    return 0;
}

// ── Test: Valid Dispatch ──────────────────────────────────────────────────────
static int test_valid_dispatch() {
    std::cout << "  test_valid_dispatch...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;

    bool handlerCalled = false;
    json handlerParams;
    server.registerMethod("test.echo", [&](const json& params) -> json {
        handlerCalled  = true;
        handlerParams  = params;
        return params; // echo back
    });

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);

    // Give server a moment to start reading
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Send request
    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"test.echo","params":{"key":"value"}})");

    // Read response
    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["jsonrpc"] == "2.0");
    CHECK(resp["id"] == 1);
    CHECK(resp["result"]["key"] == "value");

    scoped.shutdown();

    CHECK(handlerCalled);
    CHECK(handlerParams["key"] == "value");

    return 0;
}

// ── Test: Unknown Method → -32601 ─────────────────────────────────────────────
static int test_unknown_method() {
    std::cout << "  test_unknown_method...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;
    // No handlers registered

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    pipe.send(R"({"jsonrpc":"2.0","id":42,"method":"nonexistent","params":{}})");

    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["jsonrpc"] == "2.0");
    CHECK(resp["id"] == 42);
    CHECK(resp["error"]["code"] == -32601);

    scoped.shutdown();

    return 0;
}

// ── Test: Notification (no response expected) ─────────────────────────────────
static int test_notification() {
    std::cout << "  test_notification...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;
    int callCount = 0;
    server.registerMethod("notif.test", [&](const json&) -> json {
        ++callCount;
        return json{{"ok", true}};
    });

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Notification (no id) → handler runs but no response sent
    pipe.send(R"({"jsonrpc":"2.0","method":"notif.test","params":{}})");

    // Send a regular request after to synchronize
    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"notif.test","params":{}})");
    auto respLine = pipe.readLine(2000);
    CHECK(!respLine.empty());

    scoped.shutdown();

    // Handler should have been called twice (notification + request)
    CHECK(callCount == 2);

    return 0;
}

// ── Test: Handler Exception → -32000 ──────────────────────────────────────────
static int test_handler_exception() {
    std::cout << "  test_handler_exception...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;
    server.registerMethod("faulty", [&](const json&) -> json {
        throw std::runtime_error("something broke");
    });

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"faulty","params":{}})");

    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["error"]["code"] == -32000);
    CHECK(resp["error"]["message"].get<std::string>().find("something broke")
          != std::string::npos);

    scoped.shutdown();

    return 0;
}

// ── Test: Event Output ────────────────────────────────────────────────────────
static int test_event_output() {
    std::cout << "  test_event_output...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;

    // Register a handler that sends events
    server.registerMethod("fire", [&](const json& params) -> json {
        server.sendEvent("event.state", params);
        return json{{"fired", true}};
    });

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"fire","params":{"state":"playing"}})");

    // Read event first (queued before response, inside handler)
    auto eventLine = pipe.readLine(2000);
    CHECK(!eventLine.empty());
    json evt = json::parse(eventLine);
    CHECK(evt["method"] == "event.state");
    CHECK(evt["params"]["state"] == "playing");
    CHECK(evt.find("id") == evt.end()); // notification

    // Read response
    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["result"]["fired"] == true);

    scoped.shutdown();

    return 0;
}

// ── Test: Event Throttling ────────────────────────────────────────────────────
static int test_event_throttling() {
    std::cout << "  test_event_throttling...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Fire 50 position events in rapid succession
    for (int i = 0; i < 50; ++i) {
        server.sendEvent("event.position", {{"seconds", double(i)}, {"duration", 300.0}});
    }

    // Send a dummy request to flush output
    server.registerMethod("ping", [&](const json&) -> json {
        return json{{"pong", true}};
    });
    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"ping","params":{}})");

    // Read all lines from stdout
    auto lines = pipe.readAll(100, 300);

    scoped.shutdown();

    // Count position events
    int posEvents = 0;
    std::string lastSeconds;
    for (const auto& l : lines) {
        if (l.find("\"event.position\"") != std::string::npos ||
            l.find("\"method\":\"event.position\"") != std::string::npos) {
            ++posEvents;
            // Extract seconds value
            auto s = l.find("\"seconds\"");
            if (s != std::string::npos) {
                lastSeconds = l.substr(s);
            }
        }
    }

    // With 100ms throttle and 50 rapid calls, we should see ≤ 3 position events
    // (1 immediate + maybe 1-2 from flushThread). Definitely not 50.
    CHECK(posEvents <= 3);
    CHECK(posEvents >= 1);

    // The last position event should reflect the latest data (seconds == 49)
    CHECK(lastSeconds.find("49") != std::string::npos);

    return 0;
}

// ── Test: Shutdown ────────────────────────────────────────────────────────────
static int test_shutdown() {
    std::cout << "  test_shutdown...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    pipe.send(R"({"jsonrpc":"2.0","id":100,"method":"shutdown","params":{}})");

    // Read shutdown response
    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["id"] == 100);
    CHECK(resp["result"]["status"] == "shutdown");

    scoped.shutdown();

    return 0;
}

// ── Test: Parse Error Response (invalid JSON via server) ──────────────────────
static int test_parse_error_response() {
    std::cout << "  test_parse_error_response...\n";

    PipeHelper pipe;
    CHECK(pipe.active);

    ead::JsonRpcServer server;

    ScopedServer scoped;
    scoped.start(std::thread([&]() { server.start(); }), pipe);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Send garbage
    pipe.send("this is not json");

    auto respLine = pipe.readLine();
    CHECK(!respLine.empty());
    json resp = json::parse(respLine);
    CHECK(resp["jsonrpc"] == "2.0");
    CHECK(resp["error"]["code"] == -32700);
    CHECK(resp["id"].is_null());

    scoped.shutdown();

    return 0;
}

// ── Test: Error Code Constants ───────────────────────────────────────────────
static int test_error_code_constants() {
    std::cout << "  test_error_code_constants...\n";

    using E = ead::JsonRpcErrorCode;
    CHECK(static_cast<int>(E::ParseError)       == -32700);
    CHECK(static_cast<int>(E::InvalidRequest)   == -32600);
    CHECK(static_cast<int>(E::MethodNotFound)   == -32601);
    CHECK(static_cast<int>(E::InvalidParams)    == -32602);
    CHECK(static_cast<int>(E::InternalError)    == -32000);
    CHECK(static_cast<int>(E::DeviceUnavailable) == -32001);
    CHECK(static_cast<int>(E::DecodeError)       == -32002);
    CHECK(static_cast<int>(E::FormatUnsupported) == -32003);
    CHECK(static_cast<int>(E::SeekError)         == -32004);
    CHECK(static_cast<int>(E::AsioDriverError)   == -32005);

    return 0;
}

// ── Test: Method/Event Name Constants ─────────────────────────────────────────
static int test_name_constants() {
    std::cout << "  test_name_constants...\n";

    CHECK(std::string(ead::METHOD_PLAY)               == "play");
    CHECK(std::string(ead::METHOD_PAUSE)              == "pause");
    CHECK(std::string(ead::METHOD_RESUME)             == "resume");
    CHECK(std::string(ead::METHOD_STOP)               == "stop");
    CHECK(std::string(ead::METHOD_SEEK)               == "seek");
    CHECK(std::string(ead::METHOD_NEXT)               == "next");
    CHECK(std::string(ead::METHOD_PREVIOUS)           == "previous");
    CHECK(std::string(ead::METHOD_SET_VOLUME)         == "setVolume");
    CHECK(std::string(ead::METHOD_SET_OUTPUT)         == "setOutput");
    CHECK(std::string(ead::METHOD_DEVICE_LIST)        == "device.list");
    CHECK(std::string(ead::METHOD_EQ_SET_BAND)        == "eq.setBand");
    CHECK(std::string(ead::METHOD_EQ_SET_ENABLED)     == "eq.setEnabled");
    CHECK(std::string(ead::METHOD_EQ_SET_PRESET)      == "eq.setPreset");
    CHECK(std::string(ead::METHOD_EQ_RESET)           == "eq.reset");
    CHECK(std::string(ead::METHOD_CONVOLUTION_LOAD_IR) == "convolution.loadIr");
    CHECK(std::string(ead::METHOD_CONVOLUTION_SET_ENABLED) == "convolution.setEnabled");
    CHECK(std::string(ead::METHOD_CHANNEL_BALANCE_SET_STATE) == "channelBalance.setState");
    CHECK(std::string(ead::METHOD_PROBE)              == "probe");
    CHECK(std::string(ead::METHOD_LEVEL_METER_SUBSCRIBE)   == "levelMeter.subscribe");
    CHECK(std::string(ead::METHOD_LEVEL_METER_UNSUBSCRIBE) == "levelMeter.unsubscribe");
    CHECK(std::string(ead::METHOD_PREPARE_AUTOMIX)    == "prepareAutomix");
    CHECK(std::string(ead::METHOD_QUEUE_NEXT)         == "queueNext");
    CHECK(std::string(ead::METHOD_SHUTDOWN)           == "shutdown");

    CHECK(std::string(ead::EVENT_POSITION)      == "event.position");
    CHECK(std::string(ead::EVENT_STATE)         == "event.state");
    CHECK(std::string(ead::EVENT_TRACK_ENDED)   == "event.trackEnded");
    CHECK(std::string(ead::EVENT_TRACK_STARTED) == "event.trackStarted");
    CHECK(std::string(ead::EVENT_LEVEL_METER)   == "event.levelMeter");
    CHECK(std::string(ead::EVENT_DEVICE_CHANGED) == "event.deviceChanged");
    CHECK(std::string(ead::EVENT_DSP_STATE)     == "event.dspState");
    CHECK(std::string(ead::EVENT_READY)         == "event.ready");

    return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-ipc tests ===\n";

    int failures = 0;

    // Pure function tests (no IO)
    failures += test_valid_request();
    failures += test_invalid_json();
    failures += test_missing_fields();
    failures += test_response_format();
    failures += test_event_format();
    failures += test_param_extraction();
    failures += test_error_code_constants();
    failures += test_name_constants();

    // Server integration tests (pipe-based IO)
    failures += test_valid_dispatch();
    failures += test_unknown_method();
    failures += test_notification();
    failures += test_handler_exception();
    failures += test_event_output();
    failures += test_event_throttling();
    failures += test_shutdown();
    failures += test_parse_error_response();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
