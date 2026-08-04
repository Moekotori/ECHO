#define MINIAUDIO_IMPLEMENTATION
#include "HostCommon.h"

namespace
{
#ifdef _WIN32
void logWindowsError(const std::string& action)
{
    logLine(action + " failed: win32=" + std::to_string(static_cast<unsigned long>(GetLastError())));
}

void configureProcessPriority()
{
    if (! SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS))
        logWindowsError("SetPriorityClass(ABOVE_NORMAL_PRIORITY_CLASS)");
}

class ScopedTimerResolution final
{
public:
    ScopedTimerResolution()
        : active(timeBeginPeriod(1) == TIMERR_NOERROR)
    {
        if (! active)
            logLine("timeBeginPeriod(1) failed");
    }

    ~ScopedTimerResolution()
    {
        if (active)
            timeEndPeriod(1);
    }

private:
    bool active = false;
};

class ScopedMmcssRegistration final
{
public:
    ScopedMmcssRegistration(const wchar_t* taskName, AVRT_PRIORITY priority)
    {
        DWORD taskIndex = 0;
        handle = AvSetMmThreadCharacteristicsW(taskName, &taskIndex);
        if (handle == nullptr)
        {
            logWindowsError("AvSetMmThreadCharacteristicsW");
            return;
        }

        if (! AvSetMmThreadPriority(handle, priority))
            logWindowsError("AvSetMmThreadPriority");
    }

    ~ScopedMmcssRegistration()
    {
        if (handle != nullptr)
            AvRevertMmThreadCharacteristics(handle);
    }

private:
    HANDLE handle = nullptr;
};

void configureThreadPriority(const wchar_t* taskName, AVRT_PRIORITY priority)
{
    thread_local std::unique_ptr<ScopedMmcssRegistration> registration;
    if (registration == nullptr)
        registration = std::make_unique<ScopedMmcssRegistration>(taskName, priority);
}

void configureAudioCallbackThread()
{
    configureThreadPriority(L"Pro Audio", AVRT_PRIORITY_CRITICAL);
}
#else
class ScopedTimerResolution final {};

void configureProcessPriority() {}
void configureAudioCallbackThread() {}
#endif

#ifdef _WIN32
std::string wideToUtf8(const wchar_t* value)
{
    if (value == nullptr || value[0] == L'\0')
        return {};
    const int required = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (required <= 1)
        return {};
    std::string result(static_cast<size_t>(required - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), required, nullptr, nullptr);
    return result;
}
#endif

double parseDouble(std::string_view value, double fallback)
{
    if (value.empty())
        return fallback;

    try
    {
        return std::stod(std::string(value));
    }
    catch (...)
    {
        return fallback;
    }
}

std::vector<std::string> getCommandLineArgs(int argc, char* argv[])
{
#ifdef _WIN32
    int wideArgc = 0;
    LPWSTR* wideArgv = CommandLineToArgvW(GetCommandLineW(), &wideArgc);
    std::vector<std::string> wideArgs;

    if (wideArgv != nullptr)
    {
        wideArgs.reserve(static_cast<size_t>(wideArgc));

        for (int i = 0; i < wideArgc; ++i)
            wideArgs.emplace_back(wideToUtf8(wideArgv[i]));

        LocalFree(wideArgv);
        return wideArgs;
    }
#endif

    std::vector<std::string> args;
    args.reserve(static_cast<size_t>(std::max(argc, 0)));

    for (int i = 0; i < argc; ++i)
        args.emplace_back(argv[i] != nullptr ? argv[i] : "");

    return args;
}

