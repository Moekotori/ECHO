#pragma once

#ifdef _WIN32

#include <stddef.h>
#include <stdint.h>
#include <wchar.h>

typedef unsigned int (*wasapi_render_callback)(
    void* userData,
    float* output,
    unsigned int frameCount,
    unsigned int channels);

typedef unsigned int (*wasapi_dop_render_callback)(
    void* userData,
    uint32_t* output,
    unsigned int frameCount,
    unsigned int channels);

typedef struct wasapi_host_notification {
    const char* event;
    const wchar_t* deviceId;
    const char* reason;
    unsigned int code;
    int currentDevice;
    int followsDefaultDevice;
} wasapi_host_notification;

typedef void (*wasapi_host_notification_callback)(
    void* userData,
    const wasapi_host_notification* notification);

typedef struct wasapi_exclusive_device_info {
    wchar_t id[512];
    char name[512];
    uint32_t highestSampleRate;
    uint32_t sharedSampleRate;
    int isDefault;
} wasapi_exclusive_device_info;

typedef struct wasapi_exclusive_ready_info {
    uint32_t sampleRate;
    uint32_t hardwareSampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    char format[32];
} wasapi_exclusive_ready_info;

typedef struct wasapi_exclusive_runtime wasapi_exclusive_runtime;

int wasapi_exclusive_list_devices(
    wasapi_exclusive_device_info** outDevices,
    uint32_t* outCount);

void wasapi_exclusive_free_devices(wasapi_exclusive_device_info* devices);

int wasapi_exclusive_start(
    const char* targetDeviceName,
    int targetDeviceIndex,
    uint32_t sampleRate,
    uint32_t channels,
    uint32_t requestedBufferFrames,
    wasapi_render_callback callback,
    void* userData,
    wasapi_host_notification_callback notificationCallback,
    void* notificationUserData,
    wasapi_exclusive_runtime** outRuntime,
    wasapi_exclusive_ready_info* outInfo,
    char* error,
    size_t errorLen);

int wasapi_exclusive_start_dop(
    const char* targetDeviceName,
    int targetDeviceIndex,
    uint32_t sampleRate,
    uint32_t channels,
    uint32_t requestedBufferFrames,
    wasapi_dop_render_callback callback,
    void* userData,
    wasapi_host_notification_callback notificationCallback,
    void* notificationUserData,
    wasapi_exclusive_runtime** outRuntime,
    wasapi_exclusive_ready_info* outInfo,
    char* error,
    size_t errorLen);

void wasapi_exclusive_stop(wasapi_exclusive_runtime* runtime);

#endif
