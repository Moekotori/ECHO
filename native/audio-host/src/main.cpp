#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include "../../audio-engine/EqMessageProtocol.h"
  #include "../../audio-engine/DspChain.h"
  #include "../../audio-engine/ChannelBalanceProcessor.h"
  #include "../../audio-engine/ConvolutionProcessor.h"
  #include "../../audio-engine/EqProcessor.h"

#if JUCE_WINDOWS
#include "audio_host_exit_codes.h"
#include "asio_host.h"
#include "wasapi_exclusive.h"
#include "wasapi_shared.h"
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <avrt.h>
#include <mmsystem.h>
#include <shellapi.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <propsys.h>
#include <wrl/client.h>
#endif

#ifndef ECHO_ENABLE_ASIO
#define ECHO_ENABLE_ASIO 0
#endif

namespace
{
void logLine(const std::string& message);

std::mutex stdoutMutex;

#if JUCE_WINDOWS
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

void configurePcmReaderThread()
{
    configureThreadPriority(L"Playback", AVRT_PRIORITY_HIGH);
}
#else
class ScopedTimerResolution final {};

void configureProcessPriority() {}
void configureAudioCallbackThread() {}
void configurePcmReaderThread() {}
#endif

struct Options
{
    bool list = false;
    bool asio = false;
    bool exclusive = false;
    int sampleRate = 44100;
    int channels = 2;
    int deviceIndex = -1;
    int bufferSize = 0;
    int asioOutputChannelStart = 0;
    int fifoCapacityMs = 0;
    int startupPrebufferMs = 0;
    int startupPrebufferTimeoutMs = 0;
    bool startupPrebufferMsSpecified = false;
    bool startupPrebufferTimeoutMsSpecified = false;
    bool framedStdin = false;
    bool dopOutput = false;
    bool asioNativeDsdOutput = false;
    int nativeDsdSampleRate = 0;
    bool useJuceOutput = false;
    bool decodePcm = false;
    bool decodeServer = false;
    double decodeStartSeconds = 0.0;
    bool asioControlPanel = false;
    int eqControlPort = 0;
    double volume = 1.0;
    juce::String deviceName;
    juce::String decodeFile;
    juce::String sharedBackend = "auto";
};

enum class StdinFrameType : uint8_t
{
    BeginSession = 1,
    PcmF32Le = 2,
    EndSession = 3,
    Shutdown = 4,
    SetVolume = 5,
    Dop24Le = 6,
    NativeDsdRaw = 7,
    AutomixPrepare = 8,
    AutomixNextPcmF32Le = 9,
    AutomixNextEnd = 10,
    AutomixCancel = 11,
    SetPaused = 12,
};

struct StdinFrameHeader
{
    uint8_t type = 0;
    uint32_t sessionId = 0;
    uint32_t payloadBytes = 0;
};

enum class DecodeServerFrameType : uint8_t
{
    Start = 1,
    Cancel = 2,
    Shutdown = 3,
    Ready = 101,
    PcmF32Le = 102,
    End = 103,
    Error = 104,
};

struct DecodeServerFrameHeader
{
    uint8_t type = 0;
    uint32_t sessionId = 0;
    uint32_t payloadBytes = 0;
};

struct DecodeServerRequest
{
    uint32_t sessionId = 0;
    juce::String filePath;
    double startSeconds = 0.0;
    int sampleRate = 44100;
    int channels = 2;
};

struct DeviceDescriptor
{
    int index = -1;
    juce::String typeName;
    juce::String name;
    int sampleRate = 0;
    int sharedSampleRate = 0;
    bool isDefault = false;
    bool isAsio = false;
    int asioOutputChannels = 0;
    juce::String asioOutputChannelNames;
};

struct AutomixNativePlan
{
    std::atomic<bool> enabled { false };
    std::atomic<bool> fadeActivated { false };
    std::atomic<uint64_t> fadeStartFrame { 0 };
    std::atomic<uint64_t> fadeEndFrame { 0 };
    std::atomic<uint64_t> gainReleaseEndFrame { 0 };
    std::atomic<uint64_t> overlapFrames { 1 };
    std::atomic<float> currentGain { 1.0f };
    std::atomic<float> nextGain { 1.0f };
};

enum class DeviceListMode
{
    Shared,
    Exclusive,
    Asio,
};

void logLine(const std::string& message)
{
    std::cerr << "[echo-audio-host] " << message << std::endl;
}

long long elapsedMs(std::chrono::steady_clock::time_point started)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started).count();
}

void writeJsonLine(const std::string& json)
{
    const std::lock_guard<std::mutex> lock(stdoutMutex);
    std::cout << json << std::endl;
}

std::string jsonEscape(const juce::String& input)
{
    std::string source = input.toStdString();
    std::string result;
    result.reserve(source.size() + 8);

    for (char ch : source)
    {
        switch (ch)
        {
            case '\\': result += "\\\\"; break;
            case '"': result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += ch; break;
        }
    }

    return result;
}

int parseInt(const juce::String& value, int fallback)
{
    if (value.isEmpty())
        return fallback;

    try
    {
        return std::stoi(value.toStdString());
    }
    catch (...)
    {
        return fallback;
    }
}

double parseDouble(const juce::String& value, double fallback)
{
    if (value.isEmpty())
        return fallback;

    try
    {
        return std::stod(value.toStdString());
    }
    catch (...)
    {
        return fallback;
    }
}

std::vector<juce::String> getCommandLineArgs(int argc, char* argv[])
{
#if JUCE_WINDOWS
    int wideArgc = 0;
    LPWSTR* wideArgv = CommandLineToArgvW(GetCommandLineW(), &wideArgc);
    std::vector<juce::String> wideArgs;

    if (wideArgv != nullptr)
    {
        wideArgs.reserve(static_cast<size_t>(wideArgc));

        for (int i = 0; i < wideArgc; ++i)
            wideArgs.emplace_back(wideArgv[i]);

        LocalFree(wideArgv);
        return wideArgs;
    }
#endif

    std::vector<juce::String> args;
    args.reserve(static_cast<size_t>(std::max(argc, 0)));

    for (int i = 0; i < argc; ++i)
        args.emplace_back(argv[i] != nullptr ? juce::String::fromUTF8(argv[i]) : juce::String());

    return args;
}

Options parseOptions(const std::vector<juce::String>& args)
{
    Options options;

    for (size_t i = 1; i < args.size(); ++i)
    {
        const auto arg = args[i];

        if (arg == "-list")
        {
            options.list = true;
        }
        else if (arg == "-asio")
        {
            options.asio = true;
        }
        else if (arg == "-exclusive")
        {
            options.exclusive = true;
        }
        else if (arg == "-framed-stdin")
        {
            options.framedStdin = true;
        }
        else if (arg == "-dop-output")
        {
            options.dopOutput = true;
        }
        else if (arg == "-asio-native-dsd-output")
        {
            options.asioNativeDsdOutput = true;
        }
        else if (arg == "-juce-output")
        {
            options.useJuceOutput = true;
        }
        else if (arg == "-decode-pcm" && i + 1 < args.size())
        {
            options.decodePcm = true;
            options.decodeFile = args[++i];
        }
        else if (arg == "-decode-server")
        {
            options.decodeServer = true;
        }
        else if (arg == "-asio-control-panel")
        {
            options.asioControlPanel = true;
            options.asio = true;
        }
        else if (arg == "-ss" && i + 1 < args.size())
        {
            options.decodeStartSeconds = std::max(0.0, parseDouble(args[++i], options.decodeStartSeconds));
        }
        else if (arg == "-sr" && i + 1 < args.size())
        {
            options.sampleRate = std::max(1, parseInt(args[++i], options.sampleRate));
        }
        else if (arg == "-native-dsd-sr" && i + 1 < args.size())
        {
            options.nativeDsdSampleRate = std::max(0, parseInt(args[++i], options.nativeDsdSampleRate));
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
        else if (arg == "-vol" && i + 1 < args.size())
        {
            options.volume = std::max(0.0, std::min(1.0, parseDouble(args[++i], options.volume)));
        }
        else if (arg == "-shared-backend" && i + 1 < args.size())
        {
            const auto value = args[++i].toLowerCase();
            if (value == "auto" || value == "windows" || value == "directsound" || value == "alsa")
                options.sharedBackend = value;
        }
    }

    return options;
}

void writeErrorEvent(const std::string& message, const std::string& reason = "runtime_error")
{
    writeJsonLine(
        "{\"event\":\"error\",\"reason\":\"" + jsonEscape(juce::String(reason))
        + "\",\"message\":\"" + jsonEscape(juce::String(message)) + "\"}");
}

bool isAsioType(const juce::String& typeName)
{
    return typeName.containsIgnoreCase("asio");
}

bool isExclusiveType(const juce::String& typeName)
{
    return typeName.containsIgnoreCase("exclusive");
}

bool isAlsaType(const juce::String& typeName)
{
    return typeName.containsIgnoreCase("alsa");
}

bool isJackType(const juce::String& typeName)
{
    return typeName.containsIgnoreCase("jack");
}

bool isPreferredSharedType(const juce::String& typeName)
{
#if ! JUCE_WINDOWS
    return ! isExclusiveType(typeName) && isAlsaType(typeName);
#else
    return ! isExclusiveType(typeName)
        && (typeName.containsIgnoreCase("windows audio")
            || typeName.containsIgnoreCase("wasapi"));
#endif
}

bool isDirectSoundType(const juce::String& typeName)
{
    return typeName.containsIgnoreCase("directsound");
}

int sharedTypePriority(const juce::String& typeName)
{
#if ! JUCE_WINDOWS
    if (isAlsaType(typeName))
        return 0;

    if (typeName.containsIgnoreCase("shared"))
        return 1;

    if (isJackType(typeName))
        return 2;

    return 3;
#else
    if (typeName.containsIgnoreCase("shared"))
        return 0;

    if (typeName.containsIgnoreCase("windows audio") || typeName.containsIgnoreCase("wasapi"))
        return 1;

    if (typeName.containsIgnoreCase("directsound"))
        return 2;

    return 3;
#endif
}

bool shouldIncludeType(const juce::String& typeName, DeviceListMode mode)
{
    const bool asioType = isAsioType(typeName);
    const bool exclusiveType = isExclusiveType(typeName);

    if (mode == DeviceListMode::Asio)
        return asioType;

    if (asioType)
        return false;

    if (mode == DeviceListMode::Exclusive)
        return exclusiveType;

    return ! exclusiveType;
}

bool shouldIncludeSharedBackendType(const juce::String& typeName, const juce::String& sharedBackend)
{
    if (sharedBackend == "alsa")
        return isAlsaType(typeName);

    if (sharedBackend == "windows")
#if JUCE_WINDOWS
        return isPreferredSharedType(typeName);
#else
        return false;
#endif

    if (sharedBackend == "directsound")
        return isDirectSoundType(typeName);

    return ! isDirectSoundType(typeName);
}

DeviceListMode getHostOutputMode(const Options& options)
{
    if (options.asio)
        return DeviceListMode::Asio;

    if (options.exclusive)
        return DeviceListMode::Exclusive;

    return DeviceListMode::Shared;
}

bool isDisabledSharedBackend(const Options& options)
{
    return false;
}

std::string getBackendName(const Options& options, const juce::String& typeName)
{
    if (options.asio || isAsioType(typeName))
        return "asio";

    if (options.exclusive || isExclusiveType(typeName))
        return "wasapi-exclusive";

#if ! JUCE_WINDOWS
    if (isAlsaType(typeName))
        return "alsa-shared";

    if (isJackType(typeName))
        return "jack-shared";

    return "linux-shared";
#else
    return isDirectSoundType(typeName) ? "directsound-shared" : "wasapi-shared";
#endif
}

std::string getBackendImplName(const Options& options, const juce::String& typeName)
{
    if (options.asio || isAsioType(typeName))
        return "juce-asio";

    if (options.exclusive || isExclusiveType(typeName))
        return "juce-wasapi-exclusive";

#if ! JUCE_WINDOWS
    if (isAlsaType(typeName))
        return "juce-alsa-shared";

    if (isJackType(typeName))
        return "juce-jack-shared";

    return "juce-linux-shared";
#else
    return isDirectSoundType(typeName) ? "juce-directsound-shared" : "juce-wasapi-shared";
#endif
}

std::string getOpenFailurePrefix(const Options& options)
{
    if (options.asio)
        return "ASIO open failed: ";

    if (options.exclusive)
        return "WASAPI exclusive open failed: ";

    if (! options.asio && ! options.exclusive && options.sharedBackend == "alsa")
        return "ALSA open failed: ";

    return "output open failed: ";
}

int getDeviceBufferSize(const Options& options)
{
    if (options.bufferSize > 0)
        return options.bufferSize;

    return 256;
}

std::vector<int> buildBufferSizeAttempts(const Options& options)
{
    std::vector<int> buffers;

    const auto add = [&] (int size)
    {
        if (size > 0 && std::find(buffers.begin(), buffers.end(), size) == buffers.end())
            buffers.push_back(size);
    };

    const int requestedBufferSize = getDeviceBufferSize(options);
    add(requestedBufferSize);

    for (const auto fallbackSize : { 256, 512, 1024, 2048, 4096, 8192 })
    {
        if (fallbackSize > requestedBufferSize)
            add(fallbackSize);
    }

    return buffers;
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

int pickRate(const juce::Array<double>& rates, bool maxRate)
{
    if (rates.isEmpty())
        return 0;

    double picked = rates[0];

    for (auto rate : rates)
    {
        if (std::abs(rate - 48000.0) < 0.5 && ! maxRate)
            return 48000;

        picked = maxRate ? std::max(picked, rate) : picked;
    }

    return static_cast<int>(std::round(picked));
}

void createDeviceTypes(juce::OwnedArray<juce::AudioIODeviceType>& types)
{
    juce::AudioDeviceManager manager;
    manager.createAudioDeviceTypes(types);
}

#if JUCE_WINDOWS
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
    juce::String id;
    juce::String name;
    int mixSampleRate = 0;
    bool isDefault = false;
};

juce::String getEndpointId(IMMDevice* device)
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

    juce::String id(rawId);
    CoTaskMemFree(rawId);
    return id;
}

juce::String getEndpointFriendlyName(IMMDevice* device)
{
    if (device == nullptr)
        return {};

    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (FAILED(device->OpenPropertyStore(STGM_READ, properties.GetAddressOf())))
        return {};

    PROPVARIANT value;
    PropVariantInit(&value);

    juce::String name;
    if (SUCCEEDED(properties->GetValue(echoPkeyDeviceFriendlyName, &value)) && value.vt == VT_LPWSTR && value.pwszVal != nullptr)
        name = juce::String(value.pwszVal);

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

juce::String getDefaultEndpointId(IMMDeviceEnumerator& enumerator)
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
            defaultId.isNotEmpty() && id == defaultId,
        });
    }

    return endpoints;
}

