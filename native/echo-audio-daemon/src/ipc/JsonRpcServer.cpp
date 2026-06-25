#include "src/ipc/JsonRpcServer.h"

#include <iostream>
#include <stdexcept>

namespace echo_audio_daemon {

// ── Destructor ────────────────────────────────────────────────────────────────
JsonRpcServer::~JsonRpcServer() {
    // If the server is still running, signal shutdown and let the
    // destructor clean up.  (Ideally start() has already returned.)
    m_shutdown = true;
    m_outputCv.notify_all();
}

// ── Registration ──────────────────────────────────────────────────────────────
void JsonRpcServer::registerMethod(std::string name, MethodHandler handler) {
    m_handlers[std::move(name)] = std::move(handler);
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
void JsonRpcServer::start() {
    m_shutdown = false;

    // Start the background write thread
    std::thread writer(&JsonRpcServer::writeThreadFunc, this);

    // ── Read loop ────────────────────────────────────────────────────────────
    std::string line;
    while (!m_shutdown && std::getline(std::cin, line)) {
        if (line.empty()) continue;

        // 1. Parse
        auto req = parseRequest(line);
        if (!req.has_value()) {
            // Invalid JSON → -32700 Parse error
            auto errResp = makeErrorResponse(
                json(), static_cast<int32_t>(JsonRpcErrorCode::ParseError),
                "Parse error: invalid JSON");
            queueOutput(errResp.dump());
            continue;
        }

        // 2. Validate request structure
        //    (parseRequest throws on missing method / wrong jsonrpc version)
        //    This path is for structural validation errors.
        //    The handler dispatch catches runtime exceptions.

        // 3. Shutdown special handling
        if (req->method == METHOD_SHUTDOWN) {
            auto response = makeResponse({
                req->id,
                json{{"status", "shutdown"}},
                std::nullopt
            });
            queueOutput(response.dump());
            m_shutdown = true;
            break;
        }

        // 4. Lookup handler
        auto handlerIt = m_handlers.find(req->method);
        if (handlerIt == m_handlers.end()) {
            // Method not found → -32601
            if (req->id.has_value()) {
                auto errResp = makeErrorResponse(
                    req->id,
                    static_cast<int32_t>(JsonRpcErrorCode::MethodNotFound),
                    "Method not found: " + req->method);
                queueOutput(errResp.dump());
            }
            continue;
        }

        // 5. Dispatch
        try {
            json result = handlerIt->second(req->params);
            if (req->id.has_value()) {
                auto response = makeResponse({req->id, std::move(result), std::nullopt});
                queueOutput(response.dump());
            }
        } catch (const std::exception& e) {
            if (req->id.has_value()) {
                auto errResp = makeErrorResponse(
                    req->id,
                    static_cast<int32_t>(JsonRpcErrorCode::InternalError),
                    std::string("Handler error: ") + e.what());
                queueOutput(errResp.dump());
            }
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // If the read loop exited for any reason other than shutdown, still signal.
    if (!m_shutdown.exchange(true)) {
        // We were the first to set shutdown
    }
    m_outputCv.notify_all();

    if (writer.joinable()) {
        writer.join();
    }
}

// ── Event / Response (thread-safe producers) ──────────────────────────────────
void JsonRpcServer::sendEvent(const std::string& eventName, json params) {
    std::lock_guard<std::mutex> lock(m_outputMutex);

    // Lazily create throttle entry
    auto it = m_throttleState.find(eventName);
    if (it == m_throttleState.end()) {
        auto interval = throttleIntervalFor(eventName);
        auto [newIt, _] = m_throttleState.try_emplace(
            eventName,
            ThrottleEntry{
                std::chrono::steady_clock::now(),
                interval,
                eventName,
                json(),
                false
            });
        it = newIt;
    }

    ThrottleEntry& entry = it->second;

    // Check throttle
    if (entry.minInterval.count() > 0) {
        auto now = std::chrono::steady_clock::now();
        auto elapsed = now - entry.lastEmit;

        if (elapsed < entry.minInterval) {
            // Suppress: store latest params (overwriting any previous pending)
            entry.pendingParams = std::move(params);
            entry.hasPending = true;
            return;
        }

        entry.lastEmit = now;
        entry.hasPending = false;
    }

    // Queue the event immediately
    json event = makeEvent(eventName, std::move(params));
    m_outputQueue.push(event.dump());
    m_outputCv.notify_one();
}

void JsonRpcServer::sendResponse(const JsonRpcResponse& resp) {
    json j = makeResponse(resp);
    queueOutput(j.dump());
}

// ── Write Thread ──────────────────────────────────────────────────────────────
void JsonRpcServer::writeThreadFunc() {
    std::unique_lock<std::mutex> lock(m_outputMutex);

    while (true) {
        // Flush any pending throttled events whose interval has expired
        flushThrottled();

        // Drain the output queue
        while (!m_outputQueue.empty()) {
            auto line = std::move(m_outputQueue.front());
            m_outputQueue.pop();
            lock.unlock();
            std::cout << line << std::endl;
            lock.lock();
        }

        // Exit condition: shutdown AND queue empty AND no pending throttled data
        if (m_shutdown && m_outputQueue.empty() && !hasAnyPending()) {
            break;
        }

        // Wait for more work (with 50ms timeout for throttled event flushing)
        m_outputCv.wait_for(lock, std::chrono::milliseconds(50), [this] {
            return m_shutdown || !m_outputQueue.empty();
        });
    }
}

// ── Throttle Helpers ──────────────────────────────────────────────────────────
void JsonRpcServer::flushThrottled() {
    auto now = std::chrono::steady_clock::now();

    for (auto& [name, entry] : m_throttleState) {
        if (!entry.hasPending) continue;

        auto elapsed = now - entry.lastEmit;
        if (elapsed >= entry.minInterval) {
            // Time to send the latest pending data
            json event = makeEvent(entry.eventName, std::move(entry.pendingParams));
            m_outputQueue.push(event.dump());
            entry.lastEmit = now;
            entry.hasPending = false;
        }
    }

    if (!m_outputQueue.empty()) {
        // Don't notify_one here because we already hold the lock and it would
        // be consumed by the current thread.  The drain loop above handles it.
    }
}

bool JsonRpcServer::hasAnyPending() const {
    for (const auto& [_, entry] : m_throttleState) {
        if (entry.hasPending) return true;
    }
    return false;
}

void JsonRpcServer::queueOutput(const std::string& line) {
    std::lock_guard<std::mutex> lock(m_outputMutex);
    m_outputQueue.push(line);
    m_outputCv.notify_one();
}

} // namespace echo_audio_daemon
