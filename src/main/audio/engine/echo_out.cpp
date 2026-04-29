/*
 * echo-audio-host — standalone audio output process for ECHO HiFi engine.
 *
 * Reads interleaved float32 PCM from stdin, outputs via miniaudio (WASAPI on
 * Windows).  Reports playback position on stdout as JSON lines so the parent
 * Node.js process can track time from the OUTPUT side (hardware clock), not the
 * input side (decoded bytes).
 *
 * Usage:
 *   echo-audio-host -sr 44100 -ch 2 [-exclusive] [-device-index N] [-device NAME] [-vol 1.0]
 *   echo-audio-host -list
 */

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <mmdeviceapi.h>
#include <propidl.h>
#ifdef __MINGW32__
#include <propkeydef.h>
#include <initguid.h>
DEFINE_PROPERTYKEY(PKEY_Device_FriendlyName, 0xa45c254e, 0xdf1c, 0x4efd, 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0, 14);
#else
#include <functiondiscoverykeys_devpkey.h>
#endif
#ifdef MA_ENABLE_ASIO
#include "asiosys.h"
#include "asio.h"
#include "asiodrivers.h"
extern AsioDrivers* asioDrivers;
bool loadAsioDriver(char* name);
#define MAX_ASIO_INPUT_CHANNELS 8
#define MAX_ASIO_OUTPUT_CHANNELS 8
#define MAX_ASIO_TOTAL_CHANNELS (MAX_ASIO_INPUT_CHANNELS + MAX_ASIO_OUTPUT_CHANNELS)
typedef struct asio_runtime {
    ASIODriverInfo driverInfo;
    ASIOCallbacks callbacks;
    ASIOBufferInfo bufferInfos[MAX_ASIO_TOTAL_CHANNELS];
    ASIOChannelInfo channelInfos[MAX_ASIO_TOTAL_CHANNELS];
    long inputChannelCount;
    long outputChannelCount;
    long totalChannelCount;
    long outputChannelOffset;
    long bufferSize;
    ASIOSampleRate sampleRate;
    ASIOBool postOutput;
    ma_uint32 streamChannels;
    float* scratch;
    HWND sysRefWindow;
} asio_runtime;
static asio_runtime g_asio;
#endif
#include "wasapi_exclusive.h"
#else
#include <time.h>
static void portable_sleep_ms(int ms) {
    struct timespec ts;
    ts.tv_sec = ms / 1000;
    ts.tv_nsec = (ms % 1000) * 1000000;
    nanosleep(&ts, NULL);
}
#endif

/* ── globals shared with the realtime audio callback ── */

ma_pcm_rb  g_rb;
volatile ma_uint64 g_framesConsumed = 0;
volatile float     g_volume         = 1.0f;
volatile int       g_stdinEOF       = 0;

/* ── helpers ── */

typedef struct listed_device {
    ma_device_id id;
    char name[512];
    ma_uint32 highestSampleRate;
    ma_bool32 isDefault;
} listed_device;

#ifdef _WIN32
static void wide_to_utf8(const wchar_t* wide, char* out, int out_len) {
    if (out == NULL || out_len <= 0) return;
    out[0] = '\0';
    if (wide == NULL || wide[0] == L'\0') return;

    if (WideCharToMultiByte(CP_UTF8, 0, wide, -1, out, out_len, NULL, NULL) <= 0) {
        out[0] = '\0';
    }
}

static void get_wasapi_device_friendly_name_utf8(const ma_device_id* deviceId, char* out, int out_len) {
    IMMDeviceEnumerator* enumerator = NULL;
    IMMDevice* device = NULL;
    IPropertyStore* props = NULL;
    PROPVARIANT value;
    const PROPERTYKEY friendlyNameKey = {
        {0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}},
        14
    };

    if (out == NULL || out_len <= 0) return;
    out[0] = '\0';
    if (deviceId == NULL || deviceId->wasapi[0] == L'\0') return;

    PropVariantInit(&value);

    if (CoCreateInstance(
            __uuidof(MMDeviceEnumerator),
            NULL,
            CLSCTX_ALL,
            __uuidof(IMMDeviceEnumerator),
            (void**)&enumerator) != S_OK) {
        goto done;
    }

    if (enumerator->GetDevice(deviceId->wasapi, &device) != S_OK) goto done;
    if (device->OpenPropertyStore(STGM_READ, &props) != S_OK) goto done;
    if (props->GetValue(friendlyNameKey, &value) != S_OK) goto done;
    if (value.vt != VT_LPWSTR || value.pwszVal == NULL) goto done;

    wide_to_utf8(value.pwszVal, out, out_len);

done:
    PropVariantClear(&value);
    if (props != NULL) props->Release();
    if (device != NULL) device->Release();
    if (enumerator != NULL) enumerator->Release();
}

static int is_valid_utf8(const char* s) {
    const unsigned char* p = (const unsigned char*)s;
    if (p == NULL) return 0;

    while (*p != '\0') {
        if (*p < 0x80) {
            p += 1;
        } else if ((*p & 0xE0) == 0xC0) {
            if ((p[1] & 0xC0) != 0x80 || *p < 0xC2) return 0;
            p += 2;
        } else if ((*p & 0xF0) == 0xE0) {
            if ((p[1] & 0xC0) != 0x80 || (p[2] & 0xC0) != 0x80) return 0;
            if (*p == 0xE0 && p[1] < 0xA0) return 0;
            if (*p == 0xED && p[1] >= 0xA0) return 0;
            p += 3;
        } else if ((*p & 0xF8) == 0xF0) {
            if ((p[1] & 0xC0) != 0x80 || (p[2] & 0xC0) != 0x80 || (p[3] & 0xC0) != 0x80) return 0;
            if (*p == 0xF0 && p[1] < 0x90) return 0;
            if (*p > 0xF4 || (*p == 0xF4 && p[1] >= 0x90)) return 0;
            p += 4;
        } else {
            return 0;
        }
    }

    return 1;
}

static void ansi_to_utf8(const char* ansi, char* out, int out_len) {
    if (out == NULL || out_len <= 0) return;
    out[0] = '\0';
    if (ansi == NULL || ansi[0] == '\0') return;

    int wlen = MultiByteToWideChar(CP_ACP, 0, ansi, -1, NULL, 0);
    if (wlen <= 0) {
        snprintf(out, (size_t)out_len, "%s", ansi);
        return;
    }

    wchar_t* wbuf = (wchar_t*)malloc((size_t)wlen * sizeof(wchar_t));
    if (wbuf == NULL) {
        snprintf(out, (size_t)out_len, "%s", ansi);
        return;
    }

    if (MultiByteToWideChar(CP_ACP, 0, ansi, -1, wbuf, wlen) <= 0) {
        free(wbuf);
        snprintf(out, (size_t)out_len, "%s", ansi);
        return;
    }

    if (WideCharToMultiByte(CP_UTF8, 0, wbuf, -1, out, out_len, NULL, NULL) <= 0) {
        snprintf(out, (size_t)out_len, "%s", ansi);
    }

    free(wbuf);
}
#endif

static void device_name_to_utf8(const char* src, char* out, int out_len) {
    if (out == NULL || out_len <= 0) return;
#ifdef _WIN32
    if (src != NULL && is_valid_utf8(src)) {
        snprintf(out, (size_t)out_len, "%s", src);
    } else {
        ansi_to_utf8(src, out, out_len);
    }
#else
    snprintf(out, (size_t)out_len, "%s", src != NULL ? src : "");
#endif
    out[out_len - 1] = '\0';
}

static ma_bool32 device_ids_equal(const ma_device_id* a, const ma_device_id* b) {
    if (a == NULL || b == NULL) return MA_FALSE;
    return memcmp(a, b, sizeof(ma_device_id)) == 0 ? MA_TRUE : MA_FALSE;
}

static ma_uint32 get_highest_sample_rate(const ma_device_info* info) {
    ma_uint32 highest = 0;
    if (info == NULL) return 0;

    for (ma_uint32 i = 0; i < info->nativeDataFormatCount; ++i) {
        ma_uint32 sampleRate = info->nativeDataFormats[i].sampleRate;
        if (sampleRate > highest) highest = sampleRate;
    }

    return highest;
}

