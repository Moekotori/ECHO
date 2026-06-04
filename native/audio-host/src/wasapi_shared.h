#pragma once

#ifdef _WIN32

#include "wasapi_exclusive.h"

#include <stddef.h>
#include <stdint.h>
#include <wchar.h>

typedef struct wasapi_shared_device_info {
    wchar_t id[512];
    char name[512];
    uint32_t sharedSampleRate;
    uint32_t channels;
    int isDefault;
} wasapi_shared_device_info;

typedef struct wasapi_shared_ready_info {
    uint32_t sampleRate;
    uint32_t hardwareSampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    char format[32];
} wasapi_shared_ready_info;

typedef struct wasapi_shared_runtime wasapi_shared_runtime;

int wasapi_shared_list_devices(
    wasapi_shared_device_info** outDevices,
    uint32_t* outCount);

void wasapi_shared_free_devices(wasapi_shared_device_info* devices);

int wasapi_shared_start(
    const char* targetDeviceName,
    int targetDeviceIndex,
    uint32_t requestedSampleRate,
    uint32_t sourceChannels,
    uint32_t requestedBufferFrames,
    wasapi_render_callback callback,
    void* userData,
    wasapi_host_notification_callback notificationCallback,
    void* notificationUserData,
    wasapi_shared_runtime** outRuntime,
    wasapi_shared_ready_info* outInfo,
    char* error,
    size_t errorLen);

void wasapi_shared_stop(wasapi_shared_runtime* runtime);

#endif
