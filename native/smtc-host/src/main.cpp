#include <windows.h>
#include <shobjidl_core.h>
#include <SystemMediaTransportControlsInterop.h>

#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <cmath>
#include <mutex>
#include <queue>
#include <string>
#include <thread>

using namespace winrt;
using namespace Windows::Data::Json;
using namespace Windows::Foundation;
using namespace Windows::Media;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;

namespace
{
constexpr wchar_t windowClassName[] = L"EchoNextSmtcHostWindow";
constexpr UINT processInputMessage = WM_APP + 1;

TimeSpan secondsToTimeSpan(double seconds)
{
    const auto safeSeconds = std::max(0.0, seconds);
    return std::chrono::duration_cast<TimeSpan>(std::chrono::duration<double>(safeSeconds));
}

double timeSpanToSeconds(TimeSpan value)
{
    return std::max(0.0, std::chrono::duration<double>(value).count());
}

std::wstring widen(const std::string& value)
{
    if (value.empty())
    {
        return {};
    }

    const auto count = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (count <= 0)
    {
        return {};
    }

    std::wstring result(static_cast<size_t>(count), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), count);
    return result;
}

std::string escapeJson(const std::string& value)
{
    std::string escaped;
    escaped.reserve(value.size() + 8);

    for (const auto ch : value)
    {
        switch (ch)
        {
        case '\\':
            escaped += "\\\\";
            break;
        case '"':
            escaped += "\\\"";
            break;
        case '\b':
            escaped += "\\b";
            break;
        case '\f':
            escaped += "\\f";
            break;
        case '\n':
            escaped += "\\n";
            break;
        case '\r':
            escaped += "\\r";
            break;
        case '\t':
            escaped += "\\t";
            break;
        default:
            if (static_cast<unsigned char>(ch) < 0x20)
            {
                escaped += "\\u00";
                const char* hex = "0123456789abcdef";
                escaped += hex[(ch >> 4) & 0x0f];
                escaped += hex[ch & 0x0f];
            }
            else
            {
                escaped += ch;
            }
        }
    }

    return escaped;
}

std::string commandName(SystemMediaTransportControlsButton button)
{
    switch (button)
    {
    case SystemMediaTransportControlsButton::Play:
        return "play";
    case SystemMediaTransportControlsButton::Pause:
        return "pause";
    case SystemMediaTransportControlsButton::Previous:
        return "previous";
    case SystemMediaTransportControlsButton::Next:
        return "next";
    case SystemMediaTransportControlsButton::Stop:
        return "stop";
    default:
        return {};
    }
}

MediaPlaybackStatus playbackStatusFromString(const hstring& state)
{
    if (state == L"playing")
    {
        return MediaPlaybackStatus::Playing;
    }

    if (state == L"loading")
    {
        return MediaPlaybackStatus::Changing;
    }

    if (state == L"paused")
    {
        return MediaPlaybackStatus::Paused;
    }

    if (state == L"idle" || state == L"stopped" || state == L"ended" || state == L"error")
    {
        return MediaPlaybackStatus::Stopped;
    }

    return MediaPlaybackStatus::Closed;
}

class SmtcHost
{
public:
    HWND window = nullptr;

    void initialize(HWND hwnd)
    {
        window = hwnd;
        SetCurrentProcessExplicitAppUserModelID(L"app.echo.next");

        auto interop = get_activation_factory<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>();
        SystemMediaTransportControls nextControls{ nullptr };
        check_hresult(interop->GetForWindow(
            hwnd,
            guid_of<SystemMediaTransportControls>(),
            put_abi(nextControls)));

        controls = nextControls;
        buttonToken = controls.ButtonPressed({ this, &SmtcHost::onButtonPressed });
        playbackPositionToken = controls.PlaybackPositionChangeRequested({ this, &SmtcHost::onPlaybackPositionChangeRequested });
        controls.IsEnabled(true);
        controls.IsPlayEnabled(true);
        controls.IsPauseEnabled(true);
        controls.IsPreviousEnabled(true);
        controls.IsNextEnabled(true);
        controls.IsStopEnabled(true);
        controls.IsChannelUpEnabled(false);
        controls.IsChannelDownEnabled(false);
        controls.IsFastForwardEnabled(false);
        controls.IsRewindEnabled(false);
        controls.PlaybackStatus(MediaPlaybackStatus::Closed);
    }

    void enqueue(std::string line)
    {
        {
            std::lock_guard lock(inputMutex);
            inputQueue.push(std::move(line));
        }

        PostMessageW(window, processInputMessage, 0, 0);
    }

