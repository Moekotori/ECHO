#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <stop_token>
#include <string>
#include <thread>
#include <vector>

class CachePcmProducer {
public:
    struct CachedPcmSource {
        std::shared_ptr<const std::vector<float>> samples;
        int channels = 0;
        int64_t startSample = 0;
    };

    struct Hooks {
        std::function<bool(const float*, int, uint64_t)> push;
        std::function<void()> requestStop;
        std::function<void()> markInputEnded;
        std::function<uint64_t()> generation;
        std::function<uint64_t()> operationId;
        std::function<void(uint64_t, const std::string&)> reportError;
    };

    explicit CachePcmProducer(Hooks hooks);
    ~CachePcmProducer();

    CachePcmProducer(const CachePcmProducer&) = delete;
    CachePcmProducer& operator=(const CachePcmProducer&) = delete;

    void start(CachedPcmSource source, uint64_t operationId, uint64_t generation);
    void cancel(uint64_t operationId);
    void join();

private:
    Hooks hooks_;
    std::jthread thread_;
    uint64_t operationId_ = 0;
    uint64_t generation_ = 0;
};
