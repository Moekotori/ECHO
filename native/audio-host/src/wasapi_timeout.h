#pragma once

#ifdef _WIN32

#include "audio_host_exit_codes.h"

#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>

#include <atomic>
#include <chrono>
#include <future>
#include <memory>
#include <mutex>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <thread>
#include <algorithm>
#include <vector>

namespace echo_wasapi_timeout {

constexpr int kWasapiInitTimeoutMs = 3000;

static std::vector<std::future<HRESULT>>& init_future_graveyard() {
    static auto* graveyard = new std::vector<std::future<HRESULT>>();
    return *graveyard;
}

static std::mutex& init_future_graveyard_mutex() {
    static auto* mutex = new std::mutex();
    return *mutex;
}

static void sweep_future_graveyard() {
    auto& graveyard = init_future_graveyard();
    std::lock_guard<std::mutex> lock(init_future_graveyard_mutex());
    graveyard.erase(
        std::remove_if(
            graveyard.begin(),
            graveyard.end(),
            [](std::future<HRESULT>& future) {
                return !future.valid() ||
                    future.wait_for(std::chrono::seconds(0)) == std::future_status::ready;
            }),
        graveyard.end());
}

static void drain_future_graveyard() {
    std::vector<std::future<HRESULT>> pending;
    {
        std::lock_guard<std::mutex> lock(init_future_graveyard_mutex());
        pending.swap(init_future_graveyard());
    }

    for (auto& future : pending) {
        if (!future.valid()) continue;
        future.wait();
        try {
            (void)future.get();
        } catch (...) {
        }
    }
}

struct future_graveyard_shutdown_guard {
    ~future_graveyard_shutdown_guard() {
        drain_future_graveyard();
    }
};

static void ensure_future_graveyard_shutdown_guard() {
    static future_graveyard_shutdown_guard guard;
    (void)guard;
}

static void abandon_future(std::future<HRESULT>&& future) {
    ensure_future_graveyard_shutdown_guard();
    std::lock_guard<std::mutex> lock(init_future_graveyard_mutex());
    init_future_graveyard().push_back(std::move(future));
}

typedef struct com_worker_scope {
    HRESULT hr;
    bool needsUninit;
} com_worker_scope;

static com_worker_scope enter_com_worker_scope() {
    com_worker_scope scope;
    scope.hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    scope.needsUninit = SUCCEEDED(scope.hr);
    if (scope.hr == RPC_E_CHANGED_MODE) {
        scope.hr = S_OK;
        scope.needsUninit = false;
    }
    return scope;
}

static void leave_com_worker_scope(com_worker_scope* scope) {
    if (scope != NULL && scope->needsUninit) {
        CoUninitialize();
        scope->needsUninit = false;
    }
}

static DWORD read_test_hang_ms(const char* name) {
    char value[32];
    DWORD length = GetEnvironmentVariableA(name, value, (DWORD)sizeof(value));
    if (length == 0 || length >= (DWORD)sizeof(value)) return 0;

    char* end = NULL;
    unsigned long parsed = strtoul(value, &end, 10);
    if (end == value || parsed == 0 || parsed > 60000UL) return 0;
    return (DWORD)parsed;
}

static std::vector<unsigned char> copy_wave_format(const WAVEFORMATEX* format) {
    std::vector<unsigned char> copy;
    if (format == NULL) return copy;

    const size_t formatSize = sizeof(WAVEFORMATEX) + (size_t)format->cbSize;
    copy.resize(formatSize);
    memcpy(copy.data(), format, formatSize);
    return copy;
}

[[maybe_unused]] static HRESULT activate_audio_client_with_timeout(IMMDevice* device, IAudioClient** outClient) {
    sweep_future_graveyard();
    if (outClient == NULL) return E_POINTER;
    *outClient = NULL;
    if (device == NULL) return E_POINTER;

    auto clientCopy = std::make_shared<IAudioClient*>(nullptr);
    auto timedOut = std::make_shared<std::atomic_bool>(false);
    const DWORD testHangMs = read_test_hang_ms("ECHO_TEST_WASAPI_ACTIVATE_HANG_MS");
    device->AddRef();
    auto future = std::async(std::launch::async, [device, clientCopy, timedOut, testHangMs]() -> HRESULT {
        com_worker_scope com = enter_com_worker_scope();
        if (FAILED(com.hr)) {
            device->Release();
            return com.hr;
        }

        IAudioClient* localClient = NULL;
        HRESULT hr = E_PENDING;
        if (testHangMs > 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(testHangMs));
        } else {
            hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void**)&localClient);
        }
        if (SUCCEEDED(hr) && localClient != NULL && !timedOut->load(std::memory_order_acquire)) {
            *clientCopy = localClient;
        } else if (localClient != NULL) {
            localClient->Release();
        }

        leave_com_worker_scope(&com);
        device->Release();
        return hr;
    });

    auto status = future.wait_for(std::chrono::milliseconds(kWasapiInitTimeoutMs));
    if (status == std::future_status::timeout) {
        fprintf(
            stderr,
            "[echo-audio-host] WASAPI Activate timed out after %dms phase=activate\n",
            kWasapiInitTimeoutMs);
        timedOut->store(true, std::memory_order_release);
        abandon_future(std::move(future));
        return E_PENDING;
    }

    HRESULT hr = future.get();
    if (SUCCEEDED(hr)) {
        *outClient = *clientCopy;
    }

    return hr;
}