Options parseOptions(const std::vector<std::string>& args)
{
    Options options;

    for (size_t i = 1; i < args.size(); ++i)
    {
        const auto arg = args[i];

        if (arg == "-list")
        {
            options.list = true;
        }
        else if (arg == "-exclusive")
        {
            options.exclusive = true;
        }
        else if (arg == "--no-stdin")
        {
            options.noStdin = true;
            options.deviceOpenDeferred = true;
        }
        else if (arg == "-decode-pcm" && i + 1 < args.size())
        {
            options.decodePcm = true;
            options.decodeFile = args[++i];
        }
        else if (arg == "-ss" && i + 1 < args.size())
        {
            options.decodeStartSeconds = std::max(0.0, parseDouble(args[++i], options.decodeStartSeconds));
        }
        else if (arg == "-sr" && i + 1 < args.size())
        {
            options.sampleRate = std::max(1, parseInt(args[++i], options.sampleRate));
        }
        else if (arg == "-ch" && i + 1 < args.size())
        {
            options.channels = std::max(1, std::min(8, parseInt(args[++i], options.channels)));
        }
        else if (arg == "-device-index" && i + 1 < args.size())
        {
            options.deviceIndex = parseInt(args[++i], -1);
        }
        else if (arg == "-device" && i + 1 < args.size())
        {
            options.deviceName = args[++i];
            options.deviceId = options.deviceName;
        }
        else if ((arg == "-buffer" || arg == "-buffer-size") && i + 1 < args.size())
        {
            options.bufferSize = std::max(0, parseInt(args[++i], options.bufferSize));
        }
        else if (arg == "-fifo-ms" && i + 1 < args.size())
        {
            options.fifoCapacityMs = std::max(0, parseInt(args[++i], options.fifoCapacityMs));
        }
        else if (arg == "-prebuffer-ms" && i + 1 < args.size())
        {
            options.startupPrebufferMsSpecified = true;
            options.startupPrebufferMs = std::max(0, parseInt(args[++i], options.startupPrebufferMs));
        }
        else if (arg == "-prebuffer-timeout-ms" && i + 1 < args.size())
        {
            options.startupPrebufferTimeoutMsSpecified = true;
            options.startupPrebufferTimeoutMs = std::max(0, parseInt(args[++i], options.startupPrebufferTimeoutMs));
        }
        else if (arg == "-eq-port" && i + 1 < args.size())
        {
            options.eqControlPort = std::max(0, parseInt(args[++i], options.eqControlPort));
        }
        else if (arg == "--rpc-stdin-fd" && i + 1 < args.size())
        {
            options.rpcStdinFd = std::max(0, parseInt(args[++i], options.rpcStdinFd));
        }
        else if (arg == "--rpc-stdout-fd" && i + 1 < args.size())
        {
            options.rpcStdoutFd = std::max(0, parseInt(args[++i], options.rpcStdoutFd));
        }
        else if (arg == "-vol" && i + 1 < args.size())
        {
            options.volume = std::max(0.0, std::min(1.0, parseDouble(args[++i], options.volume)));
        }
        else if (arg == "-shared-backend" && i + 1 < args.size())
        {
            auto value = args[++i];
            std::transform(value.begin(), value.end(), value.begin(), [] (unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            if (value == "auto" || value == "windows" || value == "directsound" || value == "alsa" || value == "miniaudio")
                options.sharedBackend = value;
        }
    }

    return options;
}

void writeErrorEvent(const std::string& message, const std::string& reason = "runtime_error")
{
    writeJsonLine(
        "{\"event\":\"error\",\"reason\":\"" + jsonEscape(reason)
        + "\",\"message\":\"" + jsonEscape(message) + "\"}");
}

int getDeviceBufferSize(const Options& options)
{
    if (options.bufferSize > 0)
        return options.bufferSize;

    return 256;
}

int framesForMilliseconds(int sampleRate, int milliseconds)
{
    if (sampleRate <= 0 || milliseconds <= 0)
        return 0;

    return std::max(1, static_cast<int>(std::round((static_cast<double>(sampleRate) * milliseconds) / 1000.0)));
}

int getFifoCapacityFrames(const Options& options, int sampleRate)
{
    const int requestedFrames = framesForMilliseconds(sampleRate, options.fifoCapacityMs);

    if (requestedFrames > 0)
        return std::max(requestedFrames, getDeviceBufferSize(options) * 2);

    if (options.exclusive && sampleRate >= 176400)
        return framesForMilliseconds(sampleRate, 750);

    return std::max(sampleRate / 5, 4096);
}

int getStartupPrebufferFrames(const Options& options, int sampleRate)
{
    if (options.startupPrebufferMsSpecified)
        return framesForMilliseconds(sampleRate, options.startupPrebufferMs);

    const int requestedFrames = framesForMilliseconds(sampleRate, options.startupPrebufferMs);

    if (requestedFrames > 0)
        return requestedFrames;

    if (options.exclusive && sampleRate >= 176400)
        return framesForMilliseconds(sampleRate, 180);

    if (options.exclusive || options.asio)
        return std::max(1, std::min(sampleRate / 50, 4096));

    return 0;
}

int getStartupPrebufferTimeoutMs(const Options& options)
{
    if (options.startupPrebufferTimeoutMsSpecified)
        return options.startupPrebufferTimeoutMs;

    if (options.startupPrebufferTimeoutMs > 0)
        return options.startupPrebufferTimeoutMs;

    return 300;
}

#ifdef _WIN32
const PROPERTYKEY echoPkeyDeviceFriendlyName = {
    { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } },
    14
};

class ScopedComInitializer final
{
public:
    ScopedComInitializer()
    {
        result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        ownsInitialisation = SUCCEEDED(result);
    }

    ~ScopedComInitializer()
    {
        if (ownsInitialisation)
            CoUninitialize();
    }

    bool canUseCom() const
    {
        return SUCCEEDED(result) || result == RPC_E_CHANGED_MODE;
    }

private:
    HRESULT result = E_FAIL;
    bool ownsInitialisation = false;
};

struct CoreAudioEndpoint
{
    std::string id;
    std::string name;
    int mixSampleRate = 0;
    bool isDefault = false;
};

std::string getEndpointId(IMMDevice* device)
{
    if (device == nullptr)
        return {};

    LPWSTR rawId = nullptr;
    if (FAILED(device->GetId(&rawId)) || rawId == nullptr)
    {
        if (rawId != nullptr)
            CoTaskMemFree(rawId);
        return {};
    }

    std::string id = wideToUtf8(rawId);
    CoTaskMemFree(rawId);
    return id;
}

std::string getEndpointFriendlyName(IMMDevice* device)
{
    if (device == nullptr)
        return {};

    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (FAILED(device->OpenPropertyStore(STGM_READ, properties.GetAddressOf())))
        return {};

    PROPVARIANT value;
    PropVariantInit(&value);

    std::string name;
    if (SUCCEEDED(properties->GetValue(echoPkeyDeviceFriendlyName, &value)) && value.vt == VT_LPWSTR && value.pwszVal != nullptr)
        name = wideToUtf8(value.pwszVal);

    PropVariantClear(&value);
    return name;
}

int getEndpointMixSampleRate(IMMDevice* device)
{
    if (device == nullptr)
        return 0;

    Microsoft::WRL::ComPtr<IAudioClient> audioClient;
    if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(audioClient.GetAddressOf()))))
        return 0;

    WAVEFORMATEX* mixFormat = nullptr;
    if (FAILED(audioClient->GetMixFormat(&mixFormat)) || mixFormat == nullptr)
    {
        if (mixFormat != nullptr)
            CoTaskMemFree(mixFormat);
        return 0;
    }

    const int sampleRate = mixFormat->nSamplesPerSec > 0
        ? static_cast<int>(mixFormat->nSamplesPerSec)
        : 0;
    CoTaskMemFree(mixFormat);
    return sampleRate;
}

std::string getDefaultEndpointId(IMMDeviceEnumerator& enumerator)
{
    Microsoft::WRL::ComPtr<IMMDevice> defaultDevice;

    if (SUCCEEDED(enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia, defaultDevice.GetAddressOf())))
        return getEndpointId(defaultDevice.Get());

    defaultDevice.Reset();
    if (SUCCEEDED(enumerator.GetDefaultAudioEndpoint(eRender, eConsole, defaultDevice.GetAddressOf())))
        return getEndpointId(defaultDevice.Get());

    return {};
}

std::vector<CoreAudioEndpoint> enumerateCoreAudioRenderEndpoints()
{
    ScopedComInitializer com;
    if (! com.canUseCom())
        return {};

    Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(
            __uuidof(MMDeviceEnumerator),
            nullptr,
            CLSCTX_ALL,
            IID_PPV_ARGS(enumerator.GetAddressOf()))))
        return {};

    const auto defaultId = getDefaultEndpointId(*enumerator.Get());

    Microsoft::WRL::ComPtr<IMMDeviceCollection> collection;
    if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, collection.GetAddressOf())))
        return {};

    UINT count = 0;
    if (FAILED(collection->GetCount(&count)))
        return {};

    std::vector<CoreAudioEndpoint> endpoints;
    endpoints.reserve(count);

    for (UINT i = 0; i < count; ++i)
    {
        Microsoft::WRL::ComPtr<IMMDevice> endpoint;
        if (FAILED(collection->Item(i, endpoint.GetAddressOf())))
            continue;

        const auto id = getEndpointId(endpoint.Get());
        endpoints.push_back({
            id,
            getEndpointFriendlyName(endpoint.Get()),
            getEndpointMixSampleRate(endpoint.Get()),
            ! defaultId.empty() && id == defaultId,
        });
    }

    return endpoints;
}

bool isCoreAudioEndpointNameMatch(const std::string& endpointName, const std::string& deviceName)
{
    return ! endpointName.empty()
        && ! deviceName.empty()
        && (endpointName == deviceName
            || containsIgnoreCase(endpointName, deviceName)
            || containsIgnoreCase(deviceName, endpointName));
}

const CoreAudioEndpoint* findCoreAudioEndpoint(
    const std::vector<CoreAudioEndpoint>& endpoints,
    const DeviceDescriptor& device)
{
    auto exact = std::find_if(endpoints.begin(), endpoints.end(), [&] (const CoreAudioEndpoint& endpoint)
    {
        return endpoint.name == device.name;
    });

    if (exact != endpoints.end())
        return &*exact;

    auto loose = std::find_if(endpoints.begin(), endpoints.end(), [&] (const CoreAudioEndpoint& endpoint)
    {
        return isCoreAudioEndpointNameMatch(endpoint.name, device.name);
    });

    return loose != endpoints.end() ? &*loose : nullptr;
}

int getFallbackSharedSampleRate()
{
    return 48000;
}

