#define MINIAUDIO_IMPLEMENTATION
#include "HostCommon.h"
#include "RuntimeOutputTransitionCoordinator.h"

#if defined(__APPLE__)
#include "MacCoreAudioDeviceInfo.h"
#include "MacCoreAudioDeviceWatcher.h"
#include "MacCoreAudioHogMode.h"
#endif

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
    std::string result(static_cast<size_t>(required), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), required, nullptr, nullptr);
    result.resize(static_cast<size_t>(required - 1));
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
        else if (arg == "-asio")
        {
            options.asio = true;
        }
        else if (arg == "-dop-output")
        {
            options.dopOutput = true;
        }
        else if (arg == "-asio-native-dsd-output")
        {
            options.asioNativeDsdOutput = true;
        }
        else if (arg == "--no-stdin")
        {
            options.noStdin = true;
        }
        else if (arg == "--defer-device-open")
        {
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
        else if (arg == "-asio-output-channel-start" && i + 1 < args.size())
        {
            options.asioOutputChannelStart = std::max(0, parseInt(args[++i], options.asioOutputChannelStart));
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
        else if (arg == "--pcm-input-fd" && i + 1 < args.size())
        {
            options.pcmInputFd = std::max(0, parseInt(args[++i], options.pcmInputFd));
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

std::vector<int> buildBufferSizeAttempts(int requested)
{
    static constexpr int supportedSizes[] { 256, 512, 1024, 2048, 4096, 8192 };
    requested = std::max(1, requested);
    std::vector<int> attempts;
    attempts.push_back(requested);
    for (const int candidate : supportedSizes)
        if (candidate > requested)
            attempts.push_back(candidate);
    return attempts;
}

std::vector<int> buildBufferSizeAttempts(const Options& options)
{
    return buildBufferSizeAttempts(getDeviceBufferSize(options));
}

bool isDisabledSharedBackend(const Options& options)
{
#ifdef _WIN32
    return options.sharedBackend == "alsa";
#else
    return options.sharedBackend == "windows" || options.sharedBackend == "directsound";
#endif
}

int waitForInitialPcm(PcmRingAudioSource& source, int targetFrames, int timeoutMs)
{
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(0, timeoutMs));
    while (source.getReadyFrames() < targetFrames && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    return source.getReadyFrames();
}

void pushPcmPayload(PcmRingAudioSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    if (channels <= 0 || payload.empty())
        return;
    pending.insert(pending.end(), payload.begin(), payload.end());
    const size_t frameBytes = static_cast<size_t>(channels) * sizeof(float);
    const size_t completeBytes = (pending.size() / frameBytes) * frameBytes;
    if (completeBytes == 0)
        return;
    std::vector<float> samples(completeBytes / sizeof(float));
    std::memcpy(samples.data(), pending.data(), completeBytes);
    source.push(samples.data(), static_cast<int>(completeBytes / frameBytes));
    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(completeBytes));
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

int nativeDsdByteFramesForBitFrames(int bitFrames)
{
    if (bitFrames <= 0)
        return 0;

    return std::max(1, static_cast<int>(std::ceil(static_cast<double>(bitFrames) / 8.0)));
}

int getNativeDsdFifoCapacityByteFrames(const Options& options, int nativeSampleRate)
{
    return nativeDsdByteFramesForBitFrames(getFifoCapacityFrames(options, nativeSampleRate));
}

int getNativeDsdStartupPrebufferByteFrames(const Options& options, int nativeSampleRate)
{
    if (! options.startupPrebufferMsSpecified && options.startupPrebufferMs <= 0)
        return nativeDsdByteFramesForBitFrames(framesForMilliseconds(nativeSampleRate, 20));

    return nativeDsdByteFramesForBitFrames(getStartupPrebufferFrames(options, nativeSampleRate));
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

const PROPERTYKEY echoPkeyDeviceInstanceId = {
    { 0x78c34fc8, 0x104a, 0x4aca, { 0x9e, 0xa4, 0x52, 0x4d, 0x52, 0x99, 0x6e, 0x57 } },
    256
};

const PROPERTYKEY echoPkeyAudioEndpointFormFactor = {
    { 0x1da5d803, 0xd492, 0x4edd, { 0x8c, 0x23, 0xe0, 0xc0, 0xff, 0xee, 0x7f, 0x0e } },
    0
};

const DEVPROPKEY echoDevpkeyDeviceBusTypeGuid = {
    { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } },
    21
};

const DEVPROPKEY echoDevpkeyDeviceEnumeratorName = {
    { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } },
    24
};

const DEVPROPKEY echoDevpkeyDeviceParent = {
    { 0x4340a6c5, 0x93fa, 0x4706, { 0x97, 0x2c, 0x7b, 0x64, 0x80, 0x08, 0xa5, 0xa7 } },
    8
};

const GUID echoBluetoothBusTypeGuid = {
    0xe0cbf06c, 0xcd8b, 0x4647, { 0xbb, 0x8a, 0x26, 0x3b, 0x43, 0xf0, 0xf9, 0x74 }
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
    std::string connectionType = "unknown";
    std::string formFactor = "unknown";
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

std::wstring getEndpointStringProperty(IMMDevice* device, const PROPERTYKEY& key)
{
    if (device == nullptr)
        return {};

    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (FAILED(device->OpenPropertyStore(STGM_READ, properties.GetAddressOf())))
        return {};

    PROPVARIANT value;
    PropVariantInit(&value);
    std::wstring result;
    if (SUCCEEDED(properties->GetValue(key, &value)) && value.vt == VT_LPWSTR && value.pwszVal != nullptr)
        result = value.pwszVal;
    PropVariantClear(&value);
    return result;
}

std::string getEndpointFormFactor(IMMDevice* device)
{
    if (device == nullptr)
        return "unknown";

    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (FAILED(device->OpenPropertyStore(STGM_READ, properties.GetAddressOf())))
        return "unknown";

    PROPVARIANT value;
    PropVariantInit(&value);
    unsigned long formFactor = 10;
    if (SUCCEEDED(properties->GetValue(echoPkeyAudioEndpointFormFactor, &value)))
    {
        if (value.vt == VT_UI4)
            formFactor = value.ulVal;
        else if (value.vt == VT_I4 && value.lVal >= 0)
            formFactor = static_cast<unsigned long>(value.lVal);
    }
    PropVariantClear(&value);

    switch (formFactor)
    {
        case 1: return "speakers";
        case 3: return "headphones";
        case 5: return "headset";
        case 7:
        case 8: return "digital";
        case 9: return "display";
        default: return "unknown";
    }
}

bool getDeviceNodeStringProperty(DEVINST device, const DEVPROPKEY& key, std::wstring& result)
{
    wchar_t buffer[512]{};
    DEVPROPTYPE propertyType = 0;
    ULONG bufferSize = sizeof(buffer);
    if (CM_Get_DevNode_PropertyW(device, &key, &propertyType, reinterpret_cast<PBYTE>(buffer), &bufferSize, 0) != CR_SUCCESS
        || propertyType != DEVPROP_TYPE_STRING)
        return false;

    result = buffer;
    return ! result.empty();
}

bool getDeviceNodeBusType(DEVINST device, GUID& result)
{
    DEVPROPTYPE propertyType = 0;
    ULONG bufferSize = sizeof(result);
    return CM_Get_DevNode_PropertyW(
        device,
        &echoDevpkeyDeviceBusTypeGuid,
        &propertyType,
        reinterpret_cast<PBYTE>(&result),
        &bufferSize,
        0) == CR_SUCCESS
        && propertyType == DEVPROP_TYPE_GUID;
}

bool isBluetoothDeviceInstance(const std::wstring& instanceId)
{
    if (instanceId.empty())
        return false;

    std::wstring mutableInstanceId = instanceId;
    DEVINST device = 0;
    if (CM_Locate_DevNodeW(&device, mutableInstanceId.data(), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS)
        return false;

    for (int depth = 0; depth < 16; ++depth)
    {
        wchar_t currentId[MAX_DEVICE_ID_LEN]{};
        if (CM_Get_Device_IDW(device, currentId, MAX_DEVICE_ID_LEN, 0) == CR_SUCCESS)
        {
            const auto currentIdUtf8 = wideToUtf8(currentId);
            if (containsIgnoreCase(currentIdUtf8, "BTHENUM\\")
                || containsIgnoreCase(currentIdUtf8, "BTHLEDEVICE\\")
                || containsIgnoreCase(currentIdUtf8, "BLUETOOTH"))
                return true;
        }

        std::wstring enumeratorName;
        if (getDeviceNodeStringProperty(device, echoDevpkeyDeviceEnumeratorName, enumeratorName))
        {
            const auto enumeratorNameUtf8 = wideToUtf8(enumeratorName.c_str());
            if (containsIgnoreCase(enumeratorNameUtf8, "BTH") || containsIgnoreCase(enumeratorNameUtf8, "BLUETOOTH"))
                return true;
        }

        std::wstring parentInstanceId;
        if (getDeviceNodeStringProperty(device, echoDevpkeyDeviceParent, parentInstanceId))
        {
            const auto parentInstanceIdUtf8 = wideToUtf8(parentInstanceId.c_str());
            if (containsIgnoreCase(parentInstanceIdUtf8, "BTHENUM\\")
                || containsIgnoreCase(parentInstanceIdUtf8, "BTHHFENUM\\")
                || containsIgnoreCase(parentInstanceIdUtf8, "BTHLEDEVICE\\")
                || containsIgnoreCase(parentInstanceIdUtf8, "BLUETOOTH"))
                return true;
        }

        GUID busType{};
        if (getDeviceNodeBusType(device, busType) && IsEqualGUID(busType, echoBluetoothBusTypeGuid))
            return true;

        DEVINST parent = 0;
        if (CM_Get_Parent(&parent, device, 0) != CR_SUCCESS)
            break;
        device = parent;
    }

    return false;
}

std::string getEndpointConnectionType(
    IMMDevice* device,
    const std::string& endpointId,
    const std::string& friendlyName)
{
    auto instanceId = getEndpointStringProperty(device, echoPkeyDeviceInstanceId);
    if (instanceId.empty() && ! endpointId.empty())
    {
        const std::string pnpInstanceId = "SWD\\MMDEVAPI\\" + endpointId;
        instanceId.assign(pnpInstanceId.begin(), pnpInstanceId.end());
    }
    if (isBluetoothDeviceInstance(instanceId)
        || containsIgnoreCase(friendlyName, "bluetooth")
        || friendlyName.find("蓝牙") != std::string::npos)
        return "bluetooth";
    return "unknown";
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

        CoreAudioEndpoint descriptor;
        descriptor.id = getEndpointId(endpoint.Get());
        descriptor.name = getEndpointFriendlyName(endpoint.Get());
        descriptor.mixSampleRate = getEndpointMixSampleRate(endpoint.Get());
        descriptor.isDefault = ! defaultId.empty() && descriptor.id == defaultId;
        descriptor.connectionType = getEndpointConnectionType(endpoint.Get(), descriptor.id, descriptor.name);
        descriptor.formFactor = getEndpointFormFactor(endpoint.Get());
        endpoints.push_back(std::move(descriptor));
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
    auto byId = std::find_if(endpoints.begin(), endpoints.end(), [&] (const CoreAudioEndpoint& endpoint)
    {
        return ! endpoint.id.empty()
            && device.stableId.size() >= endpoint.id.size()
            && device.stableId.ends_with(endpoint.id);
    });

    if (byId != endpoints.end())
        return &*byId;

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

void applyCoreAudioDeviceMetadata(std::vector<DeviceDescriptor>& devices, bool applySharedSampleRates)
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
            device.connectionType = endpoint->connectionType;
            device.formFactor = endpoint->formFactor;
        }

        if (! applySharedSampleRates)
            continue;

        if (sampleRate <= 0 && device.isDefault && defaultEndpoint != endpoints.end())
            sampleRate = defaultEndpoint->mixSampleRate;

        if (sampleRate <= 0)
            sampleRate = getFallbackSharedSampleRate();

        device.sampleRate = sampleRate;
        device.sharedSampleRate = sampleRate;
    }
}

#elif defined(__APPLE__)
int getFallbackSharedSampleRate()
{
    return 48000;
}

void applyCoreAudioDeviceMetadata(std::vector<DeviceDescriptor>& devices, bool applySharedSampleRates)
{
    for (auto& device : devices)
    {
        if (device.stableId.rfind("shared:", 0) == 0)
        {
            const auto uid = device.stableId.substr(7);
            const int nominalRate = getMacCoreAudioNominalSampleRateForUid(uid.c_str());
            if (nominalRate > 0)
            {
                device.sampleRate = nominalRate;
                device.sharedSampleRate = nominalRate;
            }
        }

        const auto lowered = asciiLower(device.name);
        if (containsIgnoreCase(lowered, "bluetooth") || containsIgnoreCase(lowered, "airpods")
            || device.name.find("蓝牙") != std::string::npos)
        {
            device.connectionType = "bluetooth";
            device.formFactor = containsIgnoreCase(lowered, "headset") ? "headset" : "headphones";
        }
        else if (containsIgnoreCase(lowered, "headphone") || containsIgnoreCase(lowered, "headset")
            || containsIgnoreCase(lowered, "earphone") || device.name.find("耳机") != std::string::npos)
        {
            device.formFactor = containsIgnoreCase(lowered, "headset") ? "headset" : "headphones";
        }
        else if (containsIgnoreCase(lowered, "display") || containsIgnoreCase(lowered, "monitor")
            || containsIgnoreCase(lowered, "hdmi") || device.name.find("显示器") != std::string::npos)
        {
            device.formFactor = "display";
        }
        else if (containsIgnoreCase(lowered, "speaker") || device.name.find("扬声器") != std::string::npos)
        {
            device.formFactor = "speakers";
        }
        else if (containsIgnoreCase(lowered, "usb"))
        {
            device.formFactor = "digital";
        }

        if (! applySharedSampleRates)
            continue;
        if (device.sharedSampleRate <= 0)
            device.sharedSampleRate = getFallbackSharedSampleRate();
        if (device.sampleRate <= 0)
            device.sampleRate = device.sharedSampleRate;
    }
}

#else
int getFallbackSharedSampleRate()
{
    return 48000;
}

void applyCoreAudioDeviceMetadata(std::vector<DeviceDescriptor>& devices, bool applySharedSampleRates)
{
    for (auto& device : devices)
    {
        if (! applySharedSampleRates)
            continue;
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

bool initMiniaudioOutputContext(ma_context& context, std::string_view sharedBackend, std::string& error)
{
#ifdef _WIN32
    const ma_backend backends[] = {
        sharedBackend == "directsound" ? ma_backend_dsound : ma_backend_wasapi
    };
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

bool initMiniaudioOutputContext(MiniaudioContextScope& scope, std::string_view sharedBackend, std::string& error)
{
    if (! initMiniaudioOutputContext(scope.context, sharedBackend, error))
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

std::string getMiniaudioStableId(const ma_device_info& info, int index)
{
#if defined(__APPLE__)
    if (info.id.coreaudio[0] != '\0')
        return "shared:" + std::string(info.id.coreaudio);
#endif
    (void)info;
    return getMiniaudioStableId(index);
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
    if (requestedText == getMiniaudioStableId(info, index) || requestedText == getMiniaudioStableId(index))
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

std::vector<DeviceDescriptor> enumerateMiniaudioSharedDevices(
    std::string_view sharedBackend,
    std::string* error = nullptr,
    bool exclusive = false)
{
    std::vector<DeviceDescriptor> devices;
    if (sharedBackend == "alsa")
        return devices;

    MiniaudioContextScope scope;
    std::string contextError;
    if (! initMiniaudioOutputContext(scope, sharedBackend, contextError))
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
        descriptor.typeName = exclusive ? "CoreAudio exclusive" : "miniaudio-shared";
        descriptor.name = playbackDevices[i].name;
        descriptor.sampleRate = sampleRate;
        descriptor.sharedSampleRate = sampleRate;
        descriptor.isDefault = playbackDevices[i].isDefault != 0;
        descriptor.isAsio = false;
        descriptor.asioOutputChannels = pickMiniaudioDeviceChannels(playbackDevices[i]);
        descriptor.stableId = (exclusive ? "exclusive:" : "shared:")
            + getMiniaudioStableId(playbackDevices[i], index).substr(7);
        devices.push_back(descriptor);
    }

    applyCoreAudioDeviceMetadata(devices, ! exclusive);
    return devices;
}

#ifdef _WIN32
std::vector<DeviceDescriptor> enumerateWasapiSharedDevices(std::string* error = nullptr)
{
    wasapi_shared_device_info* rawDevices = nullptr;
    uint32_t count = 0;
    std::vector<DeviceDescriptor> devices;
    if (wasapi_shared_list_devices(&rawDevices, &count) != 0)
    {
        if (error != nullptr)
            *error = "WASAPI shared device enumeration failed";
        return devices;
    }

    devices.reserve(count);
    for (uint32_t i = 0; i < count; ++i)
    {
        DeviceDescriptor descriptor;
        descriptor.index = static_cast<int>(i);
        descriptor.typeName = "Windows Audio";
        descriptor.name = rawDevices[i].name;
        descriptor.sampleRate = static_cast<int>(rawDevices[i].sharedSampleRate);
        descriptor.sharedSampleRate = static_cast<int>(rawDevices[i].sharedSampleRate);
        descriptor.isDefault = rawDevices[i].isDefault != 0;
        descriptor.isAsio = false;
        descriptor.asioOutputChannels = static_cast<int>(rawDevices[i].channels);
        const auto deviceId = wideToUtf8(rawDevices[i].id);
        descriptor.stableId = deviceId.empty() ? "shared:" + std::to_string(i) : "shared:" + deviceId;
        devices.push_back(std::move(descriptor));
    }
    wasapi_shared_free_devices(rawDevices);
    applyCoreAudioDeviceMetadata(devices, true);
    return devices;
}
#endif

enum class NativePcmOutputBackendKind
{
    Miniaudio,
    WasapiShared,
    WasapiExclusive,
    Asio,
};

enum class SpecializedHostRunner
{
    None,
    WasapiExclusivePcm,
    WasapiExclusiveDop,
    AsioPcm,
    AsioDop,
    AsioNativeDsd,
};

bool shouldTryMiniaudioSharedOutput(const Options& options)
{
    if (options.asio || options.exclusive || options.dopOutput || options.asioNativeDsdOutput)
        return false;
#ifdef _WIN32
    return options.sharedBackend == "miniaudio" || options.sharedBackend == "directsound";
#else
    return options.sharedBackend != "windows" && options.sharedBackend != "directsound";
#endif
}

SpecializedHostRunner selectSpecializedHostRunner(const Options& options)
{
    if (options.asioNativeDsdOutput)
        return SpecializedHostRunner::AsioNativeDsd;
    if (options.asio && options.dopOutput)
        return SpecializedHostRunner::AsioDop;
    if (options.asio)
        return SpecializedHostRunner::AsioPcm;
#ifdef _WIN32
    if (options.exclusive && options.dopOutput)
        return SpecializedHostRunner::WasapiExclusiveDop;
    if (options.exclusive)
        return SpecializedHostRunner::WasapiExclusivePcm;
#endif
    return SpecializedHostRunner::None;
}

NativePcmOutputBackendKind selectNativePcmOutputBackend(const Options& options)
{
    if (options.asio)
        return NativePcmOutputBackendKind::Asio;
    if (options.exclusive)
#if defined(__APPLE__) || defined(__linux__)
        return NativePcmOutputBackendKind::Miniaudio;
#else
        return NativePcmOutputBackendKind::WasapiExclusive;
#endif
    if (shouldTryMiniaudioSharedOutput(options))
        return NativePcmOutputBackendKind::Miniaudio;
#ifdef _WIN32
    return NativePcmOutputBackendKind::WasapiShared;
#else
    return NativePcmOutputBackendKind::Miniaudio;
#endif
}

std::vector<DeviceDescriptor> enumerateDevices(
    DeviceListMode mode,
    std::string_view sharedBackend = "auto")
{
    if (mode == DeviceListMode::Shared)
    {
#ifdef _WIN32
        if (sharedBackend != "miniaudio" && sharedBackend != "directsound" && sharedBackend != "alsa")
        {
            std::string wasapiError;
            auto devices = enumerateWasapiSharedDevices(&wasapiError);
            if (devices.empty() && ! wasapiError.empty())
                logLine(wasapiError);
            return devices;
        }
#endif
        std::string miniaudioError;
        auto devices = enumerateMiniaudioSharedDevices(sharedBackend, &miniaudioError);
        if (devices.empty() && ! miniaudioError.empty())
            logLine(miniaudioError);
        return devices;
    }

#ifdef _WIN32
    if (mode == DeviceListMode::Asio)
    {
        asio_device_info* rawDevices = nullptr;
        uint32_t count = 0;
        std::vector<DeviceDescriptor> devices;
        if (asio_list_devices(&rawDevices, &count) != 0)
            return devices;
        devices.reserve(count);
        for (uint32_t i = 0; i < count; ++i)
        {
            DeviceDescriptor descriptor;
            descriptor.index = static_cast<int>(i);
            descriptor.typeName = "ASIO";
            descriptor.name = rawDevices[i].name;
            descriptor.isDefault = rawDevices[i].isDefault != 0;
            descriptor.isAsio = true;
            descriptor.asioOutputChannels = static_cast<int>(rawDevices[i].outputChannels);
            descriptor.asioOutputChannelNames = rawDevices[i].outputChannelNames;
            descriptor.stableId = "asio:" + descriptor.name;
            devices.push_back(std::move(descriptor));
        }
        asio_free_devices(rawDevices);
        return devices;
    }
    if (mode == DeviceListMode::Exclusive)
    {
        wasapi_exclusive_device_info* rawDevices = nullptr;
        uint32_t count = 0;
        std::vector<DeviceDescriptor> devices;
        if (wasapi_exclusive_list_devices(&rawDevices, &count) != 0)
            return devices;
        devices.reserve(count);
        for (uint32_t i = 0; i < count; ++i)
        {
            DeviceDescriptor descriptor;
            descriptor.index = static_cast<int>(i);
            descriptor.typeName = "WASAPI exclusive";
            descriptor.name = rawDevices[i].name;
            descriptor.sampleRate = static_cast<int>(rawDevices[i].highestSampleRate);
            descriptor.sharedSampleRate = static_cast<int>(rawDevices[i].sharedSampleRate);
            descriptor.isDefault = rawDevices[i].isDefault != 0;
            const auto deviceId = wideToUtf8(rawDevices[i].id);
            descriptor.stableId = deviceId.empty() ? "exclusive:" + std::to_string(i) : "exclusive:" + deviceId;
            devices.push_back(std::move(descriptor));
        }
        wasapi_exclusive_free_devices(rawDevices);
        applyCoreAudioDeviceMetadata(devices, false);
        return devices;
    }
#endif
#if defined(__APPLE__)
    if (mode == DeviceListMode::Exclusive)
    {
        std::string miniaudioError;
        auto devices = enumerateMiniaudioSharedDevices(sharedBackend, &miniaudioError, true);
        if (devices.empty() && ! miniaudioError.empty())
            logLine(miniaudioError);
        return devices;
    }
#endif
    return {};
}

int listDevices(const Options& options)
{
    const auto mode = options.asio
        ? DeviceListMode::Asio
        : options.exclusive ? DeviceListMode::Exclusive : DeviceListMode::Shared;
    const auto devices = enumerateDevices(mode, options.sharedBackend);

    for (const auto& device : devices)
    {
        std::cout
            << device.index << "\t"
            << device.name << "\t"
            << device.sampleRate << "\t"
            << (device.isDefault ? 1 : 0) << "\t"
            << device.sharedSampleRate << "\t"
            << device.connectionType << "\t"
            << device.formFactor
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

void writeJsonRpcResult(int stdoutFd, int64_t id, const echo_audio_host::Json& result)
{
    if (id < 0)
        return;
    echo_audio_host::Json response = {
        {"jsonrpc", "2.0"},
        {"result", result},
        {"id", id},
    };
    const std::string serialized = response.dump() + "\n";
    writeJsonRpcFd(stdoutFd, serialized.data(), serialized.size());
}

void writeJsonRpcError(int stdoutFd, int64_t id, int code, const std::string& message)
{
    if (id < 0)
        return;
    echo_audio_host::Json response = {
        {"jsonrpc", "2.0"},
        {"error", {
            {"code", code},
            {"message", message},
        }},
        {"id", id},
    };
    const std::string serialized = response.dump() + "\n";
    writeJsonRpcFd(stdoutFd, serialized.data(), serialized.size());
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
#if defined(__APPLE__)
    MacCoreAudioDeviceWatcher deviceWatcher;
    MacCoreAudioHogMode hogMode;
    bool followsDefaultDevice = false;
    std::atomic<bool> stopping { false };
#endif
    bool contextInitialized = false;
    bool initialized = false;
    bool started = false;
};

#if defined(__APPLE__)
void writeCoreAudioDeviceNotification(
    void*,
    const char* event,
    const std::string& deviceUid,
    const char* reason,
    std::uint32_t code,
    bool currentDevice,
    bool followsDefaultDevice)
{
    writeJsonLine(
        "{\"event\":\"" + jsonEscape(event != nullptr ? event : "device_state_changed")
        + "\",\"deviceId\":\"" + jsonEscape(deviceUid)
        + "\",\"reason\":\"" + jsonEscape(reason != nullptr ? reason : "unknown")
        + "\",\"code\":" + std::to_string(code)
        + ",\"currentDevice\":" + std::string(currentDevice ? "true" : "false")
        + ",\"followsDefaultDevice\":" + std::string(followsDefaultDevice ? "true" : "false")
        + "}");
}

void miniaudioSharedNotificationCallback(const ma_device_notification* notification)
{
    if (notification == nullptr || notification->pDevice == nullptr)
        return;
    auto* state = static_cast<MiniaudioSharedOutput*>(notification->pDevice->pUserData);
    if (state == nullptr || state->stopping.load(std::memory_order_acquire))
        return;

    switch (notification->type)
    {
        case ma_device_notification_type_stopped:
            writeCoreAudioDeviceNotification(nullptr, "audio_session_disconnected", {}, "device_stopped", 0, true, state->followsDefaultDevice);
            break;
        case ma_device_notification_type_rerouted:
            writeCoreAudioDeviceNotification(nullptr, "default_device_changed", {}, "rerouted", 0, true, state->followsDefaultDevice);
            break;
        case ma_device_notification_type_interruption_began:
            writeCoreAudioDeviceNotification(nullptr, "audio_session_disconnected", {}, "interruption_began", 0, true, state->followsDefaultDevice);
            break;
        default:
            break;
    }
}
#endif

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
#if defined(__APPLE__)
    output.stopping.store(false, std::memory_order_release);
    output.followsDefaultDevice = options.deviceIndex < 0 && options.deviceName.empty();
#endif
    if (! initMiniaudioOutputContext(output.context, options.sharedBackend, error))
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

#if defined(__APPLE__)
    if (options.exclusive
        && ! output.hogMode.acquire(selectedDevice != nullptr ? selectedDevice->id.coreaudio : nullptr, error))
    {
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
        output.source = nullptr;
        return false;
    }
#endif

    auto config = ma_device_config_init(ma_device_type_playback);
    const ma_device_id* selectedDeviceId = selectedDevice != nullptr ? &output.selectedDeviceId : nullptr;
    config.playback.format = ma_format_f32;
    config.playback.channels = static_cast<ma_uint32>(std::max(1, channels));
    config.playback.pDeviceID = selectedDeviceId;
#if defined(__APPLE__)
    config.playback.shareMode = ma_share_mode_shared;
#else
    config.playback.shareMode = options.exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
#endif
    config.sampleRate = static_cast<ma_uint32>(std::max(1, sampleRate));
#if defined(__APPLE__)
    config.coreaudio.allowNominalSampleRateChange = options.exclusive ? MA_TRUE : MA_FALSE;
    config.notificationCallback = miniaudioSharedNotificationCallback;
#endif
    config.periodSizeInFrames = static_cast<ma_uint32>(std::max(1, bufferFrames));
    config.performanceProfile = ma_performance_profile_low_latency;
    config.dataCallback = miniaudioSharedDataCallback;
    config.pUserData = &output;

    result = ma_device_init(&output.context, &config, &output.device);
    if (result != MA_SUCCESS)
    {
        error = std::string("ma_device_init failed: ") + ma_result_description(result);
#if defined(__APPLE__)
        output.hogMode.release();
#endif
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
#if defined(__APPLE__)
        output.hogMode.release();
#endif
        ma_context_uninit(&output.context);
        output.contextInitialized = false;
        output.source = nullptr;
        return false;
    }
    output.started = true;
#if defined(__APPLE__)
    std::string watcherError;
    if (! output.deviceWatcher.start(
            selectedDevice != nullptr ? selectedDevice->id.coreaudio : nullptr,
            output.followsDefaultDevice,
            writeCoreAudioDeviceNotification,
            &output,
            watcherError))
    {
        logLine("CoreAudio device watcher unavailable: " + watcherError);
    }
#endif
    return true;
}

void stopMiniaudioSharedOutput(MiniaudioSharedOutput& output)
{
#if defined(__APPLE__)
    output.stopping.store(true, std::memory_order_release);
    output.deviceWatcher.stop();
#endif
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
#if defined(__APPLE__)
    output.hogMode.release();
#endif
}

struct NativePcmOutputReadyInfo
{
    int sampleRate = 0;
    int hardwareSampleRate = 0;
    int channels = 0;
    int deviceBufferFrames = 0;
    int openedDeviceBufferFrames = 0;
    bool exclusive = false;
    bool asio = false;
    std::string format;
    std::string backend;
    std::string backendImpl;
    std::string deviceType;
    std::string deviceName;
};

class NativePcmOutputBackend
{
public:
    virtual ~NativePcmOutputBackend() = default;
    virtual bool open(
        NativePlaybackPipeline& pipeline,
        const Options& options,
        int sampleRate,
        int channels,
        int bufferFrames,
        std::string& error) = 0;
    virtual void close() noexcept = 0;
    virtual const NativePcmOutputReadyInfo& readyInfo() const noexcept = 0;
};

class MiniaudioPcmOutputBackend final : public NativePcmOutputBackend
{
public:
    ~MiniaudioPcmOutputBackend() override { close(); }

    bool open(
        NativePlaybackPipeline& pipeline,
        const Options& options,
        int sampleRate,
        int channels,
        int bufferFrames,
        std::string& error) override
    {
        if (! initMiniaudioSharedOutput(output, pipeline.pcmSource(), options, sampleRate, channels, bufferFrames, error))
            return false;
        const bool directSound = options.sharedBackend == "directsound";
        info.sampleRate = output.device.sampleRate > 0 ? static_cast<int>(output.device.sampleRate) : sampleRate;
#if defined(__APPLE__)
        info.hardwareSampleRate = output.device.playback.internalSampleRate > 0
            ? static_cast<int>(output.device.playback.internalSampleRate)
            : info.sampleRate;
#else
        info.hardwareSampleRate = info.sampleRate;
#endif
        info.channels = output.device.playback.channels > 0 ? static_cast<int>(output.device.playback.channels) : channels;
        info.deviceBufferFrames = output.device.playback.internalPeriodSizeInFrames > 0
            ? static_cast<int>(output.device.playback.internalPeriodSizeInFrames)
            : bufferFrames;
        info.openedDeviceBufferFrames = info.deviceBufferFrames;
        info.exclusive = options.exclusive;
        info.asio = false;
        info.format = "f32";
#if defined(__APPLE__)
        info.backend = options.exclusive ? "coreaudio-exclusive" : "coreaudio-shared";
        info.backendImpl = options.exclusive ? "miniaudio-coreaudio-hog-native-rate" : "miniaudio-coreaudio-native-rate";
        info.deviceType = options.exclusive ? "CoreAudio Hog Mode" : "CoreAudio";
#else
        info.backend = directSound ? "directsound-shared" : "miniaudio-shared";
        info.backendImpl = directSound ? "miniaudio-directsound-shared" : "miniaudio-shared";
        info.deviceType = directSound ? "DirectSound" : "miniaudio-shared";
#endif
        info.deviceName = output.deviceName.empty() ? "miniaudio default output" : output.deviceName;
        return true;
    }

    void close() noexcept override
    {
        stopMiniaudioSharedOutput(output);
    }

    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    MiniaudioSharedOutput output;
    NativePcmOutputReadyInfo info;
};

#ifdef _WIN32
unsigned int renderNativePcm(
    void* userData,
    float* output,
    unsigned int frameCount,
    unsigned int channels)
{
    auto* source = static_cast<PcmRingAudioSource*>(userData);
    if (source == nullptr || output == nullptr || channels == 0)
        return 0;
    return source->renderInterleaved(output, frameCount, channels);
}

class WasapiSharedPcmOutputBackend final : public NativePcmOutputBackend
{
public:
    ~WasapiSharedPcmOutputBackend() override { close(); }

    bool open(
        NativePlaybackPipeline& pipeline,
        const Options& options,
        int sampleRate,
        int channels,
        int bufferFrames,
        std::string& error) override
    {
        char errorBuffer[2048]{};
        wasapi_shared_ready_info ready{};
        auto& source = pipeline.pcmSource();
        source.prepareForNativeRender(std::max(16384, bufferFrames), static_cast<double>(sampleRate));
        const int result = wasapi_shared_start(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(),
            options.deviceIndex,
            static_cast<uint32_t>(sampleRate),
            static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)),
            renderNativePcm,
            &source,
            nullptr,
            nullptr,
            &runtime,
            &ready,
            errorBuffer,
            sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "WASAPI shared start failed";
            return false;
        }
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = static_cast<int>(ready.hardwareSampleRate);
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = info.deviceBufferFrames;
        info.exclusive = false;
        info.asio = false;
        info.format = ready.format;
        info.backend = "wasapi-shared";
        info.backendImpl = "wasapi-shared-native";
        info.deviceType = "Windows Audio";
        info.deviceName = options.deviceName.empty() ? "Default Output" : options.deviceName;
        return true;
    }

    void close() noexcept override
    {
        if (runtime != nullptr)
        {
            wasapi_shared_stop(runtime);
            runtime = nullptr;
        }
    }

    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    wasapi_shared_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};

class WasapiExclusivePcmOutputBackend final : public NativePcmOutputBackend
{
public:
    ~WasapiExclusivePcmOutputBackend() override { close(); }

    bool open(
        NativePlaybackPipeline& pipeline,
        const Options& options,
        int sampleRate,
        int channels,
        int bufferFrames,
        std::string& error) override
    {
        char errorBuffer[2048]{};
        wasapi_exclusive_ready_info ready{};
        auto& source = pipeline.pcmSource();
        source.prepareForNativeRender(std::max(16384, bufferFrames), static_cast<double>(sampleRate));
        const int result = wasapi_exclusive_start(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(),
            options.deviceIndex,
            static_cast<uint32_t>(sampleRate),
            static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)),
            renderNativePcm,
            &source,
            nullptr,
            nullptr,
            &runtime,
            &ready,
            errorBuffer,
            sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "WASAPI exclusive start failed";
            return false;
        }
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = static_cast<int>(ready.hardwareSampleRate);
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = info.deviceBufferFrames;
        info.exclusive = true;
        info.asio = false;
        info.format = ready.format;
        info.backend = "wasapi-exclusive";
        info.backendImpl = "wasapi-exclusive-native";
        info.deviceType = "WASAPI exclusive";
        info.deviceName = options.deviceName.empty() ? "Default Exclusive Output" : options.deviceName;
        return true;
    }

    void close() noexcept override
    {
        if (runtime != nullptr)
        {
            wasapi_exclusive_stop(runtime);
            runtime = nullptr;
        }
    }

    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    wasapi_exclusive_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};

class AsioPcmOutputBackend final : public NativePcmOutputBackend
{
public:
    ~AsioPcmOutputBackend() override { close(); }

    bool open(
        NativePlaybackPipeline& pipeline,
        const Options& options,
        int sampleRate,
        int channels,
        int bufferFrames,
        std::string& error) override
    {
        char errorBuffer[2048]{};
        asio_ready_info ready{};
        auto& source = pipeline.pcmSource();
        source.prepareForNativeRender(std::max(16384, bufferFrames), static_cast<double>(sampleRate));
        const int result = asio_start(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(),
            options.deviceIndex,
            static_cast<uint32_t>(sampleRate),
            static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)),
            static_cast<uint32_t>(std::max(0, options.asioOutputChannelStart)),
            renderNativePcm,
            &source,
            &runtime,
            &ready,
            errorBuffer,
            sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "ASIO start failed";
            return false;
        }
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = info.sampleRate;
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = static_cast<int>(ready.requestedBufferFrameCount);
        info.exclusive = true;
        info.asio = true;
        info.format = ready.format;
        info.backend = "asio";
        info.backendImpl = "asio-native";
        info.deviceType = "ASIO";
        info.deviceName = ready.deviceName[0] != '\0'
            ? ready.deviceName
            : (options.deviceName.empty() ? "Default ASIO Output" : options.deviceName);
        return true;
    }

    void close() noexcept override
    {
        if (runtime != nullptr)
        {
            asio_stop(runtime);
            runtime = nullptr;
        }
    }

    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    asio_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};

unsigned int renderNativeDop(
    void* userData,
    uint32_t* output,
    unsigned int frameCount,
    unsigned int channels)
{
    auto* source = static_cast<DopRingSource*>(userData);
    return source != nullptr ? source->renderInterleaved(output, frameCount, channels) : 0;
}

unsigned int renderNativeDsd(
    void* userData,
    uint8_t* output,
    unsigned int byteFrameCount,
    unsigned int channels)
{
    auto* source = static_cast<NativeDsdRingSource*>(userData);
    return source != nullptr ? source->renderInterleaved(output, byteFrameCount, channels) : 0;
}

class WasapiExclusiveDopOutputBackend final : public NativePcmOutputBackend
{
public:
    ~WasapiExclusiveDopOutputBackend() override { close(); }

    bool open(NativePlaybackPipeline& pipeline, const Options& options, int sampleRate, int channels,
              int bufferFrames, std::string& error) override
    {
        char errorBuffer[2048]{};
        wasapi_exclusive_ready_info ready{};
        const int result = wasapi_exclusive_start_dop(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(), options.deviceIndex,
            static_cast<uint32_t>(sampleRate), static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)), renderNativeDop, &pipeline.dopSource(),
            nullptr, nullptr, &runtime, &ready, errorBuffer, sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "WASAPI exclusive DoP start failed";
            return false;
        }
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = static_cast<int>(ready.hardwareSampleRate);
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = info.deviceBufferFrames;
        info.exclusive = true;
        info.format = ready.format;
        info.backend = "wasapi-exclusive-dop";
        info.backendImpl = "wasapi-exclusive-dop-native";
        info.deviceType = "WASAPI exclusive DoP";
        info.deviceName = options.deviceName.empty() ? "Default Exclusive DoP Output" : options.deviceName;
        return true;
    }

    void close() noexcept override
    {
        if (runtime != nullptr) { wasapi_exclusive_stop(runtime); runtime = nullptr; }
    }
    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    wasapi_exclusive_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};

