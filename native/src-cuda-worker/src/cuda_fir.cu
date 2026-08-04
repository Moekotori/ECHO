#include "cuda_fir.h"

#include <cuda_runtime.h>

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

namespace {

constexpr unsigned char dsdSilenceByte = 0x69;
constexpr float sdmIdleSilenceThreshold = 0.00012f;
constexpr float sdmIdleLockThreshold = 0.00035f;
constexpr float sdmIdleUnlockThreshold = 0.0009f;
constexpr unsigned int sdmIdleLockFrames = 96u;

__global__ void firInterleavedKernel(
  const float* input,
  const float* history,
  const float* taps,
  float* output,
  int sampleCount,
  int channels,
  int tapCount
) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index >= sampleCount) {
    return;
  }

  const int channel = index % channels;
  const int frame = index / channels;
  const int historyFrames = tapCount - 1;
  float sample = 0.0f;

  for (int tapIndex = 0; tapIndex < tapCount; tapIndex += 1) {
    const int sourceFrame = historyFrames + frame - tapIndex;
    const int sourceIndex = sourceFrame * channels + channel;
    const float source = sourceFrame < historyFrames ? history[sourceIndex] : input[(sourceFrame - historyFrames) * channels + channel];
    sample += taps[tapIndex] * source;
  }

  output[index] = sample;
}

__device__ float clampDevice(float value, float minValue, float maxValue) {
  return fminf(maxValue, fmaxf(minValue, value));
}

__device__ unsigned int advanceDitherStateDevice(unsigned int state) {
  return (state == 0 ? 0x9e3779b9u : state) * 1664525u + 1013904223u;
}

__global__ void sdmDopKernel(
  const float* input,
  const float* feedbackCoefficients,
  const float* initialErrorHistory,
  const unsigned int* initialDitherState,
  const unsigned int* initialIdleRunFrames,
  const unsigned int* initialIdleLocked,
  const float* initialPreviousSamples,
  unsigned char* output,
  float* nextErrorHistory,
  unsigned int* nextDitherState,
  unsigned int* nextIdleRunFrames,
  unsigned int* nextIdleLocked,
  float* nextPreviousSamples,
  int channels,
  int frameCount,
  int order,
  int dopFrameIndex,
  float ditherAmplitude,
  float inputLimit,
  float stabilityLimit
) {
  const int channel = blockIdx.x * blockDim.x + threadIdx.x;
  if (channel >= channels || order <= 0 || order > 8) {
    return;
  }

  float errors[8] = { 0.0f };
  const int base = channel * order;
  for (int index = 0; index < order; index += 1) {
    errors[index] = initialErrorHistory[base + index];
  }
  unsigned int dither = initialDitherState[channel];
  unsigned int idleRun = initialIdleRunFrames[channel];
  unsigned int idleLock = initialIdleLocked[channel] != 0u ? 1u : 0u;
  float previousSample = clampDevice(initialPreviousSamples[channel], -inputLimit, inputLimit);

  for (int frame = 0; frame < frameCount; frame += 1) {
    const float sample = clampDevice(input[frame * channels + channel], -inputLimit, inputLimit);
    unsigned char firstByte = 0;
    unsigned char secondByte = 0;
    const unsigned char marker = ((dopFrameIndex + frame) & 1) == 0 ? 0x05 : 0xfa;
    const int outputOffset = (frame * channels + channel) * 3;

    const float magnitude = fabsf(sample);
    bool emitIdleSilence = false;
    if (idleLock != 0u) {
      if (magnitude < sdmIdleUnlockThreshold) {
        idleRun = min(sdmIdleLockFrames, idleRun + 1u);
        emitIdleSilence = true;
      } else {
        idleLock = 0u;
        idleRun = 0u;
      }
    } else if (magnitude <= sdmIdleSilenceThreshold) {
      idleLock = 1u;
      idleRun = sdmIdleLockFrames;
      emitIdleSilence = true;
    } else if (magnitude <= sdmIdleLockThreshold) {
      idleRun = min(sdmIdleLockFrames, idleRun + 1u);
      if (idleRun >= sdmIdleLockFrames) {
        idleLock = 1u;
        emitIdleSilence = true;
      }
    } else {
      idleRun = 0u;
    }

    if (emitIdleSilence) {
      for (int index = 0; index < order; index += 1) {
        errors[index] = 0.0f;
      }
      previousSample = 0.0f;
      output[outputOffset] = dsdSilenceByte;
      output[outputOffset + 1] = dsdSilenceByte;
      output[outputOffset + 2] = marker;
      continue;
    }

    for (int bit = 0; bit < 16; bit += 1) {
      dither = advanceDitherStateDevice(dither);
      const float ditherValue = (static_cast<float>(static_cast<double>(dither) / 4294967296.0 - 0.5) * ditherAmplitude);
      const float bitSample = previousSample + (sample - previousSample) * (static_cast<float>(bit + 1) / 16.0f);
      float decision = bitSample + ditherValue;
      for (int historyIndex = 0; historyIndex < order; historyIndex += 1) {
        decision += feedbackCoefficients[historyIndex] * errors[historyIndex];
      }
      decision = clampDevice(decision, -stabilityLimit, stabilityLimit);
      const bool one = decision >= 0.0f;
      const float quantizationError = clampDevice(decision - (one ? 1.0f : -1.0f), -stabilityLimit, stabilityLimit);
      if (order > 1) {
        for (int historyIndex = order - 1; historyIndex > 0; historyIndex -= 1) {
          errors[historyIndex] = errors[historyIndex - 1];
        }
      }
      errors[0] = quantizationError;

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
    previousSample = sample;
  }

  for (int index = 0; index < order; index += 1) {
    nextErrorHistory[base + index] = errors[index];
  }
  nextDitherState[channel] = dither;
  nextIdleRunFrames[channel] = idleRun;
  nextIdleLocked[channel] = idleLock;
  nextPreviousSamples[channel] = previousSample;
}

std::string cudaErrorText(cudaError_t status) {
  return cudaGetErrorString(status);
}

bool checkCuda(cudaError_t status, const char* step, std::string& error) {
  if (status == cudaSuccess) {
    return true;
  }

  error = std::string(step) + ":" + cudaErrorText(status);
  return false;
}

} // namespace

