#pragma once

#include "src/ipc/MessageTypes.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>

namespace echo_audio_daemon {

// ── JSON-RPC 2.0 stdin/stdout Server ─────────────────────────────────────────
//
// Reads JSON-RPC 2.0 requests from stdin, dispatches to registered method
// handlers, and writes responses + events to stdout.  Event output is
// asynchronous (queued + write thread) so the read side never blocks on I/O.
//
// Throttling:
//   - event.position    : min 100ms interval
//   - event.levelMeter  : min  50ms interval
//   - All others        : no throttle
//
// Thread safety:
//   - registerMethod()  : must be called BEFORE start() (not thread-safe)
//   - sendEvent()       : thread-safe (can be called from any thread)
//   - sendResponse()    : thread-safe
//   - start()           : blocking; returns after shutdown
class JsonRpcServer {
public:
    JsonRpcServer() = default;
    ~JsonRpcServer();

    // Non-copyable, non-movable
    JsonRpcServer(const JsonRpcServer&) = delete;
    JsonRpcServer& operator=(const JsonRpcServer&) = delete;
    JsonRpcServer(JsonRpcServer&&) = delete;
    JsonRpcServer& operator=(JsonRpcServer&&) = delete;

    // Register a handler for a named method.  Must be called before start().
    void registerMethod(std::string name, MethodHandler handler);

    // Begin reading requests from stdin and dispatching.  Blocks until the
    // "shutdown" method is received.
    void start();

    // Thread-safe: queue an event notification for output.
    // Subject to per-event-type throttling.
    void sendEvent(const std::string& eventName, json params);

    // Thread-safe: queue a response for output.
    void sendResponse(const JsonRpcResponse& resp);

private:
    // ── Internal Types ──────────────────────────────────────────────────────
    struct ThrottleEntry {
        std::chrono::steady_clock::time_point lastEmit;
        std::chrono::milliseconds minInterval{0};
        std::string eventName;
        json pendingParams;
        bool hasPending = false;
    };

    // ── Write Thread ─────────────────────────────────────────────────────────
    void writeThreadFunc();

    // Flush pending (throttle-suppressed) events whose interval has expired.
    // Caller MUST hold m_outputMutex.
    void flushThrottled();

    // Check if any throttle entries have pending data.
    // Caller MUST hold m_outputMutex.
    bool hasAnyPending() const;

    // Queue a raw JSON string for output (with lock + notify).
    void queueOutput(const std::string& line);

    // ── State ────────────────────────────────────────────────────────────────
    std::unordered_map<std::string, MethodHandler> m_handlers;

    // Output queue (shared between read-thread producers and write-thread consumer)
    std::queue<std::string> m_outputQueue;
    std::mutex m_outputMutex;
    std::condition_variable m_outputCv;

    // Per-event-type throttle state
    std::unordered_map<std::string, ThrottleEntry> m_throttleState;

    // Shutdown coordination
    std::atomic<bool> m_shutdown{false};
};

// Return the throttle interval for a known event type, or 0ms for no throttle.
inline std::chrono::milliseconds throttleIntervalFor(const std::string& eventName) {
    if (eventName == EVENT_POSITION) {
        return std::chrono::milliseconds(100);
    }
    if (eventName == EVENT_LEVEL_METER) {
        return std::chrono::milliseconds(50);
    }
    return std::chrono::milliseconds(0); // no throttle
}

} // namespace echo_audio_daemon
