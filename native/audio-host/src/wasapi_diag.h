#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <atomic>
#include <stdint.h>
#include <stdio.h>
#include <type_traits>

enum class DiagTag : uint32_t
{
    GetCurrentPaddingFailed = 0,
    GetBufferFailed,
    ReleaseBufferFailed,
    ScratchTooSmall,
    RebuildScheduled,
    RebuildSucceeded,
    RebuildFailed
};

struct DiagRecord
{
    DiagTag tag;
    HRESULT hr;
    uint32_t frameCount;
    ULONGLONG tickMs;
};

static_assert(std::is_trivially_copyable<DiagRecord>::value, "DiagRecord must be trivially copyable");

namespace wasapi_diag_detail
{
static constexpr uint32_t kDiagCapacity = 64;
static DiagRecord records[kDiagCapacity] {};
static std::atomic<uint32_t> head { 0 };
static std::atomic<uint32_t> tail { 0 };

static inline const char* diag_tag_message(DiagTag tag)
{
    switch (tag)
    {
    case DiagTag::GetCurrentPaddingFailed:
        return "WASAPI shared GetCurrentPadding failed";
    case DiagTag::GetBufferFailed:
        return "WASAPI shared GetBuffer failed";
    case DiagTag::ReleaseBufferFailed:
        return "WASAPI shared ReleaseBuffer failed";
    case DiagTag::ScratchTooSmall:
        return "WASAPI shared scratch buffer too small";
    case DiagTag::RebuildScheduled:
        return "WASAPI shared rebuild scheduled";
    case DiagTag::RebuildSucceeded:
        return "WASAPI shared rebuild succeeded";
    case DiagTag::RebuildFailed:
        return "WASAPI shared rebuild failed";
    default:
        return "WASAPI shared diagnostic";
    }
}
} // namespace wasapi_diag_detail

static inline void diag_push(DiagTag tag, HRESULT hr, uint32_t frameCount)
{
    const uint32_t currentTail = wasapi_diag_detail::tail.load(std::memory_order_relaxed);
    uint32_t currentHead = wasapi_diag_detail::head.load(std::memory_order_acquire);

    if (currentTail - currentHead >= wasapi_diag_detail::kDiagCapacity)
    {
        wasapi_diag_detail::head.store(currentHead + 1U, std::memory_order_release);
    }

    wasapi_diag_detail::records[currentTail % wasapi_diag_detail::kDiagCapacity] = DiagRecord {
        tag,
        hr,
        frameCount,
        GetTickCount64()
    };
    wasapi_diag_detail::tail.store(currentTail + 1U, std::memory_order_release);
}

static inline bool diag_pop(DiagRecord& out)
{
    const uint32_t currentHead = wasapi_diag_detail::head.load(std::memory_order_relaxed);
    const uint32_t currentTail = wasapi_diag_detail::tail.load(std::memory_order_acquire);
    if (currentHead == currentTail)
        return false;

    out = wasapi_diag_detail::records[currentHead % wasapi_diag_detail::kDiagCapacity];
    wasapi_diag_detail::head.store(currentHead + 1U, std::memory_order_release);
    return true;
}

static inline void diag_drain_to_stderr()
{
    DiagRecord record {};
    while (diag_pop(record))
    {
        fprintf(
            stderr,
            "[echo-audio-host] %s hr=0x%08lx frames=%u tickMs=%llu\n",
            wasapi_diag_detail::diag_tag_message(record.tag),
            static_cast<unsigned long>(record.hr),
            static_cast<unsigned int>(record.frameCount),
            static_cast<unsigned long long>(record.tickMs));
    }
}