static void probe_data_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount) {
    (void)pDevice;
    (void)pInput;
    if (pOutput != NULL) {
        memset(pOutput, 0, frameCount * 2 * sizeof(float));
    }
}

static ma_uint32 probe_highest_exclusive_sample_rate(ma_context* context, const ma_device_id* deviceId) {
    static const ma_uint32 rates[] = {
        768000, 705600, 384000, 352800, 192000, 176400, 96000, 88200, 48000, 44100
    };

    if (context == NULL || deviceId == NULL) return 0;

    for (size_t i = 0; i < sizeof(rates) / sizeof(rates[0]); ++i) {
        ma_device_config config = ma_device_config_init(ma_device_type_playback);
        ma_device device;
        ma_result result;

        memset(&device, 0, sizeof(device));
        config.playback.format = ma_format_f32;
        config.playback.channels = 2;
        config.playback.pDeviceID = deviceId;
        config.playback.shareMode = ma_share_mode_exclusive;
        config.sampleRate = rates[i];
        config.dataCallback = probe_data_callback;

        result = ma_device_init(context, &config, &device);
        if (result == MA_SUCCESS) {
            /* Use internalSampleRate (= true hw rate) instead of device.sampleRate
             * (= app-facing rate). In WASAPI exclusive, miniaudio always uses the
             * device's currently-configured "Default Format" (mmsys.cpl) and
             * silently inserts an internal SRC when the requested rate differs,
             * so device.sampleRate stays equal to rates[i] regardless of what
             * the hardware actually opens at. */
            ma_uint32 hwRate = device.playback.internalSampleRate > 0
                                ? device.playback.internalSampleRate
                                : (device.sampleRate > 0 ? device.sampleRate : rates[i]);
            ma_device_uninit(&device);
            if (hwRate == rates[i]) {
                return hwRate;
            }
        }
    }

    return 0;
}

static ma_uint32 get_highest_sample_rate_for_device(ma_context* context, const ma_device_info* info) {
    ma_uint32 highest = get_highest_sample_rate(info);
    ma_device_info detailed;
    ma_uint32 probedHighest;

    if (context == NULL || info == NULL) return highest;

    memset(&detailed, 0, sizeof(detailed));
    if (ma_context_get_device_info(context, ma_device_type_playback, &info->id, &detailed) == MA_SUCCESS) {
        ma_uint32 detailedHighest = get_highest_sample_rate(&detailed);
        if (detailedHighest > highest) highest = detailedHighest;
    }

    probedHighest = probe_highest_exclusive_sample_rate(context, &info->id);
    /* Probe is authoritative when it returns > 0: it represents the actual rate
     * the hardware will run at in exclusive mode given the current mmsys
     * "Default Format" setting. The native-format list (which we read above)
     * comes from IsFormatSupported() which is permissive and will happily say
     * "yes 192k is supported" even when mmsys is locked to 48k — which is the
     * exact misreport that started this whole mess. */
    if (probedHighest > 0) {
        return probedHighest;
    }

    return highest;
}

static int collect_unique_playback_devices(ma_context* context, listed_device** outDevices, ma_uint32* outCount) {
    ma_device_info* playbackInfos = NULL;
    ma_uint32 playbackCount = 0;
    listed_device* devices = NULL;
    ma_uint32 uniqueCount = 0;

    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    if (ma_context_get_devices(context, &playbackInfos, &playbackCount, NULL, NULL) != MA_SUCCESS) {
        return -1;
    }

    devices = (listed_device*)calloc((size_t)(playbackCount > 0 ? playbackCount : 1), sizeof(listed_device));
    if (devices == NULL) {
        return -1;
    }

    for (ma_uint32 i = 0; i < playbackCount; ++i) {
        char utf8Name[512];
        ma_uint32 highestSampleRate = get_highest_sample_rate_for_device(context, &playbackInfos[i]);
        ma_uint32 existingIndex = (ma_uint32)-1;

        utf8Name[0] = '\0';
#ifdef _WIN32
        get_wasapi_device_friendly_name_utf8(&playbackInfos[i].id, utf8Name, (int)sizeof(utf8Name));
#endif
        if (utf8Name[0] == '\0') {
            device_name_to_utf8(playbackInfos[i].name, utf8Name, (int)sizeof(utf8Name));
        }

        for (ma_uint32 j = 0; j < uniqueCount; ++j) {
            if (device_ids_equal(&devices[j].id, &playbackInfos[i].id) ||
                (devices[j].name[0] != '\0' && utf8Name[0] != '\0' && strcmp(devices[j].name, utf8Name) == 0)) {
                existingIndex = j;
                break;
            }
        }

        if (existingIndex != (ma_uint32)-1) {
            if (highestSampleRate > devices[existingIndex].highestSampleRate) {
                devices[existingIndex].highestSampleRate = highestSampleRate;
            }
            if (playbackInfos[i].isDefault) {
                devices[existingIndex].isDefault = MA_TRUE;
            }
            if (devices[existingIndex].name[0] == '\0' && utf8Name[0] != '\0') {
                snprintf(devices[existingIndex].name, sizeof(devices[existingIndex].name), "%s", utf8Name);
            }
            continue;
        }

        devices[uniqueCount].id = playbackInfos[i].id;
        devices[uniqueCount].highestSampleRate = highestSampleRate;
        devices[uniqueCount].isDefault = playbackInfos[i].isDefault;
        snprintf(devices[uniqueCount].name, sizeof(devices[uniqueCount].name), "%s", utf8Name);
        uniqueCount += 1;
    }

    *outDevices = devices;
    *outCount = uniqueCount;
    return 0;
}

static int collect_unique_playback_devices_fast(ma_context* context, listed_device** outDevices, ma_uint32* outCount) {
    ma_device_info* playbackInfos = NULL;
    ma_uint32 playbackCount = 0;
    listed_device* devices = NULL;
    ma_uint32 uniqueCount = 0;

    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    if (ma_context_get_devices(context, &playbackInfos, &playbackCount, NULL, NULL) != MA_SUCCESS) {
        return -1;
    }

    devices = (listed_device*)calloc((size_t)(playbackCount > 0 ? playbackCount : 1), sizeof(listed_device));
    if (devices == NULL) {
        return -1;
    }

    for (ma_uint32 i = 0; i < playbackCount; ++i) {
        char utf8Name[512];
        ma_uint32 existingIndex = (ma_uint32)-1;

        utf8Name[0] = '\0';
#ifdef _WIN32
        get_wasapi_device_friendly_name_utf8(&playbackInfos[i].id, utf8Name, (int)sizeof(utf8Name));
#endif
        if (utf8Name[0] == '\0') {
            device_name_to_utf8(playbackInfos[i].name, utf8Name, (int)sizeof(utf8Name));
        }

        for (ma_uint32 j = 0; j < uniqueCount; ++j) {
            if (device_ids_equal(&devices[j].id, &playbackInfos[i].id) ||
                (devices[j].name[0] != '\0' && utf8Name[0] != '\0' && strcmp(devices[j].name, utf8Name) == 0)) {
                existingIndex = j;
                break;
            }
        }

        if (existingIndex != (ma_uint32)-1) {
            if (playbackInfos[i].isDefault) {
                devices[existingIndex].isDefault = MA_TRUE;
            }
            if (devices[existingIndex].name[0] == '\0' && utf8Name[0] != '\0') {
                snprintf(devices[existingIndex].name, sizeof(devices[existingIndex].name), "%s", utf8Name);
            }
            continue;
        }

        devices[uniqueCount].id = playbackInfos[i].id;
        devices[uniqueCount].highestSampleRate = 0;
        devices[uniqueCount].isDefault = playbackInfos[i].isDefault;
        snprintf(devices[uniqueCount].name, sizeof(devices[uniqueCount].name), "%s", utf8Name);
        uniqueCount += 1;
    }

    *outDevices = devices;
    *outCount = uniqueCount;
    return 0;
}

