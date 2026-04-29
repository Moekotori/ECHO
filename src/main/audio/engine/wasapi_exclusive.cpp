#ifdef _WIN32

#include "wasapi_exclusive.h"

#include <windows.h>
#include <audioclient.h>
#include <avrt.h>
#include <mmdeviceapi.h>
#include <propidl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <vector>

static const GUID ECHO_SUBTYPE_PCM = {
    0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

static const GUID ECHO_SUBTYPE_IEEE_FLOAT = {
    0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

typedef enum wasapi_sample_format {
    WASAPI_FORMAT_FLOAT32 = 0,
    WASAPI_FORMAT_PCM24_IN_32,
    WASAPI_FORMAT_PCM32,
    WASAPI_FORMAT_PCM16
} wasapi_sample_format;

typedef struct wasapi_format_desc {
    WAVEFORMATEXTENSIBLE wave;
    wasapi_sample_format kind;
    const char* name;
} wasapi_format_desc;

struct wasapi_exclusive_runtime {
    IAudioClient* audioClient;
    IAudioRenderClient* renderClient;
    HANDLE renderEvent;
    HANDLE stopEvent;
    HANDLE thread;
    uint32_t sampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    wasapi_format_desc format;
    wasapi_render_callback callback;
    void* userData;
    volatile LONG renderFailed;
    int comNeedsUninit;
};

typedef struct com_scope {
    HRESULT hr;
    int needsUninit;
} com_scope;

static com_scope com_scope_enter(void) {
    com_scope scope;
    scope.hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    scope.needsUninit = SUCCEEDED(scope.hr);
    if (scope.hr == RPC_E_CHANGED_MODE) {
        scope.hr = S_OK;
        scope.needsUninit = 0;
    }
    return scope;
}

static void com_scope_leave(com_scope* scope) {
    if (scope != NULL && scope->needsUninit) {
        CoUninitialize();
        scope->needsUninit = 0;
    }
}

static void set_error(char* error, size_t errorLen, const char* message, HRESULT hr) {
    if (error == NULL || errorLen == 0) return;
    if (message == NULL) message = "unknown error";
    if (hr != S_OK) {
        snprintf(error, errorLen, "%s (hr=0x%08lx)", message, (unsigned long)hr);
    } else {
        snprintf(error, errorLen, "%s", message);
    }
    error[errorLen - 1] = '\0';
}

static void wide_to_utf8(const wchar_t* wide, char* out, int outLen) {
    if (out == NULL || outLen <= 0) return;
    out[0] = '\0';
    if (wide == NULL || wide[0] == L'\0') return;
    if (WideCharToMultiByte(CP_UTF8, 0, wide, -1, out, outLen, NULL, NULL) <= 0) {
        out[0] = '\0';
    }
}

static wchar_t* utf8_to_wide_alloc(const char* utf8) {
    if (utf8 == NULL || utf8[0] == '\0') return NULL;
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    if (len <= 0) return NULL;
    wchar_t* out = (wchar_t*)calloc((size_t)len, sizeof(wchar_t));
    if (out == NULL) return NULL;
    if (MultiByteToWideChar(CP_UTF8, 0, utf8, -1, out, len) <= 0) {
        free(out);
        return NULL;
    }
    return out;
}

static int wide_contains_icase(const wchar_t* haystack, const wchar_t* needle) {
    if (haystack == NULL || needle == NULL || needle[0] == L'\0') return 0;
    size_t hayLen = wcslen(haystack);
    size_t needleLen = wcslen(needle);
    if (needleLen > hayLen) return 0;
    for (size_t i = 0; i <= hayLen - needleLen; ++i) {
        if (_wcsnicmp(haystack + i, needle, needleLen) == 0) return 1;
    }
    return 0;
}

static DWORD channel_mask_for_channels(uint32_t channels) {
    if (channels == 1) return SPEAKER_FRONT_CENTER;
    if (channels == 2) return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    return 0;
}

static void make_format(uint32_t sampleRate, uint32_t channels, wasapi_sample_format kind, wasapi_format_desc* out) {
    memset(out, 0, sizeof(*out));
    out->kind = kind;

    WAVEFORMATEXTENSIBLE* wave = &out->wave;
    wave->Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    wave->Format.nChannels = (WORD)channels;
    wave->Format.nSamplesPerSec = sampleRate;
    wave->Format.cbSize = (WORD)(sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX));
    wave->dwChannelMask = channel_mask_for_channels(channels);

    switch (kind) {
        case WASAPI_FORMAT_FLOAT32:
            wave->Format.wBitsPerSample = 32;
            wave->Samples.wValidBitsPerSample = 32;
            wave->SubFormat = ECHO_SUBTYPE_IEEE_FLOAT;
            out->name = "float32";
            break;
        case WASAPI_FORMAT_PCM24_IN_32:
            wave->Format.wBitsPerSample = 32;
            wave->Samples.wValidBitsPerSample = 24;
            wave->SubFormat = ECHO_SUBTYPE_PCM;
            out->name = "pcm24in32";
            break;
        case WASAPI_FORMAT_PCM32:
            wave->Format.wBitsPerSample = 32;
            wave->Samples.wValidBitsPerSample = 32;
            wave->SubFormat = ECHO_SUBTYPE_PCM;
            out->name = "pcm32";
            break;
        case WASAPI_FORMAT_PCM16:
        default:
            wave->Format.wBitsPerSample = 16;
            wave->Samples.wValidBitsPerSample = 16;
            wave->SubFormat = ECHO_SUBTYPE_PCM;
            out->name = "pcm16";
            break;
    }

    wave->Format.nBlockAlign = (WORD)((channels * wave->Format.wBitsPerSample) / 8);
    wave->Format.nAvgBytesPerSec = wave->Format.nSamplesPerSec * wave->Format.nBlockAlign;
}

static HRESULT activate_audio_client(IMMDevice* device, IAudioClient** outClient) {
    if (outClient == NULL) return E_POINTER;
    *outClient = NULL;
    if (device == NULL) return E_POINTER;
    return device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void**)outClient);
}

