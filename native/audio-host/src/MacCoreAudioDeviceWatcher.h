#pragma once

#if defined(__APPLE__)

#include <CoreAudio/CoreAudio.h>

#include <atomic>
#include <cstdint>
#include <string>

class MacCoreAudioDeviceWatcher final
{
public:
    using Callback = void (*) (
        void* userData,
        const char* event,
        const std::string& deviceUid,
        const char* reason,
        std::uint32_t code,
        bool currentDevice,
        bool followsDefaultDevice);

    MacCoreAudioDeviceWatcher() = default;
    ~MacCoreAudioDeviceWatcher();

    MacCoreAudioDeviceWatcher(const MacCoreAudioDeviceWatcher&) = delete;
    MacCoreAudioDeviceWatcher& operator=(const MacCoreAudioDeviceWatcher&) = delete;

    bool start(
        const char* deviceUid,
        bool followsDefaultDevice,
        Callback callback,
        void* userData,
        std::string& error);
    void stop() noexcept;

private:
    static OSStatus propertyListener(
        AudioObjectID objectId,
        UInt32 addressCount,
        const AudioObjectPropertyAddress addresses[],
        void* clientData);
    void handlePropertyChange(
        AudioObjectID objectId,
        UInt32 addressCount,
        const AudioObjectPropertyAddress addresses[]);
    void publish(
        const char* event,
        AudioDeviceID deviceId,
        const char* reason,
        std::uint32_t code,
        bool currentDevice) const;

    std::atomic<AudioDeviceID> deviceObjectId { kAudioObjectUnknown };
    std::atomic<bool> followsDefault { false };
    bool defaultListenerInstalled = false;
    bool devicesListenerInstalled = false;
    bool aliveListenerInstalled = false;
    bool nominalSampleRateListenerInstalled = false;
    std::atomic<Callback> callback { nullptr };
    std::atomic<void*> callbackUserData { nullptr };
    std::atomic<bool> running { false };
};

#endif