static int collect_unique_playback_devices_by_name(ma_context* context, listed_device** outDevices, ma_uint32* outCount) {
    ma_device_info* playbackInfos = NULL;
    ma_uint32 playbackCount = 0;
    listed_device* devices = NULL;
    ma_uint32 uniqueCount = 0;

    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    if (ma_context_get_devices(context, &playbackInfos, &playbackCount, NULL, NULL) != MA_SUCCESS) {
        return -1;
    }

    devices = (listed_device*)calloc((size_t)(playbackCount > 0 ? playbackCount : 1), sizeof(listed_device));
    if (devices == NULL) {
        return -1;
    }

    for (ma_uint32 i = 0; i < playbackCount; ++i) {
        char utf8Name[512];
        ma_uint32 highestSampleRate = get_highest_sample_rate_for_device(context, &playbackInfos[i]);
        ma_uint32 existingIndex = (ma_uint32)-1;

        device_name_to_utf8(playbackInfos[i].name, utf8Name, (int)sizeof(utf8Name));
        if (utf8Name[0] == '\0') continue;

        for (ma_uint32 j = 0; j < uniqueCount; ++j) {
            if (strcmp(devices[j].name, utf8Name) == 0) {
                existingIndex = j;
                break;
            }
        }

        if (existingIndex != (ma_uint32)-1) {
            if (highestSampleRate > devices[existingIndex].highestSampleRate) {
                devices[existingIndex].highestSampleRate = highestSampleRate;
            }
            continue;
        }

        devices[uniqueCount].id = playbackInfos[i].id;
        devices[uniqueCount].highestSampleRate = highestSampleRate;
        snprintf(devices[uniqueCount].name, sizeof(devices[uniqueCount].name), "%s", utf8Name);
        uniqueCount += 1;
    }

    *outDevices = devices;
    *outCount = uniqueCount;
    return 0;
}

static int contains_icase(const char* haystack, const char* needle) {
    if (haystack == NULL || needle == NULL) return 0;
    size_t hLen = strlen(haystack);
    size_t nLen = strlen(needle);
    if (nLen == 0) return 1;
    if (hLen < nLen) return 0;
    for (size_t i = 0; i + nLen <= hLen; ++i) {
        size_t j = 0;
        while (j < nLen) {
            unsigned char hc = (unsigned char)haystack[i + j];
            unsigned char nc = (unsigned char)needle[j];
            if (tolower(hc) != tolower(nc)) break;
            ++j;
        }
        if (j == nLen) return 1;
    }
    return 0;
}

static void sleep_ms(int ms) {
#ifdef _WIN32
    Sleep(ms);
#else
    portable_sleep_ms(ms);
#endif
}

#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
static int collect_asio_playback_devices(listed_device** outDevices, ma_uint32* outCount) {
    const long maxDrivers = 64;
    char nameStorage[64][512];
    char* names[64];
    listed_device* devices = NULL;
    ma_uint32 uniqueCount = 0;
    AsioDrivers drivers;

    if (outDevices == NULL || outCount == NULL) return -1;
    *outDevices = NULL;
    *outCount = 0;

    for (long i = 0; i < maxDrivers; ++i) names[i] = nameStorage[i];

    long count = drivers.getDriverNames(names, maxDrivers);
    if (count <= 0) return 0;

    devices = (listed_device*)calloc((size_t)count, sizeof(listed_device));
    if (devices == NULL) return -1;

    for (long i = 0; i < count; ++i) {
        char utf8Name[512];
        ma_uint32 existingIndex = (ma_uint32)-1;

        device_name_to_utf8(names[i], utf8Name, (int)sizeof(utf8Name));
        if (utf8Name[0] == '\0') continue;

        for (ma_uint32 j = 0; j < uniqueCount; ++j) {
            if (strcmp(devices[j].name, utf8Name) == 0) {
                existingIndex = j;
                break;
            }
        }
        if (existingIndex != (ma_uint32)-1) continue;

        snprintf(devices[uniqueCount].name, sizeof(devices[uniqueCount].name), "%s", utf8Name);
        uniqueCount += 1;
    }

    *outDevices = devices;
    *outCount = uniqueCount;
    return 0;
}

static long clamp_long(long value, long minValue, long maxValue) {
    if (value < minValue) return minValue;
    if (value > maxValue) return maxValue;
    return value;
}

static float clamp_float_sample(float sample) {
    if (sample < -1.0f) return -1.0f;
    if (sample > 1.0f) return 1.0f;
    return sample;
}

static void write_u24_le(unsigned char* dst, int32_t value) {
    dst[0] = (unsigned char)(value & 0xFF);
    dst[1] = (unsigned char)((value >> 8) & 0xFF);
    dst[2] = (unsigned char)((value >> 16) & 0xFF);
}

static void write_u24_be(unsigned char* dst, int32_t value) {
    dst[0] = (unsigned char)((value >> 16) & 0xFF);
    dst[1] = (unsigned char)((value >> 8) & 0xFF);
    dst[2] = (unsigned char)(value & 0xFF);
}

static void write_u16_be(unsigned char* dst, uint16_t value) {
    dst[0] = (unsigned char)((value >> 8) & 0xFF);
    dst[1] = (unsigned char)(value & 0xFF);
}

static void write_u32_le(unsigned char* dst, uint32_t value) {
    dst[0] = (unsigned char)(value & 0xFF);
    dst[1] = (unsigned char)((value >> 8) & 0xFF);
    dst[2] = (unsigned char)((value >> 16) & 0xFF);
    dst[3] = (unsigned char)((value >> 24) & 0xFF);
}

static void write_u32_be(unsigned char* dst, uint32_t value) {
    dst[0] = (unsigned char)((value >> 24) & 0xFF);
    dst[1] = (unsigned char)((value >> 16) & 0xFF);
    dst[2] = (unsigned char)((value >> 8) & 0xFF);
    dst[3] = (unsigned char)(value & 0xFF);
}

static int asio_sample_type_supported(ASIOSampleType type) {
    switch (type) {
        case ASIOSTInt16LSB:
        case ASIOSTInt24LSB:
        case ASIOSTInt32LSB:
        case ASIOSTFloat32LSB:
        case ASIOSTFloat64LSB:
        case ASIOSTInt32LSB16:
        case ASIOSTInt32LSB18:
        case ASIOSTInt32LSB20:
        case ASIOSTInt32LSB24:
        case ASIOSTInt16MSB:
        case ASIOSTInt24MSB:
        case ASIOSTInt32MSB:
        case ASIOSTFloat32MSB:
        case ASIOSTFloat64MSB:
        case ASIOSTInt32MSB16:
        case ASIOSTInt32MSB18:
        case ASIOSTInt32MSB20:
        case ASIOSTInt32MSB24:
            return 1;
        default:
            return 0;
    }
}

static ASIOSampleRate asio_sample_rate_from_double(double value) {
    ASIOSampleRate rate;
    memset(&rate, 0, sizeof(rate));
    memcpy(&rate, &value, sizeof(double) < sizeof(rate) ? sizeof(double) : sizeof(rate));
    return rate;
}

static double asio_sample_rate_to_double(ASIOSampleRate rate) {
    double value = 0.0;
    memcpy(&value, &rate, sizeof(double) < sizeof(rate) ? sizeof(double) : sizeof(rate));
    return value;
}

static LRESULT CALLBACK asio_host_wndproc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static HWND create_asio_host_window(void) {
    static const wchar_t* kClassName = L"EchoAudioHostAsioWindow";
    static int classRegistered = 0;
    HINSTANCE instance = GetModuleHandle(NULL);

    if (!classRegistered) {
        WNDCLASSW wc;
        memset(&wc, 0, sizeof(wc));
        wc.lpfnWndProc = asio_host_wndproc;
        wc.hInstance = instance;
        wc.lpszClassName = kClassName;
        if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
            return NULL;
        }
        classRegistered = 1;
    }

    return CreateWindowExW(
        0,
        kClassName,
        L"Echo Audio Host ASIO",
        WS_OVERLAPPED,
        0, 0, 0, 0,
        NULL,
        NULL,
        instance,
        NULL
    );
}

