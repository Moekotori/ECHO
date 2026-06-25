#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/common/ConsoleHelpers.h"
#include "src/decoder/AvDecoder.h"
#include "src/device/DeviceEnumerator.h"
#include "src/dsp/DspPipeline.h"
#include "src/ipc/JsonRpcServer.h"
#include "src/null_output/NullModeRunner.h"
#include "src/output/MiniaudioBackend.h"
#include "src/session/SessionManager.h"

using json = nlohmann::json;
namespace ead = echo_audio_daemon;

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
            arr.push_back(ead::deviceJson(d));
        }
        return json{{"devices", std::move(arr)}};
    });

    server.registerMethod("probe", [](const json& params) -> json {
        std::string path = params.value("path", "");
        auto fmt = ead::AvDecoder::probe(path);
        return ead::formatJson(fmt);
    });

    server.registerMethod("echo.ping", [](const json&) -> json {
        return json{{"pong", true}};
    });

    // SessionManager registers its own handlers: play, pause, resume, stop,
    // seek, setVolume, queueNext, prepareAutomix, levelMeter.subscribe, etc.
    sessionManager.init();

    std::cerr << "[echo-audio-daemon] ready" << std::endl;
    server.sendEvent("event.ready", json::object());

    // Blocks until shutdown request is received.
    server.start();

    // Clean shutdown: stop playback, release resources.
    sessionManager.shutdown();
    std::cerr << "[echo-audio-daemon] shutdown complete" << std::endl;
    return 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    auto cfg = ead::parseArgs(argc, argv);

    if (cfg.showHelp) {
        ead::usage(argv[0]);
        return 0;
    }

    if (cfg.nullOutputMode) {
        return ead::runNullOutputMode();
    }

    return runDaemonMode();
}