class AsioDopOutputBackend final : public NativePcmOutputBackend
{
public:
    ~AsioDopOutputBackend() override { close(); }

    bool open(NativePlaybackPipeline& pipeline, const Options& options, int sampleRate, int channels,
              int bufferFrames, std::string& error) override
    {
        char errorBuffer[2048]{};
        asio_ready_info ready{};
        const int result = asio_start_dop(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(), options.deviceIndex,
            static_cast<uint32_t>(sampleRate), static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)), static_cast<uint32_t>(std::max(0, options.asioOutputChannelStart)),
            renderNativeDop, &pipeline.dopSource(), &runtime, &ready, errorBuffer, sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "ASIO DoP start failed";
            return false;
        }
        fillReady(ready, options, "asio-dop", "asio-dop-native", "ASIO DoP");
        return true;
    }

    void close() noexcept override { if (runtime != nullptr) { asio_stop(runtime); runtime = nullptr; } }
    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

protected:
    void fillReady(const asio_ready_info& ready, const Options& options, const char* backend, const char* impl, const char* type)
    {
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = info.sampleRate;
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = static_cast<int>(ready.requestedBufferFrameCount);
        info.exclusive = true;
        info.asio = true;
        info.format = ready.format;
        info.backend = backend;
        info.backendImpl = impl;
        info.deviceType = type;
        info.deviceName = ready.deviceName[0] != '\0' ? ready.deviceName : options.deviceName;
    }

    asio_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};