static void write_asio_sample(void* buffer, ASIOSampleType type, long frameIndex, float sample) {
    float clamped = clamp_float_sample(sample);
    int32_t s16 = (int32_t)(clamped * 32767.0f);
    int32_t s24 = (int32_t)(clamped * 8388607.0f);
    int32_t s32 = (int32_t)(clamped * 2147483647.0f);
    unsigned char* bytes = (unsigned char*)buffer;

    switch (type) {
        case ASIOSTInt16LSB:
            ((int16_t*)buffer)[frameIndex] = (int16_t)s16;
            break;
        case ASIOSTInt16MSB:
            write_u16_be(bytes + frameIndex * 2, (uint16_t)(int16_t)s16);
            break;
        case ASIOSTInt24LSB:
            write_u24_le(bytes + frameIndex * 3, s24);
            break;
        case ASIOSTInt24MSB:
            write_u24_be(bytes + frameIndex * 3, s24);
            break;
        case ASIOSTInt32LSB:
        case ASIOSTInt32LSB16:
        case ASIOSTInt32LSB18:
        case ASIOSTInt32LSB20:
        case ASIOSTInt32LSB24:
            ((int32_t*)buffer)[frameIndex] = s32;
            break;
        case ASIOSTInt32MSB:
        case ASIOSTInt32MSB16:
        case ASIOSTInt32MSB18:
        case ASIOSTInt32MSB20:
        case ASIOSTInt32MSB24:
            write_u32_be(bytes + frameIndex * 4, (uint32_t)s32);
            break;
        case ASIOSTFloat32LSB:
            ((float*)buffer)[frameIndex] = clamped;
            break;
        case ASIOSTFloat32MSB: {
            union { float f; uint32_t u; } cvt;
            cvt.f = clamped;
            write_u32_be(bytes + frameIndex * 4, cvt.u);
            break;
        }
        case ASIOSTFloat64LSB:
            ((double*)buffer)[frameIndex] = (double)clamped;
            break;
        case ASIOSTFloat64MSB: {
            union { double d; uint64_t u; } cvt;
            unsigned char* out = bytes + frameIndex * 8;
            cvt.d = (double)clamped;
            out[0] = (unsigned char)((cvt.u >> 56) & 0xFF);
            out[1] = (unsigned char)((cvt.u >> 48) & 0xFF);
            out[2] = (unsigned char)((cvt.u >> 40) & 0xFF);
            out[3] = (unsigned char)((cvt.u >> 32) & 0xFF);
            out[4] = (unsigned char)((cvt.u >> 24) & 0xFF);
            out[5] = (unsigned char)((cvt.u >> 16) & 0xFF);
            out[6] = (unsigned char)((cvt.u >> 8) & 0xFF);
            out[7] = (unsigned char)(cvt.u & 0xFF);
            break;
        }
        default:
            break;
    }
}

static void render_asio_output(long bufferIndex) {
    long frames = g_asio.bufferSize;
    ma_uint32 streamChannels = g_asio.streamChannels;
    ma_uint32 framesToRead = (ma_uint32)frames;
    void* pBuffer = NULL;
    ma_uint32 framesRead = 0;

    memset(g_asio.scratch, 0, (size_t)frames * streamChannels * sizeof(float));

    if (ma_pcm_rb_acquire_read(&g_rb, &framesToRead, &pBuffer) == MA_SUCCESS && framesToRead > 0) {
        memcpy(g_asio.scratch, pBuffer, (size_t)framesToRead * streamChannels * sizeof(float));
        ma_pcm_rb_commit_read(&g_rb, framesToRead);
        framesRead = framesToRead;
        g_framesConsumed += framesRead;
    }

    for (long ch = 0; ch < g_asio.outputChannelCount; ++ch) {
        long asioIndex = g_asio.outputChannelOffset + ch;
        void* output = g_asio.bufferInfos[asioIndex].buffers[bufferIndex];
        ASIOSampleType type = g_asio.channelInfos[asioIndex].type;
        for (long frame = 0; frame < frames; ++frame) {
            float sample = 0.0f;
            if ((ma_uint32)frame < framesRead) {
                ma_uint32 srcCh = streamChannels == 1 ? 0 : (ma_uint32)clamp_long(ch, 0, (long)streamChannels - 1);
                sample = g_asio.scratch[frame * streamChannels + srcCh];
            }
            write_asio_sample(output, type, frame, sample);
        }
    }

    if (g_asio.postOutput) ASIOOutputReady();
}

static void asio_buffer_switch(long index, ASIOBool processNow) {
    (void)processNow;
    render_asio_output(index);
}

static ASIOTime* asio_buffer_switch_time_info(ASIOTime* params, long index, ASIOBool processNow) {
    (void)params;
    (void)processNow;
    render_asio_output(index);
    return params;
}

static void asio_sample_rate_changed(ASIOSampleRate sRate) {
    g_asio.sampleRate = sRate;
}

static long asio_messages(long selector, long value, void* message, double* opt) {
    (void)value;
    (void)message;
    (void)opt;
    switch (selector) {
        case kAsioSelectorSupported:
            if (value == kAsioResetRequest ||
                value == kAsioEngineVersion ||
                value == kAsioResyncRequest ||
                value == kAsioLatenciesChanged ||
                value == kAsioSupportsTimeInfo ||
                value == kAsioSupportsTimeCode ||
                value == kAsioSupportsInputMonitor) {
                return 1L;
            }
            return 0L;
        case kAsioResetRequest:
            return 1L;
        case kAsioResyncRequest:
            return 1L;
        case kAsioLatenciesChanged:
            return 1L;
        case kAsioEngineVersion:
            return 2L;
        case kAsioSupportsTimeInfo:
            return 1L;
        case kAsioSupportsTimeCode:
            return 0L;
        default:
            return 0L;
    }
}

