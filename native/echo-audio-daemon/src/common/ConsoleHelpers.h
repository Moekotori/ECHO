#pragma once

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/common/AudioTypes.h"

namespace echo_audio_daemon {

// ── Helpers ──────────────────────────────────────────────────────────────────

inline std::string modeStr(OutputMode m) {
    switch (m) {
        case OutputMode::Shared:    return "shared";
        case OutputMode::Exclusive: return "exclusive";
        case OutputMode::Asio:      return "asio";
    }
    return "unknown";
}

inline nlohmann::json deviceJson(const DeviceInfo& d) {
    nlohmann::json j = {
        {"id",          d.id},
        {"name",        d.name},
        {"outputMode",  modeStr(d.outputMode)},
        {"sampleRate",  d.sampleRate},
        {"channels",    d.channels},
        {"isDefault",   d.isDefault},
    };
    if (d.outputMode == OutputMode::Shared)
        j["sharedSampleRate"] = d.sharedSampleRate;
    if (d.outputMode == OutputMode::Asio)
        j["asioOutputChannels"] = d.asioOutputChannels;
    return j;
}

inline nlohmann::json formatJson(const AudioFormat& f) {
    return nlohmann::json{
        {"format",     f.format},
        {"sampleRate", f.sampleRate},
        {"channels",   f.channels},
        {"duration",   f.duration},
        {"bitRate",    f.bitRate},
        {"codec",      f.codec},
        {"dsd",        f.isDsd},
    };
}

inline void usage(const char* prog) {
    std::cerr << "ECHO Audio Daemon — JSON-RPC 2.0 audio playback daemon\n"
              << "Usage: " << (prog ? prog : "echo-audio-daemon") << " [options]\n"
              << "Options:\n"
              << "  --null-output       Null backend for testing\n"
              << "  --device-id <id>    Output device ID\n"
              << "  --sample-rate <hz>  Sample rate (default: 44100)\n"
              << "  --channels <n>      Channel count (default: 2)\n"
              << "  --buffer <frames>   Buffer frames (default: 512)\n"
              << "  --help              Show this help\n";
}

// ── CLI Argument Parsing ──────────────────────────────────────────────────────
struct DaemonConfig {
    bool nullOutputMode = false;
    bool showHelp = false;
    std::string deviceId;
    int sampleRate = 44100;
    int channels = 2;
    int bufferFrames = 512;
};

inline DaemonConfig parseArgs(int argc, char* argv[]) {
    DaemonConfig cfg;
    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if (arg == "--null-output") {
            cfg.nullOutputMode = true;
        } else if (arg == "--help") {
            cfg.showHelp = true;
        } else if (arg == "--device-id" && i + 1 < argc) {
            cfg.deviceId = argv[++i];
        } else if (arg == "--sample-rate" && i + 1 < argc) {
            cfg.sampleRate = std::stoi(argv[++i]);
        } else if (arg == "--channels" && i + 1 < argc) {
            cfg.channels = std::stoi(argv[++i]);
        } else if (arg == "--buffer" && i + 1 < argc) {
            cfg.bufferFrames = std::stoi(argv[++i]);
        }
    }
    return cfg;
}

} // namespace echo_audio_daemon