class AsioNativeDsdOutputBackend final : public NativePcmOutputBackend
{
public:
    ~AsioNativeDsdOutputBackend() override { close(); }

    bool open(NativePlaybackPipeline& pipeline, const Options& options, int sampleRate, int channels,
              int bufferFrames, std::string& error) override
    {
        char errorBuffer[2048]{};
        asio_ready_info ready{};
        const int result = asio_start_native_dsd(
            options.deviceName.empty() ? nullptr : options.deviceName.c_str(), options.deviceIndex,
            static_cast<uint32_t>(sampleRate), static_cast<uint32_t>(channels),
            static_cast<uint32_t>(std::max(0, bufferFrames)), static_cast<uint32_t>(std::max(0, options.asioOutputChannelStart)),
            renderNativeDsd, &pipeline.nativeDsdSource(), &runtime, &ready, errorBuffer, sizeof(errorBuffer));
        if (result != 0)
        {
            error = errorBuffer[0] != '\0' ? errorBuffer : "ASIO native DSD start failed";
            return false;
        }
        info.sampleRate = static_cast<int>(ready.sampleRate);
        info.hardwareSampleRate = info.sampleRate;
        info.channels = static_cast<int>(ready.channels);
        info.deviceBufferFrames = static_cast<int>(ready.bufferFrameCount);
        info.openedDeviceBufferFrames = static_cast<int>(ready.requestedBufferFrameCount);
        info.exclusive = true;
        info.asio = true;
        info.format = ready.format;
        info.backend = "asio-native-dsd";
        info.backendImpl = "asio-native-dsd";
        info.deviceType = "ASIO native DSD";
        info.deviceName = ready.deviceName[0] != '\0' ? ready.deviceName : options.deviceName;
        return true;
    }

