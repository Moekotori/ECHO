#ifdef _WIN32

#include "wasapi_exclusive.h"
#include "wasapi_timeout.h"

#include <windows.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <mmdeviceapi.h>
#include <propidl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <new>
#include <vector>

static const GUID ECHO_SUBTYPE_PCM = {
    0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

static const GUID ECHO_SUBTYPE_IEEE_FLOAT = {
    0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

typedef enum wasapi_sample_format {
    WASAPI_FORMAT_FLOAT32 = 0,
    WASAPI_FORMAT_PCM24_PACKED,
    WASAPI_FORMAT_PCM24_IN_32,
    WASAPI_FORMAT_PCM32,
    WASAPI_FORMAT_PCM16
} wasapi_sample_format;

typedef struct wasapi_format_desc {
    WAVEFORMATEXTENSIBLE wave;
    wasapi_sample_format kind;
    const char* name;
} wasapi_format_desc;

typedef enum wasapi_render_mode {
    WASAPI_RENDER_PCM = 0,
    WASAPI_RENDER_DOP
} wasapi_render_mode;

class DeviceWatcher;
class SessionWatcher;

struct wasapi_exclusive_runtime {
    IAudioClient* audioClient;
    IAudioRenderClient* renderClient;
    IMMDeviceEnumerator* deviceEnumerator;
    DeviceWatcher* deviceWatcher;
    IAudioSessionControl* sessionControl;
    SessionWatcher* sessionWatcher;
    HANDLE renderEvent;
    HANDLE stopEvent;
    HANDLE thread;
    uint32_t sampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    wasapi_format_desc format;
    wasapi_render_callback callback;
    wasapi_dop_render_callback dopCallback;
    void* userData;
    wasapi_render_mode renderMode;
    wasapi_host_notification_callback notificationCallback;
    void* notificationUserData;
    wchar_t deviceId[512];
    int followsDefaultDevice;
    volatile LONG renderFailed;
    int comNeedsUninit;
    bool audioClientLeakedOnTimeout;
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

static int wide_equals_icase(const wchar_t* left, const wchar_t* right) {
    if (left == NULL || right == NULL) return 0;
    return _wcsicmp(left, right) == 0 ? 1 : 0;
}

static const char* device_state_name(DWORD state) {
    switch (state) {
        case DEVICE_STATE_ACTIVE: return "active";
        case DEVICE_STATE_DISABLED: return "disabled";
        case DEVICE_STATE_NOTPRESENT: return "not_present";
        case DEVICE_STATE_UNPLUGGED: return "unplugged";
        default: return "unknown";
    }
}

static const char* endpoint_role_name(ERole role) {
    switch (role) {
        case eConsole: return "console";
        case eMultimedia: return "multimedia";
        case eCommunications: return "communications";
        default: return "unknown";
    }
}

static const char* session_disconnect_reason_name(AudioSessionDisconnectReason reason) {
    switch (reason) {
        case DisconnectReasonDeviceRemoval: return "device_removal";
        case DisconnectReasonServerShutdown: return "server_shutdown";
        case DisconnectReasonFormatChanged: return "format_changed";
        case DisconnectReasonSessionLogoff: return "session_logoff";
        case DisconnectReasonSessionDisconnected: return "session_disconnected";
        case DisconnectReasonExclusiveModeOverride: return "exclusive_mode_override";
        default: return "unknown";
    }
}

static void copy_device_id(IMMDevice* device, wchar_t* out, size_t outLen) {
    LPWSTR rawId = NULL;
    if (out == NULL || outLen == 0) return;
    out[0] = L'\0';
    if (device == NULL) return;
    if (SUCCEEDED(device->GetId(&rawId)) && rawId != NULL) {
        wcsncpy(out, rawId, outLen - 1);
        out[outLen - 1] = L'\0';
    }
    if (rawId != NULL) CoTaskMemFree(rawId);
}

static void dispatch_notification(
    wasapi_host_notification_callback callback,
    void* userData,
    const char* event,
    const wchar_t* deviceId,
    const char* reason,
    unsigned int code,
    int currentDevice,
    int followsDefaultDevice) {
    if (callback == NULL || event == NULL) return;

    wasapi_host_notification notification;
    notification.event = event;
    notification.deviceId = deviceId;
    notification.reason = reason;
    notification.code = code;
    notification.currentDevice = currentDevice;
    notification.followsDefaultDevice = followsDefaultDevice;
    callback(userData, &notification);
}

class DeviceWatcher : public IMMNotificationClient {
public:
    DeviceWatcher(
        const wchar_t* currentDeviceIdToUse,
        int followsDefaultDeviceToUse,
        wasapi_host_notification_callback callbackToUse,
        void* callbackUserDataToUse)
        : followsDefaultDevice(followsDefaultDeviceToUse),
          notificationCallback(callbackToUse),
          notificationUserData(callbackUserDataToUse) {
        currentDeviceId[0] = L'\0';
        if (currentDeviceIdToUse != NULL) {
            wcsncpy(currentDeviceId, currentDeviceIdToUse, sizeof(currentDeviceId) / sizeof(currentDeviceId[0]) - 1);
            currentDeviceId[sizeof(currentDeviceId) / sizeof(currentDeviceId[0]) - 1] = L'\0';
        }
    }

    ULONG STDMETHODCALLTYPE AddRef(void) override {
        return (ULONG)InterlockedIncrement(&refCount);
    }

    ULONG STDMETHODCALLTYPE Release(void) override {
        ULONG remaining = (ULONG)InterlockedDecrement(&refCount);
        if (remaining == 0) delete this;
        return remaining;
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
        if (object == NULL) return E_POINTER;
        *object = NULL;

        if (riid == __uuidof(IUnknown) || riid == __uuidof(IMMNotificationClient)) {
            *object = static_cast<IMMNotificationClient*>(this);
            AddRef();
            return S_OK;
        }

        return E_NOINTERFACE;
    }

    HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role, LPCWSTR defaultDeviceId) override {
        if (flow == eRender) {
            dispatch_notification(
                notificationCallback,
                notificationUserData,
                "default_device_changed",
                defaultDeviceId,
                endpoint_role_name(role),
                (unsigned int)role,
                followsDefaultDevice || wide_equals_icase(defaultDeviceId, currentDeviceId),
                followsDefaultDevice);
        }

        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR deviceId) override {
        (void)deviceId;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR deviceId) override {
        dispatch_notification(
            notificationCallback,
            notificationUserData,
            "device_removed",
            deviceId,
            "removed",
            0,
            wide_equals_icase(deviceId, currentDeviceId),
            followsDefaultDevice);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR deviceId, DWORD newState) override {
        dispatch_notification(
            notificationCallback,
            notificationUserData,
            "device_state_changed",
            deviceId,
            device_state_name(newState),
            (unsigned int)newState,
            wide_equals_icase(deviceId, currentDeviceId),
            followsDefaultDevice);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR deviceId, const PROPERTYKEY key) override {
        (void)deviceId;
        (void)key;
        return S_OK;
    }

private:
    volatile LONG refCount = 1;
    wchar_t currentDeviceId[512];
    int followsDefaultDevice = 0;
    wasapi_host_notification_callback notificationCallback = NULL;
    void* notificationUserData = NULL;
};

class SessionWatcher : public IAudioSessionEvents {
public:
    SessionWatcher(
        const wchar_t* currentDeviceIdToUse,
        int followsDefaultDeviceToUse,
        wasapi_host_notification_callback callbackToUse,
        void* callbackUserDataToUse)
        : followsDefaultDevice(followsDefaultDeviceToUse),
          notificationCallback(callbackToUse),
          notificationUserData(callbackUserDataToUse) {
        currentDeviceId[0] = L'\0';
        if (currentDeviceIdToUse != NULL) {
            wcsncpy(currentDeviceId, currentDeviceIdToUse, sizeof(currentDeviceId) / sizeof(currentDeviceId[0]) - 1);
            currentDeviceId[sizeof(currentDeviceId) / sizeof(currentDeviceId[0]) - 1] = L'\0';
        }
    }

    ULONG STDMETHODCALLTYPE AddRef(void) override {
        return (ULONG)InterlockedIncrement(&refCount);
    }

    ULONG STDMETHODCALLTYPE Release(void) override {
        ULONG remaining = (ULONG)InterlockedDecrement(&refCount);
        if (remaining == 0) delete this;
        return remaining;
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
        if (object == NULL) return E_POINTER;
        *object = NULL;

        if (riid == __uuidof(IUnknown) || riid == __uuidof(IAudioSessionEvents)) {
            *object = static_cast<IAudioSessionEvents*>(this);
            AddRef();
            return S_OK;
        }

        return E_NOINTERFACE;
    }

    HRESULT STDMETHODCALLTYPE OnDisplayNameChanged(LPCWSTR name, LPCGUID context) override {
        (void)name;
        (void)context;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnIconPathChanged(LPCWSTR iconPath, LPCGUID context) override {
        (void)iconPath;
        (void)context;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnSimpleVolumeChanged(float volume, BOOL muted, LPCGUID context) override {
        (void)volume;
        (void)muted;
        (void)context;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnChannelVolumeChanged(DWORD channelCount, float newVolumes[], DWORD changedChannel, LPCGUID context) override {
        (void)channelCount;
        (void)newVolumes;
        (void)changedChannel;
        (void)context;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnGroupingParamChanged(LPCGUID groupingId, LPCGUID context) override {
        (void)groupingId;
        (void)context;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnStateChanged(AudioSessionState state) override {
        (void)state;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnSessionDisconnected(AudioSessionDisconnectReason reason) override {
        dispatch_notification(
            notificationCallback,
            notificationUserData,
            "audio_session_disconnected",
            currentDeviceId,
            session_disconnect_reason_name(reason),
            (unsigned int)reason,
            1,
            followsDefaultDevice);
        return S_OK;
    }

private:
    volatile LONG refCount = 1;
    wchar_t currentDeviceId[512];
    int followsDefaultDevice = 0;
    wasapi_host_notification_callback notificationCallback = NULL;
    void* notificationUserData = NULL;
};

static void register_device_watcher(wasapi_exclusive_runtime* runtime) {
    if (runtime == NULL || runtime->notificationCallback == NULL) return;

    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        NULL,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        (void**)&runtime->deviceEnumerator);
    if (FAILED(hr) || runtime->deviceEnumerator == NULL) {
        fprintf(stderr, "[echo-audio-host] WASAPI exclusive notification enumerator failed hr=0x%08lx\n", (unsigned long)hr);
        return;
    }

    runtime->deviceWatcher = new (std::nothrow) DeviceWatcher(
        runtime->deviceId,
        runtime->followsDefaultDevice,
        runtime->notificationCallback,
        runtime->notificationUserData);
    if (runtime->deviceWatcher == NULL) {
        runtime->deviceEnumerator->Release();
        runtime->deviceEnumerator = NULL;
        return;
    }

    hr = runtime->deviceEnumerator->RegisterEndpointNotificationCallback(runtime->deviceWatcher);
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI exclusive device watcher registration failed hr=0x%08lx\n", (unsigned long)hr);
        runtime->deviceWatcher->Release();
        runtime->deviceWatcher = NULL;
        runtime->deviceEnumerator->Release();
        runtime->deviceEnumerator = NULL;
    }
}

static void register_session_watcher(wasapi_exclusive_runtime* runtime) {
    if (runtime == NULL || runtime->notificationCallback == NULL || runtime->audioClient == NULL) return;

    runtime->sessionWatcher = new (std::nothrow) SessionWatcher(
        runtime->deviceId,
        runtime->followsDefaultDevice,
        runtime->notificationCallback,
        runtime->notificationUserData);
    if (runtime->sessionWatcher == NULL) return;

    HRESULT hr = runtime->audioClient->GetService(__uuidof(IAudioSessionControl), (void**)&runtime->sessionControl);
    if (FAILED(hr) || runtime->sessionControl == NULL) {
        fprintf(stderr, "[echo-audio-host] WASAPI exclusive session control failed hr=0x%08lx\n", (unsigned long)hr);
        runtime->sessionWatcher->Release();
        runtime->sessionWatcher = NULL;
        return;
    }

    hr = runtime->sessionControl->RegisterAudioSessionNotification(runtime->sessionWatcher);
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI exclusive session watcher registration failed hr=0x%08lx\n", (unsigned long)hr);
        runtime->sessionWatcher->Release();
        runtime->sessionWatcher = NULL;
        runtime->sessionControl->Release();
        runtime->sessionControl = NULL;
    }

    if (runtime->sessionControl != NULL) {
        AudioSessionState state;
        runtime->sessionControl->GetState(&state);
    }
}

static void unregister_watchers(wasapi_exclusive_runtime* runtime) {
    if (runtime == NULL) return;

    if (runtime->deviceEnumerator != NULL && runtime->deviceWatcher != NULL) {
        runtime->deviceEnumerator->UnregisterEndpointNotificationCallback(runtime->deviceWatcher);
    }
    if (runtime->deviceWatcher != NULL) {
        runtime->deviceWatcher->Release();
        runtime->deviceWatcher = NULL;
    }
    if (runtime->deviceEnumerator != NULL) {
        runtime->deviceEnumerator->Release();
        runtime->deviceEnumerator = NULL;
    }

    if (runtime->sessionControl != NULL && runtime->sessionWatcher != NULL) {
        runtime->sessionControl->UnregisterAudioSessionNotification(runtime->sessionWatcher);
    }
    if (runtime->sessionWatcher != NULL) {
        runtime->sessionWatcher->Release();
        runtime->sessionWatcher = NULL;
    }
    if (runtime->sessionControl != NULL) {
        runtime->sessionControl->Release();
        runtime->sessionControl = NULL;
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
        case WASAPI_FORMAT_PCM24_PACKED:
            wave->Format.wBitsPerSample = 24;
            wave->Samples.wValidBitsPerSample = 24;
            wave->SubFormat = ECHO_SUBTYPE_PCM;
            out->name = "pcm24";
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
    return echo_wasapi_timeout::activate_audio_client_with_timeout(device, outClient);
}

static int choose_exact_format(
    IAudioClient* audioClient,
    uint32_t sampleRate,
    uint32_t channels,
    wasapi_format_desc* outFormat) {
    static const wasapi_sample_format kinds[] = {
        WASAPI_FORMAT_FLOAT32,
        WASAPI_FORMAT_PCM24_IN_32,
        WASAPI_FORMAT_PCM16,
        WASAPI_FORMAT_PCM32
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

static int enumerate_devices(
    std::vector<wasapi_exclusive_device_info>& devices,
    char* error,
    size_t errorLen,
    bool probeRates = true) {
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
        info.highestSampleRate = probeRates ? highest_supported_rate(device, 2) : 0;
        info.sharedSampleRate = probeRates ? shared_mix_rate(device) : 0;
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
    uint32_t requestedBufferFrames,
    IAudioClient** outClient,
    uint32_t* outBufferFrames) {
    IAudioClient* client = NULL;
    REFERENCE_TIME defaultPeriod = 0;
    REFERENCE_TIME minPeriod = 0;
    REFERENCE_TIME bufferDuration = requestedBufferFrames > 0
        ? frames_to_hns(requestedBufferFrames, format->wave.Format.nSamplesPerSec)
        : 100000; /* 10 ms */
    HRESULT hr = activate_audio_client(device, &client);
    if (FAILED(hr)) return hr;

    hr = echo_wasapi_timeout::get_device_period_with_timeout(client, &defaultPeriod, &minPeriod);
    if (hr == E_PENDING) {
        return hr;
    }
    if (SUCCEEDED(hr) && minPeriod > bufferDuration) {
        bufferDuration = minPeriod;
    }

    const DWORD streamFlags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST;

    hr = echo_wasapi_timeout::initialize_with_timeout(
        client,
        AUDCLNT_SHAREMODE_EXCLUSIVE,
        streamFlags,
        bufferDuration,
        bufferDuration,
        (WAVEFORMATEX*)&format->wave,
        NULL);
    if (hr == E_PENDING) {
        return hr;
    }

    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        UINT32 alignedFrames = 0;
        if (SUCCEEDED(client->GetBufferSize(&alignedFrames)) && alignedFrames > 0) {
            client->Release();
            client = NULL;
            hr = activate_audio_client(device, &client);
            if (FAILED(hr)) return hr;
            bufferDuration = frames_to_hns(alignedFrames, format->wave.Format.nSamplesPerSec);
            hr = echo_wasapi_timeout::initialize_with_timeout(
                client,
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                streamFlags,
                bufferDuration,
                bufferDuration,
                (WAVEFORMATEX*)&format->wave,
                NULL);
            if (hr == E_PENDING) {
                return hr;
            }
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

static HRESULT initialize_exclusive_client_for_render_mode(
    IMMDevice* device,
    uint32_t sampleRate,
    uint32_t channels,
    uint32_t requestedBufferFrames,
    wasapi_render_mode renderMode,
    wasapi_format_desc* outFormat,
    IAudioClient** outClient,
    uint32_t* outBufferFrames) {
    static const wasapi_sample_format pcmKinds[] = {
        WASAPI_FORMAT_FLOAT32,
        WASAPI_FORMAT_PCM24_IN_32,
        WASAPI_FORMAT_PCM16,
        WASAPI_FORMAT_PCM32
    };
    static const wasapi_sample_format dopKinds[] = {
        WASAPI_FORMAT_PCM24_PACKED,
        WASAPI_FORMAT_PCM24_IN_32,
        WASAPI_FORMAT_PCM32
    };

    if (outFormat == NULL || outClient == NULL || outBufferFrames == NULL) return E_POINTER;
    *outClient = NULL;
    *outBufferFrames = 0;
    memset(outFormat, 0, sizeof(*outFormat));

    const wasapi_sample_format* kinds = renderMode == WASAPI_RENDER_DOP ? dopKinds : pcmKinds;
    const size_t kindCount = renderMode == WASAPI_RENDER_DOP
        ? sizeof(dopKinds) / sizeof(dopKinds[0])
        : sizeof(pcmKinds) / sizeof(pcmKinds[0]);
    HRESULT lastUnsupported = AUDCLNT_E_UNSUPPORTED_FORMAT;

    for (size_t i = 0; i < kindCount; ++i) {
        wasapi_format_desc candidate;
        IAudioClient* client = NULL;
        uint32_t bufferFrames = 0;
        make_format(sampleRate, channels, kinds[i], &candidate);

        HRESULT hr = initialize_exclusive_client(
            device,
            &candidate,
            requestedBufferFrames,
            &client,
            &bufferFrames);
        if (SUCCEEDED(hr)) {
            *outFormat = candidate;
            *outClient = client;
            *outBufferFrames = bufferFrames;
            return S_OK;
        }

        if (hr == E_PENDING) {
            return hr;
        }

        if (hr != AUDCLNT_E_UNSUPPORTED_FORMAT) {
            return hr;
        }

        lastUnsupported = hr;
    }

    return lastUnsupported;
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
        case WASAPI_FORMAT_PCM24_PACKED: {
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                int32_t v = (int32_t)(s * 8388607.0f);
                output[i * 3 + 0] = (BYTE)(v & 0xff);
                output[i * 3 + 1] = (BYTE)((v >> 8) & 0xff);
                output[i * 3 + 2] = (BYTE)((v >> 16) & 0xff);
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

static void convert_dop_to_endpoint(
    const uint32_t* input,
    BYTE* output,
    uint32_t frames,
    uint32_t channels,
    wasapi_sample_format kind) {
    const uint32_t total = frames * channels;

    switch (kind) {
        case WASAPI_FORMAT_PCM24_PACKED:
            for (uint32_t i = 0; i < total; ++i) {
                const uint32_t sample = input[i] & 0x00ffffffu;
                output[i * 3 + 0] = (BYTE)(sample & 0xff);
                output[i * 3 + 1] = (BYTE)((sample >> 8) & 0xff);
                output[i * 3 + 2] = (BYTE)((sample >> 16) & 0xff);
            }
            break;
        case WASAPI_FORMAT_PCM24_IN_32:
        case WASAPI_FORMAT_PCM32: {
            uint32_t* dst = (uint32_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                dst[i] = input[i] << 8;
            }
            break;
        }
        default:
            memset(output, 0, (size_t)total * 3);
            break;
    }
}

static DWORD WINAPI render_thread_proc(void* param) {
    wasapi_exclusive_runtime* runtime = (wasapi_exclusive_runtime*)param;
    std::vector<float> scratch;
    std::vector<uint32_t> dopScratch;
    DWORD taskIndex = 0;
    HANDLE avrtHandle = NULL;
    HANDLE waits[2];
    com_scope com = com_scope_enter();

    if (FAILED(com.hr)) {
        InterlockedExchange(&runtime->renderFailed, 1);
        return 1;
    }

    if (runtime->renderMode == WASAPI_RENDER_DOP)
        dopScratch.resize((size_t)runtime->bufferFrameCount * runtime->channels);
    else
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
            if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
                fprintf(stderr, "[echo-audio-host] WASAPI render device invalidated hr=0x%08lx\n", (unsigned long)hr);
                dispatch_notification(
                    runtime->notificationCallback,
                    runtime->notificationUserData,
                    "audio_session_disconnected",
                    runtime->deviceId,
                    "device_invalidated",
                    (unsigned int)hr,
                    1,
                    runtime->followsDefaultDevice);
            } else {
                fprintf(stderr, "[echo-audio-host] WASAPI render GetBuffer failed hr=0x%08lx\n", (unsigned long)hr);
            }
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        try {
            if (runtime->renderMode == WASAPI_RENDER_DOP) {
                memset(dopScratch.data(), 0, (size_t)framesAvailable * runtime->channels * sizeof(uint32_t));
                if (runtime->dopCallback != NULL) {
                    runtime->dopCallback(runtime->userData, dopScratch.data(), framesAvailable, runtime->channels);
                }
                convert_dop_to_endpoint(
                    dopScratch.data(),
                    endpointBuffer,
                    framesAvailable,
                    runtime->channels,
                    runtime->format.kind);
            } else {
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
            }
        } catch (...) {
            HRESULT releaseHr = runtime->renderClient->ReleaseBuffer(framesAvailable, AUDCLNT_BUFFERFLAGS_SILENT);
            if (FAILED(releaseHr)) {
                fprintf(stderr, "[echo-audio-host] WASAPI render ReleaseBuffer after callback exception failed hr=0x%08lx\n", (unsigned long)releaseHr);
            }
            fprintf(stderr, "[echo-audio-host] WASAPI render callback threw; released silent buffer\n");
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

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
    if (hr == E_PENDING) {
        return echo_audio_host::kExitDeviceInitializeTimeout;
    }
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

static int wasapi_exclusive_start_impl(
    const char* targetDeviceName,
    int targetDeviceIndex,
    uint32_t sampleRate,
    uint32_t channels,
    uint32_t requestedBufferFrames,
    wasapi_render_callback callback,
    wasapi_dop_render_callback dopCallback,
    void* userData,
    wasapi_host_notification_callback notificationCallback,
    void* notificationUserData,
    wasapi_exclusive_runtime** outRuntime,
    wasapi_exclusive_ready_info* outInfo,
    char* error,
    size_t errorLen,
    wasapi_render_mode renderMode) {
    com_scope com = com_scope_enter();
    std::vector<wasapi_exclusive_device_info> devices;
    IMMDevice* device = NULL;
    IAudioClient* audioClient = NULL;
    IAudioRenderClient* renderClient = NULL;
    wasapi_format_desc format;
    uint32_t bufferFrames = 0;
    wasapi_exclusive_runtime* runtime = NULL;
    BYTE* endpointBuffer = NULL;
    HRESULT hr;
    int result = -1;

    if (outRuntime == NULL || outInfo == NULL) return -1;
    if (renderMode == WASAPI_RENDER_DOP && dopCallback == NULL) return -1;
    if (renderMode == WASAPI_RENDER_PCM && callback == NULL) return -1;
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

    if (enumerate_devices(devices, error, errorLen, false) != 0 || devices.empty()) {
        com_scope_leave(&com);
        return -1;
    }

    device = resolve_device(devices, targetDeviceName, targetDeviceIndex, error, errorLen);
    if (device == NULL) {
        com_scope_leave(&com);
        return -1;
    }

    hr = initialize_exclusive_client_for_render_mode(
        device,
        sampleRate,
        channels,
        requestedBufferFrames,
        renderMode,
        &format,
        &audioClient,
        &bufferFrames);
    if (FAILED(hr)) {
        result = classify_initialize_failure(hr);
        set_error(
            error,
            errorLen,
            result == echo_audio_host::kExitDeviceInitializeTimeout
                ? "WASAPI Initialize timed out"
                : (result == -4 ? "WASAPI exclusive format unsupported" : "Failed to initialize WASAPI exclusive client"),
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
    fprintf(stderr,
        "[echo-audio-host] WASAPI exclusive selected format=%s sampleRate=%u channels=%u requestedBuffer=%u\n",
        runtime->format.name,
        (unsigned int)sampleRate,
        (unsigned int)channels,
        (unsigned int)requestedBufferFrames);
    /* Render callbacks are immutable while the render thread is alive: assigned before
       CreateThread and cleared only after WaitForSingleObject confirms thread exit. */
    runtime->callback = callback;
    runtime->dopCallback = dopCallback;
    runtime->userData = userData;
    runtime->renderMode = renderMode;
    runtime->notificationCallback = notificationCallback;
    runtime->notificationUserData = notificationUserData;
    runtime->followsDefaultDevice = (targetDeviceIndex < 0 && (targetDeviceName == NULL || targetDeviceName[0] == '\0')) ? 1 : 0;
    copy_device_id(device, runtime->deviceId, sizeof(runtime->deviceId) / sizeof(runtime->deviceId[0]));
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

    register_device_watcher(runtime);
    register_session_watcher(runtime);

    /* declared up front so earlier `goto done` doesn't cross initialization (g++ rejects that) */
    endpointBuffer = NULL;
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

    hr = echo_wasapi_timeout::start_with_timeout(runtime->audioClient);
    if (hr == E_PENDING) {
        set_error(error, errorLen, "WASAPI Start timed out", S_OK);
        runtime->audioClientLeakedOnTimeout = true;
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        goto done;
    }
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to start WASAPI exclusive client", hr);
        result = classify_initialize_failure(hr);
        goto done;
    }

    outInfo->sampleRate = sampleRate;
    outInfo->hardwareSampleRate = sampleRate;
    outInfo->channels = channels;
    outInfo->bufferFrameCount = bufferFrames;
    snprintf(outInfo->format, sizeof(outInfo->format), "%s", runtime->format.name);
    *outRuntime = runtime;
    runtime = NULL;
    result = 0;

done:
    if (runtime != NULL) {
        wasapi_exclusive_stop(runtime);
    }
    if (renderClient != NULL) renderClient->Release();
    if (audioClient != NULL && result != echo_audio_host::kExitDeviceInitializeTimeout) audioClient->Release();
    if (device != NULL) device->Release();
    if (result != echo_audio_host::kExitDeviceInitializeTimeout) com_scope_leave(&com);
    return result;
}

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
    size_t errorLen) {
    return wasapi_exclusive_start_impl(
        targetDeviceName,
        targetDeviceIndex,
        sampleRate,
        channels,
        requestedBufferFrames,
        callback,
        NULL,
        userData,
        notificationCallback,
        notificationUserData,
        outRuntime,
        outInfo,
        error,
        errorLen,
        WASAPI_RENDER_PCM);
}

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
    size_t errorLen) {
    return wasapi_exclusive_start_impl(
        targetDeviceName,
        targetDeviceIndex,
        sampleRate,
        channels,
        requestedBufferFrames,
        NULL,
        callback,
        userData,
        notificationCallback,
        notificationUserData,
        outRuntime,
        outInfo,
        error,
        errorLen,
        WASAPI_RENDER_DOP);
}

void wasapi_exclusive_stop(wasapi_exclusive_runtime* runtime) {
    if (runtime == NULL) return;

    unregister_watchers(runtime);
    if (runtime->stopEvent != NULL) SetEvent(runtime->stopEvent);
    if (runtime->thread != NULL) {
        DWORD waitResult = WaitForSingleObject(runtime->thread, 5000);
        if (waitResult != WAIT_OBJECT_0) {
            InterlockedExchange(&runtime->renderFailed, 1);
            fprintf(stderr,
                "[echo-audio-host] WASAPI exclusive render thread did not stop in time; marked render failed and deferred COM/event/thread resource release to process teardown\n");
            CloseHandle(runtime->thread);
            return;
        }
        CloseHandle(runtime->thread);
        runtime->thread = NULL;
    }
    runtime->callback = NULL;
    runtime->dopCallback = NULL;
    runtime->userData = NULL;
    if (runtime->audioClient != NULL && !runtime->audioClientLeakedOnTimeout) {
        runtime->audioClient->Stop();
        runtime->audioClient->Reset();
    }
    if (runtime->renderEvent != NULL) CloseHandle(runtime->renderEvent);
    if (runtime->stopEvent != NULL) CloseHandle(runtime->stopEvent);
    if (runtime->renderClient != NULL && !runtime->audioClientLeakedOnTimeout) runtime->renderClient->Release();
    if (runtime->audioClient != NULL && !runtime->audioClientLeakedOnTimeout) runtime->audioClient->Release();
    runtime->renderClient = NULL;
    runtime->audioClient = NULL;
    runtime->deviceWatcher = NULL;
    runtime->deviceEnumerator = NULL;
    runtime->sessionWatcher = NULL;
    runtime->sessionControl = NULL;
    if (runtime->comNeedsUninit && !runtime->audioClientLeakedOnTimeout) CoUninitialize();
    free(runtime);
}

#endif
