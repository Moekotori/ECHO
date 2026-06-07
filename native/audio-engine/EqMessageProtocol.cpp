#include "EqMessageProtocol.h"

#include <sstream>

namespace echo
{
namespace
{
std::string boolText(bool value)
{
    return value ? "true" : "false";
}

float getNumber(const juce::DynamicObject& object, const juce::Identifier& key, float fallback)
{
    const auto value = object.getProperty(key);
    return value.isDouble() || value.isInt() ? static_cast<float>(value) : fallback;
}

bool getBool(const juce::DynamicObject& object, const juce::Identifier& key, bool fallback)
{
    const auto value = object.getProperty(key);
    return value.isBool() ? static_cast<bool>(value) : fallback;
}

float readBandGainDb(const juce::DynamicObject* bandsObject, const char* bandId, const char* sideKey, float fallback)
{
    if (bandsObject == nullptr)
        return fallback;

    const auto bandValue = bandsObject->getProperty(bandId);
    const auto* bandObject = bandValue.getDynamicObject();
    if (bandObject == nullptr)
        return fallback;

    return clampChannelBandGainDb(getNumber(*bandObject, sideKey, fallback));
}

int getInt(const juce::DynamicObject& object, const juce::Identifier& key, int fallback)
{
    const auto value = object.getProperty(key);
    return value.isInt() || value.isDouble() ? static_cast<int>(value) : fallback;
}

std::string getString(const juce::DynamicObject& object, const juce::Identifier& key)
{
    const auto value = object.getProperty(key);
    return value.isString() ? value.toString().toStdString() : std::string();
}

EqFilterType parseEqFilterType(const std::string& value, EqFilterType fallback)
{
    if (value == "lowShelf")
        return EqFilterType::LowShelf;

    if (value == "highShelf")
        return EqFilterType::HighShelf;

    if (value == "lowPass")
        return EqFilterType::LowPass;

    if (value == "highPass")
        return EqFilterType::HighPass;

    if (value == "notch")
        return EqFilterType::Notch;

    if (value == "peaking")
        return EqFilterType::Peaking;

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
        case EqFilterType::LowShelf: return "lowShelf";
        case EqFilterType::HighShelf: return "highShelf";
        case EqFilterType::LowPass: return "lowPass";
        case EqFilterType::HighPass: return "highPass";
        case EqFilterType::Notch: return "notch";
        case EqFilterType::Peaking:
        default: return "peaking";
    }
}

ChannelBalanceMonoMode parseMonoMode(const std::string& value, ChannelBalanceMonoMode fallback)
{
    if (value == "sum")
        return ChannelBalanceMonoMode::SumToMono;

    if (value == "left")
        return ChannelBalanceMonoMode::LeftOnly;

    if (value == "right")
        return ChannelBalanceMonoMode::RightOnly;

    if (value == "off")
        return ChannelBalanceMonoMode::Off;

    return fallback;
}

std::string monoModeText(ChannelBalanceMonoMode mode)
{
    switch (mode)
    {
        case ChannelBalanceMonoMode::SumToMono: return "sum";
        case ChannelBalanceMonoMode::LeftOnly: return "left";
        case ChannelBalanceMonoMode::RightOnly: return "right";
        case ChannelBalanceMonoMode::Off:
        default: return "off";
    }
}

ChannelBalanceState readChannelBalanceState(const juce::DynamicObject& object, const ChannelBalanceState& fallback)
{
    ChannelBalanceState state = fallback;
    state.enabled = getBool(object, "enabled", state.enabled);
    state.balance = clampChannelBalance(getNumber(object, "balance", state.balance));
    state.leftGainDb = clampChannelGainDb(getNumber(object, "leftGainDb", state.leftGainDb));
    state.rightGainDb = clampChannelGainDb(getNumber(object, "rightGainDb", state.rightGainDb));
    const auto bandsValue = object.getProperty("bandGains");
    const auto* bandsObject = bandsValue.getDynamicObject();
    state.leftBandGainsDb[0] = readBandGainDb(bandsObject, "low", "leftGainDb", state.leftBandGainsDb[0]);
    state.rightBandGainsDb[0] = readBandGainDb(bandsObject, "low", "rightGainDb", state.rightBandGainsDb[0]);
    state.leftBandGainsDb[1] = readBandGainDb(bandsObject, "mid", "leftGainDb", state.leftBandGainsDb[1]);
    state.rightBandGainsDb[1] = readBandGainDb(bandsObject, "mid", "rightGainDb", state.rightBandGainsDb[1]);
    state.leftBandGainsDb[2] = readBandGainDb(bandsObject, "high", "leftGainDb", state.leftBandGainsDb[2]);
    state.rightBandGainsDb[2] = readBandGainDb(bandsObject, "high", "rightGainDb", state.rightBandGainsDb[2]);
    state.leftDelayMs = clampChannelDelayMs(getNumber(object, "leftDelayMs", state.leftDelayMs));
    state.rightDelayMs = clampChannelDelayMs(getNumber(object, "rightDelayMs", state.rightDelayMs));
    state.swapLeftRight = getBool(object, "swapLeftRight", state.swapLeftRight);
    state.monoMode = parseMonoMode(getString(object, "monoMode"), state.monoMode);
    state.invertLeft = getBool(object, "invertLeft", state.invertLeft);
    state.invertRight = getBool(object, "invertRight", state.invertRight);
    state.constantPower = getBool(object, "constantPower", state.constantPower);
    return state;
}

} // namespace

