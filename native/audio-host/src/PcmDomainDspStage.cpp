#include "PcmDomainDspStage.h"

#include <algorithm>
#include <cstddef>

PcmDomainDspStage::PcmDomainDspStage(
    echo::EqProcessor& eq,
    echo::ConvolutionProcessor& convolution,
    echo::ChannelBalanceProcessor& channelBalance,
    echo::DspHeadroomProcessor& headroom,
    echo::ReplayGainProcessor& replayGain,
    echo::CompressorProcessor& compressor,
    echo::SpatialDspProcessor& spatialDsp,
    echo::PlaybackRateProcessor& playbackRate,
    echo::LevelMeterProcessor& meter,
    echo::DspRackOrder* rackOrder)
    : dspChain_(eq, convolution, channelBalance, headroom, replayGain, compressor, spatialDsp, playbackRate, meter, rackOrder)
{
}

void PcmDomainDspStage::prepare(double sampleRate, int maximumBlockFrames, int channels)
{
    channels_ = std::max(1, channels);
    sampleRate_ = std::max(1, static_cast<int>(sampleRate));
    maximumBlockFrames_ = std::max(1, maximumBlockFrames);
    buffer_.setSize(channels_, maximumBlockFrames_);
    dspChain_.prepare(static_cast<double>(sampleRate_), maximumBlockFrames_, channels_);
    prepared_ = true;
}

void PcmDomainDspStage::reset()
{
    if (prepared_)
        dspChain_.reset();
}

bool PcmDomainDspStage::process(std::vector<float>& interleaved, std::string& error)
{
    if (interleaved.empty())
    {
        error.clear();
        return true;
    }
    if (!prepared_)
    {
        error = "native_pcm_dsp_not_prepared";
        return false;
    }
    if (interleaved.size() % static_cast<std::size_t>(channels_) != 0)
    {
        error = "native_pcm_dsp_invalid_interleaved_input";
        return false;
    }

    const int frames = static_cast<int>(interleaved.size() / static_cast<std::size_t>(channels_));
    for (int offset = 0; offset < frames;)
    {
        const int framesThisBlock = std::min(maximumBlockFrames_, frames - offset);
        for (int channel = 0; channel < channels_; ++channel)
        {
            float* destination = buffer_.getWritePointer(channel);
            for (int frame = 0; frame < framesThisBlock; ++frame)
            {
                destination[frame] = interleaved[
                    static_cast<std::size_t>(offset + frame) * static_cast<std::size_t>(channels_)
                    + static_cast<std::size_t>(channel)];
            }
        }

        dspChain_.processBlock(buffer_, 0, framesThisBlock);

        for (int channel = 0; channel < channels_; ++channel)
        {
            const float* source = buffer_.getReadPointer(channel);
            for (int frame = 0; frame < framesThisBlock; ++frame)
            {
                interleaved[
                    static_cast<std::size_t>(offset + frame) * static_cast<std::size_t>(channels_)
                    + static_cast<std::size_t>(channel)] = source[frame];
            }
        }
        offset += framesThisBlock;
    }

    error.clear();
    return true;
}
