#include "../../audio-engine/JsonRpcProtocol.h"
#include "../../audio-engine/EqTypes.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "HostCommon.h"

namespace
{
void require(bool condition, const std::string& message)
{
    if (! condition)
        throw std::runtime_error(message);
}

void requireHasKey(const nlohmann::json& object, const char* key, const std::string& message)
{
    require(object.is_object(), message + " is not an object");
    require(object.contains(key), message + " missing key " + key);
}

struct ProtocolFixture
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    echo::ConvolutionProcessor convolution;
    echo::DspHeadroomProcessor headroom;
    echo::ReplayGainProcessor replayGain;
    echo::PlaybackRateProcessor playbackRate;
    echo::LevelMeterProcessor levelMeter;
    echo::EqPresetStore presets;
    int nextId = 1;

    ProtocolFixture()
    {
        eq.prepare(48000.0, 512, 2);
        channelBalance.prepare(48000.0, 512, 2);
        convolution.prepare(48000.0, 512, 2);
        headroom.prepare(48000.0, 512, 2);
        replayGain.prepare(48000.0, 512, 2);
        playbackRate.prepare(48000.0, 512, 2);
        levelMeter.prepare(48000.0, 512, 2);

        echo::JsonRpcProtocol::setOpenFileCallback(nullptr);
        echo::JsonRpcProtocol::setPauseCallback(nullptr);
        echo::JsonRpcProtocol::setSeekCallback(nullptr);
        echo::JsonRpcProtocol::setStopCallback(nullptr);
        echo::JsonRpcProtocol::setPrefetchCallback(nullptr);
        echo::JsonRpcProtocol::setVolumeCallback(nullptr);
        echo::JsonRpcProtocol::setWriteCallback(nullptr);
    }

    std::string raw(const nlohmann::json& request)
    {
        return echo::JsonRpcProtocol::handleJsonLine(
            request.dump(),
            eq,
            channelBalance,
            convolution,
            headroom,
            replayGain,
            playbackRate,
            levelMeter,
            presets);
    }

    nlohmann::json call(const std::string& method, const nlohmann::json& params = nlohmann::json())
    {
        nlohmann::json request;
        request["jsonrpc"] = "2.0";
        request["id"] = nextId++;
        request["method"] = method;
        if (! params.is_null())
            request["params"] = params;

        const auto responseText = raw(request);
        require(! responseText.empty(), method + " returned empty response");
        auto response = nlohmann::json::parse(responseText);
        require(response.value("jsonrpc", "") == "2.0", method + " response has JSON-RPC version");
        require(response.value("id", 0) == request["id"].get<int>(), method + " response echoes id");
        return response;
    }
};

nlohmann::json resultFor(ProtocolFixture& fixture, const std::string& method, const nlohmann::json& params = nlohmann::json())
{
    auto response = fixture.call(method, params);
    require(response.contains("result"), method + " expected result but got " + response.dump());
    return response["result"];
}

nlohmann::json errorFor(ProtocolFixture& fixture, const std::string& method, const nlohmann::json& params = nlohmann::json())
{
    auto response = fixture.call(method, params);
    require(response.contains("error"), method + " expected error but got " + response.dump());
    require(response["error"].contains("code"), method + " error has code");
    require(response["error"].contains("message"), method + " error has message");
    return response["error"];
}

void requireEqBandStructure(const nlohmann::json& band, const std::string& message)
{
    requireHasKey(band, "gainDb", message);
    requireHasKey(band, "frequencyHz", message);
    requireHasKey(band, "q", message);
    requireHasKey(band, "filterType", message);
    requireHasKey(band, "enabled", message);
    require(band["gainDb"].is_number(), message + " gainDb is numeric");
    require(band["frequencyHz"].is_number(), message + " frequencyHz is numeric");
    require(band["q"].is_number(), message + " q is numeric");
    require(band["filterType"].is_string(), message + " filterType is string");
    require(band["enabled"].is_boolean(), message + " enabled is boolean");
}