    void close() noexcept override { if (runtime != nullptr) { asio_stop(runtime); runtime = nullptr; } }
    const NativePcmOutputReadyInfo& readyInfo() const noexcept override { return info; }

private:
    asio_runtime* runtime = nullptr;
    NativePcmOutputReadyInfo info;
};
#endif

std::unique_ptr<NativePcmOutputBackend> createNativePcmOutputBackend(const Options& options)
{
#ifdef _WIN32
    if (options.asioNativeDsdOutput)
        return std::make_unique<AsioNativeDsdOutputBackend>();
    if (options.dopOutput && options.asio)
        return std::make_unique<AsioDopOutputBackend>();
    if (options.dopOutput && options.exclusive)
        return std::make_unique<WasapiExclusiveDopOutputBackend>();
#endif
    switch (selectNativePcmOutputBackend(options))
    {
        case NativePcmOutputBackendKind::Miniaudio:
            return std::make_unique<MiniaudioPcmOutputBackend>();
#ifdef _WIN32
        case NativePcmOutputBackendKind::WasapiShared:
            return std::make_unique<WasapiSharedPcmOutputBackend>();
        case NativePcmOutputBackendKind::WasapiExclusive:
            return std::make_unique<WasapiExclusivePcmOutputBackend>();
        case NativePcmOutputBackendKind::Asio:
            return std::make_unique<AsioPcmOutputBackend>();
#else
        case NativePcmOutputBackendKind::WasapiShared:
        case NativePcmOutputBackendKind::WasapiExclusive:
        case NativePcmOutputBackendKind::Asio:
            break;
#endif
    }
    throw std::runtime_error("requested native PCM output backend is unavailable on this platform");
}

bool openNativePcmOutputWithFallback(
    NativePcmOutputBackend& backend,
    NativePlaybackPipeline& pipeline,
    const Options& options,
    int sampleRate,
    int channels,
    int requestedBufferFrames,
    int& openedBufferFrames,
    std::string& error)
{
    std::string lastError;
    for (const int candidate : buildBufferSizeAttempts(requestedBufferFrames))
    {
        backend.close();
        std::string attemptError;
        if (backend.open(pipeline, options, sampleRate, channels, candidate, attemptError))
        {
            openedBufferFrames = candidate;
            error.clear();
            return true;
        }
        lastError = attemptError;
        logLine("native PCM output buffer attempt failed: frames=" + std::to_string(candidate)
            + " error=" + attemptError);
        if (containsIgnoreCase(attemptError, "format unsupported")
            || containsIgnoreCase(attemptError, "AUDCLNT_E_UNSUPPORTED_FORMAT")
            || containsIgnoreCase(attemptError, "0x88890008"))
        {
            logLine("native PCM output format is unsupported; skipping buffer-only retries");
            break;
        }
    }
    error = lastError.empty() ? "all native PCM output buffer attempts failed" : lastError;
    return false;
}

bool configureRuntimeOutputOptions(
    const echo_audio_host::Json& params,
    const Options& current,
    Options& next,
    std::string& error)
{
    next = current;
    const std::string outputMode = getJsonString(params, "outputMode", current.asio ? "asio" : current.exclusive ? "exclusive" : "shared");
    if (outputMode == "shared" || outputMode == "system")
    {
        next.asio = false;
        next.exclusive = false;
    }
    else if (outputMode == "exclusive")
    {
        next.asio = false;
        next.exclusive = true;
    }
    else if (outputMode == "asio")
    {
        next.asio = true;
        next.exclusive = false;
    }
    else
    {
        error = "unsupported outputMode: " + outputMode;
        return false;
    }

#if !defined(_WIN32) && !defined(__APPLE__)
    if (next.exclusive || next.asio)
    {
        error = "exclusive and ASIO output are only supported on Windows";
        return false;
    }
#elif defined(__APPLE__)
    if (next.asio)
    {
        error = "ASIO output is unavailable on macOS";
        return false;
    }
#endif

    const std::string sharedBackend = getJsonString(params, "sharedBackend", next.sharedBackend);
    if (sharedBackend != "auto" && sharedBackend != "windows" && sharedBackend != "directsound"
        && sharedBackend != "alsa" && sharedBackend != "miniaudio")
    {
        error = "unsupported sharedBackend: " + sharedBackend;
        return false;
    }
    next.sharedBackend = sharedBackend;
    next.deviceId = getJsonString(params, "deviceId", next.deviceId);
    next.deviceName = getJsonString(params, "deviceName", next.deviceName);
    next.deviceIndex = static_cast<int>(getJsonDouble(params, "deviceIndex", next.deviceIndex));
    next.sampleRate = std::max(1, static_cast<int>(getJsonDouble(params, "sampleRate", next.sampleRate)));
    next.channels = std::max(1, std::min(2, static_cast<int>(getJsonDouble(params, "channels", 2))));
    next.bufferSize = std::max(0, static_cast<int>(getJsonDouble(params, "bufferSize", next.bufferSize)));
    next.asioOutputChannelStart = std::max(0, static_cast<int>(getJsonDouble(params, "asioOutputChannelStart", next.asioOutputChannelStart)));

    if (next.channels != 2)
    {
        error = "daemon local playback currently requires stereo output";
        return false;
    }

    if (next.bufferSize <= 0)
    {
        const std::string latencyProfile = getJsonString(params, "latencyProfile", "balanced");
        next.bufferSize = latencyProfile == "lowLatency" ? 1024 : latencyProfile == "stable" ? 4096 : 2048;
    }
    return true;
}

echo::PcmDitherMode parseNativeDitherMode(const std::string& mode)
{
    if (mode == "tpdf") return echo::PcmDitherMode::Tpdf;
    if (mode == "highpass-tpdf") return echo::PcmDitherMode::HighpassTpdf;
    if (mode == "ns-5") return echo::PcmDitherMode::NoiseShaped5;
    if (mode == "ns-9") return echo::PcmDitherMode::NoiseShaped9;
    if (mode == "ultra-shaped") return echo::PcmDitherMode::UltraShaped;
    return echo::PcmDitherMode::Off;
}

echo::SdmQualityProfile parseNativeSdmProfile(const std::string& profile)
{
    if (profile == "hifi") return echo::SdmQualityProfile::Hifi;
    if (profile == "reference") return echo::SdmQualityProfile::Reference;
    if (profile == "insane") return echo::SdmQualityProfile::Insane;
    return echo::SdmQualityProfile::Safe;
}

const char* nativeOutputFormatText(NativePlaybackPipeline::OutputFormat format)
{
    switch (format)
    {
        case NativePlaybackPipeline::OutputFormat::Dop: return "dop24le";
        case NativePlaybackPipeline::OutputFormat::NativeDsd: return "dsd-native-raw";
        case NativePlaybackPipeline::OutputFormat::Pcm: return "pcm";
    }
    return "pcm";
}

const char* nativeComputeBackendText(NativePlaybackPipeline::ComputeBackend backend)
{
    return backend == NativePlaybackPipeline::ComputeBackend::Cuda ? "cuda" : "cpu";
}

const char* nativeDitherModeText(echo::PcmDitherMode mode)
{
    switch (mode)
    {
        case echo::PcmDitherMode::Tpdf: return "tpdf";
        case echo::PcmDitherMode::HighpassTpdf: return "highpass-tpdf";
        case echo::PcmDitherMode::NoiseShaped5: return "ns-5";
        case echo::PcmDitherMode::NoiseShaped9: return "ns-9";
        case echo::PcmDitherMode::UltraShaped: return "ultra-shaped";
        case echo::PcmDitherMode::Off: return "off";
    }
    return "off";
}

echo_audio_host::Json nativeFallbackReasonJson(const std::string& reason)
{
    return reason.empty() ? echo_audio_host::Json(nullptr) : echo_audio_host::Json(reason);
}

echo_audio_host::Json buildNativeProcessingTelemetry(const NativePlaybackPipeline& pipeline)
{
    const auto status = pipeline.processingStatus();
    return {
        {"outputFormat", nativeOutputFormatText(status.outputFormat)},
        {"dither", {
            {"active", status.ditherActive},
            {"mode", nativeDitherModeText(status.ditherMode)},
            {"bitDepth", status.ditherBitDepth},
        }},
        {"limiter", {
            {"active", status.limiter.active},
            {"protecting", status.limiter.protecting},
            {"ceilingDb", status.limiter.ceilingDb},
            {"gainReductionDb", status.limiter.gainReductionDb},
        }},
        {"echoSrc", {
            {"active", status.echoSrc.active},
            {"sourceSampleRate", status.echoSrc.sourceSampleRate},
            {"targetSampleRate", status.echoSrc.targetSampleRate},
            {"stageCount", status.echoSrc.stageCount},
            {"requestedBackend", nativeComputeBackendText(status.echoSrc.requestedBackend)},
            {"activeBackend", nativeComputeBackendText(status.echoSrc.activeBackend)},
            {"estimatedMacsPerSecond", status.echoSrc.estimatedMacsPerSecond},
            {"nominalLatencyFrames", status.echoSrc.nominalLatencyFrames},
            {"nominalLatencyMilliseconds", status.echoSrc.nominalLatencyMilliseconds},
            {"processedBlocks", status.echoSrc.processedBlocks},
            {"lastInputFrames", status.echoSrc.lastInputFrames},
            {"lastOutputFrames", status.echoSrc.lastOutputFrames},
            {"lastProcessMilliseconds", status.echoSrc.lastProcessMilliseconds},
            {"averageProcessMilliseconds", status.echoSrc.averageProcessMilliseconds},
            {"peakProcessMilliseconds", status.echoSrc.peakProcessMilliseconds},
            {"warmupMilliseconds", status.echoSrc.warmupMilliseconds},
            {"runtimeFallbacks", status.echoSrc.runtimeFallbacks},
            {"deviceName", status.echoSrc.deviceName.empty()
                ? echo_audio_host::Json(nullptr)
                : echo_audio_host::Json(status.echoSrc.deviceName)},
            {"fallbackReason", nativeFallbackReasonJson(status.echoSrc.fallbackReason)},
        }},
        {"sdm", {
            {"active", status.sdm.active},
            {"sourceSampleRate", status.sdm.sourceSampleRate},
            {"targetSampleRate", status.sdm.targetSampleRate},
            {"stageCount", status.sdm.stageCount},
            {"requestedBackend", nativeComputeBackendText(status.sdm.requestedBackend)},
            {"activeBackend", nativeComputeBackendText(status.sdm.activeBackend)},
            {"modulatorBackend", nativeComputeBackendText(status.sdm.modulatorBackend)},
            {"oversamplingBackend", nativeComputeBackendText(status.sdm.oversamplingBackend)},
            {"estimatedMacsPerSecond", status.sdm.estimatedMacsPerSecond},
            {"processedBlocks", status.sdm.processedBlocks},
            {"lastInputFrames", status.sdm.lastInputFrames},
            {"lastOutputFrames", status.sdm.lastOutputFrames},
            {"lastProcessMilliseconds", status.sdm.lastProcessMilliseconds},
            {"averageProcessMilliseconds", status.sdm.averageProcessMilliseconds},
            {"peakProcessMilliseconds", status.sdm.peakProcessMilliseconds},
            {"warmupMilliseconds", status.sdm.warmupMilliseconds},
            {"runtimeFallbacks", status.sdm.runtimeFallbacks},
            {"deviceName", status.sdm.deviceName.empty()
                ? echo_audio_host::Json(nullptr)
                : echo_audio_host::Json(status.sdm.deviceName)},
            {"fallbackReason", nativeFallbackReasonJson(status.sdm.fallbackReason)},
            {"oversamplingFallbackReason",
                nativeFallbackReasonJson(status.sdm.oversamplingFallbackReason)},
            {"pcmDspRouted", status.sdm.pcmDspRouted},
            {"modulatorOrder", status.sdm.modulatorOrder},
            {"ntfPeakGain", status.sdm.ntfPeakGain},
            {"peakFeedbackState", status.sdm.peakFeedbackState},
            {"stabilityRecoveries", status.sdm.stabilityRecoveries},
        }},
    };
}

