#ifdef _WIN32

#include "wasapi_shared.h"
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

#include "wasapi_diag.h"

#ifndef AUDCLNT_E_RESOURCES_INVALIDATED
#define AUDCLNT_E_RESOURCES_INVALIDATED ((HRESULT)0x88890026)
#endif
#ifndef AUDCLNT_E_SERVICE_NOT_RUNNING
#define AUDCLNT_E_SERVICE_NOT_RUNNING ((HRESULT)0x88890010)
#endif

static const GUID ECHO_SUBTYPE_PCM = {
    0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

static const GUID ECHO_SUBTYPE_IEEE_FLOAT = {
    0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}
};

typedef enum wasapi_shared_sample_format {
    WASAPI_SHARED_FORMAT_FLOAT32 = 0,
    WASAPI_SHARED_FORMAT_PCM24_IN_32,
    WASAPI_SHARED_FORMAT_PCM32,
    WASAPI_SHARED_FORMAT_PCM24,
    WASAPI_SHARED_FORMAT_PCM16
} wasapi_shared_sample_format;

typedef struct wasapi_shared_format_desc {
    WAVEFORMATEXTENSIBLE wave;
    wasapi_shared_sample_format kind;
    const char* name;
} wasapi_shared_format_desc;

class DeviceWatcher;
class SessionWatcher;

struct wasapi_shared_runtime {
    IAudioClient* audioClient;
    IAudioRenderClient* renderClient;
    IMMDeviceEnumerator* deviceEnumerator;
    DeviceWatcher* deviceWatcher;
    IAudioSessionControl* sessionControl;
    SessionWatcher* sessionWatcher;
    HANDLE renderEvent;
    HANDLE stopEvent;
    HANDLE thread;
    HANDLE diagStopEvent;
    HANDLE diagThread;
    uint32_t sampleRate;
    uint32_t channels;
    uint32_t bufferFrameCount;
    uint32_t bytesPerFrame;
    uint32_t requestedBufferFrames;
    wasapi_shared_format_desc format;
    wasapi_render_callback callback;
    void* userData;
    wasapi_host_notification_callback notificationCallback;
    void* notificationUserData;
    wchar_t deviceId[512];
    char targetDeviceName[512];
    int targetDeviceIndex;
    int followsDefaultDevice;
    volatile LONG renderFailed;
    int comNeedsUninit;
    bool audioClientLeakedOnTimeout;
    float* scratch;
    size_t scratchSampleCapacity;
    DWORD testInvalidateAfterMs;
    ULONGLONG renderStartedAtMs;
    int testInvalidationTriggered;
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

static void register_device_watcher(wasapi_shared_runtime* runtime) {
    if (runtime == NULL || runtime->notificationCallback == NULL) return;

    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        NULL,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        (void**)&runtime->deviceEnumerator);
    if (FAILED(hr) || runtime->deviceEnumerator == NULL) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared notification enumerator failed hr=0x%08lx\n", (unsigned long)hr);
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
        fprintf(stderr, "[echo-audio-host] WASAPI shared device watcher registration failed hr=0x%08lx\n", (unsigned long)hr);
        runtime->deviceWatcher->Release();
        runtime->deviceWatcher = NULL;
        runtime->deviceEnumerator->Release();
        runtime->deviceEnumerator = NULL;
    }
}

static void register_session_watcher(wasapi_shared_runtime* runtime) {
    if (runtime == NULL || runtime->notificationCallback == NULL || runtime->audioClient == NULL) return;

    runtime->sessionWatcher = new (std::nothrow) SessionWatcher(
        runtime->deviceId,
        runtime->followsDefaultDevice,
        runtime->notificationCallback,
        runtime->notificationUserData);
    if (runtime->sessionWatcher == NULL) return;

    HRESULT hr = runtime->audioClient->GetService(__uuidof(IAudioSessionControl), (void**)&runtime->sessionControl);
    if (FAILED(hr) || runtime->sessionControl == NULL) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared session control failed hr=0x%08lx\n", (unsigned long)hr);
        runtime->sessionWatcher->Release();
        runtime->sessionWatcher = NULL;
        return;
    }

    hr = runtime->sessionControl->RegisterAudioSessionNotification(runtime->sessionWatcher);
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared session watcher registration failed hr=0x%08lx\n", (unsigned long)hr);
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