void applyCoreAudioSharedSampleRates(std::vector<DeviceDescriptor>& devices)
{
    const auto endpoints = enumerateCoreAudioRenderEndpoints();
    const auto defaultEndpoint = std::find_if(endpoints.begin(), endpoints.end(), [] (const CoreAudioEndpoint& endpoint)
    {
        return endpoint.isDefault && endpoint.mixSampleRate > 0;
    });

    for (auto& device : devices)
    {
        int sampleRate = 0;

        if (const auto* endpoint = findCoreAudioEndpoint(endpoints, device))
        {
            sampleRate = endpoint->mixSampleRate;
            device.isDefault = device.isDefault || endpoint->isDefault;
        }

        if (sampleRate <= 0 && device.isDefault && defaultEndpoint != endpoints.end())
            sampleRate = defaultEndpoint->mixSampleRate;

        if (sampleRate <= 0)
            sampleRate = getFallbackSharedSampleRate();

        device.sampleRate = sampleRate;
        device.sharedSampleRate = sampleRate;
    }
}

#else
int getFallbackSharedSampleRate()
{
    return 48000;
}

void applyCoreAudioSharedSampleRates(std::vector<DeviceDescriptor>& devices)
{
    for (auto& device : devices)
    {
        if (device.sharedSampleRate <= 0)
            device.sharedSampleRate = getFallbackSharedSampleRate();

        if (device.sampleRate <= 0)
            device.sampleRate = device.sharedSampleRate;
    }
}
#endif


struct MiniaudioContextScope
{
    ma_context context{};
    bool initialized = false;

    ~MiniaudioContextScope()
    {
        if (initialized)
            ma_context_uninit(&context);
    }
};

bool initMiniaudioSharedContext(ma_context& context, std::string& error)
{
#ifdef _WIN32
    const ma_backend backends[] = { ma_backend_wasapi };
    const ma_result result = ma_context_init(backends, 1, nullptr, &context);
#else
    const ma_result result = ma_context_init(nullptr, 0, nullptr, &context);
#endif
    if (result != MA_SUCCESS)
    {
        error = std::string("miniaudio shared context init failed: ") + ma_result_description(result);
        return false;
    }
    return true;
}

bool initMiniaudioSharedContext(MiniaudioContextScope& scope, std::string& error)
{
    if (! initMiniaudioSharedContext(scope.context, error))
        return false;
    scope.initialized = true;
    return true;
}

int pickMiniaudioDeviceSampleRate(const ma_device_info& info)
{
    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
        if (info.nativeDataFormats[i].sampleRate == 48000)
            return 48000;
    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
        if (info.nativeDataFormats[i].sampleRate > 0)
            return static_cast<int>(info.nativeDataFormats[i].sampleRate);
    return getFallbackSharedSampleRate();
}

int pickMiniaudioDeviceChannels(const ma_device_info& info)
{
    for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
        if (info.nativeDataFormats[i].channels > 0)
            return static_cast<int>(info.nativeDataFormats[i].channels);
    return 0;
}

std::string getMiniaudioStableId(int index)
{
    return "shared:" + std::to_string(index);
}

std::string normalizeMiniaudioSelection(std::string_view value)
{
    std::string normalized;
    for (const unsigned char ch : std::string(value))
        if (! std::isspace(ch))
            normalized.push_back(static_cast<char>(std::tolower(ch)));
    return normalized;
}

bool isMiniaudioSelectionMatch(const ma_device_info& info, int index, std::string_view requested)
{
    if (requested.empty())
        return false;
    const std::string requestedText(requested);
    if (requestedText == getMiniaudioStableId(index))
        return true;
    const std::string candidateName(info.name);
    if (candidateName == requestedText || containsIgnoreCase(candidateName, requestedText))
        return true;
    const auto normalizedRequested = normalizeMiniaudioSelection(requested);
    const auto normalizedName = normalizeMiniaudioSelection(info.name);
    return ! normalizedRequested.empty()
        && ! normalizedName.empty()
        && (normalizedName == normalizedRequested
            || normalizedName.find(normalizedRequested) != std::string::npos
            || normalizedRequested.find(normalizedName) != std::string::npos);
}

std::vector<DeviceDescriptor> enumerateMiniaudioSharedDevices(std::string_view sharedBackend, std::string* error = nullptr)
{
    std::vector<DeviceDescriptor> devices;
    if (sharedBackend == "directsound" || sharedBackend == "alsa")
        return devices;

    MiniaudioContextScope scope;
    std::string contextError;
    if (! initMiniaudioSharedContext(scope, contextError))
    {
        if (error != nullptr)
            *error = contextError;
        return devices;
    }

    ma_device_info* playbackDevices = nullptr;
    ma_uint32 playbackDeviceCount = 0;
    const ma_result result = ma_context_get_devices(&scope.context, &playbackDevices, &playbackDeviceCount, nullptr, nullptr);
    if (result != MA_SUCCESS)
    {
        if (error != nullptr)
            *error = std::string("miniaudio shared device enumeration failed: ") + ma_result_description(result);
        return devices;
    }

    devices.reserve(playbackDeviceCount);
    for (ma_uint32 i = 0; i < playbackDeviceCount; ++i)
    {
        const int index = static_cast<int>(i);
        const int sampleRate = pickMiniaudioDeviceSampleRate(playbackDevices[i]);
        DeviceDescriptor descriptor;
        descriptor.index = index;
        descriptor.typeName = "miniaudio-shared";
        descriptor.name = playbackDevices[i].name;
        descriptor.sampleRate = sampleRate;
        descriptor.sharedSampleRate = sampleRate;
        descriptor.isDefault = playbackDevices[i].isDefault != 0;
        descriptor.isAsio = false;
        descriptor.asioOutputChannels = pickMiniaudioDeviceChannels(playbackDevices[i]);
        descriptor.stableId = getMiniaudioStableId(index);
        devices.push_back(descriptor);
    }

    applyCoreAudioSharedSampleRates(devices);
    return devices;
}

std::vector<DeviceDescriptor> enumerateDevices(
    DeviceListMode mode,
    std::string_view sharedBackend = "auto")
{
    if (mode == DeviceListMode::Shared)
    {
        std::string miniaudioError;
        auto devices = enumerateMiniaudioSharedDevices(sharedBackend, &miniaudioError);
        if (devices.empty() && ! miniaudioError.empty())
            logLine(miniaudioError);
        return devices;
    }

    return {};
}

int listDevices(const Options& options)
{
    const auto mode = DeviceListMode::Shared;
    const auto devices = enumerateDevices(mode, options.sharedBackend);

    for (const auto& device : devices)
    {
        std::cout
            << device.index << "\t"
            << device.name << "\t"
            << device.sampleRate << "\t"
            << (device.isDefault ? 1 : 0) << "\t"
            << device.sharedSampleRate
            << std::endl;
    }

    return 0;
}

constexpr size_t maxAutomixPcmPayloadBytes = 64 * 1024;
constexpr size_t maxPendingAutomixPcmBytes = 1024 * 1024;

void pushAutomixNextPcmPayload(PcmRingAudioSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    if (payload.size() > maxAutomixPcmPayloadBytes || pending.size() + payload.size() > maxPendingAutomixPcmBytes)
    {
        pending.clear();
        return;
    }
    const size_t frameBytes = static_cast<size_t>(channels) * sizeof(float);
    if (frameBytes == 0)
        return;
    pending.insert(pending.end(), payload.begin(), payload.end());
    const size_t frameCount = pending.size() / frameBytes;
    if (frameCount == 0)
        return;
    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    std::vector<float> samples(sampleCount);
    std::memcpy(samples.data(), pending.data(), sampleCount * sizeof(float));
    if (! source.pushAutomixNext(samples.data(), static_cast<int>(frameCount)))
        return;
    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(sampleCount * sizeof(float)));
}