bool configureNativeProcessing(
    const echo_audio_host::Json& params,
    Options& options,
    NativePlaybackPipeline& pipeline,
    std::string& error)
{
    const echo_audio_host::Json* processing = nullptr;
    if (params.contains("processing") && params["processing"].is_object())
        processing = &params["processing"];
    const echo_audio_host::Json empty = echo_audio_host::Json::object();
    const auto& config = processing != nullptr ? *processing : empty;
    const std::string outputFormat = getJsonString(config, "outputFormat", "pcm");
    NativePlaybackPipeline::OutputFormat nativeFormat = NativePlaybackPipeline::OutputFormat::Pcm;
    if (outputFormat == "dop24le") nativeFormat = NativePlaybackPipeline::OutputFormat::Dop;
    else if (outputFormat == "dsd-native-raw") nativeFormat = NativePlaybackPipeline::OutputFormat::NativeDsd;
    else if (outputFormat != "pcm") { error = "native_processing_invalid_output_format"; return false; }

    if (nativeFormat == NativePlaybackPipeline::OutputFormat::Dop && !options.asio && !options.exclusive)
    {
        error = "native_sdm_dop_requires_exclusive_or_asio";
        return false;
    }
    if (nativeFormat == NativePlaybackPipeline::OutputFormat::NativeDsd && !options.asio)
    {
        error = "native_sdm_native_dsd_requires_asio";
        return false;
    }

    NativePlaybackPipeline::ProcessingConfig processingConfig;
    processingConfig.outputFormat = nativeFormat;

    const auto parseComputeBackend = [&](const echo_audio_host::Json& object,
                                         const char* prefix,
                                         NativePlaybackPipeline::ComputeBackend& destination) -> bool
    {
        const std::string requested = getJsonString(object, "computeBackend", getJsonString(object, "backend", "cpu"));
        if (requested == "cpu")
        {
            destination = NativePlaybackPipeline::ComputeBackend::Cpu;
            return true;
        }
        if (requested == "cuda")
        {
            destination = NativePlaybackPipeline::ComputeBackend::Cuda;
            return true;
        }
        error = std::string(prefix) + "_invalid_compute_backend";
        return false;
    };

    const auto parseFir = [&](const echo_audio_host::Json& firJson,
                              const char* prefix,
                              NativePlaybackPipeline::FirConfig& destination,
                              bool requireDeviceTarget) -> bool
    {
        destination.sourceSampleRate = static_cast<int>(getJsonDouble(firJson, "sourceSampleRate", 0));
        destination.targetSampleRate = static_cast<int>(getJsonDouble(firJson, "targetSampleRate", 0));
        if (!parseComputeBackend(firJson, prefix, destination.requestedBackend))
            return false;
        if (!firJson.contains("stages") || !firJson["stages"].is_array())
            return true;
        if (firJson["stages"].size() > 8)
        {
            error = std::string(prefix) + "_stage_limit_exceeded";
            return false;
        }

        int upsampleFactor = 1;
        for (const auto& stageJson : firJson["stages"])
        {
            if (!stageJson.is_object() || !stageJson.contains("taps") || !stageJson["taps"].is_array())
            {
                error = std::string(prefix) + "_invalid_stage";
                return false;
            }
            echo::EchoSrcStageConfig stage;
            stage.upsampleFactor = static_cast<int>(getJsonDouble(stageJson, "upsampleFactor", 1));
            if (stage.upsampleFactor != 1 && stage.upsampleFactor != 2
                && stage.upsampleFactor != 4 && stage.upsampleFactor != 8)
            {
                error = std::string(prefix) + "_invalid_upsample_factor";
                return false;
            }
            if (upsampleFactor > 16 / stage.upsampleFactor)
            {
                error = std::string(prefix) + "_upsample_factor_limit_exceeded";
                return false;
            }
            upsampleFactor *= stage.upsampleFactor;
            if (stageJson["taps"].size() > 8192)
            {
                error = std::string(prefix) + "_taps_limit_exceeded";
                return false;
            }
            for (const auto& tap : stageJson["taps"])
            {
                if (!tap.is_number())
                {
                    error = std::string(prefix) + "_invalid_tap";
                    return false;
                }
                stage.taps.push_back(tap.get<float>());
            }
            destination.stages.push_back(std::move(stage));
        }

        if (!destination.stages.empty()
            && (destination.sourceSampleRate <= 0 || destination.targetSampleRate <= 0
                || destination.sourceSampleRate > std::numeric_limits<int>::max() / upsampleFactor
                || destination.sourceSampleRate * upsampleFactor != destination.targetSampleRate
                || (requireDeviceTarget && destination.targetSampleRate != options.sampleRate)))
        {
            error = std::string(prefix) + "_sample_rate_mismatch";
            return false;
        }
        return true;
    };

    if (config.contains("echoSrc") && config["echoSrc"].is_object())
    {
        if (!parseFir(config["echoSrc"], "native_echo_src", processingConfig.echoSrc, true))
            return false;
    }

    std::string ditherMode = "off";
    int ditherBitDepth = 16;
    if (config.contains("dither") && config["dither"].is_object())
    {
        ditherMode = getJsonString(config["dither"], "mode", "off");
        ditherBitDepth = static_cast<int>(getJsonDouble(config["dither"], "bitDepth", 16));
    }
    if (ditherMode != "off" && ditherMode != "tpdf" && ditherMode != "highpass-tpdf"
        && ditherMode != "ns-5" && ditherMode != "ns-9" && ditherMode != "ultra-shaped")
    {
        error = "native_dither_invalid_mode";
        return false;
    }
    if (ditherBitDepth != 16 && ditherBitDepth != 24)
    {
        error = "native_dither_invalid_bit_depth";
        return false;
    }
    processingConfig.ditherMode = parseNativeDitherMode(ditherMode);
    processingConfig.ditherBitDepth = ditherBitDepth;

    processingConfig.sdm.sourceSampleRate = options.sampleRate;
    processingConfig.sdm.targetSampleRate = options.sampleRate;
    std::string sdmProfile = "safe";
    if (config.contains("sdm") && config["sdm"].is_object())
    {
        const auto& sdm = config["sdm"];
        sdmProfile = getJsonString(sdm, "qualityProfile", "safe");
        if (!parseComputeBackend(sdm, "native_sdm", processingConfig.sdm.requestedBackend))
            return false;
        processingConfig.sdm.sourceSampleRate = static_cast<int>(getJsonDouble(sdm, "sourceSampleRate", options.sampleRate));
        processingConfig.sdm.targetSampleRate = static_cast<int>(getJsonDouble(sdm, "targetSampleRate", options.sampleRate));
        const echo_audio_host::Json* sdmFir = nullptr;
        if (sdm.contains("oversampling") && sdm["oversampling"].is_object())
            sdmFir = &sdm["oversampling"];
        else if (sdm.contains("stages") && sdm["stages"].is_array())
            // Current control-plane schema keeps SDM FIR fields directly under
            // sdm. Keep the nested form accepted for forward compatibility.
            sdmFir = &sdm;
        if (sdmFir != nullptr)
        {
            if (!parseFir(*sdmFir, "native_sdm_oversampling", processingConfig.sdm.oversampling, true))
                return false;
            processingConfig.sdm.sourceSampleRate = processingConfig.sdm.oversampling.sourceSampleRate;
            processingConfig.sdm.targetSampleRate = processingConfig.sdm.oversampling.targetSampleRate;
        }
    }
    if (sdmProfile != "safe" && sdmProfile != "hifi" && sdmProfile != "reference" && sdmProfile != "insane")
    {
        error = "native_sdm_invalid_quality_profile";
        return false;
    }

    processingConfig.sdm.qualityProfile = parseNativeSdmProfile(sdmProfile);
    if (!pipeline.configure(processingConfig, error))
        return false;

    options.dopOutput = nativeFormat != NativePlaybackPipeline::OutputFormat::Pcm;
    options.asioNativeDsdOutput = nativeFormat == NativePlaybackPipeline::OutputFormat::NativeDsd;
    return true;
}

bool hasSameRuntimeOutputOptions(const Options& left, const Options& right)
{
    return left.asio == right.asio
        && left.exclusive == right.exclusive
        && left.sampleRate == right.sampleRate
        && left.channels == right.channels
        && left.deviceIndex == right.deviceIndex
        && left.bufferSize == right.bufferSize
        && left.asioOutputChannelStart == right.asioOutputChannelStart
        && left.dopOutput == right.dopOutput
        && left.asioNativeDsdOutput == right.asioNativeDsdOutput
        && left.deviceName == right.deviceName
        && left.deviceId == right.deviceId
        && left.sharedBackend == right.sharedBackend;
}

uint64_t fingerprintNativeProcessing(const echo_audio_host::Json& params)
{
    const std::string serialized = params.contains("processing")
        ? params["processing"].dump()
        : "{}";
    uint64_t fingerprint = 1469598103934665603ull;
    for (const unsigned char byte : serialized)
    {
        fingerprint ^= static_cast<uint64_t>(byte);
        fingerprint *= 1099511628211ull;
    }
    return fingerprint;
}