void requireFullEqState(const nlohmann::json& state, const std::string& method)
{
    requireHasKey(state, "enabled", method);
    requireHasKey(state, "preampDb", method);
    requireHasKey(state, "dspHeadroomDb", method);
    requireHasKey(state, "dspSafetyLimiterEnabled", method);
    requireHasKey(state, "presetId", method);
    requireHasKey(state, "presetName", method);
    requireHasKey(state, "clippingRisk", method);
    requireHasKey(state, "bands", method);
    require(state["bands"].is_array(), method + " bands is array");
    require(state["bands"].size() == static_cast<size_t>(echo::eqBandCount), method + " has 31 EQ bands");
    for (size_t i = 0; i < state["bands"].size(); ++i)
        requireEqBandStructure(state["bands"][i], method + " band " + std::to_string(i));
}

nlohmann::json makeFullEqStateParams()
{
    nlohmann::json bands = nlohmann::json::array();
    for (int i = 0; i < echo::eqBandCount; ++i)
    {
        nlohmann::json band;
        band["frequencyHz"] = echo::eqFrequenciesHz[static_cast<size_t>(i)];
        band["gainDb"] = (i == 2) ? 1.5 : 0.0;
        band["q"] = 1.0;
        band["filterType"] = (i == 0) ? "lowShelf" : "peaking";
        band["enabled"] = i != 3;
        bands.push_back(band);
    }
    return nlohmann::json::array({ nlohmann::json::object({ {"enabled", true}, {"preampDb", -1.25}, {"bands", bands} }) });
}

void requireChannelBalanceState(const nlohmann::json& state, const std::string& method)
{
    for (const auto* key : { "enabled", "balance", "leftGainDb", "rightGainDb", "bandGains", "leftDelayMs", "rightDelayMs", "swapLeftRight", "monoMode", "invertLeft", "invertRight", "constantPower", "clippingRisk" })
        requireHasKey(state, key, method);
    for (const auto* band : { "low", "mid", "high" })
    {
        requireHasKey(state["bandGains"], band, method);
        requireHasKey(state["bandGains"][band], "leftGainDb", method);
        requireHasKey(state["bandGains"][band], "rightGainDb", method);
    }
}

void requireRoomCorrectionState(const nlohmann::json& state, const std::string& method)
{
    for (const auto* key : { "enabled", "status", "irId", "irName", "channelMode", "sampleRate", "tapCount", "trimDb", "latencySamples", "clippingRisk", "error" })
        requireHasKey(state, key, method);
}

void testNoIdNotificationsReturnEmpty()
{
    ProtocolFixture fixture;
    for (const auto& method : { "rpc.ready", "rpc.shuttingDown", "unknown.method" })
    {
        nlohmann::json notification;
        notification["jsonrpc"] = "2.0";
        notification["method"] = method;
        require(fixture.raw(notification).empty(), std::string(method) + " no-id notification returns empty");
    }
}

void testOutboundNotificationHasNoId()
{
    const auto text = echo::JsonRpcProtocol::createJsonRpcNotification(
        "audio.position",
        nlohmann::json::object({ {"framesPlayed", 128}, {"bufferedFrames", 256}, {"inputEnded", false} }));
    const auto notification = nlohmann::json::parse(text);
    require(notification.value("jsonrpc", "") == "2.0", "notification has jsonrpc version");
    require(notification.value("method", "") == "audio.position", "notification has method");
    require(notification.contains("params"), "notification has params");
    require(notification["params"].value("framesPlayed", 0) == 128, "audio.position freezes framesPlayed field");
    require(notification["params"].value("bufferedFrames", 0) == 256, "audio.position freezes bufferedFrames field");
    require(notification["params"].value("inputEnded", true) == false, "audio.position freezes inputEnded field");
    require(! notification.contains("id"), "notification has no id field");
}