    void drainInput()
    {
        for (;;)
        {
            std::string line;
            {
                std::lock_guard lock(inputMutex);
                if (inputQueue.empty())
                {
                    return;
                }
                line = std::move(inputQueue.front());
                inputQueue.pop();
            }

            handleLine(line);
        }
    }

    void requestQuit()
    {
        if (window)
        {
            PostMessageW(window, WM_CLOSE, 0, 0);
        }
    }

    void dispose()
    {
        if (controls)
        {
            try
            {
                controls.PlaybackStatus(MediaPlaybackStatus::Closed);
                controls.IsEnabled(false);
                controls.ButtonPressed(buttonToken);
                controls.PlaybackPositionChangeRequested(playbackPositionToken);
            }
            catch (...)
            {
            }
        }

        controls = nullptr;
    }

private:
    SystemMediaTransportControls controls{ nullptr };
    event_token buttonToken{};
    event_token playbackPositionToken{};
    bool seekEnabled = true;
    std::mutex inputMutex;
    std::queue<std::string> inputQueue;
    std::mutex outputMutex;

    void emitCommand(const std::string& command)
    {
        if (command.empty())
        {
            return;
        }

        std::lock_guard lock(outputMutex);
        std::cout << "{\"type\":\"command\",\"command\":\"" << escapeJson(command) << "\"}" << std::endl;
    }

    void emitSeekCommand(double positionSeconds)
    {
        const auto safePositionSeconds = std::isfinite(positionSeconds) ? std::max(0.0, positionSeconds) : 0.0;
        std::lock_guard lock(outputMutex);
        std::cout << "{\"type\":\"command\",\"command\":\"seek\",\"positionSeconds\":" << safePositionSeconds << "}" << std::endl;
    }

    void emitError(const std::string& message)
    {
        std::lock_guard lock(outputMutex);
        std::cout << "{\"type\":\"error\",\"message\":\"" << escapeJson(message) << "\"}" << std::endl;
    }

    void onButtonPressed(
        SystemMediaTransportControls const&,
        SystemMediaTransportControlsButtonPressedEventArgs const& args)
    {
        emitCommand(commandName(args.Button()));
    }

    void onPlaybackPositionChangeRequested(
        SystemMediaTransportControls const&,
        PlaybackPositionChangeRequestedEventArgs const& args)
    {
        emitSeekCommand(timeSpanToSeconds(args.RequestedPlaybackPosition()));
    }

    hstring getString(JsonObject const& object, const wchar_t* name, const wchar_t* fallback = L"")
    {
        auto value = object.TryLookup(name);
        if (!value || value.ValueType() != JsonValueType::String)
        {
            return fallback;
        }

        return value.GetString();
    }

    bool getBool(JsonObject const& object, const wchar_t* name, bool fallback = false)
    {
        auto value = object.TryLookup(name);
        if (!value || value.ValueType() != JsonValueType::Boolean)
        {
            return fallback;
        }

        return value.GetBoolean();
    }

    double getNumber(JsonObject const& object, const wchar_t* name, double fallback = 0)
    {
        auto value = object.TryLookup(name);
        if (!value || value.ValueType() != JsonValueType::Number)
        {
            return fallback;
        }

        return value.GetNumber();
    }

    void handleLine(const std::string& line)
    {
        if (line.empty())
        {
            return;
        }

        try
        {
            auto object = JsonObject::Parse(hstring(widen(line)));
            const auto type = getString(object, L"type");

            if (type == L"setMetadata")
            {
                setMetadata(object);
            }
            else if (type == L"setPlaybackState")
            {
                controls.PlaybackStatus(playbackStatusFromString(getString(object, L"state")));
            }
            else if (type == L"setTimeline")
            {
                setTimeline(object);
            }
            else if (type == L"setEnabledActions")
            {
                setEnabledActions(object);
            }
            else if (type == L"clear")
            {
                clearDisplay();
            }
            else if (type == L"dispose")
            {
                dispose();
                requestQuit();
            }
            else if (type == L"shutdown" || getString(object, L"command") == L"shutdown")
            {
                dispose();
                requestQuit();
            }
        }
        catch (hresult_error const& error)
        {
            emitError(to_string(error.message()));
        }
        catch (std::exception const& error)
        {
            emitError(error.what());
        }
        catch (...)
        {
            emitError("Unknown SMTC host error");
        }
    }