static int choose_exact_format(
    IAudioClient* audioClient,
    uint32_t sampleRate,
    uint32_t channels,
    wasapi_format_desc* outFormat) {
    static const wasapi_sample_format kinds[] = {
        WASAPI_FORMAT_FLOAT32,
        WASAPI_FORMAT_PCM24_IN_32,
        WASAPI_FORMAT_PCM32,
        WASAPI_FORMAT_PCM16
    };

    if (audioClient == NULL || outFormat == NULL) return 0;

    for (size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); ++i) {
        wasapi_format_desc candidate;
        make_format(sampleRate, channels, kinds[i], &candidate);
        HRESULT hr = audioClient->IsFormatSupported(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            (WAVEFORMATEX*)&candidate.wave,
            NULL);
        if (hr == S_OK) {
            *outFormat = candidate;
            return 1;
        }
    }

    return 0;
}

static uint32_t highest_supported_rate(IMMDevice* device, uint32_t channels) {
    static const uint32_t rates[] = {
        768000, 705600, 384000, 352800, 192000, 176400, 96000, 88200, 48000, 44100
    };

    IAudioClient* audioClient = NULL;
    if (FAILED(activate_audio_client(device, &audioClient))) return 0;

    for (size_t i = 0; i < sizeof(rates) / sizeof(rates[0]); ++i) {
        wasapi_format_desc format;
        if (choose_exact_format(audioClient, rates[i], channels, &format)) {
            audioClient->Release();
            return rates[i];
        }
    }

    audioClient->Release();
    return 0;
}

static uint32_t shared_mix_rate(IMMDevice* device) {
    IAudioClient* audioClient = NULL;
    WAVEFORMATEX* mixFormat = NULL;
    uint32_t sampleRate = 0;

    if (FAILED(activate_audio_client(device, &audioClient))) return 0;
    if (SUCCEEDED(audioClient->GetMixFormat(&mixFormat)) && mixFormat != NULL) {
        sampleRate = mixFormat->nSamplesPerSec;
    }

    if (mixFormat != NULL) CoTaskMemFree(mixFormat);
    audioClient->Release();
    return sampleRate;
}