std::string EqMessageProtocol::createStateMessage(const EqProcessor& processor)
{
    const auto state = processor.getState();
    std::ostringstream output;
    output << "{\"type\":\"eq:state\","
           << "\"enabled\":" << boolText(state.enabled) << ','
           << "\"preampDb\":" << state.preampDb << ','
           << "\"presetName\":\"" << juce::JSON::escapeString(state.presetName).toStdString() << "\","
           << "\"clippingRisk\":" << boolText(processor.hasClippingRisk()) << ','
           << "\"bands\":[";

    for (int index = 0; index < eqBandCount; ++index)
    {
        if (index > 0)
            output << ',';

        output << "{\"frequencyHz\":" << state.bandFrequenciesHz[static_cast<size_t>(index)]
               << ",\"gainDb\":" << state.bandGainsDb[static_cast<size_t>(index)]
               << ",\"q\":" << state.bandQ[static_cast<size_t>(index)]
               << ",\"filterType\":\"" << eqFilterTypeText(state.bandFilterTypes[static_cast<size_t>(index)]) << "\""
               << ",\"enabled\":" << boolText(state.bandEnabled[static_cast<size_t>(index)])
               << "}";
    }

    output << "]}";
    return output.str();
}

std::string EqMessageProtocol::createChannelBalanceStateMessage(const ChannelBalanceProcessor& processor)
{
    const auto state = processor.getState();
    std::ostringstream output;
    output << "{\"type\":\"channelBalance:state\","
           << "\"ok\":true,"
           << "\"enabled\":" << boolText(state.enabled) << ','
           << "\"balance\":" << state.balance << ','
           << "\"leftGainDb\":" << state.leftGainDb << ','
           << "\"rightGainDb\":" << state.rightGainDb << ','
           << "\"bandGains\":{"
           << "\"low\":{\"leftGainDb\":" << state.leftBandGainsDb[0] << ",\"rightGainDb\":" << state.rightBandGainsDb[0] << "},"
           << "\"mid\":{\"leftGainDb\":" << state.leftBandGainsDb[1] << ",\"rightGainDb\":" << state.rightBandGainsDb[1] << "},"
           << "\"high\":{\"leftGainDb\":" << state.leftBandGainsDb[2] << ",\"rightGainDb\":" << state.rightBandGainsDb[2] << "}},"
           << "\"leftDelayMs\":" << state.leftDelayMs << ','
           << "\"rightDelayMs\":" << state.rightDelayMs << ','
           << "\"swapLeftRight\":" << boolText(state.swapLeftRight) << ','
           << "\"monoMode\":\"" << monoModeText(state.monoMode) << "\","
           << "\"invertLeft\":" << boolText(state.invertLeft) << ','
           << "\"invertRight\":" << boolText(state.invertRight) << ','
           << "\"constantPower\":" << boolText(state.constantPower) << ','
           << "\"clippingRisk\":" << boolText(processor.hasClippingRisk())
           << "}";
    return output.str();
}