double getJsonDouble(const echo_audio_host::Json& object, const char* key, double fallback)
{
    return echo_audio_host::jsonDoubleValue(object, key, fallback);
}

void prepareAutomixFromPayload(PcmRingAudioSource& source, double sampleRate, const std::vector<char>& payload)
{
    if (payload.empty())
        return;
    const auto object = echo_audio_host::parseJson(std::string_view(payload.data(), payload.size()));
    if (! object.is_object())
        return;
    source.prepareAutomix(
        sampleRate,
        getJsonDouble(object, "fadeStartSeconds", 0.0),
        getJsonDouble(object, "overlapSeconds", 0.001),
        getJsonDouble(object, "currentGainDb", 0.0),
        getJsonDouble(object, "nextGainDb", 0.0));
}

int base64Value(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

bool decodeBase64Payload(std::string_view text, std::vector<char>& output)
{
    output.clear();
    const int length = static_cast<int>(text.size());
    if (length == 0)
        return true;
    if ((length % 4) != 0)
        return false;
    int padding = 0;
    bool sawPadding = false;
    for (int i = 0; i < length; ++i)
    {
        const char c = text[static_cast<size_t>(i)];
        if (c == '=')
        {
            sawPadding = true;
            ++padding;
            if (padding > 2)
                return false;
            continue;
        }
        if (sawPadding || base64Value(c) < 0)
            return false;
    }
    if (padding > 0 && text[static_cast<size_t>(length - 1)] != '=')
        return false;
    if (padding == 2 && text[static_cast<size_t>(length - 2)] != '=')
        return false;
    int accumulator = 0;
    int bits = -8;
    for (int i = 0; i < length; ++i)
    {
        const char c = text[static_cast<size_t>(i)];
        if (c == '=')
            break;
        accumulator = (accumulator << 6) | base64Value(c);
        bits += 6;
        if (bits >= 0)
        {
            output.push_back(static_cast<char>((accumulator >> bits) & 0xff));
            bits -= 8;
        }
    }
    return output.size() <= maxAutomixPcmPayloadBytes;
}

uint64_t getJsonSessionId(const echo_audio_host::Json& object)
{
    if (! object.is_object() || ! object.contains("sessionId") || ! object["sessionId"].is_number())
        return 0;
    const double parsed = object["sessionId"].get<double>();
    const double integral = std::floor(parsed);
    return std::isfinite(parsed) && parsed > 0.0 && std::abs(parsed - integral) < std::numeric_limits<double>::epsilon()
        ? static_cast<uint64_t>(integral)
        : 0;
}

void writeJsonRpcFd(int fd, const char* data, size_t bytes);

int64_t getJsonRpcIntegerId(const echo_audio_host::Json& object)
{
    if (! object.is_object() || ! object.contains("id") || ! object["id"].is_number())
        return -1;
    const double parsed = object["id"].get<double>();
    const double integral = std::floor(parsed);
    return std::isfinite(parsed) && parsed >= 0.0 && std::abs(parsed - integral) < std::numeric_limits<double>::epsilon()
        ? static_cast<int64_t>(integral)
        : -1;
}

const echo_audio_host::Json* getJsonObjectParams(const echo_audio_host::Json& params)
{
    if (params.is_object())
        return &params;
    if (params.is_array() && ! params.empty() && params[0].is_object())
        return &params[0];
    return nullptr;
}

void writeJsonRpcBooleanResult(int stdoutFd, int64_t id, bool result)
{
    if (id < 0)
        return;
    const std::string response = std::string("{\"jsonrpc\":\"2.0\",\"result\":")
        + (result ? "true" : "false")
        + ",\"id\":" + std::to_string(id) + "}\n";
    writeJsonRpcFd(stdoutFd, response.data(), response.size());
}

std::string getJsonString(const echo_audio_host::Json& object, const char* key, std::string_view fallback = {})
{
    return echo_audio_host::jsonStringValue(object, key, fallback);
}

class EqControlServer final
{
public:
    EqControlServer(
        int portToUse,
        echo::EqProcessor& processorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse)
        : port(portToUse), processor(processorToUse), channelBalanceProcessor(channelBalanceProcessorToUse)
    {
    }

    EqControlServer(
        int portToUse,
        echo::EqProcessor& processorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse,
        echo::ConvolutionProcessor& convolutionProcessorToUse,
        echo::DspHeadroomProcessor& headroomProcessorToUse,
        echo::ReplayGainProcessor& replayGainProcessorToUse,
        echo::PlaybackRateProcessor& rateProcessorToUse,
        echo::LevelMeterProcessor& meterProcessorToUse)
        : port(portToUse), processor(processorToUse), channelBalanceProcessor(channelBalanceProcessorToUse),
          convolutionProcessor(&convolutionProcessorToUse), headroomProcessor(&headroomProcessorToUse),
          replayGainProcessor(&replayGainProcessorToUse), rateProcessor(&rateProcessorToUse), meterProcessor(&meterProcessorToUse)
    {
    }

    ~EqControlServer() { stop(); }

    bool start()
    {
        if (port <= 0)
            return false;
        logLine("EQ control listener unavailable in native audio-host build");
        return false;
    }

    void stop()
    {
        running.store(false, std::memory_order_release);
        if (worker.joinable())
            worker.join();
    }

private:
    const int port = 0;
    echo::EqProcessor& processor;
    echo::ChannelBalanceProcessor& channelBalanceProcessor;
    echo::ConvolutionProcessor* convolutionProcessor = nullptr;
    echo::DspHeadroomProcessor* headroomProcessor = nullptr;
    echo::ReplayGainProcessor* replayGainProcessor = nullptr;
    echo::PlaybackRateProcessor* rateProcessor = nullptr;
    echo::LevelMeterProcessor* meterProcessor = nullptr;
    std::thread worker;
    std::atomic<bool> running { false };
};

template <typename StopSource, typename StopBackend, typename StopControl>
void cleanupHostAndAck(StopSource&& stopSource, StopBackend&& stopBackend, StopControl&& stopControl, bool& shutdownAckSent)
{
    std::forward<StopSource>(stopSource)();
    std::forward<StopBackend>(stopBackend)();
    std::forward<StopControl>(stopControl)();
    if (! shutdownAckSent)
    {
        writeJsonLine("{\"event\":\"shutdown-ack\"}");
        shutdownAckSent = true;
    }
}

template <typename StopSource, typename StopBackend>
void cleanupHostAndAck(StopSource&& stopSource, StopBackend&& stopBackend, bool& shutdownAckSent)
{
    cleanupHostAndAck(std::forward<StopSource>(stopSource), std::forward<StopBackend>(stopBackend), [] {}, shutdownAckSent);
}

void cleanupPcmSource(PcmRingAudioSource& source)
{
    try { source.requestStop(); }
    catch (const std::exception& error) { logLine(std::string("source.requestStop cleanup failed: ") + error.what()); }
    catch (...) { logLine("source.requestStop cleanup failed"); }
}

void cleanupEqControlServer(EqControlServer& eqControlServer)
{
    try { eqControlServer.stop(); }
    catch (const std::exception& error) { logLine(std::string("eqControlServer.stop cleanup failed: ") + error.what()); }
    catch (...) { logLine("eqControlServer.stop cleanup failed"); }
}

struct MiniaudioSharedOutput
{
    ma_context context{};
    PcmRingAudioSource* source = nullptr;
    ma_device device{};
    std::string deviceName;
    int deviceIndex = -1;
    int deviceNativeChannels = 0;
    ma_device_id selectedDeviceId{};
    bool contextInitialized = false;
    bool initialized = false;
    bool started = false;
};

void miniaudioSharedDataCallback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount)
{
    (void)pInput;
    auto* output = static_cast<float*>(pOutput);
    const auto outputChannels = pDevice != nullptr ? pDevice->playback.channels : 0;
    if (output == nullptr || outputChannels == 0)
        return;
    auto* state = pDevice != nullptr ? static_cast<MiniaudioSharedOutput*>(pDevice->pUserData) : nullptr;
    if (state == nullptr || state->source == nullptr)
    {
        std::memset(output, 0, static_cast<size_t>(frameCount) * outputChannels * sizeof(float));
        return;
    }
    configureAudioCallbackThread();
    state->source->renderInterleaved(output, frameCount, outputChannels);
}

