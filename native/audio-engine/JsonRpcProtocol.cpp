#include "JsonRpcProtocol.h"
#include "DspSafetyLimiter.h"
#include "EqTypes.h"
#include "libav_decoder.h"

#include <algorithm>
#include <cmath>

namespace echo
{
namespace
{
float getNumber(const nlohmann::json& obj, const char* key, float fallback)
{
    const auto value = obj.value(key, nlohmann::json());
    return value.is_number() ? value.get<float>() : fallback;
}

bool getBool(const nlohmann::json& obj, const char* key, bool fallback)
{
    const auto value = obj.value(key, nlohmann::json());
    return value.is_boolean() ? value.get<bool>() : fallback;
}

int getInt(const nlohmann::json& obj, const char* key, int fallback)
{
    const auto value = obj.value(key, nlohmann::json());
    return value.is_number() ? value.get<int>() : fallback;
}

std::string getString(const nlohmann::json& obj, const char* key)
{
    const auto value = obj.value(key, nlohmann::json());
    return value.is_string() ? value.get<std::string>() : std::string();
}

double normalizeStartSeconds(double requestedStartSeconds, double durationSeconds)
{
    if (requestedStartSeconds < 0.0)
        return 0.0;
    if (durationSeconds > 0.0 && requestedStartSeconds >= durationSeconds)
        return std::max(0.0, durationSeconds - 0.250);
    return requestedStartSeconds;
}

EqFilterType parseEqFilterType(const std::string& value, EqFilterType fallback)
{
    if (value == "lowShelf")  return EqFilterType::LowShelf;
    if (value == "highShelf") return EqFilterType::HighShelf;
    if (value == "lowPass")   return EqFilterType::LowPass;
    if (value == "highPass")  return EqFilterType::HighPass;
    if (value == "notch")     return EqFilterType::Notch;
    if (value == "peaking")   return EqFilterType::Peaking;
    return fallback;
}

bool isEqFilterTypeText(const std::string& value)
{
    return value == "peaking" || value == "lowShelf" || value == "highShelf"
        || value == "lowPass" || value == "highPass" || value == "notch";
}

std::string eqFilterTypeText(EqFilterType value)
{
    switch (value)
    {
        case EqFilterType::LowShelf:  return "lowShelf";
        case EqFilterType::HighShelf: return "highShelf";
        case EqFilterType::LowPass:   return "lowPass";
        case EqFilterType::HighPass:  return "highPass";
        case EqFilterType::Notch:     return "notch";
        case EqFilterType::Peaking:
        default:                      return "peaking";
    }
}

ChannelBalanceMonoMode parseMonoMode(const std::string& value, ChannelBalanceMonoMode fallback)
{
    if (value == "sum")   return ChannelBalanceMonoMode::SumToMono;
    if (value == "left")  return ChannelBalanceMonoMode::LeftOnly;
    if (value == "right") return ChannelBalanceMonoMode::RightOnly;
    if (value == "off")   return ChannelBalanceMonoMode::Off;
    return fallback;
}

std::string monoModeText(ChannelBalanceMonoMode mode)
{
    switch (mode)
    {
        case ChannelBalanceMonoMode::SumToMono: return "sum";
        case ChannelBalanceMonoMode::LeftOnly:  return "left";
        case ChannelBalanceMonoMode::RightOnly: return "right";
        case ChannelBalanceMonoMode::Off:
        default:                                return "off";
    }
}

float readBandGainDb(const nlohmann::json* bandsObject, const char* bandId, const char* sideKey, float fallback)
{
    if (bandsObject == nullptr)
        return fallback;

    auto bandIt = bandsObject->find(bandId);
    if (bandIt == bandsObject->end() || !bandIt->is_object())
        return fallback;

    return clampChannelBandGainDb(getNumber(*bandIt, sideKey, fallback));
}

ChannelBalanceState readChannelBalanceState(const nlohmann::json& obj, const ChannelBalanceState& fallback)
{
    ChannelBalanceState state = fallback;
    state.enabled = getBool(obj, "enabled", state.enabled);
    state.balance = clampChannelBalance(getNumber(obj, "balance", state.balance));
    state.leftGainDb = clampChannelGainDb(getNumber(obj, "leftGainDb", state.leftGainDb));
    state.rightGainDb = clampChannelGainDb(getNumber(obj, "rightGainDb", state.rightGainDb));

    auto bandsIt = obj.find("bandGains");
    const nlohmann::json* bandsObject = nullptr;
    if (bandsIt != obj.end() && bandsIt->is_object())
        bandsObject = &(*bandsIt);

    state.leftBandGainsDb[0] = readBandGainDb(bandsObject, "low", "leftGainDb", state.leftBandGainsDb[0]);
    state.rightBandGainsDb[0] = readBandGainDb(bandsObject, "low", "rightGainDb", state.rightBandGainsDb[0]);
    state.leftBandGainsDb[1] = readBandGainDb(bandsObject, "mid", "leftGainDb", state.leftBandGainsDb[1]);
    state.rightBandGainsDb[1] = readBandGainDb(bandsObject, "mid", "rightGainDb", state.rightBandGainsDb[1]);
    state.leftBandGainsDb[2] = readBandGainDb(bandsObject, "high", "leftGainDb", state.leftBandGainsDb[2]);
    state.rightBandGainsDb[2] = readBandGainDb(bandsObject, "high", "rightGainDb", state.rightBandGainsDb[2]);

    state.leftDelayMs = clampChannelDelayMs(getNumber(obj, "leftDelayMs", state.leftDelayMs));
    state.rightDelayMs = clampChannelDelayMs(getNumber(obj, "rightDelayMs", state.rightDelayMs));
    state.swapLeftRight = getBool(obj, "swapLeftRight", state.swapLeftRight);
    state.monoMode = parseMonoMode(getString(obj, "monoMode"), state.monoMode);
    state.invertLeft = getBool(obj, "invertLeft", state.invertLeft);
    state.invertRight = getBool(obj, "invertRight", state.invertRight);
    state.constantPower = getBool(obj, "constantPower", state.constantPower);
    return state;
}

SpeedMode parseSpeedMode(const std::string& value, SpeedMode fallback)
{
    if (value == "nightcore") return SpeedMode::Nightcore;
    if (value == "daycore")   return SpeedMode::Daycore;
    if (value == "speed")     return SpeedMode::Speed;
    return fallback;
}

std::string speedModeText(SpeedMode mode)
{
    switch (mode)
    {
        case SpeedMode::Nightcore: return "nightcore";
        case SpeedMode::Daycore:   return "daycore";
        case SpeedMode::Speed:     return "speed";
    }
    return "nightcore";
}

nlohmann::json buildEqState(const EqProcessor& processor)
{
    const auto state = processor.getState();
    nlohmann::json obj;
    obj["enabled"] = state.enabled;
    obj["preampDb"] = state.preampDb;
    obj["dspHeadroomDb"] = 0;
    obj["dspSafetyLimiterEnabled"] = isDspSafetyLimiterEnabled();
    obj["presetId"] = "custom";
    obj["presetName"] = state.presetName;
    obj["clippingRisk"] = processor.hasClippingRisk();

    nlohmann::json bands = nlohmann::json::array();
    for (int i = 0; i < eqBandCount; ++i)
    {
        nlohmann::json band;
        band["frequencyHz"] = state.bandFrequenciesHz[static_cast<size_t>(i)];
        band["gainDb"] = state.bandGainsDb[static_cast<size_t>(i)];
        band["q"] = state.bandQ[static_cast<size_t>(i)];
        band["filterType"] = eqFilterTypeText(state.bandFilterTypes[static_cast<size_t>(i)]);
        band["enabled"] = state.bandEnabled[static_cast<size_t>(i)];
        bands.push_back(band);
    }
    obj["bands"] = bands;
    return obj;
}

nlohmann::json buildDspState(const DspHeadroomProcessor& processor)
{
    nlohmann::json obj;
    obj["headroomDb"] = processor.getHeadroomDb();
    obj["safetyLimiterEnabled"] = isDspSafetyLimiterEnabled();
    return obj;
}

nlohmann::json buildChannelBalanceState(const ChannelBalanceProcessor& processor)
{
    const auto state = processor.getState();
    nlohmann::json obj;
    obj["enabled"] = state.enabled;
    obj["balance"] = state.balance;
    obj["leftGainDb"] = state.leftGainDb;
    obj["rightGainDb"] = state.rightGainDb;

    nlohmann::json bandGains;
    nlohmann::json low;
    low["leftGainDb"] = state.leftBandGainsDb[0];
    low["rightGainDb"] = state.rightBandGainsDb[0];
    bandGains["low"] = low;
    nlohmann::json mid;
    mid["leftGainDb"] = state.leftBandGainsDb[1];
    mid["rightGainDb"] = state.rightBandGainsDb[1];
    bandGains["mid"] = mid;
    nlohmann::json high;
    high["leftGainDb"] = state.leftBandGainsDb[2];
    high["rightGainDb"] = state.rightBandGainsDb[2];
    bandGains["high"] = high;
    obj["bandGains"] = bandGains;

    obj["leftDelayMs"] = state.leftDelayMs;
    obj["rightDelayMs"] = state.rightDelayMs;
    obj["swapLeftRight"] = state.swapLeftRight;
    obj["monoMode"] = monoModeText(state.monoMode);
    obj["invertLeft"] = state.invertLeft;
    obj["invertRight"] = state.invertRight;
    obj["constantPower"] = state.constantPower;
    obj["clippingRisk"] = processor.hasClippingRisk();
    return obj;
}

nlohmann::json buildRoomCorrectionState(const ConvolutionProcessor& processor)
{
    const auto state = processor.getState();
    nlohmann::json obj;
    obj["enabled"] = state.enabled;
    obj["status"] = state.status;
    obj["irId"] = state.irId;
    obj["irName"] = state.irName;
    obj["channelMode"] = state.channelMode;
    obj["sampleRate"] = state.sampleRate;
    obj["tapCount"] = state.tapCount;
    obj["trimDb"] = state.trimDb;
    obj["latencySamples"] = state.latencySamples;
    obj["clippingRisk"] = state.clippingRisk;
    obj["error"] = state.error;
    return obj;
}

nlohmann::json buildReplayGainConfig(const ReplayGainProcessor& processor)
{
    const auto config = processor.getConfig();
    nlohmann::json obj;
    obj["trackGainDb"] = config.trackGainDb;
    obj["albumGainDb"] = config.albumGainDb;
    obj["peak"] = config.peak;
    obj["mode"] = config.mode;
    obj["preampDb"] = config.preampDb;
    obj["preventClipping"] = config.preventClipping;
    obj["appliedGainDb"] = processor.getAppliedGainDb();
    obj["active"] = processor.isActive();
    return obj;
}

nlohmann::json buildPresetList()
{
    const auto presets = EqPresetStore::createBuiltInPresets();
    nlohmann::json result = nlohmann::json::array();
    for (const auto& preset : presets)
    {
        nlohmann::json obj;
        obj["id"] = preset.id;
        obj["name"] = preset.name;
        obj["preampDb"] = preset.preampDb;
        obj["readonly"] = preset.readonlyPreset;

        nlohmann::json bands = nlohmann::json::array();
        for (const auto& band : preset.bands)
        {
            nlohmann::json b;
            b["frequencyHz"] = band.frequencyHz;
            b["gainDb"] = band.gainDb;
            b["q"] = band.q;
            b["filterType"] = eqFilterTypeText(band.filterType);
            b["enabled"] = band.enabled;
            bands.push_back(b);
        }
        obj["bands"] = bands;
        result.push_back(obj);
    }
    return result;
}

const nlohmann::json* getParamsObject(const nlohmann::json& params)
{
    if (params.is_array())
    {
        if (params.size() > 0 && params[0].is_object())
            return &params[0];
        return nullptr;
    }
    if (params.is_object())
        return &params;
    return nullptr;
}

float getParamsNumber(const nlohmann::json& params, float fallback)
{
    if (params.is_array())
    {
        if (params.size() > 0 && params[0].is_number())
            return params[0].get<float>();
        return fallback;
    }
    if (params.is_number())
        return params.get<float>();
    return fallback;
}

bool getParamsBool(const nlohmann::json& params, bool fallback)
{
    if (params.is_array())
    {
        if (params.size() > 0 && params[0].is_boolean())
            return params[0].get<bool>();
        return fallback;
    }
    if (params.is_boolean())
        return params.get<bool>();
    return fallback;
}

std::string getParamsString(const nlohmann::json& params)
{
    if (params.is_array())
    {
        if (params.size() > 0 && params[0].is_string())
            return params[0].get<std::string>();
        return std::string();
    }
    if (params.is_string())
        return params.get<std::string>();
    return std::string();
}

int getParamsInt(const nlohmann::json& params, int fallback)
{
    if (params.is_array())
    {
        if (params.size() > 0 && params[0].is_number())
            return params[0].get<int>();
        return fallback;
    }
    if (params.is_number())
        return params.get<int>();
    return fallback;
}

} // namespace

JsonRpcProtocol::WriteCallback JsonRpcProtocol::writeCallback;
JsonRpcProtocol::OpenFileCallback JsonRpcProtocol::openFileCallback = nullptr;
JsonRpcProtocol::PauseCallback JsonRpcProtocol::pauseCallback;
JsonRpcProtocol::SeekCallback JsonRpcProtocol::seekCallback;
JsonRpcProtocol::StopCallback JsonRpcProtocol::stopCallback;
JsonRpcProtocol::PrefetchCallback JsonRpcProtocol::prefetchCallback;
JsonRpcProtocol::VolumeCallback JsonRpcProtocol::volumeCallback;
JsonRpcProtocol::QueueSetCallback JsonRpcProtocol::queueSetCallback;
JsonRpcProtocol::QueueClearCallback JsonRpcProtocol::queueClearCallback;

void JsonRpcProtocol::setWriteCallback(WriteCallback callback)
{
    writeCallback = std::move(callback);
}

void JsonRpcProtocol::setOpenFileCallback(OpenFileCallback callback)
{
    openFileCallback = callback;
}

void JsonRpcProtocol::setPauseCallback(PauseCallback cb) { pauseCallback = cb; }
void JsonRpcProtocol::setSeekCallback(SeekCallback cb) { seekCallback = cb; }
void JsonRpcProtocol::setStopCallback(StopCallback cb) { stopCallback = cb; }
void JsonRpcProtocol::setPrefetchCallback(PrefetchCallback cb) { prefetchCallback = cb; }
void JsonRpcProtocol::setVolumeCallback(VolumeCallback cb) { volumeCallback = cb; }
void JsonRpcProtocol::setQueueSetCallback(QueueSetCallback cb) { queueSetCallback = std::move(cb); }
void JsonRpcProtocol::setQueueClearCallback(QueueClearCallback cb) { queueClearCallback = std::move(cb); }

std::string JsonRpcProtocol::createJsonRpcResponse(int id, const nlohmann::json& result)
{
    nlohmann::json obj;
    obj["jsonrpc"] = "2.0";
    obj["result"] = result;
    obj["id"] = id;
    return obj.dump();
}

std::string JsonRpcProtocol::createJsonRpcError(int id, int code, const std::string& message)
{
    nlohmann::json errorObj;
    errorObj["code"] = code;
    errorObj["message"] = message;

    nlohmann::json obj;
    obj["jsonrpc"] = "2.0";
    obj["error"] = errorObj;
    obj["id"] = id;
    return obj.dump();
}

std::string JsonRpcProtocol::createJsonRpcNotification(const std::string& method, const nlohmann::json& params)
{
    nlohmann::json obj;
    obj["jsonrpc"] = "2.0";
    obj["method"] = method;
    obj["params"] = params;
    return obj.dump();
}

std::string JsonRpcProtocol::handleJsonLine(
    const std::string& line,
    EqProcessor& eq, ChannelBalanceProcessor& cb, ConvolutionProcessor& conv,
    DspHeadroomProcessor& headroom, ReplayGainProcessor& rg,
    PlaybackRateProcessor& rate, LevelMeterProcessor& meter,
    EqPresetStore& /*presets*/)
{
    nlohmann::json parsed;
    try
    {
        parsed = nlohmann::json::parse(line);
    }
    catch (const nlohmann::json::parse_error&)
    {
        return createJsonRpcError(0, -32700, "Parse error");
    }

    if (!parsed.is_object())
        return createJsonRpcError(0, -32700, "Parse error");

    if (!parsed.contains("jsonrpc"))
        return createJsonRpcError(0, -32600, "Invalid Request: missing jsonrpc");

    const auto& methodValue = parsed["method"];
    if (!methodValue.is_string())
        return createJsonRpcError(0, -32600, "Invalid Request: missing method");

    const auto method = methodValue.get<std::string>();
    const auto& params = parsed.value("params", nlohmann::json());
    const bool hasId = parsed.contains("id");
    const int id = hasId ? parsed["id"].get<int>() : 0;

    if (!hasId)
        return std::string();

    // ── EQ Methods ──

    if (method == "eq.getState")
        return createJsonRpcResponse(id, buildEqState(eq));

    if (method == "eq.setEnabled")
    {
        eq.setEnabled(getParamsBool(params, false));
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setBandGain")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const int band = getInt(*paramsObj, "band", -1);
        if (!eq.setBandGainDb(band, getNumber(*paramsObj, "gainDb", 0.0f)))
            return createJsonRpcError(id, -32000, "Invalid EQ band index");
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setBandFrequency")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const int band = getInt(*paramsObj, "band", -1);
        if (!eq.setBandFrequencyHz(band, getNumber(*paramsObj, "frequencyHz", eqFrequenciesHz[0])))
            return createJsonRpcError(id, -32000, "Invalid EQ band index");
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setBandQ")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const int band = getInt(*paramsObj, "band", -1);
        if (!eq.setBandQ(band, getNumber(*paramsObj, "q", 1.0f)))
            return createJsonRpcError(id, -32000, "Invalid EQ band index");
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setBandFilterType")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const int band = getInt(*paramsObj, "band", -1);
        const auto filterTypeStr = getString(*paramsObj, "filterType");
        if (!isEqFilterTypeText(filterTypeStr))
            return createJsonRpcError(id, -32000, "Invalid filter type");
        if (!eq.setBandFilterType(band, parseEqFilterType(filterTypeStr, EqFilterType::Peaking)))
            return createJsonRpcError(id, -32000, "Invalid EQ band index");
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setBandEnabled")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const int band = getInt(*paramsObj, "band", -1);
        if (!eq.setBandEnabled(band, getBool(*paramsObj, "enabled", true)))
            return createJsonRpcError(id, -32000, "Invalid EQ band index");
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setPreamp")
    {
        eq.setPreampDb(getParamsNumber(params, 0.0f));
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "eq.setPreset")
    {
        const auto presetId = getParamsString(params);
        eq.setPreampDb(0.0f);
        const auto presets = EqPresetStore::createBuiltInPresets();
        for (const auto& preset : presets)
        {
            if (preset.id == presetId)
            {
                for (size_t i = 0; i < preset.bands.size() && i < static_cast<size_t>(eqBandCount); ++i)
                {
                    const auto& band = preset.bands[i];
                    eq.setBandFrequencyHz(static_cast<int>(i), band.frequencyHz);
                    eq.setBandGainDb(static_cast<int>(i), band.gainDb);
                    eq.setBandQ(static_cast<int>(i), band.q);
                    eq.setBandFilterType(static_cast<int>(i), band.filterType);
                    eq.setBandEnabled(static_cast<int>(i), band.enabled);
                }
                eq.setPreampDb(preset.preampDb);
                return createJsonRpcResponse(id, buildEqState(eq));
            }
        }
        return createJsonRpcError(id, -32003, "Preset not found");
    }

    if (method == "eq.reset")
    {
        eq.resetFlat();
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    // ── DSP Methods ──

    if (method == "dsp.getState")
        return createJsonRpcResponse(id, buildDspState(headroom));

    if (method == "dsp.setHeadroom")
    {
        headroom.setHeadroomDb(getParamsNumber(params, 0.0f));
        return createJsonRpcResponse(id, buildDspState(headroom));
    }

    if (method == "dsp.setSafetyLimiter")
    {
        DspChain::setSafetyLimiterEnabled(getParamsBool(params, true));
        return createJsonRpcResponse(id, buildDspState(headroom));
    }

    // ── Channel Balance Methods ──

    if (method == "channelBalance.getState")
        return createJsonRpcResponse(id, buildChannelBalanceState(cb));

    if (method == "channelBalance.setState")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj != nullptr)
        {
            const auto nextState = readChannelBalanceState(*paramsObj, cb.getState());
            cb.setState(nextState);
        }
        return createJsonRpcResponse(id, buildChannelBalanceState(cb));
    }

    if (method == "channelBalance.reset")
    {
        cb.resetToDefault();
        return createJsonRpcResponse(id, buildChannelBalanceState(cb));
    }

    // ── Room Correction Methods ──

    if (method == "roomCorrection.getState")
        return createJsonRpcResponse(id, buildRoomCorrectionState(conv));

    if (method == "roomCorrection.loadIr")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        const auto path = getString(*paramsObj, "path");
        const auto irId = getString(*paramsObj, "irId");
        const auto irName = getString(*paramsObj, "irName");
        if (path.empty())
            return createJsonRpcError(id, -32005, "Missing IR path");
        conv.loadImpulseResponse(path, irId, irName.empty() ? "Room correction IR" : irName);
        return createJsonRpcResponse(id, buildRoomCorrectionState(conv));
    }