static int init_asio_runtime(const char* targetDeviceName, int targetDeviceIndex, ma_uint32 sampleRate, ma_uint32 channels, ma_uint32* outSampleRate, ma_uint32* outChannels) {
    listed_device* devices = NULL;
    ma_uint32 deviceCount = 0;
    const char* selectedName = NULL;

    if (collect_asio_playback_devices(&devices, &deviceCount) != 0 || deviceCount == 0) {
        free(devices);
        return -1;
    }

    if (targetDeviceIndex >= 0) {
        if ((ma_uint32)targetDeviceIndex < deviceCount) selectedName = devices[targetDeviceIndex].name;
    } else if (targetDeviceName != NULL) {
        for (ma_uint32 i = 0; i < deviceCount; ++i) {
            if (contains_icase(devices[i].name, targetDeviceName) ||
                contains_icase(targetDeviceName, devices[i].name) ||
                strcmp(devices[i].name, targetDeviceName) == 0) {
                selectedName = devices[i].name;
                break;
            }
        }
    } else {
        selectedName = devices[0].name;
    }

    if (selectedName == NULL) {
        free(devices);
        return -1;
    }

    memset(&g_asio, 0, sizeof(g_asio));
    g_asio.driverInfo.asioVersion = 2;
    g_asio.sysRefWindow = create_asio_host_window();
    g_asio.driverInfo.sysRef = g_asio.sysRefWindow != NULL ? g_asio.sysRefWindow : GetDesktopWindow();
    g_asio.streamChannels = channels;

    if (!loadAsioDriver((char*)selectedName)) {
        fprintf(stderr, "[echo-audio-host] ASIO loadDriver failed: %s\n", selectedName);
        free(devices);
        return -1;
    }

    if (ASIOInit(&g_asio.driverInfo) != ASE_OK) {
        fprintf(stderr, "[echo-audio-host] ASIOInit failed: %s | error=%s\n",
                selectedName,
                g_asio.driverInfo.errorMessage[0] != '\0' ? g_asio.driverInfo.errorMessage : "(none)");
        free(devices);
        ASIOExit();
        return -1;
    }

    long inputChannels = 0;
    long outputChannels = 0;
    long minSize = 0;
    long maxSize = 0;
    long preferredSize = 0;
    long granularity = 0;

    if (ASIOGetChannels(&inputChannels, &outputChannels) != ASE_OK || outputChannels <= 0) {
        fprintf(stderr, "[echo-audio-host] ASIOGetChannels failed: %s\n", selectedName);
        free(devices);
        ASIOExit();
        return -1;
    }
    if (ASIOGetBufferSize(&minSize, &maxSize, &preferredSize, &granularity) != ASE_OK || preferredSize <= 0) {
        fprintf(stderr, "[echo-audio-host] ASIOGetBufferSize failed: %s\n", selectedName);
        free(devices);
        ASIOExit();
        return -1;
    }

    /* ── Negotiate the actual ASIO rate ──
     *
     * Previously this code stored sampleRate (the caller's request) into
     * g_asio.sampleRate without ever calling ASIOSetSampleRate / GetSampleRate.
     * Result: the driver kept running at whatever rate was last set via its
     * control panel (TEAC ASIO often defaults to 44.1k), but echo-audio-host
     * reported the *requested* rate to upstream, lying just like the WASAPI
     * exclusive path used to.
     *
     * Correct sequence: ask the driver via ASIOCanSampleRate, set it if
     * supported, then GetSampleRate to read the truth. If the driver refuses,
     * stay at whatever it's currently at (the user can fix via the driver
     * panel or fall back to WASAPI). */
    ASIOSampleRate requestedRate = asio_sample_rate_from_double((double)sampleRate);
    ASIOSampleRate actualRate    = requestedRate;
    if (ASIOCanSampleRate(requestedRate) == ASE_OK) {
        if (ASIOSetSampleRate(requestedRate) != ASE_OK) {
            fprintf(stderr,
                    "[echo-audio-host] ASIOSetSampleRate(%u) refused by driver; reading current rate.\n",
                    sampleRate);
        }
    } else {
        fprintf(stderr,
                "[echo-audio-host] ASIO driver does not advertise %u Hz; reading current rate.\n",
                sampleRate);
    }
    if (ASIOGetSampleRate(&actualRate) != ASE_OK) {
        fprintf(stderr, "[echo-audio-host] ASIOGetSampleRate failed; falling back to requested.\n");
        actualRate = requestedRate;
    }
    {
        ma_uint32 actualU32 = (ma_uint32)(asio_sample_rate_to_double(actualRate) + 0.5);
        if (actualU32 != sampleRate) {
            fprintf(stderr,
                    "[echo-audio-host] ASIO rate adjusted by driver: requested=%u actual=%u\n",
                    sampleRate, actualU32);
            sampleRate = actualU32;
            /* The ring buffer was sized for the requested rate; oversized now
             * is fine (just a bit more latency), undersized would have been a
             * real problem. We accept it rather than reinit. */
        }
    }
    g_asio.sampleRate = actualRate;

    g_asio.postOutput = ASIOOutputReady() == ASE_OK ? ASIOTrue : ASIOFalse;
    g_asio.inputChannelCount = inputChannels < MAX_ASIO_INPUT_CHANNELS ? inputChannels : MAX_ASIO_INPUT_CHANNELS;
    g_asio.outputChannelCount = outputChannels < MAX_ASIO_OUTPUT_CHANNELS ? outputChannels : MAX_ASIO_OUTPUT_CHANNELS;
    if (channels < (ma_uint32)g_asio.outputChannelCount) g_asio.outputChannelCount = (long)channels;
    if (g_asio.outputChannelCount <= 0) {
        fprintf(stderr, "[echo-audio-host] ASIO has no usable output channels: %s\n", selectedName);
        free(devices);
        ASIOExit();
        return -1;
    }
    g_asio.outputChannelOffset = g_asio.inputChannelCount;
    g_asio.totalChannelCount = g_asio.inputChannelCount + g_asio.outputChannelCount;
    g_asio.bufferSize = preferredSize;
    g_asio.scratch = (float*)calloc((size_t)g_asio.bufferSize * g_asio.streamChannels, sizeof(float));
    if (g_asio.scratch == NULL) {
        fprintf(stderr, "[echo-audio-host] ASIO scratch alloc failed: %s\n", selectedName);
        free(devices);
        ASIOExit();
        return -1;
    }

    memset(&g_asio.callbacks, 0, sizeof(g_asio.callbacks));
    g_asio.callbacks.bufferSwitch = asio_buffer_switch;
    g_asio.callbacks.sampleRateDidChange = asio_sample_rate_changed;
    g_asio.callbacks.asioMessage = asio_messages;
    g_asio.callbacks.bufferSwitchTimeInfo = asio_buffer_switch_time_info;

    for (long i = 0; i < g_asio.inputChannelCount; ++i) {
        g_asio.bufferInfos[i].isInput = ASIOTrue;
        g_asio.bufferInfos[i].channelNum = i;
        g_asio.bufferInfos[i].buffers[0] = NULL;
        g_asio.bufferInfos[i].buffers[1] = NULL;
    }

    for (long i = 0; i < g_asio.outputChannelCount; ++i) {
        long asioIndex = g_asio.outputChannelOffset + i;
        g_asio.bufferInfos[asioIndex].isInput = ASIOFalse;
        g_asio.bufferInfos[asioIndex].channelNum = i;
        g_asio.bufferInfos[asioIndex].buffers[0] = NULL;
        g_asio.bufferInfos[asioIndex].buffers[1] = NULL;
    }

    ASIOError createResult = ASIOCreateBuffers(g_asio.bufferInfos, g_asio.totalChannelCount, g_asio.bufferSize, &g_asio.callbacks);
    if (createResult != ASE_OK) {
        fprintf(stderr, "[echo-audio-host] ASIOCreateBuffers failed: %s | inputs=%ld outputs=%ld total=%ld buffer=%ld err=%ld\n",
                selectedName, g_asio.inputChannelCount, g_asio.outputChannelCount, g_asio.totalChannelCount, g_asio.bufferSize, (long)createResult);
        free(g_asio.scratch);
        g_asio.scratch = NULL;
        free(devices);
        ASIOExit();
        return -1;
    }

    for (long i = 0; i < g_asio.totalChannelCount; ++i) {
        g_asio.channelInfos[i].channel = g_asio.bufferInfos[i].channelNum;
        g_asio.channelInfos[i].isInput = g_asio.bufferInfos[i].isInput;
        if (ASIOGetChannelInfo(&g_asio.channelInfos[i]) != ASE_OK) {
            fprintf(stderr, "[echo-audio-host] ASIOGetChannelInfo failed: %s | ch=%ld isInput=%ld\n", selectedName, i, (long)g_asio.channelInfos[i].isInput);
            ASIODisposeBuffers();
            free(g_asio.scratch);
            g_asio.scratch = NULL;
            free(devices);
            ASIOExit();
            return -1;
        }
        if (!g_asio.channelInfos[i].isInput && !asio_sample_type_supported(g_asio.channelInfos[i].type)) {
            fprintf(stderr, "[echo-audio-host] Unsupported ASIO sample type: %s | ch=%ld type=%ld\n",
                    selectedName, i, (long)g_asio.channelInfos[i].type);
            ASIODisposeBuffers();
            free(g_asio.scratch);
            g_asio.scratch = NULL;
            free(devices);
            ASIOExit();
            return -1;
        }
    }

    if (outSampleRate != NULL) *outSampleRate = (ma_uint32)(asio_sample_rate_to_double(g_asio.sampleRate) + 0.5);
    if (outChannels != NULL) *outChannels = (ma_uint32)g_asio.outputChannelCount;
    free(devices);
    return 0;
}

static void uninit_asio_runtime(void) {
    ASIOStop();
    ASIODisposeBuffers();
    ASIOExit();
    if (g_asio.sysRefWindow != NULL) {
        DestroyWindow(g_asio.sysRefWindow);
        g_asio.sysRefWindow = NULL;
    }
    free(g_asio.scratch);
    memset(&g_asio, 0, sizeof(g_asio));
}
#endif
#endif

/* ── realtime audio callback ── */