bool isCoreAudioEndpointNameMatch(const juce::String& endpointName, const juce::String& juceDeviceName)
{
    return endpointName.isNotEmpty()
        && juceDeviceName.isNotEmpty()
        && (endpointName == juceDeviceName
            || endpointName.containsIgnoreCase(juceDeviceName)
            || juceDeviceName.containsIgnoreCase(endpointName));
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

std::vector<DeviceDescriptor> enumerateLegacyWasapiExclusiveDevices()
{
    std::vector<DeviceDescriptor> devices;
    wasapi_exclusive_device_info* rawDevices = nullptr;
    uint32_t rawCount = 0;

    if (wasapi_exclusive_list_devices(&rawDevices, &rawCount) != 0 || rawDevices == nullptr)
        return devices;

    devices.reserve(rawCount);

    for (uint32_t i = 0; i < rawCount; ++i)
    {
        devices.push_back({
            static_cast<int>(i),
            "Windows Audio (Exclusive Mode)",
            juce::String::fromUTF8(rawDevices[i].name),
            static_cast<int>(rawDevices[i].highestSampleRate),
            static_cast<int>(rawDevices[i].sharedSampleRate),
            rawDevices[i].isDefault != 0,
            false,
        });
    }

    wasapi_exclusive_free_devices(rawDevices);
    return devices;
}

std::vector<DeviceDescriptor> enumerateLegacyWasapiSharedDevices()
{
    std::vector<DeviceDescriptor> devices;
    wasapi_shared_device_info* rawDevices = nullptr;
    uint32_t rawCount = 0;

    if (wasapi_shared_list_devices(&rawDevices, &rawCount) != 0 || rawDevices == nullptr)
        return devices;

    devices.reserve(rawCount);

    for (uint32_t i = 0; i < rawCount; ++i)
    {
        const int sharedSampleRate = static_cast<int>(rawDevices[i].sharedSampleRate);
        devices.push_back({
            static_cast<int>(i),
            "Windows Audio",
            juce::String::fromUTF8(rawDevices[i].name),
            sharedSampleRate,
            sharedSampleRate,
            rawDevices[i].isDefault != 0,
            false,
        });
    }

    wasapi_shared_free_devices(rawDevices);
    return devices;
}

std::vector<DeviceDescriptor> enumerateLegacyAsioDevices()
{
    std::vector<DeviceDescriptor> devices;
#if ECHO_ENABLE_ASIO
    asio_device_info* rawDevices = nullptr;
    uint32_t rawCount = 0;

    if (asio_list_devices(&rawDevices, &rawCount) != 0 || rawDevices == nullptr)
        return devices;

    devices.reserve(rawCount);

    for (uint32_t i = 0; i < rawCount; ++i)
    {
        devices.push_back({
            static_cast<int>(i),
            "ASIO",
            juce::String::fromUTF8(rawDevices[i].name),
            0,
            0,
            rawDevices[i].isDefault != 0,
            true,
            static_cast<int>(rawDevices[i].outputChannels),
            juce::String::fromUTF8(rawDevices[i].outputChannelNames),
        });
    }

    asio_free_devices(rawDevices);
#endif
    return devices;
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

std::vector<DeviceDescriptor> enumerateDevices(
    DeviceListMode mode,
    bool dedupe = true,
    const juce::String& sharedBackend = "auto",
    bool useJuceOutput = false)
{
#if JUCE_WINDOWS
    if (! useJuceOutput)
    {
        if (mode == DeviceListMode::Asio)
            return enumerateLegacyAsioDevices();

        if (mode == DeviceListMode::Exclusive)
            return enumerateLegacyWasapiExclusiveDevices();

        if (mode == DeviceListMode::Shared && sharedBackend != "directsound")
            return enumerateLegacyWasapiSharedDevices();
    }
#endif

    juce::OwnedArray<juce::AudioIODeviceType> types;
    createDeviceTypes(types);

    std::vector<juce::AudioIODeviceType*> candidateTypes;

    for (auto* type : types)
    {
        if (type == nullptr)
            continue;

        if (! shouldIncludeType(type->getTypeName(), mode))
            continue;

        if (mode == DeviceListMode::Shared && ! shouldIncludeSharedBackendType(type->getTypeName(), sharedBackend))
            continue;

        if (dedupe && mode == DeviceListMode::Shared && ! isPreferredSharedType(type->getTypeName()))
            continue;

        candidateTypes.push_back(type);
    }

    if (candidateTypes.empty())
    {
        for (auto* type : types)
        {
            if (type == nullptr)
                continue;

            if (! shouldIncludeType(type->getTypeName(), mode))
                continue;

            if (mode == DeviceListMode::Shared && ! shouldIncludeSharedBackendType(type->getTypeName(), sharedBackend))
                continue;

            candidateTypes.push_back(type);
        }
    }

    std::sort(candidateTypes.begin(), candidateTypes.end(), [] (const auto* left, const auto* right)
    {
        return sharedTypePriority(left->getTypeName()) < sharedTypePriority(right->getTypeName());
    });

    std::vector<DeviceDescriptor> devices;
    std::set<std::string> seenDeviceNames;
    int nextIndex = 0;

    for (auto* type : candidateTypes)
    {
        type->scanForDevices();
        const auto names = type->getDeviceNames(false);
        const int defaultIndex = type->getDefaultDeviceIndex(false);

        for (int i = 0; i < names.size(); ++i)
        {
            const auto dedupeKey = names[i].toStdString();
            if (dedupe && mode != DeviceListMode::Asio && seenDeviceNames.find(dedupeKey) != seenDeviceNames.end())
                continue;

            seenDeviceNames.insert(dedupeKey);
            devices.push_back({
                nextIndex++,
                type->getTypeName(),
                names[i],
                0,
                0,
                i == defaultIndex,
                isAsioType(type->getTypeName()),
            });
        }
    }

    if (mode == DeviceListMode::Shared)
        applyCoreAudioSharedSampleRates(devices);

    return devices;
}

int listDevices(const Options& options)
{
    const auto mode = getHostOutputMode(options);

    if (mode == DeviceListMode::Asio && ! ECHO_ENABLE_ASIO)
    {
        logLine("ASIO device enumeration failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");
        return 2;
    }

    const auto devices = enumerateDevices(mode, true, options.sharedBackend, options.useJuceOutput);

    if (mode == DeviceListMode::Asio && devices.empty())
        logLine("ASIO device enumeration returned no devices");

    for (const auto& device : devices)
    {
        std::cout
            << device.index << "\t"
            << device.name.toRawUTF8() << "\t"
            << device.sampleRate << "\t"
            << (device.isDefault ? 1 : 0) << "\t"
            << device.sharedSampleRate;

        if (mode == DeviceListMode::Asio)
        {
            std::cout
                << "\t" << device.asioOutputChannels
                << "\t0"
                << "\t" << device.asioOutputChannelNames.toRawUTF8();
        }

        std::cout << std::endl;
    }

    return 0;
}

juce::AudioIODeviceType* findTypeByName(juce::OwnedArray<juce::AudioIODeviceType>& types, const juce::String& typeName)
{
    for (auto* type : types)
    {
        if (type != nullptr && type->getTypeName() == typeName)
            return type;
    }

    return nullptr;
}

bool isLooseDeviceNameMatch(const juce::String& left, const juce::String& right)
{
    return left == right
        || left.containsIgnoreCase(right)
        || right.containsIgnoreCase(left);
}

DeviceDescriptor selectDevice(const Options& options)
{
    const auto devices = enumerateDevices(
        options.asio ? DeviceListMode::Asio : DeviceListMode::Shared,
        true,
        options.sharedBackend,
        options.useJuceOutput);

    if (devices.empty())
        throw std::runtime_error("no output devices available");

    if (options.deviceName.isNotEmpty())
    {
        const auto found = std::find_if(devices.begin(), devices.end(), [&] (const DeviceDescriptor& device)
        {
            return device.name == options.deviceName || device.name.containsIgnoreCase(options.deviceName);
        });

        if (found != devices.end())
            return *found;

        logLine("No match for requested device name, falling back to device index/default");
    }

    if (options.deviceIndex >= 0)
    {
        const auto found = std::find_if(devices.begin(), devices.end(), [&] (const DeviceDescriptor& device)
        {
            return device.index == options.deviceIndex;
        });

        if (found != devices.end())
            return *found;

        logLine("Invalid device index " + std::to_string(options.deviceIndex) + ", falling back to default");
    }

    const auto defaultDevice = std::find_if(devices.begin(), devices.end(), [] (const DeviceDescriptor& device)
    {
        return device.isDefault;
    });

    return defaultDevice != devices.end() ? *defaultDevice : devices.front();
}

std::vector<DeviceDescriptor> buildOpenCandidates(const Options& options, const DeviceDescriptor& selected)
{
    std::vector<DeviceDescriptor> candidates;
    std::set<std::string> seen;

    const auto addCandidate = [&] (const DeviceDescriptor& device)
    {
        const auto key = device.typeName.toStdString() + "\n" + device.name.toStdString();
        if (seen.find(key) != seen.end())
            return;

        seen.insert(key);
        candidates.push_back(device);
    };

    const auto outputMode = getHostOutputMode(options);

    if (shouldIncludeType(selected.typeName, outputMode))
        addCandidate(selected);

    const auto allDevices = enumerateDevices(outputMode, false, options.sharedBackend, options.useJuceOutput);

    for (const auto& device : allDevices)
    {
        if (isLooseDeviceNameMatch(device.name, selected.name))
            addCandidate(device);
    }

    if (selected.isDefault)
    {
        for (const auto& device : allDevices)
        {
            if (device.isDefault)
                addCandidate(device);
        }
    }

    return candidates;
}


class PcmRingAudioSource final : public juce::AudioSource
{
public:
    PcmRingAudioSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse,
        double gainToUse,
        echo::EqProcessor& eqProcessorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse)
        : channels(channelCount),
          gain(static_cast<float>(std::max(0.0, std::min(1.0, gainToUse)))),
          startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
          startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
          fifo(capacityFrames),
          buffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
          automixFifo(capacityFrames),
          automixBuffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
          ownedConvolutionProcessor(std::make_unique<echo::ConvolutionProcessor>()),
          convolutionProcessor(ownedConvolutionProcessor.get()),
          ownedHeadroomProcessor(std::make_unique<echo::DspHeadroomProcessor>()),
          headroomProcessor(ownedHeadroomProcessor.get()),
          dspChain(eqProcessorToUse, *convolutionProcessor, channelBalanceProcessorToUse, *headroomProcessor)
    {
    }

    PcmRingAudioSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse,
        double gainToUse,
        echo::EqProcessor& eqProcessorToUse,
        echo::ConvolutionProcessor& convolutionProcessorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse,
        echo::DspHeadroomProcessor& headroomProcessorToUse)
        : channels(channelCount),
          gain(static_cast<float>(std::max(0.0, std::min(1.0, gainToUse)))),
          startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
          startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
          fifo(capacityFrames),
          buffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
          automixFifo(capacityFrames),
          automixBuffer(static_cast<size_t>(capacityFrames * channelCount), 0.0f),
          convolutionProcessor(&convolutionProcessorToUse),
          headroomProcessor(&headroomProcessorToUse),
          dspChain(eqProcessorToUse, *convolutionProcessor, channelBalanceProcessorToUse, *headroomProcessor)
    {
    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override
    {
        configureDeclickRamp(sampleRate);
        dspChain.prepare(sampleRate, samplesPerBlockExpected, channels);
    }

    void prepareForNativeRender(int maxFramesPerCallback, double sampleRate)
    {
        const int safeFrames = std::max(1, maxFramesPerCallback);
        nativeRenderBuffer.setSize(channels, safeFrames, false, true, true);
        configureDeclickRamp(sampleRate);
        dspChain.prepare(sampleRate, safeFrames, channels);
    }

    void releaseResources() override
    {
        dspChain.reset();
    }

    bool isDspActive() const
    {
        return dspChain.isActive();
    }

    bool hasDspClippingRisk() const
    {
        return dspChain.hasClippingRisk();
    }

    bool isDspLimiterProtecting() const
    {
        return dspChain.isSafetyLimiterProtecting();
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override
    {
        configureAudioCallbackThread();

        if (info.buffer == nullptr)
            return;

        renderPlanar(*info.buffer, info.startSample, info.numSamples);
    }

    uint32_t renderInterleaved(float* output, uint32_t frameCount, uint32_t outputChannels)
    {
        if (output == nullptr || frameCount == 0 || outputChannels == 0)
            return 0;

        std::memset(output, 0, static_cast<size_t>(frameCount) * outputChannels * sizeof(float));

        const int scratchFrames = nativeRenderBuffer.getNumSamples();
        if (scratchFrames <= 0)
            return 0;

        uint32_t renderedFrames = 0;
        uint32_t totalFramesRead = 0;

        while (renderedFrames < frameCount)
        {
            const int framesThisChunk = static_cast<int>(std::min<uint32_t>(
                static_cast<uint32_t>(scratchFrames),
                frameCount - renderedFrames));
            const auto framesRead = renderPlanar(nativeRenderBuffer, 0, framesThisChunk);
            copyPlanarToInterleaved(
                nativeRenderBuffer,
                output + static_cast<size_t>(renderedFrames) * outputChannels,
                framesThisChunk,
                static_cast<int>(outputChannels));
            totalFramesRead += static_cast<uint32_t>(framesRead);
            renderedFrames += static_cast<uint32_t>(framesThisChunk);
        }

        return totalFramesRead;
    }

    uint64_t renderPlanar(juce::AudioBuffer<float>& output, int startSample, int frameCount)
    {
        if (frameCount <= 0)
            return 0;

        output.clear(startSample, frameCount);

        if (sessionPaused.load(std::memory_order_acquire))
            return 0;

        if (shouldHoldForStartupPrebuffer())
            return 0;

        const uint64_t absoluteStartFrame = framesPlayed.load(std::memory_order_relaxed);
        activateAutomixFadeIfReady(absoluteStartFrame, frameCount);
        int framesNeeded = frameCount;
        int outputOffset = 0;
        uint64_t framesReadTotal = 0;

        {
            std::lock_guard<std::mutex> lock(fifoMutex);

            while (framesNeeded > 0)
            {
                int start1 = 0;
                int size1 = 0;
                int start2 = 0;
                int size2 = 0;
                fifo.prepareToRead(framesNeeded, start1, size1, start2, size2);

                const int framesRead = size1 + size2;
                if (framesRead <= 0)
                {
                    if (
                        ! inputEnded.load(std::memory_order_acquire)
                        && sessionHasAudio.load(std::memory_order_acquire))
                    {
                        underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                        underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                    }
                    break;
                }

                copyToOutput(start1, size1, output, startSample + outputOffset, absoluteStartFrame + static_cast<uint64_t>(outputOffset));
                copyToOutput(
                    start2,
                    size2,
                    output,
                    startSample + outputOffset + size1,
                    absoluteStartFrame + static_cast<uint64_t>(outputOffset + size1));
                fifo.finishedRead(framesRead);

                framesReadTotal += static_cast<uint64_t>(framesRead);
                framesNeeded -= framesRead;
                outputOffset += framesRead;
            }
        }

        const bool mainInputEnded = inputEnded.load(std::memory_order_acquire);
        const int automixFrameBudget = mainInputEnded
            ? frameCount
            : static_cast<int>(std::min<uint64_t>(static_cast<uint64_t>(frameCount), framesReadTotal));
        const uint64_t automixFramesRead = automixFrameBudget > 0
            ? mixAutomixNext(output, startSample, automixFrameBudget, absoluteStartFrame)
            : 0;
        const uint64_t renderedFrames = automixPlan.enabled.load(std::memory_order_acquire)
            ? (mainInputEnded ? std::max(framesReadTotal, automixFramesRead) : framesReadTotal)
            : framesReadTotal;

        if (renderedFrames > 0)
            framesPlayed.fetch_add(renderedFrames, std::memory_order_relaxed);

        dspChain.processBlock(output, startSample, frameCount);
        applyDeclickRamp(output, startSample, frameCount);

        return renderedFrames;
    }

    bool push(const float* samples, int frameCount)
    {
        if (frameCount > 0)
            sessionHasAudio.store(true, std::memory_order_release);

        int written = 0;

        while (written < frameCount && ! stopRequested.load(std::memory_order_relaxed))
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            {
                std::lock_guard<std::mutex> lock(fifoMutex);
                fifo.prepareToWrite(frameCount - written, start1, size1, start2, size2);

                const int framesWritable = size1 + size2;
                if (framesWritable > 0)
                {
                    copyFromInput(samples + written * channels, start1, size1);
                    copyFromInput(samples + (written + size1) * channels, start2, size2);
                    fifo.finishedWrite(framesWritable);
                    written += framesWritable;
                    continue;
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }

        return written == frameCount;
    }

    bool pushAutomixNext(const float* samples, int frameCount)
    {
        if (frameCount > 0)
            automixNextHasAudio.store(true, std::memory_order_release);

        int written = 0;

        while (written < frameCount && ! stopRequested.load(std::memory_order_relaxed))
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            {
                std::lock_guard<std::mutex> lock(automixMutex);
                automixFifo.prepareToWrite(frameCount - written, start1, size1, start2, size2);

                const int framesWritable = size1 + size2;
                if (framesWritable > 0)
                {
                    copyToAutomixBuffer(samples + written * channels, start1, size1);
                    copyToAutomixBuffer(samples + (written + size1) * channels, start2, size2);
                    automixFifo.finishedWrite(framesWritable);
                    written += framesWritable;
                    continue;
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }

        return written == frameCount;
    }

    void prepareAutomix(double sampleRate, double fadeStartSeconds, double overlapSeconds, double currentGainDb, double nextGainDb)
    {
        const double safeSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
        const auto fadeStart = static_cast<uint64_t>(std::max(0.0, fadeStartSeconds) * safeSampleRate);
        const auto overlapFrames = static_cast<uint64_t>(std::max(0.001, overlapSeconds) * safeSampleRate);
        const auto gainReleaseFrames = static_cast<uint64_t>(std::max(0.05, std::min(4.0, std::max(0.001, overlapSeconds) * 0.5)) * safeSampleRate);

        {
            std::lock_guard<std::mutex> lock(automixMutex);
            automixFifo.reset();
            std::fill(automixBuffer.begin(), automixBuffer.end(), 0.0f);
        }

        automixPlan.fadeStartFrame.store(fadeStart, std::memory_order_release);
        automixPlan.fadeEndFrame.store(fadeStart + std::max<uint64_t>(1, overlapFrames), std::memory_order_release);
        automixPlan.gainReleaseEndFrame.store(fadeStart + std::max<uint64_t>(1, overlapFrames) + std::max<uint64_t>(1, gainReleaseFrames), std::memory_order_release);
        automixPlan.overlapFrames.store(std::max<uint64_t>(1, overlapFrames), std::memory_order_release);
        automixPlan.currentGain.store(dbToGain(currentGainDb), std::memory_order_release);
        automixPlan.nextGain.store(dbToGain(nextGainDb), std::memory_order_release);
        automixPlan.fadeActivated.store(false, std::memory_order_release);
        automixPlan.enabled.store(true, std::memory_order_release);
        automixNextInputEnded.store(false, std::memory_order_release);
        automixNextHasAudio.store(false, std::memory_order_release);
    }

    void markAutomixNextEnded()
    {
        automixNextInputEnded.store(true, std::memory_order_release);
    }

    void cancelAutomix()
    {
        automixPlan.enabled.store(false, std::memory_order_release);
        automixPlan.fadeActivated.store(false, std::memory_order_release);
        automixNextInputEnded.store(false, std::memory_order_release);
        automixNextHasAudio.store(false, std::memory_order_release);
        {
            std::lock_guard<std::mutex> lock(automixMutex);
            automixFifo.reset();
        }
    }

    void beginSession()
    {
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            fifo.reset();
            prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(1, startupPrebufferTimeoutMs));
        }

        framesPlayed.store(0, std::memory_order_relaxed);
        underrunCallbacks.store(0, std::memory_order_relaxed);
        underrunFrames.store(0, std::memory_order_relaxed);
        inputEnded.store(false, std::memory_order_release);
        sessionHasAudio.store(false, std::memory_order_release);
        stopRequested.store(false, std::memory_order_release);
        stopFadeRequested.store(false, std::memory_order_release);
        sessionPaused.store(false, std::memory_order_release);
        declickFadeGeneration.fetch_add(1, std::memory_order_acq_rel);
        prebuffering.store(startupPrebufferFrames > 0, std::memory_order_release);
        cancelAutomix();
    }

    void markInputEnded()
    {
        inputEnded.store(true, std::memory_order_release);
    }

    void requestStop()
    {
        sessionPaused.store(false, std::memory_order_release);
        stopFadeRequested.store(true, std::memory_order_release);
        stopRequested.store(true, std::memory_order_release);
    }

    void setPaused(bool paused)
    {
        sessionPaused.store(paused, std::memory_order_release);
    }

    void setGain(float nextGain)
    {
        if (! std::isfinite(nextGain))
            return;

        gain.store(std::max(0.0f, std::min(1.0f, nextGain)), std::memory_order_release);
    }

    bool isDrained() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        const bool mainDrained = inputEnded.load(std::memory_order_acquire) && fifo.getNumReady() == 0;
        if (! mainDrained)
            return false;

        if (! automixPlan.enabled.load(std::memory_order_acquire))
            return true;

        std::lock_guard<std::mutex> automixLock(automixMutex);
        return automixNextInputEnded.load(std::memory_order_acquire) && automixFifo.getNumReady() == 0;
    }

    bool hasInputEnded() const
    {
        return inputEnded.load(std::memory_order_acquire);
    }

    int getReadyFrames() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        int ready = fifo.getNumReady();
        if (automixPlan.enabled.load(std::memory_order_acquire))
        {
            std::lock_guard<std::mutex> automixLock(automixMutex);
            ready += automixFifo.getNumReady();
        }
        return ready;
    }

    uint64_t getFramesPlayed() const
    {
        return framesPlayed.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunCallbacks() const
    {
        return underrunCallbacks.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunFrames() const
    {
        return underrunFrames.load(std::memory_order_relaxed);
    }

private:
    void copyFromInput(const float* source, int startFrame, int frameCount)
    {
        if (frameCount <= 0)
            return;

        std::memcpy(
            buffer.data() + static_cast<size_t>(startFrame * channels),
            source,
            static_cast<size_t>(frameCount * channels) * sizeof(float));
    }

    static float dbToGain(double db)
    {
        if (! std::isfinite(db))
            return 1.0f;

        return static_cast<float>(std::pow(10.0, std::max(-24.0, std::min(12.0, db)) / 20.0));
    }

    void activateAutomixFadeIfReady(uint64_t absoluteStartFrame, int frameCount)
    {
        if (
            frameCount <= 0
            || ! automixPlan.enabled.load(std::memory_order_acquire)
            || automixPlan.fadeActivated.load(std::memory_order_acquire))
        {
            return;
        }

        const uint64_t plannedFadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
        if (absoluteStartFrame + static_cast<uint64_t>(frameCount) <= plannedFadeStartFrame)
            return;

        {
            std::lock_guard<std::mutex> lock(automixMutex);
            if (automixFifo.getNumReady() <= 0)
                return;
        }

        const uint64_t effectiveFadeStartFrame = std::max(absoluteStartFrame, plannedFadeStartFrame);
        const uint64_t overlapFrames = std::max<uint64_t>(1, automixPlan.overlapFrames.load(std::memory_order_acquire));
        const uint64_t releaseFrames = std::max<uint64_t>(
            1,
            automixPlan.gainReleaseEndFrame.load(std::memory_order_acquire)
                - automixPlan.fadeEndFrame.load(std::memory_order_acquire));
        automixPlan.fadeStartFrame.store(effectiveFadeStartFrame, std::memory_order_release);
        automixPlan.fadeEndFrame.store(effectiveFadeStartFrame + overlapFrames, std::memory_order_release);
        automixPlan.gainReleaseEndFrame.store(effectiveFadeStartFrame + overlapFrames + releaseFrames, std::memory_order_release);
        automixPlan.fadeActivated.store(true, std::memory_order_release);
    }

    void configureDeclickRamp(double sampleRate)
    {
        const double safeSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
        declickRampFrames = std::max(1, static_cast<int>(std::ceil(safeSampleRate * 0.006)));
    }

    void applyDeclickRamp(juce::AudioBuffer<float>& output, int startSample, int frameCount)
    {
        const auto generation = declickFadeGeneration.load(std::memory_order_acquire);
        if (generation != appliedDeclickFadeGeneration)
        {
            appliedDeclickFadeGeneration = generation;
            declickGain = 0.0f;
        }

        const float targetGain = stopFadeRequested.load(std::memory_order_acquire) ? 0.0f : 1.0f;
        if (declickGain == targetGain && targetGain == 1.0f)
            return;

        const float step = 1.0f / static_cast<float>(std::max(1, declickRampFrames));
        const int outputChannels = output.getNumChannels();

        for (int frame = 0; frame < frameCount; ++frame)
        {
            for (int channel = 0; channel < outputChannels; ++channel)
            {
                auto* samples = output.getWritePointer(channel, startSample);
                samples[frame] *= declickGain;
            }

            if (declickGain < targetGain)
                declickGain = std::min(targetGain, declickGain + step);
            else if (declickGain > targetGain)
                declickGain = std::max(targetGain, declickGain - step);
        }
    }

    float currentAutomixEnvelope(uint64_t absoluteFrame) const
    {
        const bool enabled = automixPlan.enabled.load(std::memory_order_acquire);
        const bool fadeActivated = automixPlan.fadeActivated.load(std::memory_order_acquire);
        const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
        const uint64_t fadeEndFrame = automixPlan.fadeEndFrame.load(std::memory_order_acquire);
        const float currentGain = automixPlan.currentGain.load(std::memory_order_acquire);
        if (! enabled)
            return 1.0f;

        if (! fadeActivated || absoluteFrame < fadeStartFrame)
            return 1.0f;

        if (absoluteFrame >= fadeEndFrame)
            return 0.0f;

        const double progress = static_cast<double>(absoluteFrame - fadeStartFrame)
            / static_cast<double>(std::max<uint64_t>(1, fadeEndFrame - fadeStartFrame));
        const auto smoothProgress = static_cast<float>(std::sin(progress * juce::MathConstants<double>::halfPi));
        const float gainMatch = 1.0f + ((currentGain - 1.0f) * smoothProgress);
        return gainMatch * static_cast<float>(std::cos(progress * juce::MathConstants<double>::halfPi));
    }

    float nextAutomixEnvelope(uint64_t absoluteFrame) const
    {
        const bool enabled = automixPlan.enabled.load(std::memory_order_acquire);
        const bool fadeActivated = automixPlan.fadeActivated.load(std::memory_order_acquire);
        const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
        const uint64_t fadeEndFrame = automixPlan.fadeEndFrame.load(std::memory_order_acquire);
        const uint64_t gainReleaseEndFrame = automixPlan.gainReleaseEndFrame.load(std::memory_order_acquire);
        const float nextGain = automixPlan.nextGain.load(std::memory_order_acquire);
        if (! enabled || ! fadeActivated || absoluteFrame < fadeStartFrame)
            return 0.0f;

        if (absoluteFrame >= gainReleaseEndFrame)
            return 1.0f;

        if (absoluteFrame >= fadeEndFrame)
        {
            const double releaseProgress = static_cast<double>(absoluteFrame - fadeEndFrame)
                / static_cast<double>(std::max<uint64_t>(1, gainReleaseEndFrame - fadeEndFrame));
            const float smoothRelease = static_cast<float>(std::sin(releaseProgress * juce::MathConstants<double>::halfPi));
            return nextGain + ((1.0f - nextGain) * smoothRelease);
        }

        const double progress = static_cast<double>(absoluteFrame - fadeStartFrame)
            / static_cast<double>(std::max<uint64_t>(1, fadeEndFrame - fadeStartFrame));
        return nextGain * static_cast<float>(std::sin(progress * juce::MathConstants<double>::halfPi));
    }

    void copyToOutput(
        int startFrame,
        int frameCount,
        juce::AudioBuffer<float>& output,
        int outputStart,
        uint64_t absoluteStartFrame)
    {
        if (frameCount <= 0)
            return;

        const float* source = buffer.data() + static_cast<size_t>(startFrame * channels);
        const float outputGain = gain.load(std::memory_order_acquire);
        const int outputChannels = output.getNumChannels();

        for (int channel = 0; channel < outputChannels; ++channel)
        {
            float* destination = output.getWritePointer(channel, outputStart);
            const int sourceChannel = std::min(channel, channels - 1);

            for (int frame = 0; frame < frameCount; ++frame)
                destination[frame] = source[frame * channels + sourceChannel]
                    * outputGain
                    * currentAutomixEnvelope(absoluteStartFrame + static_cast<uint64_t>(frame));
        }
    }

    void copyToAutomixBuffer(const float* source, int startFrame, int frameCount)
    {
        if (frameCount <= 0)
            return;

        std::memcpy(
            automixBuffer.data() + static_cast<size_t>(startFrame * channels),
            source,
            static_cast<size_t>(frameCount * channels) * sizeof(float));
    }

    void addAutomixToOutput(
        int startFrame,
        int frameCount,
        juce::AudioBuffer<float>& output,
        int outputStart,
        uint64_t absoluteStartFrame)
    {
        if (frameCount <= 0)
            return;

        const float* source = automixBuffer.data() + static_cast<size_t>(startFrame * channels);
        const int outputChannels = output.getNumChannels();

        for (int channel = 0; channel < outputChannels; ++channel)
        {
            float* destination = output.getWritePointer(channel, outputStart);
            const int sourceChannel = std::min(channel, channels - 1);

            for (int frame = 0; frame < frameCount; ++frame)
            {
                destination[frame] += source[frame * channels + sourceChannel]
                    * nextAutomixEnvelope(absoluteStartFrame + static_cast<uint64_t>(frame));
            }
        }
    }

    uint64_t mixAutomixNext(juce::AudioBuffer<float>& output, int startSample, int frameCount, uint64_t absoluteStartFrame)
    {
        if (! automixPlan.enabled.load(std::memory_order_acquire) || frameCount <= 0)
            return 0;

        const uint64_t fadeStartFrame = automixPlan.fadeStartFrame.load(std::memory_order_acquire);
        if (absoluteStartFrame + static_cast<uint64_t>(frameCount) <= fadeStartFrame)
            return 0;

        const int startOffset = absoluteStartFrame >= fadeStartFrame
            ? 0
            : static_cast<int>(fadeStartFrame - absoluteStartFrame);
        int framesNeeded = frameCount - startOffset;
        int outputOffset = startOffset;
        uint64_t framesReadTotal = 0;

        {
            std::lock_guard<std::mutex> lock(automixMutex);

            while (framesNeeded > 0)
            {
                int start1 = 0;
                int size1 = 0;
                int start2 = 0;
                int size2 = 0;
                automixFifo.prepareToRead(framesNeeded, start1, size1, start2, size2);

                const int framesRead = size1 + size2;
                if (framesRead <= 0)
                {
                    if (
                        ! automixNextInputEnded.load(std::memory_order_acquire)
                        && automixNextHasAudio.load(std::memory_order_acquire))
                    {
                        underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                        underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                    }
                    break;
                }

                addAutomixToOutput(
                    start1,
                    size1,
                    output,
                    startSample + outputOffset,
                    absoluteStartFrame + static_cast<uint64_t>(outputOffset));
                addAutomixToOutput(
                    start2,
                    size2,
                    output,
                    startSample + outputOffset + size1,
                    absoluteStartFrame + static_cast<uint64_t>(outputOffset + size1));
                automixFifo.finishedRead(framesRead);

                framesReadTotal += static_cast<uint64_t>(framesRead);
                framesNeeded -= framesRead;
                outputOffset += framesRead;
            }
        }

        return framesReadTotal > 0 ? framesReadTotal + static_cast<uint64_t>(startOffset) : 0;
    }

    void copyPlanarToInterleaved(
        const juce::AudioBuffer<float>& source,
        float* output,
        int frameCount,
        int outputChannels) const
    {
        if (output == nullptr || frameCount <= 0 || outputChannels <= 0)
            return;

        const int sourceChannels = source.getNumChannels();
        if (sourceChannels <= 0)
            return;

        for (int frame = 0; frame < frameCount; ++frame)
        {
            for (int channel = 0; channel < outputChannels; ++channel)
            {
                const int sourceChannel = std::min(channel, sourceChannels - 1);
                output[static_cast<size_t>(frame) * outputChannels + channel] =
                    source.getReadPointer(sourceChannel)[frame];
            }
        }
    }

    const int channels;
    std::atomic<float> gain;
    const int startupPrebufferFrames;
    const int startupPrebufferTimeoutMs;
    juce::AbstractFifo fifo;
    std::vector<float> buffer;
    juce::AbstractFifo automixFifo;
    std::vector<float> automixBuffer;
    juce::AudioBuffer<float> nativeRenderBuffer;
    std::unique_ptr<echo::ConvolutionProcessor> ownedConvolutionProcessor;
    echo::ConvolutionProcessor* convolutionProcessor = nullptr;
    std::unique_ptr<echo::DspHeadroomProcessor> ownedHeadroomProcessor;
    echo::DspHeadroomProcessor* headroomProcessor = nullptr;
    echo::DspChain dspChain;
    mutable std::mutex fifoMutex;
    mutable std::mutex automixMutex;
    AutomixNativePlan automixPlan;
    std::atomic<bool> inputEnded { false };
    std::atomic<bool> automixNextInputEnded { false };
    std::atomic<bool> sessionHasAudio { false };
    std::atomic<bool> automixNextHasAudio { false };
    std::atomic<bool> prebuffering { false };
    std::atomic<bool> stopRequested { false };
    std::atomic<bool> stopFadeRequested { false };
    std::atomic<bool> sessionPaused { false };
    std::atomic<uint64_t> declickFadeGeneration { 0 };
    std::atomic<uint64_t> framesPlayed { 0 };
    std::atomic<uint64_t> underrunCallbacks { 0 };
    std::atomic<uint64_t> underrunFrames { 0 };
    std::chrono::steady_clock::time_point prebufferDeadline {};
    uint64_t appliedDeclickFadeGeneration = 0;
    float declickGain = 1.0f;
    int declickRampFrames = 1;

    bool shouldHoldForStartupPrebuffer()
    {
        if (! prebuffering.load(std::memory_order_acquire))
            return false;

        int readyFrames = 0;
        std::chrono::steady_clock::time_point deadline;
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            readyFrames = fifo.getNumReady();
            deadline = prebufferDeadline;
        }
        const bool enoughPcm = readyFrames >= startupPrebufferFrames;
        const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
        const bool ended = inputEnded.load(std::memory_order_acquire);

        if (enoughPcm || timedOut || ended)
        {
            prebuffering.store(false, std::memory_order_release);
            return false;
        }

        return true;
    }
};

class DopRingSource final
{
public:
    DopRingSource(
        int channelCount,
        int capacityFrames,
        int startupPrebufferFramesToUse,
        int startupPrebufferTimeoutMsToUse)
        : channels(channelCount),
          startupPrebufferFrames(std::max(0, startupPrebufferFramesToUse)),
          startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
          fifo(capacityFrames),
          buffer(static_cast<size_t>(capacityFrames * channelCount), 0u)
    {
    }

    uint32_t renderInterleaved(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
    {
        if (output == nullptr || frameCount == 0 || outputChannels == 0)
            return 0;

        fillDopSilence(output, frameCount, outputChannels);

        if (shouldHoldForStartupPrebuffer())
            return 0;

        uint32_t framesReadTotal = 0;
        uint32_t outputOffset = 0;
        uint32_t framesNeeded = frameCount;

        {
            std::lock_guard<std::mutex> lock(fifoMutex);

            while (framesNeeded > 0)
            {
                int start1 = 0;
                int size1 = 0;
                int start2 = 0;
                int size2 = 0;
                fifo.prepareToRead(static_cast<int>(framesNeeded), start1, size1, start2, size2);

                const int framesRead = size1 + size2;
                if (framesRead <= 0)
                {
                    if (
                        ! inputEnded.load(std::memory_order_acquire)
                        && sessionHasAudio.load(std::memory_order_acquire))
                    {
                        underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                        underrunFrames.fetch_add(static_cast<uint64_t>(framesNeeded), std::memory_order_relaxed);
                    }
                    break;
                }

                copyToInterleaved(start1, size1, output + static_cast<size_t>(outputOffset) * outputChannels, outputChannels);
                copyToInterleaved(
                    start2,
                    size2,
                    output + static_cast<size_t>(outputOffset + static_cast<uint32_t>(size1)) * outputChannels,
                    outputChannels);
                fifo.finishedRead(framesRead);

                framesReadTotal += static_cast<uint32_t>(framesRead);
                outputOffset += static_cast<uint32_t>(framesRead);
                framesNeeded -= static_cast<uint32_t>(framesRead);
            }
        }

        if (framesReadTotal > 0)
            framesPlayed.fetch_add(framesReadTotal, std::memory_order_relaxed);

        normalizeDopMarkers(output, frameCount, outputChannels);

        return framesReadTotal;
    }

    bool push(const uint32_t* samples, int frameCount)
    {
        if (frameCount > 0)
            sessionHasAudio.store(true, std::memory_order_release);

        int written = 0;

        while (written < frameCount && ! stopRequested.load(std::memory_order_relaxed))
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            {
                std::lock_guard<std::mutex> lock(fifoMutex);
                fifo.prepareToWrite(frameCount - written, start1, size1, start2, size2);

                const int framesWritable = size1 + size2;
                if (framesWritable > 0)
                {
                    copyFromInput(samples + written * channels, start1, size1);
                    copyFromInput(samples + (written + size1) * channels, start2, size2);
                    fifo.finishedWrite(framesWritable);
                    written += framesWritable;
                    continue;
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }

        return written == frameCount;
    }

    void beginSession()
    {
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            fifo.reset();
            prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(1, startupPrebufferTimeoutMs));
        }

        framesPlayed.store(0, std::memory_order_relaxed);
        underrunCallbacks.store(0, std::memory_order_relaxed);
        underrunFrames.store(0, std::memory_order_relaxed);
        inputEnded.store(false, std::memory_order_release);
        sessionHasAudio.store(false, std::memory_order_release);
        prebuffering.store(startupPrebufferFrames > 0, std::memory_order_release);
    }

    void markInputEnded()
    {
        inputEnded.store(true, std::memory_order_release);
    }

    void requestStop()
    {
        stopRequested.store(true, std::memory_order_release);
    }

    bool isDrained() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        return inputEnded.load(std::memory_order_acquire) && fifo.getNumReady() == 0;
    }

    bool hasInputEnded() const
    {
        return inputEnded.load(std::memory_order_acquire);
    }

    int getReadyFrames() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        return fifo.getNumReady();
    }

    uint64_t getFramesPlayed() const
    {
        return framesPlayed.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunCallbacks() const
    {
        return underrunCallbacks.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunFrames() const
    {
        return underrunFrames.load(std::memory_order_relaxed);
    }

private:
    static uint32_t makeDopSample(uint32_t frameIndex, uint32_t dsdLow16)
    {
        const uint32_t marker = (frameIndex & 1u) == 0 ? 0x05u : 0xfau;
        return (dsdLow16 & 0x0000ffffu) | (marker << 16);
    }

    static void fillDopSilence(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
    {
        for (uint32_t frame = 0; frame < frameCount; ++frame)
        {
            const uint32_t sample = makeDopSample(frame, 0u);
            for (uint32_t channel = 0; channel < outputChannels; ++channel)
                output[static_cast<size_t>(frame) * outputChannels + channel] = sample;
        }
    }

    static void normalizeDopMarkers(uint32_t* output, uint32_t frameCount, uint32_t outputChannels)
    {
        for (uint32_t frame = 0; frame < frameCount; ++frame)
        {
            const uint32_t marker = (frame & 1u) == 0 ? 0x05u : 0xfau;
            for (uint32_t channel = 0; channel < outputChannels; ++channel)
            {
                auto& sample = output[static_cast<size_t>(frame) * outputChannels + channel];
                sample = (sample & 0x0000ffffu) | (marker << 16);
            }
        }
    }

    void copyFromInput(const uint32_t* source, int startFrame, int frameCount)
    {
        if (frameCount <= 0)
            return;

        std::memcpy(
            buffer.data() + static_cast<size_t>(startFrame * channels),
            source,
            static_cast<size_t>(frameCount * channels) * sizeof(uint32_t));
    }

    void copyToInterleaved(int startFrame, int frameCount, uint32_t* output, uint32_t outputChannels) const
    {
        if (frameCount <= 0 || output == nullptr || outputChannels == 0)
            return;

        const uint32_t* source = buffer.data() + static_cast<size_t>(startFrame * channels);
        for (int frame = 0; frame < frameCount; ++frame)
        {
            for (uint32_t channel = 0; channel < outputChannels; ++channel)
            {
                const int sourceChannel = std::min<int>(static_cast<int>(channel), channels - 1);
                output[static_cast<size_t>(frame) * outputChannels + channel] =
                    source[static_cast<size_t>(frame) * channels + sourceChannel];
            }
        }
    }

    bool shouldHoldForStartupPrebuffer()
    {
        if (! prebuffering.load(std::memory_order_acquire))
            return false;

        int readyFrames = 0;
        std::chrono::steady_clock::time_point deadline;
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            readyFrames = fifo.getNumReady();
            deadline = prebufferDeadline;
        }
        const bool enoughData = readyFrames >= startupPrebufferFrames;
        const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
        const bool ended = inputEnded.load(std::memory_order_acquire);

        if (enoughData || timedOut || ended)
        {
            prebuffering.store(false, std::memory_order_release);
            return false;
        }

        return true;
    }

    const int channels;
    const int startupPrebufferFrames;
    const int startupPrebufferTimeoutMs;
    juce::AbstractFifo fifo;
    std::vector<uint32_t> buffer;
    mutable std::mutex fifoMutex;
    std::atomic<bool> inputEnded { false };
    std::atomic<bool> sessionHasAudio { false };
    std::atomic<bool> prebuffering { false };
    std::atomic<bool> stopRequested { false };
    std::atomic<uint64_t> framesPlayed { 0 };
    std::atomic<uint64_t> underrunCallbacks { 0 };
    std::atomic<uint64_t> underrunFrames { 0 };
    std::chrono::steady_clock::time_point prebufferDeadline {};
};

class NativeDsdRingSource final
{
public:
    NativeDsdRingSource(
        int channelCount,
        int capacityByteFrames,
        int startupPrebufferByteFramesToUse,
        int startupPrebufferTimeoutMsToUse)
        : channels(std::max(1, channelCount)),
          startupPrebufferByteFrames(std::max(0, startupPrebufferByteFramesToUse)),
          startupPrebufferTimeoutMs(std::max(0, startupPrebufferTimeoutMsToUse)),
          fifo(std::max(1, capacityByteFrames)),
          buffer(static_cast<size_t>(std::max(1, capacityByteFrames) * std::max(1, channelCount)), 0x69u)
    {
    }

    uint32_t renderInterleaved(uint8_t* output, uint32_t byteFrameCount, uint32_t outputChannels)
    {
        if (output == nullptr || byteFrameCount == 0 || outputChannels == 0)
            return 0;

        std::memset(output, 0x69, static_cast<size_t>(byteFrameCount) * outputChannels);

        if (shouldHoldForStartupPrebuffer())
            return 0;

        uint32_t byteFramesReadTotal = 0;
        uint32_t outputOffset = 0;
        uint32_t byteFramesNeeded = byteFrameCount;

        {
            std::lock_guard<std::mutex> lock(fifoMutex);

            while (byteFramesNeeded > 0)
            {
                int start1 = 0;
                int size1 = 0;
                int start2 = 0;
                int size2 = 0;
                fifo.prepareToRead(static_cast<int>(byteFramesNeeded), start1, size1, start2, size2);

                const int byteFramesRead = size1 + size2;
                if (byteFramesRead <= 0)
                {
                    if (
                        ! inputEnded.load(std::memory_order_acquire)
                        && sessionHasAudio.load(std::memory_order_acquire))
                    {
                        underrunCallbacks.fetch_add(1, std::memory_order_relaxed);
                        underrunFrames.fetch_add(static_cast<uint64_t>(byteFramesNeeded) * 8u, std::memory_order_relaxed);
                    }
                    break;
                }

                copyToInterleaved(start1, size1, output + static_cast<size_t>(outputOffset) * outputChannels, outputChannels);
                copyToInterleaved(
                    start2,
                    size2,
                    output + static_cast<size_t>(outputOffset + static_cast<uint32_t>(size1)) * outputChannels,
                    outputChannels);
                fifo.finishedRead(byteFramesRead);

                byteFramesReadTotal += static_cast<uint32_t>(byteFramesRead);
                outputOffset += static_cast<uint32_t>(byteFramesRead);
                byteFramesNeeded -= static_cast<uint32_t>(byteFramesRead);
            }
        }

        if (byteFramesReadTotal > 0)
            framesPlayed.fetch_add(static_cast<uint64_t>(byteFramesReadTotal) * 8u, std::memory_order_relaxed);

        return byteFramesReadTotal;
    }

    bool push(const uint8_t* samples, int byteFrameCount)
    {
        if (byteFrameCount > 0)
            sessionHasAudio.store(true, std::memory_order_release);

        int written = 0;

        while (written < byteFrameCount && ! stopRequested.load(std::memory_order_relaxed))
        {
            int start1 = 0;
            int size1 = 0;
            int start2 = 0;
            int size2 = 0;
            {
                std::lock_guard<std::mutex> lock(fifoMutex);
                fifo.prepareToWrite(byteFrameCount - written, start1, size1, start2, size2);

                const int byteFramesWritable = size1 + size2;
                if (byteFramesWritable > 0)
                {
                    copyFromInput(samples + static_cast<size_t>(written) * channels, start1, size1);
                    copyFromInput(samples + static_cast<size_t>(written + size1) * channels, start2, size2);
                    fifo.finishedWrite(byteFramesWritable);
                    written += byteFramesWritable;
                    continue;
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }

        return written == byteFrameCount;
    }

    void beginSession()
    {
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            fifo.reset();
            prebufferDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(1, startupPrebufferTimeoutMs));
        }

        framesPlayed.store(0, std::memory_order_relaxed);
        underrunCallbacks.store(0, std::memory_order_relaxed);
        underrunFrames.store(0, std::memory_order_relaxed);
        inputEnded.store(false, std::memory_order_release);
        sessionHasAudio.store(false, std::memory_order_release);
        prebuffering.store(startupPrebufferByteFrames > 0, std::memory_order_release);
    }

    void markInputEnded()
    {
        inputEnded.store(true, std::memory_order_release);
    }

    void requestStop()
    {
        stopRequested.store(true, std::memory_order_release);
    }

    bool isDrained() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        return inputEnded.load(std::memory_order_acquire) && fifo.getNumReady() == 0;
    }

    bool hasInputEnded() const
    {
        return inputEnded.load(std::memory_order_acquire);
    }

    int getReadyByteFrames() const
    {
        std::lock_guard<std::mutex> lock(fifoMutex);
        return fifo.getNumReady();
    }

    uint64_t getReadyFrames() const
    {
        return static_cast<uint64_t>(getReadyByteFrames()) * 8u;
    }

    uint64_t getFramesPlayed() const
    {
        return framesPlayed.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunCallbacks() const
    {
        return underrunCallbacks.load(std::memory_order_relaxed);
    }

    uint64_t getUnderrunFrames() const
    {
        return underrunFrames.load(std::memory_order_relaxed);
    }

private:
    void copyFromInput(const uint8_t* source, int startByteFrame, int byteFrameCount)
    {
        if (byteFrameCount <= 0)
            return;

        std::memcpy(
            buffer.data() + static_cast<size_t>(startByteFrame * channels),
            source,
            static_cast<size_t>(byteFrameCount * channels));
    }

    void copyToInterleaved(int startByteFrame, int byteFrameCount, uint8_t* output, uint32_t outputChannels) const
    {
        if (byteFrameCount <= 0 || output == nullptr || outputChannels == 0)
            return;

        const uint8_t* source = buffer.data() + static_cast<size_t>(startByteFrame * channels);
        for (int byteFrame = 0; byteFrame < byteFrameCount; ++byteFrame)
        {
            for (uint32_t channel = 0; channel < outputChannels; ++channel)
            {
                const int sourceChannel = std::min<int>(static_cast<int>(channel), channels - 1);
                output[static_cast<size_t>(byteFrame) * outputChannels + channel] =
                    source[static_cast<size_t>(byteFrame) * channels + sourceChannel];
            }
        }
    }

    bool shouldHoldForStartupPrebuffer()
    {
        if (! prebuffering.load(std::memory_order_acquire))
            return false;

        int readyByteFrames = 0;
        std::chrono::steady_clock::time_point deadline;
        {
            std::lock_guard<std::mutex> lock(fifoMutex);
            readyByteFrames = fifo.getNumReady();
            deadline = prebufferDeadline;
        }
        const bool enoughData = readyByteFrames >= startupPrebufferByteFrames;
        const bool timedOut = startupPrebufferTimeoutMs <= 0 || std::chrono::steady_clock::now() >= deadline;
        const bool ended = inputEnded.load(std::memory_order_acquire);

        if (enoughData || timedOut || ended)
        {
            prebuffering.store(false, std::memory_order_release);
            return false;
        }

        return true;
    }

    const int channels;
    const int startupPrebufferByteFrames;
    const int startupPrebufferTimeoutMs;
    juce::AbstractFifo fifo;
    std::vector<uint8_t> buffer;
    mutable std::mutex fifoMutex;
    std::atomic<bool> inputEnded { false };
    std::atomic<bool> sessionHasAudio { false };
    std::atomic<bool> prebuffering { false };
    std::atomic<bool> stopRequested { false };
    std::atomic<uint64_t> framesPlayed { 0 };
    std::atomic<uint64_t> underrunCallbacks { 0 };
    std::atomic<uint64_t> underrunFrames { 0 };
    std::chrono::steady_clock::time_point prebufferDeadline {};
};

class EqControlServer final
{
public:
    EqControlServer(
        int portToUse,
        echo::EqProcessor& processorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse)
        : port(portToUse),
          processor(processorToUse),
          channelBalanceProcessor(channelBalanceProcessorToUse),
          ownedConvolutionProcessor(std::make_unique<echo::ConvolutionProcessor>()),
          convolutionProcessor(ownedConvolutionProcessor.get()),
          ownedHeadroomProcessor(std::make_unique<echo::DspHeadroomProcessor>()),
          headroomProcessor(ownedHeadroomProcessor.get())
    {
    }

    EqControlServer(
        int portToUse,
        echo::EqProcessor& processorToUse,
        echo::ChannelBalanceProcessor& channelBalanceProcessorToUse,
        echo::ConvolutionProcessor& convolutionProcessorToUse,
        echo::DspHeadroomProcessor& headroomProcessorToUse)
        : port(portToUse),
          processor(processorToUse),
          channelBalanceProcessor(channelBalanceProcessorToUse),
          convolutionProcessor(&convolutionProcessorToUse),
          headroomProcessor(&headroomProcessorToUse)
    {
    }

    ~EqControlServer()
    {
        stop();
    }

    bool start()
    {
        if (port <= 0)
            return false;

        if (! listener.createListener(port, "127.0.0.1"))
        {
            logLine("EQ control listener failed on port " + std::to_string(port));
            return false;
        }

        running.store(true, std::memory_order_release);
        worker = std::thread([this]
        {
            run();
        });
        return true;
    }

    void stop()
    {
        running.store(false, std::memory_order_release);
        listener.close();

        if (client != nullptr)
            client->close();

        if (worker.joinable())
            worker.join();
    }

private:
    void run()
    {
        logLine("EQ control listener ready on port " + std::to_string(port));

        while (running.load(std::memory_order_acquire))
        {
            std::unique_ptr<juce::StreamingSocket> nextClient(listener.waitForNextConnection());

            if (nextClient == nullptr)
                continue;

            client = nextClient.get();
            handleClient(*nextClient);
            client = nullptr;
        }
    }

    void handleClient(juce::StreamingSocket& socket)
    {
        std::string pending;
        char bytes[1024] {};

        while (running.load(std::memory_order_acquire) && socket.isConnected())
        {
            const int ready = socket.waitUntilReady(true, 100);
            if (ready < 0)
                break;

            if (ready == 0)
                continue;

            const int read = socket.read(bytes, sizeof(bytes), false);

            if (read <= 0)
                break;

            pending.append(bytes, bytes + read);

            size_t newline = pending.find('\n');
            while (newline != std::string::npos)
            {
                const auto line = pending.substr(0, newline);
                pending.erase(0, newline + 1);

                if (! line.empty())
                {
                    const auto response = echo::EqMessageProtocol::handleJsonLine(line, processor, channelBalanceProcessor, *convolutionProcessor, *headroomProcessor) + "\n";
                    socket.write(response.data(), static_cast<int>(response.size()));
                }

                newline = pending.find('\n');
            }
        }
    }

    const int port = 0;
    echo::EqProcessor& processor;
    echo::ChannelBalanceProcessor& channelBalanceProcessor;
    std::unique_ptr<echo::ConvolutionProcessor> ownedConvolutionProcessor;
    echo::ConvolutionProcessor* convolutionProcessor = nullptr;
    std::unique_ptr<echo::DspHeadroomProcessor> ownedHeadroomProcessor;
    echo::DspHeadroomProcessor* headroomProcessor = nullptr;
    juce::StreamingSocket listener;
    juce::StreamingSocket* client = nullptr;
    std::thread worker;
    std::atomic<bool> running { false };
};

void stdinReader(PcmRingAudioSource& source, int channels)
{
    configurePcmReaderThread();

#if JUCE_WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
#endif

    try
    {
        constexpr size_t chunkBytes = 16 * 1024;
        const size_t frameBytes = static_cast<size_t>(channels) * sizeof(float);
        std::vector<char> chunk(chunkBytes);
        std::vector<char> pending;

        while (std::cin.good())
        {
            std::cin.read(chunk.data(), static_cast<std::streamsize>(chunk.size()));
            const auto bytesRead = static_cast<size_t>(std::cin.gcount());

            if (bytesRead == 0)
                break;

            pending.insert(pending.end(), chunk.begin(), chunk.begin() + static_cast<std::ptrdiff_t>(bytesRead));

            const size_t frameCount = pending.size() / frameBytes;
            if (frameCount == 0)
                continue;

            const size_t sampleCount = frameCount * static_cast<size_t>(channels);
            std::vector<float> samples(sampleCount);
            std::memcpy(samples.data(), pending.data(), sampleCount * sizeof(float));

            if (! source.push(samples.data(), static_cast<int>(frameCount)))
                break;

            pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(sampleCount * sizeof(float)));
        }
    }
    catch (const std::exception& e)
    {
        logLine(std::string("stdin reader fatal: ") + e.what());
    }
    catch (...)
    {
        logLine("stdin reader fatal: unknown exception");
    }

    source.markInputEnded();
}

