#include "src/null_output/NullModeRunner.h"

#include <algorithm>
#include <atomic>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/dsp/DspPipeline.h"
#include "src/ipc/JsonRpcServer.h"
#include "src/output/NullBackend.h"

using json = nlohmann::json;
namespace ead = echo_audio_daemon;

// ── Internal helpers ─────────────────────────────────────────────────────────

namespace {

/// Shared mutable state referenced by null-mode handlers.
struct NullState {
    std::shared_ptr<ead::NullBackend> backend{std::make_shared<ead::NullBackend>()};
    std::atomic<ead::PlaybackState> playbackState{ead::PlaybackState::Stopped};
    std::atomic<double> currentVolume{1.0};
    std::mutex backendMutex;
    std::shared_ptr<ead::DspPipeline> dsp{std::make_shared<ead::DspPipeline>()};
    std::mutex dspMutex;
};

// ── Core test handlers ────────────────────────────────────────────────────
void registerCoreHandlers(ead::JsonRpcServer& server, NullState& st) {
    server.registerMethod("test.echo", [](const json& params) -> json {
        return params;
    });

    server.registerMethod("test.play", [&st](const json& params) -> json {
        std::lock_guard<std::mutex> lock(st.backendMutex);

        int sampleRate = params.value("sampleRate", 44100);
        int channels   = params.value("channels", 2);
        int frames     = params.value("frames", sampleRate);

        if (!st.backend->isOpen()) {
            ead::DeviceInfo dev;
            dev.id   = "null";
            dev.name = "Null Output Device";
            if (!st.backend->open(dev, sampleRate, channels, 512)) {
                return json{{"error", "failed to open NullBackend"}};
            }
        }

        std::vector<float> dummy(static_cast<size_t>(frames) * static_cast<size_t>(channels), 0.0f);
        if (!st.backend->write(dummy.data(), frames)) {
            return json{{"error", "NullBackend write failed"}};
        }

        st.playbackState.store(ead::PlaybackState::Playing);

        json result = {
            {"status",        "playing"},
            {"framesWritten", st.backend->totalFramesWritten()},
            {"writeCount",    st.backend->writeCount()},
        };
        auto pathIt = params.find("path");
        if (pathIt != params.end()) {
            result["path"] = *pathIt;
        }
        return result;
    });

    server.registerMethod("test.getStatus", [&st](const json&) -> json {
        std::string stateStr;
        switch (st.playbackState.load()) {
            case ead::PlaybackState::Stopped: stateStr = "stopped"; break;
            case ead::PlaybackState::Playing: stateStr = "playing"; break;
            case ead::PlaybackState::Paused:  stateStr = "paused";  break;
            case ead::PlaybackState::Ended:   stateStr = "ended";   break;
            case ead::PlaybackState::Error:   stateStr = "error";   break;
        }
        return json{
            {"state",         stateStr},
            {"volume",        st.currentVolume.load()},
            {"framesWritten", st.backend->totalFramesWritten()},
            {"writeCount",    st.backend->writeCount()},
            {"isOpen",        st.backend->isOpen()},
        };
    });

    server.registerMethod("device.list", [](const json&) -> json {
        json device = {
            {"id",          "null"},
            {"name",        "Null Output Device"},
            {"outputMode",  "shared"},
            {"sampleRate",  0},
            {"channels",    2},
            {"isDefault",   true},
        };
        return json{{"devices", json::array({device})}};
    });
}

// ── Playback control + volume handlers ───────────────────────────────────
void registerPlaybackHandlers(ead::JsonRpcServer& server, NullState& st) {
    server.registerMethod("pause", [&st](const json&) -> json {
        st.playbackState.store(ead::PlaybackState::Paused);
        return json{{"status", "paused"}};
    });

    server.registerMethod("resume", [&st](const json&) -> json {
        st.playbackState.store(ead::PlaybackState::Playing);
        return json{{"status", "playing"}};
    });

    server.registerMethod("stop", [&st](const json&) -> json {
        st.playbackState.store(ead::PlaybackState::Stopped);
        return json{{"status", "stopped"}};
    });

    server.registerMethod("setVolume", [&st](const json& params) -> json {
        double vol = params.value("volume", 1.0);
        vol = std::max(0.0, std::min(1.0, vol));
        st.currentVolume.store(vol);
        return json{{"volume", vol}};
    });
}

// ── DSP handlers (EQ, convolution, channel balance) ──────────────────────
void registerDspHandlers(ead::JsonRpcServer& server, NullState& st) {
    server.registerMethod("eq.setBand", [&st](const json& params) -> json {
        int index           = params.value("index", 0);
        double gainDb       = params.value("gainDb", 0.0);
        double frequency    = params.value("frequency", 1000.0);
        double q            = params.value("q", 1.0);
        bool enabled        = params.value("enabled", true);
        std::string typeStr = params.value("type", "peaking");

        auto ft = ead::FilterType::Peaking;
        if (typeStr == "lowpass")        ft = ead::FilterType::LowPass;
        else if (typeStr == "highpass")  ft = ead::FilterType::HighPass;
        else if (typeStr == "lowshelf")  ft = ead::FilterType::LowShelf;
        else if (typeStr == "highshelf") ft = ead::FilterType::HighShelf;
        else if (typeStr == "bandpass")  ft = ead::FilterType::BandPass;
        else if (typeStr == "notch")     ft = ead::FilterType::Notch;
        else if (typeStr == "allpass")   ft = ead::FilterType::AllPass;

        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            st.dsp->eq().setBand(index, ft, frequency, gainDb, q, enabled);
        }
        return json{{"band", index}, {"gainDb", gainDb}, {"enabled", enabled}};
    });

