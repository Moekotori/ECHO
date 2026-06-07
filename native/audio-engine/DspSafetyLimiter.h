#pragma once

#include <atomic>

namespace echo
{
inline std::atomic<bool>& dspSafetyLimiterEnabledFlag()
{
    static std::atomic<bool> enabled { true };
    return enabled;
}

inline void setDspSafetyLimiterEnabled(bool enabled)
{
    dspSafetyLimiterEnabledFlag().store(enabled, std::memory_order_release);
}

inline bool isDspSafetyLimiterEnabled()
{
    return dspSafetyLimiterEnabledFlag().load(std::memory_order_acquire);
}
} // namespace echo
