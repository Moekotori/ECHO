#include "MacCoreAudioDeviceInfo.h"

#if defined(__APPLE__)

#include <CoreFoundation/CoreFoundation.h>

#include <cmath>
#include <limits>

namespace
{
AudioObjectPropertyAddress defaultOutputAddress()
{
    return {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
}
}

AudioDeviceID getMacCoreAudioDefaultOutputDevice() noexcept
{
    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    const auto address = defaultOutputAddress();
    return AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &address,
        0,
        nullptr,
        &size,
        &device) == noErr
        ? device
        : kAudioObjectUnknown;
}

AudioDeviceID getMacCoreAudioOutputDeviceForUid(const char* uid) noexcept
{
    if (uid == nullptr || uid[0] == '\0')
        return getMacCoreAudioDefaultOutputDevice();

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

std::string getMacCoreAudioDeviceUid(AudioDeviceID device)
{
    if (device == kAudioObjectUnknown)
        return {};

    CFStringRef uid = nullptr;
    UInt32 size = sizeof(uid);
    const AudioObjectPropertyAddress address {
        kAudioDevicePropertyDeviceUID,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &uid) != noErr || uid == nullptr)
        return {};

    char buffer[1024]{};
    const bool converted = CFStringGetCString(uid, buffer, sizeof(buffer), kCFStringEncodingUTF8);
    CFRelease(uid);
    return converted ? std::string(buffer) : std::string();
}

int getMacCoreAudioNominalSampleRate(AudioDeviceID device) noexcept
{
    if (device == kAudioObjectUnknown)
        return 0;

    Float64 nominalSampleRate = 0.0;
    UInt32 size = sizeof(nominalSampleRate);
    const AudioObjectPropertyAddress address {
        kAudioDevicePropertyNominalSampleRate,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    if (! AudioObjectHasProperty(device, &address)
        || AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &nominalSampleRate) != noErr
        || ! std::isfinite(nominalSampleRate)
        || nominalSampleRate <= 0.0
        || nominalSampleRate > static_cast<Float64>(std::numeric_limits<int>::max()))
    {
        return 0;
    }

    return static_cast<int>(std::llround(nominalSampleRate));
}

int getMacCoreAudioNominalSampleRateForUid(const char* uid) noexcept
{
    return getMacCoreAudioNominalSampleRate(getMacCoreAudioOutputDeviceForUid(uid));
}

#endif

