#pragma once

#include "../../audio-engine/buffer.h"
#include "../../audio-engine/third_party/nlohmann_json.hpp"

#include <algorithm>
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
        const int writable = std::min(std::max(0, requested), capacity - readyCount);
        if (writable <= 0 || capacity <= 0)
            return block;

        block.start1 = (readPosition + readyCount) % capacity;
        block.size1 = std::min(writable, capacity - block.start1);
        block.start2 = 0;
        block.size2 = writable - block.size1;
        return block;
    }

    void finishedWrite(int written)
    {
        readyCount = std::min(capacity, readyCount + std::max(0, written));
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
        const int readable = std::min(std::max(0, requested), readyCount);
        if (readable <= 0 || capacity <= 0)
            return block;

        block.start1 = readPosition;
        block.size1 = std::min(readable, capacity - block.start1);
        block.start2 = 0;
        block.size2 = readable - block.size1;
        return block;
    }

    void finishedRead(int read)
    {
        const int consumed = std::min(readyCount, std::max(0, read));
        if (capacity > 0)
            readPosition = (readPosition + consumed) % capacity;
        readyCount -= consumed;
    }

    void reset()
    {
        readPosition = 0;
        readyCount = 0;
    }

    int getNumReady() const { return readyCount; }
    int getFreeSpace() const { return capacity - readyCount; }
    int getTotalSize() const { return capacity; }

private:
    int capacity = 0;
    int readPosition = 0;
    int readyCount = 0;
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