static HRESULT get_device_name(IMMDevice* device, char* utf8Name, size_t utf8NameLen) {
    static const PROPERTYKEY friendlyNameKey = {
        {0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}},
        14
    };
    IPropertyStore* props = NULL;
    PROPVARIANT value;
    HRESULT hr;

    if (utf8Name != NULL && utf8NameLen > 0) utf8Name[0] = '\0';
    if (device == NULL || utf8Name == NULL || utf8NameLen == 0) return E_POINTER;

    PropVariantInit(&value);
    hr = device->OpenPropertyStore(STGM_READ, &props);
    if (FAILED(hr)) goto done;
    hr = props->GetValue(friendlyNameKey, &value);
    if (FAILED(hr)) goto done;
    if (value.vt != VT_LPWSTR || value.pwszVal == NULL) {
        hr = E_FAIL;
        goto done;
    }

    wide_to_utf8(value.pwszVal, utf8Name, (int)utf8NameLen);
    hr = S_OK;

done:
    PropVariantClear(&value);
    if (props != NULL) props->Release();
    return hr;
}

static int enumerate_devices(std::vector<wasapi_exclusive_device_info>& devices, char* error, size_t errorLen) {
    IMMDeviceEnumerator* enumerator = NULL;
    IMMDeviceCollection* collection = NULL;
    IMMDevice* defaultDevice = NULL;
    LPWSTR defaultId = NULL;
    UINT count = 0;
    HRESULT hr;

    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to create MMDeviceEnumerator", hr);
        return -1;
    }

    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice))) {
        defaultDevice->GetId(&defaultId);
    }

    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to enumerate render endpoints", hr);
        if (defaultId != NULL) CoTaskMemFree(defaultId);
        if (defaultDevice != NULL) defaultDevice->Release();
        enumerator->Release();
        return -1;
    }

    hr = collection->GetCount(&count);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to count render endpoints", hr);
        if (defaultId != NULL) CoTaskMemFree(defaultId);
        if (defaultDevice != NULL) defaultDevice->Release();
        collection->Release();
        enumerator->Release();
        return -1;
    }

    for (UINT i = 0; i < count; ++i) {
        IMMDevice* device = NULL;
        LPWSTR id = NULL;
        wasapi_exclusive_device_info info;
        memset(&info, 0, sizeof(info));

        if (FAILED(collection->Item(i, &device)) || device == NULL) continue;
        if (FAILED(device->GetId(&id)) || id == NULL) {
            device->Release();
            continue;
        }

        wcsncpy(info.id, id, sizeof(info.id) / sizeof(info.id[0]) - 1);
        info.id[sizeof(info.id) / sizeof(info.id[0]) - 1] = L'\0';
        if (FAILED(get_device_name(device, info.name, sizeof(info.name))) || info.name[0] == '\0') {
            snprintf(info.name, sizeof(info.name), "WASAPI Device %u", (unsigned int)i);
        }
        info.highestSampleRate = highest_supported_rate(device, 2);
        info.sharedSampleRate = shared_mix_rate(device);
        info.isDefault = (defaultId != NULL && wcscmp(defaultId, id) == 0) ? 1 : 0;
        devices.push_back(info);

        CoTaskMemFree(id);
        device->Release();
    }

    if (defaultId != NULL) CoTaskMemFree(defaultId);
    if (defaultDevice != NULL) defaultDevice->Release();
    collection->Release();
    enumerator->Release();
    return 0;
}

int wasapi_exclusive_list_devices(wasapi_exclusive_device_info** outDevices, uint32_t* outCount) {
    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    com_scope com = com_scope_enter();
    if (FAILED(com.hr)) return -1;

    std::vector<wasapi_exclusive_device_info> devices;
    int result = enumerate_devices(devices, NULL, 0);
    if (result == 0 && !devices.empty()) {
        wasapi_exclusive_device_info* copy = (wasapi_exclusive_device_info*)calloc(devices.size(), sizeof(wasapi_exclusive_device_info));
        if (copy == NULL) {
            result = -1;
        } else {
            memcpy(copy, devices.data(), devices.size() * sizeof(wasapi_exclusive_device_info));
            *outDevices = copy;
            *outCount = (uint32_t)devices.size();
        }
    }

    com_scope_leave(&com);
    return result;
}

void wasapi_exclusive_free_devices(wasapi_exclusive_device_info* devices) {
    free(devices);
}

