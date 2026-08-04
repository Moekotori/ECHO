#pragma once
#include <atomic>
#include <cstdint>
#include <mutex>

/**
 * Session state for one playback session.
 * Replaces scattered atomics (inputEnded, sessionHasAudio, stopRequested, etc.)
 * with a single synchronized object.
 */
class PlaybackSession {
public:
    PlaybackSession() {
        // Start in "ready for begin" state — no warmup hack needed
        inputEnded_.store(true, std::memory_order_release);
    }

    /** Start a new session. Increments generation to invalidate old threads. */
    void begin() {
        std::lock_guard<std::mutex> lock(mtx_);
        generation_.fetch_add(1, std::memory_order_release);
        inputEnded_.store(false, std::memory_order_release);
        hasAudio_.store(false, std::memory_order_release);
        stopRequested_.store(false, std::memory_order_release);
    }

    /** Mark input as ended — no more data will be pushed. */
    void markInputEnded() {
        inputEnded_.store(true, std::memory_order_release);
    }

    /** Query whether input has been marked as ended. */
    bool isInputEnded() const {
        return inputEnded_.load(std::memory_order_acquire);
    }

    /** Check if buffer is empty AND input is ended. */
    bool isDrained(bool fifoEmpty) const {
        return inputEnded_.load(std::memory_order_acquire) && fifoEmpty;
    }

    /** Signal that audio data has been pushed. */
    void markHasAudio() {
        hasAudio_.store(true, std::memory_order_release);
    }

    bool hasAudio() const {
        return hasAudio_.load(std::memory_order_acquire);
    }

    /** Request all producers to stop. */
    void requestStop() {
        stopRequested_.store(true, std::memory_order_release);
    }

    bool isStopRequested() const {
        return stopRequested_.load(std::memory_order_acquire);
    }

    /** Get current generation. Old threads check this to detect expiration. */
    uint64_t generation() const {
        return generation_.load(std::memory_order_acquire);
    }

private:
    std::mutex mtx_;
    std::atomic<uint64_t> generation_{0};
    std::atomic<bool> inputEnded_{true};   // starts ended (no session active)
    std::atomic<bool> hasAudio_{false};
    std::atomic<bool> stopRequested_{false};
};