void data_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount)
{
    (void)pInput;
    ma_uint32 channels  = pDevice->playback.channels;
    ma_uint32 bps       = ma_get_bytes_per_sample(pDevice->playback.format);
    ma_uint32 frameSize = channels * bps;

    ma_uint32 framesRead = frameCount;
    void* pBuffer;

    ma_result result = ma_pcm_rb_acquire_read(&g_rb, &framesRead, &pBuffer);
    if (result != MA_SUCCESS || framesRead == 0) {
        memset(pOutput, 0, frameCount * frameSize);
        return;
    }

    memcpy(pOutput, pBuffer, framesRead * frameSize);
    ma_pcm_rb_commit_read(&g_rb, framesRead);

    /* apply volume in-place */
    float vol = g_volume;
    if (vol < 0.999f || vol > 1.001f) {
        float* samples = (float*)pOutput;
        ma_uint32 total = framesRead * channels;
        for (ma_uint32 i = 0; i < total; i++) {
            samples[i] *= vol;
        }
    }

    /* zero any remaining frames on underrun */
    if (framesRead < frameCount) {
        ma_uint8* pTail = (ma_uint8*)pOutput + framesRead * frameSize;
        memset(pTail, 0, (frameCount - framesRead) * frameSize);
    }

    g_framesConsumed += framesRead;
}

static ma_uint32 read_float_frames_from_ring(void* userData, float* output, ma_uint32 frameCount, ma_uint32 channels)
{
    (void)userData;
    if (output == NULL || frameCount == 0 || channels == 0) return 0;

    ma_uint32 framesRead = frameCount;
    void* pBuffer = NULL;
    memset(output, 0, (size_t)frameCount * channels * sizeof(float));

    ma_result result = ma_pcm_rb_acquire_read(&g_rb, &framesRead, &pBuffer);
    if (result != MA_SUCCESS || framesRead == 0) return 0;

    memcpy(output, pBuffer, (size_t)framesRead * channels * sizeof(float));
    ma_pcm_rb_commit_read(&g_rb, framesRead);

    float vol = g_volume;
    if (vol < 0.999f || vol > 1.001f) {
        ma_uint32 total = framesRead * channels;
        for (ma_uint32 i = 0; i < total; i++) {
            output[i] *= vol;
        }
    }

    g_framesConsumed += framesRead;
    return framesRead;
}

static int pump_stdin_to_ring(ma_uint32 channels)
{
    const size_t chunkFrames = 2048;
    const size_t chunkBytes  = chunkFrames * channels * sizeof(float);
    ma_uint8* chunk = (ma_uint8*)malloc(chunkBytes);
    ma_uint64 lastReportedPos = 0;
    int posReportCounter = 0;

    if (chunk == NULL) {
        fprintf(stderr, "[echo-audio-host] Failed to allocate stdin buffer\n");
        return -1;
    }

    while (1) {
        size_t bytesRead = fread(chunk, 1, chunkBytes, stdin);
        if (bytesRead == 0) {
            g_stdinEOF = 1;
            break;
        }

        ma_uint32 framesToWrite = (ma_uint32)(bytesRead / (channels * sizeof(float)));
        ma_uint32 framesWritten = 0;

        while (framesToWrite > 0) {
            void* pWriteBuffer;
            ma_uint32 framesToAcquire = framesToWrite;
            ma_result res = ma_pcm_rb_acquire_write(&g_rb, &framesToAcquire, &pWriteBuffer);

            if (res == MA_SUCCESS && framesToAcquire > 0) {
                memcpy(pWriteBuffer,
                       chunk + (framesWritten * channels * sizeof(float)),
                       framesToAcquire * channels * sizeof(float));
                ma_pcm_rb_commit_write(&g_rb, framesToAcquire);
                framesToWrite -= framesToAcquire;
                framesWritten += framesToAcquire;
            } else {
                sleep_ms(2);
            }
        }

        posReportCounter++;
        if (posReportCounter >= 4) {
            posReportCounter = 0;
            ma_uint64 pos = g_framesConsumed;
            if (pos != lastReportedPos) {
                fprintf(stdout, "{\"pos\":%llu}\n", (unsigned long long)pos);
                fflush(stdout);
                lastReportedPos = pos;
            }
        }
    }

    for (int drainIter = 0; drainIter < 500; drainIter++) {
        ma_uint32 remaining = ma_pcm_rb_available_read(&g_rb);
        if (remaining == 0) break;
        sleep_ms(10);
    }

    fprintf(stdout, "{\"pos\":%llu}\n", (unsigned long long)g_framesConsumed);
    fflush(stdout);
    fprintf(stdout, "{\"event\":\"ended\"}\n");
    fflush(stdout);

    free(chunk);
    return 0;
}

/* ── main ── */

int main(int argc, char** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin),  _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    SetConsoleOutputCP(CP_UTF8);
#endif

    int listDevices = 0;
    int useAsio = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-list") == 0) listDevices = 1;
        else if (strcmp(argv[i], "-asio") == 0) useAsio = 1;
    }

    /* -list: enumerate devices and exit */
    if (listDevices) {
#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
        if (useAsio) {
            listed_device* devices = NULL;
            ma_uint32 deviceCount = 0;
            if (collect_asio_playback_devices(&devices, &deviceCount) == 0) {
                for (ma_uint32 i = 0; i < deviceCount; i++) {
                    fprintf(stdout, "%u\t[ASIO] %s\n", i, devices[i].name);
                }
                fflush(stdout);
                free(devices);
            }
            return 0;
        }
#else
        if (useAsio) {
            fprintf(stderr, "[echo-audio-host] ASIO support is not enabled in this build\n");
            return -3;
        }
#endif
        wasapi_exclusive_device_info* wasapiDevices = NULL;
        uint32_t wasapiDeviceCount = 0;
        if (wasapi_exclusive_list_devices(&wasapiDevices, &wasapiDeviceCount) == 0) {
            for (uint32_t i = 0; i < wasapiDeviceCount; i++) {
                fprintf(stdout, "%u\t%s\t%u\t%d\t%u\n",
                        i,
                        wasapiDevices[i].name,
                        wasapiDevices[i].highestSampleRate,
                        wasapiDevices[i].isDefault ? 1 : 0,
                        wasapiDevices[i].sharedSampleRate);
            }
            fflush(stdout);
            wasapi_exclusive_free_devices(wasapiDevices);
        }
        return 0;
#else
        if (useAsio) {
            fprintf(stderr, "[echo-audio-host] ASIO is only supported on Windows builds\n");
            return -3;
        }
#endif
        ma_context context;
#ifdef _WIN32
        ma_backend backends[] = { ma_backend_wasapi };
        if (ma_context_init(backends, 1, NULL, &context) != MA_SUCCESS) {
#else
        if (ma_context_init(NULL, 0, NULL, &context) != MA_SUCCESS) {
#endif
            fprintf(stderr, "Failed to init context\n");
            return -1;
        }
        listed_device* devices = NULL;
        ma_uint32 deviceCount = 0;
        if (collect_unique_playback_devices(&context, &devices, &deviceCount) == 0) {
            for (ma_uint32 i = 0; i < deviceCount; i++) {
                /* stdout: one device per line  index\tname\thighestSampleRate\tisDefault\n */
                fprintf(stdout, "%u\t%s\t%u\t%d\n",
                        i,
                        devices[i].name,
                        devices[i].highestSampleRate,
                        devices[i].isDefault ? 1 : 0);
            }
            fflush(stdout);
            free(devices);
        }
        ma_context_uninit(&context);
        return 0;
    }

    /* ── parse args ── */
    ma_uint32 sampleRate       = 44100;
    ma_uint32 channels         = 2;
    ma_bool32 exclusive        = MA_FALSE;
    char*     targetDeviceName = NULL;
    int       targetDeviceIndex = -1;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-sr") == 0 && i + 1 < argc)           sampleRate = atoi(argv[++i]);
        else if (strcmp(argv[i], "-ch") == 0 && i + 1 < argc)      channels = atoi(argv[++i]);
        else if (strcmp(argv[i], "-exclusive") == 0)                exclusive = MA_TRUE;
        else if (strcmp(argv[i], "-asio") == 0)                     useAsio = 1;
        else if (strcmp(argv[i], "-device") == 0 && i + 1 < argc)  targetDeviceName = argv[++i];
        else if (strcmp(argv[i], "-device-index") == 0 && i + 1 < argc) targetDeviceIndex = atoi(argv[++i]);
        else if (strcmp(argv[i], "-vol") == 0 && i + 1 < argc)     g_volume = (float)atof(argv[++i]);
    }

