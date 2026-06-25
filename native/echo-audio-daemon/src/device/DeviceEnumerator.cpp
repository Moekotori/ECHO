#include "DeviceEnumerator.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <vector>

#include "miniaudio/miniaudio.h"

// ── Platform-specific headers ──────────────────────────────────────────────
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys.h>
#include <comdef.h>
#include <comutil.h>
#include <wrl/client.h>
#endif

namespace echo_audio_daemon {

// ══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ══════════════════════════════════════════════════════════════════════════

namespace {

/// FNV-1a hash of the raw ma_device_id bytes.
/// This produces a deterministic 64-bit identifier because miniaudio
/// zero-initialises the entire union before populating the relevant member.
static uint64_t hashMaDeviceId(const ma_device_id& id) {
    const auto* data = reinterpret_cast<const uint8_t*>(&id);
    constexpr size_t len = sizeof(ma_device_id);
    uint64_t h = 14695981039346656037ULL;
    for (size_t i = 0; i < len; ++i) {
        h ^= static_cast<uint64_t>(data[i]);
        h *= 1099511628211ULL;
    }
    return h;
}

/// Build a unique string ID for a miniaudio device.
static std::string makeMiniaudioId(const ma_device_id& id) {
    char buf[32]{};  // "miniaudio::" + 16 hex chars + null
    std::snprintf(buf, sizeof(buf), "miniaudio::%016llx",
                  static_cast<unsigned long long>(hashMaDeviceId(id)));
    return buf;
}

// ── Miniaudio shared enumeration ──────────────────────────────────────────

std::vector<DeviceInfo> enumerateMiniaudioShared() {
    ma_context context;
    if (ma_context_init(nullptr, 0, nullptr, &context) != MA_SUCCESS) {
        return {};
    }

    ma_device_info* playbackDevices = nullptr;
    ma_uint32      playbackCount   = 0;

    if (ma_context_get_devices(&context,
                               &playbackDevices, &playbackCount,
                               nullptr, nullptr) != MA_SUCCESS) {
        ma_context_uninit(&context);
        return {};
    }

    std::vector<DeviceInfo> devices;
    devices.reserve(static_cast<size_t>(playbackCount));

    for (ma_uint32 i = 0; i < playbackCount; ++i) {
        const auto& maDev = playbackDevices[i];
        DeviceInfo info;
        info.id                = makeMiniaudioId(maDev.id);
        info.name              = maDev.name;
        info.outputMode        = OutputMode::Shared;
        info.isDefault         = (maDev.isDefault != MA_FALSE);
        // sampleRate / channels filled by ma_context_get_device_info()
        // which requires opening the backend — skip for enumeration.
        info.channels          = 2;  // sensible default
        devices.push_back(std::move(info));
    }

    ma_context_uninit(&context);
    return devices;
}

// ── WASAPI exclusive enumeration (Windows only) ───────────────────────────

#ifdef _WIN32

/// COM heap string → UTF-8 std::string
static std::string wideToUtf8(const wchar_t* wstr) {
    if (!wstr) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0,
                                  nullptr, nullptr);
    if (len <= 0) return {};
    std::string result(static_cast<size_t>(len) - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, result.data(), len,
                        nullptr, nullptr);
    return result;
}

static std::string getDeviceId(IMMDevice* device) {
    if (!device) return {};
    LPWSTR rawId = nullptr;
    if (FAILED(device->GetId(&rawId)) || !rawId) return {};
    std::string id = wideToUtf8(rawId);
    CoTaskMemFree(rawId);
    return id;
}

static std::string getDeviceName(IMMDevice* device) {
    if (!device) return {};
    Microsoft::WRL::ComPtr<IPropertyStore> props;
    if (FAILED(device->OpenPropertyStore(STGM_READ, &props))) return {};

    PROPVARIANT var;
    PropVariantInit(&var);

    static const PROPERTYKEY pkey = {
        {0xa45c254e, 0xdf1c, 0x4efd,
         {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}},
        14
    };

    std::string name;
    if (SUCCEEDED(props->GetValue(pkey, &var)) &&
        var.vt == VT_LPWSTR && var.pwszVal) {
        name = wideToUtf8(var.pwszVal);
    }
    PropVariantClear(&var);
    return name;
}

static int getDeviceMixSampleRate(IMMDevice* device) {
    if (!device) return 0;
    Microsoft::WRL::ComPtr<IAudioClient> audioClient;
    if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL,
                                nullptr, (void**)&audioClient))) {
        return 0;
    }
    WAVEFORMATEX* fmt = nullptr;
    if (FAILED(audioClient->GetMixFormat(&fmt)) || !fmt) {
        if (fmt) CoTaskMemFree(fmt);
        return 0;
    }
    int sr = static_cast<int>(fmt->nSamplesPerSec);
    CoTaskMemFree(fmt);
    return sr;
}

