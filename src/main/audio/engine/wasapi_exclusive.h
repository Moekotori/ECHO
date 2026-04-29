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
    wasapi_render_callback callback,
    void* userData,
    wasapi_exclusive_runtime** outRuntime,
    wasapi_exclusive_ready_info* outInfo,
    char* error,
    size_t errorLen);

void wasapi_exclusive_stop(wasapi_exclusive_runtime* runtime);

#endif
