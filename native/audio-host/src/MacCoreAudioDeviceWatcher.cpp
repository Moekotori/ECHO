#include "MacCoreAudioDeviceInfo.h"
#include "MacCoreAudioDeviceWatcher.h"

#if defined(__APPLE__)

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

AudioObjectPropertyAddress devicesAddress()
{
    return {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
}

AudioObjectPropertyAddress deviceAliveAddress()
{
    return {
        kAudioDevicePropertyDeviceIsAlive,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
}

AudioObjectPropertyAddress nominalSampleRateAddress()
{
    return {
        kAudioDevicePropertyNominalSampleRate,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
}

bool isDeviceAlive(AudioDeviceID device)
{
    if (device == kAudioObjectUnknown)
        return false;

    UInt32 alive = 0;
    UInt32 size = sizeof(alive);
    const auto address = deviceAliveAddress();
    return AudioObjectHasProperty(device, &address)
        && AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &alive) == noErr
        && alive != 0;
}
}

MacCoreAudioDeviceWatcher::~MacCoreAudioDeviceWatcher()
{
    stop();
}

bool MacCoreAudioDeviceWatcher::start(
    const char* deviceUid,
    bool followsDefaultDevice,
    Callback callbackToUse,
    void* userData,
    std::string& error)
{
    stop();
    const auto resolvedDevice = getMacCoreAudioOutputDeviceForUid(deviceUid);
    deviceObjectId.store(resolvedDevice, std::memory_order_release);
    if (resolvedDevice == kAudioObjectUnknown)
    {
        error = "coreaudio_device_watcher_device_not_found";
        return false;
    }

    followsDefault.store(followsDefaultDevice, std::memory_order_release);
    callback.store(callbackToUse, std::memory_order_release);
    callbackUserData.store(userData, std::memory_order_release);
    running.store(true, std::memory_order_release);

    auto address = defaultOutputAddress();
    if (AudioObjectAddPropertyListener(
            kAudioObjectSystemObject,
            &address,
            propertyListener,
            this) != noErr)
    {
        error = "coreaudio_default_output_listener_failed";
        stop();
        return false;
    }
    defaultListenerInstalled = true;

    address = devicesAddress();
    if (AudioObjectAddPropertyListener(
            kAudioObjectSystemObject,
            &address,
            propertyListener,
            this) != noErr)
    {
        error = "coreaudio_devices_listener_failed";
        stop();
        return false;
    }
    devicesListenerInstalled = true;

    address = deviceAliveAddress();
    if (AudioObjectHasProperty(resolvedDevice, &address))
    {
        if (AudioObjectAddPropertyListener(
                resolvedDevice,
                &address,
                propertyListener,
                this) != noErr)
        {
            error = "coreaudio_device_alive_listener_failed";
            stop();
            return false;
        }
        aliveListenerInstalled = true;
    }

    address = nominalSampleRateAddress();
    if (AudioObjectHasProperty(resolvedDevice, &address))
    {
        if (AudioObjectAddPropertyListener(
                resolvedDevice,
                &address,
                propertyListener,
                this) != noErr)
        {
            error = "coreaudio_nominal_sample_rate_listener_failed";
            stop();
            return false;
        }
        nominalSampleRateListenerInstalled = true;
    }

    return true;
}

void MacCoreAudioDeviceWatcher::stop() noexcept
{
    running.store(false, std::memory_order_release);

    const auto watchedDevice = deviceObjectId.load(std::memory_order_acquire);
    if (nominalSampleRateListenerInstalled && watchedDevice != kAudioObjectUnknown)
    {
        const auto address = nominalSampleRateAddress();
        AudioObjectRemovePropertyListener(watchedDevice, &address, propertyListener, this);
    }
    if (aliveListenerInstalled && watchedDevice != kAudioObjectUnknown)
    {
        const auto address = deviceAliveAddress();
        AudioObjectRemovePropertyListener(watchedDevice, &address, propertyListener, this);
    }
    if (devicesListenerInstalled)
    {
        const auto address = devicesAddress();
        AudioObjectRemovePropertyListener(kAudioObjectSystemObject, &address, propertyListener, this);
    }
    if (defaultListenerInstalled)
    {
        const auto address = defaultOutputAddress();
        AudioObjectRemovePropertyListener(kAudioObjectSystemObject, &address, propertyListener, this);
    }

    nominalSampleRateListenerInstalled = false;
    aliveListenerInstalled = false;
    devicesListenerInstalled = false;
    defaultListenerInstalled = false;
    deviceObjectId.store(kAudioObjectUnknown, std::memory_order_release);
    followsDefault.store(false, std::memory_order_release);
    callback.store(nullptr, std::memory_order_release);
    callbackUserData.store(nullptr, std::memory_order_release);
}

OSStatus MacCoreAudioDeviceWatcher::propertyListener(
    AudioObjectID objectId,
    UInt32 addressCount,
    const AudioObjectPropertyAddress addresses[],
    void* clientData)
{
    auto* watcher = static_cast<MacCoreAudioDeviceWatcher*>(clientData);
    if (watcher != nullptr)
        watcher->handlePropertyChange(objectId, addressCount, addresses);
    return noErr;
}

void MacCoreAudioDeviceWatcher::handlePropertyChange(
    AudioObjectID objectId,
    UInt32 addressCount,
    const AudioObjectPropertyAddress addresses[])
{
    if (! running.load(std::memory_order_acquire) || addresses == nullptr)
        return;

    const auto watchedDevice = deviceObjectId.load(std::memory_order_acquire);
    const bool followsDefaultDevice = followsDefault.load(std::memory_order_acquire);

    for (UInt32 index = 0; index < addressCount; ++index)
    {
        const auto selector = addresses[index].mSelector;
        if (objectId == kAudioObjectSystemObject
            && selector == kAudioHardwarePropertyDefaultOutputDevice)
        {
            const auto newDefault = getMacCoreAudioDefaultOutputDevice();
            publish(
                "default_device_changed",
                newDefault,
                "default_output_changed",
                0,
                followsDefaultDevice || newDefault == watchedDevice);
            continue;
        }

        if (objectId == kAudioObjectSystemObject
            && selector == kAudioHardwarePropertyDevices)
        {
            if (! isDeviceAlive(watchedDevice))
                publish("device_removed", watchedDevice, "removed", 0, true);
            continue;
        }

        if (objectId == watchedDevice && selector == kAudioDevicePropertyDeviceIsAlive)
        {
            const bool alive = isDeviceAlive(watchedDevice);
            publish(
                "device_state_changed",
                watchedDevice,
                alive ? "active" : "not_present",
                alive ? 1u : 0u,
                true);
            continue;
        }

        if (objectId == watchedDevice && selector == kAudioDevicePropertyNominalSampleRate)
        {
            publish(
                "device_sample_rate_changed",
                watchedDevice,
                "nominal_sample_rate_changed",
                static_cast<std::uint32_t>(getMacCoreAudioNominalSampleRate(watchedDevice)),
                true);
        }
    }
}

void MacCoreAudioDeviceWatcher::publish(
    const char* event,
    AudioDeviceID deviceId,
    const char* reason,
    std::uint32_t code,
    bool currentDevice) const
{
    const auto callbackToUse = callback.load(std::memory_order_acquire);
    if (! running.load(std::memory_order_acquire) || callbackToUse == nullptr)
        return;

    callbackToUse(
        callbackUserData.load(std::memory_order_acquire),
        event,
        getMacCoreAudioDeviceUid(deviceId),
        reason,
        code,
        currentDevice,
        followsDefault.load(std::memory_order_acquire));
}

#endif