uint32_t readLe32(const char* bytes)
{
    return static_cast<uint32_t>(static_cast<unsigned char>(bytes[0]))
        | (static_cast<uint32_t>(static_cast<unsigned char>(bytes[1])) << 8)
        | (static_cast<uint32_t>(static_cast<unsigned char>(bytes[2])) << 16)
        | (static_cast<uint32_t>(static_cast<unsigned char>(bytes[3])) << 24);
}

void writeLe32(char* bytes, uint32_t value)
{
    bytes[0] = static_cast<char>(value & 0xff);
    bytes[1] = static_cast<char>((value >> 8) & 0xff);
    bytes[2] = static_cast<char>((value >> 16) & 0xff);
    bytes[3] = static_cast<char>((value >> 24) & 0xff);
}

float readLeFloat32(const char* bytes)
{
    uint32_t value = readLe32(bytes);
    float result = 1.0f;
    static_assert(sizeof(result) == sizeof(value), "float32 size mismatch");
    std::memcpy(&result, &value, sizeof(result));
    return result;
}

bool readExact(char* target, size_t bytes)
{
    size_t read = 0;

    while (read < bytes && std::cin.good())
    {
        std::cin.read(target + static_cast<std::ptrdiff_t>(read), static_cast<std::streamsize>(bytes - read));
        const auto chunk = static_cast<size_t>(std::cin.gcount());

        if (chunk == 0)
            return false;

        read += chunk;
    }

    return read == bytes;
}

