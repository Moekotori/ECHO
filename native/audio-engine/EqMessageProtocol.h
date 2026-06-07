#pragma once

#include "ChannelBalanceProcessor.h"
#include "ConvolutionProcessor.h"
#include "DspChain.h"
#include "DspHeadroomProcessor.h"
#include "EqProcessor.h"

#include <juce_core/juce_core.h>

#include <string>

namespace echo
{
class EqMessageProtocol
{
public:
    static std::string createStateMessage(const EqProcessor& processor);
    static std::string createChannelBalanceStateMessage(const ChannelBalanceProcessor& processor);
    static std::string createRoomCorrectionStateMessage(const ConvolutionProcessor& processor);
    static std::string createDspStateMessage(const DspHeadroomProcessor& processor);
    static std::string handleJsonLine(
        const std::string& line,
        EqProcessor& processor,
        ChannelBalanceProcessor& channelBalanceProcessor,
        ConvolutionProcessor& convolutionProcessor,
        DspHeadroomProcessor& headroomProcessor);
    static std::string handleJsonLine(
        const std::string& line,
        EqProcessor& processor,
        ChannelBalanceProcessor& channelBalanceProcessor,
        ConvolutionProcessor& convolutionProcessor);
    static std::string handleJsonLine(
        const std::string& line,
        EqProcessor& processor,
        ChannelBalanceProcessor& channelBalanceProcessor);

private:
    static std::string createErrorMessage(const std::string& requestType, const std::string& message);
};
} // namespace echo