#ifdef _WIN32
    if (!useAsio && exclusive) {
        ma_format format = ma_format_f32;
        ma_uint32 rbFrames = (ma_uint32)((double)sampleRate * 0.4);
        wasapi_exclusive_runtime* wasapiRuntime = NULL;
        wasapi_exclusive_ready_info readyInfo;
        char wasapiError[512];

        if (channels == 0) channels = 2;
        if (rbFrames < sampleRate / 5) rbFrames = sampleRate / 5;
        if (ma_pcm_rb_init(format, channels, rbFrames, NULL, NULL, &g_rb) != MA_SUCCESS) {
            fprintf(stderr, "[echo-audio-host] Failed to initialize ring buffer\n");
            return -1;
        }

        int wasapiResult = wasapi_exclusive_start(
            targetDeviceName,
            targetDeviceIndex,
            sampleRate,
            channels,
            read_float_frames_from_ring,
            NULL,
            &wasapiRuntime,
            &readyInfo,
            wasapiError,
            sizeof(wasapiError));

        if (wasapiResult != 0) {
            fprintf(stderr, "[echo-audio-host] %s\n",
                    wasapiError[0] != '\0' ? wasapiError : "Failed to initialize WASAPI exclusive output");
            ma_pcm_rb_uninit(&g_rb);
            return wasapiResult;
        }

        fprintf(stderr, "[echo-audio-host] Ready: sr=%u hw=%u ch=%u exclusive=YES backend=wasapi-exclusive format=%s\n",
                readyInfo.sampleRate,
                readyInfo.hardwareSampleRate,
                readyInfo.channels,
                readyInfo.format);
        fprintf(stdout,
                "{\"ready\":true,\"sampleRate\":%u,\"hardwareSampleRate\":%u,\"channels\":%u,\"exclusive\":true,\"backend\":\"wasapi-exclusive\",\"format\":\"%s\"}\n",
                readyInfo.sampleRate,
                readyInfo.hardwareSampleRate,
                readyInfo.channels,
                readyInfo.format);
        fflush(stdout);

        int pumpResult = pump_stdin_to_ring(channels);
        wasapi_exclusive_stop(wasapiRuntime);
        ma_pcm_rb_uninit(&g_rb);
        return pumpResult;
    }
