#include "cuda_fir.h"

#ifndef ECHO_SRC_CUDA_WORKER_HAS_CUDA
bool echoCudaFirProcess(
  const std::vector<float>&,
  int,
  const std::vector<float>&,
  const std::vector<float>&,
  std::vector<float>&,
  std::vector<float>&,
  std::string& error
) {
  error = "cuda_not_built";
  return false;
}

bool echoCudaSdmProcess(
  const std::vector<float>&,
  int,
  const std::vector<float>&,
  const std::vector<float>&,
  const std::vector<unsigned int>&,
  const std::vector<unsigned int>&,
  const std::vector<unsigned int>&,
  const std::vector<float>&,
  int,
  float,
  float,
  float,
  std::vector<unsigned char>&,
  std::vector<float>&,
  std::vector<unsigned int>&,
  std::vector<unsigned int>&,
  std::vector<unsigned int>&,
  std::vector<float>&,
  int&,
  std::string& error
) {
  error = "cuda_not_built";
  return false;
}
#endif