bool readFrameHeader(StdinFrameHeader& header)
{
    char bytes[16] {};

    if (! readExact(bytes, sizeof(bytes)))
        return false;

    if (bytes[0] != 'E' || bytes[1] != 'C' || bytes[2] != 'N' || bytes[3] != 'P')
        throw std::runtime_error("invalid framed stdin magic");

    if (static_cast<unsigned char>(bytes[4]) != 1)
        throw std::runtime_error("unsupported framed stdin version");

    header.type = static_cast<uint8_t>(bytes[5]);
    header.sessionId = readLe32(bytes + 8);
    header.payloadBytes = readLe32(bytes + 12);
    return true;
}

bool readDecodeServerFrameHeader(DecodeServerFrameHeader& header)
{
    char bytes[16] {};

    if (! readExact(bytes, sizeof(bytes)))
        return false;

    if (bytes[0] != 'E' || bytes[1] != 'C' || bytes[2] != 'D' || bytes[3] != 'S')
        throw std::runtime_error("invalid decode server frame magic");

    if (static_cast<unsigned char>(bytes[4]) != 1)
        throw std::runtime_error("unsupported decode server frame version");

    header.type = static_cast<uint8_t>(bytes[5]);
    header.sessionId = readLe32(bytes + 8);
    header.payloadBytes = readLe32(bytes + 12);
    return true;
}