#endif

    /* ── init context (WASAPI on Windows) ── */
    ma_uint32 actualSampleRate = sampleRate;
    ma_uint32 actualChannels = channels;
    ma_context context;
    ma_device device;
    ma_device_id deviceId;
    ma_device_id* pDeviceId = NULL;
    memset(&context, 0, sizeof(context));
    memset(&device, 0, sizeof(device));

    if (!useAsio) {
#ifdef _WIN32
        ma_backend backends[] = { ma_backend_wasapi };
        if (ma_context_init(backends, 1, NULL, &context) != MA_SUCCESS) {
#else
        if (ma_context_init(NULL, 0, NULL, &context) != MA_SUCCESS) {
#endif
            fprintf(stderr, "[echo-audio-host] Failed to initialize context\n");
            return -1;
        }
    }

    /* ── resolve device ── */
    if (useAsio) {
#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
        if (init_asio_runtime(targetDeviceName, targetDeviceIndex, sampleRate, channels, &actualSampleRate, &actualChannels) != 0) {
            fprintf(stderr, "[echo-audio-host] Failed to initialize ASIO output device\n");
            return -3;
        }
#else
        fprintf(stderr, "[echo-audio-host] ASIO support is not enabled in this build\n");
        return -3;
#endif
#else
        fprintf(stderr, "[echo-audio-host] ASIO is only supported on Windows builds\n");
        return -3;
#endif
    } else if (targetDeviceIndex >= 0) {
        listed_device* devices = NULL;
        ma_uint32 deviceCount = 0;
        if (collect_unique_playback_devices_fast(&context, &devices, &deviceCount) == 0) {
            if ((ma_uint32)targetDeviceIndex < deviceCount) {
                deviceId  = devices[targetDeviceIndex].id;
                pDeviceId = &deviceId;
                fprintf(stderr, "[echo-audio-host] Using device index %d: %s\n",
                        targetDeviceIndex, devices[targetDeviceIndex].name);
            } else {
                fprintf(stderr, "[echo-audio-host] Invalid device index %d, fallback to default\n",
                        targetDeviceIndex);
            }
            free(devices);
        }
    } else if (targetDeviceName != NULL) {
        listed_device* devices = NULL;
        ma_uint32 deviceCount = 0;
        if (collect_unique_playback_devices_fast(&context, &devices, &deviceCount) == 0) {
            for (ma_uint32 i = 0; i < deviceCount; i++) {
                if (contains_icase(devices[i].name, targetDeviceName) ||
                    contains_icase(targetDeviceName, devices[i].name) ||
                    strcmp(devices[i].name, targetDeviceName) == 0) {
                    deviceId  = devices[i].id;
                    pDeviceId = &deviceId;
                    fprintf(stderr, "[echo-audio-host] Matched device: %s\n", devices[i].name);
                    break;
                }
            }
            if (pDeviceId == NULL) {
                fprintf(stderr, "[echo-audio-host] No match for '%s', fallback to default\n",
                        targetDeviceName);
            }
            free(devices);
        }
    }

    /* ── ring buffer (~0.4s): smaller queue so volume/EQ changes in the Node
     * pipeline are heard sooner; 2s caused multi-second perceived lag. ── */
    ma_format format = ma_format_f32;
    ma_uint32 rbFrames = (ma_uint32)((double)actualSampleRate * 0.4);
    if (rbFrames < actualSampleRate / 5) rbFrames = actualSampleRate / 5; /* min ~200ms */
    if (ma_pcm_rb_init(format, channels, rbFrames, NULL, NULL, &g_rb) != MA_SUCCESS) {
        fprintf(stderr, "[echo-audio-host] Failed to initialize ring buffer\n");
        if (useAsio) {
#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
            uninit_asio_runtime();
#endif
#endif
        } else {
            ma_context_uninit(&context);
        }
        return -1;
    }

    if (!useAsio) {

    /* ── device config ── */
    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.format   = format;
    config.playback.channels = channels;
    config.playback.pDeviceID = pDeviceId;
    config.sampleRate         = sampleRate;
    config.dataCallback       = data_callback;
    config.periodSizeInFrames = sampleRate / 100; /* 10 ms target latency */

    if (!useAsio && exclusive) {
        config.playback.shareMode = ma_share_mode_exclusive;
        fprintf(stderr, "[echo-audio-host] Requesting EXCLUSIVE mode...\n");
    }

    if (ma_device_init(&context, &config, &device) != MA_SUCCESS) {
        fprintf(stderr, "[echo-audio-host] Failed to initialize output device\n");
        ma_pcm_rb_uninit(&g_rb);
        ma_context_uninit(&context);
        return useAsio ? -3 : -1;
    }

    if (!useAsio && exclusive && device.playback.shareMode != ma_share_mode_exclusive) {
        fprintf(stderr, "[echo-audio-host] Exclusive mode NOT acquired. Aborting.\n");
        ma_device_uninit(&device);
        ma_pcm_rb_uninit(&g_rb);
        ma_context_uninit(&context);
        return -2; /* special exit code: exclusive denied */
    }

    /* ── BIT-PERFECT GUARD: detect hidden internal SRC in WASAPI exclusive ──
     *
     * In exclusive mode miniaudio uses whatever rate is set in
     * mmsys.cpl -> device -> Advanced -> Default Format (see miniaudio.h
     * ~23694), independent of config.sampleRate. If they differ it silently
     * inserts a 192k->48k (or whatever) resampler, which defeats the entire
     * point of exclusive mode and causes the upstream chain (and UI) to
     * believe it is sending hi-res to the DAC while the DAC actually receives
     * the mmsys default rate.
     *
     * Fix: detect device.sampleRate != device.playback.internalSampleRate,
     * tear down, and reopen at the hardware rate. Then upstream (JS / ffmpeg)
     * will adjust its decode rate via the actualSampleRate echo and the path
     * becomes honest end to end. */
    if (!useAsio && exclusive
        && device.playback.internalSampleRate != 0
        && device.playback.internalSampleRate != device.sampleRate) {

        ma_uint32 hwRate = device.playback.internalSampleRate;
        fprintf(stderr,
                "[echo-audio-host] WASAPI exclusive rate mismatch: app=%u hw=%u. "
                "Reopening at hw rate to avoid hidden SRC. "
                "(Tip: set mmsys -> device -> Advanced -> Default Format to your "
                "desired rate for true high-res exclusive output.)\n",
                device.sampleRate, hwRate);

        ma_device_uninit(&device);
        ma_pcm_rb_uninit(&g_rb);

        rbFrames = (ma_uint32)((double)hwRate * 0.4);
        if (rbFrames < hwRate / 5) rbFrames = hwRate / 5;
        if (ma_pcm_rb_init(format, channels, rbFrames, NULL, NULL, &g_rb) != MA_SUCCESS) {
            fprintf(stderr, "[echo-audio-host] Failed to reinit ring buffer at hw rate %u\n", hwRate);
            ma_context_uninit(&context);
            return -1;
        }

        /* Re-init config from scratch instead of mutating the prior one. Cheap
         * insurance against any internal state miniaudio might have written
         * during the failed-intent first init. */
        config = ma_device_config_init(ma_device_type_playback);
        config.playback.format    = format;
        config.playback.channels  = channels;
        config.playback.pDeviceID = pDeviceId;
        config.playback.shareMode = ma_share_mode_exclusive;
        config.sampleRate         = hwRate;
        config.dataCallback       = data_callback;
        config.periodSizeInFrames = hwRate / 100;

        if (ma_device_init(&context, &config, &device) != MA_SUCCESS) {
            fprintf(stderr, "[echo-audio-host] Failed to reopen device at hw rate %u\n", hwRate);
            ma_pcm_rb_uninit(&g_rb);
            ma_context_uninit(&context);
            return -1;
        }
        if (device.playback.shareMode != ma_share_mode_exclusive) {
            fprintf(stderr, "[echo-audio-host] Exclusive lost after rate-adjust reopen. Aborting.\n");
            ma_device_uninit(&device);
            ma_pcm_rb_uninit(&g_rb);
            ma_context_uninit(&context);
            return -2;
        }
        /* Defensive: after reopen, the two rates MUST match. If they don't,
         * miniaudio is doing something we don't understand — fail loud rather
         * than ship hidden SRC again. */
        if (device.playback.internalSampleRate != 0
            && device.playback.internalSampleRate != device.sampleRate) {
            fprintf(stderr,
                    "[echo-audio-host] Reopen still mismatched (app=%u hw=%u). Aborting bit-perfect.\n",
                    device.sampleRate, device.playback.internalSampleRate);
            ma_device_uninit(&device);
            ma_pcm_rb_uninit(&g_rb);
            ma_context_uninit(&context);
            return -4; /* new code: bit-perfect not achievable */
        }
        fprintf(stderr,
                "[echo-audio-host] Reopen OK: app=%u hw=%u (bit-perfect path).\n",
                device.sampleRate, device.playback.internalSampleRate);
        sampleRate = hwRate;
    }

    fprintf(stderr, "[echo-audio-host] Ready: sr=%d hw=%u ch=%d exclusive=%s\n",
            device.sampleRate,
            device.playback.internalSampleRate,
            device.playback.channels,
            device.playback.shareMode == ma_share_mode_exclusive ? "YES" : "NO");
        actualSampleRate = device.sampleRate;
        actualChannels = device.playback.channels;
    } else {
        fprintf(stderr, "[echo-audio-host] Ready: sr=%d ch=%d exclusive=NO asio=YES\n",
                actualSampleRate, actualChannels);
    }

    /* report actual device parameters as the first JSON line */
    if (useAsio) {
        fprintf(stdout, "{\"ready\":true,\"sampleRate\":%d,\"channels\":%d,\"exclusive\":false,\"asio\":true}\n",
                actualSampleRate, actualChannels);
    } else {
        fprintf(stdout, "{\"ready\":true,\"sampleRate\":%d,\"hardwareSampleRate\":%u,\"channels\":%d,\"exclusive\":%s}\n",
                device.sampleRate,
                device.playback.internalSampleRate,
                device.playback.channels,
                device.playback.shareMode == ma_share_mode_exclusive ? "true" : "false");
    }
    fflush(stdout);

    if (useAsio) {
#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
        if (ASIOStart() != ASE_OK) {
            fprintf(stderr, "[echo-audio-host] Failed to start ASIO device\n");
            ma_pcm_rb_uninit(&g_rb);
            uninit_asio_runtime();
            return -3;
        }
#endif
#endif
    } else if (ma_device_start(&device) != MA_SUCCESS) {
        fprintf(stderr, "[echo-audio-host] Failed to start device\n");
        ma_device_uninit(&device);
        ma_pcm_rb_uninit(&g_rb);
        ma_context_uninit(&context);
        return -1;
    }

    /* ── main loop: read stdin PCM → ring buffer, report position ── */
    const size_t chunkFrames = 2048;
    const size_t chunkBytes  = chunkFrames * channels * sizeof(float);
    ma_uint8* chunk = (ma_uint8*)malloc(chunkBytes);
    ma_uint64 lastReportedPos = 0;
    int       posReportCounter = 0;

    while (1) {
        size_t bytesRead = fread(chunk, 1, chunkBytes, stdin);
        if (bytesRead == 0) {
            g_stdinEOF = 1;
            break;
        }

        ma_uint32 framesToWrite = (ma_uint32)(bytesRead / (channels * sizeof(float)));
        ma_uint32 framesWritten = 0;

        while (framesToWrite > 0) {
            void* pWriteBuffer;
            ma_uint32 framesToAcquire = framesToWrite;
            ma_result res = ma_pcm_rb_acquire_write(&g_rb, &framesToAcquire, &pWriteBuffer);

            if (res == MA_SUCCESS && framesToAcquire > 0) {
                memcpy(pWriteBuffer,
                       chunk + (framesWritten * channels * sizeof(float)),
                       framesToAcquire * channels * sizeof(float));
                ma_pcm_rb_commit_write(&g_rb, framesToAcquire);
                framesToWrite -= framesToAcquire;
                framesWritten += framesToAcquire;
            } else {
                sleep_ms(2);
            }
        }

        /*
         * Report position every ~4 chunks (~40-90 ms depending on sample rate).
         * The position comes from g_framesConsumed which is updated by the device
         * callback — this is the OUTPUT side (what the user actually hears).
         */
        posReportCounter++;
        if (posReportCounter >= 4) {
            posReportCounter = 0;
            ma_uint64 pos = g_framesConsumed;
            if (pos != lastReportedPos) {
                fprintf(stdout, "{\"pos\":%llu}\n", (unsigned long long)pos);
                fflush(stdout);
                lastReportedPos = pos;
            }
        }
    }

    /* ── drain: wait for ring buffer to finish playing ── */
    for (int drainIter = 0; drainIter < 500; drainIter++) {
        ma_uint32 remaining = ma_pcm_rb_available_read(&g_rb);
        if (remaining == 0) break;
        sleep_ms(10);
    }
    /* final position report */
    fprintf(stdout, "{\"pos\":%llu}\n", (unsigned long long)g_framesConsumed);
    fflush(stdout);

    /* signal natural end of track */
    fprintf(stdout, "{\"event\":\"ended\"}\n");
    fflush(stdout);

    /* ── cleanup ── */
    if (useAsio) {
#ifdef _WIN32
#ifdef MA_ENABLE_ASIO
        uninit_asio_runtime();
#endif
#endif
    } else {
        ma_device_uninit(&device);
        ma_context_uninit(&context);
    }
    ma_pcm_rb_uninit(&g_rb);
    free(chunk);

    return 0;
}
