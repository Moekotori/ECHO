#include "../src/CachePcmProducer.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>

namespace {
using namespace std::chrono_literals;

void require(bool condition, const char* message)
{
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s\n", message);
        std::exit(1);
    }
}

void testStartReturnsWithoutWaitingForFifoDrain()
{
    std::atomic<uint64_t> operation { 1 };
    std::atomic<uint64_t> generation { 7 };
    std::atomic<bool> stop { false };
    std::atomic<int> ended { 0 };
    std::mutex mutex;
    std::condition_variable wake;

    CachePcmProducer producer({
        [&](const float*, int, uint64_t) {
            std::unique_lock lock(mutex);
            wake.wait(lock, [&] { return stop.load(); });
            return false;
        },
        [&] { stop.store(true); wake.notify_all(); },
        [&] { ++ended; },
        [&] { return generation.load(); },
        [&] { return operation.load(); },
        [&](uint64_t, const std::string&) {},
    });
    auto samples = std::make_shared<const std::vector<float>>(48000 * 2, 0.25f);

    const auto started = std::chrono::steady_clock::now();
    producer.start({samples, 2, 0}, 1, 7);
    const auto elapsed = std::chrono::steady_clock::now() - started;
    require(elapsed < 100ms, "start must return before a blocked FIFO push drains");

    operation.store(2);
    producer.cancel(1);
    producer.join();
    require(ended.load() == 0, "cancelled producer must not mark input ended");
}

void testCompletionAndGenerationInvalidation()
{
    std::atomic<uint64_t> operation { 11 };
    std::atomic<uint64_t> generation { 3 };
    std::atomic<int> pushes { 0 };
    std::atomic<int> ended { 0 };
    std::atomic<int> errors { 0 };
    CachePcmProducer producer({
        [&](const float*, int, uint64_t) { ++pushes; return true; },
        [] {},
        [&] { ++ended; },
        [&] { return generation.load(); },
        [&] { return operation.load(); },
        [&](uint64_t, const std::string&) { ++errors; },
    });
    auto samples = std::make_shared<const std::vector<float>>(9000 * 2, 0.5f);
    producer.start({samples, 2, 0}, 11, 3);
    producer.join();
    require(pushes.load() == 3, "producer must push cached PCM in bounded chunks");
    require(ended.load() == 1, "producer must mark input ended only after the final chunk");
    require(errors.load() == 0, "successful production must not report audio.error");

    operation.store(12);
    generation.store(4);
    producer.start({samples, 2, 0}, 12, 3);
    producer.join();
    require(ended.load() == 1, "stale generation must not mark input ended");
}

void testUnexpectedPushFailureReportsErrorNotEof()
{
    std::atomic<int> ended { 0 };
    std::atomic<int> errors { 0 };
    CachePcmProducer producer({
        [](const float*, int, uint64_t) { return false; },
        [] {},
        [&] { ++ended; },
        [] { return uint64_t { 5 }; },
        [] { return uint64_t { 20 }; },
        [&](uint64_t operationId, const std::string&) { if (operationId == 20) ++errors; },
    });
    auto samples = std::make_shared<const std::vector<float>>(8192, 0.0f);
    producer.start({samples, 2, 0}, 20, 5);
    producer.join();
    require(errors.load() == 1, "unexpected producer failure must report audio.error");
    require(ended.load() == 0, "producer failure must not masquerade as natural EOF");
}

void testRepeatOneStyleReuseStaysOnGeneration()
{
    std::atomic<uint64_t> operation { 0 };
    std::atomic<int> ended { 0 };
    CachePcmProducer producer({
        [](const float*, int, uint64_t generation) { return generation == 42; },
        [] {},
        [&] { ++ended; },
        [] { return uint64_t { 42 }; },
        [&] { return operation.load(); },
        [&](uint64_t, const std::string&) { require(false, "repeat producer must not report an error"); },
    });
    auto samples = std::make_shared<const std::vector<float>>(1024 * 2, 0.0f);
    for (uint64_t repeat = 1; repeat <= 100; ++repeat) {
        operation.store(repeat);
        producer.start({samples, 2, 0}, repeat, 42);
        producer.join();
    }
    require(ended.load() == 100, "100 repeat-one productions must complete without generation drift");
}
}

int main()
{
    testStartReturnsWithoutWaitingForFifoDrain();
    testCompletionAndGenerationInvalidation();
    testUnexpectedPushFailureReportsErrorNotEof();
    testRepeatOneStyleReuseStaysOnGeneration();
    std::puts("cache PCM producer tests passed");
    return 0;
}