static IMMDevice* resolve_device(
    const std::vector<wasapi_exclusive_device_info>& devices,
    const char* targetDeviceName,
    int targetDeviceIndex,
    char* error,
    size_t errorLen) {
    IMMDeviceEnumerator* enumerator = NULL;
    IMMDevice* device = NULL;
    const wchar_t* selectedId = NULL;
    HRESULT hr;

    if (targetDeviceIndex >= 0) {
        if ((size_t)targetDeviceIndex < devices.size()) {
            selectedId = devices[(size_t)targetDeviceIndex].id;
        } else {
            set_error(error, errorLen, "Invalid WASAPI device index", S_OK);
            return NULL;
        }
    } else if (targetDeviceName != NULL && targetDeviceName[0] != '\0') {
        wchar_t* wideName = utf8_to_wide_alloc(targetDeviceName);
        for (size_t i = 0; i < devices.size(); ++i) {
            wchar_t deviceName[512];
            MultiByteToWideChar(CP_UTF8, 0, devices[i].name, -1, deviceName, (int)(sizeof(deviceName) / sizeof(deviceName[0])));
            deviceName[sizeof(deviceName) / sizeof(deviceName[0]) - 1] = L'\0';
            if ((wideName != NULL && (wide_contains_icase(deviceName, wideName) || wide_contains_icase(wideName, deviceName))) ||
                strcmp(devices[i].name, targetDeviceName) == 0) {
                selectedId = devices[i].id;
                break;
            }
        }
        free(wideName);
    }

    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to create MMDeviceEnumerator", hr);
        return NULL;
    }

    if (selectedId != NULL) {
        hr = enumerator->GetDevice(selectedId, &device);
    } else {
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    }

    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to resolve WASAPI endpoint", hr);
        device = NULL;
    }

    enumerator->Release();
    return device;
}

static REFERENCE_TIME frames_to_hns(uint32_t frames, uint32_t sampleRate) {
    if (sampleRate == 0) return 0;
    return (REFERENCE_TIME)((10000000.0 * (double)frames / (double)sampleRate) + 0.5);
}

static HRESULT initialize_exclusive_client(
    IMMDevice* device,
    const wasapi_format_desc* format,
    IAudioClient** outClient,
    uint32_t* outBufferFrames) {
    IAudioClient* client = NULL;
    REFERENCE_TIME defaultPeriod = 0;
    REFERENCE_TIME minPeriod = 0;
    REFERENCE_TIME bufferDuration = 100000; /* 10 ms */
    HRESULT hr = activate_audio_client(device, &client);
    if (FAILED(hr)) return hr;

    if (SUCCEEDED(client->GetDevicePeriod(&defaultPeriod, &minPeriod)) && minPeriod > bufferDuration) {
        bufferDuration = minPeriod;
    }

    hr = client->Initialize(
        AUDCLNT_SHAREMODE_EXCLUSIVE,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        bufferDuration,
        bufferDuration,
        (WAVEFORMATEX*)&format->wave,
        NULL);

    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        UINT32 alignedFrames = 0;
        if (SUCCEEDED(client->GetBufferSize(&alignedFrames)) && alignedFrames > 0) {
            client->Release();
            client = NULL;
            hr = activate_audio_client(device, &client);
            if (FAILED(hr)) return hr;
            bufferDuration = frames_to_hns(alignedFrames, format->wave.Format.nSamplesPerSec);
            hr = client->Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                bufferDuration,
                bufferDuration,
                (WAVEFORMATEX*)&format->wave,
                NULL);
        }
    }

    if (FAILED(hr)) {
        client->Release();
        return hr;
    }

    UINT32 bufferFrames = 0;
    hr = client->GetBufferSize(&bufferFrames);
    if (FAILED(hr)) {
        client->Release();
        return hr;
    }

    *outClient = client;
    *outBufferFrames = bufferFrames;
    return S_OK;
}

static float clamp_sample(float sample) {
    if (sample > 1.0f) return 1.0f;
    if (sample < -1.0f) return -1.0f;
    return sample;
}

static void convert_float_to_endpoint(
    const float* input,
    BYTE* output,
    uint32_t frames,
    uint32_t channels,
    wasapi_sample_format kind) {
    uint32_t total = frames * channels;

    switch (kind) {
        case WASAPI_FORMAT_FLOAT32:
            memcpy(output, input, (size_t)total * sizeof(float));
            break;
        case WASAPI_FORMAT_PCM24_IN_32: {
            int32_t* dst = (int32_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                int32_t v = (int32_t)(s * 8388607.0f);
                dst[i] = v << 8;
            }
            break;
        }
        case WASAPI_FORMAT_PCM32: {
            int32_t* dst = (int32_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                dst[i] = (int32_t)(s * 2147483647.0f);
            }
            break;
        }
        case WASAPI_FORMAT_PCM16:
        default: {
            int16_t* dst = (int16_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                dst[i] = (int16_t)(s * 32767.0f);
            }
            break;
        }
    }
}

