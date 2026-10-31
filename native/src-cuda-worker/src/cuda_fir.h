#pragma once

#include <string>
#include <vector>

bool echoCudaFirProcess(
  const std::vector<float>& input,
  int channels,
  const std::vector<float>& taps,
  const std::vector<float>& history,
  std::vector<float>& output,
  std::vector<float>& nextHistory,
  std::string& error
);

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
);
