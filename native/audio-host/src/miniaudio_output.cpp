#include "miniaudio_output.h"

#include <cstdio>

#if defined(ECHO_ENABLE_MINIAUDIO) && ECHO_ENABLE_MINIAUDIO

#include <miniaudio.h>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <memory>
#include <string>

struct miniaudio_runtime {
    ma_context context {};
    ma_device device {};
    miniaudio_render_callback callback = nullptr;
    void* callbackUserData = nullptr;
    bool contextInitialized = false;
    bool deviceInitialized = false;
    bool deviceStarted = false;
};

namespace
{
void setError(char* error, size_t errorLen, const std::string& message)
{
    if (error == nullptr || errorLen == 0)
        return;

    std::snprintf(error, errorLen, "%s", message.c_str());
}

std::string normalizeDeviceName(const char* value)
{
    std::string output;
    if (value == nullptr)
        return output;

    for (const unsigned char ch : std::string(value))
    {
        if (std::isspace(ch))
            continue;
        output.push_back(static_cast<char>(std::tolower(ch)));
    }

    return output;
}

const ma_device_info* selectPlaybackDevice(
    ma_device_info* devices,
    ma_uint32 count,
    const char* requestedName,
    int requestedIndex)
{
    if (devices == nullptr || count == 0)
        return nullptr;

    const auto normalizedRequestedName = normalizeDeviceName(requestedName);
    if (! normalizedRequestedName.empty())
    {
        for (ma_uint32 i = 0; i < count; ++i)
        {
            if (normalizeDeviceName(devices[i].name) == normalizedRequestedName)
                return &devices[i];
        }

        for (ma_uint32 i = 0; i < count; ++i)
        {
            const auto normalizedCandidate = normalizeDeviceName(devices[i].name);
            if (
                normalizedCandidate.find(normalizedRequestedName) != std::string::npos
                || normalizedRequestedName.find(normalizedCandidate) != std::string::npos)
            {
                return &devices[i];
            }
        }
    }

    if (requestedIndex >= 0 && static_cast<ma_uint32>(requestedIndex) < count)
        return &devices[requestedIndex];

    return nullptr;
}

void miniaudioDataCallback(ma_device* device, void* output, const void* input, ma_uint32 frameCount)
{
    (void)input;

    if (device == nullptr || output == nullptr || frameCount == 0)
        return;

    auto* runtime = static_cast<miniaudio_runtime*>(device->pUserData);
    if (runtime == nullptr || runtime->callback == nullptr)
        return;

    runtime->callback(
        runtime->callbackUserData,
        static_cast<float*>(output),
        static_cast<uint32_t>(frameCount),
        static_cast<uint32_t>(std::max<ma_uint32>(1, device->playback.channels)));
}

void copyText(char* target, size_t targetLen, const char* value)
{
    if (target == nullptr || targetLen == 0)
        return;

    std::snprintf(target, targetLen, "%s", value != nullptr ? value : "");
}

uint32_t pickSampleRate(const ma_device_info& info)
{
    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
    {
        if (info.nativeDataFormats[i].sampleRate == 48000)
            return 48000;
    }

    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
    {
        if (info.nativeDataFormats[i].sampleRate > 0)
            return info.nativeDataFormats[i].sampleRate;
    }

    return 48000;
}

uint32_t pickChannels(const ma_device_info& info)
{
    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
    {
        if (info.nativeDataFormats[i].channels > 0)
            return info.nativeDataFormats[i].channels;
    }

    return 0;
}
} // namespace

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
    size_t errorLen)
{
    if (outRuntime == nullptr)
    {
        setError(error, errorLen, "miniaudio output start failed: missing runtime output");
        return -1;
    }

    *outRuntime = nullptr;

    if (callback == nullptr)
    {
        setError(error, errorLen, "miniaudio output start failed: missing render callback");
        return -1;
    }

    auto runtime = std::make_unique<miniaudio_runtime>();
    runtime->callback = callback;
    runtime->callbackUserData = callbackUserData;

    const ma_backend backends[] = { ma_backend_wasapi };
    ma_result result = ma_context_init(backends, 1, nullptr, &runtime->context);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI context init failed: ") + ma_result_description(result));
        return -1;
    }
    runtime->contextInitialized = true;

    ma_device_info* playbackDevices = nullptr;
    ma_uint32 playbackDeviceCount = 0;
    result = ma_context_get_devices(&runtime->context, &playbackDevices, &playbackDeviceCount, nullptr, nullptr);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI device enumeration failed: ") + ma_result_description(result));
        miniaudio_output_stop(runtime.release());
        return -1;
    }

    ma_device_id selectedDeviceId {};
    const ma_device_id* selectedDeviceIdPtr = nullptr;
    const ma_device_info* selectedDevice = selectPlaybackDevice(playbackDevices, playbackDeviceCount, deviceName, deviceIndex);
    if (selectedDevice != nullptr)
    {
        selectedDeviceId = selectedDevice->id;
        selectedDeviceIdPtr = &selectedDeviceId;
    }
    else if (deviceName != nullptr && deviceName[0] != '\0')
    {
        setError(error, errorLen, std::string("miniaudio WASAPI device not found: ") + deviceName);
        miniaudio_output_stop(runtime.release());
        return -1;
    }

    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    config.periodSizeInFrames = bufferSizeFrames > 0 ? bufferSizeFrames : 0;
    config.periods = 2;
    config.performanceProfile = ma_performance_profile_low_latency;
    config.dataCallback = miniaudioDataCallback;
    config.pUserData = runtime.get();
    config.playback.pDeviceID = selectedDeviceIdPtr;
    config.playback.format = ma_format_f32;
    config.playback.channels = channels > 0 ? channels : 2;
    config.playback.shareMode = exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
    config.wasapi.usage = ma_wasapi_usage_pro_audio;
    config.wasapi.noAutoConvertSRC = exclusive ? MA_TRUE : MA_FALSE;
    config.wasapi.noDefaultQualitySRC = exclusive ? MA_TRUE : MA_FALSE;
    config.wasapi.noHardwareOffloading = MA_TRUE;

    result = ma_device_init(&runtime->context, &config, &runtime->device);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI device init failed: ") + ma_result_description(result));
        miniaudio_output_stop(runtime.release());
        return -1;
    }
    runtime->deviceInitialized = true;

    result = ma_device_start(&runtime->device);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI device start failed: ") + ma_result_description(result));
        miniaudio_output_stop(runtime.release());
        return -1;
    }
    runtime->deviceStarted = true;

    if (outInfo != nullptr)
    {
        std::memset(outInfo, 0, sizeof(*outInfo));
        outInfo->sampleRate = runtime->device.sampleRate;
        outInfo->channels = runtime->device.playback.channels;
        outInfo->bufferFrameCount = runtime->device.playback.internalPeriodSizeInFrames;
        outInfo->requestedBufferFrameCount = bufferSizeFrames;
        outInfo->exclusive = exclusive ? 1 : 0;
        copyText(outInfo->format, sizeof(outInfo->format), "f32");
        copyText(outInfo->backend, sizeof(outInfo->backend), "miniaudio-wasapi");
        copyText(outInfo->deviceName, sizeof(outInfo->deviceName), runtime->device.playback.name);
    }

    *outRuntime = runtime.release();
    return 0;
}

