#include "DeviceWatcher.h"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

// ── Platform headers ──────────────────────────────────────────────────────
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys.h>
#include <wrl/client.h>
#endif

namespace echo_audio_daemon {

// ══════════════════════════════════════════════════════════════════════════
// Windows:  IMMNotificationClient COM object
// ══════════════════════════════════════════════════════════════════════════
#ifdef _WIN32

namespace {

/// Convert a COM wide-character string to UTF-8.
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

/// Minimal IMMNotificationClient implementation that forwards callbacks
/// to a DeviceWatcher::Callback.
class NotificationClient final : public IMMNotificationClient {
public:
    explicit NotificationClient(DeviceWatcher::Callback cb)
        : callback_(std::move(cb)) {}

    // ── IUnknown ───────────────────────────────────────────────────────
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown ||
            riid == __uuidof(IMMNotificationClient)) {
            *ppv = static_cast<IMMNotificationClient*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override {
        return InterlockedIncrement(&refCount_);
    }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG ref = InterlockedDecrement(&refCount_);
        if (ref == 0) {
            delete this;
            return 0;
        }
        return ref;
    }

    // ── IMMNotificationClient ──────────────────────────────────────────
    STDMETHODIMP OnDeviceAdded(LPCWSTR pwstrDeviceId) override {
        if (callback_) callback_("added", wideToUtf8(pwstrDeviceId));
        return S_OK;
    }

    STDMETHODIMP OnDeviceRemoved(LPCWSTR pwstrDeviceId) override {
        if (callback_) callback_("removed", wideToUtf8(pwstrDeviceId));
        return S_OK;
    }

    STDMETHODIMP OnDefaultDeviceChanged(EDataFlow flow, ERole role,
                                        LPCWSTR pwstrDefaultDeviceId) override {
        (void)flow;
        (void)role;
        if (callback_) {
            std::string id = pwstrDefaultDeviceId
                                 ? wideToUtf8(pwstrDefaultDeviceId)
                                 : "";
            callback_("default_changed", id);
        }
        return S_OK;
    }

    STDMETHODIMP OnDeviceStateChanged(LPCWSTR pwstrDeviceId,
                                      DWORD /*dwNewState*/) override {
        if (callback_) callback_("state_changed",
                                 wideToUtf8(pwstrDeviceId));
        return S_OK;
    }

    STDMETHODIMP OnPropertyValueChanged(LPCWSTR /*pwstrDeviceId*/,
                                        const PROPERTYKEY /*key*/) override {
        return S_OK;  // not forwarded
    }

private:
    LONG refCount_{1};
    DeviceWatcher::Callback callback_;
};

} // anonymous namespace

#endif // _WIN32

// ══════════════════════════════════════════════════════════════════════════
// Linux:  /proc/asound/cards polling helpers
// ══════════════════════════════════════════════════════════════════════════
#ifndef _WIN32

namespace {

/// Read /proc/asound/cards and return a set of "card<N>" identifiers.
static std::vector<std::string> readAlsaCards() {
    std::ifstream f("/proc/asound/cards");
    if (!f.is_open()) return {};

    std::vector<std::string> cards;
    std::string line;
    while (std::getline(f, line)) {
        // Lines look like: " 0 [PCH            ]: HDA-Intel ..."
        // Skip continuation lines (no leading digit).
        if (line.empty()) continue;
        if (line[0] != ' ') continue;              // skip empty / header
        if (line.size() < 2) continue;
        if (line[1] < '0' || line[1] > '9') continue;

        // Extract the card number from the beginning (e.g. " 0 ")
        std::string num;
        for (size_t i = 1; i < line.size(); ++i) {
            if (line[i] >= '0' && line[i] <= '9') {
                num += line[i];
            } else {
                break;
            }
        }
        if (!num.empty()) {
            cards.push_back("card" + num);
        }
    }
    return cards;
}

/// Serialise a vector of card IDs to a single string for diffing.
static std::string serializeCards(const std::vector<std::string>& cards) {
    std::ostringstream oss;
    for (const auto& c : cards) oss << c << '\n';
    return oss.str();
}

} // anonymous namespace

#endif // !_WIN32

// ══════════════════════════════════════════════════════════════════════════
// DeviceWatcher implementation
// ══════════════════════════════════════════════════════════════════════════

DeviceWatcher::~DeviceWatcher() {
    stop();
}

void DeviceWatcher::setCallback(Callback cb) {
    callback_ = std::move(cb);
}

bool DeviceWatcher::start() {
    if (running_.exchange(true)) return false;  // already running

    thread_ = std::thread(&DeviceWatcher::run, this);
    return true;
}

void DeviceWatcher::stop() {
    if (!running_.exchange(false)) return;
    if (thread_.joinable()) thread_.join();
}

bool DeviceWatcher::isRunning() const {
    return running_.load();
}

// ── Run loop (platform-specific) ──────────────────────────────────────────
void DeviceWatcher::run() {
#ifdef _WIN32
    // ── Windows: COM notification client ───────────────────────────────
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool ownsCom = SUCCEEDED(hr);
    bool canUseCom = ownsCom || (hr == RPC_E_CHANGED_MODE);

    if (canUseCom) {
        Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
        hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                              CLSCTX_ALL, IID_PPV_ARGS(&enumerator));

        if (SUCCEEDED(hr) && enumerator) {
            deviceEnumerator_ = enumerator.Get();
            enumerator->AddRef();  // keep a reference for the raw ptr

            // Create the notification client (ref-count starts at 1).
            auto* client = new NotificationClient(callback_);
            notifyClient_ = client;

            hr = enumerator->RegisterEndpointNotificationCallback(client);
            if (FAILED(hr)) {
                // Registration failed — clean up.
                client->Release();
                notifyClient_ = nullptr;
                static_cast<IMMDeviceEnumerator*>(deviceEnumerator_)->Release();
                deviceEnumerator_ = nullptr;
            }
        }
    }

    // Keep the thread alive until stop() signals.
    while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    // ── Cleanup ────────────────────────────────────────────────────────
    if (deviceEnumerator_ && notifyClient_) {
        auto* enumPtr = static_cast<IMMDeviceEnumerator*>(deviceEnumerator_);
        auto* client  = static_cast<IMMNotificationClient*>(notifyClient_);
        enumPtr->UnregisterEndpointNotificationCallback(client);
        client->Release();
        enumPtr->Release();
    }
    deviceEnumerator_ = nullptr;
    notifyClient_     = nullptr;

    if (ownsCom) CoUninitialize();

#else
    // ── Linux: poll /proc/asound/cards ─────────────────────────────────
    // Initial snapshot.
    auto prevCards = readAlsaCards();
    lastCardsState_ = serializeCards(prevCards);

    while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));

        auto currCards = readAlsaCards();
        auto currState = serializeCards(currCards);

        if (currState == lastCardsState_) continue;

        // Diff: detect removals (in prev but not in curr).
        for (const auto& card : prevCards) {
            bool found = false;
            for (const auto& c : currCards) {
                if (c == card) { found = true; break; }
            }
            if (!found && callback_) {
                callback_("removed", card);
            }
        }

        // Diff: detect additions (in curr but not in prev).
        for (const auto& card : currCards) {
            bool found = false;
            for (const auto& c : prevCards) {
                if (c == card) { found = true; break; }
            }
            if (!found && callback_) {
                callback_("added", card);
            }
        }

        lastCardsState_ = currState;
        prevCards = std::move(currCards);
    }
#endif
}

} // namespace echo_audio_daemon