bool initMiniaudioSharedOutput(MiniaudioSharedOutput& output, PcmRingAudioSource& source, const Options& options,
    int sampleRate, int channels, int bufferFrames, std::string& error)
{
    output.source = &source;
    if (! initMiniaudioSharedContext(output.context, error))
    {
        output.source = nullptr;
        return false;
    }
    output.contextInitialized = true;

    ma_device_info* playbackDevices = nullptr;
    ma_uint32 playbackDeviceCount = 0;
    ma_result result = ma_context_get_devices(&output.context, &playbackDevices, &playbackDeviceCount, nullptr, nullptr);
    if (result != MA_SUCCESS)
    {
        error = std::string("miniaudio shared device enumeration failed: ") + ma_result_description(result);
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
        output.source = nullptr;
        return false;
    }

    const ma_device_info* selectedDevice = nullptr;
    if (options.deviceIndex >= 0)
    {
        if (static_cast<ma_uint32>(options.deviceIndex) >= playbackDeviceCount)
        {
            error = "miniaudio shared device index not found: " + std::to_string(options.deviceIndex);
            ma_context_uninit(&output.context);
            output.contextInitialized = false;
            output.source = nullptr;
            return false;
        }
        selectedDevice = &playbackDevices[options.deviceIndex];
    }
    if (! options.deviceName.empty())
    {
        const auto requested = std::string_view(options.deviceName);
        auto found = std::find_if(playbackDevices, playbackDevices + playbackDeviceCount, [&] (const ma_device_info& info)
        {
            const auto index = static_cast<int>(&info - playbackDevices);
            return isMiniaudioSelectionMatch(info, index, requested);
        });
        if (found == playbackDevices + playbackDeviceCount)
        {
            error = "miniaudio shared device not found: " + options.deviceName;
            ma_context_uninit(&output.context);
            output.contextInitialized = false;
            output.source = nullptr;
            return false;
        }
        selectedDevice = found;
    }
    if (selectedDevice != nullptr)
    {
        output.selectedDeviceId = selectedDevice->id;
        output.deviceIndex = static_cast<int>(selectedDevice - playbackDevices);
        output.deviceName = selectedDevice->name;
        output.deviceNativeChannels = pickMiniaudioDeviceChannels(*selectedDevice);
    }

    auto config = ma_device_config_init(ma_device_type_playback);
    const ma_device_id* selectedDeviceId = selectedDevice != nullptr ? &output.selectedDeviceId : nullptr;
    config.playback.format = ma_format_f32;
    config.playback.channels = static_cast<ma_uint32>(std::max(1, channels));
    config.playback.pDeviceID = selectedDeviceId;
    config.playback.shareMode = ma_share_mode_shared;
    config.sampleRate = static_cast<ma_uint32>(std::max(1, sampleRate));
    config.periodSizeInFrames = static_cast<ma_uint32>(std::max(1, bufferFrames));
    config.performanceProfile = ma_performance_profile_low_latency;
    config.dataCallback = miniaudioSharedDataCallback;
    config.pUserData = &output;

    result = ma_device_init(&output.context, &config, &output.device);
    if (result != MA_SUCCESS)
    {
        error = std::string("ma_device_init failed: ") + ma_result_description(result);
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
        output.source = nullptr;
        return false;
    }
    output.initialized = true;
    const auto nativeRate = output.device.sampleRate > 0 ? output.device.sampleRate : config.sampleRate;
    const auto nativeBufferFrames = output.device.playback.internalPeriodSizeInFrames > 0
        ? static_cast<int>(output.device.playback.internalPeriodSizeInFrames)
        : std::max(1, bufferFrames);
    source.prepareForNativeRender(nativeBufferFrames, static_cast<double>(nativeRate));

    result = ma_device_start(&output.device);
    if (result != MA_SUCCESS)
    {
        error = std::string("ma_device_start failed: ") + ma_result_description(result);
        ma_device_uninit(&output.device);
        output.initialized = false;
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
        output.source = nullptr;
        return false;
    }
    output.started = true;
    return true;
}

void stopMiniaudioSharedOutput(MiniaudioSharedOutput& output)
{
    output.source = nullptr;
    if (output.started)
    {
        ma_device_stop(&output.device);
        output.started = false;
    }
    if (output.initialized)
    {
        ma_device_uninit(&output.device);
        output.initialized = false;
    }
    if (output.contextInitialized)
    {
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
    }
}

void cleanupMiniaudioSharedAndAck(PcmRingAudioSource& source, MiniaudioSharedOutput& output, EqControlServer& eqControlServer, bool& shutdownAckSent)
{
    cleanupHostAndAck(
        [&] { cleanupPcmSource(source); },
        [&]
        {
            try { stopMiniaudioSharedOutput(output); }
            catch (const std::exception& error) { logLine(std::string("miniaudio cleanup failed: ") + error.what()); }
            catch (...) { logLine("miniaudio cleanup failed"); }
        },
        [&] { cleanupEqControlServer(eqControlServer); },
        shutdownAckSent);
}

int runLibavDecodePcm(const Options& options)
{
    if (options.decodeFile.empty())
        throw std::runtime_error("libav decode failed: missing input file");

#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    echo::LibavPcmStreamDecoder decoder;
    decoder.open(options.decodeFile);

    const int sourceSampleRate = decoder.sampleRate();
    if (sourceSampleRate <= 0)
        throw std::runtime_error("libav decode failed: source sample rate unavailable");

    if (sourceSampleRate != options.sampleRate)
        throw std::runtime_error("libav decode resampling unsupported: source=" + std::to_string(sourceSampleRate) + " requested=" + std::to_string(options.sampleRate));

    const int sourceChannels = decoder.channels();
    if (sourceChannels <= 0 || sourceChannels > 2)
        throw std::runtime_error("libav decode unsupported channel count: " + std::to_string(sourceChannels));

    if (sourceChannels != options.channels)
        throw std::runtime_error("libav decode channel remap unsupported: source=" + std::to_string(sourceChannels) + " requested=" + std::to_string(options.channels));

    if (options.decodeStartSeconds > 0.0)
        decoder.seek(options.decodeStartSeconds);

    constexpr int blockFrames = 4096;
    while (! decoder.eof())
    {
        auto chunk = decoder.readFrames(blockFrames);
        if (chunk.frames <= 0)
            break;
        const auto bytes = static_cast<std::streamsize>(chunk.frames * sourceChannels * static_cast<int>(sizeof(float)));
        std::cout.write(reinterpret_cast<const char*>(chunk.samples.data()), bytes);
        if (! std::cout.good())
            throw std::runtime_error("libav decode failed while writing PCM");
    }

    return 0;
}