static std::vector<DeviceInfo> enumerateWasapiExclusive() {
    // ── COM initialisation ─────────────────────────────────────────────
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool ownsCom = SUCCEEDED(hr);
    if (!ownsCom && hr != RPC_E_CHANGED_MODE) {
        return {};
    }
    bool canUseCom = ownsCom || (hr == RPC_E_CHANGED_MODE);
    if (!canUseCom) {
        if (ownsCom) CoUninitialize();
        return {};
    }

    // ── Device enumerator ──────────────────────────────────────────────
    Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                          CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) {
        if (ownsCom) CoUninitialize();
        return {};
    }

    // ── Default device ─────────────────────────────────────────────────
    Microsoft::WRL::ComPtr<IMMDevice> defaultDevice;
    LPWSTR defaultIdRaw = nullptr;
    std::string defaultId;
    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(
            eRender, eConsole, &defaultDevice))) {
        if (SUCCEEDED(defaultDevice->GetId(&defaultIdRaw)) && defaultIdRaw) {
            defaultId = wideToUtf8(defaultIdRaw);
            CoTaskMemFree(defaultIdRaw);
        }
    }

    // ── Enumerate endpoints ────────────────────────────────────────────
    Microsoft::WRL::ComPtr<IMMDeviceCollection> collection;
    if (FAILED(enumerator->EnumAudioEndpoints(
            eRender, DEVICE_STATE_ACTIVE, &collection))) {
        if (ownsCom) CoUninitialize();
        return {};
    }

    UINT count = 0;
    if (FAILED(collection->GetCount(&count))) {
        if (ownsCom) CoUninitialize();
        return {};
    }

    std::vector<DeviceInfo> devices;
    devices.reserve(static_cast<size_t>(count));

    for (UINT i = 0; i < count; ++i) {
        Microsoft::WRL::ComPtr<IMMDevice> endpoint;
        if (FAILED(collection->Item(i, &endpoint))) continue;

        std::string devId   = getDeviceId(endpoint.Get());
        std::string devName = getDeviceName(endpoint.Get());
        int mixSr           = getDeviceMixSampleRate(endpoint.Get());

        if (devId.empty()) continue;
        if (devName.empty()) {
            char fallback[64];
            std::snprintf(fallback, sizeof(fallback),
                          "WASAPI Exclusive Device %u", static_cast<unsigned>(i));
            devName = fallback;
        }

        DeviceInfo info;
        info.id                = "wasapi_exclusive::" + devId;
        info.name              = std::move(devName);
        info.outputMode        = OutputMode::Exclusive;
        info.sampleRate        = mixSr;
        info.sharedSampleRate  = mixSr;
        info.channels          = 2;
        info.isDefault         = (!defaultId.empty() && devId == defaultId);
        devices.push_back(std::move(info));
    }

    if (ownsCom) CoUninitialize();
    return devices;
}

#else  // not _WIN32

static std::vector<DeviceInfo> enumerateWasapiExclusive() {
    return {};  // WASAPI exclusive is Windows-only
}

#endif // _WIN32

// ── ASIO enumeration (Windows only, optional) ─────────────────────────────

#ifdef ECHO_ENABLE_ASIO
// When ASIO SDK integration is enabled, we include the ASIO headers and
// use AsioDrivers to enumerate available drivers.
//
// At present the ASIO SDK is not vendored in third_party/, so this path
// serves as a skeleton for future integration.  When compiled without
// ECHO_ENABLE_ASIO the function simply returns an empty list.

/*
#include <asiodrivers.h>
static std::vector<DeviceInfo> enumerateAsioDrivers() {
    AsioDrivers drivers;
    std::vector<DeviceInfo> result;

    char buf[32];
    for (int i = 0; i < drivers.asioGetNumDev(); ++i) {
        if (drivers.asioGetDriverName(i, buf, sizeof(buf)) > 0) {
            DeviceInfo info;
            info.id                = "asio::" + std::string(buf);
            info.name              = buf;
            info.outputMode        = OutputMode::Asio;
            info.isDefault         = (i == 0);
            info.asioOutputChannels = 0;  // would need to load & probe
            result.push_back(std::move(info));
        }
    }
    return result;
}
*/
#endif // ECHO_ENABLE_ASIO

static std::vector<DeviceInfo> enumerateAsioDrivers() {
#if defined(ECHO_ENABLE_ASIO) && defined(_WIN32)
    // When ASIO SDK is properly integrated, replace this block with the
    // AsioDrivers enumeration above.
    // For now we return empty because the SDK is not vendored.
    return {};
#else
    return {};
#endif
}

} // anonymous namespace

// ══════════════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════════════

std::vector<DeviceInfo> DeviceEnumerator::enumerateShared() {
    return enumerateMiniaudioShared();
}

std::vector<DeviceInfo> DeviceEnumerator::enumerateExclusive() {
    return enumerateWasapiExclusive();
}

std::vector<DeviceInfo> DeviceEnumerator::enumerateAsio() {
    return enumerateAsioDrivers();
}

std::vector<DeviceInfo> DeviceEnumerator::enumerateAll() {
    auto shared    = enumerateShared();
    auto exclusive = enumerateExclusive();
    auto asio      = enumerateAsio();

    // Pre-populate the dedup set with shared device names.
    std::set<std::string> seen;
    for (const auto& d : shared) {
        seen.insert(d.name);
    }

    // Append exclusive devices whose names don't collide.
    // (Shared + exclusive from the same physical device get one entry each.)
    for (auto& d : exclusive) {
        if (seen.find(d.name) == seen.end()) {
            seen.insert(d.name);
            shared.push_back(std::move(d));
        } else {
            // Name collision — still append because the mode differs
            shared.push_back(std::move(d));
        }
    }

    // Append ASIO devices (name collisions are unlikely but handled).
    for (auto& d : asio) {
        if (seen.find(d.name) == seen.end()) {
            seen.insert(d.name);
        }
        shared.push_back(std::move(d));
    }

    return shared;
}

DeviceInfo DeviceEnumerator::findById(const std::string& id) {
    if (id.empty()) return {};

    auto all = enumerateAll();
    auto it  = std::find_if(all.begin(), all.end(),
                             [&](const DeviceInfo& d) { return d.id == id; });
    return (it != all.end()) ? *it : DeviceInfo{};
}

DeviceInfo DeviceEnumerator::getDefaultShared() {
    auto shared = enumerateShared();
    auto it     = std::find_if(shared.begin(), shared.end(),
                                [](const DeviceInfo& d) { return d.isDefault; });
    return (it != shared.end()) ? *it : (shared.empty() ? DeviceInfo{} : shared[0]);
}

} // namespace echo_audio_daemon