echo_audio_host::Json buildDeviceReadyJson(
    const NativePcmOutputReadyInfo& ready,
    int requestedSampleRate,
    int requestedChannels,
    int requestedBufferFrames,
    int openedBufferFrames,
    int fifoCapacityFrames,
    int startupPrebufferFrames,
    int startupPrebufferTimeoutMs,
    const PcmRingAudioSource& source)
{
    const int sampleRate = ready.sampleRate > 0 ? ready.sampleRate : requestedSampleRate;
    const int channels = ready.channels > 0 ? ready.channels : requestedChannels;
    const int deviceBufferFrames = ready.deviceBufferFrames > 0 ? ready.deviceBufferFrames : requestedBufferFrames;
    return {
        {"ready", true},
        {"readyLevel", "device"},
        {"protocolVersion", 1},
        {"backendContractVersion", 2},
        {"capabilities", {
            {"deviceReadyV2", true},
            {"runtimeDeviceConfigureV1", true},
            {"hostOwnedLocalPlaybackV1", true},
            {"nativeDspV1", true},
            {"nativeCudaDspV1", CudaFirProcessor::builtWithCuda()},
#if defined(__APPLE__)
            {"wasapiExclusive", false},
            {"coreAudioExclusive", true},
            {"asio", false},
#else
            {"wasapiExclusive", true},
            {"asio", true},
#endif
        }},
        {"sampleRate", sampleRate},
        {"hardwareSampleRate", ready.hardwareSampleRate > 0 ? ready.hardwareSampleRate : sampleRate},
        {"sharedDeviceSampleRate", sampleRate},
        {"sharedSampleRate", sampleRate},
        {"channels", channels},
        {"exclusive", ready.exclusive},
        {"eqControlPort", 0},
        {"deviceBufferFrames", deviceBufferFrames},
        {"nativeActualBufferFrames", deviceBufferFrames},
        {"actualBufferFrames", deviceBufferFrames},
        {"requestedDeviceBufferFrames", requestedBufferFrames},
        {"openedDeviceBufferFrames", openedBufferFrames},
        {"bufferSizeFallback", openedBufferFrames != requestedBufferFrames},
        {"fifoCapacityFrames", fifoCapacityFrames},
        {"startupPrebufferFrames", startupPrebufferFrames},
        {"startupPrebufferTimeoutMs", startupPrebufferTimeoutMs},
        {"dspActive", source.isDspActive()},
        {"dspClippingRisk", source.hasDspClippingRisk()},
        {"dspLimiterProtecting", source.isDspLimiterProtecting()},
        {"backend", ready.backend},
        {"backendImpl", ready.backendImpl},
        {"deviceType", ready.deviceType},
        {"deviceName", ready.deviceName},
    };
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
    echo::CompressorProcessor& compressor,
    echo::SpatialDspProcessor& spatialDsp,
    echo::PlaybackRateProcessor& rate,
    echo::LevelMeterProcessor& meter,
    echo::DspRackOrder& rackOrder,
    std::atomic<bool>& running,
    std::atomic<bool>* shutdownRequested,
    PcmRingAudioSource* audioSource = nullptr,
    double audioSampleRate = 0.0,
    int audioChannels = 0,
    std::function<bool(int sampleRate, int channels, int bufferFrames, echo_audio_host::Json& ready, std::string& error)>* deferredDeviceInit = nullptr,
    std::atomic<bool>* deviceOpened = nullptr,
    RawPcmInputReader* pcmInputReader = nullptr,
    std::function<bool(const echo_audio_host::Json& params, echo_audio_host::Json& result, std::string& error)>* runtimeDeviceConfigure = nullptr,
    std::function<void()>* runtimeDeviceClose = nullptr,
    echo_audio_host::Json* lastDeviceReady = nullptr,
    NativePlaybackPipeline* playbackPipeline = nullptr,
    RuntimeOutputTransitionCoordinator* outputTransitionCoordinator = nullptr)
{
#ifndef _WIN32
    fcntl(stdinFd, F_SETFL, fcntl(stdinFd, F_GETFL) | O_NONBLOCK);
#endif

    std::string pending;
    std::vector<char> pendingAutomixPcm;
    uint64_t sessionPcmStartBytes = 0;
    uint64_t sessionPcmDiscardThroughBytes = 0;
    char buf[4096];

    while (running.load(std::memory_order_acquire))
    {
        if (outputTransitionCoordinator != nullptr)
            outputTransitionCoordinator->pump();
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
                    echo_audio_host::Json object;
                    try { object = echo_audio_host::parseJson(line); }
                    catch (...) { object = echo_audio_host::Json::object(); }
                    const auto method = getJsonString(object, "method", {});
                    if (audioSource != nullptr)
                    {
                        const echo_audio_host::Json emptyParams = echo_audio_host::Json::object();
                        const auto& params = object.is_object() && object.contains("params") ? object["params"] : emptyParams;
                        const auto* paramsObject = getJsonObjectParams(params);
                        const bool sessionBeginMethod = method == "audio.sessionBegin";
                        const bool inputEndMethod = method == "audio.inputEnd";
                        const bool sessionAbortMethod = method == "audio.sessionAbort";
                        const bool hasSessionId = paramsObject != nullptr
                            && paramsObject->contains("sessionId")
                            && (*paramsObject)["sessionId"].is_number();
                        const bool sessionPauseMethod = method == "audio.pause" && hasSessionId;
                        const bool sessionResumeMethod = method == "audio.resume" && hasSessionId;
                        const bool automixMethod = method == "audio.automixPrepare"
                            || method == "audio.automixNext"
                            || method == "audio.automixNextEnd"
                            || method == "audio.automixCancel";
                        const auto sessionId = (sessionBeginMethod || inputEndMethod || sessionAbortMethod
                            || sessionPauseMethod || sessionResumeMethod || automixMethod)
                            ? getJsonSessionId(paramsObject != nullptr ? *paramsObject : emptyParams)
                            : 0;
                        const bool sessionMatches = automixMethod
                            && sessionId != 0
                            && sessionId == audioSource->session_.generation();

                        if (sessionBeginMethod)
                        {
                            echo_audio_host::Json readyResult = lastDeviceReady != nullptr
                                ? *lastDeviceReady
                                : echo_audio_host::Json::object();
                            if (deferredDeviceInit != nullptr && deviceOpened != nullptr && !deviceOpened->load(std::memory_order_acquire))
                            {
                                const int sr = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "sr", audioSampleRate)) : static_cast<int>(audioSampleRate);
                                const int ch = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "ch", static_cast<double>(audioChannels))) : audioChannels;
                                const int buffer = paramsObject ? static_cast<int>(getJsonDouble(*paramsObject, "buffer", 0)) : 0;
                                std::string error;
                                if (!(*deferredDeviceInit)(sr, ch, buffer, readyResult, error))
                                {
                                    const auto rpcId = getJsonRpcIntegerId(object);
                                    writeJsonRpcError(stdoutFd, rpcId, -32000, error);
                                    continue;
                                }
                                if (lastDeviceReady != nullptr)
                                    *lastDeviceReady = readyResult;
                            }

                            bool accepted = false;
                            const auto generation = playbackPipeline != nullptr
                                ? playbackPipeline->generation()
                                : audioSource->session_.generation();
                            // A daemon-side backend object can be recreated while the
                            // native daemon remains resident. In that case the client
                            // cannot safely infer the next native generation. Omitted
                            // sessionId delegates allocation to the authoritative host.
                            const auto assignedSessionId = sessionId != 0
                                ? sessionId
                                : deferredDeviceInit != nullptr ? generation + 1 : 0;
                            if (assignedSessionId == generation + 1)
                            {
                                pendingAutomixPcm.clear();
                                const bool startPaused = paramsObject != nullptr
                                    && paramsObject->contains("startPaused")
                                    && (*paramsObject)["startPaused"].is_boolean()
                                    && (*paramsObject)["startPaused"].get<bool>();
                                if (playbackPipeline != nullptr) playbackPipeline->beginSession(startPaused);
                                else audioSource->beginSession(startPaused);
                                sessionPcmStartBytes = pcmInputReader != nullptr
                                    ? std::max(pcmInputReader->bytesConsumed(), sessionPcmDiscardThroughBytes)
                                    : 0;
                                accepted = true;
                            }
                            else if (assignedSessionId == generation)
                            {
                                pendingAutomixPcm.clear();
                                accepted = true;
                            }
                            if (! accepted)
                            {
                                logLine("audio.sessionBegin rejected: requestedSessionId="
                                    + std::to_string(sessionId) + " assignedSessionId="
                                    + std::to_string(assignedSessionId) + " generation="
                                    + std::to_string(generation));
                            }
                            if (deferredDeviceInit != nullptr)
                            {
                                echo_audio_host::Json result = {
                                    {"accepted", accepted},
                                    {"sessionId", assignedSessionId},
                                    {"ready", readyResult},
                                };
                                writeJsonRpcResult(stdoutFd, getJsonRpcIntegerId(object), result);
                            }
                            else
                            {
                                writeJsonRpcBooleanResult(stdoutFd, getJsonRpcIntegerId(object), accepted);
                            }
                            continue;
                        }

                        if (inputEndMethod)
                        {
                            bool accepted = sessionId != 0 && sessionId == (playbackPipeline != nullptr
                                ? playbackPipeline->generation() : audioSource->session_.generation());
                            if (accepted && pcmInputReader != nullptr && paramsObject != nullptr)
                            {
                                const double requestedBytes = getJsonDouble(*paramsObject, "pcmBytes", -1.0);
                                if (requestedBytes >= 0.0)
                                {
                                    const auto pcmBytes = static_cast<uint64_t>(requestedBytes);
                                    accepted = pcmInputReader->waitUntilBytesConsumed(
                                        sessionPcmStartBytes + pcmBytes,
                                        std::chrono::seconds(5));
                                    if (! accepted)
                                        logLine("audio.inputEnd timed out waiting for PCM bytes: expected="
                                            + std::to_string(pcmBytes) + " consumed="
                                            + std::to_string(pcmInputReader->bytesConsumed() - sessionPcmStartBytes));
                                }
                            }
                            if (accepted)
                                if (playbackPipeline != nullptr) playbackPipeline->markInputEnded();
                                else audioSource->markInputEnded();
                            else
                                logLine("audio.inputEnd rejected: session=" + std::to_string(sessionId)
                                    + " generation=" + std::to_string(audioSource->session_.generation()));
                            writeJsonRpcBooleanResult(stdoutFd, getJsonRpcIntegerId(object), accepted);
                            continue;
                        }

                        if (sessionAbortMethod)
                        {
                            bool accepted = sessionId != 0 && sessionId == (playbackPipeline != nullptr
                                ? playbackPipeline->generation() : audioSource->session_.generation());
                            if (accepted && pcmInputReader != nullptr && paramsObject != nullptr)
                            {
                                const double requestedBytes = getJsonDouble(*paramsObject, "pcmBytes", -1.0);
                                if (requestedBytes >= 0.0)
                                {
                                    const auto pcmBytes = static_cast<uint64_t>(requestedBytes);
                                    sessionPcmDiscardThroughBytes = std::max(
                                        sessionPcmDiscardThroughBytes,
                                        sessionPcmStartBytes + pcmBytes);
                                    pcmInputReader->discardThrough(sessionPcmDiscardThroughBytes);
                                }
                            }
                            if (accepted)
                            {
                                pendingAutomixPcm.clear();
                                if (playbackPipeline != nullptr) playbackPipeline->requestStop();
                                else audioSource->requestStop();
                                if (pcmInputReader != nullptr && sessionPcmDiscardThroughBytes > 0)
                                {
                                    accepted = pcmInputReader->waitUntilBytesConsumed(
                                        sessionPcmDiscardThroughBytes,
                                        std::chrono::milliseconds(1000));
                                    if (! accepted)
                                    {
                                        logLine("audio.sessionAbort timed out establishing PCM discard barrier: target="
                                            + std::to_string(sessionPcmDiscardThroughBytes) + " consumed="
                                            + std::to_string(pcmInputReader->bytesConsumed()));
                                    }
                                }
                            }
                            else
                            {
                                logLine("audio.sessionAbort rejected: session=" + std::to_string(sessionId)
                                    + " generation=" + std::to_string(audioSource->session_.generation()));
                            }
                            writeJsonRpcBooleanResult(stdoutFd, getJsonRpcIntegerId(object), accepted);
                            continue;
                        }

                        if (sessionPauseMethod || sessionResumeMethod)
                        {
                            const auto activeGeneration = playbackPipeline != nullptr
                                ? playbackPipeline->generation() : audioSource->session_.generation();
                            bool accepted = sessionId != 0 && sessionId == activeGeneration;
                            if (accepted && sessionResumeMethod)
                            {
                                const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
                                while (! audioSource->isReadyToResume() && std::chrono::steady_clock::now() < deadline)
                                    std::this_thread::sleep_for(std::chrono::milliseconds(1));
                                accepted = audioSource->isReadyToResume();
                                if (! accepted)
                                    logLine("audio.resume rejected: replacement PCM did not reach prebuffer readiness");
                            }
                            if (accepted)
                            {
                                if (playbackPipeline != nullptr) playbackPipeline->setPaused(sessionPauseMethod);
                                else audioSource->setPaused(sessionPauseMethod);
                            }
                            else if (sessionId == 0 || sessionId != activeGeneration)
                                logLine(method + " rejected: session=" + std::to_string(sessionId)
                                    + " generation=" + std::to_string(activeGeneration));
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
                            if (!initMiniaudioOutputContext(scope, "auto", contextError))
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
                            if (runtimeDeviceConfigure == nullptr || paramsObject == nullptr)
                            {
                                writeJsonRpcError(stdoutFd, rpcId, -32602, "device.configure requires daemon runtime params");
                                continue;
                            }
                            echo_audio_host::Json result = echo_audio_host::Json::object();
                            std::string error;
                            if (!(*runtimeDeviceConfigure)(*paramsObject, result, error))
                                writeJsonRpcError(stdoutFd, rpcId, -32001, error);
                            else
                                writeJsonRpcResult(stdoutFd, rpcId, result);
                            continue;
                        }
                    }

                    echo::EqPresetStore presets;
                    std::string response = echo::JsonRpcProtocol::handleJsonLine(
                        line, eq, cb, conv, headroom, rg, compressor, spatialDsp, rate, meter, rackOrder, presets) + "\n";
                    writeJsonRpcFd(stdoutFd, response.data(), response.size());
                    if (method == "rpc.shutdown")
                    {
                        if (shutdownRequested != nullptr)
                            shutdownRequested->store(true, std::memory_order_release);
                        running.store(false, std::memory_order_release);
                        if (runtimeDeviceClose != nullptr)
                        {
                            try { (*runtimeDeviceClose)(); }
                            catch (const std::exception& error) { logLine(std::string("runtime device cleanup failed: ") + error.what()); }
                            catch (...) { logLine("runtime device cleanup failed"); }
                        }
                        if (outputTransitionCoordinator != nullptr)
                            outputTransitionCoordinator->close();
                        return;
                    }
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
    if (outputTransitionCoordinator != nullptr)
        outputTransitionCoordinator->close();
}

