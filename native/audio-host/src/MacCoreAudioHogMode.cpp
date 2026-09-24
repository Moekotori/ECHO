#include "MacCoreAudioHogMode.h"

#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <chrono>
#include <thread>
#include <unistd.h>

namespace
{
AudioDeviceID getDefaultOutputDevice()
{
    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    const AudioObjectPropertyAddress address {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    return AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, &device) == noErr
        ? device
        : kAudioObjectUnknown;
}

AudioDeviceID getOutputDeviceForUid(const char* uid)
{
    if (uid == nullptr || uid[0] == '\0')
        return getDefaultOutputDevice();

    CFStringRef uidString = CFStringCreateWithCString(kCFAllocatorDefault, uid, kCFStringEncodingUTF8);
    if (uidString == nullptr)
        return kAudioObjectUnknown;

    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    const AudioObjectPropertyAddress address {
        kAudioHardwarePropertyTranslateUIDToDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    const OSStatus status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &address,
        sizeof(uidString),
        &uidString,
        &size,
        &device);
    CFRelease(uidString);
    return status == noErr ? device : kAudioObjectUnknown;
}

AudioObjectPropertyAddress getHogModeAddress()
{
    return {
        kAudioDevicePropertyHogMode,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
}
}

MacCoreAudioHogMode::~MacCoreAudioHogMode()
{
    release();
}

bool MacCoreAudioHogMode::acquire(const char* deviceUid, std::string& error)
{
    release();
    const AudioDeviceID device = getOutputDeviceForUid(deviceUid);
    if (device == kAudioObjectUnknown)
    {
        error = "coreaudio_exclusive_device_not_found";
        return false;
    }

    const auto address = getHogModeAddress();
    Boolean settable = false;
    if (! AudioObjectHasProperty(device, &address)
        || AudioObjectIsPropertySettable(device, &address, &settable) != noErr
        || ! settable)
    {
        error = "coreaudio_hog_mode_not_supported";
        return false;
    }

    pid_t owner = -1;
    UInt32 size = sizeof(owner);
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &owner) != noErr)
    {
        error = "coreaudio_hog_mode_owner_unavailable";
        return false;
    }

    const pid_t processId = getpid();
    if (owner != -1 && owner != processId)
    {
        error = "coreaudio_hog_mode_busy:pid=" + std::to_string(owner);
        return false;
    }

    if (owner != processId
        && AudioObjectSetPropertyData(device, &address, 0, nullptr, sizeof(owner), &owner) != noErr)
    {
        error = "coreaudio_hog_mode_acquire_failed";
        return false;
    }

    for (int attempt = 0; owner != processId && attempt < 25; ++attempt)
    {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        size = sizeof(owner);
        if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &owner) != noErr)
            break;
    }
    if (owner != processId)
    {
        error = "coreaudio_hog_mode_not_acquired";
        return false;
    }

    deviceObjectId = static_cast<std::uint32_t>(device);
    acquired = true;
    return true;
}

void MacCoreAudioHogMode::release() noexcept
{
    if (! acquired || deviceObjectId == 0)
        return;

    const auto address = getHogModeAddress();
    pid_t owner = -1;
    UInt32 size = sizeof(owner);
    const auto device = static_cast<AudioDeviceID>(deviceObjectId);
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &owner) == noErr
        && owner == getpid())
    {
        AudioObjectSetPropertyData(device, &address, 0, nullptr, sizeof(owner), &owner);
    }

    acquired = false;
    deviceObjectId = 0;
}