std::string EqMessageProtocol::createRoomCorrectionStateMessage(const ConvolutionProcessor& processor)
{
    const auto state = processor.getState();
    std::ostringstream output;
    output << "{\"type\":\"roomCorrection:state\","
           << "\"ok\":true,"
           << "\"enabled\":" << boolText(state.enabled) << ','
           << "\"status\":\"" << juce::JSON::escapeString(state.status).toStdString() << "\","
           << "\"irId\":\"" << juce::JSON::escapeString(state.irId).toStdString() << "\","
           << "\"irName\":\"" << juce::JSON::escapeString(state.irName).toStdString() << "\","
           << "\"channelMode\":\"" << juce::JSON::escapeString(state.channelMode).toStdString() << "\","
           << "\"sampleRate\":" << state.sampleRate << ','
           << "\"tapCount\":" << state.tapCount << ','
           << "\"trimDb\":" << state.trimDb << ','
           << "\"latencySamples\":" << state.latencySamples << ','
           << "\"clippingRisk\":" << boolText(state.clippingRisk) << ','
           << "\"error\":\"" << juce::JSON::escapeString(state.error).toStdString() << "\""
           << "}";
    return output.str();
}

std::string EqMessageProtocol::createDspStateMessage(const DspHeadroomProcessor& processor)
{
    std::ostringstream output;
    output << "{\"type\":\"dsp:state\","
           << "\"ok\":true,"
           << "\"headroomDb\":" << processor.getHeadroomDb() << ','
           << "\"safetyLimiterEnabled\":" << boolText(DspChain::isSafetyLimiterEnabled())
           << "}";
    return output.str();
}