void testJsonRpcPlaybackMethodNamesStayStable()
{
    ProtocolFixture fixture;

    const std::vector<std::string> controlMethods {
        "audio.openFile",
        "audio.play",
        "audio.pause",
        "audio.resume",
        "audio.seek",
        "audio.stop",
        "audio.prefetch",
        "audio.setVolume",
        "rpc.ping",
        "rpc.shutdown",
    };

    for (const auto& method : controlMethods)
    {
        auto response = fixture.call(method);
        require(response.contains("result") || response.contains("error"), method + " dispatches through JSON-RPC method table");
        if (response.contains("error"))
            require(response["error"].value("code", 0) != -32601, method + " is registered, not method-not-found");
    }
}

void testEqMethodsReturnDocumentedStateShapes()
{
    ProtocolFixture fixture;
    const std::vector<std::pair<std::string, nlohmann::json>> methods {
        { "eq.getState", nlohmann::json() },
        { "eq.setEnabled", nlohmann::json::array({ true }) },
        { "eq.setBandGain", nlohmann::json::array({ nlohmann::json::object({ {"band", 3}, {"gainDb", 4.5} }) }) },
        { "eq.setBandFrequency", nlohmann::json::array({ nlohmann::json::object({ {"band", 3}, {"frequencyHz", 360.0} }) }) },
        { "eq.setBandQ", nlohmann::json::array({ nlohmann::json::object({ {"band", 3}, {"q", 3.5} }) }) },
        { "eq.setBandFilterType", nlohmann::json::array({ nlohmann::json::object({ {"band", 3}, {"filterType", "notch"} }) }) },
        { "eq.setBandEnabled", nlohmann::json::array({ nlohmann::json::object({ {"band", 3}, {"enabled", false} }) }) },
        { "eq.setPreamp", nlohmann::json::array({ -2.0 }) },
        { "eq.setPreset", nlohmann::json::array({ "flat" }) },
        { "eq.reset", nlohmann::json() },
        { "eq.setState", makeFullEqStateParams() },
    };

    for (const auto& method : methods)
        requireFullEqState(resultFor(fixture, method.first, method.second), method.first);

    const auto sync = resultFor(fixture, "eq.syncState");
    requireHasKey(sync, "enabled", "eq.syncState");
    requireHasKey(sync, "preampDb", "eq.syncState");
    require(! sync.contains("bands"), "eq.syncState is intentionally compact");
}

void testDspAndPlaybackControlMethodShapes()
{
    ProtocolFixture fixture;

    auto dsp = resultFor(fixture, "dsp.getState");
    requireHasKey(dsp, "headroomDb", "dsp.getState");
    requireHasKey(dsp, "safetyLimiterEnabled", "dsp.getState");
    dsp = resultFor(fixture, "dsp.setHeadroom", nlohmann::json::array({ -6.0 }));
    require(dsp["headroomDb"].is_number(), "dsp.setHeadroom returns headroom");
    dsp = resultFor(fixture, "dsp.setSafetyLimiter", nlohmann::json::array({ true }));
    require(dsp["safetyLimiterEnabled"].is_boolean(), "dsp.setSafetyLimiter returns limiter flag");

    require(resultFor(fixture, "playbackRate.setRate", nlohmann::json::array({ 1.25 })).value("rate", 0.0f) > 1.0f, "playbackRate.setRate returns rate");
    require(resultFor(fixture, "playbackRate.setMode", nlohmann::json::array({ "speed" })).value("mode", "") == "speed", "playbackRate.setMode returns mode");
    require(resultFor(fixture, "levelMeter.setInterval", nlohmann::json::array({ 750 })).value("intervalMs", 0) == 750, "levelMeter.setInterval returns interval");
}

