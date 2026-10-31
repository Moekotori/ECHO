#include "RawPcmInputReader.h"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstring>
#include <limits>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace
{
int readPipeFd(int fd, char* buffer, size_t bytes)
{
#ifdef _WIN32
    const intptr_t osHandle = _get_osfhandle(fd);
    if (osHandle == -1)
    {
        errno = EBADF;
        return -1;
    }

    DWORD available = 0;
    if (! PeekNamedPipe(reinterpret_cast<HANDLE>(osHandle), nullptr, 0, nullptr, &available, nullptr))
    {
        const auto error = GetLastError();
        if (error == ERROR_BROKEN_PIPE || error == ERROR_HANDLE_EOF)
            return 0;

        errno = EIO;
        return -1;
    }

    if (available == 0)
    {
        errno = EAGAIN;
        return -1;
    }

    return _read(fd, buffer, static_cast<unsigned int>(std::min<size_t>(bytes, available)));
#else
    const auto result = read(fd, buffer, bytes);
    if (result > static_cast<ssize_t>(std::numeric_limits<int>::max()))
        return std::numeric_limits<int>::max();
    return static_cast<int>(result);
#endif
}
}

RawPcmInputReader::RawPcmInputReader(int fd, int channels, PushFrames pushFrames, ErrorHandler onError)
    : fd_(fd),
      channels_(channels),
      pushFrames_(std::move(pushFrames)),
      onError_(std::move(onError))
{
}

RawPcmInputReader::RawPcmInputReader(
    int fd,
    int channels,
    int bytesPerSample,
    PushRawFrames pushRawFrames,
    ErrorHandler onError)
    : fd_(fd),
      channels_(channels),
      bytesPerSample_(bytesPerSample),
      pushRawFrames_(std::move(pushRawFrames)),
      onError_(std::move(onError))
{
}

RawPcmInputReader::~RawPcmInputReader()
{
    stop();
}

void RawPcmInputReader::start()
{
    if (fd_ < 0 || channels_ <= 0 || bytesPerSample_ <= 0
        || (! pushFrames_ && ! pushRawFrames_)
        || running_.exchange(true, std::memory_order_acq_rel))
        return;

#ifndef _WIN32
    const int flags = fcntl(fd_, F_GETFL);
    if (flags >= 0)
        fcntl(fd_, F_SETFL, flags | O_NONBLOCK);
#endif

    worker_ = std::thread(&RawPcmInputReader::run, this);
}

void RawPcmInputReader::stop()
{
    running_.store(false, std::memory_order_release);
    consumedSignal_.notify_all();
    if (worker_.joinable())
        worker_.join();
}

uint64_t RawPcmInputReader::bytesConsumed() const noexcept
{
    return bytesConsumed_.load(std::memory_order_acquire);
}

void RawPcmInputReader::discardThrough(uint64_t targetBytes) noexcept
{
    auto current = discardThroughBytes_.load(std::memory_order_acquire);
    while (current < targetBytes
        && ! discardThroughBytes_.compare_exchange_weak(
            current, targetBytes, std::memory_order_acq_rel, std::memory_order_acquire))
    {
    }
    consumedSignal_.notify_all();
}

bool RawPcmInputReader::waitUntilBytesConsumed(uint64_t targetBytes, std::chrono::milliseconds timeout)
{
    std::unique_lock<std::mutex> lock(consumedMutex_);
    return consumedSignal_.wait_for(lock, timeout, [&]
    {
        return bytesConsumed_.load(std::memory_order_acquire) >= targetBytes
            || ! running_.load(std::memory_order_acquire);
    }) && bytesConsumed_.load(std::memory_order_acquire) >= targetBytes;
}

void RawPcmInputReader::run()
{
    constexpr size_t readBufferBytes = 64 * 1024;
    const size_t frameBytes = static_cast<size_t>(channels_) * static_cast<size_t>(bytesPerSample_);
    std::vector<char> readBuffer(readBufferBytes);
    std::vector<char> pending;
    pending.reserve(readBufferBytes + frameBytes);

    while (running_.load(std::memory_order_acquire))
    {
        const int bytesRead = readPipeFd(fd_, readBuffer.data(), readBuffer.size());
        if (bytesRead > 0)
        {
            pending.insert(pending.end(), readBuffer.begin(), readBuffer.begin() + bytesRead);
            const size_t completeBytes = (pending.size() / frameBytes) * frameBytes;
            if (completeBytes == 0)
                continue;

            const auto consumedBefore = bytesConsumed_.load(std::memory_order_acquire);
            const auto discardThrough = discardThroughBytes_.load(std::memory_order_acquire);
            const auto discardBytes = discardThrough > consumedBefore
                ? std::min<uint64_t>(static_cast<uint64_t>(completeBytes), discardThrough - consumedBefore)
                : 0;
            if (discardBytes > 0)
            {
                bytesConsumed_.fetch_add(discardBytes, std::memory_order_acq_rel);
                consumedSignal_.notify_all();
                pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(discardBytes));
                continue;
            }

            const int frames = static_cast<int>(completeBytes / frameBytes);
            bool accepted = false;
            if (pushRawFrames_)
            {
                accepted = pushRawFrames_(
                    reinterpret_cast<const uint8_t*>(pending.data()),
                    frames);
            }
            else
            {
                std::vector<float> samples(completeBytes / sizeof(float));
                std::memcpy(samples.data(), pending.data(), completeBytes);
                accepted = pushFrames_(samples.data(), frames);
            }
            if (! accepted && running_.load(std::memory_order_acquire))
            {
                const auto latestDiscardThrough = discardThroughBytes_.load(std::memory_order_acquire);
                if (latestDiscardThrough > consumedBefore)
                {
                    // requestStop() may release a push that was blocked on a
                    // full FIFO. Consume the now-aborted bytes immediately;
                    // leaving them in pending would make the discard barrier
                    // wait for an unrelated future pipe write before it could
                    // make progress.
                    const auto abortDiscardBytes = std::min<uint64_t>(
                        static_cast<uint64_t>(completeBytes),
                        latestDiscardThrough - consumedBefore);
                    bytesConsumed_.fetch_add(abortDiscardBytes, std::memory_order_acq_rel);
                    consumedSignal_.notify_all();
                    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(abortDiscardBytes));
                    continue;
                }
                onError_("audio input stopped before all frames were accepted");
                break;
            }
            bytesConsumed_.fetch_add(static_cast<uint64_t>(completeBytes), std::memory_order_acq_rel);
            consumedSignal_.notify_all();
            pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(completeBytes));
            continue;
        }

        if (bytesRead == 0)
        {
            if (running_.load(std::memory_order_acquire) && ! pending.empty())
                onError_("audio input pipe closed with a partial frame");
            break;
        }

        if (errno == EAGAIN || errno == EWOULDBLOCK)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            continue;
        }

        if (running_.load(std::memory_order_acquire))
            onError_("audio input pipe read failed: errno=" + std::to_string(errno));
        break;
    }

    running_.store(false, std::memory_order_release);
    consumedSignal_.notify_all();
}