static DWORD WINAPI render_thread_proc(void* param) {
    wasapi_exclusive_runtime* runtime = (wasapi_exclusive_runtime*)param;
    std::vector<float> scratch;
    DWORD taskIndex = 0;
    HANDLE avrtHandle = NULL;
    HANDLE waits[2];
    com_scope com = com_scope_enter();

    if (FAILED(com.hr)) {
        InterlockedExchange(&runtime->renderFailed, 1);
        return 1;
    }

    scratch.resize((size_t)runtime->bufferFrameCount * runtime->channels);
    avrtHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    waits[0] = runtime->stopEvent;
    waits[1] = runtime->renderEvent;

    while (1) {
        DWORD waitResult = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
        if (waitResult == WAIT_OBJECT_0) break;
        if (waitResult != WAIT_OBJECT_0 + 1) {
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        UINT32 framesAvailable = runtime->bufferFrameCount;

        BYTE* endpointBuffer = NULL;
        HRESULT hr = runtime->renderClient->GetBuffer(framesAvailable, &endpointBuffer);
        if (FAILED(hr)) {
            fprintf(stderr, "[echo-audio-host] WASAPI render GetBuffer failed hr=0x%08lx\n", (unsigned long)hr);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        memset(scratch.data(), 0, (size_t)framesAvailable * runtime->channels * sizeof(float));
        if (runtime->callback != NULL) {
            runtime->callback(runtime->userData, scratch.data(), framesAvailable, runtime->channels);
        }
        convert_float_to_endpoint(
            scratch.data(),
            endpointBuffer,
            framesAvailable,
            runtime->channels,
            runtime->format.kind);

        hr = runtime->renderClient->ReleaseBuffer(framesAvailable, 0);
        if (FAILED(hr)) {
            fprintf(stderr, "[echo-audio-host] WASAPI render ReleaseBuffer failed hr=0x%08lx\n", (unsigned long)hr);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }
    }

    if (avrtHandle != NULL) AvRevertMmThreadCharacteristics(avrtHandle);
    com_scope_leave(&com);
    return InterlockedCompareExchange(&runtime->renderFailed, 0, 0) ? 1 : 0;
}

static int classify_initialize_failure(HRESULT hr) {
    if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT) {
        return -4;
    }
    if (hr == AUDCLNT_E_DEVICE_IN_USE ||
        hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED ||
        hr == AUDCLNT_E_ENDPOINT_CREATE_FAILED) {
        return -2;
    }
    return -1;
}

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
    size_t errorLen) {
    com_scope com = com_scope_enter();
    std::vector<wasapi_exclusive_device_info> devices;
    IMMDevice* device = NULL;
    IAudioClient* audioClient = NULL;
    IAudioRenderClient* renderClient = NULL;
    wasapi_format_desc format;
    uint32_t bufferFrames = 0;
    wasapi_exclusive_runtime* runtime = NULL;
    HRESULT hr;
    int result = -1;

    if (outRuntime == NULL || outInfo == NULL || callback == NULL) return -1;
    *outRuntime = NULL;
    memset(outInfo, 0, sizeof(*outInfo));
    if (error != NULL && errorLen > 0) error[0] = '\0';

    if (FAILED(com.hr)) {
        set_error(error, errorLen, "Failed to initialize COM", com.hr);
        return -1;
    }

    if (channels == 0 || channels > 2) {
        set_error(error, errorLen, "WASAPI exclusive supports 1 or 2 channels in this host", S_OK);
        com_scope_leave(&com);
        return -4;
    }

    if (enumerate_devices(devices, error, errorLen) != 0 || devices.empty()) {
        com_scope_leave(&com);
        return -1;
    }

    device = resolve_device(devices, targetDeviceName, targetDeviceIndex, error, errorLen);
    if (device == NULL) {
        com_scope_leave(&com);
        return -1;
    }

    hr = activate_audio_client(device, &audioClient);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to activate IAudioClient", hr);
        goto done;
    }

    if (!choose_exact_format(audioClient, sampleRate, channels, &format)) {
        set_error(error, errorLen, "WASAPI exclusive format unsupported", S_OK);
        result = -4;
        goto done;
    }
    audioClient->Release();
    audioClient = NULL;

    hr = initialize_exclusive_client(device, &format, &audioClient, &bufferFrames);
    if (FAILED(hr)) {
        result = classify_initialize_failure(hr);
        set_error(
            error,
            errorLen,
            result == -4 ? "WASAPI exclusive format unsupported" : "Failed to initialize WASAPI exclusive client",
            hr);
        goto done;
    }

    hr = audioClient->GetService(__uuidof(IAudioRenderClient), (void**)&renderClient);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to get IAudioRenderClient", hr);
        goto done;
    }

    runtime = (wasapi_exclusive_runtime*)calloc(1, sizeof(wasapi_exclusive_runtime));
    if (runtime == NULL) {
        set_error(error, errorLen, "Failed to allocate WASAPI runtime", S_OK);
        goto done;
    }

    runtime->audioClient = audioClient;
    runtime->renderClient = renderClient;
    runtime->sampleRate = sampleRate;
    runtime->channels = channels;
    runtime->bufferFrameCount = bufferFrames;
    runtime->format = format;
    runtime->callback = callback;
    runtime->userData = userData;
    runtime->comNeedsUninit = com.needsUninit;
    com.needsUninit = 0;
    audioClient = NULL;
    renderClient = NULL;

    runtime->renderEvent = CreateEventW(NULL, FALSE, FALSE, NULL);
    runtime->stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (runtime->renderEvent == NULL || runtime->stopEvent == NULL) {
        set_error(error, errorLen, "Failed to create WASAPI events", HRESULT_FROM_WIN32(GetLastError()));
        goto done;
    }

    hr = runtime->audioClient->SetEventHandle(runtime->renderEvent);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to set WASAPI event handle", hr);
        goto done;
    }

    BYTE* endpointBuffer = NULL;
    hr = runtime->renderClient->GetBuffer(runtime->bufferFrameCount, &endpointBuffer);
    if (SUCCEEDED(hr)) {
        memset(endpointBuffer, 0, (size_t)runtime->bufferFrameCount * runtime->format.wave.Format.nBlockAlign);
        hr = runtime->renderClient->ReleaseBuffer(runtime->bufferFrameCount, AUDCLNT_BUFFERFLAGS_SILENT);
    }
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to prime WASAPI buffer", hr);
        goto done;
    }

    runtime->thread = CreateThread(NULL, 0, render_thread_proc, runtime, 0, NULL);
    if (runtime->thread == NULL) {
        set_error(error, errorLen, "Failed to create WASAPI render thread", HRESULT_FROM_WIN32(GetLastError()));
        goto done;
    }

    hr = runtime->audioClient->Start();
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to start WASAPI exclusive client", hr);
        result = classify_initialize_failure(hr);
        goto done;
    }

    outInfo->sampleRate = sampleRate;
    outInfo->hardwareSampleRate = sampleRate;
    outInfo->channels = channels;
    snprintf(outInfo->format, sizeof(outInfo->format), "%s", runtime->format.name);
    *outRuntime = runtime;
    runtime = NULL;
    result = 0;

done:
    if (runtime != NULL) {
        wasapi_exclusive_stop(runtime);
    }
    if (renderClient != NULL) renderClient->Release();
    if (audioClient != NULL) audioClient->Release();
    if (device != NULL) device->Release();
    com_scope_leave(&com);
    return result;
}

void wasapi_exclusive_stop(wasapi_exclusive_runtime* runtime) {
    if (runtime == NULL) return;

    if (runtime->stopEvent != NULL) SetEvent(runtime->stopEvent);
    if (runtime->thread != NULL) {
        WaitForSingleObject(runtime->thread, 5000);
        CloseHandle(runtime->thread);
    }
    if (runtime->audioClient != NULL) runtime->audioClient->Stop();
    if (runtime->renderEvent != NULL) CloseHandle(runtime->renderEvent);
    if (runtime->stopEvent != NULL) CloseHandle(runtime->stopEvent);
    if (runtime->renderClient != NULL) runtime->renderClient->Release();
    if (runtime->audioClient != NULL) runtime->audioClient->Release();
    if (runtime->comNeedsUninit) CoUninitialize();
    free(runtime);
}

#endif