int readJsonRpcFd(int fd, char* buffer, size_t bytes)
{
#ifdef _WIN32
    const intptr_t osHandle = _get_osfhandle(fd);
    if (osHandle == -1)
    {
        errno = EBADF;
        return -1;
    }

    DWORD available = 0;
    if (! PeekNamedPipe(reinterpret_cast<HANDLE>(osHandle), nullptr, 0, nullptr, &available, nullptr))
    {
        const auto error = GetLastError();
        if (error == ERROR_BROKEN_PIPE || error == ERROR_HANDLE_EOF)
            return 0;

        errno = EAGAIN;
        return -1;
    }

    if (available == 0)
    {
        errno = EAGAIN;
        return -1;
    }

    const auto bytesToRead = static_cast<unsigned int>(std::min<size_t>(bytes, available));
    return _read(fd, buffer, bytesToRead);
#else
    const auto result = read(fd, buffer, bytes);
    if (result > static_cast<ssize_t>(std::numeric_limits<int>::max()))
        return std::numeric_limits<int>::max();
    return static_cast<int>(result);
#endif
}

void writeJsonRpcFd(int fd, const char* data, size_t bytes)
{
#ifdef _WIN32
    _write(fd, data, static_cast<unsigned int>(bytes));
#else
    write(fd, data, bytes);
#endif
}

std::string formatMiniaudioDeviceJson(const ma_device_info& info, ma_uint32 index)
{
    std::string json = "{";
    json += "\"id\":\"" + getMiniaudioStableId(static_cast<int>(index)) + "\"";
    json += ",\"name\":\"" + jsonEscape(info.name) + "\"";

    std::string sampleRates = "[";
    {
        std::set<int> rates;
        for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
            if (info.nativeDataFormats[i].sampleRate > 0)
                rates.insert(static_cast<int>(info.nativeDataFormats[i].sampleRate));
        bool first = true;
        for (int sr : rates)
        {
            if (!first) sampleRates += ",";
            sampleRates += std::to_string(sr);
            first = false;
        }
    }
    sampleRates += "]";
    json += ",\"sampleRates\":" + sampleRates;

    std::string channels = "[";
    {
        std::set<int> chs;
        for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i)
            if (info.nativeDataFormats[i].channels > 0)
                chs.insert(static_cast<int>(info.nativeDataFormats[i].channels));
        bool first = true;
        for (int ch : chs)
        {
            if (!first) channels += ",";
            channels += std::to_string(ch);
            first = false;
        }
    }
    channels += "]";
    json += ",\"channels\":" + channels;
    json += ",\"modes\":[\"shared\"]";
    json += ",\"isDefault\":" + std::string(info.isDefault ? "true" : "false");
    json += "}";
    return json;
}

void runJsonRpcOnStdio(
    int stdinFd,
    int stdoutFd,
    echo::EqProcessor& eq,
    echo::ChannelBalanceProcessor& cb,
    echo::ConvolutionProcessor& conv,
    echo::DspHeadroomProcessor& headroom,
    echo::ReplayGainProcessor& rg,
    echo::PlaybackRateProcessor& rate,
    echo::LevelMeterProcessor& meter,
    std::atomic<bool>& running,
    PcmRingAudioSource* audioSource = nullptr,
    double audioSampleRate = 0.0,
    int audioChannels = 0,
    std::function<bool(int sampleRate, int channels, int bufferFrames, std::string& error)>* deferredDeviceInit = nullptr,
    std::atomic<bool>* deviceOpened = nullptr)
{
#ifndef _WIN32
    fcntl(stdinFd, F_SETFL, fcntl(stdinFd, F_GETFL) | O_NONBLOCK);
#endif

    std::string pending;
    std::vector<char> pendingAutomixPcm;
    char buf[4096];

    while (running.load(std::memory_order_acquire))
    {
        const int n = readJsonRpcFd(stdinFd, buf, sizeof(buf));
        if (n > 0)
        {
            pending.append(buf, static_cast<size_t>(n));
            size_t nl;
            while ((nl = pending.find('\n')) != std::string::npos)
            {
                std::string line = pending.substr(0, nl);
                pending.erase(0, nl + 1);
                if (!line.empty())
                {
                    if (audioSource != nullptr)
                    {
                        echo_audio_host::Json object;
                        try { object = echo_audio_host::parseJson(line); }
                        catch (...) { object = echo_audio_host::Json::object(); }
                        const echo_audio_host::Json emptyParams = echo_audio_host::Json::object();
                        const auto& params = object.is_object() && object.contains("params") ? object["params"] : emptyParams;
                        const auto* paramsObject = getJsonObjectParams(params);
                        const auto method = getJsonString(object, "method", {});
                        const bool sessionBeginMethod = method == "audio.sessionBegin";
                        const bool automixMethod = method == "audio.automixPrepare"
                            || method == "audio.automixNext"
                            || method == "audio.automixNextEnd"
                            || method == "audio.automixCancel";
                        const auto sessionId = (sessionBeginMethod || automixMethod) ? getJsonSessionId(paramsObject != nullptr ? *paramsObject : emptyParams) : 0;
                        const bool sessionMatches = automixMethod
                            && sessionId != 0
                            && sessionId == audioSource->session_.generation();

                        if (sessionBeginMethod)
                        {
                            if (deferredDeviceInit != nullptr && deviceOpened != nullptr && !deviceOpened->load(std::memory_order_acquire))
                            {
                                const int sr = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "sr", audioSampleRate)) : static_cast<int>(audioSampleRate);
                                const int ch = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "ch", static_cast<double>(audioChannels))) : audioChannels;
                                const int buffer = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "buffer", 0)) : 0;
                                std::string error;
                                if (!(*deferredDeviceInit)(sr, ch, buffer, error))
                                {
                                    const auto rpcId = getJsonRpcIntegerId(object);
                                    if (rpcId >= 0)
                                    {
                                        const std::string errResp = std::string("{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"")
                                            + jsonEscape(error) + "\"},\"id\":" + std::to_string(rpcId) + "}\n";
                                        writeJsonRpcFd(stdoutFd, errResp.data(), errResp.size());
                                    }
                                    continue;
                                }
                            }

                            bool accepted = false;
                            const auto generation = audioSource->session_.generation();
                            if (sessionId == generation + 1)
                            {
                                pendingAutomixPcm.clear();
                                audioSource->beginSession();
                                accepted = true;
                            }
                            else if (sessionId == generation)
                            {
                                pendingAutomixPcm.clear();
                                accepted = true;
                            }
                            writeJsonRpcBooleanResult(stdoutFd, getJsonRpcIntegerId(object), accepted);
                            continue;
                        }

                        if (method == "audio.automixPrepare" && paramsObject != nullptr)
                        {
                            if (sessionMatches)
                            {
                                pendingAutomixPcm.clear();
                                audioSource->prepareAutomix(
                                    getJsonDouble(*paramsObject, "sampleRate", audioSampleRate),
                                    getJsonDouble(*paramsObject, "fadeStartSeconds", 0.0),
                                    getJsonDouble(*paramsObject, "overlapSeconds", 0.001),
                                    getJsonDouble(*paramsObject, "currentGainDb", 0.0),
                                    getJsonDouble(*paramsObject, "nextGainDb", 0.0));
                            }
                            continue;
                        }

                        if (method == "audio.automixNext" && paramsObject != nullptr)
                        {
                            if (sessionMatches)
                            {
                                std::vector<char> payload;
                                if (decodeBase64Payload(getJsonString(*paramsObject, "pcmBase64", {}), payload))
                                    pushAutomixNextPcmPayload(*audioSource, audioChannels, pendingAutomixPcm, payload);
                            }
                            continue;
                        }

                        if (method == "audio.automixNextEnd")
                        {
                            if (sessionMatches)
                            {
                                pendingAutomixPcm.clear();
                                audioSource->markAutomixNextEnded();
                            }
                            continue;
                        }

                        if (method == "audio.automixCancel")
                        {
                            if (sessionMatches)
                            {
                                pendingAutomixPcm.clear();
                                audioSource->cancelAutomix();
                            }
                            continue;
                        }

                        if (method == "device.enumerate")
                        {
                            MiniaudioContextScope scope;
                            std::string contextError;
                            if (!initMiniaudioSharedContext(scope, contextError))
                            {
                                const auto rpcId = getJsonRpcIntegerId(object);
                                if (rpcId >= 0)
                                {
                                    const std::string errResp = std::string("{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32603,\"message\":\"")
                                        + jsonEscape(contextError) + "\"},\"id\":" + std::to_string(rpcId) + "}\n";
                                    writeJsonRpcFd(stdoutFd, errResp.data(), errResp.size());
                                }
                                continue;
                            }

                            ma_device_info* playbackDevices = nullptr;
                            ma_uint32 playbackDeviceCount = 0;
                            const ma_result enumResult = ma_context_get_devices(
                                &scope.context, &playbackDevices, &playbackDeviceCount, nullptr, nullptr);
                            if (enumResult != MA_SUCCESS)
                            {
                                const auto rpcId = getJsonRpcIntegerId(object);
                                if (rpcId >= 0)
                                {
                                    const std::string errResp = std::string("{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32603,\"message\":\"")
                                        + jsonEscape(std::string("device enumeration failed: ") + ma_result_description(enumResult))
                                        + "\"},\"id\":" + std::to_string(rpcId) + "}\n";
                                    writeJsonRpcFd(stdoutFd, errResp.data(), errResp.size());
                                }
                                continue;
                            }

                            std::string resultJson = "[";
                            for (ma_uint32 i = 0; i < playbackDeviceCount; ++i)
                            {
                                if (i > 0) resultJson += ",";
                                resultJson += formatMiniaudioDeviceJson(playbackDevices[i], i);
                            }
                            resultJson += "]";

                            const auto rpcId = getJsonRpcIntegerId(object);
                            if (rpcId >= 0)
                            {
                                const std::string resp = std::string("{\"jsonrpc\":\"2.0\",\"result\":")
                                    + resultJson + ",\"id\":" + std::to_string(rpcId) + "}\n";
                                writeJsonRpcFd(stdoutFd, resp.data(), resp.size());
                            }
                            continue;
                        }

                        if (method == "device.configure")
                        {
                            const auto rpcId = getJsonRpcIntegerId(object);
                            if (rpcId >= 0)
                            {
#ifndef _WIN32
                                const std::string errResp = std::string("{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32603,\"message\":\"")
                                    + jsonEscape("device.configure not supported on this backend")
                                    + "\"},\"id\":" + std::to_string(rpcId) + "}\n";
                                writeJsonRpcFd(stdoutFd, errResp.data(), errResp.size());
#else
                                const std::string resp = std::string("{\"jsonrpc\":\"2.0\",\"result\":true,\"id\":")
                                    + std::to_string(rpcId) + "}\n";
                                writeJsonRpcFd(stdoutFd, resp.data(), resp.size());
#endif
                            }
                            continue;
                        }
                    }

                    echo::EqPresetStore presets;
                    std::string response = echo::JsonRpcProtocol::handleJsonLine(
                        line, eq, cb, conv, headroom, rg, rate, meter, presets) + "\n";
                    writeJsonRpcFd(stdoutFd, response.data(), response.size());
                }
            }
        }
        else if (n == 0)
        {
            break;
        }
        else if (errno == EAGAIN || errno == EWOULDBLOCK)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        else
        {
            break;
        }
    }
}