static void unregister_watchers(wasapi_shared_runtime* runtime) {
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

static HRESULT activate_audio_client(IMMDevice* device, IAudioClient** outClient) {
    return echo_wasapi_timeout::activate_audio_client_with_timeout(device, outClient);
}

static bool is_recoverable_shared_client_error(HRESULT hr) {
    return hr == AUDCLNT_E_DEVICE_INVALIDATED
        || hr == AUDCLNT_E_RESOURCES_INVALIDATED
        || hr == AUDCLNT_E_SERVICE_NOT_RUNNING;
}

static const DWORD kSharedRebuildRetryDelaysMs[] = { 200, 500, 1000 };
static const uint32_t kSharedRebuildRetryCount =
    (uint32_t)(sizeof(kSharedRebuildRetryDelaysMs) / sizeof(kSharedRebuildRetryDelaysMs[0]));

static void schedule_shared_rebuild(
    const char* phase,
    HRESULT hr,
    bool* rebuildPending,
    uint32_t* nextAttemptIndex,
    ULONGLONG* nextAttemptAtMs) {
    if (rebuildPending == NULL || nextAttemptIndex == NULL || nextAttemptAtMs == NULL) return;

    if (!*rebuildPending) {
        *rebuildPending = true;
        *nextAttemptIndex = 0;
        *nextAttemptAtMs = GetTickCount64() + kSharedRebuildRetryDelaysMs[0];
    }

    fprintf(
        stderr,
        "[echo-audio-host] WASAPI shared %s reported recoverable error hr=0x%08lx; scheduling audio client rebuild\n",
        phase != NULL ? phase : "render",
        (unsigned long)hr);
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

static bool is_guid_equal(const GUID& left, const GUID& right) {
    return IsEqualGUID(left, right) != 0;
}

static int describe_mix_format(const WAVEFORMATEX* mixFormat, wasapi_shared_format_desc* out) {
    if (mixFormat == NULL || out == NULL) return 0;
    if (mixFormat->nChannels == 0 || mixFormat->nChannels > 8) return 0;
    if (mixFormat->nBlockAlign == 0 || mixFormat->nSamplesPerSec == 0) return 0;

    memset(out, 0, sizeof(*out));

    const WORD tag = mixFormat->wFormatTag;
    WORD containerBits = mixFormat->wBitsPerSample;
    WORD validBits = mixFormat->wBitsPerSample;
    GUID subFormat = ECHO_SUBTYPE_PCM;

    if (tag == WAVE_FORMAT_EXTENSIBLE) {
        const WAVEFORMATEXTENSIBLE* extensible = (const WAVEFORMATEXTENSIBLE*)mixFormat;
        containerBits = extensible->Format.wBitsPerSample;
        validBits = extensible->Samples.wValidBitsPerSample != 0
            ? extensible->Samples.wValidBitsPerSample
            : extensible->Format.wBitsPerSample;
        subFormat = extensible->SubFormat;
        memcpy(&out->wave, extensible, sizeof(WAVEFORMATEXTENSIBLE));
    } else {
        out->wave.Format = *mixFormat;
        out->wave.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
        out->wave.Format.cbSize = (WORD)(sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX));
        out->wave.Samples.wValidBitsPerSample = validBits;
        out->wave.dwChannelMask = mixFormat->nChannels == 1
            ? SPEAKER_FRONT_CENTER
            : (mixFormat->nChannels == 2 ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT) : 0);
        out->wave.SubFormat = tag == WAVE_FORMAT_IEEE_FLOAT ? ECHO_SUBTYPE_IEEE_FLOAT : ECHO_SUBTYPE_PCM;
        subFormat = out->wave.SubFormat;
    }

    if (is_guid_equal(subFormat, ECHO_SUBTYPE_IEEE_FLOAT) && containerBits == 32) {
        out->kind = WASAPI_SHARED_FORMAT_FLOAT32;
        out->name = "float32";
        return 1;
    }

    if (! is_guid_equal(subFormat, ECHO_SUBTYPE_PCM)) return 0;

    if (containerBits == 32 && validBits == 24) {
        out->kind = WASAPI_SHARED_FORMAT_PCM24_IN_32;
        out->name = "pcm24in32";
        return 1;
    }

    if (containerBits == 32 && validBits == 32) {
        out->kind = WASAPI_SHARED_FORMAT_PCM32;
        out->name = "pcm32";
        return 1;
    }

    if (containerBits == 24 && validBits == 24) {
        out->kind = WASAPI_SHARED_FORMAT_PCM24;
        out->name = "pcm24";
        return 1;
    }

    if (containerBits == 16 && validBits == 16) {
        out->kind = WASAPI_SHARED_FORMAT_PCM16;
        out->name = "pcm16";
        return 1;
    }

    return 0;
}

static uint32_t shared_mix_rate(IMMDevice* device, bool* activateTimedOut) {
    IAudioClient* audioClient = NULL;
    WAVEFORMATEX* mixFormat = NULL;
    uint32_t sampleRate = 0;
    HRESULT hr;

    if (activateTimedOut != NULL) *activateTimedOut = false;

    hr = activate_audio_client(device, &audioClient);
    if (hr == E_PENDING) {
        if (activateTimedOut != NULL) *activateTimedOut = true;
        return 0;
    }
    if (FAILED(hr)) return 0;
    if (SUCCEEDED(audioClient->GetMixFormat(&mixFormat)) && mixFormat != NULL) {
        sampleRate = mixFormat->nSamplesPerSec;
    }

    if (mixFormat != NULL) CoTaskMemFree(mixFormat);
    audioClient->Release();
    return sampleRate;
}

