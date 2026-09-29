#pragma once

#include <cstdint>
#include <string>

class MacCoreAudioHogMode final
{
public:
    MacCoreAudioHogMode() = default;
    ~MacCoreAudioHogMode();

    MacCoreAudioHogMode(const MacCoreAudioHogMode&) = delete;
    MacCoreAudioHogMode& operator=(const MacCoreAudioHogMode&) = delete;

    bool acquire(const char* deviceUid, std::string& error);
    void release() noexcept;

private:
    std::uint32_t deviceObjectId = 0;
    bool acquired = false;
};

