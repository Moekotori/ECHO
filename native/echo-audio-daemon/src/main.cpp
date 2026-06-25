#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/ipc/JsonRpcServer.h"
#include "src/decoder/AvDecoder.h"
#include "src/dsp/DspPipeline.h"
#include "src/output/OutputDevice.h"
#include "src/output/NullBackend.h"
#include "src/output/MiniaudioBackend.h"
#include "src/device/DeviceEnumerator.h"
#include "src/session/SessionManager.h"

using json = nlohmann::json;
namespace ead = echo_audio_daemon;

// ── Helpers ──────────────────────────────────────────────────────────────────

static std::string modeStr(ead::OutputMode m) {
    switch (m) {
        case ead::OutputMode::Shared:    return "shared";
        case ead::OutputMode::Exclusive: return "exclusive";
        case ead::OutputMode::Asio:      return "asio";
    }
    return "unknown";
}

static json deviceJson(const ead::DeviceInfo& d) {
    json j = {
        {"id",          d.id},
        {"name",        d.name},
        {"outputMode",  modeStr(d.outputMode)},
        {"sampleRate",  d.sampleRate},
        {"channels",    d.channels},
        {"isDefault",   d.isDefault},
    };
    if (d.outputMode == ead::OutputMode::Shared)
        j["sharedSampleRate"] = d.sharedSampleRate;
    if (d.outputMode == ead::OutputMode::Asio)
        j["asioOutputChannels"] = d.asioOutputChannels;
    return j;
}

static json formatJson(const ead::AudioFormat& f) {
    return json{
        {"format",     f.format},
        {"sampleRate", f.sampleRate},
        {"channels",   f.channels},
        {"duration",   f.duration},
        {"bitRate",    f.bitRate},
        {"codec",      f.codec},
        {"dsd",        f.isDsd},
    };
}

static void usage(const char* prog) {
    std::cerr << "ECHO Audio Daemon \u2014 JSON-RPC 2.0 audio playback daemon\n"
              << "Usage: " << (prog ? prog : "echo-audio-daemon") << " [options]\n"
              << "Options:\n"
              << "  --null-output       Null backend for testing\n"
              << "  --device-id <id>    Output device ID\n"
              << "  --sample-rate <hz>  Sample rate (default: 44100)\n"
              << "  --channels <n>      Channel count (default: 2)\n"
              << "  --buffer <frames>   Buffer frames (default: 512)\n"
              << "  --help              Show this help\n";
}

// ── Null-Output Mode ─────────────────────────────────────────────────────────
// Runs JsonRpcServer with NullBackend handlers for testing without real audio
// hardware or FFmpeg dependencies.
static int runNullOutputMode() {
    std::cerr << "[echo-audio-daemon] null-output mode" << std::endl;

    auto backend = std::make_shared<ead::NullBackend>();
    ead::JsonRpcServer server;

    // Shared state (accessed from handler lambdas and read loop)
    std::atomic<ead::PlaybackState> playbackState{ead::PlaybackState::Stopped};
    std::atomic<double> currentVolume{1.0};
    std::mutex backendMutex;

    // ── test.echo ──────────────────────────────────────────────────────────
    server.registerMethod("test.echo", [](const json& params) -> json {
        return params;
    });

    // ── test.play ──────────────────────────────────────────────────────────
    // Opens NullBackend (if not open) and writes a buffer of dummy samples.
    server.registerMethod("test.play", [backend, &playbackState, &backendMutex](const json& params) -> json {
        std::lock_guard<std::mutex> lock(backendMutex);

        int sampleRate = params.value("sampleRate", 44100);
        int channels   = params.value("channels", 2);
        int frames     = params.value("frames", sampleRate); // default: 1 second

        if (!backend->isOpen()) {
            ead::DeviceInfo dev;
            dev.id   = "null";
            dev.name = "Null Output Device";
            if (!backend->open(dev, sampleRate, channels, 512)) {
                return json{{"error", "failed to open NullBackend"}};
            }
        }

        // Write dummy silence
        std::vector<float> dummy(static_cast<size_t>(frames) * static_cast<size_t>(channels), 0.0f);
        if (!backend->write(dummy.data(), frames)) {
            return json{{"error", "NullBackend write failed"}};
        }

        playbackState.store(ead::PlaybackState::Playing);

        json result = {
            {"status",        "playing"},
            {"framesWritten", backend->totalFramesWritten()},
            {"writeCount",    backend->writeCount()},
        };
        auto pathIt = params.find("path");
        if (pathIt != params.end()) {
            result["path"] = *pathIt;
        }
        return result;
    });

    // ── test.getStatus ─────────────────────────────────────────────────────
    server.registerMethod("test.getStatus", [backend, &playbackState, &currentVolume](const json&) -> json {
        std::string stateStr;
        switch (playbackState.load()) {
            case ead::PlaybackState::Stopped: stateStr = "stopped"; break;
            case ead::PlaybackState::Playing: stateStr = "playing"; break;
            case ead::PlaybackState::Paused:  stateStr = "paused";  break;
            case ead::PlaybackState::Ended:   stateStr = "ended";   break;
            case ead::PlaybackState::Error:   stateStr = "error";   break;
        }
        return json{
            {"state",         stateStr},
            {"volume",        currentVolume.load()},
            {"framesWritten", backend->totalFramesWritten()},
            {"writeCount",    backend->writeCount()},
            {"isOpen",        backend->isOpen()},
        };
    });

    // ── device.list ────────────────────────────────────────────────────────
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

    // ── Playback control ───────────────────────────────────────────────────
    server.registerMethod("pause", [&playbackState](const json&) -> json {
        playbackState.store(ead::PlaybackState::Paused);
        return json{{"status", "paused"}};
    });

    server.registerMethod("resume", [&playbackState](const json&) -> json {
        playbackState.store(ead::PlaybackState::Playing);
        return json{{"status", "playing"}};
    });

    server.registerMethod("stop", [&playbackState](const json&) -> json {
        playbackState.store(ead::PlaybackState::Stopped);
        return json{{"status", "stopped"}};
    });

    // ── setVolume ──────────────────────────────────────────────────────────
    server.registerMethod("setVolume", [&currentVolume](const json& params) -> json {
        double vol = params.value("volume", 1.0);
        vol = std::max(0.0, std::min(1.0, vol)); // clamp [0, 1]
        currentVolume.store(vol);
        return json{{"volume", vol}};
    });

    // ── Run ────────────────────────────────────────────────────────────────
    server.start();
    return 0;
}