static uint32_t shared_mix_channels(IMMDevice* device, bool* activateTimedOut) {
    IAudioClient* audioClient = NULL;
    WAVEFORMATEX* mixFormat = NULL;
    uint32_t channels = 0;
    HRESULT hr;

    if (activateTimedOut != NULL) *activateTimedOut = false;

    hr = activate_audio_client(device, &audioClient);
    if (hr == E_PENDING) {
        if (activateTimedOut != NULL) *activateTimedOut = true;
        return 0;
    }
    if (FAILED(hr)) return 0;
    if (SUCCEEDED(audioClient->GetMixFormat(&mixFormat)) && mixFormat != NULL) {
        channels = mixFormat->nChannels;
    }

    if (mixFormat != NULL) CoTaskMemFree(mixFormat);
    audioClient->Release();
    return channels;
}

static int enumerate_devices(std::vector<wasapi_shared_device_info>& devices, char* error, size_t errorLen) {
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
        wasapi_shared_device_info info;
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
        bool activateTimedOut = false;
        info.sharedSampleRate = shared_mix_rate(device, &activateTimedOut);
        if (activateTimedOut) {
            set_error(error, errorLen, "WASAPI Activate timed out", S_OK);
            CoTaskMemFree(id);
            device->Release();
            if (defaultId != NULL) CoTaskMemFree(defaultId);
            if (defaultDevice != NULL) defaultDevice->Release();
            collection->Release();
            enumerator->Release();
            return echo_audio_host::kExitDeviceInitializeTimeout;
        }

        info.channels = shared_mix_channels(device, &activateTimedOut);
        if (activateTimedOut) {
            set_error(error, errorLen, "WASAPI Activate timed out", S_OK);
            CoTaskMemFree(id);
            device->Release();
            if (defaultId != NULL) CoTaskMemFree(defaultId);
            if (defaultDevice != NULL) defaultDevice->Release();
            collection->Release();
            enumerator->Release();
            return echo_audio_host::kExitDeviceInitializeTimeout;
        }
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

int wasapi_shared_list_devices(wasapi_shared_device_info** outDevices, uint32_t* outCount) {
    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    com_scope com = com_scope_enter();
    if (FAILED(com.hr)) return -1;

    std::vector<wasapi_shared_device_info> devices;
    int result = enumerate_devices(devices, NULL, 0);
    if (result == 0 && !devices.empty()) {
        wasapi_shared_device_info* copy = (wasapi_shared_device_info*)calloc(devices.size(), sizeof(wasapi_shared_device_info));
        if (copy == NULL) {
            result = -1;
        } else {
            memcpy(copy, devices.data(), devices.size() * sizeof(wasapi_shared_device_info));
            *outDevices = copy;
            *outCount = (uint32_t)devices.size();
        }
    }

    com_scope_leave(&com);
    return result;
}

void wasapi_shared_free_devices(wasapi_shared_device_info* devices) {
    free(devices);
}

static IMMDevice* resolve_device(
    const std::vector<wasapi_shared_device_info>& devices,
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
            set_error(error, errorLen, "Invalid WASAPI shared device index", S_OK);
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
        set_error(error, errorLen, "Failed to resolve WASAPI shared endpoint", hr);
        device = NULL;
    }

    enumerator->Release();
    return device;
}

static REFERENCE_TIME frames_to_hns(uint32_t frames, uint32_t sampleRate) {
    if (sampleRate == 0) return 0;
    return (REFERENCE_TIME)((10000000.0 * (double)frames / (double)sampleRate) + 0.5);
}

static int prime_shared_buffer(
    IAudioClient* audioClient,
    IAudioRenderClient* renderClient,
    uint32_t bufferFrameCount,
    uint32_t bytesPerFrame) {
    if (audioClient == NULL || renderClient == NULL || bufferFrameCount == 0 || bytesPerFrame == 0) return -1;

    UINT32 padding = 0;
    HRESULT hr = audioClient->GetCurrentPadding(&padding);
    if (FAILED(hr)) return -1;

    if (padding >= bufferFrameCount) return 0;

    UINT32 framesAvailable = bufferFrameCount - padding;
    BYTE* endpointBuffer = NULL;
    hr = renderClient->GetBuffer(framesAvailable, &endpointBuffer);
    if (FAILED(hr)) return -1;

    memset(endpointBuffer, 0, (size_t)framesAvailable * bytesPerFrame);
    hr = renderClient->ReleaseBuffer(framesAvailable, AUDCLNT_BUFFERFLAGS_SILENT);
    return SUCCEEDED(hr) ? 0 : -1;
}

static void release_audio_client_pair(IAudioClient* audioClient, IAudioRenderClient* renderClient, bool leakedOnTimeout = false) {
    if (leakedOnTimeout) {
        return;
    }
    if (audioClient != NULL) {
        audioClient->Stop();
    }
    if (renderClient != NULL) {
        renderClient->Release();
    }
    if (audioClient != NULL) {
        audioClient->Release();
    }
}