void miniaudio_output_stop(miniaudio_runtime* runtime)
{
    if (runtime == nullptr)
        return;

    if (runtime->deviceStarted)
    {
        ma_device_stop(&runtime->device);
        runtime->deviceStarted = false;
    }

    if (runtime->deviceInitialized)
    {
        ma_device_uninit(&runtime->device);
        runtime->deviceInitialized = false;
    }

    if (runtime->contextInitialized)
    {
        ma_context_uninit(&runtime->context);
        runtime->contextInitialized = false;
    }

    delete runtime;
}

int miniaudio_output_list_devices(
    miniaudio_device_info* devices,
    uint32_t capacity,
    uint32_t* outCount,
    char* error,
    size_t errorLen)
{
    if (outCount == nullptr)
    {
        setError(error, errorLen, "miniaudio device list failed: missing count output");
        return -1;
    }

    *outCount = 0;
    ma_context context {};
    const ma_backend backends[] = { ma_backend_wasapi };
    ma_result result = ma_context_init(backends, 1, nullptr, &context);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI context init failed: ") + ma_result_description(result));
        return -1;
    }

    ma_device_info* playbackDevices = nullptr;
    ma_uint32 playbackDeviceCount = 0;
    result = ma_context_get_devices(&context, &playbackDevices, &playbackDeviceCount, nullptr, nullptr);
    if (result != MA_SUCCESS)
    {
        setError(error, errorLen, std::string("miniaudio WASAPI device enumeration failed: ") + ma_result_description(result));
        ma_context_uninit(&context);
        return -1;
    }

    *outCount = playbackDeviceCount;
    const ma_uint32 copyCount = std::min<ma_uint32>(playbackDeviceCount, capacity);
    for (ma_uint32 i = 0; i < copyCount; ++i)
    {
        if (devices == nullptr)
            break;

        devices[i].index = static_cast<int>(i);
        devices[i].sampleRate = pickSampleRate(playbackDevices[i]);
        devices[i].channels = pickChannels(playbackDevices[i]);
        devices[i].isDefault = playbackDevices[i].isDefault ? 1 : 0;
        copyText(devices[i].id, sizeof(devices[i].id), (std::string("shared:") + std::to_string(i)).c_str());
        copyText(devices[i].name, sizeof(devices[i].name), playbackDevices[i].name);
    }

    ma_context_uninit(&context);
    return 0;
}

#else

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
    size_t errorLen)
{
    (void)deviceName;
    (void)deviceIndex;
    (void)sampleRate;
    (void)channels;
    (void)bufferSizeFrames;
    (void)exclusive;
    (void)callback;
    (void)callbackUserData;
    (void)outInfo;

    if (outRuntime != nullptr)
        *outRuntime = nullptr;

    if (error != nullptr && errorLen > 0)
        std::snprintf(error, errorLen, "%s", "miniaudio output is disabled at build time");

    return -1;
}

void miniaudio_output_stop(miniaudio_runtime* runtime)
{
    (void)runtime;
}

int miniaudio_output_list_devices(
    miniaudio_device_info* devices,
    uint32_t capacity,
    uint32_t* outCount,
    char* error,
    size_t errorLen)
{
    (void)devices;
    (void)capacity;

    if (outCount != nullptr)
        *outCount = 0;

    if (error != nullptr && errorLen > 0)
        std::snprintf(error, errorLen, "%s", "miniaudio output is disabled at build time");

    return -1;
}

#endif