void pushPcmPayload(PcmRingAudioSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels) * sizeof(float);
    pending.insert(pending.end(), payload.begin(), payload.end());

    const size_t frameCount = pending.size() / frameBytes;
    if (frameCount == 0)
        return;

    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    std::vector<float> samples(sampleCount);
    std::memcpy(samples.data(), pending.data(), sampleCount * sizeof(float));

    if (! source.push(samples.data(), static_cast<int>(frameCount)))
        return;

    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(sampleCount * sizeof(float)));
}

void pushAutomixNextPcmPayload(PcmRingAudioSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels) * sizeof(float);
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

double getJsonDouble(const juce::DynamicObject* object, const char* key, double fallback)
{
    if (object == nullptr)
        return fallback;

    const auto value = object->getProperty(key);
    if (value.isDouble() || value.isInt() || value.isInt64())
        return static_cast<double>(value);

    return fallback;
}

void prepareAutomixFromPayload(PcmRingAudioSource& source, double sampleRate, const std::vector<char>& payload)
{
    if (payload.empty())
        return;

    const juce::String json = juce::String::fromUTF8(payload.data(), static_cast<int>(payload.size()));
    const auto parsed = juce::JSON::parse(json);
    const auto* object = parsed.getDynamicObject();
    if (object == nullptr)
        return;

    source.prepareAutomix(
        sampleRate,
        getJsonDouble(object, "fadeStartSeconds", 0.0),
        getJsonDouble(object, "overlapSeconds", 0.001),
        getJsonDouble(object, "currentGainDb", 0.0),
        getJsonDouble(object, "nextGainDb", 0.0));
}

juce::String getJsonString(const juce::DynamicObject* object, const char* key, const juce::String& fallback)
{
    if (object == nullptr)
        return fallback;

    const auto value = object->getProperty(key);
    return value.isString() ? value.toString() : fallback;
}

int getJsonInt(const juce::DynamicObject* object, const char* key, int fallback)
{
    return static_cast<int>(std::llround(getJsonDouble(object, key, static_cast<double>(fallback))));
}

std::string getJuceDecodeBackendImpl(const juce::File& file)
{
    const auto extension = file.getFileExtension().toLowerCase();

    if (extension == ".flac")
        return "juce-flac";

    if (extension == ".mp3")
        return "juce-windows-media-mp3";

    if (extension == ".wav" || extension == ".wave")
        return "juce-wav";

    return "juce-audio-format";
}

void writeDecodeServerFrame(DecodeServerFrameType type, uint32_t sessionId, const char* payload, size_t payloadBytes)
{
    if (payloadBytes > static_cast<size_t>(std::numeric_limits<uint32_t>::max()))
        throw std::runtime_error("decode server frame payload too large");

    char header[16] {};
    header[0] = 'E';
    header[1] = 'C';
    header[2] = 'D';
    header[3] = 'S';
    header[4] = 1;
    header[5] = static_cast<char>(type);
    writeLe32(header + 8, sessionId);
    writeLe32(header + 12, static_cast<uint32_t>(payloadBytes));

    const std::lock_guard<std::mutex> lock(stdoutMutex);
    std::cout.write(header, sizeof(header));
    if (payloadBytes > 0)
        std::cout.write(payload, static_cast<std::streamsize>(payloadBytes));
    std::cout.flush();

    if (! std::cout.good())
        throw std::runtime_error("decode server failed while writing stdout frame");
}

void writeDecodeServerFrame(DecodeServerFrameType type, uint32_t sessionId, const std::string& payload)
{
    writeDecodeServerFrame(type, sessionId, payload.data(), payload.size());
}

void writeDecodeServerFrame(DecodeServerFrameType type, uint32_t sessionId)
{
    writeDecodeServerFrame(type, sessionId, nullptr, 0);
}

void writeDecodeServerError(uint32_t sessionId, const std::string& message)
{
    writeDecodeServerFrame(
        DecodeServerFrameType::Error,
        sessionId,
        "{\"message\":\"" + jsonEscape(juce::String::fromUTF8(message.c_str())) + "\"}");
}

DecodeServerRequest parseDecodeServerRequest(uint32_t sessionId, const std::vector<char>& payload)
{
    if (payload.empty())
        throw std::runtime_error("decode server start frame missing payload");

    const juce::String json = juce::String::fromUTF8(payload.data(), static_cast<int>(payload.size()));
    const auto parsed = juce::JSON::parse(json);
    const auto* object = parsed.getDynamicObject();
    if (object == nullptr)
        throw std::runtime_error("decode server start payload is not a JSON object");

    DecodeServerRequest request;
    request.sessionId = sessionId;
    request.filePath = getJsonString(object, "filePath", {});
    request.startSeconds = std::max(0.0, getJsonDouble(object, "startSeconds", 0.0));
    request.sampleRate = std::max(1, getJsonInt(object, "sampleRate", 44100));
    request.channels = std::max(1, std::min(8, getJsonInt(object, "channels", 2)));

    if (request.filePath.isEmpty())
        throw std::runtime_error("decode server start payload missing filePath");

    return request;
}

void decodeServerWorker(DecodeServerRequest request, std::atomic<bool>& cancelRequested)
{
    try
    {
        configurePcmReaderThread();

        juce::File file(request.filePath);
        if (! file.existsAsFile())
            throw std::runtime_error("JUCE decode failed: input file not found");

        if (! file.hasFileExtension("wav;wave;flac;mp3"))
            throw std::runtime_error("JUCE decode unsupported format: pilot only accepts WAV/FLAC/MP3");

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            throw std::runtime_error("JUCE decode failed: reader could not open input");

        if (reader->lengthInSamples <= 0)
            throw std::runtime_error("JUCE decode failed: source length unavailable");

        const int sourceSampleRate = static_cast<int>(std::llround(reader->sampleRate));
        if (sourceSampleRate <= 0)
            throw std::runtime_error("JUCE decode failed: source sample rate unavailable");

        if (sourceSampleRate != request.sampleRate)
            throw std::runtime_error(
                "JUCE decode resampling unsupported: source="
                + std::to_string(sourceSampleRate)
                + " requested="
                + std::to_string(request.sampleRate));

        const int sourceChannels = static_cast<int>(reader->numChannels);
        if (sourceChannels <= 0 || sourceChannels > 2)
            throw std::runtime_error("JUCE decode unsupported channel count: " + std::to_string(sourceChannels));

        if (sourceChannels != request.channels)
            throw std::runtime_error(
                "JUCE decode channel remap unsupported: source="
                + std::to_string(sourceChannels)
                + " requested="
                + std::to_string(request.channels));

        writeDecodeServerFrame(
            DecodeServerFrameType::Ready,
            request.sessionId,
            "{\"backend\":\"" + getJuceDecodeBackendImpl(file)
                + "\",\"sampleRate\":" + std::to_string(sourceSampleRate)
                + ",\"channels\":" + std::to_string(sourceChannels)
                + "}");

        const int64_t startSample = std::max<int64_t>(
            0,
            static_cast<int64_t>(std::floor(request.startSeconds * static_cast<double>(sourceSampleRate))));
        if (startSample >= reader->lengthInSamples || cancelRequested.load(std::memory_order_acquire))
        {
            writeDecodeServerFrame(DecodeServerFrameType::End, request.sessionId);
            return;
        }

        constexpr int blockFrames = 4096;
        juce::AudioBuffer<float> buffer(sourceChannels, blockFrames);
        std::vector<float> interleaved(static_cast<size_t>(blockFrames * sourceChannels), 0.0f);
        int64_t position = startSample;

        while (position < reader->lengthInSamples && ! cancelRequested.load(std::memory_order_acquire))
        {
            const int frames = static_cast<int>(std::min<int64_t>(blockFrames, reader->lengthInSamples - position));
            buffer.clear();

            if (! reader->read(&buffer, 0, frames, position, true, true))
                throw std::runtime_error("JUCE decode failed while reading PCM");

            if (cancelRequested.load(std::memory_order_acquire))
                break;

            for (int frame = 0; frame < frames; ++frame)
            {
                for (int channel = 0; channel < sourceChannels; ++channel)
                    interleaved[static_cast<size_t>(frame * sourceChannels + channel)] = buffer.getSample(channel, frame);
            }

            const auto bytes = static_cast<size_t>(frames * sourceChannels * static_cast<int>(sizeof(float)));
            writeDecodeServerFrame(
                DecodeServerFrameType::PcmF32Le,
                request.sessionId,
                reinterpret_cast<const char*>(interleaved.data()),
                bytes);

            position += frames;
        }

        writeDecodeServerFrame(DecodeServerFrameType::End, request.sessionId);
    }
    catch (const std::exception& e)
    {
        try
        {
            writeDecodeServerError(request.sessionId, e.what());
        }
        catch (const std::exception& writeError)
        {
            logLine(std::string("decode server error frame write failed: ") + writeError.what());
        }
    }
    catch (...)
    {
        try
        {
            writeDecodeServerError(request.sessionId, "JUCE decode failed: unknown exception");
        }
        catch (...)
        {
            logLine("decode server error frame write failed");
        }
    }
}

void stopDecodeServerWorker(std::thread& worker, std::atomic<bool>& cancelRequested)
{
    cancelRequested.store(true, std::memory_order_release);
    if (worker.joinable())
        worker.join();
    cancelRequested.store(false, std::memory_order_release);
}

void handleFramedStdinPayload(
    PcmRingAudioSource& source,
    int channels,
    std::atomic<bool>& shutdownRequested,
    uint32_t& currentSessionId,
    bool& hasSession,
    std::vector<char>& pendingPcm,
    std::vector<char>& pendingAutomixPcm,
    double sampleRate,
    const StdinFrameHeader& header,
    const std::vector<char>& payload)
{
    const auto type = static_cast<StdinFrameType>(header.type);

    if (type == StdinFrameType::BeginSession)
    {
        currentSessionId = header.sessionId;
        hasSession = true;
        pendingPcm.clear();
        source.beginSession();
        return;
    }

    if (type == StdinFrameType::PcmF32Le)
    {
        if (hasSession && header.sessionId == currentSessionId)
            pushPcmPayload(source, channels, pendingPcm, payload);
        return;
    }

    if (type == StdinFrameType::AutomixPrepare)
    {
        if (hasSession && header.sessionId == currentSessionId)
        {
            pendingAutomixPcm.clear();
            prepareAutomixFromPayload(source, sampleRate, payload);
        }
        return;
    }

    if (type == StdinFrameType::AutomixNextPcmF32Le)
    {
        if (hasSession && header.sessionId == currentSessionId)
            pushAutomixNextPcmPayload(source, channels, pendingAutomixPcm, payload);
        return;
    }

    if (type == StdinFrameType::AutomixNextEnd)
    {
        if (hasSession && header.sessionId == currentSessionId)
        {
            pendingAutomixPcm.clear();
            source.markAutomixNextEnded();
        }
        return;
    }

    if (type == StdinFrameType::AutomixCancel)
    {
        pendingAutomixPcm.clear();
        source.cancelAutomix();
        return;
    }

    if (type == StdinFrameType::EndSession)
    {
        if (hasSession && header.sessionId == currentSessionId)
        {
            pendingPcm.clear();
            source.markInputEnded();
        }
        return;
    }

    if (type == StdinFrameType::Shutdown)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.markInputEnded();
        source.markAutomixNextEnded();
        source.requestStop();
        return;
    }

    if (type == StdinFrameType::SetVolume)
    {
        if (payload.size() >= sizeof(float))
            source.setGain(readLeFloat32(payload.data()));
        return;
    }

    if (type == StdinFrameType::SetPaused)
    {
        if (hasSession && header.sessionId == currentSessionId && ! payload.empty())
            source.setPaused(payload[0] != 0);
    }
}

void framedStdinReader(PcmRingAudioSource& source, int channels, double sampleRate, std::atomic<bool>& shutdownRequested)
{
    configurePcmReaderThread();

#if JUCE_WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
#endif

    uint32_t currentSessionId = 0;
    bool hasSession = false;
    std::vector<char> pendingPcm;
    std::vector<char> pendingAutomixPcm;

    try
    {
        while (std::cin.good() && ! shutdownRequested.load(std::memory_order_acquire))
        {
            StdinFrameHeader header;
            if (! readFrameHeader(header))
                break;

            std::vector<char> payload(header.payloadBytes);
            if (header.payloadBytes > 0 && ! readExact(payload.data(), payload.size()))
                break;

            handleFramedStdinPayload(
                source,
                channels,
                shutdownRequested,
                currentSessionId,
                hasSession,
                pendingPcm,
                pendingAutomixPcm,
                sampleRate,
                header,
                payload);
        }
    }
    catch (const std::exception& e)
    {
        logLine(std::string("stdin reader fatal: ") + e.what());
    }
    catch (...)
    {
        logLine("stdin reader fatal: unknown exception");
    }

    shutdownRequested.store(true, std::memory_order_release);
    source.markInputEnded();
    source.markAutomixNextEnded();
}

void pushDopPayload(DopRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels) * 3u;
    pending.insert(pending.end(), payload.begin(), payload.end());

    const size_t frameCount = pending.size() / frameBytes;
    if (frameCount == 0)
        return;

    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    std::vector<uint32_t> samples(sampleCount);
    for (size_t sample = 0; sample < sampleCount; ++sample)
    {
        const size_t byteOffset = sample * 3u;
        samples[sample] =
            static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset]))
            | (static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset + 1])) << 8)
            | (static_cast<uint32_t>(static_cast<unsigned char>(pending[byteOffset + 2])) << 16);
    }

    if (! source.push(samples.data(), static_cast<int>(frameCount)))
        return;

    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(sampleCount * 3u));
}

void handleFramedDopStdinPayload(
    DopRingSource& source,
    int channels,
    std::atomic<bool>& shutdownRequested,
    uint32_t& currentSessionId,
    bool& hasSession,
    std::vector<char>& pendingDop,
    const StdinFrameHeader& header,
    const std::vector<char>& payload)
{
    const auto type = static_cast<StdinFrameType>(header.type);

    if (type == StdinFrameType::BeginSession)
    {
        currentSessionId = header.sessionId;
        hasSession = true;
        pendingDop.clear();
        source.beginSession();
        return;
    }

    if (type == StdinFrameType::Dop24Le)
    {
        if (hasSession && header.sessionId == currentSessionId)
            pushDopPayload(source, channels, pendingDop, payload);
        return;
    }

    if (type == StdinFrameType::EndSession)
    {
        if (hasSession && header.sessionId == currentSessionId)
        {
            pendingDop.clear();
            source.markInputEnded();
        }
        return;
    }

    if (type == StdinFrameType::Shutdown)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.markInputEnded();
        source.requestStop();
    }
}

void framedDopStdinReader(DopRingSource& source, int channels, std::atomic<bool>& shutdownRequested)
{
    configurePcmReaderThread();

#if JUCE_WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
#endif

    uint32_t currentSessionId = 0;
    bool hasSession = false;
    std::vector<char> pendingDop;

    try
    {
        while (std::cin.good() && ! shutdownRequested.load(std::memory_order_acquire))
        {
            StdinFrameHeader header;
            if (! readFrameHeader(header))
                break;

            std::vector<char> payload(header.payloadBytes);
            if (header.payloadBytes > 0 && ! readExact(payload.data(), payload.size()))
                break;

            handleFramedDopStdinPayload(
                source,
                channels,
                shutdownRequested,
                currentSessionId,
                hasSession,
                pendingDop,
                header,
                payload);
        }
    }
    catch (const std::exception& e)
    {
        logLine(std::string("stdin reader fatal: ") + e.what());
    }
    catch (...)
    {
        logLine("stdin reader fatal: unknown exception");
    }

    shutdownRequested.store(true, std::memory_order_release);
    source.markInputEnded();
}

void pushNativeDsdPayload(NativeDsdRingSource& source, int channels, std::vector<char>& pending, const std::vector<char>& payload)
{
    const size_t frameBytes = static_cast<size_t>(channels);
    pending.insert(pending.end(), payload.begin(), payload.end());

    const size_t byteFrameCount = pending.size() / frameBytes;
    if (byteFrameCount == 0)
        return;

    const auto* samples = reinterpret_cast<const uint8_t*>(pending.data());
    if (! source.push(samples, static_cast<int>(byteFrameCount)))
        return;

    pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(byteFrameCount * frameBytes));
}

void handleFramedNativeDsdStdinPayload(
    NativeDsdRingSource& source,
    int channels,
    std::atomic<bool>& shutdownRequested,
    uint32_t& currentSessionId,
    bool& hasSession,
    std::vector<char>& pendingNativeDsd,
    const StdinFrameHeader& header,
    const std::vector<char>& payload)
{
    const auto type = static_cast<StdinFrameType>(header.type);

    if (type == StdinFrameType::BeginSession)
    {
        currentSessionId = header.sessionId;
        hasSession = true;
        pendingNativeDsd.clear();
        source.beginSession();
        return;
    }

    if (type == StdinFrameType::NativeDsdRaw)
    {
        if (hasSession && header.sessionId == currentSessionId)
            pushNativeDsdPayload(source, channels, pendingNativeDsd, payload);
        return;
    }

    if (type == StdinFrameType::EndSession)
    {
        if (hasSession && header.sessionId == currentSessionId)
        {
            pendingNativeDsd.clear();
            source.markInputEnded();
        }
        return;
    }

    if (type == StdinFrameType::Shutdown)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.markInputEnded();
        source.requestStop();
    }
}

