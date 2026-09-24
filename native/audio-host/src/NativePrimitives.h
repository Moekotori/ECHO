#pragma once

#include "../../audio-engine/buffer.h"
#include "../../audio-engine/third_party/nlohmann_json.hpp"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace echo_audio_host {

using Json = nlohmann::json;
using FloatPlanarBuffer = echo::FloatAudioBuffer;

struct FifoBlock
{
    int start1 = 0;
    int size1 = 0;
    int start2 = 0;
    int size2 = 0;
};

class NativeFifo final
{
public:
    explicit NativeFifo(int capacityToUse)
        : capacity(std::max(0, capacityToUse))
    {
    }

    void prepareToWrite(int requested, int& start1, int& size1, int& start2, int& size2) const
    {
        const auto block = prepareToWrite(requested);
        start1 = block.start1;
        size1 = block.size1;
        start2 = block.start2;
        size2 = block.size2;
    }

    FifoBlock prepareToWrite(int requested) const
    {
        FifoBlock block;
        const uint64_t write = writeSequence.load(std::memory_order_relaxed);
        const uint64_t read = readSequence.load(std::memory_order_acquire);
        const int ready = static_cast<int>(std::min<uint64_t>(
            static_cast<uint64_t>(capacity),
            write >= read ? write - read : 0));
        const int writable = std::min(std::max(0, requested), capacity - ready);
        if (writable <= 0 || capacity <= 0)
            return block;

        block.start1 = static_cast<int>(write % static_cast<uint64_t>(capacity));
        block.size1 = std::min(writable, capacity - block.start1);
        block.start2 = 0;
        block.size2 = writable - block.size1;
        return block;
    }

    void finishedWrite(int written)
    {
        if (written > 0)
            writeSequence.fetch_add(static_cast<uint64_t>(written), std::memory_order_release);
    }

    void prepareToRead(int requested, int& start1, int& size1, int& start2, int& size2) const
    {
        const auto block = prepareToRead(requested);
        start1 = block.start1;
        size1 = block.size1;
        start2 = block.start2;
        size2 = block.size2;
    }

    FifoBlock prepareToRead(int requested) const
    {
        FifoBlock block;
        const uint64_t read = readSequence.load(std::memory_order_relaxed);
        const uint64_t write = writeSequence.load(std::memory_order_acquire);
        const int ready = static_cast<int>(std::min<uint64_t>(
            static_cast<uint64_t>(capacity),
            write >= read ? write - read : 0));
        const int readable = std::min(std::max(0, requested), ready);
        if (readable <= 0 || capacity <= 0)
            return block;

        block.start1 = static_cast<int>(read % static_cast<uint64_t>(capacity));
        block.size1 = std::min(readable, capacity - block.start1);
        block.start2 = 0;
        block.size2 = readable - block.size1;
        return block;
    }

    void finishedRead(int read)
    {
        if (read > 0)
            readSequence.fetch_add(static_cast<uint64_t>(read), std::memory_order_release);
    }

    void reset()
    {
        readSequence.store(0, std::memory_order_release);
        writeSequence.store(0, std::memory_order_release);
    }

    int getNumReady() const
    {
        const uint64_t read = readSequence.load(std::memory_order_acquire);
        const uint64_t write = writeSequence.load(std::memory_order_acquire);
        return static_cast<int>(std::min<uint64_t>(
            static_cast<uint64_t>(capacity),
            write >= read ? write - read : 0));
    }
    int getFreeSpace() const { return capacity - getNumReady(); }
    int getTotalSize() const { return capacity; }

private:
    int capacity = 0;
    std::atomic<uint64_t> readSequence { 0 };
    std::atomic<uint64_t> writeSequence { 0 };
};

struct FloatInterleavedRenderTarget
{
    float* samples = nullptr;
    uint32_t frames = 0;
    uint32_t channels = 0;
};

struct U32InterleavedRenderTarget
{
    uint32_t* samples = nullptr;
    uint32_t frames = 0;
    uint32_t channels = 0;
};

struct U8InterleavedRenderTarget
{
    uint8_t* samples = nullptr;
    uint32_t frames = 0;
    uint32_t channels = 0;
};

template <typename Target>
class SourceRenderer
{
public:
    virtual ~SourceRenderer() = default;
    virtual uint32_t render(Target target) = 0;
};

inline Json parseJson(std::string_view text)
{
    return Json::parse(text.begin(), text.end());
}

inline std::string jsonStringValue(const Json& object, const char* key, std::string_view fallback = {})
{
    if (! object.is_object())
        return std::string(fallback);

    const auto iterator = object.find(key);
    return iterator != object.end() && iterator->is_string() ? iterator->get<std::string>() : std::string(fallback);
}

inline double jsonDoubleValue(const Json& object, const char* key, double fallback)
{
    if (! object.is_object())
        return fallback;

    const auto iterator = object.find(key);
    return iterator != object.end() && iterator->is_number() ? iterator->get<double>() : fallback;
}

}