    void setMetadata(JsonObject const& object)
    {
        auto updater = controls.DisplayUpdater();
        updater.Type(MediaPlaybackType::Music);
        updater.AppMediaId(L"ECHO Next");

        auto music = updater.MusicProperties();
        music.Title(getString(object, L"title", L"ECHO Next"));
        music.Artist(getString(object, L"artist"));
        music.AlbumTitle(getString(object, L"album"));
        music.AlbumArtist(getString(object, L"albumArtist"));

        const auto coverPath = getString(object, L"coverPath");
        if (!coverPath.empty())
        {
            try
            {
                auto file = StorageFile::GetFileFromPathAsync(coverPath).get();
                updater.Thumbnail(RandomAccessStreamReference::CreateFromFile(file));
            }
            catch (...)
            {
                updater.Thumbnail(nullptr);
            }
        }
        else
        {
            updater.Thumbnail(nullptr);
        }

        updater.Update();

        const auto durationSeconds = getNumber(object, L"durationSeconds");
        const auto positionSeconds = getNumber(object, L"positionSeconds");
        updateTimeline(positionSeconds, durationSeconds);
    }

    void setTimeline(JsonObject const& object)
    {
        updateTimeline(getNumber(object, L"positionSeconds"), getNumber(object, L"durationSeconds"));
    }

    void updateTimeline(double positionSeconds, double durationSeconds)
    {
        const auto safeDuration = std::max(0.0, durationSeconds);
        const auto safePosition = std::max(0.0, std::min(positionSeconds, safeDuration > 0 ? safeDuration : positionSeconds));
        const auto canSeek = seekEnabled && safeDuration > 0;

        SystemMediaTransportControlsTimelineProperties timeline;
        timeline.StartTime(secondsToTimeSpan(0));
        timeline.MinSeekTime(secondsToTimeSpan(canSeek ? 0 : safePosition));
        timeline.Position(secondsToTimeSpan(safePosition));
        timeline.EndTime(secondsToTimeSpan(safeDuration));
        timeline.MaxSeekTime(secondsToTimeSpan(canSeek ? safeDuration : safePosition));
        controls.UpdateTimelineProperties(timeline);
    }

    void setEnabledActions(JsonObject const& object)
    {
        controls.IsPlayEnabled(getBool(object, L"play", true));
        controls.IsPauseEnabled(getBool(object, L"pause", true));
        controls.IsPreviousEnabled(getBool(object, L"previous", true));
        controls.IsNextEnabled(getBool(object, L"next", true));
        controls.IsStopEnabled(true);
        controls.IsFastForwardEnabled(false);
        controls.IsRewindEnabled(false);
        seekEnabled = getBool(object, L"seek", true);
    }

    void clearDisplay()
    {
        auto updater = controls.DisplayUpdater();
        updater.ClearAll();
        updater.Update();
        controls.PlaybackStatus(MediaPlaybackStatus::Closed);
        updateTimeline(0, 0);
    }
};

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    auto host = reinterpret_cast<SmtcHost*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));

    if (message == WM_NCCREATE)
    {
        auto createStruct = reinterpret_cast<CREATESTRUCTW*>(lParam);
        host = static_cast<SmtcHost*>(createStruct->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host));
        return TRUE;
    }

    if (!host)
    {
        return DefWindowProcW(hwnd, message, wParam, lParam);
    }

    switch (message)
    {
    case processInputMessage:
        host->drainInput();
        return 0;
    case WM_CLOSE:
        host->dispose();
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(hwnd, message, wParam, lParam);
    }
}
}

int main()
{
    init_apartment(apartment_type::single_threaded);

    SmtcHost host;
    HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = windowProc;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = windowClassName;

    RegisterClassW(&windowClass);

    HWND hwnd = CreateWindowExW(
        WS_EX_TOOLWINDOW,
        windowClassName,
        L"ECHO Next SMTC Host",
        WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        nullptr,
        nullptr,
        instance,
        &host);

    if (!hwnd)
    {
        std::cerr << "[echo-smtc-host] failed to create hidden window" << std::endl;
        return 1;
    }

    try
    {
        host.initialize(hwnd);
    }
    catch (hresult_error const& error)
    {
        std::cerr << "[echo-smtc-host] " << to_string(error.message()) << std::endl;
        DestroyWindow(hwnd);
        return 1;
    }

    std::thread inputThread([&host]() {
        std::string line;
        while (std::getline(std::cin, line))
        {
            host.enqueue(std::move(line));
        }

        host.requestQuit();
    });

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0)
    {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    if (inputThread.joinable())
    {
        inputThread.join();
    }

    return 0;
}