    server.registerMethod("eq.setEnabled", [&st](const json& params) -> json {
        bool enabled = params.value("enabled", true);
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            st.dsp->eq().setEnabled(enabled);
        }
        return json{{"enabled", enabled}};
    });

    server.registerMethod("eq.reset", [&st](const json&) -> json {
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            st.dsp->eq().reset();
        }
        return json{{"reset", true}};
    });

    server.registerMethod("eq.setPreset", [&st](const json& params) -> json {
        auto bands = params.value("bands", json::array());
        int count = 0;
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            for (const auto& band : bands) {
                int idx  = band.value("index", count);
                double g = band.value("gainDb", 0.0);
                double f = band.value("frequency", 1000.0);
                double q = band.value("q", 1.0);
                bool en  = band.value("enabled", true);
                std::string t = band.value("type", "peaking");

                auto ft = ead::FilterType::Peaking;
                if (t == "lowpass")        ft = ead::FilterType::LowPass;
                else if (t == "highpass")  ft = ead::FilterType::HighPass;
                else if (t == "lowshelf")  ft = ead::FilterType::LowShelf;
                else if (t == "highshelf") ft = ead::FilterType::HighShelf;
                else if (t == "bandpass")  ft = ead::FilterType::BandPass;
                else if (t == "notch")     ft = ead::FilterType::Notch;
                else if (t == "allpass")   ft = ead::FilterType::AllPass;

                st.dsp->eq().setBand(idx, ft, f, g, q, en);
                ++count;
            }
        }
        return json{{"bandsApplied", count}};
    });

    server.registerMethod("convolution.loadIr", [&st](const json& params) -> json {
        std::string path = params.value("path", "");
        bool loaded;
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            loaded = st.dsp->conv().loadIr(path);
        }
        if (!loaded) {
            throw std::runtime_error("Failed to load IR file: " + path);
        }
        return json{{"loaded", true}};
    });

    server.registerMethod("convolution.setEnabled", [&st](const json& params) -> json {
        bool enabled = params.value("enabled", true);
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            st.dsp->conv().setEnabled(enabled);
        }
        return json{{"enabled", enabled}};
    });

    server.registerMethod("channelBalance.setState", [&st](const json& params) -> json {
        {
            std::lock_guard<std::mutex> lock(st.dspMutex);
            double balance   = params.value("balance", 0.0);
            double leftGain  = params.value("leftGainDb", 0.0);
            double rightGain = params.value("rightGainDb", 0.0);
            st.dsp->balance().setBalance(balance);
            st.dsp->balance().setChannelGain(0, leftGain);
            st.dsp->balance().setChannelGain(1, rightGain);
        }
        json out = {{"applied", true}};
        if (params.contains("balance"))      out["balance"] = params["balance"];
        if (params.contains("leftGainDb"))   out["leftGainDb"] = params["leftGainDb"];
        if (params.contains("rightGainDb"))  out["rightGainDb"] = params["rightGainDb"];
        return out;
    });
}

// ── Level-meter handlers (null-mode stubs) ───────────────────────────────
void registerLevelMeterHandlers(ead::JsonRpcServer& server) {
    server.registerMethod("levelMeter.subscribe", [](const json& params) -> json {
        return json{{"subscribed", true}};
    });

    server.registerMethod("levelMeter.unsubscribe", [](const json&) -> json {
        return json{{"subscribed", false}};
    });
}

} // anonymous namespace

// ── Public entry point ───────────────────────────────────────────────────────

int ead::runNullOutputMode() {
    std::cerr << "[echo-audio-daemon] null-output mode" << std::endl;

    ead::JsonRpcServer server;
    NullState st;

    registerCoreHandlers(server, st);
    registerPlaybackHandlers(server, st);
    registerDspHandlers(server, st);
    registerLevelMeterHandlers(server);

    server.start();
    return 0;
}