// ── Normal Daemon Mode ───────────────────────────────────────────────────────
// Full daemon: wires JsonRpcServer + AvDecoder + DspPipeline + OutputDevice
// + SessionManager for real audio playback.
static int runDaemonMode() {
    ead::JsonRpcServer server;
    ead::AvDecoder decoder;
    ead::DspPipeline dsp;
    ead::MiniaudioBackend output;

    ead::SessionManager sessionManager(server, decoder, dsp, output);

    // ── Register handlers NOT in SessionManager ────────────────────────────
    server.registerMethod("device.list", [](const json&) -> json {
        auto devices = ead::DeviceEnumerator::enumerateAll();
        json arr = json::array();
        for (const auto& d : devices) {
            arr.push_back(deviceJson(d));
        }
        return json{{"devices", std::move(arr)}};
    });

    server.registerMethod("probe", [](const json& params) -> json {
        std::string path = params.value("path", "");
        auto fmt = ead::AvDecoder::probe(path);
        return formatJson(fmt);
    });

    server.registerMethod("echo.ping", [](const json&) -> json {
        return json{{"pong", true}};
    });

    // SessionManager registers its own handlers: play, pause, resume, stop,
    // seek, setVolume, queueNext, prepareAutomix, levelMeter.subscribe, etc.
    sessionManager.init();

    std::cerr << "[echo-audio-daemon] ready" << std::endl;

    // Blocks until shutdown request is received.
    server.start();

    // Clean shutdown: stop playback, release resources.
    sessionManager.shutdown();
    std::cerr << "[echo-audio-daemon] shutdown complete" << std::endl;
    return 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    bool nullOutputMode = false;
    bool showHelp = false;
    std::string deviceId;      // accepted; consumed by SessionManager internally
    int sampleRate = 44100;    // accepted; consumed by SessionManager internally
    int channels = 2;          // accepted; consumed by SessionManager internally
    int bufferFrames = 512;    // accepted; consumed by SessionManager internally

    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if (arg == "--null-output") {
            nullOutputMode = true;
        } else if (arg == "--help") {
            showHelp = true;
        } else if (arg == "--device-id" && i + 1 < argc) {
            deviceId = argv[++i];
        } else if (arg == "--sample-rate" && i + 1 < argc) {
            sampleRate = std::stoi(argv[++i]);
        } else if (arg == "--channels" && i + 1 < argc) {
            channels = std::stoi(argv[++i]);
        } else if (arg == "--buffer" && i + 1 < argc) {
            bufferFrames = std::stoi(argv[++i]);
        }
    }

    if (showHelp) {
        usage(argv[0]);
        return 0;
    }

    if (nullOutputMode) {
        return runNullOutputMode();
    }

    return runDaemonMode();
}
