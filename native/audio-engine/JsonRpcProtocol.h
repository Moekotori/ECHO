#pragma once
#include "ChannelBalanceProcessor.h"
#include "ConvolutionProcessor.h"
#include "DspChain.h"
#include "DspHeadroomProcessor.h"
#include "EqProcessor.h"
#include "EqPresetStore.h"
#include "LevelMeterProcessor.h"
#include "PlaybackRateProcessor.h"
#include "ReplayGainProcessor.h"
#include "third_party/nlohmann_json.hpp"
#include <functional>
#include <string>
namespace echo {
class JsonRpcProtocol {
public:
    using WriteCallback = std::function<void(const std::string&)>;
    static void setWriteCallback(WriteCallback callback);
    using OpenFileCallback = std::function<bool(
        const std::string& filePath,
        int targetSampleRate,
        double startSeconds,
        nlohmann::json& result)>;
    static void setOpenFileCallback(OpenFileCallback callback);

    using PauseCallback = std::function<void(bool pause)>;
    static void setPauseCallback(PauseCallback callback);

    using SeekCallback = std::function<bool(double positionSeconds, nlohmann::json& result)>;
    static void setSeekCallback(SeekCallback callback);

    using StopCallback = std::function<void(nlohmann::json& result)>;
    static void setStopCallback(StopCallback callback);

    using PrefetchCallback = std::function<bool(const std::string& filePath, int targetSampleRate)>;
    static void setPrefetchCallback(PrefetchCallback callback);

    using VolumeCallback = std::function<void(float volume)>;
    static void setVolumeCallback(VolumeCallback callback);

    using QueueSetCallback = std::function<bool(const nlohmann::json& items, const std::string& repeatMode)>;
    static void setQueueSetCallback(QueueSetCallback callback);

    using QueueClearCallback = std::function<bool()>;
    static void setQueueClearCallback(QueueClearCallback callback);

    static std::string handleJsonLine(
        const std::string& line,
        EqProcessor& eq, ChannelBalanceProcessor& cb, ConvolutionProcessor& conv,
        DspHeadroomProcessor& headroom, ReplayGainProcessor& rg,
        PlaybackRateProcessor& rate, LevelMeterProcessor& meter,
        EqPresetStore& presets);
    static std::string createJsonRpcNotification(const std::string& method, const nlohmann::json& params);
private:
    static std::string createJsonRpcResponse(int id, const nlohmann::json& result);
    static std::string createJsonRpcError(int id, int code, const std::string& message);
    static WriteCallback writeCallback;
    static OpenFileCallback openFileCallback;
    static PauseCallback pauseCallback;
    static SeekCallback seekCallback;
    static StopCallback stopCallback;
    static PrefetchCallback prefetchCallback;
    static VolumeCallback volumeCallback;
    static QueueSetCallback queueSetCallback;
    static QueueClearCallback queueClearCallback;
};
}