void testChannelBalanceRoomCorrectionReplayGainAndPresets()
{
    ProtocolFixture fixture;
    requireChannelBalanceState(resultFor(fixture, "channelBalance.getState"), "channelBalance.getState");
    requireChannelBalanceState(resultFor(fixture, "channelBalance.setState", nlohmann::json::array({ nlohmann::json::object({ {"enabled", true}, {"balance", 0.25}, {"monoMode", "sum"} }) })), "channelBalance.setState");
    requireChannelBalanceState(resultFor(fixture, "channelBalance.reset"), "channelBalance.reset");

    requireRoomCorrectionState(resultFor(fixture, "roomCorrection.getState"), "roomCorrection.getState");
    const auto missingIr = resultFor(fixture, "roomCorrection.loadIr", nlohmann::json::array({ nlohmann::json::object({ {"path", "/definitely/missing/echo-ir.wav"}, {"irId", "missing"}, {"irName", "Missing"} }) }));
    requireRoomCorrectionState(missingIr, "roomCorrection.loadIr missing-file state");
    require(missingIr.value("status", "") == "error", "roomCorrection.loadIr missing file returns error state");
    require(resultFor(fixture, "roomCorrection.setEnabled", nlohmann::json::array({ true })).contains("enabled"), "roomCorrection.setEnabled returns state");
    require(resultFor(fixture, "roomCorrection.setTrim", nlohmann::json::array({ -3.0 })).contains("trimDb"), "roomCorrection.setTrim returns state");
    requireRoomCorrectionState(resultFor(fixture, "roomCorrection.clear"), "roomCorrection.clear");

    auto rg = resultFor(fixture, "replayGain.getConfig");
    for (const auto* key : { "trackGainDb", "albumGainDb", "peak", "mode", "preampDb", "preventClipping", "appliedGainDb", "active" })
        requireHasKey(rg, key, "replayGain.getConfig");
    rg = resultFor(fixture, "replayGain.setConfig", nlohmann::json::array({ nlohmann::json::object({ {"trackGainDb", -4.0}, {"albumGainDb", -3.0}, {"peak", 0.8}, {"mode", 1}, {"preampDb", 1.0}, {"preventClipping", true} }) }));
    require(rg.value("mode", 0) == 1, "replayGain.setConfig echoes mode");

    const auto presets = resultFor(fixture, "preset.list");
    require(presets.is_array() && ! presets.empty(), "preset.list returns built-in preset array");
    requireFullEqState(nlohmann::json::object({ {"enabled", true}, {"preampDb", 0}, {"dspHeadroomDb", 0}, {"dspSafetyLimiterEnabled", true}, {"presetId", "probe"}, {"presetName", "probe"}, {"clippingRisk", false}, {"bands", presets[0]["bands"]} }), "preset.list first preset bands");
    require(errorFor(fixture, "preset.save", nlohmann::json::array({ nlohmann::json::object({ {"id", "custom"}, {"name", "Custom"}, {"preampDb", 0.0} }) })).value("message", "") == "Invalid preset data", "preset.save current validation shape");
    require(resultFor(fixture, "preset.delete", nlohmann::json::array({ "flat" })).is_array(), "preset.delete returns preset list unchanged");
}

void testProfileStubsAndLifecycle()
{
    ProtocolFixture fixture;
    require(resultFor(fixture, "profile.list").empty(), "profile.list returns []");
    const auto saveParams = nlohmann::json::array({ nlohmann::json::object({ {"id", "p1"}, {"name", "Profile"} }) });
    require(resultFor(fixture, "profile.save", saveParams) == saveParams, "profile.save echoes params");
    require(resultFor(fixture, "profile.apply", nlohmann::json::array({ "p1" })).empty(), "profile.apply returns {}");
    require(resultFor(fixture, "profile.delete", nlohmann::json::array({ "p1" })).empty(), "profile.delete returns []");
    const auto bind = resultFor(fixture, "profile.bind", nlohmann::json::object({ {"deviceId", "dac"} }));
    require(bind.value("profileId", "not-empty").empty(), "profile.bind returns empty profileId");
    require(bind["target"] == nlohmann::json::object({ {"deviceId", "dac"} }), "profile.bind echoes target");
    require(resultFor(fixture, "profile.getBinding", nlohmann::json::object()).is_null(), "profile.getBinding returns null");
    require(resultFor(fixture, "profile.applyBound", nlohmann::json::object()).empty(), "profile.applyBound returns {}");

    require(resultFor(fixture, "rpc.ping") == "pong", "rpc.ping returns pong");
    require(resultFor(fixture, "rpc.shutdown") == "ok", "rpc.shutdown returns ok");
}