static HRESULT initialize_with_timeout(
    IAudioClient* client,
    AUDCLNT_SHAREMODE shareMode,
    DWORD streamFlags,
    REFERENCE_TIME hnsBufferDuration,
    REFERENCE_TIME hnsPeriodicity,
    const WAVEFORMATEX* format,
    LPCGUID audioSessionGuid) {
    sweep_future_graveyard();
    if (client == NULL) return E_POINTER;

    const std::vector<unsigned char> formatCopy = copy_wave_format(format);
    const bool hasSessionGuid = audioSessionGuid != NULL;
    const GUID sessionGuid = hasSessionGuid ? *audioSessionGuid : GUID {};
    const DWORD testHangMs = read_test_hang_ms("ECHO_TEST_WASAPI_INITIALIZE_HANG_MS");

    auto future = std::async(
        std::launch::async,
        [client,
         shareMode,
         streamFlags,
         hnsBufferDuration,
         hnsPeriodicity,
         formatCopy,
         hasSessionGuid,
         sessionGuid,
         testHangMs]() -> HRESULT {
            com_worker_scope com = enter_com_worker_scope();
            if (FAILED(com.hr)) return com.hr;

            HRESULT hr = S_OK;
            if (testHangMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(testHangMs));
            } else {
                const WAVEFORMATEX* copiedFormat = formatCopy.empty()
                    ? NULL
                    : reinterpret_cast<const WAVEFORMATEX*>(formatCopy.data());
                LPCGUID copiedSessionGuid = hasSessionGuid ? &sessionGuid : NULL;
                hr = client->Initialize(
                    shareMode,
                    streamFlags,
                    hnsBufferDuration,
                    hnsPeriodicity,
                    copiedFormat,
                    copiedSessionGuid);
            }

            leave_com_worker_scope(&com);
            return hr;
        });

    auto status = future.wait_for(std::chrono::milliseconds(kWasapiInitTimeoutMs));
    if (status == std::future_status::timeout) {
        fprintf(
            stderr,
            "[echo-audio-host] WASAPI Initialize timed out after %dms phase=initialize\n",
            kWasapiInitTimeoutMs);
        abandon_future(std::move(future));
        return E_PENDING;
    }

    return future.get();
}

[[maybe_unused]] static HRESULT get_device_period_with_timeout(
    IAudioClient* client,
    REFERENCE_TIME* defaultPeriod,
    REFERENCE_TIME* minPeriod) {
    sweep_future_graveyard();
    if (client == NULL || defaultPeriod == NULL || minPeriod == NULL) return E_POINTER;

    auto defaultPeriodCopy = std::make_shared<REFERENCE_TIME>(0);
    auto minPeriodCopy = std::make_shared<REFERENCE_TIME>(0);
    auto future = std::async(std::launch::async, [client, defaultPeriodCopy, minPeriodCopy]() -> HRESULT {
        com_worker_scope com = enter_com_worker_scope();
        if (FAILED(com.hr)) return com.hr;

        REFERENCE_TIME localDefaultPeriod = 0;
        REFERENCE_TIME localMinPeriod = 0;
        HRESULT hr = client->GetDevicePeriod(&localDefaultPeriod, &localMinPeriod);
        if (SUCCEEDED(hr)) {
            *defaultPeriodCopy = localDefaultPeriod;
            *minPeriodCopy = localMinPeriod;
        }

        leave_com_worker_scope(&com);
        return hr;
    });

    auto status = future.wait_for(std::chrono::milliseconds(kWasapiInitTimeoutMs));
    if (status == std::future_status::timeout) {
        fprintf(
            stderr,
            "[echo-audio-host] WASAPI GetDevicePeriod timed out after %dms phase=device-period\n",
            kWasapiInitTimeoutMs);
        abandon_future(std::move(future));
        return E_PENDING;
    }

    HRESULT hr = future.get();
    if (SUCCEEDED(hr)) {
        *defaultPeriod = *defaultPeriodCopy;
        *minPeriod = *minPeriodCopy;
    }

    return hr;
}

static HRESULT start_with_timeout(IAudioClient* client) {
    sweep_future_graveyard();
    if (client == NULL) return E_POINTER;

    const DWORD testHangMs = read_test_hang_ms("ECHO_TEST_WASAPI_START_HANG_MS");
    auto future = std::async(std::launch::async, [client, testHangMs]() -> HRESULT {
        com_worker_scope com = enter_com_worker_scope();
        if (FAILED(com.hr)) return com.hr;

        HRESULT hr = S_OK;
        if (testHangMs > 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(testHangMs));
        } else {
            hr = client->Start();
        }

        leave_com_worker_scope(&com);
        return hr;
    });

    auto status = future.wait_for(std::chrono::milliseconds(kWasapiInitTimeoutMs));
    if (status == std::future_status::timeout) {
        fprintf(
            stderr,
            "[echo-audio-host] WASAPI Start timed out after %dms phase=start\n",
            kWasapiInitTimeoutMs);
        abandon_future(std::move(future));
        return E_PENDING;
    }

    return future.get();
}

} // namespace echo_wasapi_timeout

#endif
