// HostCommon.h - Aggregate header used by echo-audio-host main.cpp and tests
//
// Extracted from main.cpp to break the `#include "../src/main.cpp"` coupling
// in test files. Tests include this header for type declarations without
// pulling in main() or global state.
//
// main.cpp includes this header AFTER setting MINIAUDIO_IMPLEMENTATION so
// miniaudio's implementation body is compiled exactly once.

#pragma once

// ----- Host modules -----
#include "Options.h"
#include "DopRingSource.h"
#include "NativeDsdRingSource.h"

// ----- Audio-engine modules -----
#include "../../audio-engine/EqMessageProtocol.h"
#include "../../audio-engine/DspChain.h"
#include "../../audio-engine/ChannelBalanceProcessor.h"
#include "../../audio-engine/ConvolutionProcessor.h"
#include "../../audio-engine/EqProcessor.h"
#include "../../audio-engine/ReplayGainProcessor.h"
#include "../../audio-engine/PlaybackRateProcessor.h"
#include "../../audio-engine/LevelMeterProcessor.h"
#include "../../audio-engine/JsonRpcProtocol.h"

// ----- Platform-specific host modules -----
#ifdef _WIN32
#include "audio_host_exit_codes.h"
#include "asio_host.h"
#include "wasapi_exclusive.h"
#include "wasapi_shared.h"
#endif

#include "HostUtils.h"

// ----- Standard library -----
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

// ----- miniaudio (declarations only; implementation compiled in main.cpp) -----
#include "../third_party/miniaudio.h"

// ----- Platform system headers -----
#ifndef _WIN32
#include <unistd.h>
#include <fcntl.h>
#endif

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <avrt.h>
#include <mmsystem.h>
#include <shellapi.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <propsys.h>
#include <wrl/client.h>
#endif

// ----- Decode server, device, session, ring source, daemon -----
#include "../../audio-engine/libav_decoder.h"
#include "DeviceTypes.h"
#include "PlaybackSession.h"
#include "PcmRingAudioSource.h"
#include "AudioDaemon.h"
