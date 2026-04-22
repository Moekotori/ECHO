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

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propidl.h>
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
    if (props->GetValue(PKEY_Device_FriendlyName, &value) != S_OK) goto done;
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
        ma_uint32 highestSampleRate = get_highest_sample_rate(&playbackInfos[i]);
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
            if (devices[existingIndex].name[0] == '\0' && utf8Name[0] != '\0') {
                snprintf(devices[existingIndex].name, sizeof(devices[existingIndex].name), "%s", utf8Name);
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

/* ── main ── */

int main(int argc, char** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin),  _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    SetConsoleOutputCP(CP_UTF8);
#endif

    /* -list: enumerate devices and exit */
    if (argc > 1 && strcmp(argv[1], "-list") == 0) {
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
                /* stdout: one device per line  index\tname\n */
                fprintf(stdout, "%u\t%s\n", i, devices[i].name);
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
        else if (strcmp(argv[i], "-device") == 0 && i + 1 < argc)  targetDeviceName = argv[++i];
        else if (strcmp(argv[i], "-device-index") == 0 && i + 1 < argc) targetDeviceIndex = atoi(argv[++i]);
        else if (strcmp(argv[i], "-vol") == 0 && i + 1 < argc)     g_volume = (float)atof(argv[++i]);
    }

    /* ── init context (WASAPI on Windows) ── */
    ma_context context;
#ifdef _WIN32
    ma_backend backends[] = { ma_backend_wasapi };
    if (ma_context_init(backends, 1, NULL, &context) != MA_SUCCESS) {
#else
    if (ma_context_init(NULL, 0, NULL, &context) != MA_SUCCESS) {
#endif
        fprintf(stderr, "[echo-audio-host] Failed to initialize context\n");
        return -1;
    }

    /* ── resolve device ── */
    ma_device_id deviceId;
    ma_device_id* pDeviceId = NULL;

    if (targetDeviceIndex >= 0) {
        listed_device* devices = NULL;
        ma_uint32 deviceCount = 0;
        if (collect_unique_playback_devices(&context, &devices, &deviceCount) == 0) {
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
        if (collect_unique_playback_devices(&context, &devices, &deviceCount) == 0) {
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
    ma_uint32 rbFrames = (ma_uint32)((double)sampleRate * 0.4);
    if (rbFrames < sampleRate / 5) rbFrames = sampleRate / 5; /* min ~200ms */
    if (ma_pcm_rb_init(format, channels, rbFrames, NULL, NULL, &g_rb) != MA_SUCCESS) {
        fprintf(stderr, "[echo-audio-host] Failed to initialize ring buffer\n");
        return -1;
    }

    /* ── device config ── */
    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.format   = format;
    config.playback.channels = channels;
    config.playback.pDeviceID = pDeviceId;
    config.sampleRate         = sampleRate;
    config.dataCallback       = data_callback;
    config.periodSizeInFrames = sampleRate / 100; /* 10 ms target latency */

    if (exclusive) {
        config.playback.shareMode = ma_share_mode_exclusive;
        fprintf(stderr, "[echo-audio-host] Requesting EXCLUSIVE mode...\n");
    }

    ma_device device;
    if (ma_device_init(&context, &config, &device) != MA_SUCCESS) {
        fprintf(stderr, "[echo-audio-host] Failed to initialize output device\n");
        ma_pcm_rb_uninit(&g_rb);
        ma_context_uninit(&context);
        return -1;
    }

    if (exclusive && device.playback.shareMode != ma_share_mode_exclusive) {
        fprintf(stderr, "[echo-audio-host] Exclusive mode NOT acquired. Aborting.\n");
        ma_device_uninit(&device);
        ma_pcm_rb_uninit(&g_rb);
        ma_context_uninit(&context);
        return -2; /* special exit code: exclusive denied */
    }

    fprintf(stderr, "[echo-audio-host] Ready: sr=%d ch=%d exclusive=%s\n",
            device.sampleRate, device.playback.channels,
            device.playback.shareMode == ma_share_mode_exclusive ? "YES" : "NO");

    /* report actual device parameters as the first JSON line */
    fprintf(stdout, "{\"ready\":true,\"sampleRate\":%d,\"channels\":%d,\"exclusive\":%s}\n",
            device.sampleRate, device.playback.channels,
            device.playback.shareMode == ma_share_mode_exclusive ? "true" : "false");
    fflush(stdout);

    if (ma_device_start(&device) != MA_SUCCESS) {
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
    ma_device_uninit(&device);
    ma_context_uninit(&context);
    ma_pcm_rb_uninit(&g_rb);
    free(chunk);

    return 0;
}