static int rebuild_audio_client(wasapi_shared_runtime* runtime) {
    std::vector<wasapi_shared_device_info> devices;
    IMMDevice* device = NULL;
    IAudioClient* audioClient = NULL;
    IAudioRenderClient* renderClient = NULL;
    WAVEFORMATEX* mixFormat = NULL;
    WAVEFORMATEX* closestMatch = NULL;
    wasapi_shared_format_desc format;
    uint32_t bufferFrames = 0;
    char error[512] = {0};
    int result = -1;
    bool leakedOnTimeout = false;

    if (runtime == NULL || runtime->renderEvent == NULL || runtime->stopEvent == NULL) return -1;
    if (WaitForSingleObject(runtime->stopEvent, 0) == WAIT_OBJECT_0) return -1;

    if (enumerate_devices(devices, error, sizeof(error)) != 0 || devices.empty()) {
        fprintf(stderr,
            "[echo-audio-host] WASAPI shared rebuild could not enumerate devices: %s\n",
            error[0] != '\0' ? error : "no active render endpoints");
        goto done;
    }

    device = resolve_device(
        devices,
        runtime->targetDeviceName[0] != '\0' ? runtime->targetDeviceName : NULL,
        runtime->targetDeviceIndex,
        error,
        sizeof(error));
    if (device == NULL) {
        fprintf(stderr,
            "[echo-audio-host] WASAPI shared rebuild could not resolve endpoint: %s\n",
            error[0] != '\0' ? error : "unknown endpoint error");
        goto done;
    }

    HRESULT hr = activate_audio_client(device, &audioClient);
    if (hr == E_PENDING) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Activate timed out\n");
        fflush(stderr);
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        leakedOnTimeout = true;
        goto done;
    }
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Activate failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    hr = audioClient->GetMixFormat(&mixFormat);
    if (FAILED(hr) || mixFormat == NULL) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild GetMixFormat failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    if (!describe_mix_format(mixFormat, &format)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild unsupported mix format\n");
        goto done;
    }

    hr = audioClient->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, (WAVEFORMATEX*)&format.wave, &closestMatch);
    if (hr != S_OK) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild mix format unsupported hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    REFERENCE_TIME bufferDuration = runtime->requestedBufferFrames > 0
        ? frames_to_hns(runtime->requestedBufferFrames, format.wave.Format.nSamplesPerSec)
        : 0;
    hr = echo_wasapi_timeout::initialize_with_timeout(
        audioClient,
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST,
        bufferDuration,
        0,
        (WAVEFORMATEX*)&format.wave,
        NULL);
    if (hr == E_PENDING) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Initialize timed out\n");
        fflush(stderr);
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        leakedOnTimeout = true;
        goto done;
    }
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Initialize failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    UINT32 rawBufferFrames = 0;
    hr = audioClient->GetBufferSize(&rawBufferFrames);
    if (FAILED(hr) || rawBufferFrames == 0) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild GetBufferSize failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }
    bufferFrames = rawBufferFrames;

    hr = audioClient->GetService(__uuidof(IAudioRenderClient), (void**)&renderClient);
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild GetService(IAudioRenderClient) failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    hr = audioClient->SetEventHandle(runtime->renderEvent);
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild SetEventHandle failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    if (prime_shared_buffer(audioClient, renderClient, bufferFrames, format.wave.Format.nBlockAlign) != 0) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild prime buffer failed\n");
        goto done;
    }

    hr = echo_wasapi_timeout::start_with_timeout(audioClient);
    if (hr == E_PENDING) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Start timed out\n");
        fflush(stderr);
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        leakedOnTimeout = true;
        goto done;
    }
    if (FAILED(hr)) {
        fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild Start failed hr=0x%08lx\n", (unsigned long)hr);
        goto done;
    }

    unregister_watchers(runtime);
    release_audio_client_pair(runtime->audioClient, runtime->renderClient, runtime->audioClientLeakedOnTimeout);

    runtime->audioClient = audioClient;
    runtime->renderClient = renderClient;
    runtime->audioClientLeakedOnTimeout = false;
    runtime->sampleRate = format.wave.Format.nSamplesPerSec;
    runtime->channels = format.wave.Format.nChannels;
    runtime->bufferFrameCount = bufferFrames;
    runtime->bytesPerFrame = format.wave.Format.nBlockAlign;
    runtime->format = format;
    copy_device_id(device, runtime->deviceId, sizeof(runtime->deviceId) / sizeof(runtime->deviceId[0]));
    register_device_watcher(runtime);
    register_session_watcher(runtime);

    audioClient = NULL;
    renderClient = NULL;
    result = 0;

    fprintf(stderr,
        "[echo-audio-host] WASAPI shared audio client rebuilt sampleRate=%u channels=%u bufferFrames=%u format=%s\n",
        (unsigned int)runtime->sampleRate,
        (unsigned int)runtime->channels,
        (unsigned int)runtime->bufferFrameCount,
        runtime->format.name != NULL ? runtime->format.name : "unknown");