void framedNativeDsdStdinReader(NativeDsdRingSource& source, int channels, std::atomic<bool>& shutdownRequested)
{
    configurePcmReaderThread();

#if JUCE_WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
#endif

    uint32_t currentSessionId = 0;
    bool hasSession = false;
    std::vector<char> pendingNativeDsd;

    try
    {
        while (std::cin.good() && ! shutdownRequested.load(std::memory_order_acquire))
        {
            StdinFrameHeader header;
            if (! readFrameHeader(header))
                break;

            std::vector<char> payload(header.payloadBytes);
            if (header.payloadBytes > 0 && ! readExact(payload.data(), payload.size()))
                break;

            handleFramedNativeDsdStdinPayload(
                source,
                channels,
                shutdownRequested,
                currentSessionId,
                hasSession,
                pendingNativeDsd,
                header,
                payload);
        }
    }
    catch (const std::exception& e)
    {
        logLine(std::string("stdin reader fatal: ") + e.what());
    }
    catch (...)
    {
        logLine("stdin reader fatal: unknown exception");
    }

    shutdownRequested.store(true, std::memory_order_release);
    source.markInputEnded();
}

int waitForInitialPcm(PcmRingAudioSource& source, int targetFrames, int timeoutMs)
{
    if (targetFrames <= 0)
        return 0;

    if (timeoutMs <= 0)
        return source.getReadyFrames();

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(std::max(1, timeoutMs));

    while (std::chrono::steady_clock::now() < deadline)
    {
        const int readyFrames = source.getReadyFrames();
        if (readyFrames >= targetFrames || source.hasInputEnded())
            return readyFrames;

        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    return source.getReadyFrames();
}

void cleanupAudioDeviceAndAck(
    PcmRingAudioSource& source,
    std::unique_ptr<juce::AudioIODevice>& device,
    juce::AudioSourcePlayer& player,
    EqControlServer& eqControlServer,
    bool& shutdownAckSent)
{
    try
    {
        source.requestStop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("source.requestStop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("source.requestStop cleanup failed");
    }

    if (device != nullptr)
    {
        try
        {
            device->stop();
        }
        catch (const std::exception& error)
        {
            logLine(std::string("device->stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("device->stop cleanup failed");
        }
    }

    try
    {
        player.setSource(nullptr);
    }
    catch (const std::exception& error)
    {
        logLine(std::string("player.setSource cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("player.setSource cleanup failed");
    }

    if (device != nullptr)
    {
        try
        {
            device->close();
        }
        catch (const std::exception& error)
        {
            logLine(std::string("device->close cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("device->close cleanup failed");
        }
    }

    try
    {
        eqControlServer.stop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("eqControlServer.stop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("eqControlServer.stop cleanup failed");
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

std::vector<int> buildSampleRateAttempts(const Options& options, const DeviceDescriptor& device)
{
    std::vector<int> rates;

    const auto add = [&] (int rate)
    {
        if (rate > 0 && std::find(rates.begin(), rates.end(), rate) == rates.end())
            rates.push_back(rate);
    };

    if (! options.exclusive && ! options.asio)
    {
        add(device.sharedSampleRate);
        add(options.sampleRate);
        add(48000);
        add(44100);
        add(device.sampleRate);
    }
    else
    {
        add(options.sampleRate);
    }

    return rates;
}

std::unique_ptr<juce::AudioIODevice> openDevice(
    juce::AudioIODeviceType& type,
    const DeviceDescriptor& descriptor,
    const Options& options,
    int& actualSampleRate,
    int& openedBufferFrames,
    int& actualBufferFrames)
{
    const auto createStarted = std::chrono::steady_clock::now();
    logLine("createDevice starting for " + descriptor.name.toStdString());
    std::unique_ptr<juce::AudioIODevice> device(type.createDevice(descriptor.name, {}));
    logLine(
        "createDevice completed in " + std::to_string(elapsedMs(createStarted))
        + " ms for " + descriptor.name.toStdString());

    if (device == nullptr)
        throw std::runtime_error("failed to create output device");

    juce::BigInteger outputChannels;
    const int channelCount = std::max(1, options.channels);

    for (int i = 0; i < channelCount; ++i)
        outputChannels.setBit(i);

    juce::String lastError;
    const auto attempts = buildSampleRateAttempts(options, descriptor);
    const auto bufferAttempts = buildBufferSizeAttempts(options);

    for (const auto bufferSize : bufferAttempts)
    {
        for (const auto rate : attempts)
        {
            const auto openStarted = std::chrono::steady_clock::now();
            logLine(
                "device->open starting at " + std::to_string(rate)
                + " Hz, " + std::to_string(channelCount)
                + " ch, buffer=" + std::to_string(bufferSize));
            lastError = device->open({}, outputChannels, static_cast<double>(rate), bufferSize);
            logLine(
                "device->open(" + std::to_string(rate)
                + " Hz, " + std::to_string(channelCount)
                + " ch, buffer=" + std::to_string(bufferSize)
                + ") completed in " + std::to_string(elapsedMs(openStarted)) + " ms");

            if (lastError.isEmpty())
            {
                actualSampleRate = static_cast<int>(std::round(device->getCurrentSampleRate()));
                openedBufferFrames = bufferSize;
                actualBufferFrames = std::max(1, device->getCurrentBufferSizeSamples());
                if (options.exclusive && actualSampleRate != options.sampleRate)
                {
                    device->close();
                    throw std::runtime_error(
                        "output sample rate mismatch: requested "
                        + std::to_string(options.sampleRate)
                        + " Hz, opened "
                        + std::to_string(actualSampleRate)
                        + " Hz");
                }
                if (options.asio && actualSampleRate != options.sampleRate)
                {
                    logLine(
                        "ASIO opened at hardware sample rate "
                        + std::to_string(actualSampleRate)
                        + " Hz instead of requested "
                        + std::to_string(options.sampleRate)
                        + " Hz; decoder-side resampling will be required");
                }
                return device;
            }

            logLine("Open failed at " + std::to_string(rate) + " Hz, buffer=" + std::to_string(bufferSize) + ": " + lastError.toStdString());
        }
    }

    throw std::runtime_error(lastError.isNotEmpty() ? lastError.toStdString() : "failed to open output device");
}

std::unique_ptr<juce::AudioIODevice> openSelectedDevice(
    const Options& options,
    const DeviceDescriptor& selected,
    juce::OwnedArray<juce::AudioIODeviceType>& types,
    DeviceDescriptor& openedDescriptor,
    int& actualSampleRate,
    int& openedBufferFrames,
    int& actualBufferFrames)
{
    const auto candidates = buildOpenCandidates(options, selected);
    std::string lastError;

    for (const auto& candidate : candidates)
    {
        auto* type = findTypeByName(types, candidate.typeName);

        if (type == nullptr)
        {
            lastError = "device type disappeared: " + candidate.typeName.toStdString();
            logLine(lastError);
            continue;
        }

        type->scanForDevices();
        logLine(
            "Trying JUCE device type " + candidate.typeName.toStdString()
            + " for " + candidate.name.toStdString());

        try
        {
            int openedSampleRate = options.sampleRate;
            int openedBufferSizeFrames = getDeviceBufferSize(options);
            int actualBufferSizeFrames = openedBufferSizeFrames;
            auto device = openDevice(
                *type,
                candidate,
                options,
                openedSampleRate,
                openedBufferSizeFrames,
                actualBufferSizeFrames);
            openedDescriptor = candidate;
            actualSampleRate = openedSampleRate;
            openedBufferFrames = openedBufferSizeFrames;
            actualBufferFrames = actualBufferSizeFrames;
            logLine(
                "Opened output with " + candidate.typeName.toStdString()
                + " at " + std::to_string(actualSampleRate) + " Hz"
                + " requestedBuffer=" + std::to_string(getDeviceBufferSize(options)) + " frames"
                + " openedBuffer=" + std::to_string(openedBufferFrames) + " frames"
                + " actualBuffer=" + std::to_string(actualBufferFrames) + " frames");
            return device;
        }
        catch (const std::exception& error)
        {
            lastError = error.what();
            logLine(
                "Backend " + candidate.typeName.toStdString()
                + " failed for " + candidate.name.toStdString()
                + ": " + lastError);
        }
    }

    throw std::runtime_error(
        getOpenFailurePrefix(options)
        + "failed to open output device \"" + selected.name.toStdString()
        + "\": " + (lastError.empty() ? "no compatible backend" : lastError));
}

#if JUCE_WINDOWS
template <typename Source>
void stopStdinReaderForEarlyReturn(Source& source, std::atomic<bool>& shutdownRequested, std::thread& reader)
{
    shutdownRequested.store(true, std::memory_order_release);
    source.requestStop();

    if (reader.joinable())
    {
        const int stdinFd = _fileno(stdin);
        if (stdinFd >= 0)
            _close(stdinFd);
        reader.join();
    }
}

template <typename Source>
bool stopAfterAsioRenderFailure(
    asio_runtime* runtime,
    Source& source,
    std::atomic<bool>& shutdownRequested,
    bool& renderFailureReported)
{
    if (renderFailureReported || ! asio_render_failed(runtime))
        return false;

    renderFailureReported = true;
    logLine("ASIO render callback failed; requesting host rebuild");
    writeJsonLine("{\"event\":\"error\",\"reason\":\"asio_render_failed\",\"message\":\"ASIO render callback failed\"}");
    shutdownRequested.store(true, std::memory_order_release);
    source.requestStop();
    return true;
}

uint32_t legacyWasapiRenderCallback(void* userData, float* output, uint32_t frameCount, uint32_t channels)
{
    auto* source = static_cast<PcmRingAudioSource*>(userData);
    return source != nullptr ? source->renderInterleaved(output, frameCount, channels) : 0;
}

uint32_t legacyDopRenderCallback(void* userData, uint32_t* output, uint32_t frameCount, uint32_t channels)
{
    auto* source = static_cast<DopRingSource*>(userData);
    return source != nullptr ? source->renderInterleaved(output, frameCount, channels) : 0;
}

uint32_t legacyNativeDsdRenderCallback(void* userData, uint8_t* output, uint32_t byteFrameCount, uint32_t channels)
{
    auto* source = static_cast<NativeDsdRingSource*>(userData);
    return source != nullptr ? source->renderInterleaved(output, byteFrameCount, channels) : 0;
}

void writeWasapiNotificationEvent(const wasapi_host_notification* notification)
{
    if (notification == nullptr || notification->event == nullptr)
        return;

    std::string json = "{\"event\":\"" + jsonEscape(juce::String::fromUTF8(notification->event)) + "\"";

    if (notification->deviceId != nullptr && notification->deviceId[0] != L'\0')
        json += ",\"deviceId\":\"" + jsonEscape(juce::String(notification->deviceId)) + "\"";

    if (notification->reason != nullptr && notification->reason[0] != '\0')
        json += ",\"reason\":\"" + jsonEscape(juce::String::fromUTF8(notification->reason)) + "\"";

    json += ",\"code\":" + std::to_string(notification->code)
        + ",\"currentDevice\":" + std::string(notification->currentDevice ? "true" : "false")
        + ",\"followsDefaultDevice\":" + std::string(notification->followsDefaultDevice ? "true" : "false")
        + "}";

    writeJsonLine(json);
}

void wasapiNotificationCallback(void* userData, const wasapi_host_notification* notification)
{
    (void)userData;

    try
    {
        writeWasapiNotificationEvent(notification);
    }
    catch (const std::exception& error)
    {
        logLine(std::string("WASAPI notification write failed: ") + error.what());
    }
    catch (...)
    {
        logLine("WASAPI notification write failed");
    }
}

void cleanupLegacyWasapiAndAck(
    PcmRingAudioSource& source,
    wasapi_exclusive_runtime*& runtime,
    EqControlServer& eqControlServer,
    bool& shutdownAckSent)
{
    try
    {
        source.requestStop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("source.requestStop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("source.requestStop cleanup failed");
    }

    if (runtime != nullptr)
    {
        try
        {
            wasapi_exclusive_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy WASAPI stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy WASAPI stop cleanup failed");
        }
        runtime = nullptr;
    }

    try
    {
        eqControlServer.stop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("eqControlServer.stop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("eqControlServer.stop cleanup failed");
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

void cleanupLegacyWasapiDopAndAck(
    DopRingSource& source,
    wasapi_exclusive_runtime*& runtime,
    bool& shutdownAckSent)
{
    source.requestStop();

    if (runtime != nullptr)
    {
        try
        {
            wasapi_exclusive_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy WASAPI DoP stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy WASAPI DoP stop cleanup failed");
        }
        runtime = nullptr;
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

void cleanupLegacyWasapiSharedAndAck(
    PcmRingAudioSource& source,
    wasapi_shared_runtime*& runtime,
    EqControlServer& eqControlServer,
    bool& shutdownAckSent)
{
    try
    {
        source.requestStop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("source.requestStop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("source.requestStop cleanup failed");
    }

    if (runtime != nullptr)
    {
        try
        {
            wasapi_shared_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy WASAPI shared stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy WASAPI shared stop cleanup failed");
        }
        runtime = nullptr;
    }

    try
    {
        eqControlServer.stop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("eqControlServer.stop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("eqControlServer.stop cleanup failed");
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

#if ECHO_ENABLE_ASIO
void cleanupLegacyAsioAndAck(
    PcmRingAudioSource& source,
    asio_runtime*& runtime,
    EqControlServer& eqControlServer,
    bool& shutdownAckSent)
{
    try
    {
        source.requestStop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("source.requestStop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("source.requestStop cleanup failed");
    }

    if (runtime != nullptr)
    {
        try
        {
            asio_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy ASIO stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy ASIO stop cleanup failed");
        }
        runtime = nullptr;
    }

    try
    {
        eqControlServer.stop();
    }
    catch (const std::exception& error)
    {
        logLine(std::string("eqControlServer.stop cleanup failed: ") + error.what());
    }
    catch (...)
    {
        logLine("eqControlServer.stop cleanup failed");
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

void cleanupLegacyAsioDopAndAck(
    DopRingSource& source,
    asio_runtime*& runtime,
    bool& shutdownAckSent)
{
    source.requestStop();

    if (runtime != nullptr)
    {
        try
        {
            asio_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy ASIO DoP stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy ASIO DoP stop cleanup failed");
        }
        runtime = nullptr;
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}

void cleanupLegacyAsioNativeDsdAndAck(
    NativeDsdRingSource& source,
    asio_runtime*& runtime,
    bool& shutdownAckSent)
{
    source.requestStop();

    if (runtime != nullptr)
    {
        try
        {
            asio_stop(runtime);
        }
        catch (const std::exception& error)
        {
            logLine(std::string("legacy ASIO native DSD stop cleanup failed: ") + error.what());
        }
        catch (...)
        {
            logLine("legacy ASIO native DSD stop cleanup failed");
        }
        runtime = nullptr;
    }

    if (! shutdownAckSent)
    {
        shutdownAckSent = true;
        try
        {
            writeJsonLine("{\"event\":\"shutdown-ack\"}");
        }
        catch (const std::exception& error)
        {
            logLine(std::string("shutdown-ack write failed: ") + error.what());
        }
        catch (...)
        {
            logLine("shutdown-ack write failed");
        }
    }
}
#endif

int runLegacyWasapiExclusiveHost(const Options& options)
{
    const auto descriptor = selectDevice(options);
    logLine("Using legacy WASAPI exclusive device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
    const bool eqControlReady = eqControlServer.start();
    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);
    const int fifoCapacityFrames = getFifoCapacityFrames(options, options.sampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, options.sampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    PcmRingAudioSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs,
        options.volume,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor);
    source.prepareForNativeRender(fifoCapacityFrames, static_cast<double>(options.sampleRate));

    std::atomic<bool> shutdownRequested { false };
    std::thread reader;

    wasapi_exclusive_runtime* runtime = nullptr;
    wasapi_exclusive_ready_info readyInfo {};
    char error[512] {};
    const bool useDefaultWasapiDevice = options.deviceName.isEmpty() && options.deviceIndex < 0;
    const char* wasapiDeviceName = useDefaultWasapiDevice ? nullptr : descriptor.name.toRawUTF8();
    const int wasapiDeviceIndex = (! useDefaultWasapiDevice && options.deviceIndex >= 0 && descriptor.index == options.deviceIndex)
        ? descriptor.index
        : -1;
    const auto startResult = wasapi_exclusive_start(
        wasapiDeviceName,
        wasapiDeviceIndex,
        static_cast<uint32_t>(options.sampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        legacyWasapiRenderCallback,
        &source,
        wasapiNotificationCallback,
        nullptr,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        if (startResult == echo_audio_host::kExitDeviceInitializeTimeout)
        {
            logLine(std::string("WASAPI exclusive open failed: ") + (error[0] != '\0' ? error : "device initialize timeout"));
            std::cerr.flush();
            shutdownRequested.store(true, std::memory_order_release);
            source.requestStop();
            eqControlServer.stop();
            return echo_audio_host::kExitDeviceInitializeTimeout;
        }
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        eqControlServer.stop();
        throw std::runtime_error(
            std::string("WASAPI exclusive open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy WASAPI exclusive output"));
    }

    if (options.framedStdin)
        reader = std::thread(framedStdinReader, std::ref(source), options.channels, static_cast<double>(options.sampleRate), std::ref(shutdownRequested));
    else
        reader = std::thread(stdinReader, std::ref(source), options.channels);

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : options.sampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":0"
        + ",\"sharedSampleRate\":0"
        + ",\"channels\":" + std::to_string(options.channels)
        + ",\"exclusive\":true"
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
        + ",\"backend\":\"wasapi-exclusive\""
        + ",\"backendImpl\":\"legacy-wasapi-exclusive\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"deviceType\":\"Windows Audio (Exclusive Mode)\",\"deviceName\":\""
        + jsonEscape(descriptor.name) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        const auto frames = source.getFramesPlayed();

        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (options.framedStdin)
        {
            if (source.isDrained())
            {
                if (! endedReported)
                {
                    writeJsonLine("{\"event\":\"ended\"}");
                    endedReported = true;
                }
            }
            else
            {
                endedReported = false;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (source.getUnderrunCallbacks() > 0)
    {
        logLine(
            "Output underruns: callbacks=" + std::to_string(source.getUnderrunCallbacks())
            + " frames=" + std::to_string(source.getUnderrunFrames()));
    }

    if (! options.framedStdin || ! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyWasapiAndAck(source, runtime, eqControlServer, shutdownAckSent);
    return 0;
}

int runLegacyWasapiExclusiveDopHost(const Options& options)
{
    const auto descriptor = selectDevice(options);
    logLine("Using legacy WASAPI exclusive DoP device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);
    const int fifoCapacityFrames = getFifoCapacityFrames(options, options.sampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, options.sampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    DopRingSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs);

    std::atomic<bool> shutdownRequested { false };
    std::thread reader(framedDopStdinReader, std::ref(source), options.channels, std::ref(shutdownRequested));

    wasapi_exclusive_runtime* runtime = nullptr;
    wasapi_exclusive_ready_info readyInfo {};
    char error[512] {};
    const bool useDefaultWasapiDevice = options.deviceName.isEmpty() && options.deviceIndex < 0;
    const char* wasapiDeviceName = useDefaultWasapiDevice ? nullptr : descriptor.name.toRawUTF8();
    const int wasapiDeviceIndex = (! useDefaultWasapiDevice && options.deviceIndex >= 0 && descriptor.index == options.deviceIndex)
        ? descriptor.index
        : -1;
    const auto startResult = wasapi_exclusive_start_dop(
        wasapiDeviceName,
        wasapiDeviceIndex,
        static_cast<uint32_t>(options.sampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        legacyDopRenderCallback,
        &source,
        wasapiNotificationCallback,
        nullptr,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        if (startResult == echo_audio_host::kExitDeviceInitializeTimeout)
        {
            logLine(std::string("WASAPI exclusive DoP open failed: ") + (error[0] != '\0' ? error : "device initialize timeout"));
            std::cerr.flush();
            stopStdinReaderForEarlyReturn(source, shutdownRequested, reader);
            return echo_audio_host::kExitDeviceInitializeTimeout;
        }
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        if (reader.joinable())
            reader.join();
        throw std::runtime_error(
            std::string("WASAPI exclusive DoP open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy WASAPI exclusive DoP output"));
    }

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : options.sampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":0"
        + ",\"sharedSampleRate\":0"
        + ",\"channels\":" + std::to_string(options.channels)
        + ",\"exclusive\":true"
        + ",\"eqControlPort\":0"
        + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"requestedDeviceBufferFrames\":" + std::to_string(requestedDeviceBufferFrames)
        + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
        + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != requestedDeviceBufferFrames ? "true" : "false")
        + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
        + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
        + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
        + ",\"dspActive\":false"
        + ",\"dspClippingRisk\":false"
        + ",\"dspLimiterProtecting\":false"
        + ",\"backend\":\"wasapi-exclusive\""
        + ",\"backendImpl\":\"legacy-wasapi-exclusive-dop\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"deviceType\":\"Windows Audio (Exclusive Mode)\",\"deviceName\":\""
        + jsonEscape(descriptor.name) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        const auto frames = source.getFramesPlayed();
        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (source.isDrained())
        {
            if (! endedReported)
            {
                writeJsonLine("{\"event\":\"ended\"}");
                endedReported = true;
            }
        }
        else
        {
            endedReported = false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyWasapiDopAndAck(source, runtime, shutdownAckSent);
    return 0;
}

int openAsioControlPanel(const Options& options)
{
#if ECHO_ENABLE_ASIO
    char error[1024] {};
    const int result = asio_open_control_panel(
        options.deviceName.isNotEmpty() ? options.deviceName.toRawUTF8() : nullptr,
        options.deviceIndex,
        error,
        sizeof(error));

    if (result != 0)
    {
        logLine(std::string("ASIO control panel failed: ") + (error[0] != '\0' ? error : "unknown error"));
        return 3;
    }

    return 0;
#else
    (void)options;
    logLine("ASIO control panel failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");
    return 3;
#endif
}

int runLegacyWasapiSharedHost(const Options& options)
{
    const bool useDefaultWasapiDevice = options.deviceName.isEmpty() && options.deviceIndex < 0;
    const DeviceDescriptor descriptor = useDefaultWasapiDevice
        ? DeviceDescriptor { -1, "Windows Audio", "Default Windows Audio", options.sampleRate, options.sampleRate, true, false }
        : selectDevice(options);
    logLine("Using legacy WASAPI shared device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);
    const int plannedSampleRate = descriptor.sharedSampleRate > 0 ? descriptor.sharedSampleRate : options.sampleRate;

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
    const bool eqControlReady = eqControlServer.start();
    const int fifoCapacityFrames = getFifoCapacityFrames(options, plannedSampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, plannedSampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    PcmRingAudioSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs,
        options.volume,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor);
    source.prepareForNativeRender(fifoCapacityFrames, static_cast<double>(plannedSampleRate));

    std::atomic<bool> shutdownRequested { false };
    std::thread reader;

    if (options.framedStdin)
        reader = std::thread(framedStdinReader, std::ref(source), options.channels, static_cast<double>(options.sampleRate), std::ref(shutdownRequested));
    else
        reader = std::thread(stdinReader, std::ref(source), options.channels);

    wasapi_shared_runtime* runtime = nullptr;
    wasapi_shared_ready_info readyInfo {};
    char error[512] {};
    const char* wasapiDeviceName = useDefaultWasapiDevice ? nullptr : descriptor.name.toRawUTF8();
    const int wasapiDeviceIndex = (! useDefaultWasapiDevice && options.deviceIndex >= 0 && descriptor.index == options.deviceIndex)
        ? descriptor.index
        : -1;
    const auto startResult = wasapi_shared_start(
        wasapiDeviceName,
        wasapiDeviceIndex,
        static_cast<uint32_t>(plannedSampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        legacyWasapiRenderCallback,
        &source,
        wasapiNotificationCallback,
        nullptr,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        if (startResult == echo_audio_host::kExitDeviceInitializeTimeout)
        {
            logLine(std::string("WASAPI shared open failed: ") + (error[0] != '\0' ? error : "device initialize timeout"));
            std::cerr.flush();
            stopStdinReaderForEarlyReturn(source, shutdownRequested, reader);
            eqControlServer.stop();
            return echo_audio_host::kExitDeviceInitializeTimeout;
        }
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        if (reader.joinable())
            reader.join();
        eqControlServer.stop();
        throw std::runtime_error(
            std::string("WASAPI shared open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy WASAPI shared output"));
    }

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : plannedSampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;

    logLine("ready event writing");
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
        + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != requestedDeviceBufferFrames ? "true" : "false")
        + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
        + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
        + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
        + ",\"dspActive\":" + std::string(source.isDspActive() ? "true" : "false")
        + ",\"dspClippingRisk\":" + std::string(source.hasDspClippingRisk() ? "true" : "false")
        + ",\"dspLimiterProtecting\":" + std::string(source.isDspLimiterProtecting() ? "true" : "false")
        + ",\"backend\":\"wasapi-shared\""
        + ",\"backendImpl\":\"legacy-wasapi-shared\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"deviceType\":\"Windows Audio\",\"deviceName\":\""
        + jsonEscape(descriptor.name) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        const auto frames = source.getFramesPlayed();

        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (options.framedStdin)
        {
            if (source.isDrained())
            {
                if (! endedReported)
                {
                    writeJsonLine("{\"event\":\"ended\"}");
                    endedReported = true;
                }
            }
            else
            {
                endedReported = false;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (source.getUnderrunCallbacks() > 0)
    {
        logLine(
            "Output underruns: callbacks=" + std::to_string(source.getUnderrunCallbacks())
            + " frames=" + std::to_string(source.getUnderrunFrames()));
    }

    if (! options.framedStdin || ! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyWasapiSharedAndAck(source, runtime, eqControlServer, shutdownAckSent);
    return 0;
}

#if ! ECHO_ENABLE_ASIO
int runLegacyAsioHost(const Options& options)
{
    (void)options;
    throw std::runtime_error("ASIO open failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");
}

int runLegacyAsioDopHost(const Options& options)
{
    (void)options;
    throw std::runtime_error("ASIO DoP open failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");
}

int runLegacyAsioNativeDsdHost(const Options& options)
{
    (void)options;
    throw std::runtime_error("ASIO native DSD open failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");
}
#else
int runLegacyAsioHost(const Options& options)
{
    const auto descriptor = selectDevice(options);
    logLine("Using legacy ASIO SDK device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    const int requestedDeviceBufferFrames = std::max(0, options.bufferSize);
    const int plannedSampleRate = options.sampleRate;
    const int fifoCapacityFrames = getFifoCapacityFrames(options, plannedSampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, plannedSampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
    const bool eqControlReady = eqControlServer.start();

    PcmRingAudioSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs,
        options.volume,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor);
    source.prepareForNativeRender(fifoCapacityFrames, static_cast<double>(plannedSampleRate));

    std::atomic<bool> shutdownRequested { false };
    std::thread reader;

    if (options.framedStdin)
        reader = std::thread(framedStdinReader, std::ref(source), options.channels, static_cast<double>(options.sampleRate), std::ref(shutdownRequested));
    else
        reader = std::thread(stdinReader, std::ref(source), options.channels);

    asio_runtime* runtime = nullptr;
    asio_ready_info readyInfo {};
    char error[1024] {};
    const auto startResult = asio_start(
        descriptor.name.toRawUTF8(),
        -1,
        static_cast<uint32_t>(options.sampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        static_cast<uint32_t>(options.asioOutputChannelStart),
        [] (void* userData, float* output, unsigned int frameCount, unsigned int channels) -> unsigned int
        {
            auto* pcmSource = static_cast<PcmRingAudioSource*>(userData);
            return pcmSource != nullptr ? pcmSource->renderInterleaved(output, frameCount, channels) : 0;
        },
        &source,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        if (reader.joinable())
            reader.join();
        eqControlServer.stop();
        throw std::runtime_error(
            std::string("ASIO open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy ASIO SDK output"));
    }

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : options.sampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;
    const int reportedRequestedDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(
        1,
        readyInfo.requestedBufferFrameCount > 0 ? readyInfo.requestedBufferFrameCount : readyInfo.bufferFrameCount));

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":0"
        + ",\"sharedSampleRate\":0"
        + ",\"channels\":" + std::to_string(static_cast<int>(readyInfo.channels > 0 ? readyInfo.channels : options.channels))
        + ",\"exclusive\":false"
        + ",\"asio\":true"
        + ",\"eqControlPort\":" + std::to_string(eqControlReady ? options.eqControlPort : 0)
        + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"requestedDeviceBufferFrames\":" + std::to_string(reportedRequestedDeviceBufferFrames)
        + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
        + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != reportedRequestedDeviceBufferFrames ? "true" : "false")
        + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
        + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
        + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
        + ",\"dspActive\":" + std::string(source.isDspActive() ? "true" : "false")
        + ",\"dspClippingRisk\":" + std::string(source.hasDspClippingRisk() ? "true" : "false")
        + ",\"dspLimiterProtecting\":" + std::string(source.isDspLimiterProtecting() ? "true" : "false")
        + ",\"backend\":\"asio\""
        + ",\"backendImpl\":\"legacy-asio-sdk\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"asioInputChannels\":" + std::to_string(readyInfo.inputChannels)
        + ",\"asioOutputChannels\":" + std::to_string(readyInfo.outputChannels)
        + ",\"asioOutputChannelStart\":" + std::to_string(readyInfo.outputChannelStart)
        + ",\"asioPreferredBufferFrames\":" + std::to_string(readyInfo.preferredBufferFrames)
        + ",\"asioMinBufferFrames\":" + std::to_string(readyInfo.minBufferFrames)
        + ",\"asioMaxBufferFrames\":" + std::to_string(readyInfo.maxBufferFrames)
        + ",\"asioGranularity\":" + std::to_string(readyInfo.granularity)
        + ",\"deviceType\":\"ASIO\",\"deviceName\":\""
        + jsonEscape(juce::String::fromUTF8(readyInfo.deviceName[0] != '\0' ? readyInfo.deviceName : descriptor.name.toRawUTF8())) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;
    bool renderFailureReported = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        if (stopAfterAsioRenderFailure(runtime, source, shutdownRequested, renderFailureReported))
            break;

        const auto frames = source.getFramesPlayed();

        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (options.framedStdin)
        {
            if (source.isDrained())
            {
                if (! endedReported)
                {
                    writeJsonLine("{\"event\":\"ended\"}");
                    endedReported = true;
                }
            }
            else
            {
                endedReported = false;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (renderFailureReported)
        stopStdinReaderForEarlyReturn(source, shutdownRequested, reader);
    else if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (source.getUnderrunCallbacks() > 0)
    {
        logLine(
            "Output underruns: callbacks=" + std::to_string(source.getUnderrunCallbacks())
            + " frames=" + std::to_string(source.getUnderrunFrames()));
    }

    if (! renderFailureReported && (! options.framedStdin || ! endedReported))
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyAsioAndAck(source, runtime, eqControlServer, shutdownAckSent);
    return 0;
}

int runLegacyAsioDopHost(const Options& options)
{
    const auto descriptor = selectDevice(options);
    logLine("Using legacy ASIO SDK DoP device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    const int requestedDeviceBufferFrames = std::max(0, options.bufferSize);
    const int plannedSampleRate = options.sampleRate;
    const int fifoCapacityFrames = getFifoCapacityFrames(options, plannedSampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, plannedSampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    DopRingSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs);

    std::atomic<bool> shutdownRequested { false };
    std::thread reader(framedDopStdinReader, std::ref(source), options.channels, std::ref(shutdownRequested));

    asio_runtime* runtime = nullptr;
    asio_ready_info readyInfo {};
    char error[1024] {};
    const auto startResult = asio_start_dop(
        descriptor.name.toRawUTF8(),
        -1,
        static_cast<uint32_t>(options.sampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        static_cast<uint32_t>(options.asioOutputChannelStart),
        legacyDopRenderCallback,
        &source,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        if (reader.joinable())
            reader.join();
        throw std::runtime_error(
            std::string("ASIO DoP open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy ASIO SDK DoP output"));
    }

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : options.sampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;
    const int reportedRequestedDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(
        1,
        readyInfo.requestedBufferFrameCount > 0 ? readyInfo.requestedBufferFrameCount : readyInfo.bufferFrameCount));

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":0"
        + ",\"sharedSampleRate\":0"
        + ",\"channels\":" + std::to_string(static_cast<int>(readyInfo.channels > 0 ? readyInfo.channels : options.channels))
        + ",\"exclusive\":false"
        + ",\"asio\":true"
        + ",\"eqControlPort\":0"
        + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"requestedDeviceBufferFrames\":" + std::to_string(reportedRequestedDeviceBufferFrames)
        + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
        + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != reportedRequestedDeviceBufferFrames ? "true" : "false")
        + ",\"fifoCapacityFrames\":" + std::to_string(fifoCapacityFrames)
        + ",\"startupPrebufferFrames\":" + std::to_string(startupPrebufferFrames)
        + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
        + ",\"dspActive\":false"
        + ",\"dspClippingRisk\":false"
        + ",\"dspLimiterProtecting\":false"
        + ",\"backend\":\"asio\""
        + ",\"backendImpl\":\"legacy-asio-sdk-dop\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"asioInputChannels\":" + std::to_string(readyInfo.inputChannels)
        + ",\"asioOutputChannels\":" + std::to_string(readyInfo.outputChannels)
        + ",\"asioOutputChannelStart\":" + std::to_string(readyInfo.outputChannelStart)
        + ",\"asioPreferredBufferFrames\":" + std::to_string(readyInfo.preferredBufferFrames)
        + ",\"asioMinBufferFrames\":" + std::to_string(readyInfo.minBufferFrames)
        + ",\"asioMaxBufferFrames\":" + std::to_string(readyInfo.maxBufferFrames)
        + ",\"asioGranularity\":" + std::to_string(readyInfo.granularity)
        + ",\"deviceType\":\"ASIO\",\"deviceName\":\""
        + jsonEscape(juce::String::fromUTF8(readyInfo.deviceName[0] != '\0' ? readyInfo.deviceName : descriptor.name.toRawUTF8())) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;
    bool renderFailureReported = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        if (stopAfterAsioRenderFailure(runtime, source, shutdownRequested, renderFailureReported))
            break;

        const auto frames = source.getFramesPlayed();
        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (source.isDrained())
        {
            if (! endedReported)
            {
                writeJsonLine("{\"event\":\"ended\"}");
                endedReported = true;
            }
        }
        else
        {
            endedReported = false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (renderFailureReported)
        stopStdinReaderForEarlyReturn(source, shutdownRequested, reader);
    else if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (! renderFailureReported && ! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyAsioDopAndAck(source, runtime, shutdownAckSent);
    return 0;
}

int runLegacyAsioNativeDsdHost(const Options& options)
{
    const auto descriptor = selectDevice(options);
    logLine("Using legacy ASIO SDK native DSD device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    const int requestedDeviceBufferFrames = std::max(0, options.bufferSize);
    const int plannedNativeSampleRate = options.nativeDsdSampleRate > 0 ? options.nativeDsdSampleRate : options.sampleRate;
    const int fifoCapacityFrames = getFifoCapacityFrames(options, plannedNativeSampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, plannedNativeSampleRate);
    const int fifoCapacityByteFrames = std::max(1, (fifoCapacityFrames + 7) / 8);
    const int startupPrebufferByteFrames = std::max(0, (startupPrebufferFrames + 7) / 8);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    NativeDsdRingSource source(
        options.channels,
        fifoCapacityByteFrames,
        startupPrebufferByteFrames,
        startupPrebufferTimeoutMs);

    std::atomic<bool> shutdownRequested { false };
    std::thread reader(framedNativeDsdStdinReader, std::ref(source), options.channels, std::ref(shutdownRequested));

    asio_runtime* runtime = nullptr;
    asio_ready_info readyInfo {};
    char error[1024] {};
    const auto startResult = asio_start_native_dsd(
        descriptor.name.toRawUTF8(),
        -1,
        static_cast<uint32_t>(plannedNativeSampleRate),
        static_cast<uint32_t>(options.channels),
        static_cast<uint32_t>(requestedDeviceBufferFrames),
        static_cast<uint32_t>(options.asioOutputChannelStart),
        legacyNativeDsdRenderCallback,
        &source,
        &runtime,
        &readyInfo,
        error,
        sizeof(error));

    if (startResult != 0 || runtime == nullptr)
    {
        shutdownRequested.store(true, std::memory_order_release);
        source.requestStop();
        if (reader.joinable())
            reader.join();
        throw std::runtime_error(
            std::string("ASIO native DSD open failed: ")
            + (error[0] != '\0' ? error : "failed to start legacy ASIO SDK native DSD output"));
    }

    const int actualSampleRate = static_cast<int>(readyInfo.sampleRate > 0 ? readyInfo.sampleRate : plannedNativeSampleRate);
    const int actualDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(1, readyInfo.bufferFrameCount));
    const int openedDeviceBufferFrames = actualDeviceBufferFrames;
    const int reportedRequestedDeviceBufferFrames = static_cast<int>(std::max<uint32_t>(
        1,
        readyInfo.requestedBufferFrameCount > 0 ? readyInfo.requestedBufferFrameCount : readyInfo.bufferFrameCount));
    const uint64_t reportedFifoCapacityFrames = static_cast<uint64_t>(fifoCapacityByteFrames) * 8u;
    const uint64_t reportedStartupPrebufferFrames = static_cast<uint64_t>(startupPrebufferByteFrames) * 8u;

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":0"
        + ",\"sharedSampleRate\":0"
        + ",\"channels\":" + std::to_string(static_cast<int>(readyInfo.channels > 0 ? readyInfo.channels : options.channels))
        + ",\"exclusive\":false"
        + ",\"asio\":true"
        + ",\"nativeDsd\":true"
        + ",\"eqControlPort\":0"
        + ",\"deviceBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"nativeActualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"actualBufferFrames\":" + std::to_string(actualDeviceBufferFrames)
        + ",\"requestedDeviceBufferFrames\":" + std::to_string(reportedRequestedDeviceBufferFrames)
        + ",\"openedDeviceBufferFrames\":" + std::to_string(openedDeviceBufferFrames)
        + ",\"bufferSizeFallback\":" + std::string(openedDeviceBufferFrames != reportedRequestedDeviceBufferFrames ? "true" : "false")
        + ",\"fifoCapacityFrames\":" + std::to_string(reportedFifoCapacityFrames)
        + ",\"startupPrebufferFrames\":" + std::to_string(reportedStartupPrebufferFrames)
        + ",\"startupPrebufferTimeoutMs\":" + std::to_string(startupPrebufferTimeoutMs)
        + ",\"dspActive\":false"
        + ",\"dspClippingRisk\":false"
        + ",\"dspLimiterProtecting\":false"
        + ",\"backend\":\"asio\""
        + ",\"backendImpl\":\"legacy-asio-sdk-native-dsd\""
        + ",\"format\":\"" + jsonEscape(juce::String::fromUTF8(readyInfo.format)) + "\""
        + ",\"asioInputChannels\":" + std::to_string(readyInfo.inputChannels)
        + ",\"asioOutputChannels\":" + std::to_string(readyInfo.outputChannels)
        + ",\"asioOutputChannelStart\":" + std::to_string(readyInfo.outputChannelStart)
        + ",\"asioPreferredBufferFrames\":" + std::to_string(readyInfo.preferredBufferFrames)
        + ",\"asioMinBufferFrames\":" + std::to_string(readyInfo.minBufferFrames)
        + ",\"asioMaxBufferFrames\":" + std::to_string(readyInfo.maxBufferFrames)
        + ",\"asioGranularity\":" + std::to_string(readyInfo.granularity)
        + ",\"deviceType\":\"ASIO\",\"deviceName\":\""
        + jsonEscape(juce::String::fromUTF8(readyInfo.deviceName[0] != '\0' ? readyInfo.deviceName : descriptor.name.toRawUTF8())) + "\"}");

    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;
    bool renderFailureReported = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        if (stopAfterAsioRenderFailure(runtime, source, shutdownRequested, renderFailureReported))
            break;

        const auto frames = source.getFramesPlayed();
        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (source.isDrained())
        {
            if (! endedReported)
            {
                writeJsonLine("{\"event\":\"ended\"}");
                endedReported = true;
            }
        }
        else
        {
            endedReported = false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (renderFailureReported)
        stopStdinReaderForEarlyReturn(source, shutdownRequested, reader);
    else if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (! renderFailureReported && ! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupLegacyAsioNativeDsdAndAck(source, runtime, shutdownAckSent);
    return 0;
}
#endif
#endif

int runJuceDecodePcm(const Options& options)
{
    if (options.decodeFile.isEmpty())
        throw std::runtime_error("JUCE decode failed: missing input file");

    juce::File file(options.decodeFile);
    if (! file.existsAsFile())
        throw std::runtime_error("JUCE decode failed: input file not found");

    if (! file.hasFileExtension("wav;wave;flac;mp3"))
        throw std::runtime_error("JUCE decode unsupported format: pilot only accepts WAV/FLAC/MP3");

#if JUCE_WINDOWS
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    juce::AudioFormatManager formatManager;
    formatManager.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
    if (reader == nullptr)
        throw std::runtime_error("JUCE decode failed: reader could not open input");

    const int sourceSampleRate = static_cast<int>(std::llround(reader->sampleRate));
    if (sourceSampleRate <= 0)
        throw std::runtime_error("JUCE decode failed: source sample rate unavailable");

    if (sourceSampleRate != options.sampleRate)
        throw std::runtime_error(
            "JUCE decode resampling unsupported: source="
            + std::to_string(sourceSampleRate)
            + " requested="
            + std::to_string(options.sampleRate));

    const int sourceChannels = static_cast<int>(reader->numChannels);
    if (sourceChannels <= 0 || sourceChannels > 2)
        throw std::runtime_error("JUCE decode unsupported channel count: " + std::to_string(sourceChannels));

    if (sourceChannels != options.channels)
        throw std::runtime_error(
            "JUCE decode channel remap unsupported: source="
            + std::to_string(sourceChannels)
            + " requested="
            + std::to_string(options.channels));

    const int64_t startSample = std::max<int64_t>(
        0,
        static_cast<int64_t>(std::floor(options.decodeStartSeconds * static_cast<double>(sourceSampleRate))));
    if (startSample >= reader->lengthInSamples)
        return 0;

    constexpr int blockFrames = 4096;
    juce::AudioBuffer<float> buffer(sourceChannels, blockFrames);
    std::vector<float> interleaved(static_cast<size_t>(blockFrames * sourceChannels), 0.0f);
    int64_t position = startSample;

    while (position < reader->lengthInSamples)
    {
        const int frames = static_cast<int>(std::min<int64_t>(blockFrames, reader->lengthInSamples - position));
        buffer.clear();

        if (! reader->read(&buffer, 0, frames, position, true, true))
            throw std::runtime_error("JUCE decode failed while reading PCM");

        for (int frame = 0; frame < frames; ++frame)
        {
            for (int channel = 0; channel < sourceChannels; ++channel)
                interleaved[static_cast<size_t>(frame * sourceChannels + channel)] = buffer.getSample(channel, frame);
        }

        const auto bytes = static_cast<std::streamsize>(frames * sourceChannels * static_cast<int>(sizeof(float)));
        std::cout.write(reinterpret_cast<const char*>(interleaved.data()), bytes);
        if (! std::cout.good())
            throw std::runtime_error("JUCE decode failed while writing PCM");

        position += frames;
    }

    return 0;
}

int runJuceDecodeServer()
{
#if JUCE_WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    std::thread worker;
    std::atomic<bool> cancelRequested { false };
    uint32_t currentSessionId = 0;

    try
    {
        while (std::cin.good())
        {
            DecodeServerFrameHeader header;
            if (! readDecodeServerFrameHeader(header))
                break;

            if (header.payloadBytes > 1024 * 1024)
                throw std::runtime_error("decode server input frame payload too large");

            std::vector<char> payload(header.payloadBytes);
            if (header.payloadBytes > 0 && ! readExact(payload.data(), payload.size()))
                break;

            const auto type = static_cast<DecodeServerFrameType>(header.type);

            if (type == DecodeServerFrameType::Start)
            {
                stopDecodeServerWorker(worker, cancelRequested);
                currentSessionId = header.sessionId;

                try
                {
                    DecodeServerRequest request = parseDecodeServerRequest(header.sessionId, payload);
                    cancelRequested.store(false, std::memory_order_release);
                    worker = std::thread(decodeServerWorker, request, std::ref(cancelRequested));
                }
                catch (const std::exception& e)
                {
                    writeDecodeServerError(header.sessionId, e.what());
                }

                continue;
            }

            if (type == DecodeServerFrameType::Cancel)
            {
                if (header.sessionId == currentSessionId)
                    stopDecodeServerWorker(worker, cancelRequested);
                continue;
            }

            if (type == DecodeServerFrameType::Shutdown)
            {
                stopDecodeServerWorker(worker, cancelRequested);
                return 0;
            }
        }
    }
    catch (const std::exception& e)
    {
        stopDecodeServerWorker(worker, cancelRequested);
        logLine(std::string("decode server fatal: ") + e.what());
        return 1;
    }
    catch (...)
    {
        stopDecodeServerWorker(worker, cancelRequested);
        logLine("decode server fatal: unknown exception");
        return 1;
    }

    stopDecodeServerWorker(worker, cancelRequested);
    return 0;
}

int runHost(const Options& options)
{
    configureProcessPriority();
    ScopedTimerResolution timerResolution;

    if (options.asio && ! ECHO_ENABLE_ASIO)
        throw std::runtime_error("ASIO open failed: ASIO support is disabled at build time (ECHO_ENABLE_ASIO=OFF)");

    if (options.exclusive)
        logLine("WASAPI exclusive requested; shared fallback is disabled");

    if (options.asio)
        logLine("ASIO requested; shared fallback is disabled");

    if (! options.exclusive && ! options.asio)
        logLine("Shared backend preference: " + options.sharedBackend.toStdString());

    if (options.dopOutput && ! options.exclusive && ! options.asio)
        throw std::runtime_error("DoP output requires WASAPI exclusive or ASIO");

    if (options.asioNativeDsdOutput && (! options.dopOutput || ! options.asio))
        throw std::runtime_error("ASIO native DSD output requires ASIO DoP output");

    if (options.dopOutput && options.useJuceOutput)
        throw std::runtime_error("DoP output requires legacy integer output, not JUCE output");

    if (options.dopOutput && options.exclusive && ! options.asio)
    {
#if JUCE_WINDOWS
        return runLegacyWasapiExclusiveDopHost(options);
#else
        throw std::runtime_error("WASAPI exclusive DoP open failed: legacy WASAPI exclusive backend is only available on Windows");
#endif
    }

    if (options.dopOutput && options.asio)
    {
#if JUCE_WINDOWS
        if (options.asioNativeDsdOutput)
            return runLegacyAsioNativeDsdHost(options);
        return runLegacyAsioDopHost(options);
#else
        throw std::runtime_error("ASIO DoP open failed: legacy ASIO SDK backend is only available on Windows");
#endif
    }

    if (! options.useJuceOutput && options.exclusive && ! options.asio)
    {
#if JUCE_WINDOWS
        return runLegacyWasapiExclusiveHost(options);
#else
        throw std::runtime_error("WASAPI exclusive open failed: legacy WASAPI exclusive backend is only available on Windows");
#endif
    }

    if (! options.useJuceOutput && options.asio)
    {
#if JUCE_WINDOWS
        return runLegacyAsioHost(options);
#else
        throw std::runtime_error("ASIO open failed: legacy ASIO SDK backend is only available on Windows");
#endif
    }

    if (! options.useJuceOutput && ! options.exclusive && ! options.asio && options.sharedBackend != "directsound" && options.sharedBackend != "alsa")
    {
#if JUCE_WINDOWS
        return runLegacyWasapiSharedHost(options);
#endif
    }

    const auto descriptor = selectDevice(options);
    logLine("Using device index " + std::to_string(descriptor.index) + ": " + descriptor.name.toStdString());

    juce::OwnedArray<juce::AudioIODeviceType> types;
    createDeviceTypes(types);

    int actualSampleRate = options.sampleRate;
    const int requestedDeviceBufferFrames = getDeviceBufferSize(options);
    int openedDeviceBufferFrames = requestedDeviceBufferFrames;
    int actualDeviceBufferFrames = requestedDeviceBufferFrames;
    auto openedDescriptor = descriptor;
    auto device = openSelectedDevice(
        options,
        descriptor,
        types,
        openedDescriptor,
        actualSampleRate,
        openedDeviceBufferFrames,
        actualDeviceBufferFrames);

    echo::EqProcessor eqProcessor;
    echo::ChannelBalanceProcessor channelBalanceProcessor;
    echo::ConvolutionProcessor convolutionProcessor;
    echo::DspHeadroomProcessor headroomProcessor;
    EqControlServer eqControlServer(options.eqControlPort, eqProcessor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
    const bool eqControlReady = eqControlServer.start();
    const int fifoCapacityFrames = getFifoCapacityFrames(options, actualSampleRate);
    const int startupPrebufferFrames = getStartupPrebufferFrames(options, actualSampleRate);
    const int startupPrebufferTimeoutMs = getStartupPrebufferTimeoutMs(options);

    PcmRingAudioSource source(
        options.channels,
        fifoCapacityFrames,
        startupPrebufferFrames,
        startupPrebufferTimeoutMs,
        options.volume,
        eqProcessor,
        convolutionProcessor,
        channelBalanceProcessor,
        headroomProcessor);
    juce::AudioSourcePlayer player;
    player.setSource(&source);

    const bool openedExclusive = ! options.asio && (options.exclusive || isExclusiveType(openedDescriptor.typeName));
    const int openedSharedSampleRate = (! openedExclusive && ! options.asio)
        ? (openedDescriptor.sharedSampleRate > 0 ? openedDescriptor.sharedSampleRate : actualSampleRate)
        : 0;

    std::atomic<bool> shutdownRequested { false };
    std::thread reader;

    if (options.framedStdin)
        reader = std::thread(framedStdinReader, std::ref(source), options.channels, static_cast<double>(options.sampleRate), std::ref(shutdownRequested));
    else
        reader = std::thread(stdinReader, std::ref(source), options.channels);

    logLine("ready event writing");
    writeJsonLine(
        std::string("{\"ready\":true,\"sampleRate\":") + std::to_string(actualSampleRate)
        + ",\"hardwareSampleRate\":" + std::to_string(actualSampleRate)
        + ",\"sharedDeviceSampleRate\":" + std::to_string(openedSharedSampleRate)
        + ",\"sharedSampleRate\":" + std::to_string(openedSharedSampleRate)
        + ",\"channels\":" + std::to_string(options.channels)
        + ",\"exclusive\":" + std::string(openedExclusive ? "true" : "false")
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
        + ",\"backend\":\"" + getBackendName(options, openedDescriptor.typeName)
        + "\",\"backendImpl\":\"" + getBackendImplName(options, openedDescriptor.typeName)
        + "\",\"deviceType\":\""
        + jsonEscape(openedDescriptor.typeName) + "\",\"deviceName\":\""
        + jsonEscape(openedDescriptor.name) + "\"}");

    if (! options.framedStdin)
    {
        const int prebufferedFrames = waitForInitialPcm(source, startupPrebufferFrames, startupPrebufferTimeoutMs);
        if (startupPrebufferFrames > 0)
            logLine("Initial PCM prebuffer before device start: " + std::to_string(prebufferedFrames) + " frames");
    }

    logLine("device->start starting");
    device->start(&player);
    logLine("device->start completed");
    uint64_t lastReported = std::numeric_limits<uint64_t>::max();
    bool endedReported = false;
    bool shutdownAckSent = false;

    while (! shutdownRequested.load(std::memory_order_acquire) && (! source.isDrained() || options.framedStdin))
    {
        const auto frames = source.getFramesPlayed();

        if (frames != lastReported)
        {
            writeJsonLine(
                std::string("{\"pos\":") + std::to_string(frames)
                + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
                + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
                + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
                + "}");
            lastReported = frames;
        }

        if (options.framedStdin)
        {
            if (source.isDrained())
            {
                if (! endedReported)
                {
                    writeJsonLine("{\"event\":\"ended\"}");
                    endedReported = true;
                }
            }
            else
            {
                endedReported = false;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }

    if (reader.joinable())
        reader.join();

    const auto finalFrames = source.getFramesPlayed();
    if (finalFrames != lastReported)
        writeJsonLine(
            std::string("{\"pos\":") + std::to_string(finalFrames)
            + ",\"bufferedFrames\":" + std::to_string(source.getReadyFrames())
            + ",\"underrunCallbacks\":" + std::to_string(source.getUnderrunCallbacks())
            + ",\"underrunFrames\":" + std::to_string(source.getUnderrunFrames())
            + "}");

    if (source.getUnderrunCallbacks() > 0)
    {
        logLine(
            "Output underruns: callbacks=" + std::to_string(source.getUnderrunCallbacks())
            + " frames=" + std::to_string(source.getUnderrunFrames()));
    }

    if (! options.framedStdin || ! endedReported)
        writeJsonLine("{\"event\":\"ended\"}");

    cleanupAudioDeviceAndAck(source, device, player, eqControlServer, shutdownAckSent);

    return 0;
}
} // namespace

#ifndef ECHO_AUDIO_HOST_TESTS
int main(int argc, char* argv[])
{
    Options options;

    try
    {
        juce::ScopedJuceInitialiser_GUI juceInitialiser;
        options = parseOptions(getCommandLineArgs(argc, argv));

        if (options.list)
        {
            return listDevices(options);
        }

        if (options.decodePcm)
        {
            return runJuceDecodePcm(options);
        }

        if (options.decodeServer)
        {
            return runJuceDecodeServer();
        }

        if (options.asioControlPanel)
        {
            return openAsioControlPanel(options);
        }

        return runHost(options);
    }
    catch (const std::exception& error)
    {
        logLine(error.what());
        if (! options.decodePcm && ! options.decodeServer)
            writeErrorEvent(error.what());
        return 1;
    }
}
#endif
