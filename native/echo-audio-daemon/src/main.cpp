#include <algorithm>
#include <atomic>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/ipc/JsonRpcServer.h"
#include "src/output/NullBackend.h"

using json = nlohmann::json;
namespace ead = echo_audio_daemon;

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

// ── Original Simple Mode ──────────────────────────────────────────────────────
// Basic stdin/stdout JSON-RPC loop without any backend. Used when no flags
// are passed (backward-compatible stub).
static int runSimpleMode() {
    std::cerr << "echo-audio-daemon ready" << std::endl;

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        try {
            auto request = json::parse(line);
            auto method  = request.value("method", "");

            if (method == "shutdown") {
                json response = {
                    {"jsonrpc", "2.0"},
                    {"id",      request.value("id", json())},
                    {"result",  {{"status", "shutting_down"}}},
                };
                std::cout << response.dump() << std::endl;
                break;
            }

            // Default: method not found
            json errorResp = {
                {"jsonrpc", "2.0"},
                {"id",      request.value("id", json())},
                {"error",   {{"code", -32601}, {"message", "Method not found"}}},
            };
            std::cout << errorResp.dump() << std::endl;

        } catch (const json::parse_error& e) {
            json errorResp = {
                {"jsonrpc", "2.0"},
                {"id",      nullptr},
                {"error",   {{"code", -32700}, {"message", "Parse error"}, {"data", e.what()}}},
            };
            std::cout << errorResp.dump() << std::endl;
        }
    }

    return 0;
}

int main(int argc, char* argv[]) {
    // Parse CLI arguments
    bool nullOutputMode = false;
    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if (arg == "--null-output") {
            nullOutputMode = true;
        }
    }

    if (nullOutputMode) {
        return runNullOutputMode();
    }

    return runSimpleMode();
}