done:
    if (closestMatch != NULL) CoTaskMemFree(closestMatch);
    if (mixFormat != NULL) CoTaskMemFree(mixFormat);
    release_audio_client_pair(audioClient, renderClient, leakedOnTimeout);
    if (device != NULL) device->Release();
    return result;
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
    const wasapi_shared_format_desc* format) {
    uint32_t total = frames * channels;

    switch (format->kind) {
        case WASAPI_SHARED_FORMAT_FLOAT32:
            memcpy(output, input, (size_t)total * sizeof(float));
            break;
        case WASAPI_SHARED_FORMAT_PCM24_IN_32: {
            int32_t* dst = (int32_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                int32_t v = (int32_t)(s * 8388607.0f);
                dst[i] = v << 8;
            }
            break;
        }
        case WASAPI_SHARED_FORMAT_PCM32: {
            int32_t* dst = (int32_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                dst[i] = (int32_t)(s * 2147483647.0f);
            }
            break;
        }
        case WASAPI_SHARED_FORMAT_PCM24: {
            uint8_t* dst = (uint8_t*)output;
            for (uint32_t i = 0; i < total; ++i) {
                float s = clamp_sample(input[i]);
                int32_t v = (int32_t)(s * 8388607.0f);
                dst[i * 3 + 0] = (uint8_t)(v & 0xff);
                dst[i * 3 + 1] = (uint8_t)((v >> 8) & 0xff);
                dst[i * 3 + 2] = (uint8_t)((v >> 16) & 0xff);
            }
            break;
        }
        case WASAPI_SHARED_FORMAT_PCM16:
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

static DWORD WINAPI diag_drain_thread_proc(void* param) {
    wasapi_shared_runtime* runtime = (wasapi_shared_runtime*)param;
    if (runtime == NULL || runtime->diagStopEvent == NULL) return 1;

    while (WaitForSingleObject(runtime->diagStopEvent, 1000) == WAIT_TIMEOUT) {
        diag_drain_to_stderr();
    }

    diag_drain_to_stderr();
    return 0;
}

static DWORD WINAPI render_thread_proc(void* param) {
    wasapi_shared_runtime* runtime = (wasapi_shared_runtime*)param;
    DWORD taskIndex = 0;
    HANDLE avrtHandle = NULL;
    HANDLE waits[2];
    com_scope com = com_scope_enter();
    bool rebuildPending = false;
    uint32_t nextRebuildAttemptIndex = 0;
    ULONGLONG nextRebuildAttemptAtMs = 0;
    ULONGLONG lastDiagDrainMs = GetTickCount64();

    if (FAILED(com.hr)) {
        InterlockedExchange(&runtime->renderFailed, 1);
        return 1;
    }

    avrtHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    waits[0] = runtime->stopEvent;
    waits[1] = runtime->renderEvent;
    runtime->renderStartedAtMs = GetTickCount64();

    while (1) {
        const ULONGLONG drainNowMs = GetTickCount64();
        if (runtime->diagThread == NULL && drainNowMs - lastDiagDrainMs >= 1000) {
            diag_drain_to_stderr();
            lastDiagDrainMs = drainNowMs;
        }

        DWORD waitTimeout = INFINITE;
        if (rebuildPending) {
            const ULONGLONG nowMs = GetTickCount64();
            waitTimeout = nowMs >= nextRebuildAttemptAtMs
                ? 0
                : (DWORD)std::min<ULONGLONG>(nextRebuildAttemptAtMs - nowMs, 1000);
        }

        DWORD waitResult = WaitForMultipleObjects(2, waits, FALSE, waitTimeout);
        if (waitResult == WAIT_OBJECT_0) break;
        if (rebuildPending) {
            const ULONGLONG nowMs = GetTickCount64();
            if (waitResult == WAIT_TIMEOUT || nowMs >= nextRebuildAttemptAtMs) {
                const uint32_t attemptNumber = nextRebuildAttemptIndex + 1;
                fprintf(
                    stderr,
                    "[echo-audio-host] WASAPI shared rebuild retry %u/%u\n",
                    (unsigned int)attemptNumber,
                    (unsigned int)kSharedRebuildRetryCount);

                const int rebuildResult = rebuild_audio_client(runtime);
                if (rebuildResult == 0) {
                    rebuildPending = false;
                    nextRebuildAttemptIndex = 0;
                    nextRebuildAttemptAtMs = 0;
                    continue;
                }

                if (rebuildResult == echo_audio_host::kExitDeviceInitializeTimeout) {
                    fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild timed out; failing render thread\n");
                    InterlockedExchange(&runtime->renderFailed, 1);
                    break;
                }

                nextRebuildAttemptIndex++;
                if (nextRebuildAttemptIndex >= kSharedRebuildRetryCount) {
                    fprintf(stderr, "[echo-audio-host] WASAPI shared rebuild retries exhausted; failing render thread\n");
                    InterlockedExchange(&runtime->renderFailed, 1);
                    break;
                }
                nextRebuildAttemptAtMs = GetTickCount64() + kSharedRebuildRetryDelaysMs[nextRebuildAttemptIndex];
                continue;
            }
            if (waitResult == WAIT_OBJECT_0 + 1) {
                continue;
            }
        }
        if (waitResult != WAIT_OBJECT_0 + 1) {
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        if (
            runtime->testInvalidateAfterMs > 0 &&
            !runtime->testInvalidationTriggered &&
            GetTickCount64() - runtime->renderStartedAtMs >= runtime->testInvalidateAfterMs) {
            runtime->testInvalidationTriggered = 1;
            schedule_shared_rebuild(
                "test-invalidation",
                AUDCLNT_E_DEVICE_INVALIDATED,
                &rebuildPending,
                &nextRebuildAttemptIndex,
                &nextRebuildAttemptAtMs);
            continue;
        }

        UINT32 padding = 0;
        HRESULT hr = runtime->audioClient->GetCurrentPadding(&padding);
        if (FAILED(hr)) {
            if (is_recoverable_shared_client_error(hr)) {
                schedule_shared_rebuild(
                    "GetCurrentPadding",
                    hr,
                    &rebuildPending,
                    &nextRebuildAttemptIndex,
                    &nextRebuildAttemptAtMs);
                continue;
            }
            diag_push(DiagTag::GetCurrentPaddingFailed, hr, 0);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        if (padding >= runtime->bufferFrameCount) continue;
        UINT32 framesAvailable = runtime->bufferFrameCount - padding;
        if (framesAvailable == 0) continue;

        BYTE* endpointBuffer = NULL;
        hr = runtime->renderClient->GetBuffer(framesAvailable, &endpointBuffer);
        if (FAILED(hr)) {
            if (is_recoverable_shared_client_error(hr)) {
                schedule_shared_rebuild(
                    "GetBuffer",
                    hr,
                    &rebuildPending,
                    &nextRebuildAttemptIndex,
                    &nextRebuildAttemptAtMs);
                continue;
            }
            diag_push(DiagTag::GetBufferFailed, hr, framesAvailable);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }

        const size_t scratchSamples = (size_t)framesAvailable * runtime->channels;
        if (runtime->scratch == NULL || runtime->scratchSampleCapacity < scratchSamples) {
            diag_push(DiagTag::ScratchTooSmall, HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER), framesAvailable);
            runtime->renderClient->ReleaseBuffer(framesAvailable, AUDCLNT_BUFFERFLAGS_SILENT);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }
        memset(runtime->scratch, 0, scratchSamples * sizeof(float));
        if (runtime->callback != NULL) {
            runtime->callback(runtime->userData, runtime->scratch, framesAvailable, runtime->channels);
        }
        convert_float_to_endpoint(
            runtime->scratch,
            endpointBuffer,
            framesAvailable,
            runtime->channels,
            &runtime->format);

        hr = runtime->renderClient->ReleaseBuffer(framesAvailable, 0);
        if (FAILED(hr)) {
            if (is_recoverable_shared_client_error(hr)) {
                schedule_shared_rebuild(
                    "ReleaseBuffer",
                    hr,
                    &rebuildPending,
                    &nextRebuildAttemptIndex,
                    &nextRebuildAttemptAtMs);
                continue;
            }
            diag_push(DiagTag::ReleaseBufferFailed, hr, framesAvailable);
            InterlockedExchange(&runtime->renderFailed, 1);
            break;
        }
    }

    if (runtime->diagThread == NULL) {
        diag_drain_to_stderr();
    }
    if (avrtHandle != NULL) AvRevertMmThreadCharacteristics(avrtHandle);
    com_scope_leave(&com);
    return InterlockedCompareExchange(&runtime->renderFailed, 0, 0) ? 1 : 0;
}

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
    size_t errorLen) {
    com_scope com = com_scope_enter();
    std::vector<wasapi_shared_device_info> devices;
    IMMDevice* device = NULL;
    IAudioClient* audioClient = NULL;
    IAudioRenderClient* renderClient = NULL;
    WAVEFORMATEX* mixFormat = NULL;
    WAVEFORMATEX* closestMatch = NULL;
    wasapi_shared_format_desc format;
    uint32_t bufferFrames = 0;
    wasapi_shared_runtime* runtime = NULL;
    BYTE* endpointBuffer = NULL;
    HRESULT hr;
    int result = -1;

    (void)sourceChannels;

    if (outRuntime == NULL || outInfo == NULL || callback == NULL) return -1;
    *outRuntime = NULL;
    memset(outInfo, 0, sizeof(*outInfo));
    if (error != NULL && errorLen > 0) error[0] = '\0';

    if (FAILED(com.hr)) {
        set_error(error, errorLen, "Failed to initialize COM", com.hr);
        return -1;
    }

    const bool useDefaultDevice = (targetDeviceName == NULL || targetDeviceName[0] == '\0') && targetDeviceIndex < 0;
    if (! useDefaultDevice) {
        const int enumerateResult = enumerate_devices(devices, error, errorLen);
        if (enumerateResult != 0) {
            com_scope_leave(&com);
            return enumerateResult;
        }
        if (devices.empty()) {
            com_scope_leave(&com);
            return -1;
        }
    }

    device = resolve_device(devices, targetDeviceName, targetDeviceIndex, error, errorLen);
    if (device == NULL) {
        com_scope_leave(&com);
        return -1;
    }

    hr = activate_audio_client(device, &audioClient);
    if (hr == E_PENDING) {
        set_error(error, errorLen, "WASAPI Activate timed out", S_OK);
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        goto done;
    }
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to activate IAudioClient", hr);
        goto done;
    }

    hr = audioClient->GetMixFormat(&mixFormat);
    if (FAILED(hr) || mixFormat == NULL) {
        set_error(error, errorLen, "Failed to get WASAPI shared mix format", hr);
        goto done;
    }

    if (! describe_mix_format(mixFormat, &format)) {
        set_error(error, errorLen, "Unsupported WASAPI shared mix format", S_OK);
        result = -4;
        goto done;
    }

    if (requestedSampleRate != 0 && requestedSampleRate != format.wave.Format.nSamplesPerSec) {
        fprintf(stderr,
            "[echo-audio-host] WASAPI shared using endpoint mix rate %u instead of requested %u\n",
            (unsigned int)format.wave.Format.nSamplesPerSec,
            (unsigned int)requestedSampleRate);
    }

    hr = audioClient->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, (WAVEFORMATEX*)&format.wave, &closestMatch);
    if (hr != S_OK) {
        set_error(error, errorLen, "WASAPI shared mix format unsupported", hr);
        result = -4;
        goto done;
    }

    REFERENCE_TIME bufferDuration = requestedBufferFrames > 0
        ? frames_to_hns(requestedBufferFrames, format.wave.Format.nSamplesPerSec)
        : 0;
    hr = echo_wasapi_timeout::initialize_with_timeout(
        audioClient,
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST,
        bufferDuration,
        0,
        (WAVEFORMATEX*)&format.wave,
        NULL);
    if (hr == E_PENDING) {
        set_error(error, errorLen, "WASAPI Initialize timed out", S_OK);
        result = echo_audio_host::kExitDeviceInitializeTimeout;
        goto done;
    }
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to initialize WASAPI shared client", hr);
        goto done;
    }

    UINT32 rawBufferFrames = 0;
    hr = audioClient->GetBufferSize(&rawBufferFrames);
    if (FAILED(hr) || rawBufferFrames == 0) {
        set_error(error, errorLen, "Failed to get WASAPI shared buffer size", hr);
        goto done;
    }
    bufferFrames = rawBufferFrames;

    hr = audioClient->GetService(__uuidof(IAudioRenderClient), (void**)&renderClient);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to get IAudioRenderClient", hr);
        goto done;
    }

    runtime = (wasapi_shared_runtime*)calloc(1, sizeof(wasapi_shared_runtime));
    if (runtime == NULL) {
        set_error(error, errorLen, "Failed to allocate WASAPI shared runtime", S_OK);
        goto done;
    }

    runtime->audioClient = audioClient;
    runtime->renderClient = renderClient;
    runtime->sampleRate = format.wave.Format.nSamplesPerSec;
    runtime->channels = format.wave.Format.nChannels;
    runtime->bufferFrameCount = bufferFrames;
    runtime->bytesPerFrame = format.wave.Format.nBlockAlign;
    runtime->requestedBufferFrames = requestedBufferFrames;
    runtime->format = format;
    runtime->callback = callback;
    runtime->userData = userData;
    runtime->notificationCallback = notificationCallback;
    runtime->notificationUserData = notificationUserData;
    runtime->targetDeviceIndex = targetDeviceIndex;
    runtime->testInvalidateAfterMs = echo_wasapi_timeout::read_test_hang_ms("ECHO_TEST_WASAPI_SHARED_INVALIDATE_AFTER_MS");
    if (targetDeviceName != NULL && targetDeviceName[0] != '\0') {
        snprintf(runtime->targetDeviceName, sizeof(runtime->targetDeviceName), "%s", targetDeviceName);
    }
    runtime->followsDefaultDevice = (targetDeviceIndex < 0 && (targetDeviceName == NULL || targetDeviceName[0] == '\0')) ? 1 : 0;
    copy_device_id(device, runtime->deviceId, sizeof(runtime->deviceId) / sizeof(runtime->deviceId[0]));
    runtime->comNeedsUninit = com.needsUninit;
    runtime->scratchSampleCapacity = (size_t)runtime->bufferFrameCount * runtime->channels;
    runtime->scratch = (float*)calloc(runtime->scratchSampleCapacity, sizeof(float));
    if (runtime->scratch == NULL) {
        set_error(error, errorLen, "Failed to allocate WASAPI shared render scratch buffer", S_OK);
        goto done;
    }
    com.needsUninit = 0;
    audioClient = NULL;
    renderClient = NULL;

    runtime->renderEvent = CreateEventW(NULL, FALSE, FALSE, NULL);
    runtime->stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    runtime->diagStopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (runtime->renderEvent == NULL || runtime->stopEvent == NULL || runtime->diagStopEvent == NULL) {
        set_error(error, errorLen, "Failed to create WASAPI shared events", HRESULT_FROM_WIN32(GetLastError()));
        goto done;
    }

    runtime->diagThread = CreateThread(NULL, 0, diag_drain_thread_proc, runtime, 0, NULL);
    if (runtime->diagThread == NULL) {
        set_error(error, errorLen, "Failed to create WASAPI shared diagnostic drain thread", HRESULT_FROM_WIN32(GetLastError()));
        goto done;
    }

    hr = runtime->audioClient->SetEventHandle(runtime->renderEvent);
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to set WASAPI shared event handle", hr);
        goto done;
    }

    register_device_watcher(runtime);
    register_session_watcher(runtime);

    UINT32 padding = 0;
    hr = runtime->audioClient->GetCurrentPadding(&padding);
    if (SUCCEEDED(hr) && padding < runtime->bufferFrameCount) {
        UINT32 framesAvailable = runtime->bufferFrameCount - padding;
        endpointBuffer = NULL;
        hr = runtime->renderClient->GetBuffer(framesAvailable, &endpointBuffer);
        if (SUCCEEDED(hr)) {
            memset(endpointBuffer, 0, (size_t)framesAvailable * runtime->bytesPerFrame);
            hr = runtime->renderClient->ReleaseBuffer(framesAvailable, AUDCLNT_BUFFERFLAGS_SILENT);
        }
    }
    if (FAILED(hr)) {
        set_error(error, errorLen, "Failed to prime WASAPI shared buffer", hr);
        goto done;
    }

    runtime->thread = CreateThread(NULL, 0, render_thread_proc, runtime, 0, NULL);
    if (runtime->thread == NULL) {
        set_error(error, errorLen, "Failed to create WASAPI shared render thread", HRESULT_FROM_WIN32(GetLastError()));
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
        set_error(error, errorLen, "Failed to start WASAPI shared client", hr);
        goto done;
    }

    outInfo->sampleRate = runtime->sampleRate;
    outInfo->hardwareSampleRate = runtime->sampleRate;
    outInfo->channels = runtime->channels;
    outInfo->bufferFrameCount = runtime->bufferFrameCount;
    snprintf(outInfo->format, sizeof(outInfo->format), "%s", runtime->format.name);
    *outRuntime = runtime;
    runtime = NULL;
    result = 0;