std::string EqMessageProtocol::handleJsonLine(
    const std::string& line,
    EqProcessor& processor,
    ChannelBalanceProcessor& channelBalanceProcessor,
    ConvolutionProcessor& convolutionProcessor,
    DspHeadroomProcessor& headroomProcessor)
{
    const auto parsed = juce::JSON::parse(juce::String::fromUTF8(line.data(), static_cast<int>(line.size())));
    const auto* object = parsed.getDynamicObject();

    if (object == nullptr)
        return createErrorMessage("unknown", "invalid_json");

    const auto type = getString(*object, "type");

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
        headroomProcessor.setHeadroomDb(getNumber(*object, "headroomDb", 0.0f));
        return createDspStateMessage(headroomProcessor);
    }

    if (type == "dsp.setSafetyLimiterEnabled" || type == "dsp:set-safety-limiter-enabled")
    {
        DspChain::setSafetyLimiterEnabled(getBool(*object, "enabled", true));
        return createDspStateMessage(headroomProcessor);
    }

    if (type == "roomCorrection.setEnabled" || type == "roomCorrection:set-enabled")
    {
        convolutionProcessor.setEnabled(getBool(*object, "enabled", false));
        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "roomCorrection.setTrim" || type == "roomCorrection:set-trim")
    {
        convolutionProcessor.setTrimDb(getNumber(*object, "trimDb", 0.0f));
        return createRoomCorrectionStateMessage(convolutionProcessor);
    }

    if (type == "roomCorrection.loadIr" || type == "roomCorrection:load-ir")
    {
        const auto path = getString(*object, "path");
        const auto id = getString(*object, "irId");
        const auto name = getString(*object, "irName");
        if (path.empty())
            return createErrorMessage(type, "missing_ir_path");

        if (! convolutionProcessor.loadImpulseResponse(path, id, name.empty() ? "Room correction IR" : name))
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
        const auto stateValue = object->getProperty("state");
        const auto* stateObject = stateValue.getDynamicObject();
        const auto nextState = stateObject != nullptr
            ? readChannelBalanceState(*stateObject, channelBalanceProcessor.getState())
            : readChannelBalanceState(*object, channelBalanceProcessor.getState());
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
        processor.setEnabled(getBool(*object, "enabled", false));
        return createStateMessage(processor);
    }

    if (type == "eq:set-band-gain")
    {
        const int band = getInt(*object, "band", -1);

        if (! processor.setBandGainDb(band, getNumber(*object, "gainDb", 0.0f)))
            return createErrorMessage(type, "invalid_band_index");

        return createStateMessage(processor);
    }

    if (type == "eq:set-band-frequency")
    {
        const int band = getInt(*object, "band", -1);

        if (! processor.setBandFrequencyHz(band, getNumber(*object, "frequencyHz", eqFrequenciesHz[0])))
            return createErrorMessage(type, "invalid_band_index");

        return createStateMessage(processor);
    }

    if (type == "eq:set-band-q")
    {
        const int band = getInt(*object, "band", -1);

        if (! processor.setBandQ(band, getNumber(*object, "q", 1.0f)))
            return createErrorMessage(type, "invalid_band_index");

        return createStateMessage(processor);
    }

    if (type == "eq:set-band-filter-type")
    {
        const int band = getInt(*object, "band", -1);
        const auto filterTypeText = getString(*object, "filterType");
        if (! isEqFilterTypeText(filterTypeText))
            return createErrorMessage(type, "invalid_filter_type");

        const auto filterType = parseEqFilterType(filterTypeText, EqFilterType::Peaking);

        if (! processor.setBandFilterType(band, filterType))
            return createErrorMessage(type, "invalid_band_index");

        return createStateMessage(processor);
    }

    if (type == "eq:set-band-enabled")
    {
        const int band = getInt(*object, "band", -1);

        if (! processor.setBandEnabled(band, getBool(*object, "enabled", true)))
            return createErrorMessage(type, "invalid_band_index");

        return createStateMessage(processor);
    }

    if (type == "eq:set-preamp")
    {
        processor.setPreampDb(getNumber(*object, "preampDb", 0.0f));
        return createStateMessage(processor);
    }

    if (type == "eq:reset")
    {
        processor.resetFlat();
        return createStateMessage(processor);
    }

    if (type == "eq:set-preset")
    {
        processor.setPreampDb(getNumber(*object, "preampDb", 0.0f));
        const auto bands = object->getProperty("bands");
        const auto* bandArray = bands.getArray();

        constexpr int legacyEqBandCount = 10;
        if (bandArray == nullptr || (bandArray->size() != eqBandCount && bandArray->size() != legacyEqBandCount))
            return createErrorMessage(type, "invalid_preset_bands");

        for (int index = 0; index < eqBandCount; ++index)
        {
            const auto* bandObject = index < bandArray->size() ? bandArray->getReference(index).getDynamicObject() : nullptr;

            if (bandObject == nullptr)
            {
                processor.setBandFrequencyHz(index, eqFrequenciesHz[static_cast<size_t>(index)]);
                processor.setBandGainDb(index, 0.0f);
                processor.setBandQ(index, 1.0f);
                processor.setBandFilterType(index, EqFilterType::Peaking);
                processor.setBandEnabled(index, true);
                continue;
            }

            processor.setBandFrequencyHz(index, getNumber(*bandObject, "frequencyHz", eqFrequenciesHz[static_cast<size_t>(index)]));
            processor.setBandGainDb(index, getNumber(*bandObject, "gainDb", 0.0f));
            processor.setBandQ(index, getNumber(*bandObject, "q", 1.0f));
            const auto bandFilterType = getString(*bandObject, "filterType");
            if (! bandFilterType.empty() && ! isEqFilterTypeText(bandFilterType))
                return createErrorMessage(type, "invalid_filter_type");
            processor.setBandFilterType(index, parseEqFilterType(bandFilterType, EqFilterType::Peaking));
            processor.setBandEnabled(index, getBool(*bandObject, "enabled", true));
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
    return std::string("{\"type\":\"eq:error\",\"requestType\":\"")
        + juce::JSON::escapeString(requestType).toStdString()
        + "\",\"message\":\""
        + juce::JSON::escapeString(message).toStdString()
        + "\"}";
}
} // namespace echo
