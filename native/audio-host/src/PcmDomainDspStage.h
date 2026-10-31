#pragma once

#include "../../audio-engine/DspChain.h"

#include <string>
#include <vector>

// Runs the host's PCM-domain DSP graph before a non-PCM transport encoder
// (for example PCM -> SDM -> DoP). It deliberately has no output callback
// responsibilities: NativePlaybackPipeline invokes it from the serialized
// producer/decode side so the stateful DSP processors are never driven by
// both a decode thread and a device callback.
class PcmDomainDspStage final
{
public:
    PcmDomainDspStage(
        echo::EqProcessor& eq,
        echo::ConvolutionProcessor& convolution,
        echo::ChannelBalanceProcessor& channelBalance,
        echo::DspHeadroomProcessor& headroom,
        echo::ReplayGainProcessor& replayGain,
        echo::CompressorProcessor& compressor,
        echo::SpatialDspProcessor& spatialDsp,
        echo::PlaybackRateProcessor& playbackRate,
        echo::LevelMeterProcessor& meter,
        echo::DspRackOrder* rackOrder = nullptr);

    void prepare(double sampleRate, int maximumBlockFrames, int channels);
    void reset();
    bool process(std::vector<float>& interleaved, std::string& error);

    bool prepared() const noexcept { return prepared_; }
    int sampleRate() const noexcept { return sampleRate_; }
    int maximumBlockFrames() const noexcept { return maximumBlockFrames_; }

private:
    echo::DspChain dspChain_;
    echo::FloatAudioBuffer buffer_;
    int channels_ = 2;
    int sampleRate_ = 0;
    int maximumBlockFrames_ = 0;
    bool prepared_ = false;
};
