#pragma once

namespace echo
{
struct UzumeGpuBackendProbe
{
    bool compiled = false;
    bool available = false;
    bool cufftAvailable = false;
    const char* backend = "cpu-reference";
    const char* fallbackReason = "cuda-disabled";
    const char* cufftFallbackReason = "cuda-disabled";
    const char* deviceName = nullptr;
    int cudaRuntimeVersion = 0;
    int cufftVersion = 0;
    int deviceCount = 0;
};

struct UzumeGpuLimiterResult
{
    bool available = false;
    bool processed = false;
    bool clippingRisk = false;
    bool streamBacked = false;
    bool scratchReused = false;
    bool pinnedHostBacked = false;
    int scratchCapacitySamples = 0;
    int pinnedHostCapacitySamples = 0;
    int scratchCapacityChannels = 0;
    int pinnedHostCapacityChannels = 0;
    const char* fallbackReason = "cuda-disabled";
};

struct UzumeGpuPlaybackLimiterStatus
{
    bool available = false;
    bool prepared = false;
    bool streamBacked = false;
    bool scratchReused = false;
    bool pinnedHostBacked = false;
    int scratchCapacitySamples = 0;
    int pinnedHostCapacitySamples = 0;
    int scratchCapacityChannels = 0;
    int pinnedHostCapacityChannels = 0;
    const char* fallbackReason = "cuda-disabled";
};

struct UzumeGpuPlaybackStereoMatrixStatus
{
    bool available = false;
    bool prepared = false;
    bool streamBacked = false;
    bool scratchReused = false;
    bool pinnedHostBacked = false;
    int scratchCapacitySamples = 0;
    int pinnedHostCapacitySamples = 0;
    const char* fallbackReason = "cuda-disabled";
};

struct UzumeGpuStereoMatrix
{
    float leftToLeft = 1.0f;
    float rightToLeft = 0.0f;
    float leftToRight = 0.0f;
    float rightToRight = 1.0f;
    float outputGain = 1.0f;
};

struct UzumeGpuFftRoundtripResult
{
    bool available = false;
    bool processed = false;
    bool cufftAvailable = false;
    float maxAbsError = 0.0f;
    const char* fallbackReason = "cuda-disabled";
};

struct UzumeGpuFftConvolutionResult
{
    bool available = false;
    bool processed = false;
    bool cufftAvailable = false;
    bool streamBacked = false;
    bool scratchReused = false;
    bool planReused = false;
    bool pinnedHostBacked = false;
    int fftSize = 0;
    int scratchFftSize = 0;
    int pinnedHostFftSize = 0;
    float maxAbsError = 0.0f;
    const char* fallbackReason = "cuda-disabled";
};

struct UzumeGpuFftConvolutionPrepareStatus
{
    bool available = false;
    bool prepared = false;
    bool cufftAvailable = false;
    bool streamBacked = false;
    bool scratchReused = false;
    bool planReused = false;
    bool pinnedHostBacked = false;
    int fftSize = 0;
    int scratchFftSize = 0;
    int pinnedHostFftSize = 0;
    const char* fallbackReason = "cuda-disabled";
};

UzumeGpuBackendProbe probeUzumeGpuBackend();
UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackSafetyLimiter(int maxSamples);
UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackSafetyLimiter(float* samples, int sampleCount);
UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackPlanarSafetyLimiter(int maxSamples, int maxChannels);
UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(float* const* channelSamples, int channelCount, int sampleCount);
UzumeGpuLimiterResult processUzumeGpuSafetyLimiter(float* samples, int sampleCount);
UzumeGpuLimiterResult processUzumeGpuFusedGainLimiter(float* samples, int sampleCount, float gain);
UzumeGpuPlaybackStereoMatrixStatus prepareUzumeGpuPlaybackStereoMatrixLimiter(int maxSamples);
UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrixLimiter(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix);
UzumeGpuLimiterResult processUzumeGpuStereoMatrixLimiter(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix);
UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrix(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix);
UzumeGpuLimiterResult processUzumeGpuStereoMatrix(float* leftSamples, float* rightSamples, int sampleCount, const UzumeGpuStereoMatrix& matrix);
UzumeGpuFftRoundtripResult processUzumeGpuFftRoundtrip(float* samples, int sampleCount);
UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackFftConvolution(int maxSamples, int maxImpulseCount);
UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount);
UzumeGpuFftConvolutionResult processUzumeGpuFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount);
UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackStreamingFftConvolution(int maxSamples, int maxImpulseCount);
void resetUzumeGpuPlaybackStreamingFftConvolution();
UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackStreamingFftConvolution(float* samples, const float* impulse, int sampleCount, int impulseCount);
} // namespace echo
