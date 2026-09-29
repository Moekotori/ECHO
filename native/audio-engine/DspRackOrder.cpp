#include "DspRackOrder.h"

#include <array>

namespace echo
{
DspRackOrder::DspRackOrder()
{
    const auto order = defaultOrder();
    for (std::size_t index = 0; index < moduleCount; ++index)
        order_[index].store(static_cast<int>(order[index]), std::memory_order_relaxed);
}

DspRackOrder::Snapshot DspRackOrder::snapshot() const noexcept
{
    Snapshot result {};
    for (;;)
    {
        const auto before = sequence_.load(std::memory_order_acquire);
        if ((before & 1U) != 0U)
            continue;

        for (std::size_t index = 0; index < moduleCount; ++index)
        {
            result[index] = static_cast<DspRackModuleId>(
                order_[index].load(std::memory_order_relaxed));
        }

        const auto after = sequence_.load(std::memory_order_acquire);
        if (before == after)
            return result;
    }
}

bool DspRackOrder::setOrder(const std::vector<DspRackModuleId>& order, std::string& error) noexcept
{
    if (order.size() != moduleCount)
    {
        error = "dsp_rack_order_requires_all_modules";
        return false;
    }

    std::array<bool, moduleCount> seen {};
    Snapshot next {};
    for (std::size_t index = 0; index < moduleCount; ++index)
    {
        const auto numericId = static_cast<std::size_t>(order[index]);
        if (numericId >= moduleCount)
        {
            error = "dsp_rack_order_unknown_module";
            return false;
        }
        if (seen[numericId])
        {
            error = "dsp_rack_order_duplicate_module";
            return false;
        }
        seen[numericId] = true;
        next[index] = order[index];
    }

    storeOrder(next);
    error.clear();
    return true;
}

void DspRackOrder::resetToDefault() noexcept
{
    storeOrder(defaultOrder());
}

DspRackOrder::Snapshot DspRackOrder::defaultOrder() noexcept
{
    return {
        DspRackModuleId::Equalizer,
        DspRackModuleId::Convolution,
        DspRackModuleId::ReplayGain,
        DspRackModuleId::Compressor,
        DspRackModuleId::Crossfeed,
        DspRackModuleId::StereoField,
        DspRackModuleId::ChannelMatrix,
        DspRackModuleId::ChannelBalance,
    };
}

const char* DspRackOrder::moduleIdText(DspRackModuleId module) noexcept
{
    switch (module)
    {
        case DspRackModuleId::Equalizer:      return "equalizer";
        case DspRackModuleId::Convolution:    return "convolution";
        case DspRackModuleId::ReplayGain:     return "replayGain";
        case DspRackModuleId::Compressor:     return "compressor";
        case DspRackModuleId::Crossfeed:      return "crossfeed";
        case DspRackModuleId::StereoField:    return "stereoField";
        case DspRackModuleId::ChannelMatrix:  return "channelMatrix";
        case DspRackModuleId::ChannelBalance: return "channelBalance";
        default:                              return "unknown";
    }
}

bool DspRackOrder::parseModuleId(const std::string& text, DspRackModuleId& module) noexcept
{
    if (text == "equalizer")
        module = DspRackModuleId::Equalizer;
    else if (text == "convolution")
        module = DspRackModuleId::Convolution;
    else if (text == "replayGain")
        module = DspRackModuleId::ReplayGain;
    else if (text == "compressor")
        module = DspRackModuleId::Compressor;
    else if (text == "crossfeed")
        module = DspRackModuleId::Crossfeed;
    else if (text == "stereoField")
        module = DspRackModuleId::StereoField;
    else if (text == "channelMatrix")
        module = DspRackModuleId::ChannelMatrix;
    else if (text == "channelBalance")
        module = DspRackModuleId::ChannelBalance;
    else
        return false;
    return true;
}

void DspRackOrder::storeOrder(const Snapshot& order) noexcept
{
    sequence_.fetch_add(1, std::memory_order_acq_rel);
    for (std::size_t index = 0; index < moduleCount; ++index)
        order_[index].store(static_cast<int>(order[index]), std::memory_order_relaxed);
    sequence_.fetch_add(1, std::memory_order_release);
}
} // namespace echo