    if (method == "roomCorrection.setEnabled")
    {
        conv.setEnabled(getParamsBool(params, false));
        return createJsonRpcResponse(id, buildRoomCorrectionState(conv));
    }

    if (method == "roomCorrection.setTrim")
    {
        conv.setTrimDb(getParamsNumber(params, 0.0f));
        return createJsonRpcResponse(id, buildRoomCorrectionState(conv));
    }

    if (method == "roomCorrection.clear")
    {
        conv.clearImpulseResponse();
        return createJsonRpcResponse(id, buildRoomCorrectionState(conv));
    }

    // ── ReplayGain Methods ──

    if (method == "replayGain.getConfig")
        return createJsonRpcResponse(id, buildReplayGainConfig(rg));

    if (method == "replayGain.setConfig")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj != nullptr)
        {
            ReplayGainConfig config;
            config.trackGainDb = getNumber(*paramsObj, "trackGainDb", 0.0f);
            config.albumGainDb = getNumber(*paramsObj, "albumGainDb", 0.0f);
            config.peak = getNumber(*paramsObj, "peak", 1.0f);
            config.mode = getInt(*paramsObj, "mode", replayGainModeOff);
            config.preampDb = getNumber(*paramsObj, "preampDb", 0.0f);
            config.preventClipping = getBool(*paramsObj, "preventClipping", true);
            rg.setConfig(config);
        }
        return createJsonRpcResponse(id, buildReplayGainConfig(rg));
    }

    // ── PlaybackRate Methods ──

    if (method == "playbackRate.setRate")
    {
        rate.setRate(getParamsNumber(params, 1.0f));
        nlohmann::json obj;
        obj["rate"] = rate.getRate();
        obj["mode"] = speedModeText(rate.getSpeedMode());
        return createJsonRpcResponse(id, obj);
    }

    if (method == "playbackRate.setMode")
    {
        const auto modeStr = getParamsString(params);
        rate.setSpeedMode(parseSpeedMode(modeStr, SpeedMode::Nightcore));
        nlohmann::json obj;
        obj["rate"] = rate.getRate();
        obj["mode"] = speedModeText(rate.getSpeedMode());
        return createJsonRpcResponse(id, obj);
    }

    // ── LevelMeter Methods ──

    if (method == "levelMeter.setInterval")
    {
        meter.setIntervalMs(getParamsInt(params, 100));
        nlohmann::json obj;
        obj["intervalMs"] = meter.getIntervalMs();
        return createJsonRpcResponse(id, obj);
    }

    // ── Preset Methods ──

    if (method == "preset.list")
        return createJsonRpcResponse(id, buildPresetList());

    if (method == "preset.save")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj != nullptr)
        {
            EqPreset preset;
            preset.id = getString(*paramsObj, "id");
            preset.name = getString(*paramsObj, "name");
            preset.preampDb = getNumber(*paramsObj, "preampDb", 0.0f);
            preset.readonlyPreset = false;
            if (EqPresetStore::validatePreset(preset))
            {
                nlohmann::json obj;
                obj["id"] = preset.id;
                obj["name"] = preset.name;
                obj["preampDb"] = preset.preampDb;
                obj["readonly"] = false;
                return createJsonRpcResponse(id, obj);
            }
        }
        return createJsonRpcError(id, -32003, "Invalid preset data");
    }

    if (method == "preset.delete")
    {
        return createJsonRpcResponse(id, buildPresetList());
    }

    // ── Profile Methods ──
    // Profile data is managed by Electron's EqStateStore.
    // Native host only provides DSP application, not profile storage.

    if (method == "profile.list")
    {
        return createJsonRpcResponse(id, nlohmann::json::array());
    }

    if (method == "profile.save")
    {
        return createJsonRpcResponse(id, params);
    }

    if (method == "profile.apply")
    {
        return createJsonRpcResponse(id, nlohmann::json::object());
    }

    if (method == "profile.delete")
    {
        return createJsonRpcResponse(id, nlohmann::json::array());
    }

    if (method == "profile.bind")
    {
        nlohmann::json obj;
        obj["profileId"] = "";
        obj["target"] = params;
        return createJsonRpcResponse(id, obj);
    }

    if (method == "profile.getBinding")
    {
        return createJsonRpcResponse(id, nullptr);
    }

    if (method == "profile.applyBound")
    {
        return createJsonRpcResponse(id, nlohmann::json::object());
    }

    if (method == "eq.syncState")
    {
        return createJsonRpcResponse(id, nlohmann::json::object({
            {"enabled", eq.isEnabled()},
            {"preampDb", eq.getState().preampDb}
        }));
    }

    if (method == "eq.setState")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj != nullptr)
        {
            EqState state = eq.getState();
            state.enabled = getBool(*paramsObj, "enabled", state.enabled);
            state.preampDb = static_cast<float>(getNumber(*paramsObj, "preampDb", static_cast<double>(state.preampDb)));

            if (paramsObj->contains("bands") && (*paramsObj)["bands"].is_array())
            {
                const auto& bands = (*paramsObj)["bands"];
                int bandIndex = 0;
                for (const auto& band : bands)
                {
                    if (bandIndex >= eqBandCount) break;
                    state.bandEnabled[static_cast<size_t>(bandIndex)] = band.value("enabled", true);
                    state.bandFilterTypes[static_cast<size_t>(bandIndex)] = parseEqFilterType(band.value("filterType", "peaking"), EqFilterType::Peaking);
                    state.bandFrequenciesHz[static_cast<size_t>(bandIndex)] = static_cast<float>(band.value("frequencyHz", 1000.0));
                    state.bandGainsDb[static_cast<size_t>(bandIndex)] = static_cast<float>(band.value("gainDb", 0.0));
                    state.bandQ[static_cast<size_t>(bandIndex)] = static_cast<float>(band.value("q", 1.0));
                    ++bandIndex;
                }
            }
            eq.setState(state);
        }
        return createJsonRpcResponse(id, buildEqState(eq));
    }

    if (method == "rpc.shutdown")
    {
        return createJsonRpcResponse(id, "ok");
    }

    // ── Audio Playback Control ──

    if (method == "audio.pause") {
        if (pauseCallback) pauseCallback(true);
        return createJsonRpcResponse(id, true);
    }
    if (method == "audio.resume") {
        if (pauseCallback) pauseCallback(false);
        return createJsonRpcResponse(id, true);
    }
    if (method == "audio.play") {
        if (pauseCallback) pauseCallback(false);
        return createJsonRpcResponse(id, true);
    }

    if (method == "audio.setVolume") {
        const auto* paramsObj = getParamsObject(params);
        float volume = paramsObj ? getNumber(*paramsObj, "volume", 1.0f) : 1.0f;
        if (!std::isfinite(volume))
            volume = 1.0f;
        volume = std::max(0.0f, std::min(1.0f, volume));
        if (volumeCallback) volumeCallback(volume);
        nlohmann::json obj;
        obj["volume"] = volume;
        return createJsonRpcResponse(id, obj);
    }

    if (method == "audio.seek") {
        const auto* paramsObj = getParamsObject(params);
        double pos = paramsObj ? getNumber(*paramsObj, "positionSeconds", 0.0) : 0.0;
        nlohmann::json result;
        bool ok = seekCallback ? seekCallback(pos, result) : false;
        return ok ? createJsonRpcResponse(id, result.is_null() ? nlohmann::json(true) : result) : createJsonRpcError(id, -32000, "seek failed");
    }

    if (method == "audio.stop") {
        nlohmann::json result;
        if (stopCallback) stopCallback(result);
        return createJsonRpcResponse(id, result.is_null() ? nlohmann::json(true) : result);
    }

    if (method == "audio.prefetch") {
        const auto* paramsObj = getParamsObject(params);
        std::string filePath = paramsObj ? getString(*paramsObj, "filePath") : "";
        int sr = paramsObj ? getInt(*paramsObj, "sampleRate", 0) : 0;
        bool ok = prefetchCallback ? prefetchCallback(filePath, sr) : false;
        return ok ? createJsonRpcResponse(id, true) : createJsonRpcError(id, -32000, "prefetch failed");
    }

    // ── Queue Methods ──

    if (method == "queue.set" && queueSetCallback) {
        nlohmann::json items = params.is_array() && !params.empty() && params[0].contains("items")
            ? params[0]["items"] : nlohmann::json::array();
        std::string repeatMode = (params.is_array() && !params.empty() && params[0].contains("repeatMode"))
            ? params[0]["repeatMode"].get<std::string>() : "off";
        queueSetCallback(items, repeatMode);
        return createJsonRpcResponse(id, nlohmann::json::object());
    }

    if (method == "queue.clear" && queueClearCallback) {
        queueClearCallback();
        return createJsonRpcResponse(id, nlohmann::json::object());
    }

    // ── Audio File Methods ──

    if (method == "audio.openFile")
    {
        const auto* paramsObj = getParamsObject(params);
        if (paramsObj == nullptr)
            return createJsonRpcError(id, -32602, "Invalid params");
        std::string filePath = getString(*paramsObj, "filePath");
        if (filePath.empty())
            return createJsonRpcError(id, -32602, "Missing filePath");

        double requestedStartSeconds = 0.0;
        const auto startSecondsIt = paramsObj->find("startSeconds");
        if (startSecondsIt != paramsObj->end())
        {
            if (!startSecondsIt->is_number())
                return createJsonRpcError(id, -32602, "Invalid startSeconds");
            requestedStartSeconds = startSecondsIt->get<double>();
            if (!std::isfinite(requestedStartSeconds))
                return createJsonRpcError(id, -32602, "Invalid startSeconds");
        }

        if (openFileCallback)
        {
            const int targetSampleRate = getInt(*paramsObj, "sampleRate", 0);
            nlohmann::json result;
            try
            {
                bool ok = openFileCallback(filePath, targetSampleRate, requestedStartSeconds, result);
                if (ok)
                    return createJsonRpcResponse(id, result);
                else
                    return createJsonRpcError(id, -32000,
                        result.value("error", "openFile failed"));
            }
            catch (const std::exception& e)
            {
                return createJsonRpcError(id, -32000, e.what());
            }
        }

        // Fallback: probe-only
        try
        {
            echo::AudioProbe probe = echo::LibavDecoder::probe(filePath);
            nlohmann::json result;
            result["status"] = "probed";
            result["filePath"] = filePath;
            result["sampleRate"] = probe.sampleRate;
            result["channels"] = probe.channels;
            result["durationSeconds"] = probe.durationSeconds;
            result["startSeconds"] = normalizeStartSeconds(requestedStartSeconds, probe.durationSeconds);
            result["codec"] = probe.codec;
            result["container"] = probe.container;
            result["bitDepth"] = probe.bitDepth;
            result["bitrate"] = probe.bitrate;
            return createJsonRpcResponse(id, result);
        }
        catch (const std::exception& e)
        {
            return createJsonRpcError(id, -32000, e.what());
        }
    }

    // ── Lifecycle Methods ──

    if (method == "rpc.ping")
    {
        return createJsonRpcResponse(id, "pong");
    }

    return createJsonRpcError(id, -32601, "Method not found: " + method);
}

} // namespace echo
