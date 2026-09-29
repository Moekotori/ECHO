#include "CachePcmProducer.h"

#include <algorithm>
#include <exception>
#include <stdexcept>
#include <utility>

namespace {
constexpr int cacheChunkFrames = 4096;
}

CachePcmProducer::CachePcmProducer(Hooks hooks)
    : hooks_(std::move(hooks))
{
}

CachePcmProducer::~CachePcmProducer()
{
    cancel(operationId_);
    join();
}

void CachePcmProducer::start(CachedPcmSource source, uint64_t operationId, uint64_t generation)
{
    cancel(operationId_);
    join();
    operationId_ = operationId;
    generation_ = generation;

    thread_ = std::jthread([this, source = std::move(source), operationId, generation](std::stop_token stopToken) {
        try {
            if (!source.samples || source.channels <= 0)
                throw std::runtime_error("invalid cached PCM source");

            const int64_t totalSamples = static_cast<int64_t>(source.samples->size());
            int64_t offset = std::clamp<int64_t>(source.startSample, 0, totalSamples);
            while (offset < totalSamples && !stopToken.stop_requested()) {
                if (hooks_.operationId() != operationId || hooks_.generation() != generation)
                    return;

                const int64_t remaining = totalSamples - offset;
                const int framesToWrite = static_cast<int>(std::min<int64_t>(cacheChunkFrames, remaining / source.channels));
                if (framesToWrite <= 0)
                    break;
                if (!hooks_.push(source.samples->data() + offset, framesToWrite, generation)) {
                    if (!stopToken.stop_requested() && hooks_.operationId() == operationId && hooks_.generation() == generation)
                        hooks_.reportError(operationId, "cached PCM producer stopped before input completed");
                    return;
                }
                offset += static_cast<int64_t>(framesToWrite) * source.channels;
            }

            if (!stopToken.stop_requested() && offset >= totalSamples
                && hooks_.operationId() == operationId && hooks_.generation() == generation)
                hooks_.markInputEnded();
        } catch (const std::exception& error) {
            if (!stopToken.stop_requested() && hooks_.operationId() == operationId)
                hooks_.reportError(operationId, error.what());
        }
    });
}

void CachePcmProducer::cancel(uint64_t operationId)
{
    if (!thread_.joinable() || operationId_ != operationId)
        return;
    thread_.request_stop();
    if (hooks_.generation() == generation_)
        hooks_.requestStop();
}

void CachePcmProducer::join()
{
    if (thread_.joinable())
        thread_.join();
}