bool echoCudaFirProcess(
  const std::vector<float>& input,
  int channels,
  const std::vector<float>& taps,
  const std::vector<float>& history,
  std::vector<float>& output,
  std::vector<float>& nextHistory,
  std::string& error
) {
  if (channels <= 0 || input.empty() || taps.empty() || input.size() % static_cast<std::size_t>(channels) != 0) {
    error = "invalid_fir_request";
    return false;
  }

  const std::size_t historyLength = (taps.size() - 1) * static_cast<std::size_t>(channels);
  if (history.size() != historyLength) {
    error = "invalid_history_length";
    return false;
  }

  float* deviceInput = nullptr;
  float* deviceHistory = nullptr;
  float* deviceTaps = nullptr;
  float* deviceOutput = nullptr;
  output.assign(input.size(), 0.0f);

  if (!checkCuda(cudaMalloc(&deviceInput, input.size() * sizeof(float)), "cudaMalloc(input)", error) ||
      !checkCuda(cudaMalloc(&deviceHistory, std::max<std::size_t>(1, history.size()) * sizeof(float)), "cudaMalloc(history)", error) ||
      !checkCuda(cudaMalloc(&deviceTaps, taps.size() * sizeof(float)), "cudaMalloc(taps)", error) ||
      !checkCuda(cudaMalloc(&deviceOutput, output.size() * sizeof(float)), "cudaMalloc(output)", error)) {
    cudaFree(deviceInput);
    cudaFree(deviceHistory);
    cudaFree(deviceTaps);
    cudaFree(deviceOutput);
    return false;
  }

  const bool copied =
    checkCuda(cudaMemcpy(deviceInput, input.data(), input.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(input)", error) &&
    checkCuda(cudaMemcpy(deviceHistory, history.data(), history.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(history)", error) &&
    checkCuda(cudaMemcpy(deviceTaps, taps.data(), taps.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(taps)", error);
  if (!copied) {
    cudaFree(deviceInput);
    cudaFree(deviceHistory);
    cudaFree(deviceTaps);
    cudaFree(deviceOutput);
    return false;
  }

  constexpr int blockSize = 256;
  const int sampleCount = static_cast<int>(input.size());
  const int gridSize = (sampleCount + blockSize - 1) / blockSize;
  firInterleavedKernel<<<gridSize, blockSize>>>(
    deviceInput,
    deviceHistory,
    deviceTaps,
    deviceOutput,
    sampleCount,
    channels,
    static_cast<int>(taps.size())
  );

  const bool completed =
    checkCuda(cudaGetLastError(), "cudaKernel(fir)", error) &&
    checkCuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize", error) &&
    checkCuda(cudaMemcpy(output.data(), deviceOutput, output.size() * sizeof(float), cudaMemcpyDeviceToHost), "cudaMemcpy(output)", error);

  cudaFree(deviceInput);
  cudaFree(deviceHistory);
  cudaFree(deviceTaps);
  cudaFree(deviceOutput);

  if (!completed) {
    return false;
  }

  nextHistory.assign(historyLength, 0.0f);
  if (historyLength > 0) {
    std::vector<float> combined;
    combined.reserve(history.size() + input.size());
    combined.insert(combined.end(), history.begin(), history.end());
    combined.insert(combined.end(), input.begin(), input.end());
    std::copy(combined.end() - static_cast<std::ptrdiff_t>(historyLength), combined.end(), nextHistory.begin());
  }

  return true;
}

bool echoCudaSdmProcess(
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
  std::vector<unsigned char>& output,
  std::vector<float>& nextErrorHistory,
  std::vector<unsigned int>& nextDitherState,
  std::vector<unsigned int>& nextIdleRunFrames,
  std::vector<unsigned int>& nextIdleLocked,
  std::vector<float>& nextPreviousSamples,
  int& nextDopFrameIndex,
  std::string& error
) {
  if (
    channels <= 0 ||
    input.empty() ||
    input.size() % static_cast<std::size_t>(channels) != 0 ||
    feedbackCoefficients.empty() ||
    feedbackCoefficients.size() > 8 ||
    errorHistory.size() != feedbackCoefficients.size() * static_cast<std::size_t>(channels) ||
    ditherState.size() != static_cast<std::size_t>(channels) ||
    idleRunFrames.size() != static_cast<std::size_t>(channels) ||
    idleLocked.size() != static_cast<std::size_t>(channels) ||
    previousSamples.size() != static_cast<std::size_t>(channels) ||
    inputLimit <= 0.0f ||
    stabilityLimit <= 0.0f
  ) {
    error = "invalid_sdm_request";
    return false;
  }

  const int frameCount = static_cast<int>(input.size() / static_cast<std::size_t>(channels));
  const int order = static_cast<int>(feedbackCoefficients.size());
  output.assign(input.size() * 3, 0);
  nextErrorHistory.assign(errorHistory.size(), 0.0f);
  nextDitherState.assign(ditherState.size(), 0u);
  nextIdleRunFrames.assign(idleRunFrames.size(), 0u);
  nextIdleLocked.assign(idleLocked.size(), 0u);
  nextPreviousSamples.assign(previousSamples.size(), 0.0f);
  nextDopFrameIndex = dopFrameIndex + frameCount;

  float* deviceInput = nullptr;
  float* deviceCoefficients = nullptr;
  float* deviceErrorHistory = nullptr;
  unsigned int* deviceDitherState = nullptr;
  unsigned int* deviceIdleRunFrames = nullptr;
  unsigned int* deviceIdleLocked = nullptr;
  float* devicePreviousSamples = nullptr;
  unsigned char* deviceOutput = nullptr;
  float* deviceNextErrorHistory = nullptr;
  unsigned int* deviceNextDitherState = nullptr;
  unsigned int* deviceNextIdleRunFrames = nullptr;
  unsigned int* deviceNextIdleLocked = nullptr;
  float* deviceNextPreviousSamples = nullptr;

  if (!checkCuda(cudaMalloc(&deviceInput, input.size() * sizeof(float)), "cudaMalloc(sdmInput)", error) ||
      !checkCuda(cudaMalloc(&deviceCoefficients, feedbackCoefficients.size() * sizeof(float)), "cudaMalloc(sdmCoefficients)", error) ||
      !checkCuda(cudaMalloc(&deviceErrorHistory, errorHistory.size() * sizeof(float)), "cudaMalloc(sdmErrorHistory)", error) ||
      !checkCuda(cudaMalloc(&deviceDitherState, ditherState.size() * sizeof(unsigned int)), "cudaMalloc(sdmDitherState)", error) ||
      !checkCuda(cudaMalloc(&deviceIdleRunFrames, idleRunFrames.size() * sizeof(unsigned int)), "cudaMalloc(sdmIdleRunFrames)", error) ||
      !checkCuda(cudaMalloc(&deviceIdleLocked, idleLocked.size() * sizeof(unsigned int)), "cudaMalloc(sdmIdleLocked)", error) ||
      !checkCuda(cudaMalloc(&devicePreviousSamples, previousSamples.size() * sizeof(float)), "cudaMalloc(sdmPreviousSamples)", error) ||
      !checkCuda(cudaMalloc(&deviceOutput, output.size() * sizeof(unsigned char)), "cudaMalloc(sdmOutput)", error) ||
      !checkCuda(cudaMalloc(&deviceNextErrorHistory, nextErrorHistory.size() * sizeof(float)), "cudaMalloc(sdmNextErrorHistory)", error) ||
      !checkCuda(cudaMalloc(&deviceNextDitherState, nextDitherState.size() * sizeof(unsigned int)), "cudaMalloc(sdmNextDitherState)", error) ||
      !checkCuda(cudaMalloc(&deviceNextIdleRunFrames, nextIdleRunFrames.size() * sizeof(unsigned int)), "cudaMalloc(sdmNextIdleRunFrames)", error) ||
      !checkCuda(cudaMalloc(&deviceNextIdleLocked, nextIdleLocked.size() * sizeof(unsigned int)), "cudaMalloc(sdmNextIdleLocked)", error) ||
      !checkCuda(cudaMalloc(&deviceNextPreviousSamples, nextPreviousSamples.size() * sizeof(float)), "cudaMalloc(sdmNextPreviousSamples)", error)) {
    cudaFree(deviceInput);
    cudaFree(deviceCoefficients);
    cudaFree(deviceErrorHistory);
    cudaFree(deviceDitherState);
    cudaFree(deviceIdleRunFrames);
    cudaFree(deviceIdleLocked);
    cudaFree(devicePreviousSamples);
    cudaFree(deviceOutput);
    cudaFree(deviceNextErrorHistory);
    cudaFree(deviceNextDitherState);
    cudaFree(deviceNextIdleRunFrames);
    cudaFree(deviceNextIdleLocked);
    cudaFree(deviceNextPreviousSamples);
    return false;
  }

  const bool copied =
    checkCuda(cudaMemcpy(deviceInput, input.data(), input.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(sdmInput)", error) &&
    checkCuda(cudaMemcpy(deviceCoefficients, feedbackCoefficients.data(), feedbackCoefficients.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(sdmCoefficients)", error) &&
    checkCuda(cudaMemcpy(deviceErrorHistory, errorHistory.data(), errorHistory.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(sdmErrorHistory)", error) &&
    checkCuda(cudaMemcpy(deviceDitherState, ditherState.data(), ditherState.size() * sizeof(unsigned int), cudaMemcpyHostToDevice), "cudaMemcpy(sdmDitherState)", error) &&
    checkCuda(cudaMemcpy(deviceIdleRunFrames, idleRunFrames.data(), idleRunFrames.size() * sizeof(unsigned int), cudaMemcpyHostToDevice), "cudaMemcpy(sdmIdleRunFrames)", error) &&
    checkCuda(cudaMemcpy(deviceIdleLocked, idleLocked.data(), idleLocked.size() * sizeof(unsigned int), cudaMemcpyHostToDevice), "cudaMemcpy(sdmIdleLocked)", error) &&
    checkCuda(cudaMemcpy(devicePreviousSamples, previousSamples.data(), previousSamples.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy(sdmPreviousSamples)", error);
  if (!copied) {
    cudaFree(deviceInput);
    cudaFree(deviceCoefficients);
    cudaFree(deviceErrorHistory);
    cudaFree(deviceDitherState);
    cudaFree(deviceIdleRunFrames);
    cudaFree(deviceIdleLocked);
    cudaFree(devicePreviousSamples);
    cudaFree(deviceOutput);
    cudaFree(deviceNextErrorHistory);
    cudaFree(deviceNextDitherState);
    cudaFree(deviceNextIdleRunFrames);
    cudaFree(deviceNextIdleLocked);
    cudaFree(deviceNextPreviousSamples);
    return false;
  }

  constexpr int blockSize = 32;
  const int gridSize = (channels + blockSize - 1) / blockSize;
  sdmDopKernel<<<gridSize, blockSize>>>(
    deviceInput,
    deviceCoefficients,
    deviceErrorHistory,
    deviceDitherState,
    deviceIdleRunFrames,
    deviceIdleLocked,
    devicePreviousSamples,
    deviceOutput,
    deviceNextErrorHistory,
    deviceNextDitherState,
    deviceNextIdleRunFrames,
    deviceNextIdleLocked,
    deviceNextPreviousSamples,
    channels,
    frameCount,
    order,
    dopFrameIndex,
    ditherAmplitude,
    inputLimit,
    stabilityLimit
  );

  const bool completed =
    checkCuda(cudaGetLastError(), "cudaKernel(sdm)", error) &&
    checkCuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize(sdm)", error) &&
    checkCuda(cudaMemcpy(output.data(), deviceOutput, output.size() * sizeof(unsigned char), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmOutput)", error) &&
    checkCuda(cudaMemcpy(nextErrorHistory.data(), deviceNextErrorHistory, nextErrorHistory.size() * sizeof(float), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmNextErrorHistory)", error) &&
    checkCuda(cudaMemcpy(nextDitherState.data(), deviceNextDitherState, nextDitherState.size() * sizeof(unsigned int), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmNextDitherState)", error) &&
    checkCuda(cudaMemcpy(nextIdleRunFrames.data(), deviceNextIdleRunFrames, nextIdleRunFrames.size() * sizeof(unsigned int), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmNextIdleRunFrames)", error) &&
    checkCuda(cudaMemcpy(nextIdleLocked.data(), deviceNextIdleLocked, nextIdleLocked.size() * sizeof(unsigned int), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmNextIdleLocked)", error) &&
    checkCuda(cudaMemcpy(nextPreviousSamples.data(), deviceNextPreviousSamples, nextPreviousSamples.size() * sizeof(float), cudaMemcpyDeviceToHost), "cudaMemcpy(sdmNextPreviousSamples)", error);

  cudaFree(deviceInput);
  cudaFree(deviceCoefficients);
  cudaFree(deviceErrorHistory);
  cudaFree(deviceDitherState);
  cudaFree(deviceIdleRunFrames);
  cudaFree(deviceIdleLocked);
  cudaFree(devicePreviousSamples);
  cudaFree(deviceOutput);
  cudaFree(deviceNextErrorHistory);
  cudaFree(deviceNextDitherState);
  cudaFree(deviceNextIdleRunFrames);
  cudaFree(deviceNextIdleLocked);
  cudaFree(deviceNextPreviousSamples);

  return completed;
}