int runNativePcmHost(const Options& options)
{
    Options runtimeOptions = options;
    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    echo::ReplayGainProcessor replayGainProcessor;
    echo::CompressorProcessor compressorProcessor;
    echo::SpatialDspProcessor spatialDspProcessor;
    echo::PlaybackRateProcessor rateProcessor;
    echo::LevelMeterProcessor meterProcessor;
    echo::DspRackOrder dspRackOrder;
    const int fifoCapacityFrames = options.deviceOpenDeferred
        ? framesForMilliseconds(192000, 8000)
        : getFifoCapacityFrames(options, options.sampleRate);
    const int startupPrebufferFrames = options.deviceOpenDeferred
        ? framesForMilliseconds(48000, 60)
        : getStartupPrebufferFrames(options, options.sampleRate);
    const int nativeDsdFifoCapacityByteFrames = options.asioNativeDsdOutput
        ? getNativeDsdFifoCapacityByteFrames(options, options.sampleRate)
        : fifoCapacityFrames * 2;
    const int nativeDsdStartupPrebufferByteFrames = options.asioNativeDsdOutput
        ? getNativeDsdStartupPrebufferByteFrames(options, options.sampleRate)
        : startupPrebufferFrames * 2;
    const int startupPrebufferTimeoutMs = options.deviceOpenDeferred
        ? 500
        : getStartupPrebufferTimeoutMs(options);

    PcmRingAudioSource source(options.channels, fifoCapacityFrames, startupPrebufferFrames, startupPrebufferTimeoutMs,
        options.volume, eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor,
        replayGainProcessor, compressorProcessor, spatialDspProcessor, rateProcessor, meterProcessor, &dspRackOrder);
    DopRingSource dopSource(options.channels, fifoCapacityFrames, startupPrebufferFrames, startupPrebufferTimeoutMs);
    NativeDsdRingSource nativeDsdSource(options.channels, nativeDsdFifoCapacityByteFrames,
        nativeDsdStartupPrebufferByteFrames, startupPrebufferTimeoutMs);
    NativePlaybackPipeline playbackPipeline(
        source, dopSource, nativeDsdSource, options.channels,
        eqProcessor, convolutionProcessor, channelBalanceProcessor, headroomProcessor,
        replayGainProcessor, compressorProcessor, spatialDspProcessor, rateProcessor, meterProcessor, &dspRackOrder);
    if (options.dopOutput)
    {
        std::string passthroughError;
        const auto passthroughFormat = options.asioNativeDsdOutput
            ? NativePlaybackPipeline::OutputFormat::NativeDsd
            : NativePlaybackPipeline::OutputFormat::Dop;
        if (! playbackPipeline.configurePassthroughOutput(passthroughFormat, passthroughError))
            throw std::runtime_error("native passthrough configuration failed: " + passthroughError);
    }

    auto outputBackend = createNativePcmOutputBackend(runtimeOptions);
    std::string outputError;

    int actualSampleRate;
    int openedDeviceBufferFrames;
    int actualDeviceBufferFrames;

    std::atomic<bool> deviceOpened{true};
    std::atomic<bool> strictAsioPcmOutput{
        runtimeOptions.asio && ! runtimeOptions.dopOutput && ! runtimeOptions.asioNativeDsdOutput};
    std::mutex deviceInitMutex;
    std::function<bool(int sampleRate, int channels, int bufferFrames, bool publishReady, echo_audio_host::Json& readyResult, std::string& error)> openRuntimeDeviceLocked;
    std::function<bool(int sampleRate, int channels, int bufferFrames, echo_audio_host::Json& readyResult, std::string& error)> deferredDeviceInit;
    std::function<bool(const echo_audio_host::Json& params, echo_audio_host::Json& result, std::string& error)> runtimeDeviceConfigure;
    std::function<void()> closeRuntimeDeviceLocked;
    std::function<void()> runtimeDeviceClose;
    std::atomic<bool> shutdownRequested { false };
    RuntimeOutputTransitionCoordinator outputTransitionCoordinator;
    outputTransitionCoordinator.setShutdownSignal(&shutdownRequested);
    outputTransitionCoordinator.setExecutionWatchdog(std::chrono::seconds(30), []
    {
        std::_Exit(EXIT_FAILURE);
    });
    echo_audio_host::Json lastDeviceReady = echo_audio_host::Json::object();

    if (!options.deviceOpenDeferred)
    {
        if (! openNativePcmOutputWithFallback(*outputBackend, playbackPipeline, options, options.sampleRate, options.channels,
                requestedDeviceBufferFrames, openedDeviceBufferFrames, outputError))
            throw std::runtime_error("native PCM output open failed: " + outputError);

        const auto& ready = outputBackend->readyInfo();
        actualSampleRate = ready.sampleRate > 0 ? ready.sampleRate : options.sampleRate;
        if (ready.openedDeviceBufferFrames > 0)
            openedDeviceBufferFrames = ready.openedDeviceBufferFrames;
        actualDeviceBufferFrames = ready.deviceBufferFrames > 0
            ? ready.deviceBufferFrames
            : requestedDeviceBufferFrames;
    }
    else
    {
        deviceOpened.store(false, std::memory_order_release);

        actualSampleRate = 48000;
        openedDeviceBufferFrames = requestedDeviceBufferFrames;
        actualDeviceBufferFrames = requestedDeviceBufferFrames;

        openRuntimeDeviceLocked = [&](int sampleRate, int channels, int bufferFrames, bool publishReady, echo_audio_host::Json& readyResult, std::string& error) -> bool
        {
            if (deviceOpened.load(std::memory_order_acquire))
            {
                readyResult = lastDeviceReady;
                return true;
            }

            const int effectiveBuffer = bufferFrames > 0 ? bufferFrames : requestedDeviceBufferFrames;
            runtimeOptions.sampleRate = sampleRate;
            runtimeOptions.channels = channels;
            runtimeOptions.bufferSize = effectiveBuffer;
            outputBackend = createNativePcmOutputBackend(runtimeOptions);
            int openedBuffer = effectiveBuffer;
            if (! openNativePcmOutputWithFallback(*outputBackend, playbackPipeline, runtimeOptions, sampleRate, channels,
                    effectiveBuffer, openedBuffer, error))
                return false;

            const auto& ready = outputBackend->readyInfo();
            readyResult = buildDeviceReadyJson(
                ready,
                sampleRate,
                channels,
                effectiveBuffer,
                openedBuffer,
                fifoCapacityFrames,
                startupPrebufferFrames,
                startupPrebufferTimeoutMs,
                source);
            deviceOpened.store(true, std::memory_order_release);
            if (publishReady)
            {
                lastDeviceReady = readyResult;
                writeJsonLine(readyResult.dump());
            }
            return true;
        };

        deferredDeviceInit = [&](int sampleRate, int channels, int bufferFrames, echo_audio_host::Json& readyResult, std::string& error) -> bool
        {
            std::lock_guard<std::mutex> lock(deviceInitMutex);
            return openRuntimeDeviceLocked(sampleRate, channels, bufferFrames, true, readyResult, error);
        };

        uint64_t runtimeProcessingFingerprint = 0;
        bool runtimeProcessingConfigured = false;
        closeRuntimeDeviceLocked = [&]
        {
            if (! deviceOpened.load(std::memory_order_acquire))
                return;

            playbackPipeline.requestStop();
            playbackPipeline.markInputEnded();
            outputBackend->close();
            deviceOpened.store(false, std::memory_order_release);
            lastDeviceReady = echo_audio_host::Json::object();
        };
        runtimeDeviceClose = [&]
        {
            std::lock_guard<std::mutex> lock(deviceInitMutex);
            closeRuntimeDeviceLocked();
        };
        runtimeDeviceConfigure = [&](const echo_audio_host::Json& params, echo_audio_host::Json& result, std::string& error) -> bool
        {
            std::lock_guard<std::mutex> lock(deviceInitMutex);
            Options next;
            if (! configureRuntimeOutputOptions(params, runtimeOptions, next, error))
                return false;
            const uint64_t nextProcessingFingerprint = fingerprintNativeProcessing(params);
            const bool processingChanged = ! runtimeProcessingConfigured
                || runtimeProcessingFingerprint != nextProcessingFingerprint;
            const bool changed = processingChanged || ! hasSameRuntimeOutputOptions(runtimeOptions, next);
            if (changed && deviceOpened.load(std::memory_order_acquire))
                closeRuntimeDeviceLocked();
            if (processingChanged && ! configureNativeProcessing(params, next, playbackPipeline, error))
                return false;
            runtimeOptions = std::move(next);
            strictAsioPcmOutput.store(
                runtimeOptions.asio && ! runtimeOptions.dopOutput && ! runtimeOptions.asioNativeDsdOutput,
                std::memory_order_release);
            runtimeProcessingFingerprint = nextProcessingFingerprint;
            runtimeProcessingConfigured = true;
            result = {
                {"accepted", true},
                {"changed", changed},
                {"deviceOpened", deviceOpened.load(std::memory_order_acquire)},
                {"outputMode", runtimeOptions.asio ? "asio" : runtimeOptions.exclusive ? "exclusive" : "shared"},
                {"deviceId", runtimeOptions.deviceId},
                {"deviceIndex", runtimeOptions.deviceIndex},
                {"deviceName", runtimeOptions.deviceName},
                {"sampleRate", runtimeOptions.sampleRate},
                {"channels", runtimeOptions.channels},
                {"bufferSize", runtimeOptions.bufferSize},
                {"sharedBackend", runtimeOptions.sharedBackend},
                {"processing", buildNativeProcessingTelemetry(playbackPipeline)},
            };
            return true;
        };

        outputTransitionCoordinator.setHandler([&](int targetSampleRate) -> RuntimeOutputTransitionResult
        {
            const auto transitionStartedAt = std::chrono::steady_clock::now();
            auto finish = [&](RuntimeOutputTransitionResult transition)
            {
                transition.durationMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - transitionStartedAt).count();
                return transition;
            };

            std::lock_guard<std::mutex> lock(deviceInitMutex);
            if (targetSampleRate <= 0)
                return finish({false, 0, {}, "invalid_target_sample_rate"});
            if (! runtimeOptions.asio || runtimeOptions.dopOutput || runtimeOptions.asioNativeDsdOutput)
                return finish({false, 0, {}, "asio_pcm_transition_not_available"});
            if (! deviceOpened.load(std::memory_order_acquire))
                return finish({false, 0, {}, "asio_pcm_transition_device_not_open"});
            if (playbackPipeline.decoderSampleRate(targetSampleRate) != targetSampleRate)
                return finish({false, 0, {}, "asio_pcm_transition_requires_resampling"});

            auto actualOpenSampleRate = [&]() -> int
            {
                const auto& ready = outputBackend->readyInfo();
                return ready.hardwareSampleRate > 0
                    ? ready.hardwareSampleRate
                    : ready.sampleRate > 0 ? ready.sampleRate : 0;
            };
            auto publishStableReady = [&](const echo_audio_host::Json& readyResult)
            {
                lastDeviceReady = readyResult;
                writeJsonLine(readyResult.dump());
            };

            const int previousActualSampleRate = actualOpenSampleRate();
            if (previousActualSampleRate == targetSampleRate)
                return finish({true, previousActualSampleRate, "resident"});

            const Options previousOptions = runtimeOptions;
            const int rollbackSampleRate = previousActualSampleRate > 0
                ? previousActualSampleRate
                : previousOptions.sampleRate;
            auto rollbackPreviousDevice = [&](std::string& rollbackError) -> int
            {
                runtimeOptions = previousOptions;
                runtimeOptions.sampleRate = rollbackSampleRate;
                echo_audio_host::Json rollbackReady;
                if (! openRuntimeDeviceLocked(
                        rollbackSampleRate,
                        runtimeOptions.channels,
                        runtimeOptions.bufferSize,
                        false,
                        rollbackReady,
                        rollbackError))
                    return 0;
                const int rollbackActualRate = actualOpenSampleRate();
                if (rollbackActualRate != rollbackSampleRate)
                {
                    closeRuntimeDeviceLocked();
                    rollbackError = "rollback_rate_mismatch:"
                        + std::to_string(rollbackSampleRate) + "->" + std::to_string(rollbackActualRate);
                    return 0;
                }
                publishStableReady(rollbackReady);
                return rollbackActualRate;
            };

            closeRuntimeDeviceLocked();
            runtimeOptions.sampleRate = targetSampleRate;

            echo_audio_host::Json readyResult;
            std::string transitionError;
            if (! openRuntimeDeviceLocked(
                    targetSampleRate,
                    runtimeOptions.channels,
                    runtimeOptions.bufferSize,
                    false,
                    readyResult,
                    transitionError))
            {
                std::string rollbackError;
                const int rollbackActualRate = rollbackPreviousDevice(rollbackError);
                return finish({
                    false,
                    rollbackActualRate,
                    rollbackActualRate > 0 ? "rollback" : "failed",
                    "asio_pcm_transition_open_failed:" + transitionError
                        + (rollbackActualRate > 0 ? std::string{} : ";rollback_failed:" + rollbackError),
                });
            }

            const int actualRate = actualOpenSampleRate();
            if (actualRate != targetSampleRate)
            {
                closeRuntimeDeviceLocked();
                std::string rollbackError;
                const int rollbackActualRate = rollbackPreviousDevice(rollbackError);
                return finish({
                    false,
                    rollbackActualRate,
                    rollbackActualRate > 0 ? "rollback" : "failed",
                    "asio_pcm_transition_rate_mismatch:"
                        + std::to_string(targetSampleRate) + "->" + std::to_string(actualRate)
                        + (rollbackActualRate > 0 ? std::string{} : ";rollback_failed:" + rollbackError),
                });
            }

            publishStableReady(readyResult);
            return finish({true, actualRate, "asio-full-reopen"});
        });
    }

    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor,
        headroomProcessor, replayGainProcessor, rateProcessor, meterProcessor);
    const bool eqControlReady = eqControlServer.start();

    std::unique_ptr<RawPcmInputReader> pcmInputReader;
    if (options.pcmInputFd >= 0)
    {
        const auto onInputError = [](const std::string& error) { logLine(error); };
        if (options.asioNativeDsdOutput)
        {
            pcmInputReader = std::make_unique<RawPcmInputReader>(
                options.pcmInputFd,
                options.channels,
                1,
                [&playbackPipeline](const uint8_t* samples, int byteFrames)
                {
                    return playbackPipeline.nativeDsdSource().push(samples, byteFrames);
                },
                onInputError);
        }
        else if (options.dopOutput)
        {
            pcmInputReader = std::make_unique<RawPcmInputReader>(
                options.pcmInputFd,
                options.channels,
                3,
                [&playbackPipeline, channels = options.channels](const uint8_t* payload, int frames)
                {
                    const size_t sampleCount = static_cast<size_t>(frames) * static_cast<size_t>(channels);
                    std::vector<uint32_t> samples(sampleCount);
                    for (size_t sample = 0; sample < sampleCount; ++sample)
                    {
                        const size_t byteOffset = sample * 3u;
                        samples[sample] =
                            static_cast<uint32_t>(payload[byteOffset])
                            | (static_cast<uint32_t>(payload[byteOffset + 1]) << 8)
                            | (static_cast<uint32_t>(payload[byteOffset + 2]) << 16);
                    }
                    return playbackPipeline.dopSource().push(samples.data(), frames);
                },
                onInputError);
        }
        else
        {
            pcmInputReader = std::make_unique<RawPcmInputReader>(
                options.pcmInputFd,
                options.channels,
                [&playbackPipeline](const float* samples, int frames) { return playbackPipeline.push(samples, frames); },
                onInputError);
        }
        pcmInputReader->start();
    }

    std::atomic<bool> jsonRpcRunning{true};
    std::unique_ptr<std::thread> jsonRpcThread;
    if (options.rpcStdinFd >= 0 && options.rpcStdoutFd >= 0)
    {
        if (options.deviceOpenDeferred)
        {
            jsonRpcThread = std::make_unique<std::thread>(runJsonRpcOnStdio,
                options.rpcStdinFd, options.rpcStdoutFd, std::ref(eqProcessor), std::ref(channelBalanceProcessor),
                std::ref(convolutionProcessor), std::ref(headroomProcessor), std::ref(replayGainProcessor), std::ref(compressorProcessor), std::ref(spatialDspProcessor),
                std::ref(rateProcessor), std::ref(meterProcessor), std::ref(dspRackOrder), std::ref(jsonRpcRunning), &shutdownRequested, &source,
                static_cast<double>(actualSampleRate), options.channels,
                &deferredDeviceInit, &deviceOpened, pcmInputReader.get(), &runtimeDeviceConfigure, &runtimeDeviceClose, &lastDeviceReady,
                &playbackPipeline, &outputTransitionCoordinator);
        }
        else
        {
            jsonRpcThread = std::make_unique<std::thread>(runJsonRpcOnStdio,
                options.rpcStdinFd, options.rpcStdoutFd, std::ref(eqProcessor), std::ref(channelBalanceProcessor),
                std::ref(convolutionProcessor), std::ref(headroomProcessor), std::ref(replayGainProcessor), std::ref(compressorProcessor), std::ref(spatialDspProcessor),
                std::ref(rateProcessor), std::ref(meterProcessor), std::ref(dspRackOrder), std::ref(jsonRpcRunning), &shutdownRequested, &source,
                static_cast<double>(actualSampleRate), options.channels,
                nullptr, nullptr, pcmInputReader.get(), nullptr, nullptr, nullptr, &playbackPipeline, nullptr);
        }
    }

    std::unique_ptr<AudioDaemon> audioDaemon;

    AudioDaemon::SourceHooks sourceHooks{
        [&playbackPipeline]() { playbackPipeline.beginSession(); },
        [&playbackPipeline]() { playbackPipeline.continueSessionAfterDrain(); },
        [&playbackPipeline]() { playbackPipeline.markInputEnded(); },
        [&playbackPipeline]() { playbackPipeline.requestStop(); },
        [&playbackPipeline](bool paused) { playbackPipeline.setPaused(paused); },
        [&playbackPipeline](const float* samples, int frames, bool paused) { return playbackPipeline.replaceBufferedAudio(samples, frames, paused); },
        [&playbackPipeline](const float* samples, int frames) { return playbackPipeline.push(samples, frames); },
        [&playbackPipeline](const float* samples, int frames, uint64_t generation) { return playbackPipeline.pushForGeneration(samples, frames, generation); },
        [&playbackPipeline]() { return playbackPipeline.prepareGapless(); },
        [&playbackPipeline](const float* samples, int frames) { return playbackPipeline.pushGaplessNext(samples, frames); },
        [&playbackPipeline]() { playbackPipeline.markGaplessNextEnded(); },
        [&playbackPipeline]() { playbackPipeline.cancelGapless(); },
        [&playbackPipeline]() -> uint64_t { return playbackPipeline.getGaplessBoundaryFrame(); },
        [&playbackPipeline](
            uint64_t fadeStartFrame,
            uint64_t overlapFrames,
            double currentGainDb,
            double nextGainDb,
            double currentReplayGainDb,
            double nextReplayGainDb) {
            return playbackPipeline.prepareAutomixFrames(
                fadeStartFrame,
                overlapFrames,
                currentGainDb,
                nextGainDb,
                currentReplayGainDb,
                nextReplayGainDb);
        },
        [&playbackPipeline](const float* samples, int frames) {
            return playbackPipeline.pushAutomixNext(samples, frames);
        },
        [&playbackPipeline]() { playbackPipeline.markAutomixNextEnded(); },
        [&playbackPipeline]() { playbackPipeline.cancelAutomix(); },
        [&playbackPipeline](uint64_t fadeFrames) { playbackPipeline.failAutomixNext(fadeFrames); },
        [&playbackPipeline]() -> uint64_t { return playbackPipeline.getAutomixFadeStartFrame(); },
        [&playbackPipeline]() -> uint64_t { return playbackPipeline.getAutomixFadeEndFrame(); },
        [&playbackPipeline]() -> bool { return playbackPipeline.isAutomixActive(); },
        [&playbackPipeline]() -> uint64_t { return playbackPipeline.generation(); },
        [&playbackPipeline](float volume) { playbackPipeline.setGain(volume); },
        [&playbackPipeline](int outputSampleRate) { return playbackPipeline.decoderSampleRate(outputSampleRate); },
        [&playbackPipeline]() { return buildNativeProcessingTelemetry(playbackPipeline); },
        [&playbackPipeline]() { return playbackPipeline.seekPrerollFrames(); },
        [&playbackPipeline](
            const float* samples,
            int frames,
            int prerollFrames,
            bool paused) {
            return playbackPipeline.replaceBufferedAudioWithPreroll(
                samples,
                frames,
                prerollFrames,
                paused);
        },
        [&outputTransitionCoordinator](int targetSampleRate, nlohmann::json& result, std::string& error) {
            const auto transition = outputTransitionCoordinator.request(targetSampleRate);
            result = {
                {"success", transition.success},
                {"actualSampleRate", transition.actualSampleRate},
                {"mode", transition.mode},
                {"durationMs", transition.durationMs},
            };
            error = transition.error;
            return transition.success;
        },
        [&strictAsioPcmOutput]() {
            return strictAsioPcmOutput.load(std::memory_order_acquire);
        },
    };
    audioDaemon = std::make_unique<AudioDaemon>(std::move(sourceHooks),
        actualSampleRate, options.rpcStdoutFd, shutdownRequested,
        AudioDaemon::DecodePath::StreamingLibav, options.channels);
    audioDaemon->initialize();
    meterProcessor.setCallback([daemon = audioDaemon.get()](const echo::LevelMeterSnapshot& snapshot) {
        daemon->queueLevelMeter(snapshot);
    });
    logLine("daemon mode: awaiting JSON-RPC commands");

    logLine("ready event writing");
    const std::string nativeCudaDspCapability =
        CudaFirProcessor::builtWithCuda() ? "true" : "false";
