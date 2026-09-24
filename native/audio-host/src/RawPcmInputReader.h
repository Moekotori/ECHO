#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

class RawPcmInputReader final
{
public:
    using PushFrames = std::function<bool(const float*, int)>;
    using PushRawFrames = std::function<bool(const uint8_t*, int)>;
    using ErrorHandler = std::function<void(const std::string&)>;

    RawPcmInputReader(int fd, int channels, PushFrames pushFrames, ErrorHandler onError);
    RawPcmInputReader(
        int fd,
        int channels,
        int bytesPerSample,
        PushRawFrames pushRawFrames,
        ErrorHandler onError);
    ~RawPcmInputReader();

    RawPcmInputReader(const RawPcmInputReader&) = delete;
    RawPcmInputReader& operator=(const RawPcmInputReader&) = delete;

    void start();
    void stop();
    uint64_t bytesConsumed() const noexcept;
    void discardThrough(uint64_t targetBytes) noexcept;
    bool waitUntilBytesConsumed(uint64_t targetBytes, std::chrono::milliseconds timeout);

private:
    void run();

    int fd_ = -1;
    int channels_ = 0;
    int bytesPerSample_ = static_cast<int>(sizeof(float));
    PushFrames pushFrames_;
    PushRawFrames pushRawFrames_;
    ErrorHandler onError_;
    std::atomic<bool> running_ { false };
    std::atomic<uint64_t> bytesConsumed_ { 0 };
    std::atomic<uint64_t> discardThroughBytes_ { 0 };
    mutable std::mutex consumedMutex_;
    std::condition_variable consumedSignal_;
    std::thread worker_;
};