int runMiniaudioSharedHost(const Options& options)
{
    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::ReplayGainProcessor replayGainProcessor;
    echo::PlaybackRateProcessor rateProcessor;
    echo::LevelMeterProcessor meterProcessor;
    const int fifoCapacityFrames = getFifoCapacityFrames(options, options.sampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, options.sampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    PcmRingAudioSource source(options.channels, fifoCapacityFrames, startupPrebufferFrames, startupPrebufferTimeoutMs,
        options.volume, eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor,
        replayGainProcessor, rateProcessor, meterProcessor);

    MiniaudioSharedOutput miniaudioOutput;
    std::string miniaudioError;

    int actualSampleRate;
    int openedDeviceBufferFrames;
    int actualDeviceBufferFrames;

    std::atomic<bool> deviceOpened{true};
    std::mutex deviceInitMutex;
    std::function<bool(int sampleRate, int channels, int bufferFrames, std::string& error)> deferredDeviceInit;

    if (!options.deviceOpenDeferred)
    {
        if (! initMiniaudioSharedOutput(miniaudioOutput, source, options, options.sampleRate, options.channels,
                requestedDeviceBufferFrames, miniaudioError))
            throw std::runtime_error("miniaudio shared output open failed: " + miniaudioError);

        actualSampleRate = miniaudioOutput.device.sampleRate > 0
            ? static_cast<int>(miniaudioOutput.device.sampleRate)
            : options.sampleRate;
        openedDeviceBufferFrames = requestedDeviceBufferFrames;
        actualDeviceBufferFrames = requestedDeviceBufferFrames;
    }
    else
    {
        deviceOpened.store(false, std::memory_order_release);

        actualSampleRate = 48000;
        openedDeviceBufferFrames = requestedDeviceBufferFrames;
        actualDeviceBufferFrames = requestedDeviceBufferFrames;

        deferredDeviceInit = [&](int sampleRate, int channels, int bufferFrames, std::string& error) -> bool
        {
            std::lock_guard<std::mutex> lock(deviceInitMutex);
            if (deviceOpened.load(std::memory_order_acquire))
                return true;

            const int effectiveBuffer = bufferFrames > 0 ? bufferFrames : requestedDeviceBufferFrames;
            if (! initMiniaudioSharedOutput(miniaudioOutput, source, options, sampleRate, channels,
                    effectiveBuffer, error))
                return false;

            const int deviceSampleRate = miniaudioOutput.device.sampleRate > 0
                ? static_cast<int>(miniaudioOutput.device.sampleRate)
                : sampleRate;
            const int deviceBufferFrames = effectiveBuffer;

            writeJsonLine(
                std::string("{\"ready\":true,\"readyLevel\":\"device\",\"sampleRate\":") + std::to_string(deviceSampleRate)
                + ",\"hardwareSampleRate\":" + std::to_string(deviceSampleRate)
                + ",\"sharedDeviceSampleRate\":" + std::to_string(deviceSampleRate)
                + ",\"sharedSampleRate\":" + std::to_string(deviceSampleRate)
                + ",\"channels\":" + std::to_string(channels)
                + ",\"exclusive\":false"
                + ",\"eqControlPort\":" + std::to_string(0)
                + ",\"deviceBufferFrames\":" + std::to_string(deviceBufferFrames)
                + ",\"nativeActualBufferFrames\":" + std::to_string(deviceBufferFrames)
                + ",\"actualBufferFrames\":" + std::to_string(deviceBufferFrames)
                + ",\"requestedDeviceBufferFrames\":" + std::to_string(requestedDeviceBufferFrames)
                + ",\"openedDeviceBufferFrames\":" + std::to_string(deviceBufferFrames)
                + ",\"bufferSizeFallback\":false"
                + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
                + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
                + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
                + ",\"dspActive\":" + std::string(source.isDspActive() ? "true" : "false")
                + ",\"dspClippingRisk\":" + std::string(source.hasDspClippingRisk() ? "true" : "false")
                + ",\"dspLimiterProtecting\":" + std::string(source.isDspLimiterProtecting() ? "true" : "false")
                + ",\"backend\":\"miniaudio-shared\",\"backendImpl\":\"miniaudio-shared\""
                + ",\"deviceType\":\"miniaudio-shared\",\"deviceName\":\"" + jsonEscape(miniaudioOutput.deviceName.empty() ? "miniaudio default output" : miniaudioOutput.deviceName) + "\"}");

            deviceOpened.store(true, std::memory_order_release);
            return true;
        };
    }

    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor,
        headroomProcessor, replayGainProcessor, rateProcessor, meterProcessor);
    const bool eqControlReady = eqControlServer.start();

    std::atomic<bool> jsonRpcRunning{true};
    std::unique_ptr<std::thread> jsonRpcThread;
    if (options.rpcStdinFd >= 0 && options.rpcStdoutFd >= 0)
    {
        if (options.deviceOpenDeferred)
        {
            jsonRpcThread = std::make_unique<std::thread>(runJsonRpcOnStdio,
                options.rpcStdinFd, options.rpcStdoutFd, std::ref(eqProcessor), std::ref(channelBalanceProcessor),
                std::ref(convolutionProcessor), std::ref(headroomProcessor), std::ref(replayGainProcessor),
                std::ref(rateProcessor), std::ref(meterProcessor), std::ref(jsonRpcRunning), &source,
                static_cast<double>(actualSampleRate), options.channels,
                &deferredDeviceInit, &deviceOpened);
        }
        else
        {
            jsonRpcThread = std::make_unique<std::thread>(runJsonRpcOnStdio,
                options.rpcStdinFd, options.rpcStdoutFd, std::ref(eqProcessor), std::ref(channelBalanceProcessor),
                std::ref(convolutionProcessor), std::ref(headroomProcessor), std::ref(replayGainProcessor),
                std::ref(rateProcessor), std::ref(meterProcessor), std::ref(jsonRpcRunning), &source,
                static_cast<double>(actualSampleRate), options.channels,
                nullptr, nullptr);
        }
    }

    std::atomic<bool> shutdownRequested { false };
    std::unique_ptr<AudioDaemon> audioDaemon;

    AudioDaemon::SourceHooks sourceHooks{
        [&source]() { source.beginSession(); },
        [&source]() { source.markInputEnded(); },
        [&source]() { source.requestStop(); },
        [&source](bool paused) { source.setPaused(paused); },
        [&source](const float* samples, int frames, bool paused) { return source.replaceBufferedAudio(samples, frames, paused); },
        [&source](const float* samples, int frames) { return source.push(samples, frames); },
        [&source]() -> uint64_t { return source.session_.generation(); },
        [&source](float volume) { source.setGain(volume); },
    };
    audioDaemon = std::make_unique<AudioDaemon>(std::move(sourceHooks),
        actualSampleRate, options.rpcStdoutFd, shutdownRequested);
    audioDaemon->initialize();
    logLine("daemon mode: awaiting JSON-RPC commands");

    logLine("ready event writing");
    if (options.deviceOpenDeferred)
    {
        writeJsonLine("{\"ready\":true,\"readyLevel\":\"process\"}");
    }
    else
    {
        writeJsonLine(
            std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
            + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
            + ",\"sharedDeviceSampleRate\":" + std::to_string(actualSampleRate)
            + ",\"sharedSampleRate\":" + std::to_string(actualSampleRate)
            + ",\"channels\":" + std::to_string(options.channels)
            + ",\"exclusive\":false"
            + ",\"eqControlPort\":" + std::to_string(eqControlReady ? options.eqControlPort : 0)
            + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"requestedDeviceBufferFrames\":" + std::to_string(requestedDeviceBufferFrames)
            + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
            + ",\"bufferSizeFallback\":false"
            + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
            + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
            + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
            + ",\"dspActive\":" + std::string(source.isDspActive() ? "true" : "false")
            + ",\"dspClippingRisk\":" + std::string(source.hasDspClippingRisk() ? "true" : "false")
            + ",\"dspLimiterProtecting\":" + std::string(source.isDspLimiterProtecting() ? "true" : "false")
            + ",\"backend\":\"miniaudio-shared\",\"backendImpl\":\"miniaudio-shared\""
            + ",\"deviceType\":\"miniaudio-shared\",\"deviceName\":\"miniaudio default output\"}");
    }

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire))
    {
        const auto frames = source.getFramesPlayed();
        if (frames != lastReported)
        {
            // Two position-reporting paths serve different consumers:
            //   stdout (fd 1) → DaemonHostProcess reads this via child.stdout for status tracking
            //   RPC pipe (fd 4 via options.rpcStdoutFd) → JsonRpcBridge receives structured JSON-RPC
            //   position notifications for AudioBackend consumers
            writeJsonLine(std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames()) + "}");
            lastReported = frames;

            audioDaemon->emitPosition(frames, source.getReadyFrames(), source.hasInputEnded());
        }

        if (source.isDrained())
        {
            if (! endedReported)
            {
                writeJsonLine("{\"event\":\"ended\"}");
                endedReported = true;
                audioDaemon->emitEnded();
            }
        }
        else
        {
            endedReported = false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }


    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames()) + "}");

    if (source.getUnderrunCallbacks() > 0)
        logLine("Output underruns: callbacks=" + std::to_string(source.getUnderrunCallbacks())
            + " frames=" + std::to_string(source.getUnderrunFrames()));

    if (! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    if (jsonRpcThread)
    {
        jsonRpcRunning.store(false);
        jsonRpcThread->join();
    }

    cleanupMiniaudioSharedAndAck(source, miniaudioOutput, eqControlServer, shutdownAckSent);
    return 0;
}
int runHost(const Options& options)
{
    configureProcessPriority();
    ScopedTimerResolution timerResolution;
    logLine("Shared backend: miniaudio");
    return runMiniaudioSharedHost(options);
}
} // namespace

#include "AudioDaemon.h"

#ifndef ECHO_AUDIO_HOST_TESTS
int main(int argc, char* argv[])
{
    Options options;

    try
    {
        options = parseOptions(getCommandLineArgs(argc, argv));

        if (options.list)
        {
            return listDevices(options);
        }

        if (options.decodePcm)
        {
            return runLibavDecodePcm(options);
        }

        return runHost(options);
    }
    catch (const std::exception& error)
    {
        logLine(error.what());
        if (! options.decodePcm)
            writeErrorEvent(error.what());
        return 1;
    }
}
#endif
