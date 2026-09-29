#include "cuda_fir.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr unsigned char dsdSilenceByte = 0x69;
constexpr float sdmIdleSilenceThreshold = 0.00012f;
constexpr float sdmIdleLockThreshold = 0.00035f;
constexpr float sdmIdleUnlockThreshold = 0.0009f;
constexpr unsigned int sdmIdleLockFrames = 96u;

std::string jsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
  for (const unsigned char ch : value) {
    switch (ch) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (ch < 0x20) {
          constexpr char hex[] = "0123456789abcdef";
          escaped += "\\u00";
          escaped += hex[(ch >> 4) & 0x0f];
          escaped += hex[ch & 0x0f];
        } else {
          escaped += static_cast<char>(ch);
        }
        break;
    }
  }
  return escaped;
}

std::string jsonString(const std::string& value) {
  return "\"" + jsonEscape(value) + "\"";
}

std::optional<std::string> parseStringField(const std::string& input, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t keyIndex = input.find(needle);
  if (keyIndex == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t colonIndex = input.find(':', keyIndex + needle.size());
  if (colonIndex == std::string::npos) {
    return std::nullopt;
  }

  std::size_t quoteIndex = input.find('"', colonIndex + 1);
  if (quoteIndex == std::string::npos) {
    return std::nullopt;
  }

  std::string value;
  for (std::size_t index = quoteIndex + 1; index < input.size(); index += 1) {
    const char ch = input[index];
    if (ch == '"') {
      return value;
    }
    if (ch == '\\' && index + 1 < input.size()) {
      value += input[++index];
    } else {
      value += ch;
    }
  }

  return std::nullopt;
}

std::optional<int> parseIntField(const std::string& input, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t keyIndex = input.find(needle);
  if (keyIndex == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t colonIndex = input.find(':', keyIndex + needle.size());
  if (colonIndex == std::string::npos) {
    return std::nullopt;
  }

  char* end = nullptr;
  const long value = std::strtol(input.c_str() + colonIndex + 1, &end, 10);
  if (end == input.c_str() + colonIndex + 1) {
    return std::nullopt;
  }

  return static_cast<int>(value);
}

std::optional<float> parseFloatField(const std::string& input, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t keyIndex = input.find(needle);
  if (keyIndex == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t colonIndex = input.find(':', keyIndex + needle.size());
  if (colonIndex == std::string::npos) {
    return std::nullopt;
  }

  char* end = nullptr;
  const float value = std::strtof(input.c_str() + colonIndex + 1, &end);
  if (end == input.c_str() + colonIndex + 1 || !std::isfinite(value)) {
    return std::nullopt;
  }

  return value;
}

std::optional<std::vector<float>> parseFloatArrayField(const std::string& input, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t keyIndex = input.find(needle);
  if (keyIndex == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t colonIndex = input.find(':', keyIndex + needle.size());
  const std::size_t openIndex = colonIndex == std::string::npos ? std::string::npos : input.find('[', colonIndex + 1);
  if (openIndex == std::string::npos) {
    return std::nullopt;
  }

  std::vector<float> values;
  std::size_t index = openIndex + 1;
  while (index < input.size()) {
    while (index < input.size() && std::isspace(static_cast<unsigned char>(input[index]))) {
      index += 1;
    }
    if (index >= input.size()) {
      return std::nullopt;
    }
    if (input[index] == ']') {
      return values;
    }

    char* end = nullptr;
    const float value = std::strtof(input.c_str() + index, &end);
    if (end == input.c_str() + index || !std::isfinite(value)) {
      return std::nullopt;
    }
    values.push_back(value);
    index = static_cast<std::size_t>(end - input.c_str());

    while (index < input.size() && std::isspace(static_cast<unsigned char>(input[index]))) {
      index += 1;
    }
    if (index < input.size() && input[index] == ',') {
      index += 1;
    }
  }

  return std::nullopt;
}

std::optional<std::vector<unsigned int>> parseUintArrayField(const std::string& input, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t keyIndex = input.find(needle);
  if (keyIndex == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t colonIndex = input.find(':', keyIndex + needle.size());
  const std::size_t openIndex = colonIndex == std::string::npos ? std::string::npos : input.find('[', colonIndex + 1);
  if (openIndex == std::string::npos) {
    return std::nullopt;
  }

  std::vector<unsigned int> values;
  std::size_t index = openIndex + 1;
  while (index < input.size()) {
    while (index < input.size() && std::isspace(static_cast<unsigned char>(input[index]))) {
      index += 1;
    }
    if (index >= input.size()) {
      return std::nullopt;
    }
    if (input[index] == ']') {
      return values;
    }

    char* end = nullptr;
    const unsigned long value = std::strtoul(input.c_str() + index, &end, 10);
    if (end == input.c_str() + index || value > 0xffffffffUL) {
      return std::nullopt;
    }
    values.push_back(static_cast<unsigned int>(value));
    index = static_cast<std::size_t>(end - input.c_str());

    while (index < input.size() && std::isspace(static_cast<unsigned char>(input[index]))) {
      index += 1;
    }
    if (index < input.size() && input[index] == ',') {
      index += 1;
    }
  }

  return std::nullopt;
}

std::string numberArrayJson(const std::vector<float>& values) {
  std::ostringstream stream;
  stream.precision(9);
  stream << '[';
  for (std::size_t index = 0; index < values.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << values[index];
  }
  stream << ']';
  return stream.str();
}

template <typename T>
std::string integerArrayJson(const std::vector<T>& values) {
  std::ostringstream stream;
  stream << '[';
  for (std::size_t index = 0; index < values.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << static_cast<unsigned long long>(values[index]);
  }
  stream << ']';
  return stream.str();
}

float clampFloat(float value, float minValue, float maxValue) {
  return std::max(minValue, std::min(maxValue, value));
}

unsigned int advanceDitherState(unsigned int state) {
  return (state == 0 ? 0x9e3779b9u : state) * 1664525u + 1013904223u;
}

void printStatus() {
#ifdef ECHO_SRC_CUDA_WORKER_HAS_CUDA
  constexpr bool cudaBuilt = true;
#else
  constexpr bool cudaBuilt = false;
#endif

  std::cout
    << "{\"type\":\"status\",\"ok\":true,\"worker\":\"echo-src-cuda-worker\",\"protocol\":1,\"cudaBuilt\":"
    << (cudaBuilt ? "true" : "false")
    << "}" << std::endl;
}

void printError(const std::string& code, const std::string& detail = "") {
  std::cout
    << "{\"type\":\"error\",\"ok\":false,\"code\":" << jsonString(code)
    << ",\"detail\":" << jsonString(detail)
    << "}" << std::endl;
}

std::vector<float> processFirCpu(
  const std::vector<float>& input,
  int channels,
  const std::vector<float>& taps,
  const std::vector<float>& history,
  std::vector<float>& nextHistory
) {
  const std::size_t channelCount = static_cast<std::size_t>(std::max(1, channels));
  const std::size_t historyFrames = taps.size() - 1;
  std::vector<float> combined;
  combined.reserve(history.size() + input.size());
  combined.insert(combined.end(), history.begin(), history.end());
  combined.insert(combined.end(), input.begin(), input.end());

  std::vector<float> output(input.size(), 0.0f);
  const std::size_t frameCount = input.size() / channelCount;
  for (std::size_t frame = 0; frame < frameCount; frame += 1) {
    const std::size_t combinedFrame = historyFrames + frame;
    for (std::size_t channel = 0; channel < channelCount; channel += 1) {
      float sample = 0.0f;
      for (std::size_t tapIndex = 0; tapIndex < taps.size(); tapIndex += 1) {
        const std::size_t sourceFrame = combinedFrame - tapIndex;
        sample += taps[tapIndex] * combined[sourceFrame * channelCount + channel];
      }
      output[frame * channelCount + channel] = sample;
    }
  }

  const std::size_t historyLength = (taps.size() - 1) * channelCount;
  nextHistory.assign(historyLength, 0.0f);
  if (historyLength > 0) {
    std::copy(combined.end() - static_cast<std::ptrdiff_t>(historyLength), combined.end(), nextHistory.begin());
  }

  return output;
}

void handleFir(const std::string& line) {
  const std::string backend = parseStringField(line, "backend").value_or("cuda");
  const int channels = parseIntField(line, "channels").value_or(0);
  const auto input = parseFloatArrayField(line, "input");
  const auto taps = parseFloatArrayField(line, "taps");
  const auto history = parseFloatArrayField(line, "history").value_or(std::vector<float>{});

  if (channels <= 0 || !input || !taps || taps->empty() || input->size() % static_cast<std::size_t>(channels) != 0) {
    printError("invalid_fir_request");
    return;
  }

  const std::size_t expectedHistory = (taps->size() - 1) * static_cast<std::size_t>(channels);
  if (history.size() != expectedHistory) {
    printError("invalid_history_length");
    return;
  }

  std::vector<float> output;
  std::vector<float> nextHistory;
  std::string error;
  std::string actualBackend = backend;

  if (backend == "cuda") {
    if (!echoCudaFirProcess(*input, channels, *taps, history, output, nextHistory, error)) {
      printError(error.empty() ? "cuda_fir_failed" : error);
      return;
    }
  } else if (backend == "cpu") {
    output = processFirCpu(*input, channels, *taps, history, nextHistory);
    actualBackend = "cpu";
  } else {
    printError("unsupported_backend", backend);
    return;
  }

  std::cout
    << "{\"type\":\"firResult\",\"ok\":true,\"backend\":" << jsonString(actualBackend)
    << ",\"output\":" << numberArrayJson(output)
    << ",\"history\":" << numberArrayJson(nextHistory)
    << "}" << std::endl;
}

std::vector<unsigned char> processSdmCpu(
  const std::vector<float>& input,
  int channels,
  const std::vector<float>& feedbackCoefficients,
  const std::vector<float>& errorHistory,
  const std::vector<unsigned int>& ditherState,
  const std::vector<unsigned int>& idleRunFrames,
  const std::vector<unsigned int>& idleLocked,
  const std::vector<float>& previousSamples,
  int dopFrameIndex,
  float ditherAmplitude,
  float inputLimit,
  float stabilityLimit,
  std::vector<float>& nextErrorHistory,
  std::vector<unsigned int>& nextDitherState,
  std::vector<unsigned int>& nextIdleRunFrames,
  std::vector<unsigned int>& nextIdleLocked,
  std::vector<float>& nextPreviousSamples,
  int& nextDopFrameIndex
) {
  const std::size_t channelCount = static_cast<std::size_t>(std::max(1, channels));
  const std::size_t order = feedbackCoefficients.size();
  const std::size_t frameCount = input.size() / channelCount;
  std::vector<float> errors = errorHistory;
  std::vector<unsigned int> dither = ditherState;
  std::vector<unsigned int> idleRuns = idleRunFrames;
  std::vector<unsigned int> idleLocks = idleLocked;
  std::vector<float> previous = previousSamples;
  std::vector<unsigned char> output(frameCount * channelCount * 3, 0);

  for (std::size_t frame = 0; frame < frameCount; frame += 1) {
    const unsigned char marker = ((dopFrameIndex + static_cast<int>(frame)) & 1) == 0 ? 0x05 : 0xfa;
    for (std::size_t channel = 0; channel < channelCount; channel += 1) {
      const float sample = clampFloat(input[frame * channelCount + channel], -inputLimit, inputLimit);
      float previousSample = clampFloat(previous[channel], -inputLimit, inputLimit);
      unsigned char firstByte = 0;
      unsigned char secondByte = 0;
      const std::size_t base = channel * order;
      const std::size_t outputOffset = (frame * channelCount + channel) * 3;

      const float magnitude = std::abs(sample);
      bool emitIdleSilence = false;
      if (idleLocks[channel] != 0u) {
        if (magnitude < sdmIdleUnlockThreshold) {
          idleRuns[channel] = std::min(sdmIdleLockFrames, idleRuns[channel] + 1u);
          emitIdleSilence = true;
        } else {
          idleLocks[channel] = 0u;
          idleRuns[channel] = 0u;
        }
      } else if (magnitude <= sdmIdleSilenceThreshold) {
        idleLocks[channel] = 1u;
        idleRuns[channel] = sdmIdleLockFrames;
        emitIdleSilence = true;
      } else if (magnitude <= sdmIdleLockThreshold) {
        idleRuns[channel] = std::min(sdmIdleLockFrames, idleRuns[channel] + 1u);
        if (idleRuns[channel] >= sdmIdleLockFrames) {
          idleLocks[channel] = 1u;
          emitIdleSilence = true;
        }
      } else {
        idleRuns[channel] = 0u;
      }

      if (emitIdleSilence) {
        std::fill(errors.begin() + static_cast<std::ptrdiff_t>(base), errors.begin() + static_cast<std::ptrdiff_t>(base + order), 0.0f);
        previous[channel] = 0.0f;
        output[outputOffset] = dsdSilenceByte;
        output[outputOffset + 1] = dsdSilenceByte;
        output[outputOffset + 2] = marker;
        continue;
      }

      for (int bit = 0; bit < 16; bit += 1) {
        dither[channel] = advanceDitherState(dither[channel]);
        const float ditherValue = ((static_cast<float>(static_cast<double>(dither[channel]) / 4294967296.0) - 0.5f) * ditherAmplitude);
        const float bitSample = previousSample + (sample - previousSample) * (static_cast<float>(bit + 1) / 16.0f);
        float decision = bitSample + ditherValue;
        for (std::size_t historyIndex = 0; historyIndex < order; historyIndex += 1) {
          decision += feedbackCoefficients[historyIndex] * errors[base + historyIndex];
        }
        decision = clampFloat(decision, -stabilityLimit, stabilityLimit);
        const bool one = decision >= 0.0f;
        const float quantizationError = clampFloat(decision - (one ? 1.0f : -1.0f), -stabilityLimit, stabilityLimit);
        if (order > 1) {
          for (std::size_t historyIndex = order - 1; historyIndex > 0; historyIndex -= 1) {
            errors[base + historyIndex] = errors[base + historyIndex - 1];
          }
        }
        errors[base] = quantizationError;

        if (one) {
          if (bit < 8) {
            firstByte = static_cast<unsigned char>(firstByte | (1u << bit));
          } else {
            secondByte = static_cast<unsigned char>(secondByte | (1u << (bit - 8)));
          }
        }
      }

      output[outputOffset] = firstByte;
      output[outputOffset + 1] = secondByte;
      output[outputOffset + 2] = marker;
      previous[channel] = sample;
    }
  }

  nextErrorHistory = errors;
  nextDitherState = dither;
  nextIdleRunFrames = idleRuns;
  nextIdleLocked = idleLocks;
  nextPreviousSamples = previous;
  nextDopFrameIndex = dopFrameIndex + static_cast<int>(frameCount);
  return output;
}

void handleSdm(const std::string& line) {
  const std::string backend = parseStringField(line, "backend").value_or("cuda");
  const int channels = parseIntField(line, "channels").value_or(0);
  const auto input = parseFloatArrayField(line, "input");
  const auto feedbackCoefficients = parseFloatArrayField(line, "feedbackCoefficients");
  const auto errorHistory = parseFloatArrayField(line, "errorHistory");
  const auto ditherState = parseUintArrayField(line, "ditherState");
  const auto idleRunFrames = parseUintArrayField(line, "idleRunFrames");
  const auto idleLocked = parseUintArrayField(line, "idleLocked");
  const auto previousSamples = parseFloatArrayField(line, "previousSamples");
  const int dopFrameIndex = parseIntField(line, "dopFrameIndex").value_or(0);
  const float ditherAmplitude = parseFloatField(line, "ditherAmplitude").value_or(0.0f);
  const float inputLimit = parseFloatField(line, "inputLimit").value_or(0.0f);
  const float stabilityLimit = parseFloatField(line, "stabilityLimit").value_or(0.0f);

  if (
    channels <= 0 ||
    !input ||
    !feedbackCoefficients ||
    feedbackCoefficients->empty() ||
    !errorHistory ||
    !ditherState ||
    input->empty() ||
    input->size() % static_cast<std::size_t>(channels) != 0 ||
    errorHistory->size() != feedbackCoefficients->size() * static_cast<std::size_t>(channels) ||
    ditherState->size() != static_cast<std::size_t>(channels) ||
    (idleRunFrames && idleRunFrames->size() != static_cast<std::size_t>(channels)) ||
    (idleLocked && idleLocked->size() != static_cast<std::size_t>(channels)) ||
    (previousSamples && previousSamples->size() != static_cast<std::size_t>(channels)) ||
    inputLimit <= 0.0f ||
    stabilityLimit <= 0.0f
  ) {
    printError("invalid_sdm_request");
    return;
  }

  std::vector<unsigned char> output;
  std::vector<float> nextErrorHistory;
  std::vector<unsigned int> nextDitherState;
  std::vector<unsigned int> nextIdleRunFrames;
  std::vector<unsigned int> nextIdleLocked;
  std::vector<float> nextPreviousSamples;
  int nextDopFrameIndex = dopFrameIndex;
  std::string error;
  std::string actualBackend = backend;

  if (backend == "cuda") {
    if (!echoCudaSdmProcess(
      *input,
      channels,
      *feedbackCoefficients,
      *errorHistory,
      *ditherState,
      idleRunFrames.value_or(std::vector<unsigned int>(static_cast<std::size_t>(channels), 0u)),
      idleLocked.value_or(std::vector<unsigned int>(static_cast<std::size_t>(channels), 0u)),
      previousSamples.value_or(std::vector<float>(static_cast<std::size_t>(channels), 0.0f)),
      dopFrameIndex,
      ditherAmplitude,
      inputLimit,
      stabilityLimit,
      output,
      nextErrorHistory,
      nextDitherState,
      nextIdleRunFrames,
      nextIdleLocked,
      nextPreviousSamples,
      nextDopFrameIndex,
      error
    )) {
      printError(error.empty() ? "cuda_sdm_failed" : error);
      return;
    }
  } else if (backend == "cpu") {
    output = processSdmCpu(
      *input,
      channels,
      *feedbackCoefficients,
      *errorHistory,
      *ditherState,
      idleRunFrames.value_or(std::vector<unsigned int>(static_cast<std::size_t>(channels), 0u)),
      idleLocked.value_or(std::vector<unsigned int>(static_cast<std::size_t>(channels), 0u)),
      previousSamples.value_or(std::vector<float>(static_cast<std::size_t>(channels), 0.0f)),
      dopFrameIndex,
      ditherAmplitude,
      inputLimit,
      stabilityLimit,
      nextErrorHistory,
      nextDitherState,
      nextIdleRunFrames,
      nextIdleLocked,
      nextPreviousSamples,
      nextDopFrameIndex
    );
    actualBackend = "cpu";
  } else {
    printError("unsupported_backend", backend);
    return;
  }

  std::cout
    << "{\"type\":\"sdmResult\",\"ok\":true,\"backend\":" << jsonString(actualBackend)
    << ",\"output\":" << integerArrayJson(output)
    << ",\"errorHistory\":" << numberArrayJson(nextErrorHistory)
    << ",\"ditherState\":" << integerArrayJson(nextDitherState)
    << ",\"idleRunFrames\":" << integerArrayJson(nextIdleRunFrames)
    << ",\"idleLocked\":" << integerArrayJson(nextIdleLocked)
    << ",\"previousSamples\":" << numberArrayJson(nextPreviousSamples)
    << ",\"dopFrameIndex\":" << nextDopFrameIndex
    << "}" << std::endl;
}

} // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--status") {
    printStatus();
    return 0;
  }

  std::string line;
  while (std::getline(std::cin, line)) {
    const std::string type = parseStringField(line, "type").value_or("");
    if (type == "status") {
      printStatus();
    } else if (type == "fir") {
      handleFir(line);
    } else if (type == "sdm") {
      handleSdm(line);
    } else if (!line.empty()) {
      printError("unknown_command", type);
    }
  }

  return 0;
}