done:
    if (closestMatch != NULL) CoTaskMemFree(closestMatch);
    if (mixFormat != NULL) CoTaskMemFree(mixFormat);
    if (runtime != NULL) {
        wasapi_shared_stop(runtime);
    }
    if (renderClient != NULL) renderClient->Release();
    if (audioClient != NULL && result != echo_audio_host::kExitDeviceInitializeTimeout) audioClient->Release();
    if (device != NULL) device->Release();
    if (result != echo_audio_host::kExitDeviceInitializeTimeout) com_scope_leave(&com);
    return result;
}

void wasapi_shared_stop(wasapi_shared_runtime* runtime) {
    if (runtime == NULL) return;

    if (runtime->stopEvent != NULL) SetEvent(runtime->stopEvent);
    if (runtime->thread != NULL) {
        DWORD waitResult = WaitForSingleObject(runtime->thread, 5000);
        if (waitResult != WAIT_OBJECT_0) {
            fprintf(stderr,
                "[echo-audio-host] WASAPI shared render thread did not stop in time; deferring resource release to process teardown\n");
            unregister_watchers(runtime);
            if (runtime->diagStopEvent != NULL) SetEvent(runtime->diagStopEvent);
            if (runtime->diagThread != NULL) {
                WaitForSingleObject(runtime->diagThread, 1000);
                CloseHandle(runtime->diagThread);
            }
            if (runtime->diagStopEvent != NULL) CloseHandle(runtime->diagStopEvent);
            CloseHandle(runtime->thread);
            return;
        }
        CloseHandle(runtime->thread);
    }
    if (runtime->diagStopEvent != NULL) SetEvent(runtime->diagStopEvent);
    if (runtime->diagThread != NULL) {
        WaitForSingleObject(runtime->diagThread, 1000);
        CloseHandle(runtime->diagThread);
    }
    unregister_watchers(runtime);
    if (runtime->audioClient != NULL && !runtime->audioClientLeakedOnTimeout) runtime->audioClient->Stop();
    if (runtime->renderEvent != NULL) CloseHandle(runtime->renderEvent);
    if (runtime->stopEvent != NULL) CloseHandle(runtime->stopEvent);
    if (runtime->diagStopEvent != NULL) CloseHandle(runtime->diagStopEvent);
    if (runtime->renderClient != NULL && !runtime->audioClientLeakedOnTimeout) runtime->renderClient->Release();
    if (runtime->audioClient != NULL && !runtime->audioClientLeakedOnTimeout) runtime->audioClient->Release();
    runtime->renderClient = NULL;
    runtime->audioClient = NULL;
    runtime->deviceWatcher = NULL;
    runtime->deviceEnumerator = NULL;
    runtime->sessionWatcher = NULL;
    runtime->sessionControl = NULL;
    if (runtime->comNeedsUninit && !runtime->audioClientLeakedOnTimeout) CoUninitialize();
    free(runtime->scratch);
    runtime->scratch = NULL;
    free(runtime);
}

#endif