void testAudioPlaybackControlWithoutCallbacks()
{
    ProtocolFixture fixture;
    require(errorFor(fixture, "audio.openFile", nlohmann::json::array({ nlohmann::json::object({ {"filePath", "/definitely/missing/song.flac"}, {"sampleRate", 48000} }) })).contains("message"), "audio.openFile without callback falls back to probe error");
    require(resultFor(fixture, "audio.play") == true, "audio.play without callback currently returns true");
    require(resultFor(fixture, "audio.pause") == true, "audio.pause without callback currently returns true");
    require(resultFor(fixture, "audio.resume") == true, "audio.resume without callback currently returns true");
    require(errorFor(fixture, "audio.seek", nlohmann::json::array({ nlohmann::json::object({ {"positionSeconds", 12.0} }) })).value("message", "") == "seek failed", "audio.seek requires callback");
    require(resultFor(fixture, "audio.stop") == true, "audio.stop without callback currently returns true");
    require(errorFor(fixture, "audio.prefetch", nlohmann::json::array({ nlohmann::json::object({ {"filePath", "/tmp/song.flac"}, {"sampleRate", 48000} }) })).value("message", "") == "prefetch failed", "audio.prefetch requires callback");
    const auto clampedVolume = resultFor(fixture, "audio.setVolume", nlohmann::json::array({ nlohmann::json::object({ {"volume", 2.0} }) })).value("volume", -1.0f);
    require(std::abs(clampedVolume - 1.0f) <= 0.0f, "audio.setVolume clamps and returns volume without callback");
}

void testRawStdinEofLifecycleDrainsSource()
{
    echo::EqProcessor eq;
    echo::ChannelBalanceProcessor channelBalance;
    PcmRingAudioSource source(2, 32, 0, 0, 1.0f, eq, channelBalance);
    source.beginSession();
    source.prepareForNativeRender(16, 48000.0);
    require(! source.isDrained(), "raw stdin source is not drained before EOF");
    source.markInputEnded();
    require(source.isDrained(), "raw stdin EOF markInputEnded lets main loop observe isDrained");
}

}

int main()
{
    const std::vector<std::pair<std::string, void (*)()>> tests {
        { "no-id notifications return empty", testNoIdNotificationsReturnEmpty },
        { "outbound notifications omit id", testOutboundNotificationHasNoId },
        { "JSON-RPC playback method names stay stable", testJsonRpcPlaybackMethodNamesStayStable },
        { "EQ methods return documented state shapes", testEqMethodsReturnDocumentedStateShapes },
        { "DSP and playback-rate method shapes", testDspAndPlaybackControlMethodShapes },
        { "channel balance room correction replay gain presets", testChannelBalanceRoomCorrectionReplayGainAndPresets },
        { "profile stubs and lifecycle", testProfileStubsAndLifecycle },
        { "audio playback control without callbacks", testAudioPlaybackControlWithoutCallbacks },
        { "raw stdin EOF lifecycle drains source", testRawStdinEofLifecycleDrainsSource },
    };

    try
    {
        for (const auto& test : tests)
        {
            test.second();
            std::cout << "[jsonrpc-protocol-characterization] PASS " << test.first << '\n';
        }
    }
    catch (const std::exception& error)
    {
        std::cerr << "[jsonrpc-protocol-characterization] FAIL " << error.what() << '\n';
        return 1;
    }

    return 0;
}
