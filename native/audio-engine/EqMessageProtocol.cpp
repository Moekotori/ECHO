#include "EqMessageProtocol.h"
#include "third_party/nlohmann_json.hpp"

namespace echo
{
namespace
{

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

float getNumber(const nlohmann::json& obj, const char* key, float fallback)
{
    const auto it = obj.find(key);
    return it != obj.end() && it->is_number() ? it->get<float>() : fallback;
}

bool getBool(const nlohmann::json& obj, const char* key, bool fallback)
{
    const auto it = obj.find(key);
    return it != obj.end() && it->is_boolean() ? it->get<bool>() : fallback;
}

int getInt(const nlohmann::json& obj, const char* key, int fallback)
{
    const auto it = obj.find(key);
    return it != obj.end() && it->is_number() ? it->get<int>() : fallback;
}

std::string getString(const nlohmann::json& obj, const char* key)
{
    const auto it = obj.find(key);
    return it != obj.end() && it->is_string() ? it->get<std::string>() : std::string();
}

float readBandGainDb(const nlohmann::json* bandsObject, const char* bandId, const char* sideKey, float fallback)
{
    if (bandsObject == nullptr || !bandsObject->is_object())
        return fallback;

    const auto bandIt = bandsObject->find(bandId);
    if (bandIt == bandsObject->end() || !bandIt->is_object())
        return fallback;

    return clampChannelBandGainDb(getNumber(*bandIt, sideKey, fallback));
}

nlohmann::json buildEqState(const EqProcessor& processor)
{
    const auto state = processor.getState();
    nlohmann::json obj;
    obj["type"] = "eq:state";
    obj["enabled"] = state.enabled;
    obj["preampDb"] = state.preampDb;
    obj["presetName"] = state.presetName;
    obj["clippingRisk"] = processor.hasClippingRisk();
    auto bands = nlohmann::json::array();
    for (int index = 0; index < eqBandCount; ++index)
    {
        nlohmann::json band;
        band["frequencyHz"] = state.bandFrequenciesHz[static_cast<size_t>(index)];
        band["gainDb"] = state.bandGainsDb[static_cast<size_t>(index)];
        band["q"] = state.bandQ[static_cast<size_t>(index)];
        band["filterType"] = eqFilterTypeText(state.bandFilterTypes[static_cast<size_t>(index)]);
        band["enabled"] = state.bandEnabled[static_cast<size_t>(index)];
        bands.push_back(std::move(band));
    }
    obj["bands"] = std::move(bands);
    return obj;
}

nlohmann::json buildChannelBalanceState(const ChannelBalanceProcessor& processor)
{
    const auto state = processor.getState();
    nlohmann::json obj;
    obj["type"] = "channelBalance:state";
    obj["ok"] = true;
    obj["enabled"] = state.enabled;
    obj["balance"] = state.balance;
    obj["leftGainDb"] = state.leftGainDb;
    obj["rightGainDb"] = state.rightGainDb;

    nlohmann::json bandGains;
    nlohmann::json low;
    low["leftGainDb"] = state.leftBandGainsDb[0];
    low["rightGainDb"] = state.rightBandGainsDb[0];
    bandGains["low"] = std::move(low);
    nlohmann::json mid;
    mid["leftGainDb"] = state.leftBandGainsDb[1];
    mid["rightGainDb"] = state.rightBandGainsDb[1];
    bandGains["mid"] = std::move(mid);
    nlohmann::json high;
    high["leftGainDb"] = state.leftBandGainsDb[2];
    high["rightGainDb"] = state.rightBandGainsDb[2];
    bandGains["high"] = std::move(high);
    obj["bandGains"] = std::move(bandGains);

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
    obj["type"] = "roomCorrection:state";
    obj["ok"] = true;
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

nlohmann::json buildDspState(const DspHeadroomProcessor& processor)
{
    nlohmann::json obj;
    obj["type"] = "dsp:state";
    obj["ok"] = true;
    obj["headroomDb"] = processor.getHeadroomDb();
    obj["safetyLimiterEnabled"] = DspChain::isSafetyLimiterEnabled();
    return obj;
}

ChannelBalanceState readChannelBalanceState(const nlohmann::json& obj, const ChannelBalanceState& fallback)
{
    ChannelBalanceState state = fallback;
    state.enabled = getBool(obj, "enabled", state.enabled);
    state.balance = clampChannelBalance(getNumber(obj, "balance", state.balance));
    state.leftGainDb = clampChannelGainDb(getNumber(obj, "leftGainDb", state.leftGainDb));
    state.rightGainDb = clampChannelGainDb(getNumber(obj, "rightGainDb", state.rightGainDb));

    const auto bandsIt = obj.find("bandGains");
    const nlohmann::json* bandsObject = (bandsIt != obj.end() && bandsIt->is_object()) ? &(*bandsIt) : nullptr;
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

} // namespace

std::string EqMessageProtocol::createStateMessage(const EqProcessor& processor)
{
    return buildEqState(processor).dump();
}

std::string EqMessageProtocol::createChannelBalanceStateMessage(const ChannelBalanceProcessor& processor)
{
    return buildChannelBalanceState(processor).dump();
}

std::string EqMessageProtocol::createRoomCorrectionStateMessage(const ConvolutionProcessor& processor)
{
    return buildRoomCorrectionState(processor).dump();
}

std::string EqMessageProtocol::createDspStateMessage(const DspHeadroomProcessor& processor)
{
    return buildDspState(processor).dump();
}

std::string EqMessageProtocol::handleJsonLine(
    const std::string& line,
    EqProcessor& processor,
    ChannelBalanceProcessor& channelBalanceProcessor,
    ConvolutionProcessor& convolutionProcessor,
    DspHeadroomProcessor& headroomProcessor)
{
    nlohmann::json parsed;
    try
    {
        parsed = nlohmann::json::parse(line);
    }
    catch (const nlohmann::json::parse_error&)
    {
        return createErrorMessage("unknown", "invalid_json");
    }

    if (!parsed.is_object())
        return createErrorMessage("unknown", "invalid_json");

    const auto type = getString(parsed, "type");

    if (type == "eq:get-state")
        return createStateMessage(processor);

    if (type == "channelBalance.getState" || type == "channelBalance:get-state")
        return createChannelBalanceStateMessage(channelBalanceProcessor);

    if (type == "roomCorrection.getState" || type == "roomCorrection:get-state")
        return createRoomCorrectionStateMessage(convolutionProcessor);

    if (type == "dsp.getState" || type == "dsp:get-state")
        return createDspStateMessage(headroomProcessor);

    if (type == "dsp.setHeadroom" || type == "dsp:set-headroom")
    {
        headroomProcessor.setHeadroomDb(getNumber(parsed, "headroomDb", 0.0f));
        return createDspStateMessage(headroomProcessor);
    }

    if (type == "dsp.setSafetyLimiterEnabled" || type == "dsp:set-safety-limiter-enabled")
    {
        DspChain::setSafetyLimiterEnabled(getBool(parsed, "enabled", true));
        return createDspStateMessage(headroomProcessor);
    }

    if (type == "roomCorrection.setEnabled" || type == "roomCorrection:set-enabled")
    {
        convolutionProcessor.setEnabled(getBool(parsed, "enabled", false));
        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "roomCorrection.setTrim" || type == "roomCorrection:set-trim")
    {
        convolutionProcessor.setTrimDb(getNumber(parsed, "trimDb", 0.0f));
        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "roomCorrection.loadIr" || type == "roomCorrection:load-ir")
    {
        const auto path = getString(parsed, "path");
        const auto id = getString(parsed, "irId");
        const auto name = getString(parsed, "irName");
        if (path.empty())
            return createErrorMessage(type, "missing_ir_path");

        if (!convolutionProcessor.loadImpulseResponse(path, id, name.empty() ? "Room correction IR" : name))
            return createRoomCorrectionStateMessage(convolutionProcessor);

        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "roomCorrection.clear" || type == "roomCorrection:clear")
    {
        convolutionProcessor.clearImpulseResponse();
        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "channelBalance.setState" || type == "channelBalance:set-state")
    {
        const auto stateIt = parsed.find("state");
        const nlohmann::json* stateObj = (stateIt != parsed.end() && stateIt->is_object()) ? &(*stateIt) : nullptr;
        const auto nextState = stateObj != nullptr
            ? readChannelBalanceState(*stateObj, channelBalanceProcessor.getState())
            : readChannelBalanceState(parsed, channelBalanceProcessor.getState());
        channelBalanceProcessor.setState(nextState);
        return createChannelBalanceStateMessage(channelBalanceProcessor);
    }

    if (type == "channelBalance.reset" || type == "channelBalance:reset")
    {
        channelBalanceProcessor.resetToDefault();
        return createChannelBalanceStateMessage(channelBalanceProcessor);
    }

    if (type == "eq:set-enabled")
    {
        processor.setEnabled(getBool(parsed, "enabled", false));
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-gain")
    {
        const int band = getInt(parsed, "band", -1);
        if (!processor.setBandGainDb(band, getNumber(parsed, "gainDb", 0.0f)))
            return createErrorMessage(type, "invalid_band_index");
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-frequency")
    {
        const int band = getInt(parsed, "band", -1);
        if (!processor.setBandFrequencyHz(band, getNumber(parsed, "frequencyHz", eqFrequenciesHz[0])))
            return createErrorMessage(type, "invalid_band_index");
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-q")
    {
        const int band = getInt(parsed, "band", -1);
        if (!processor.setBandQ(band, getNumber(parsed, "q", 1.0f)))
            return createErrorMessage(type, "invalid_band_index");
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-filter-type")
    {
        const int band = getInt(parsed, "band", -1);
        const auto filterTypeText = getString(parsed, "filterType");
        if (!isEqFilterTypeText(filterTypeText))
            return createErrorMessage(type, "invalid_filter_type");
        const auto filterType = parseEqFilterType(filterTypeText, EqFilterType::Peaking);
        if (!processor.setBandFilterType(band, filterType))
            return createErrorMessage(type, "invalid_band_index");
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-enabled")
    {
        const int band = getInt(parsed, "band", -1);
        if (!processor.setBandEnabled(band, getBool(parsed, "enabled", true)))
            return createErrorMessage(type, "invalid_band_index");
        return createStateMessage(processor);
    }

    if (type == "eq:set-preamp")
    {
        processor.setPreampDb(getNumber(parsed, "preampDb", 0.0f));
        return createStateMessage(processor);
    }

    if (type == "eq:reset")
    {
        processor.resetFlat();
        return createStateMessage(processor);
    }

    if (type == "eq:set-preset")
    {
        processor.setPreampDb(getNumber(parsed, "preampDb", 0.0f));
        const auto bandsIt = parsed.find("bands");
        if (bandsIt == parsed.end() || !bandsIt->is_array())
            return createErrorMessage(type, "invalid_preset_bands");

        const auto& bandArray = *bandsIt;
        constexpr int legacyEqBandCount = 10;
        if (bandArray.size() != static_cast<size_t>(eqBandCount) && bandArray.size() != static_cast<size_t>(legacyEqBandCount))
            return createErrorMessage(type, "invalid_preset_bands");

        for (int index = 0; index < eqBandCount; ++index)
        {
            if (static_cast<size_t>(index) >= bandArray.size() || !bandArray[static_cast<size_t>(index)].is_object())
            {
                processor.setBandFrequencyHz(index, eqFrequenciesHz[static_cast<size_t>(index)]);
                processor.setBandGainDb(index, 0.0f);
                processor.setBandQ(index, 1.0f);
                processor.setBandFilterType(index, EqFilterType::Peaking);
                processor.setBandEnabled(index, true);
                continue;
            }

            const auto& bandObj = bandArray[static_cast<size_t>(index)];
            processor.setBandFrequencyHz(index, getNumber(bandObj, "frequencyHz", eqFrequenciesHz[static_cast<size_t>(index)]));
            processor.setBandGainDb(index, getNumber(bandObj, "gainDb", 0.0f));
            processor.setBandQ(index, getNumber(bandObj, "q", 1.0f));
            const auto bandFilterType = getString(bandObj, "filterType");
            if (!bandFilterType.empty() && !isEqFilterTypeText(bandFilterType))
                return createErrorMessage(type, "invalid_filter_type");
            processor.setBandFilterType(index, parseEqFilterType(bandFilterType, EqFilterType::Peaking));
            processor.setBandEnabled(index, getBool(bandObj, "enabled", true));
        }

        return createStateMessage(processor);
    }

    return createErrorMessage(type.empty() ? "unknown" : type, "unsupported_eq_command");
}

std::string EqMessageProtocol::handleJsonLine(
    const std::string& line,
    EqProcessor& processor,
    ChannelBalanceProcessor& channelBalanceProcessor,
    ConvolutionProcessor& convolutionProcessor)
{
    DspHeadroomProcessor headroomProcessor;
    return handleJsonLine(line, processor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
}

std::string EqMessageProtocol::handleJsonLine(
    const std::string& line,
    EqProcessor& processor,
    ChannelBalanceProcessor& channelBalanceProcessor)
{
    ConvolutionProcessor convolutionProcessor;
    DspHeadroomProcessor headroomProcessor;
    return handleJsonLine(line, processor, channelBalanceProcessor, convolutionProcessor, headroomProcessor);
}

std::string EqMessageProtocol::createErrorMessage(const std::string& requestType, const std::string& message)
{
    nlohmann::json obj;
    obj["type"] = "eq:error";
    obj["requestType"] = requestType;
    obj["message"] = message;
    return obj.dump();
}

} // namespace echo
