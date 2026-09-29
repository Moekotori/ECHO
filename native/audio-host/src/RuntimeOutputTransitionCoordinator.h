#pragma once

#include <chrono>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <exception>
#include <functional>
#include <mutex>
#include <optional>
#include <memory>
#include <string>
#include <thread>

struct RuntimeOutputTransitionResult
{
    bool success = false;
    int actualSampleRate = 0;
    std::string mode;
    std::string error;
    double durationMs = 0.0;
};

// ASIO device ownership stays on the JSON-RPC thread. The playback/drain
// thread submits a transition and waits while the owner thread pumps it.
class RuntimeOutputTransitionCoordinator
{
public:
    using Handler = std::function<RuntimeOutputTransitionResult(int)>;
    using HangHandler = std::function<void()>;

    void setHandler(Handler nextHandler)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        handler_ = std::move(nextHandler);
    }

    void setShutdownSignal(const std::atomic<bool>* shutdownSignal)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        shutdownSignal_ = shutdownSignal;
    }

    void setExecutionWatchdog(std::chrono::milliseconds timeout, HangHandler hangHandler)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        executionTimeout_ = timeout;
        hangHandler_ = std::move(hangHandler);
    }

    RuntimeOutputTransitionResult request(int targetSampleRate)
    {
        std::unique_lock<std::mutex> lock(mutex_);
        if (closed_ || ! handler_ || pending_.has_value() || executing_)
            return {false, 0, {}, "runtime_output_transition_unavailable", 0.0};

        const uint64_t requestId = ++nextRequestId_;
        pending_ = Request {requestId, targetSampleRate};
        wake_.notify_all();
        const auto pickupDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
        bool completed = false;
        while (! completed)
        {
            completed = completedRequestId_ == requestId
                || (closed_ && executingRequestId_ != requestId)
                || shutdownRequestedLocked();
            if (completed || std::chrono::steady_clock::now() >= pickupDeadline)
                break;
            wake_.wait_for(lock, std::chrono::milliseconds(100));
        }
        if (shutdownRequestedLocked() && completedRequestId_ != requestId)
        {
            if (pending_ && pending_->id == requestId)
                pending_.reset();
            return {false, 0, "transition-executing", "runtime_output_transition_shutdown_requested", 0.0};
        }
        if (! completed)
        {
            if (pending_ && pending_->id == requestId)
            {
                pending_.reset();
                return {false, 0, {}, "runtime_output_transition_timeout", 0.0};
            }
            // Once the driver owner has started a transition, playback truth
            // cannot time out independently while the hardware keeps changing.
            while (completedRequestId_ != requestId && ! shutdownRequestedLocked())
            {
                wake_.wait_for(lock, std::chrono::milliseconds(100));
            }
            if (shutdownRequestedLocked() && completedRequestId_ != requestId)
                return {false, 0, "transition-executing", "runtime_output_transition_shutdown_requested", 0.0};
        }
        if (closed_ && completedRequestId_ != requestId)
            return {false, 0, {}, "runtime_output_transition_closed", 0.0};
        return completedResult_;
    }

    void pump()
    {
        Request request;
        Handler handler;
        HangHandler hangHandler;
        std::chrono::milliseconds executionTimeout { 0 };
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (closed_ || executing_ || ! pending_ || ! handler_)
                return;
            request = *pending_;
            pending_.reset();
            executing_ = true;
            executingRequestId_ = request.id;
            handler = handler_;
            hangHandler = hangHandler_;
            executionTimeout = executionTimeout_;
        }

        auto handlerCompleted = std::make_shared<std::atomic<bool>>(false);
        if (hangHandler && executionTimeout.count() > 0)
        {
            try
            {
                std::thread([handlerCompleted, hangHandler, executionTimeout]
                {
                    std::this_thread::sleep_for(executionTimeout);
                    if (! handlerCompleted->load(std::memory_order_acquire))
                        hangHandler();
                }).detach();
            }
            catch (...)
            {
                // No transition may enter an unbounded vendor call without
                // an independent lifecycle watchdog.
                hangHandler();
            }
        }

        RuntimeOutputTransitionResult result;
        try
        {
            result = handler(request.targetSampleRate);
        }
        catch (const std::exception& error)
        {
            result = {false, 0, {}, error.what(), 0.0};
        }
        catch (...)
        {
            result = {false, 0, {}, "runtime_output_transition_exception", 0.0};
        }
        handlerCompleted->store(true, std::memory_order_release);

        {
            std::lock_guard<std::mutex> lock(mutex_);
            executing_ = false;
            executingRequestId_ = 0;
            completedRequestId_ = request.id;
            completedResult_ = std::move(result);
        }
        wake_.notify_all();
    }

    void close()
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            closed_ = true;
            pending_.reset();
        }
        wake_.notify_all();
    }

    bool waitUntilIdle(std::chrono::milliseconds timeout)
    {
        std::unique_lock<std::mutex> lock(mutex_);
        return wake_.wait_for(lock, timeout, [&] { return ! executing_; });
    }

private:
    struct Request
    {
        uint64_t id = 0;
        int targetSampleRate = 0;
    };

    bool shutdownRequestedLocked() const
    {
        return shutdownSignal_ != nullptr
            && shutdownSignal_->load(std::memory_order_acquire);
    }

    std::mutex mutex_;
    std::condition_variable wake_;
    Handler handler_;
    const std::atomic<bool>* shutdownSignal_ = nullptr;
    HangHandler hangHandler_;
    std::chrono::milliseconds executionTimeout_ { 0 };
    std::optional<Request> pending_;
    RuntimeOutputTransitionResult completedResult_;
    uint64_t nextRequestId_ = 0;
    uint64_t completedRequestId_ = 0;
    uint64_t executingRequestId_ = 0;
    bool executing_ = false;
    bool closed_ = false;
};
