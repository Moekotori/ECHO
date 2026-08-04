#pragma once

#include <cstddef>
#include <cstdint>

typedef unsigned int (*miniaudio_render_callback)(
    void* userData,
    float* output,
    uint32_t frameCount,
    uint32_t outputChannels);

typedef struct miniaudio_ready_info {
    uint32_t sampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    uint32_t requestedBufferFrameCount;
    int exclusive;
    char format[64];
    char backend[64];
    char deviceName[256];
} miniaudio_ready_info;

typedef struct miniaudio_device_info {
    int index;
    uint32_t sampleRate;
    uint32_t channels;
    int isDefault;
    char id[64];
    char name[256];
} miniaudio_device_info;

typedef struct miniaudio_runtime miniaudio_runtime;

int miniaudio_output_start(
    const char* deviceName,
    int deviceIndex,
    uint32_t sampleRate,
    uint32_t channels,
    uint32_t bufferSizeFrames,
    int exclusive,
    miniaudio_render_callback callback,
    void* callbackUserData,
    miniaudio_runtime** outRuntime,
    miniaudio_ready_info* outInfo,
    char* error,
    size_t errorLen);

void miniaudio_output_stop(miniaudio_runtime* runtime);

int miniaudio_output_list_devices(
    miniaudio_device_info* devices,
    uint32_t capacity,
    uint32_t* outCount,
    char* error,
    size_t errorLen);