#if defined(__APPLE__)
    const std::string nativeOutputCapabilities = "\"wasapiExclusive\":false,\"coreAudioExclusive\":true,\"asio\":false";
#else
    const std::string nativeOutputCapabilities = "\"wasapiExclusive\":true,\"asio\":true";
#endif
    if (options.deviceOpenDeferred)
    {
        writeJsonLine(
            std::string("{\"ready\":true,\"readyLevel\":\"process\",\"protocolVersion\":1,\"backendContractVersion\":2,\"capabilities\":{\"deviceReadyV2\":true,\"runtimeDeviceConfigureV1\":true,\"hostOwnedLocalPlaybackV1\":true,\"nativeDspV1\":true,\"nativeCudaDspV1\":")
            + nativeCudaDspCapability
            + "," + nativeOutputCapabilities + "}}");
    }
    else
    {
        const auto& ready = outputBackend->readyInfo();
        writeJsonLine(
            std::string("{\"ready\":true,\"readyLevel\":\"device\",\"protocolVersion\":1,\"backendContractVersion\":2,\"capabilities\":{\"deviceReadyV2\":true,\"nativeDspV1\":true,\"nativeCudaDspV1\":") + nativeCudaDspCapability
            + "," + nativeOutputCapabilities + "},\"sampleRate\":" + std::to_string(actualSampleRate)
            + ",\"hardwareSampleRate\":" + std::to_string(ready.hardwareSampleRate > 0 ? ready.hardwareSampleRate : actualSampleRate)
            + ",\"sharedDeviceSampleRate\":" + std::to_string(actualSampleRate)
            + ",\"sharedSampleRate\":" + std::to_string(actualSampleRate)
            + ",\"channels\":" + std::to_string(ready.channels > 0 ? ready.channels : options.channels)
            + ",\"exclusive\":" + std::string(ready.exclusive ? "true" : "false")
            + ",\"eqControlPort\":" + std::to_string(eqControlReady ? options.eqControlPort : 0)
            + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
            + ",\"requestedDeviceBufferFrames\":" + std::to_string(requestedDeviceBufferFrames)
            + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
            + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != requestedDeviceBufferFrames ? "true" : "false")
            + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
            + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
            + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
            + ",\"dspActive\":" + std::string(source.isDspActive() ? "true" : "false")
            + ",\"dspClippingRisk\":" + std::string(source.hasDspClippingRisk() ? "true" : "false")
            + ",\"dspLimiterProtecting\":" + std::string(source.isDspLimiterProtecting() ? "true" : "false")
            + ",\"backend\":\"" + ready.backend + "\",\"backendImpl\":\"" + ready.backendImpl + "\""
            + ",\"deviceType\":\"" + ready.deviceType + "\",\"deviceName\":\"" + jsonEscape(ready.deviceName) + "\"}");
    }

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire))
    {
        audioDaemon->flushLevelMeter();
        const auto frames = playbackPipeline.getFramesPlayed();
        if (frames != lastReported)
        {
            // Two position-reporting paths serve different consumers:
            //   stdout (fd 1) → DaemonHostProcess reads this via child.stdout for status tracking
            //   RPC pipe (fd 4 via options.rpcStdoutFd) → JsonRpcBridge receives structured JSON-RPC
            //   position notifications for AudioBackend consumers
            writeJsonLine(std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(playbackPipeline.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(playbackPipeline.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(playbackPipeline.getUnderrunFrames()) + "}");
            lastReported = frames;

            audioDaemon->emitPosition(frames, playbackPipeline.getReadyFrames(), playbackPipeline.hasInputEnded());
        }

        if (playbackPipeline.isDrained())
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


    const auto finalFrames = playbackPipeline.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(playbackPipeline.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(playbackPipeline.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(playbackPipeline.getUnderrunFrames()) + "}");

    if (playbackPipeline.getUnderrunCallbacks() > 0)
        logLine("Output underruns: callbacks=" + std::to_string(playbackPipeline.getUnderrunCallbacks())
            + " frames=" + std::to_string(playbackPipeline.getUnderrunFrames()));

    if (! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    if (jsonRpcThread)
    {
        outputTransitionCoordinator.close();
        jsonRpcRunning.store(false);
        if (! outputTransitionCoordinator.waitUntilIdle(std::chrono::seconds(2)))
        {
            logLine("ASIO transition did not return during shutdown; forcing audio-host exit");
            std::_Exit(EXIT_FAILURE);
        }
        jsonRpcThread->join();
    }

    if (pcmInputReader)
    {
        playbackPipeline.requestStop();
        pcmInputReader->stop();
    }

    cleanupHostAndAck(
        [&] { cleanupPcmSource(source); },
        [&]
        {
            try { outputBackend->close(); }
            catch (const std::exception& error) { logLine(std::string("native PCM output cleanup failed: ") + error.what()); }
            catch (...) { logLine("native PCM output cleanup failed"); }
        },
        [&] { cleanupEqControlServer(eqControlServer); },
        shutdownAckSent);
    return 0;
}
int runHost(const Options& options)
{
    configureProcessPriority();
    ScopedTimerResolution timerResolution;
    if (options.asioNativeDsdOutput && (! options.asio || ! options.dopOutput))
        throw std::runtime_error("ASIO native DSD output requires ASIO DoP output");
    if (options.dopOutput && ! options.asio && ! options.exclusive)
        throw std::runtime_error("DoP output requires WASAPI exclusive or ASIO");
#ifndef _WIN32
#if !defined(__APPLE__)
    if (options.exclusive)
        throw std::runtime_error("exclusive output is only supported on Windows");
#endif
#if defined(__APPLE__)
    if (options.dopOutput)
        throw std::runtime_error("DoP output is not yet supported by the macOS PCM backend");
#endif
    if (options.sharedBackend == "directsound" || options.sharedBackend == "windows")
        throw std::runtime_error("requested Windows shared backend is unavailable on this platform");
#endif
    const auto backendKind = selectNativePcmOutputBackend(options);
    logLine(backendKind == NativePcmOutputBackendKind::Miniaudio
#if defined(__APPLE__)
        ? (options.exclusive ? "Backend: CoreAudio Hog Mode exclusive" : "Backend: CoreAudio shared")
#else
        ? "Backend: miniaudio (explicit experimental selection)"
#endif
        : backendKind == NativePcmOutputBackendKind::WasapiShared
            ? "Backend: native WASAPI shared"
            : backendKind == NativePcmOutputBackendKind::WasapiExclusive
                ? "Backend: native WASAPI exclusive"
                : "Backend: native ASIO");
    return runNativePcmHost(options);
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
